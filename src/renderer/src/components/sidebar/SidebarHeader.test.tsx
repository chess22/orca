import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import SidebarHeader from './SidebarHeader'

const mocks = vi.hoisted(() => ({
  state: {
    groupBy: 'repo',
    openModal: vi.fn(),
    repos: [{ id: 'repo-1' }]
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))

vi.mock('@/hooks/useShortcutLabel', () => ({
  useShortcutLabel: () => 'Ctrl+Shift+N'
}))

vi.mock('../contextual-tours/workspace-creation-tour-handoff', () => ({
  openWorkspaceCreationComposerWithTourHandoff: vi.fn()
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('./SidebarWorkspaceOptionsMenu', () => ({
  default: () => <button type="button">Options</button>
}))

describe('SidebarHeader', () => {
  it('keeps the top workspace create button hidden on touch layouts', () => {
    const markup = renderToStaticMarkup(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)

    expect(markup).toContain('aria-label="New workspace"')
    expect(markup).toContain('worktree-create-touch-hidden')
  })
})
