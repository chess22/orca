import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

type SeededDiffFile = {
  absolutePath: string
  relativePath: string
  worktreePath: string
}

async function seedModifiedTypeScriptFile(
  page: Parameters<typeof waitForSessionReady>[0],
  worktreeId: string
): Promise<SeededDiffFile> {
  return page.evaluate(async (wId) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const worktree = Object.values(store.getState().worktreesByRepo)
      .flat()
      .find((entry) => entry.id === wId)
    if (!worktree) {
      throw new Error(`worktree not found: ${wId}`)
    }

    const separator = worktree.path.includes('\\') ? '\\' : '/'
    const relativePath = `src${separator}pierre-renderer-check-${Date.now()}.ts`
    const absolutePath = `${worktree.path}${separator}${relativePath}`
    await window.api.fs.writeFile({
      filePath: absolutePath,
      content: [
        'export const renderer = "monaco";',
        'export const keepsComments = false;',
        ''
      ].join('\n')
    })
    await window.api.git.stage({ worktreePath: worktree.path, filePath: relativePath })
    await window.api.git.commit({
      worktreePath: worktree.path,
      message: 'Add renderer fixture for E2E'
    })
    await window.api.fs.writeFile({
      filePath: absolutePath,
      content: [
        'export const renderer = "pierre";',
        'export const keepsComments = true;',
        'export const changedLine = 3;',
        ''
      ].join('\n')
    })

    return { absolutePath, relativePath, worktreePath: worktree.path }
  }, worktreeId)
}

async function waitForPierreDiffLines(page: Parameters<typeof waitForSessionReady>[0]) {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('[data-diff-renderer="pierre"]')).some((diffRoot) => {
        const rect = diffRoot.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) {
          return false
        }
        return Array.from(diffRoot.querySelectorAll('diffs-container')).some((host) =>
          host.shadowRoot?.querySelector('[data-line]')
        )
      }),
    null,
    { timeout: 20_000 }
  )
}

test.describe('Diff viewer renderer', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('uses Pierre for read-only diffs while preserving Monaco for editable diffs', async ({
    orcaPage
  }) => {
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const seededFile = await seedModifiedTypeScriptFile(orcaPage, worktreeId)

    await orcaPage.evaluate(
      ({ wId, absolutePath, relativePath }) => {
        window.__store?.getState().openDiff(wId, absolutePath, relativePath, 'typescript', false)
      },
      {
        wId: worktreeId,
        absolutePath: seededFile.absolutePath,
        relativePath: seededFile.relativePath
      }
    )

    await expect(orcaPage.locator('.monaco-diff-editor').first()).toBeVisible({ timeout: 20_000 })
    await expect(orcaPage.locator('[data-diff-renderer="pierre"]')).toHaveCount(0)

    await orcaPage.evaluate(
      async ({ worktreePath, relativePath }) => {
        await window.api.git.stage({ worktreePath, filePath: relativePath })
      },
      { worktreePath: seededFile.worktreePath, relativePath: seededFile.relativePath }
    )

    const noteResult = await orcaPage.evaluate(
      async ({ wId, relativePath }) => {
        return window.__store?.getState().addDiffComment({
          worktreeId: wId,
          filePath: relativePath,
          lineNumber: 2,
          body: 'comment rendered through Pierre',
          side: 'modified'
        })
      },
      { wId: worktreeId, relativePath: seededFile.relativePath }
    )
    expect(noteResult, 'expected addDiffComment to persist a staged diff note').not.toBeNull()

    await orcaPage.evaluate(
      ({ wId, absolutePath, relativePath }) => {
        window.__store?.getState().openDiff(wId, absolutePath, relativePath, 'typescript', true)
      },
      {
        wId: worktreeId,
        absolutePath: seededFile.absolutePath,
        relativePath: seededFile.relativePath
      }
    )

    const pierreDiff = orcaPage.locator('[data-diff-renderer="pierre"]').first()
    await expect(pierreDiff).toBeVisible({ timeout: 20_000 })
    await waitForPierreDiffLines(orcaPage)

    const card = orcaPage
      .locator('.orca-diff-comment-card')
      .filter({ has: orcaPage.locator('.orca-diff-comment-body') })
      .first()
    await expect(card, 'staged diff note should render on the Pierre annotation path').toBeVisible()
    await expect(card.locator('.orca-diff-comment-body')).toHaveText(
      'comment rendered through Pierre'
    )

    await orcaPage.evaluate(
      async ({ wId, worktreePath }) => {
        const status = await window.api.git.status({ worktreePath })
        window.__store?.getState().setGitStatus(wId, status)
        window.__store?.getState().openAllDiffs(wId, worktreePath, undefined, 'staged')
      },
      { wId: worktreeId, worktreePath: seededFile.worktreePath }
    )

    await expect(orcaPage.getByText('1 changed files')).toBeVisible({ timeout: 20_000 })
    await expect(orcaPage.locator('[data-diff-renderer="pierre"]:visible').first()).toBeVisible({
      timeout: 20_000
    })
    await waitForPierreDiffLines(orcaPage)
    await expect(orcaPage.locator('.monaco-diff-editor')).toHaveCount(0)
    const combinedCardBody = orcaPage
      .locator('.orca-diff-comment-card:visible .orca-diff-comment-body')
      .first()
    await expect(
      combinedCardBody,
      'combined staged diff should preserve Pierre annotations'
    ).toHaveText('comment rendered through Pierre')
  })
})
