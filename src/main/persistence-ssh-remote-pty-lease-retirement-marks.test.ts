import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getDefaultPersistedState } from '../shared/constants'
import { sshRemotePtyLeaseAllowsReattach } from '../shared/ssh-types'
import { closeTestStores, createStore, testState, writeDataFile } from './persistence-test-harness'

const { loadUserSshConfigMock, sshConfigHostsToTargetsMock } = vi.hoisted(() => ({
  loadUserSshConfigMock: vi.fn(),
  sshConfigHostsToTargetsMock: vi.fn()
}))

vi.mock('./ssh/config/ssh-config-parser', () => ({
  loadUserSshConfig: loadUserSshConfigMock,
  sshConfigHostsToTargets: sshConfigHostsToTargetsMock
}))

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => {
      const decoded = ciphertext.toString('utf-8')
      if (!decoded.startsWith('encrypted:')) {
        throw new Error('invalid ciphertext')
      }
      return decoded.slice('encrypted:'.length)
    }
  }
}))

// Round-trip retirement marks through the strict loader; older rows omit them and older builds ignore them.
describe('ssh remote pty lease route-retirement marks survive the disk round trip', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
  })
  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  function persistLeases(leases: unknown[]): void {
    const persisted = getDefaultPersistedState(testState.dir)
    writeDataFile({ ...persisted, sshRemotePtyLeases: leases })
  }

  it('salvages both marks rather than stripping them', async () => {
    persistLeases([
      {
        targetId: 'ssh-1',
        ptyId: 'pty-1',
        state: 'expired',
        createdAt: 1,
        updatedAt: 2,
        supersededBy: 'pty-2'
      },
      {
        targetId: 'ssh-1',
        ptyId: 'pty-3',
        state: 'expired',
        createdAt: 1,
        updatedAt: 2,
        relayIdRecycled: true
      }
    ])

    const store = await createStore()

    expect(store.getSshRemotePtyLeases('ssh-1')).toEqual([
      expect.objectContaining({ ptyId: 'pty-1', supersededBy: 'pty-2' }),
      expect.objectContaining({ ptyId: 'pty-3', relayIdRecycled: true })
    ])
    expect(store.getSshRemotePtyLeases('ssh-1').filter(sshRemotePtyLeaseAllowsReattach)).toEqual([])
  })

  // Missing retirement marks on older rows must preserve reattachability.
  it('reads a row written before the marks existed as a reattachable orphan', async () => {
    persistLeases([
      { targetId: 'ssh-1', ptyId: 'pty-1', state: 'expired', createdAt: 1, updatedAt: 2 }
    ])

    const store = await createStore()
    const [lease] = store.getSshRemotePtyLeases('ssh-1')

    expect(lease).toMatchObject({ ptyId: 'pty-1', state: 'expired' })
    expect(lease.supersededBy).toBeUndefined()
    expect(lease.relayIdRecycled).toBeUndefined()
    expect(sshRemotePtyLeaseAllowsReattach(lease)).toBe(true)
  })

  it('drops a mistyped mark instead of trusting it', async () => {
    persistLeases([
      {
        targetId: 'ssh-1',
        ptyId: 'pty-1',
        state: 'expired',
        createdAt: 1,
        updatedAt: 2,
        supersededBy: 7,
        relayIdRecycled: 'yes'
      }
    ])

    const store = await createStore()
    const [lease] = store.getSshRemotePtyLeases('ssh-1')

    expect(lease.supersededBy).toBeUndefined()
    expect(lease.relayIdRecycled).toBeUndefined()
  })
})
