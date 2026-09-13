import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const PLANE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['plane', 'status'],
    summary: 'Show Plane runtime configuration status',
    usage: 'orca plane status [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['plane', 'list'],
    summary: 'List Plane work items',
    usage: 'orca plane list [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'limit']
  },
  {
    path: ['plane', 'issue'],
    summary: 'Retrieve a Plane work item',
    usage: 'orca plane issue <work-item-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'work-item-id'],
    positionalArgs: ['work-item-id']
  },
  {
    path: ['plane', 'create'],
    summary: 'Create a Plane work item',
    usage:
      'orca plane create --title <title> [--description-html <html>] [--state <id>] [--priority <value>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'title', 'description-html', 'state', 'priority']
  },
  {
    path: ['plane', 'update'],
    summary: 'Update Plane work item fields except state',
    usage:
      'orca plane update <work-item-id> [--title <title>] [--description-html <html>] [--priority <value>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'work-item-id', 'title', 'description-html', 'priority'],
    positionalArgs: ['work-item-id']
  },
  {
    path: ['plane', 'state', 'list'],
    summary: 'List Plane project states',
    usage: 'orca plane state list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['plane', 'state', 'set'],
    summary: 'Move a Plane work item through the guarded state boundary',
    usage: 'orca plane state set <work-item-id> --to <state-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'work-item-id', 'to'],
    positionalArgs: ['work-item-id']
  },
  {
    path: ['plane', 'comment', 'list'],
    summary: 'List Plane work item comments',
    usage: 'orca plane comment list <work-item-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'work-item-id'],
    positionalArgs: ['work-item-id']
  },
  {
    path: ['plane', 'comment', 'add'],
    summary: 'Add an internal Plane work item comment',
    usage: 'orca plane comment add <work-item-id> --body-html <html> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'work-item-id', 'body-html'],
    positionalArgs: ['work-item-id']
  }
]
