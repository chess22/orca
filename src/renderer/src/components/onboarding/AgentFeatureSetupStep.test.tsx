import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentFeatureSetupStep } from './AgentFeatureSetupStep'

const mocks = vi.hoisted(() => ({
  terminalProps: [] as { onTerminalExit?: () => void }[]
}))

vi.mock('./FeatureSetupInlineTerminal', () => ({
  FeatureSetupInlineTerminal: (props: { onTerminalExit?: () => void }) => {
    mocks.terminalProps.push(props)
    return <div>terminal</div>
  }
}))

describe('AgentFeatureSetupStep', () => {
  it('renders the agent feature setup checklist', () => {
    const html = renderToStaticMarkup(
      <AgentFeatureSetupStep
        featureSetup={{
          browserUse: true,
          computerUse: true,
          orchestration: true,
          linearTickets: false
        }}
        onFeatureSetupChange={vi.fn()}
        featureSetupCommand={null}
        featureSetupCommandSelection={null}
        setupBusyLabel={null}
        onStartFeatureSetup={vi.fn()}
      />
    )

    expect(html).toContain('Agent Browser Use')
    expect(html).toContain('Computer Use')
    expect(html).toContain('Agent Orchestration')
    expect(html).toContain('Linear agent skill')
    expect(html).toContain('Enable capabilities')
    expect(html).toContain('role="checkbox"')
  })

  it('passes terminal exit through for scoped install refreshes', () => {
    mocks.terminalProps.length = 0
    const onTerminalExit = vi.fn()

    renderToStaticMarkup(
      <AgentFeatureSetupStep
        featureSetup={{
          browserUse: true,
          computerUse: true,
          orchestration: true,
          linearTickets: false
        }}
        onFeatureSetupChange={vi.fn()}
        featureSetupCommand="npx skills add"
        featureSetupCommandSelection={null}
        setupBusyLabel={null}
        onStartFeatureSetup={vi.fn()}
        onTerminalExit={onTerminalExit}
      />
    )

    mocks.terminalProps.at(-1)?.onTerminalExit?.()

    expect(onTerminalExit).toHaveBeenCalledTimes(1)
  })
})
