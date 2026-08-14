import { afterEach, describe, expect, it, vi } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { GitRemoteIdentity } from '../shared/git-remote-identity'
import type { Repo } from '../shared/types'
import { resetMacosProtectedFolderGitStartupForTests } from './git/macos-protected-folder-git-access'
import { detectGitRemoteIdentity } from './repo-git-remote-identity'
import {
  enrichMissingRepoGitRemoteIdentities,
  flushRepoGitRemoteIdentityEnrichmentForTests,
  resetRepoGitRemoteIdentityEnrichmentForTests
} from './repo-git-remote-identity-enrichment'

vi.mock('./repo-git-remote-identity', () => ({
  detectGitRemoteIdentity: vi.fn()
}))

type RepoIdentityStore = {
  getRepos: () => Repo[]
  getRepo: (id: string) => Repo | undefined
  updateRepo: (id: string, updates: Pick<Partial<Repo>, 'gitRemoteIdentity'>) => Repo | null
}

const remoteIdentity: GitRemoteIdentity = {
  canonicalKey: 'git.company.test/team/sample-app',
  remoteName: 'origin',
  remoteUrl: 'git@git.company.test:team/sample-app.git'
}

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/workspace/sample-app',
    displayName: 'sample-app',
    badgeColor: '#737373',
    addedAt: 1,
    kind: 'git',
    ...overrides
  }
}

function makeStore(repoOrRepos: Repo | Repo[]): RepoIdentityStore & {
  updateRepo: ReturnType<typeof vi.fn>
} {
  const repos = Array.isArray(repoOrRepos) ? repoOrRepos : [repoOrRepos]
  return {
    getRepos: () => repos,
    getRepo: (id) => repos.find((candidate) => candidate.id === id),
    updateRepo: vi.fn((id, updates) => {
      const target = repos.find((candidate) => candidate.id === id)
      if (!target) {
        return null
      }
      Object.assign(target, updates)
      return target
    })
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  resetRepoGitRemoteIdentityEnrichmentForTests()
  resetMacosProtectedFolderGitStartupForTests()
})

describe('enrichMissingRepoGitRemoteIdentities', () => {
  it('defers protected local repos without populating the negative cache', async () => {
    const platform = process.platform
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    try {
      vi.mocked(detectGitRemoteIdentity).mockResolvedValueOnce(remoteIdentity)
      const protectedPath = join(homedir(), 'Documents', 'protected-repo')
      const regularPath = join(homedir(), 'src', 'regular-repo')
      const protectedRepo = makeRepo({ id: 'protected', path: protectedPath })
      const regularRepo = makeRepo({ id: 'regular', path: regularPath })
      const store = makeStore([protectedRepo, regularRepo])

      enrichMissingRepoGitRemoteIdentities(store)
      await flushRepoGitRemoteIdentityEnrichmentForTests()

      expect(detectGitRemoteIdentity).toHaveBeenCalledOnce()
      expect(detectGitRemoteIdentity).toHaveBeenCalledWith(regularPath, undefined)
      expect(protectedRepo.gitRemoteIdentity).toBeUndefined()

      enrichMissingRepoGitRemoteIdentities(store)
      await flushRepoGitRemoteIdentityEnrichmentForTests()

      expect(detectGitRemoteIdentity).toHaveBeenCalledOnce()
      expect(protectedRepo.gitRemoteIdentity).toBeUndefined()
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: platform })
    }
  })

  it('schedules remote identity enrichment without blocking the caller', async () => {
    vi.mocked(detectGitRemoteIdentity).mockResolvedValue(remoteIdentity)
    const repo = makeRepo()
    const store = makeStore(repo)
    const onChanged = vi.fn()

    enrichMissingRepoGitRemoteIdentities(store, { onChanged })

    expect(repo.gitRemoteIdentity).toBeUndefined()
    expect(detectGitRemoteIdentity).toHaveBeenCalledWith('/workspace/sample-app', undefined)

    await flushRepoGitRemoteIdentityEnrichmentForTests()

    expect(repo.gitRemoteIdentity).toEqual(remoteIdentity)
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent probes for the same repo location', async () => {
    const probe = deferred<GitRemoteIdentity | null>()
    vi.mocked(detectGitRemoteIdentity).mockReturnValue(probe.promise)
    const repo = makeRepo()
    const store = makeStore(repo)

    enrichMissingRepoGitRemoteIdentities(store)
    enrichMissingRepoGitRemoteIdentities(store)

    expect(detectGitRemoteIdentity).toHaveBeenCalledTimes(1)

    probe.resolve(remoteIdentity)
    await flushRepoGitRemoteIdentityEnrichmentForTests()

    expect(store.updateRepo).toHaveBeenCalledTimes(1)
    expect(repo.gitRemoteIdentity).toEqual(remoteIdentity)
  })

  it('caches no-identity probes briefly so list calls do not retry every time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    vi.mocked(detectGitRemoteIdentity).mockResolvedValue(null)
    const repo = makeRepo()
    const store = makeStore(repo)

    enrichMissingRepoGitRemoteIdentities(store)
    await flushRepoGitRemoteIdentityEnrichmentForTests()
    enrichMissingRepoGitRemoteIdentities(store)
    await flushRepoGitRemoteIdentityEnrichmentForTests()

    expect(detectGitRemoteIdentity).toHaveBeenCalledTimes(1)
  })

  it('does not write stale identity data after the repo path changes', async () => {
    const probe = deferred<GitRemoteIdentity | null>()
    vi.mocked(detectGitRemoteIdentity).mockReturnValue(probe.promise)
    const repo = makeRepo()
    const store = makeStore(repo)

    enrichMissingRepoGitRemoteIdentities(store)
    repo.path = '/workspace/renamed-sample-app'
    probe.resolve(remoteIdentity)
    await flushRepoGitRemoteIdentityEnrichmentForTests()

    expect(store.updateRepo).not.toHaveBeenCalled()
    expect(repo.gitRemoteIdentity).toBeUndefined()
  })
})
