# Agent Skill Auto-Update Design

## Summary

Orca should keep Orca-managed agent skills current when a user or agent enters a workflow that needs the skill. The update should be automatic only when Orca can prove it is updating the same tracked install the user already has. When Orca cannot prove that but has a safe manual install/update command, the same workflow trigger should show a contextual setup/update modal instead.

Settings must not trigger background skill updates. Settings may continue to show status and manual controls.

Automatic managed-skill updates are enabled by default. Users can turn them off from the Agents settings pane; when disabled, Orca still uses the same workflow triggers, but stale global managed-skill updates fall back to the contextual manual update modal instead of running in the background.

## Goals

- Avoid sending users to Settings -> CLI for routine skill maintenance.
- Keep managed Orca skills current at the moment they are actually needed.
- Avoid surprising writes to user-managed, project-managed, remote, or ambiguous skill installs.
- Avoid repeated subprocess/network work when many agents attempt the same skill.
- Explain any modal in the context that caused it, especially when an agent triggered the need.

## Non-Goals

- Do not build a generic updater for every skill on the Skills page.
- Do not silently update bundled, plugin, hand-copied, local-path, or user-authored skills.
- Do not run broad skill checks at app startup.
- Do not infer update scope from Orca's current working directory.

## Managed Skills

Initial support is limited to Orca-owned feature skills:

- `linear-tickets`
- `orchestration`
- `computer-use`
- `orca-cli`

## Core UX Rule

Auto-update and ask prompts have the same trigger.

```text
User or agent enters a workflow that needs a managed skill
-> coordinator checks whether background update is safe
-> if safe, update in the background
-> if unsafe or update fails and Orca has a safe manual command, show the contextual modal
-> otherwise return fallback state without opening an unactionable modal
```

There is no separate "ask" trigger. Asking is the fallback path for the same intent boundary.

The automatic-updates setting does not create a new trigger. It only controls whether an eligible stale global install may be updated quietly. If the setting is off, that same trigger shows the update modal each time an update is needed and Orca has the manual update command.

## Intent Boundary Triggers

| Skill | Trigger |
| --- | --- |
| `linear-tickets` | User starts a new worktree from a Linear task, or launches/continues an agent workflow attached to a Linear issue where agents are expected to read or update the issue. |
| `orchestration` | User starts an orchestration workflow, such as `/orchestration`, handoff, child-agent coordination, or an explicit orchestration enable/use action. |
| `computer-use` | User starts a Computer Use workflow, or an agent first attempts to invoke computer-use for the active task. |
| `orca-cli` | A workflow that depends on the Orca CLI skill starts, such as Browser Use, mobile emulator agent workflows, or another feature that explicitly needs Orca CLI affordances. |

Settings pages, setup guide status cards, and generic skill browsing should not trigger automatic updates. They can display status and manual actions.

The Agents settings pane exposes the default-on preference as "Allow verified Orca skill updates" with copy explaining that Orca can try managed agent skill updates in the background only when it has verified install metadata and a safe update path. Turning it off means updates are reviewed manually at the same workflow boundaries.

## Modal Copy Requirements

When the fallback modal is shown because an agent attempted a skill, the modal must say that.

Examples:

- "An agent just tried to use Orca orchestration. Orca needs to update the orchestration skill before agents can coordinate reliably."
- "An agent tried to use Orca's CLI skill for this workflow. Orca can update it now, or you can run the command manually."
- "This Linear task workflow needs the Linear agent skill. Orca could not update it automatically."

The modal should show the exact command Orca would run or wanted the user to run.

## Safety Model

Orca must not choose scope from preference or cwd. It must choose scope from the existing install.

Auto-update is eligible only when all checks pass:

1. The skill is one of the managed Orca skills.
2. The workflow trigger requires that skill.
3. Discovery finds an existing install for the current runtime.
4. Discovery identifies a concrete runtime target: host or a specific WSL distro.
5. Discovery identifies a concrete scope:
   - `home` means global/user scope.
   - `repo` means project scope.
6. The matching lock file contains an entry for the skill.
7. The lock entry has enough update metadata for the `skills` CLI to update non-interactively.
8. The source is expected to be updateable without interactive auth.
9. The active project runtime is not repair-required.
10. The coordinator has not recorded a recent failed attempt for the same skill/runtime/scope.

For the first version, auto-update should be limited to tracked global installs. Project-scoped installs should use the same trigger and return a non-emitted fallback until project-scope behavior and a safe manual command are proven.

## Scope Resolution

Do not run:

```bash
npx skills update -y
```

Plain `-y` skips prompts and lets the `skills` CLI infer project vs global scope from cwd. That is not safe for background maintenance.

For global installs, run an explicit global command:

```bash
npx --yes skills update <skill> --global --yes
```

For future project support, run an explicit project command from the project root:

```bash
npx --yes skills update <skill> --project --yes
```

For WSL, wrap the explicit command with the selected WSL distro command path used by the existing setup UI.

Symlinks should be resolved with `realpath` for dedupe, but symlink targets must not override visible scope. A skill visible under a global home root remains global. A skill visible under a repo root remains project-scoped.

## Coordinator Design

Add one central managed-skill update coordinator in the main process.

The coordinator key is:

```text
skillName + runtime + distro + scope
```

Responsibilities:

- Read discovery results and lock metadata.
- Decide whether auto-update is eligible.
- Serialize update attempts per key.
- Deduplicate in-flight checks and updates.
- Cache success for the current app version/session.
- Store failure cooldowns.
- Refresh skill discovery after success.
- Return fallback information when auto-update is unsafe or failed.

