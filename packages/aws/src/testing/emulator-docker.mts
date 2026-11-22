import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const EMULATOR_PORT_IN_CONTAINER = 9297
const DOCKER_START_DEADLINE_MS = 180_000
const READY_DEADLINE_MS = 60_000
const DOCKER_COMMAND_DEADLINE_MS = 30_000
// A crashed test runner must not leave an emulator holding memory forever.
export const AWS_EMULATOR_IDLE_TIMEOUT_SECONDS = 3_600

export interface StartedAwsEmulatorProcess {
  port: Promise<number>
  /** The in-container port names the state directory when Docker remaps the host port. */
  statePort?: number
  stop: () => Promise<void>
}

export interface StartAwsEmulatorInDockerOptions {
  /** Directory the emulator uses as HOME; mounted at the same path inside the container. */
  home: string
  /** Host path of the Linux emulator binary, mounted read-only. */
  binary: string
  /** A Linux image able to run the binary (a Debian-based Node image works). Pin it by digest. */
  image: string
  /** Prefix of the container name. Defaults to `aws-emulator`. */
  containerNamePrefix?: string
}

/** Runs the Linux binary in a container, for hosts (macOS) that cannot execute it. */
export async function startAwsEmulatorInDocker(
  options: StartAwsEmulatorInDockerOptions,
): Promise<StartedAwsEmulatorProcess> {
  const { home, binary, image } = options
  const name = `${options.containerNamePrefix ?? 'aws-emulator'}-${process.pid}-${Date.now()}`
  await execFileAsync(
    'docker',
    [
      'run',
      '--rm',
      '--detach',
      '--name',
      name,
      '--memory=2g',
      '--memory-swap=2g',
      '--user',
      `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      '--publish',
      `127.0.0.1::${EMULATOR_PORT_IN_CONTAINER}`,
      '--volume',
      `${resolve(binary)}:/usr/local/bin/aws-emulator:ro`,
      '--volume',
      `${home}:${home}`,
      '--env',
      `HOME=${home}`,
      '--env',
      'EMULATOR_TELEMETRY=off',
      '--entrypoint',
      '/usr/local/bin/aws-emulator',
      image,
      '--bind',
      '0.0.0.0',
      '--port',
      String(EMULATOR_PORT_IN_CONTAINER),
      '--telemetry',
      'off',
      '--idle-timeout',
      String(AWS_EMULATOR_IDLE_TIMEOUT_SECONDS),
    ],
    { timeout: DOCKER_START_DEADLINE_MS },
  )
  const stop = async () => {
    await execFileAsync('docker', ['rm', '--force', name], {
      timeout: DOCKER_COMMAND_DEADLINE_MS,
    }).catch(() => undefined)
  }
  const port = (async () => {
    // Follow the container log until the server announces it listens; the state files exist then.
    const logs = spawn('docker', ['logs', '--follow', name], { stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await readAnnouncedPort(logs)
    } finally {
      logs.kill()
    }
    const { stdout } = await execFileAsync(
      'docker',
      ['port', name, `${EMULATOR_PORT_IN_CONTAINER}/tcp`],
      { timeout: DOCKER_COMMAND_DEADLINE_MS },
    )
    const match = /:(\d+)\s*$/m.exec(stdout)
    if (!match) throw new Error(`Could not read the published AWS Emulator port: ${stdout}`)
    return Number(match[1])
  })()
  return { port, statePort: EMULATOR_PORT_IN_CONTAINER, stop }
}

/** Resolves with the port in the emulator's startup log line, or rejects past the deadline. */
export function readAnnouncedPort(child: ChildProcess): Promise<number> {
  return new Promise((resolvePort, reject) => {
    let output = ''
    // The runtime owns the timer behind AbortSignal.timeout, so the deadline is an abort event.
    const deadline = AbortSignal.timeout(READY_DEADLINE_MS)
    const settle = new AbortController()
    deadline.addEventListener(
      'abort',
      () => reject(new Error(`AWS Emulator did not announce its endpoint:\n${output}`)),
      { once: true, signal: settle.signal },
    )
    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      const match = /"endpoint_url":"https:\/\/[^"]+:(\d+)"/.exec(output)
      if (!match) return
      settle.abort()
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
      // Keep draining so a full pipe never blocks the emulator.
      child.stdout?.resume()
      child.stderr?.resume()
      resolvePort(Number(match[1]))
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('exit', (code) => {
      settle.abort()
      reject(new Error(`AWS Emulator exited with ${code} before it was ready:\n${output}`))
    })
    // A binary that cannot start emits 'error', and may never emit 'exit'.
    child.once('error', (error) => {
      settle.abort()
      reject(new Error(`AWS Emulator failed to start:\n${output}`, { cause: error }))
    })
  })
}
