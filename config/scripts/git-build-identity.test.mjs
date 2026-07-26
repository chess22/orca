import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  getGitBuildIdentity,
  sanitizeBuildMetadataSegment,
  resolveCiBranchFromEnv
} = require('./git-build-identity.cjs')

describe('resolveCiBranchFromEnv', () => {
  it('resolves GitLab CI merge request pipelines from the source branch var, not the synthetic merge ref', () => {
    expect(
      resolveCiBranchFromEnv({
        CI_COMMIT_REF_NAME: '42/merge',
        CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'chess22/version-identity'
      })
    ).toBe('chess22/version-identity')
  })

  it('resolves GitLab CI branch pipelines from CI_COMMIT_BRANCH', () => {
    expect(resolveCiBranchFromEnv({ CI_COMMIT_BRANCH: 'chess22/version-identity' })).toBe(
      'chess22/version-identity'
    )
  })

  it('falls back to CI_COMMIT_REF_NAME for GitLab CI tag pipelines', () => {
    expect(resolveCiBranchFromEnv({ CI_COMMIT_REF_NAME: 'v1.4.155' })).toBe('v1.4.155')
  })

  it('resolves Bitbucket Pipelines from BITBUCKET_BRANCH', () => {
    expect(resolveCiBranchFromEnv({ BITBUCKET_BRANCH: 'chess22/version-identity' })).toBe(
      'chess22/version-identity'
    )
  })

  it('strips the refs/heads/ prefix from Azure Pipelines PR builds', () => {
    expect(
      resolveCiBranchFromEnv({
        SYSTEM_PULLREQUEST_SOURCEBRANCH: 'refs/heads/chess22/version-identity'
      })
    ).toBe('chess22/version-identity')
  })

  it('resolves Azure Pipelines CI builds from BUILD_SOURCEBRANCHNAME', () => {
    expect(resolveCiBranchFromEnv({ BUILD_SOURCEBRANCHNAME: 'version-identity' })).toBe(
      'version-identity'
    )
  })

  it('ignores Travis CI\'s "false" sentinel for non-PR builds and falls back to TRAVIS_BRANCH', () => {
    expect(
      resolveCiBranchFromEnv({
        TRAVIS_PULL_REQUEST_BRANCH: 'false',
        TRAVIS_BRANCH: 'chess22/version-identity'
      })
    ).toBe('chess22/version-identity')
  })

  it('returns null when no supported provider env var is set', () => {
    expect(resolveCiBranchFromEnv({})).toBeNull()
  })
})

describe('sanitizeBuildMetadataSegment', () => {
  it('turns branch path segments into dot-separated semver identifiers', () => {
    expect(sanitizeBuildMetadataSegment('chess22/version-identity')).toBe(
      'chess22.version-identity'
    )
  })

  it('collapses disallowed characters and trims stray hyphens', () => {
    expect(sanitizeBuildMetadataSegment('feature/fix bug#42!')).toBe('feature.fix-bug-42')
  })
})

describe('getGitBuildIdentity', () => {
  let repoDir

  beforeAll(() => {
    repoDir = mkdtempSync(path.join(tmpdir(), 'orca-git-build-identity-'))
    const run = (args) => execFileSync('git', args, { cwd: repoDir, stdio: 'ignore' })
    run(['init', '--initial-branch=chess22/version-identity'])
    run(['config', 'user.email', 'test@example.com'])
    run(['config', 'user.name', 'Test'])
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
      cwd: repoDir,
      stdio: 'ignore'
    })
  })

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true })
  })

  it('reads the branch and short commit hash from a real repo', () => {
    const identity = getGitBuildIdentity({}, repoDir)
    expect(identity.branch).toBe('chess22/version-identity')
    expect(identity.commitHash).toMatch(/^[0-9a-f]{8}$/)
    expect(identity.versionMetadata).toBe(`chess22.version-identity.${identity.commitHash}`)
  })

  it('prefers CI branch env vars over a detached HEAD', () => {
    const commitHash = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf8'
    }).trim()
    execFileSync('git', ['checkout', '--detach', 'HEAD'], { cwd: repoDir, stdio: 'ignore' })

    const identity = getGitBuildIdentity({ GITHUB_HEAD_REF: 'nwparker/dev-indicator' }, repoDir)
    expect(identity.branch).toBe('nwparker/dev-indicator')
    expect(identity.versionMetadata).toBe(`nwparker.dev-indicator.${commitHash}`)
  })

  // Regression for AUDIT-REPORT.md C-2: GitLab CI runners check out a
  // detached HEAD, so without CI_COMMIT_REF_NAME support the branch (and the
  // version's build metadata) silently degraded to the commit hash alone.
  it('resolves the branch on a GitLab CI detached HEAD', () => {
    const commitHash = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf8'
    }).trim()
    execFileSync('git', ['checkout', '--detach', 'HEAD'], { cwd: repoDir, stdio: 'ignore' })

    const identity = getGitBuildIdentity(
      { CI_COMMIT_REF_NAME: 'chess22/version-identity' },
      repoDir
    )
    expect(identity.branch).toBe('chess22/version-identity')
    expect(identity.versionMetadata).toBe(`chess22.version-identity.${commitHash}`)
  })

  it('falls back to the commit hash alone when no branch can be resolved', () => {
    execFileSync('git', ['checkout', '--detach', 'HEAD'], { cwd: repoDir, stdio: 'ignore' })

    const identity = getGitBuildIdentity({}, repoDir)
    expect(identity.branch).toBeNull()
    expect(identity.versionMetadata).toBe(identity.commitHash)
  })

  it('returns nulls without throwing outside a git repository', () => {
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'orca-not-a-repo-'))
    try {
      const identity = getGitBuildIdentity({}, outsideDir)
      expect(identity).toEqual({ branch: null, commitHash: null, versionMetadata: null })
    } finally {
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })
})
