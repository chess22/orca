// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserAction } from './FeatureWallBrowserAction'

const INSTALL_COMMAND = 'npx skills add browser-use'

const mocks = vi.hoisted(() => ({
  featureSetupTerminalProps: [] as { onTerminalExit?: () => void }[],
  recordFeatureInteraction: vi.fn(),
  refreshBrowserSkill: vi.fn(),
  runOnboardingFeatureSetup: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    warning: mocks.toastWarning
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (
    selector: (state: {
      recordFeatureInteraction: typeof mocks.recordFeatureInteraction
    }) => unknown
  ) => selector({ recordFeatureInteraction: mocks.recordFeatureInteraction })
}))

vi.mock('@/hooks/useActiveProjectSkillRuntime', () => ({
  useActiveProjectSkillRuntime: () => ({ discoveryTarget: undefined })
}))

vi.mock('@/hooks/useInstalledAgentSkills', () => ({
  GLOBAL_AGENT_SKILL_SOURCE_KINDS: ['home'],
  useInstalledAgentSkill: () => ({
    refresh: mocks.refreshBrowserSkill
  })
}))

vi.mock('../onboarding/onboarding-feature-setup', () => ({
  runOnboardingFeatureSetup: mocks.runOnboardingFeatureSetup
}))

vi.mock('../onboarding/FeatureSetupInlineTerminal', () => ({
  FeatureSetupInlineTerminal: (props: { command: string; onTerminalExit?: () => void }) => {
    mocks.featureSetupTerminalProps.push(props)
    return <div data-testid="feature-setup-terminal">{props.command}</div>
  }
}))

vi.mock('./FeatureWallSetupWorkflowActions', () => ({
  promptForSetupGuideProject: vi.fn(),
  useSetupTargetWorktree: () => null
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderBrowserAction(
  onBrowserUseSkillInstalledChange: (installed: boolean) => void
): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <BrowserAction
        done={false}
        onBrowserUseSkillInstalledChange={onBrowserUseSkillInstalledChange}
      />
    )
  })
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from((container ?? document.body).querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label
  )
  expect(button).toBeDefined()
  return button as HTMLButtonElement
}

describe('BrowserAction', () => {
  beforeEach(() => {
    mocks.featureSetupTerminalProps.length = 0
    mocks.recordFeatureInteraction.mockReset()
    mocks.refreshBrowserSkill.mockReset()
    mocks.refreshBrowserSkill.mockResolvedValue(true)
    mocks.runOnboardingFeatureSetup.mockReset()
    mocks.runOnboardingFeatureSetup.mockResolvedValue({
      skillInstallCommand: INSTALL_COMMAND,
      skillCommandsCopied: true,
      warnings: []
    })
    mocks.toastSuccess.mockReset()
    mocks.toastWarning.mockReset()
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
  })

  it('reports browser skill installation to the setup guide after the install terminal exits', async () => {
    const onBrowserUseSkillInstalledChange = vi.fn()
    await renderBrowserAction(onBrowserUseSkillInstalledChange)

    await act(async () => {
      findButton('Install CLI & Skill').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.featureSetupTerminalProps.at(-1)?.onTerminalExit).toBeDefined()

    await act(async () => {
      mocks.featureSetupTerminalProps.at(-1)?.onTerminalExit?.()
    })

    expect(mocks.refreshBrowserSkill).toHaveBeenCalledTimes(1)
    expect(onBrowserUseSkillInstalledChange).toHaveBeenCalledWith(true)
  })
})
