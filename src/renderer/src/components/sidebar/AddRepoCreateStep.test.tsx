import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from '@/components/ui/dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CreateStep } from './AddRepoCreateStep'
import type { GitAvailability, RepoKind } from './create-project-defaults'

function renderCreateStep({
  createKind = 'git',
  gitAvailability = 'available',
  createParent = '/Users/alice/orca/projects'
}: {
  createKind?: RepoKind
  gitAvailability?: GitAvailability
  createParent?: string
} = {}): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <Dialog open>
        <CreateStep
          createName=""
          createParent={createParent}
          createKind={createKind}
          createError={null}
          isCreating={false}
          defaultParent="/Users/alice/orca/projects"
          gitAvailability={gitAvailability}
          runtimeParentStatus="idle"
          onNameChange={vi.fn()}
          onParentChange={vi.fn()}
          onKindChange={vi.fn()}
          onPickParent={vi.fn()}
          onCreate={vi.fn()}
        />
      </Dialog>
    </TooltipProvider>
  )
}

describe('CreateStep', () => {
  it('renders the name-first create UI with advanced controls collapsed', () => {
    const html = renderCreateStep()

    expect(html).toContain('Create a new project')
    expect(html).toContain('Name')
    expect(html).toContain('Git repository in ~/orca/projects')
    expect(html).toContain('Advanced settings')
    expect(html).not.toContain('Location</span>')
    expect(html).not.toContain('aria-label="Browse server filesystem"')
  })

  it('shows the Git fallback explanation in the collapsed summary', () => {
    const html = renderCreateStep({ createKind: 'folder', gitAvailability: 'unavailable' })

    expect(html).toContain('Folder in ~/orca/projects')
    expect(html).toContain('Git isn&#x27;t installed, so a plain folder is the default.')
  })
})
