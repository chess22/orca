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

// Why: many CI checkouts land on a detached HEAD, so a provider's own notion
// of the branch (if present) is more reliable than a local git lookup. Orca
// supports GitHub, GitLab, Bitbucket, Azure DevOps, and Gitea as git
// providers (see AGENTS.md Git Provider Compatibility) — this must not be
// GitHub-only. Merge/PR pipelines are listed before their provider's generic
// "current ref" var because that generic var can hold a synthetic merge ref
// (e.g. GitLab's CI_COMMIT_REF_NAME is "42/merge" in MR pipelines) instead of
// the actual source branch.
const CI_BRANCH_ENV_VARS = [
  'GITHUB_HEAD_REF', // GitHub Actions / Gitea Actions (mirrors GitHub's vars) — pull_request events
  'GITHUB_REF_NAME', // GitHub Actions / Gitea Actions — push/tag events
  'CI_MERGE_REQUEST_SOURCE_BRANCH_NAME', // GitLab CI — merge request pipelines
  'CI_COMMIT_BRANCH', // GitLab CI — branch pipelines
  'CI_COMMIT_REF_NAME', // GitLab CI — any pipeline (tag or branch)
  'BITBUCKET_BRANCH', // Bitbucket Pipelines
  'SYSTEM_PULLREQUEST_SOURCEBRANCH', // Azure Pipelines — PR builds (full ref)
  'BUILD_SOURCEBRANCHNAME', // Azure Pipelines — CI builds (leaf name)
  'DRONE_SOURCE_BRANCH', // Drone/Woodpecker CI (a common Gitea non-Actions runner)
  'CIRCLE_BRANCH', // CircleCI
  'BRANCH_NAME', // Jenkins multibranch pipeline
  'TRAVIS_PULL_REQUEST_BRANCH', // Travis CI — PR builds ("false" when not a PR)
  'TRAVIS_BRANCH' // Travis CI — push builds
]
// Why: Travis sets this to the literal string "false" for non-PR builds
// instead of leaving it unset.
const CI_BRANCH_ENV_FALSY_VALUES = new Set(['false'])

function stripRefPrefix(value) {
  return value.replace(/^refs\/heads\//, '')
}

function resolveCiBranchFromEnv(env) {
  for (const varName of CI_BRANCH_ENV_VARS) {
    const value = env[varName]
    if (value && !CI_BRANCH_ENV_FALSY_VALUES.has(value)) {
      return stripRefPrefix(value)
    }
  }
  return null
}

function resolveBranchName(env, cwd) {
  const ciBranch = resolveCiBranchFromEnv(env)
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

module.exports = { getGitBuildIdentity, sanitizeBuildMetadataSegment, resolveCiBranchFromEnv }
