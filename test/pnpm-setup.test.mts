import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// pnpm is not pinned: CI installs the newest release of one major through
// pnpm/action-setup's `latest-<major>` tag. A bare major would keep the action's
// bundled release instead, and an exact version or a manifest pin is a pin.
const workflowDirectory = '.github/workflows'
const actionSetup = /^pnpm\/action-setup@[0-9a-f]{40} # v\d+\.\d+\.\d+$/u
const latestMajor = /^latest-(\d+)$/u
// release.yml's legacy lines check out a source whose package.json still pins
// pnpm, so they pass no version and the action installs that pin.
const releaseLineVersion = /^\$\{\{ inputs\.release_line == 'main' && 'latest-(\d+)' \|\| '' \}\}$/u
const runsPnpm = /(?:^|[\s;&|(])pnpm\s/mu

interface Step {
  readonly uses: string | undefined
  readonly inputs: ReadonlyMap<string, string>
  readonly runsPnpm: boolean
}

interface Job {
  readonly location: string
  readonly workflow: string
  readonly steps: readonly Step[]
}

const workflows = readdirSync(workflowDirectory)
  .filter((name) => /\.ya?ml$/u.test(name))
  .map((name) => ({ name, text: readFileSync(`${workflowDirectory}/${name}`, 'utf8') }))

function stepBlocks(text: string): { job: string; steps: string[][] }[] {
  const jobs: { job: string; steps: string[][] }[] = []
  let inJobs = false
  let open = false
  for (const line of text.split('\n')) {
    if (/^\S/u.test(line)) {
      inJobs = line === 'jobs:'
      continue
    }
    const job = inJobs ? /^ {2}([\w-]+):$/u.exec(line) : null
    if (job) {
      jobs.push({ job: job[1]!, steps: [] })
      open = false
    } else if (line.startsWith('      - ') && jobs.length > 0) {
      jobs.at(-1)!.steps.push([line])
      open = true
    } else if (/^ {0,6}\S/u.test(line)) {
      open = false
    } else if (open) {
      jobs.at(-1)!.steps.at(-1)!.push(line)
    }
  }
  return jobs
}

function parseStep(lines: readonly string[]): Step {
  const code = lines.filter((line) => !line.trimStart().startsWith('#'))
  const uses = code
    .map((line) => /^ {6}- uses: (.+)$|^ {8}uses: (.+)$/u.exec(line))
    .find((match) => match !== null)
  const inputs = new Map<string, string>()
  const withIndex = code.indexOf('        with:')
  if (withIndex >= 0) {
    for (const line of code.slice(withIndex + 1)) {
      const input = /^ {10}([\w-]+): (.+)$/u.exec(line)
      if (!input) break
      inputs.set(input[1]!, input[2]!)
    }
  }
  const run = code.findIndex((line) => /^ {6}- run: |^ {8}run: /u.test(line))
  return {
    uses: uses ? (uses[1] ?? uses[2]) : undefined,
    inputs,
    runsPnpm:
      run >= 0 &&
      runsPnpm.test(
        code
          .slice(run)
          .join('\n')
          .replace(/\brun: /u, ' '),
      ),
  }
}

const jobs: Job[] = workflows.flatMap(({ name, text }) =>
  stepBlocks(text).map(({ job, steps }) => ({
    location: `${name} ${job}`,
    workflow: name,
    steps: steps.map(parseStep),
  })),
)

const isActionSetup = (step: Step) => step.uses?.startsWith('pnpm/action-setup@') === true
const isSetupNode = (step: Step) => step.uses?.startsWith('actions/setup-node@') === true
const setups = jobs.flatMap((job) =>
  job.steps.filter(isActionSetup).map((step) => ({ ...job, step })),
)

describe('pnpm provisioning', () => {
  it('finds the jobs that set up pnpm', () => {
    expect(setups.map(({ location }) => location)).toEqual([
      'ci.yml test',
      'ci.yml actionlint',
      'release.yml release',
    ])
  })

  it('pins every pnpm/action-setup call to a commit SHA with its release tag', () => {
    for (const { location, step } of setups) {
      expect(step.uses, location).toMatch(actionSetup)
    }
  })

  it('installs one pnpm major through latest-<major> and passes no other version input', () => {
    const majors = new Set<string>()
    for (const { location, workflow, step } of setups) {
      expect(
        [...step.inputs.keys()].filter((key) => key !== 'cache'),
        location,
      ).toEqual(['version'])
      if (step.inputs.has('cache')) expect(step.inputs.get('cache'), location).toBe('true')
      const version = step.inputs.get('version')!
      const major = (workflow === 'release.yml' ? releaseLineVersion : latestMajor).exec(version)
      expect(major, `${location} version: ${version}`).not.toBeNull()
      majors.add(major![1]!)
    }
    expect([...majors]).toHaveLength(1)
  })

  it('sets up Node before pnpm, and pnpm before every step that runs it', () => {
    for (const { location, steps } of jobs) {
      const firstPnpm = steps.findIndex((step) => step.runsPnpm)
      const setup = steps.findIndex(isActionSetup)
      if (firstPnpm < 0 && setup < 0) continue
      expect(setup, `${location} sets up pnpm`).toBeGreaterThanOrEqual(0)
      expect(steps.findIndex(isSetupNode), `${location} sets up Node first`).toBeGreaterThanOrEqual(
        0,
      )
      expect(steps.findIndex(isSetupNode), location).toBeLessThan(setup)
      if (firstPnpm >= 0) expect(setup, `${location} runs pnpm after setup`).toBeLessThan(firstPnpm)
    }
  })

  it('does not pin pnpm in any package.json', () => {
    const manifests = [
      'package.json',
      ...readdirSync('packages').map((directory) => `packages/${directory}/package.json`),
    ]
    for (const path of manifests) {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
        packageManager?: unknown
        devEngines?: { packageManager?: unknown }
      }
      expect(manifest.packageManager, path).toBeUndefined()
      expect(manifest.devEngines?.packageManager, path).toBeUndefined()
    }
  })

  it('never activates pnpm through Corepack or a pnpm@<version> spec', () => {
    for (const { name, text } of workflows) {
      expect(text, name).not.toMatch(/corepack/iu)
      expect(text, name).not.toMatch(/pnpm@\d/u)
    }
  })
})
