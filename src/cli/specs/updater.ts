import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const LOCAL_ONLY_NOTE =
  'Runs only against the Orca desktop on this Mac; paired and managed remote runtimes are refused.'

export const UPDATER_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['updater', 'local-build', 'start'],
    summary: 'Verify, stage, install and relaunch an exact local macOS build',
    usage:
      'orca updater local-build start --manifest <latest-mac.yml> --manifest-sha256 <sha256> --artifact-sha256 <sha256> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'manifest', 'manifest-sha256', 'artifact-sha256'],
    notes: [
      'All three build identity flags are required. The same command accepts an older verified manifest for rollback.',
      LOCAL_ONLY_NOTE
    ]
  },
  {
    path: ['updater', 'local-build', 'get'],
    summary: 'Show the current local build install state',
    usage: 'orca updater local-build get [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [LOCAL_ONLY_NOTE]
  }
]
