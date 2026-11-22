import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { request } from 'node:https'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import tls from 'node:tls'
import {
  AWS_EMULATOR_IDLE_TIMEOUT_SECONDS,
  readAnnouncedPort,
  startAwsEmulatorInDocker,
  type StartedAwsEmulatorProcess,
} from './emulator-docker.mts'
import {
  ensureAwsEmulatorBinary,
  type EnsureAwsEmulatorBinaryOptions,
} from './emulator-package.mts'

const READY_DEADLINE_MS = 60_000

export interface AwsEmulatorConnection {
  endpoint: string
  region: string
  caPem: string
  accessKeyId: string
  secretAccessKey: string
}

export interface RunningAwsEmulator extends AwsEmulatorConnection {
  stop: () => Promise<void>
}

export interface StartAwsEmulatorOptions {
  /** The pinned package to download and verify. */
  package: EnsureAwsEmulatorBinaryOptions
  /** Image used to run the Linux binary on hosts that cannot execute it natively (macOS). */
  dockerImage: string
  /** Prefix for the temporary HOME directory and the container name. Defaults to `aws-emulator`. */
  namePrefix?: string
  /** Region the emulator reports. Defaults to `us-west-2`. */
  region?: string
}

/** Starts a private emulator on a free port with telemetry off and returns its connection. */
export async function startAwsEmulator(
  options: StartAwsEmulatorOptions,
): Promise<RunningAwsEmulator> {
  const prefix = options.namePrefix ?? 'aws-emulator'
  const binary = await ensureAwsEmulatorBinary(options.package)
  const home = await mkdtemp(join(tmpdir(), `${prefix}-`))
  const running =
    platform() === 'linux'
      ? startNative(binary, home)
      : await startAwsEmulatorInDocker({
          home,
          binary,
          image: options.dockerImage,
          containerNamePrefix: prefix,
        })
  try {
    const port = await running.port
    const stateDir = join(home, '.aws', 'emulator', String(running.statePort ?? port))
    const caPem = await readFile(join(stateDir, 'ca.pem'), 'utf8')
    const credentials = parseCredentials(
      await readFile(join(stateDir, 'emulator_credentials'), 'utf8'),
    )
    const endpoint = `https://127.0.0.1:${port}`
    await checkHealth(endpoint, caPem)
    return {
      endpoint,
      region: options.region ?? 'us-west-2',
      caPem,
      ...credentials,
      stop: async () => {
        await running.stop()
        await rm(home, { recursive: true, force: true })
      },
    }
  } catch (err) {
    await running.stop()
    await rm(home, { recursive: true, force: true })
    throw err
  }
}

function startNative(binary: string, home: string): StartedAwsEmulatorProcess {
  const child = spawn(
    binary,
    [
      '--port',
      '0',
      '--telemetry',
      'off',
      '--idle-timeout',
      String(AWS_EMULATOR_IDLE_TIMEOUT_SECONDS),
    ],
    {
      env: { PATH: process.env.PATH, HOME: home, EMULATOR_TELEMETRY: 'off' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  return { port: readAnnouncedPort(child), stop: () => stopChild(child) }
}

async function stopChild(child: ChildProcess): Promise<void> {
  // A failed spawn has no pid and never emits 'exit'.
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  // The runtime owns the timer behind AbortSignal.timeout; a stuck emulator is killed outright.
  const forceKill = AbortSignal.timeout(5_000)
  const onForceKill = () => child.kill('SIGKILL')
  forceKill.addEventListener('abort', onForceKill, { once: true })
  await exited
  forceKill.removeEventListener('abort', onForceKill)
}

// The emulator logs its endpoint once it listens, so one request confirms it serves.
async function checkHealth(endpoint: string, caPem: string): Promise<void> {
  const status = await new Promise<number | undefined>((resolveStatus, reject) => {
    const req = request(
      `${endpoint}/__admin/health`,
      { ca: caPem, signal: AbortSignal.timeout(READY_DEADLINE_MS) },
      (res) => {
        res.resume()
        resolveStatus(res.statusCode)
      },
    )
    req.once('error', reject)
    req.end()
  })
  if (status !== 200) throw new Error(`AWS Emulator at ${endpoint} answered health with ${status}`)
}

function parseCredentials(file: string): { accessKeyId: string; secretAccessKey: string } {
  const accessKeyId = /^\s*aws_access_key_id\s*=\s*(\S+)/m.exec(file)?.[1]
  const secretAccessKey = /^\s*aws_secret_access_key\s*=\s*(\S+)/m.exec(file)?.[1]
  if (!accessKeyId || !secretAccessKey) throw new Error('AWS Emulator wrote no credentials')
  return { accessKeyId, secretAccessKey }
}

/**
 * Adds the run's self-signed emulator certificate to Node's default trust store, which every TLS
 * client in this process (the SDK's handler, `fetch`) reads unless it passes its own `ca`.
 */
export function trustAwsEmulatorCertificate(caPem: string): void {
  // Added in Node 24.5; older runtimes can pass the certificate as `ca` or set NODE_EXTRA_CA_CERTS.
  if (typeof tls.setDefaultCACertificates !== 'function') {
    throw new Error(
      'trustAwsEmulatorCertificate needs Node 24.5 or newer; pass caPem as `ca` instead',
    )
  }
  const current = tls.getCACertificates('default')
  if (current.includes(caPem)) return
  tls.setDefaultCACertificates([...current, caPem])
}
