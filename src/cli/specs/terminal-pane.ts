import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const TERMINAL_PANE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['terminal', 'split'],
    summary: 'Split an existing terminal pane',
    usage:
      'orca terminal split [--terminal <handle>] [--direction horizontal|vertical] [--command <text>] [--ratio <0-1>] [--size-px <px>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal', 'direction', 'command', 'ratio', 'size-px'],
    notes: [
      '--ratio sets the new pane’s share of the split axis (e.g. 0.3 = 30%); --size-px sets its size in pixels (width for vertical splits, height for horizontal). Pass at most one.'
    ],
    examples: [
      'orca terminal split --terminal term_abc123 --direction horizontal --json',
      'orca terminal split --terminal term_abc123 --command "codex"',
      'orca terminal split --terminal term_abc123 --direction vertical --ratio 0.3'
    ]
  },
  {
    path: ['terminal', 'resize'],
    summary: 'Change an existing terminal pane’s split ratio',
    usage: 'orca terminal resize --terminal <handle> (--ratio <0-1> | --size-px <px>) [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal', 'ratio', 'size-px'],
    notes: [
      '--ratio sets the target pane’s share of the space divided with its sibling; --size-px sets its width for vertical splits or height for horizontal splits.'
    ],
    examples: [
      'orca terminal resize --terminal term_abc123 --ratio 0.3 --json',
      'orca terminal resize --terminal term_abc123 --size-px 480'
    ]
  }
]
