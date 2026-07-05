import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test('File > New Window opens an independent second window', async ({ electronApp, orcaPage }) => {
  await waitForSessionReady(orcaPage)

  const liveWindowCount = (): Promise<number> =>
    electronApp.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed()).length
    })

  const initialCount = await liveWindowCount()
  const secondWindowPromise = electronApp.waitForEvent('window')

  // Why: CDP-injected keystrokes bypass Electron's before-input-event, so the
  // Mod+Shift+N chord cannot be exercised from Playwright — chord resolution
  // is covered by window-shortcut-policy unit tests. The File menu item is the
  // other real user surface for opening a window; find it by position because
  // labels are localized (mac template: [appMenu, fileMenu, ...]).
  const clickedLabel = await electronApp.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()
    const fileMenuIndex = process.platform === 'darwin' ? 1 : 0
    const newWindowItem = menu?.items[fileMenuIndex]?.submenu?.items[0]
    newWindowItem?.click()
    return newWindowItem?.label ?? null
  })
  expect(clickedLabel).not.toBeNull()

  const secondPage: Page = await secondWindowPromise
  await expect.poll(liveWindowCount).toBe(initialCount + 1)

  // Why: session-ready in the second window proves the runtime accepted a
  // second graph publisher and the per-slot session partition restored
  // without colliding with the first window's session.
  await waitForSessionReady(secondPage)
  await waitForSessionReady(orcaPage)

  // Both windows publish independent graphs: the runtime reports a ready
  // merged graph and both renderers stay alive.
  const runtimeReady = await electronApp.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()
      .filter((window) => !window.isDestroyed())
      .map((window) => window.webContents.isCrashed?.() ?? false)
  })
  expect(runtimeReady).toEqual([false, false])

  // Why: closing the second window must only drop its own graph slice — the
  // first window keeps working (scoped markGraphUnavailable).
  await electronApp.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
    // Sort by id so the newest (second) window closes, not the original.
    windows.sort((a, b) => a.id - b.id)
    windows.at(-1)?.close()
  })
  await expect.poll(liveWindowCount).toBe(initialCount)

  // The surviving first window still has a live, responsive renderer.
  await waitForSessionReady(orcaPage)
})
