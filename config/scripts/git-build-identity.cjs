const { execFileSync } = require('node:child_process')

function runGit(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return null
  }
}

// Why: many CI checkouts land on a detached HEAD, so the workflow's own
// notion of the branch (if present) is more reliable than a local git lookup.
function resolveBranchName(env, cwd) {
  const ciBranch = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME
  if (ciBranch) {
    return ciBranch
  }
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  return branch && branch !== 'HEAD' ? branch : null
}

// Semver build-metadata identifiers must each match [0-9A-Za-z-]+, so a
// branch's "/" path segments become "." separators and any other disallowed
// character collapses to "-".
function sanitizeBuildMetadataSegment(value) {
  return value
    .split('/')
    .map((segment) => segment.replace(/[^0-9A-Za-z-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('.')
}

function getGitBuildIdentity(env = process.env, cwd = process.cwd()) {
  const branch = resolveBranchName(env, cwd)
  const commitHash = runGit(['rev-parse', '--short=8', 'HEAD'], cwd)
  const sanitizedBranch = branch ? sanitizeBuildMetadataSegment(branch) : null
  const versionMetadata =
    sanitizedBranch && commitHash
      ? `${sanitizedBranch}.${commitHash}`
      : (sanitizedBranch ?? commitHash)

  return { branch, commitHash, versionMetadata }
}

module.exports = { getGitBuildIdentity, sanitizeBuildMetadataSegment }