Renderer surfaces should not independently spawn update commands. They should call the coordinator and then either continue the workflow, show an actionable modal response that includes a manual command, or avoid interrupting for non-actionable fallback state.

## Performance Guardrails

The update path must be cheap when many agents are running.

- Do not check on every tool call or every render.
- Do not run one subprocess per agent.
- Do not run network/npm work repeatedly for the same skill/runtime/scope.
- Share one in-flight promise across all callers.
- Cache success for the current app version/session.
- Back off after failure.
- Prefer invalidating "needs check" after an Orca app update, then checking only at the next real workflow trigger.

Example:

```text
50 agents attempt orchestration
-> first attempt asks coordinator for orchestration:host:global
-> coordinator starts one update/check
-> other 49 attempts join the same in-flight result or use cached success/failure
```

## Invalidation

The default invalidation should be app-version based.

```text
Orca app updates
-> managed skill check state is invalidated
-> next workflow trigger for each skill/runtime/scope checks once
-> success is cached for the session/app version
```

This matches the likely reason managed Orca skills need updating: Orca changed what agents need.

Optional future invalidation:

- Manual "Re-check" or "Update" from Settings.
- Lockfile mtime changes.
- Skill directory mtime changes.
- A long TTL if managed skills are expected to change independently of app releases.

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Wrong scope gets updated | Never use cwd inference; require discovery scope plus matching lockfile; use explicit `--global` or `--project`. |
| User has both global and project installs | Treat as ambiguous unless the active workflow has a single proven scope; return non-emitted fallback until there is an actionable command. |
| User has custom/local/hand-copied skill | Require lock metadata; return fallback if missing or legacy and only emit UI when there is a safe manual command. |
| Copy-mode installs are recreated as symlinks by upstream CLI | Avoid auto-update unless install metadata is trusted; call this out only when the fallback/manual path is actionable. |
| Private repo or auth-gated source needs credentials | Do not auto-update when source/auth cannot be proven non-interactive; return non-emitted fallback unless Orca has a safe manual command. |
| WSL distro unavailable or project runtime repair-required | Return fallback state without opening a setup modal until WSL-specific guidance or commands are actionable. |
| SSH/remote filesystem update writes somewhere unexpected | Do not auto-update remote/SSH skills in v1. |
| Modal appears unexpectedly because an agent triggered it | Modal copy must name the triggering context: "An agent just tried to..." |
| 50 agents cause 50 checks | Central coordinator with in-flight dedupe, success cache, and failure cooldown. |
| User turns automatic updates off | Keep the same triggers, but return the manual update modal for stale global installs without cooling that disabled-path modal away. |
| Update command hangs or npm/network is slow | Add timeout, cancellation on app shutdown where possible, and emit a modal only when a manual command is available. |
| Upstream `skills` CLI lacks reliable dry-run status | Do not show stale status unless backed by coordinator evidence; use update command only after eligibility passes. |
| Supply-chain/source surprise | Limit to Orca-managed skill names and tracked lock entries; do not update arbitrary Skills page entries. |
| Update succeeds but running agents keep old skill context | Treat update as best effort for future invocations; do not restart or mutate already-running agent prompts. |

## User Flow

1. User starts a workflow that needs a managed skill.
2. Renderer calls the coordinator with skill name and workflow context.
3. Coordinator returns one of:
   - `ready`: installed and recently checked.
   - `updated`: reserved for a verified background update path once the CLI contract ships.
   - `fallback`: return reason and optional command.
4. Workflow continues for `ready` and `updated`.
5. For `fallback`, show the contextual modal only when the fallback includes a manual command; otherwise avoid an interrupting dead-end prompt.

## Implementation Steps

1. Extend discovery with canonical `realpath` fields while preserving visible root and source kind.
2. Add lockfile readers for global and project `skills` CLI metadata.
3. Add a managed-skill coordinator in main:
   - eligibility evaluation
   - explicit-scope command execution once the verified CLI contract is available
   - host/WSL routing
   - in-flight dedupe
   - app-version/session success cache
   - failure cooldowns
4. Add IPC:
   - `skills:ensureManagedReady`
5. Wire the intent boundary triggers:
   - Linear worktree-from-task and linked Linear agent workflow.
   - Orchestration workflow start.
   - Computer Use workflow start or first runtime invocation.
   - Browser Use/mobile emulator workflow start for `orca-cli`.
6. Add contextual modal copy and fallback reason handling.
7. Add the default-on automatic managed-skill updates setting in Agents settings.
8. Keep Settings manual update/status behavior separate from automatic update triggers.

## Tests

- Global tracked skill update eligibility without running blind `npx`.
- Project tracked skill falls back in v1.
- Same skill in global and project scope falls back as ambiguous.
- Symlinked visible global install remains global after `realpath`.
- Missing lock entry falls back.
- Legacy or local lock entry falls back.
- WSL runtime fallbacks do not open dead-end setup modals until WSL commands are supported.
- 50 concurrent requests for one skill produce one update attempt.
- Failure cooldown prevents repeated attempts.
- User-disabled automatic updates show the manual update modal on each stale-update trigger.
- App-version invalidation re-enables a single check after update.
- Agent-triggered fallback modal includes triggering context.

## Recommended First Version

Ship the coordinator and intent-boundary triggers, but do not run background `npx` until the verified CLI/ref/hash contract is available. Tracked global Orca-managed installs are the only future auto-update target for this version line. Everything else uses the same trigger and returns fallback state; only fallback state with a safe manual command opens a contextual modal.

This covers the common setup path from Orca's own install buttons while protecting custom, project, remote, and ambiguous installs.
