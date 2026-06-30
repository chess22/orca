import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { FeatureSetupInlineTerminal } from './FeatureSetupInlineTerminal'

const mocks = vi.hoisted(() => ({
  terminalProps: [] as { onTerminalExit?: () => void }[]
}))

vi.mock('@/lib/telemetry', () => ({
  track: vi.fn()
}))

vi.mock('./OnboardingInlineCommandTerminal', () => ({
  OnboardingInlineCommandTerminal: (props: { onTerminalExit?: () => void }) => {
    mocks.terminalProps.push(props)
    return <div data-testid="inline-command-terminal" />
  }
}))

describe('FeatureSetupInlineTerminal', () => {
  it('passes terminal exit through for scoped install status refreshes', () => {
    const onTerminalExit = vi.fn()

    renderToStaticMarkup(
      <FeatureSetupInlineTerminal
        command="npx skills add example --global"
        onTerminalExit={onTerminalExit}
        selection={{
          browserUse: true,
          computerUse: false,
          orchestration: false,
          linearTickets: false
        }}
      />
    )

    mocks.terminalProps.at(-1)?.onTerminalExit?.()

    expect(onTerminalExit).toHaveBeenCalledTimes(1)
  })
})
