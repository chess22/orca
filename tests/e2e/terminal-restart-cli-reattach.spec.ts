import { existsSync, readFileSync } from 'node:fs'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { RuntimeClient } from '../../src/cli/runtime-client'

type TerminalRead = {
  handle: string
  status: string
  tail: string[]
  nextCursor: string
}

async function callTerminal<TResult>(
  client: RuntimeClient,
  method: string,
  params: Record<string, unknown>
): Promise<TResult> {
  return (await client.call<TResult>(method, params)).result
}

test.describe('Terminal restart CLI reattach', () => {
  test('restored background session keeps snapshot, live output, and input', async (// oxlint-disable-next-line no-empty-pattern -- Playwright requires the fixture destructure before testInfo.
  {}, testInfo) => {
    test.skip(process.platform === 'win32', 'The periodic marker command requires a POSIX shell')
    const repoPath = readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim()
    if (!repoPath || !existsSync(repoPath)) {
      test.skip(true, 'Global setup did not produce a seeded test repo')
      return
    }

    const session = createRestartSession(testInfo)
    let firstApp: ElectronApplication | null = null
    let secondApp: ElectronApplication | null = null

    try {
      const firstLaunch = await session.launch()
      firstApp = firstLaunch.app
      const worktreeId = await attachRepoAndOpenTerminal(firstLaunch.page, repoPath)
      await waitForSessionReady(firstLaunch.page)
      await waitForActiveWorktree(firstLaunch.page)
      const client = new RuntimeClient(session.userDataDir)
      let runtimeWorktreeId: string | null = null
      await expect
        .poll(async () => {
          const result = await callTerminal<{
            worktrees: { id: string; path: string }[]
          }>(client, 'worktree.list', { limit: 10_000 })
          runtimeWorktreeId =
            result.worktrees.find((worktree) => worktree.path === repoPath)?.id ?? null
          return runtimeWorktreeId
        })
        .not.toBeNull()

      // Why: this terminal stays behind the active tab, reproducing the path
      // where no restored TerminalPane mounts to perform createOrAttach.
      const marker = `CLI_REATTACH_${Date.now()}`
      const created = await callTerminal<{
        terminal: { handle: string; ptyId: string; connected: boolean; writable: boolean }
      }>(client, 'terminal.create', {
        worktree: `id:${runtimeWorktreeId}`,
        command: `while true; do echo ${marker}; sleep 1; done &`,
        focus: false
      })
      const handle = created.terminal.handle
      const ptyId = created.terminal.ptyId

      await expect
        .poll(
          async () => {
            const read = await callTerminal<{ terminal: TerminalRead }>(client, 'terminal.read', {
              terminal: handle
            })
            return read.terminal.tail.some((line) => line.includes(marker))
          },
          { timeout: 10_000 }
        )
        .toBe(true)

      await session.close(firstApp)
      firstApp = null

      const secondLaunch = await session.launch()
      secondApp = secondLaunch.app
      await waitForSessionReady(secondLaunch.page)
      await expect
        .poll(() => secondLaunch.page.evaluate(() => window.__store?.getState().activeWorktreeId), {
          timeout: 10_000
        })
        .toBe(worktreeId)

      // Why: callers retain the pre-restart handle; read, send, and focus must
      // each work directly without a terminal.list refresh minting a new handle.
      let restored: { terminal: TerminalRead } | null = null
      await expect
        .poll(
          async () => {
            try {
              restored = await callTerminal<{ terminal: TerminalRead }>(client, 'terminal.read', {
                terminal: handle
              })
              return restored.terminal.status
            } catch {
              return 'stale'
            }
          },
          { timeout: 10_000, message: 'Old handle did not recover after runtime startup' }
        )
        .toBe('running')
      if (!restored) {
        throw new Error('Old handle recovery returned no terminal snapshot')
      }
      expect(restored.terminal.status).toBe('running')
      expect(restored.terminal.tail.some((line) => line.includes(marker))).toBe(true)

      const ping = `PING_${Date.now()}`
      await callTerminal(client, 'terminal.send', {
        terminal: handle,
        text: `echo ${ping}`,
        enter: true,
        client: { id: 'e2e-cli', type: 'desktop' }
      })
      const focused = await callTerminal<{
        focus: { handle: string; worktreeId: string }
      }>(client, 'terminal.focus', { terminal: handle })
      expect(focused.focus).toMatchObject({ handle, worktreeId: runtimeWorktreeId })

      const listed = await callTerminal<{
        terminals: {
          handle: string
          ptyId: string | null
          connected: boolean
          writable: boolean
        }[]
      }>(client, 'terminal.list', {})
      const restoredTerminal = listed.terminals.find((terminal) => terminal.ptyId === ptyId)
      expect(restoredTerminal).toMatchObject({ connected: true, writable: true })
      if (!restoredTerminal) {
        throw new Error(`Restored PTY ${ptyId} was absent from terminal.list`)
      }
      const restoredHandle = restoredTerminal.handle

      await expect
        .poll(
          async () => {
            const live = await callTerminal<{ terminal: TerminalRead }>(client, 'terminal.read', {
              terminal: restoredHandle,
              cursor: Number(restored.terminal.nextCursor)
            })
            return live.terminal.tail.some((line) => line.includes(marker))
          },
          {
            timeout: 6_000,
            message: 'Surviving daemon PTY did not stream new output after relaunch'
          }
        )
        .toBe(true)

      await expect
        .poll(
          async () => {
            const read = await callTerminal<{ terminal: TerminalRead }>(client, 'terminal.read', {
              terminal: restoredHandle
            })
            return read.terminal.tail.some((line) => line.trim() === ping)
          },
          { timeout: 6_000, message: 'Input sent after relaunch did not produce shell output' }
        )
        .toBe(true)

      const shown = await callTerminal<{
        terminal: { connected: boolean; writable: boolean; ptyId: string | null }
      }>(client, 'terminal.show', { terminal: restoredHandle })
      expect(shown.terminal).toMatchObject({
        connected: true,
        writable: true,
        ptyId: expect.any(String)
      })
    } finally {
      if (secondApp) {
        await session.close(secondApp)
      }
      if (firstApp) {
        await session.close(firstApp)
      }
      await session.dispose()
    }
  })
})
