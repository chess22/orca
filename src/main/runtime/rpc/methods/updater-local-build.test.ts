import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eraseRpcMethods } from '../core'
import { configureRemoteServerUpdater } from '../../remote-server-updater'

const updater = vi.hoisted(() => ({
  start: vi.fn(),
  get: vi.fn()
}))

import { UPDATER_METHODS } from './updater'

function method(name: string) {
  const found = eraseRpcMethods(UPDATER_METHODS).find((candidate) => candidate.name === name)
  if (!found) {
    throw new Error(`Missing method ${name}`)
  }
  return found
}

const request = {
  manifestPath: '/tmp/release/latest-mac.yml',
  expectedManifestSha256: 'a'.repeat(64),
  expectedArtifactSha256: 'b'.repeat(64)
}
const localContext = {
  caller: { kind: 'local-cli' as const },
  clientKind: undefined
} as never

describe('local build updater RPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configureRemoteServerUpdater({
      getSnapshot: vi.fn() as never,
      check: vi.fn() as never,
      download: vi.fn() as never,
      install: vi.fn() as never,
      startLocalBuildInstall: updater.start,
      getLocalBuildInstallStatus: updater.get
    })
  })

  it('requires host-admin and forwards every verified identity field', async () => {
    updater.start.mockResolvedValue({ operationId: 'operation-1' })
    const start = method('updater.localBuild.start')
    expect(start.permission).toBe('host-admin')
    await expect(start.handler(request, localContext)).resolves.toEqual({
      operationId: 'operation-1'
    })
    expect(updater.start).toHaveBeenCalledWith(request)
  })

  it('returns the current state through an authenticated local-only method', async () => {
    updater.get.mockReturnValue({ operationId: 'operation-1', current: { phase: 'staged' } })
    const get = method('updater.localBuild.get')
    expect(get.permission).toBe('host-admin')
    await expect(get.handler(undefined, localContext)).resolves.toMatchObject({
      operationId: 'operation-1'
    })
  })

  it.each([
    [
      'paired device',
      { caller: { kind: 'paired-device', deviceId: 'phone' }, clientKind: 'mobile' }
    ],
    ['remote runtime', { caller: { kind: 'local-cli' }, clientKind: 'runtime' }],
    ['unnamed caller', { caller: undefined, clientKind: undefined }]
  ])('fails closed for a %s', async (_label, context) => {
    await expect(
      method('updater.localBuild.start').handler(request, context as never)
    ).rejects.toThrow('only available to this Mac host')
    expect(updater.start).not.toHaveBeenCalled()
  })

  it('rejects a missing or malformed required hash before reaching the backend', () => {
    expect(
      method('updater.localBuild.start').params?.safeParse({
        ...request,
        expectedArtifactSha256: ''
      }).success
    ).toBe(false)
  })
})
