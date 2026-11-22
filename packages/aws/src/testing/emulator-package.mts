import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { arch } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const DOWNLOAD_DEADLINE_MS = 180_000

export type DebArch = 'amd64' | 'arm64'

export interface AwsEmulatorPackagePin {
  version: string
  /** SHA-256 hex digest of each architecture's .deb, recorded after verifying AWS's signature. */
  sha256: Record<DebArch, string>
}

export interface EnsureAwsEmulatorBinaryOptions {
  /** The pinned package; callers own the version bump and the recorded digests. */
  pin: AwsEmulatorPackagePin
  /** Directory the verified binary is cached in, one subdirectory per version and architecture. */
  cacheDir: string
  /** Defaults to the host architecture. */
  target?: DebArch
  /** Defaults to the global fetch; inject one that honors a proxy where the network requires it. */
  fetch?: (url: string, init: { signal: AbortSignal }) => Promise<Response>
  /** Package index. Defaults to the AWS download host. */
  baseUrl?: string
}

export function debArch(): DebArch {
  const value = arch()
  if (value === 'x64') return 'amd64'
  if (value === 'arm64') return 'arm64'
  throw new Error(`The AWS Emulator ships no Linux package for ${value}`)
}

/** Downloads, digest-verifies and extracts the pinned binary once per cache directory. */
export async function ensureAwsEmulatorBinary(
  options: EnsureAwsEmulatorBinaryOptions,
): Promise<string> {
  const { pin, cacheDir } = options
  const target = options.target ?? debArch()
  const doFetch = options.fetch ?? fetch
  const baseUrl =
    options.baseUrl ?? 'https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS'
  const dir = join(cacheDir, pin.version, target)
  const binary = join(dir, 'aws-emulator')
  if (existsSync(binary)) return binary

  await mkdir(dir, { recursive: true })
  const staging = await mkdtemp(join(dir, 'staging-'))
  try {
    const deb = join(staging, 'aws-emulator.deb')
    const url = `${baseUrl}/aws-emulator_${pin.version}-1_${target}.deb`
    const response = await doFetch(url, { signal: AbortSignal.timeout(DOWNLOAD_DEADLINE_MS) })
    if (!response.ok || !response.body) {
      throw new Error(`AWS Emulator download failed: ${response.status} ${url}`)
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(deb))

    const digest = await sha256File(deb)
    const expected = pin.sha256[target]
    if (digest !== expected) {
      throw new Error(`AWS Emulator package digest ${digest} does not match pinned ${expected}`)
    }

    // A .deb is an ar archive; the binary is the only file needed from its data tarball.
    await execFileAsync(
      'sh',
      [
        '-c',
        'ar p "$0" data.tar.xz | tar -xJf - -C "$1" ./opt/aws-emulator/bin/aws-emulator',
        deb,
        staging,
      ],
      { timeout: DOWNLOAD_DEADLINE_MS },
    )
    const extracted = join(staging, 'opt', 'aws-emulator', 'bin', 'aws-emulator')
    await chmod(extracted, 0o755)
    // Concurrent runs may race to this point; rename is atomic and either copy is identical.
    await rename(extracted, binary)
    return binary
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}
