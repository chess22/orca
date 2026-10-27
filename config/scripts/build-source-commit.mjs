import { execFileSync } from 'node:child_process'

/**
 * The full commit this build is made from. Official skill installs pin to it, so the
 * skills an Orca build installs are the ones it bundles on every release channel.
 */
export function resolveBuildSourceCommit() {
  let commit = ''
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch (error) {
    throw new Error(
      `Could not read the source commit with \`git rev-parse HEAD\`: ${
        error instanceof Error ? error.message : String(error)
      }. Orca builds must run from a git checkout so official skills can pin to it.`
    )
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`\`git rev-parse HEAD\` returned "${commit}", not a full commit hash.`)
  }
  return commit
}

/** A provenance-bearing package must not describe uncommitted bytes as its HEAD commit. */
export function resolveBuildSourceState() {
  const commit = resolveBuildSourceCommit()
  let dirtyOutput = ''
  try {
    dirtyOutput = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      encoding: 'utf8'
    }).trim()
  } catch (error) {
    throw new Error(
      `Could not inspect the source tree with \`git status --porcelain\`: ${
        error instanceof Error ? error.message : String(error)
      }.`
    )
  }
  return { commit, dirty: dirtyOutput.length > 0 }
}
