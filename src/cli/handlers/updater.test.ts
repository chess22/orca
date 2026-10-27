import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClientError } from '../runtime-client'
import type { HandlerContext } from '../dispatch'
import { UPDATER_HANDLERS } from './updater'
import { UPDATER_LOCAL_BUILD_INSTALL_RUNTIME_CAPABILITY } from '../../shared/updater-runtime-capabilities'

const snapshot = {
  operationId: 'operation-1',
  manifestPath: '/tmp/release/latest-mac.yml',
  expectedManifestSha256: 'a'.repeat(64),
  expectedArtifactSha256: 'b'.repeat(64),
  current: { phase: 'checking', at: 1 },
  transitions: [{ phase: 'checking', at: 1 }]
} as const

function context(flags: [string, string | boolean][] = [], remote = false) {
  const client = {
    isRemote: remote,
    call: vi.fn().mockImplementation((method: string) =>
      Promise.resolve({
        ok: true,
        result:
          method === 'status.get'
            ? { capabilities: [UPDATER_LOCAL_BUILD_INSTALL_RUNTIME_CAPABILITY] }
            : snapshot
      })
    )
  }
  return {
    flags: new Map(flags),
    client,
    cwd: '/tmp',
    json: true
  } as unknown as HandlerContext & { client: typeof client }
}

describe('local build updater CLI', () => {
  beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}))

  it('passes the exact manifest and both required digests to start', async () => {
    const ctx = context([
      ['manifest', snapshot.manifestPath],
      ['manifest-sha256', snapshot.expectedManifestSha256],
      ['artifact-sha256', snapshot.expectedArtifactSha256]
    ])
    await UPDATER_HANDLERS['updater local-build start'](ctx)
    expect(ctx.client.call).toHaveBeenNthCalledWith(1, 'status.get')
    expect(ctx.client.call).toHaveBeenNthCalledWith(2, 'updater.localBuild.start', {
      manifestPath: snapshot.manifestPath,
      expectedManifestSha256: snapshot.expectedManifestSha256,
      expectedArtifactSha256: snapshot.expectedArtifactSha256
    })
  })

  it('requires every identity flag', async () => {
    const ctx = context([['manifest', snapshot.manifestPath]])
    await expect(UPDATER_HANDLERS['updater local-build start'](ctx)).rejects.toThrow(
      'Missing required --manifest-sha256'
    )
    expect(ctx.client.call).not.toHaveBeenCalled()
  })

  it('uses the read-only get method', async () => {
    const ctx = context()
    await UPDATER_HANDLERS['updater local-build get'](ctx)
    expect(ctx.client.call).toHaveBeenNthCalledWith(1, 'status.get')
    expect(ctx.client.call).toHaveBeenNthCalledWith(2, 'updater.localBuild.get')
  })

  it('refuses a remote client before RPC', async () => {
    const ctx = context([], true)
    const error = await UPDATER_HANDLERS['updater local-build get'](ctx).catch((value) => value)
    expect(error).toBeInstanceOf(RuntimeClientError)
    expect(error.code).toBe('local_runtime_required')
    expect(ctx.client.call).not.toHaveBeenCalled()
  })

  it('refuses an older runtime before sending an updater RPC', async () => {
    const ctx = context([
      ['manifest', snapshot.manifestPath],
      ['manifest-sha256', snapshot.expectedManifestSha256],
      ['artifact-sha256', snapshot.expectedArtifactSha256]
    ])
    ctx.client.call.mockResolvedValueOnce({ ok: true, result: { capabilities: [] } })

    const error = await UPDATER_HANDLERS['updater local-build start'](ctx).catch((value) => value)
    expect(error).toBeInstanceOf(RuntimeClientError)
    expect(error.code).toBe('runtime_capability_missing')
    expect(ctx.client.call).toHaveBeenCalledTimes(1)
    expect(ctx.client.call).toHaveBeenCalledWith('status.get')
  })
})
