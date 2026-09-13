# Plane task provider

This first provider slice adds an agent-facing Plane Community Edition REST boundary without
changing or migrating the existing Linear integration. It supports work-item list, retrieve,
create, update, state change, comment list/create, and durable worktree linkage.

## Runtime configuration

The runtime reads the connection from its own environment. The API key is never accepted in a
Plane RPC payload or persisted in worktree metadata.

```text
ORCA_PLANE_BASE_URL=https://plane.example
ORCA_PLANE_WORKSPACE_SLUG=team
ORCA_PLANE_PROJECT_ID=<project-uuid>
ORCA_PLANE_API_KEY=<personal-access-token>
```

`ORCA_PLANE_APPROVAL_STATE_NAMES` may contain comma-separated additional protected-state names.
`承認済` is always protected and cannot be removed by configuration.

Use `orca plane status --json` to inspect configuration without revealing the credential. Available
commands are `plane list`, `plane issue`, `plane create`, `plane update`, `plane state list`,
`plane state set`, `plane comment list`, and `plane comment add`.

The client uses `X-API-Key` and the current `/api/v1/.../work-items/` routes. The older `/issues/`
routes are intentionally not used because Plane ends support for them on 31 March 2026. Self-hosted
instances use the configured origin instead of `https://api.plane.so`.

Primary references:

- <https://developers.plane.so/api-reference/introduction>
- <https://developers.plane.so/api-reference/issue/list-issues>
- <https://developers.plane.so/api-reference/issue/update-issue-detail>
- <https://developers.plane.so/api-reference/issue-comment/add-issue-comment>
- <https://developers.plane.so/api-reference/state/overview>
- <https://developers.plane.so/api-reference/members/get-workspace-members>

## Worktree linkage

Plane identity is stored separately as `linkedPlaneWorkItem`; existing GitHub, GitLab, Linear,
Bitbucket, Azure DevOps, and Gitea slots are unchanged. Link an existing worktree with an
unambiguous REST resource URL:

```text
orca worktree set --worktree active \
  --plane-work-item https://plane.example/api/v1/workspaces/team/projects/<project-id>/work-items/<item-id>/ \
  --json
```

A Plane browse URL is also accepted when it includes `?project=<project-id>`. Pass
`--plane-work-item null` to clear only the Plane link. Linking during worktree creation is deferred:
the remote/SSH creation path needs a host-owned metadata change rather than a local-only shortcut.

## Approval boundary

Agent-facing RPC always constructs the service with a trusted `ai` actor and never accepts an actor
claim from the request. Both creation with an initial state and later state changes pass the same
guard. AI can move a work item to `Done`, but cannot move or create it directly in `承認済`.
Generic updates reject a `state` field, so callers cannot bypass the guarded state method.

An Owner transition requires a separately trusted human boundary and a workspace membership with
Plane role `20`. This is deliberately not exposed by the agent RPC.

Stock Plane Community Edition authorization cannot distinguish an AI process from the human Owner
when both use the same Owner personal access token. Therefore the hard deployment rule is to give
Orca's agent runtime a non-Owner service account/token. If enforcement must hold for every client,
the OSS server needs a small policy patch at the work-item PATCH/create boundary: resolve the target
state, reject protected states unless `request.user` has workspace Owner role 20, and keep the AI
service account below Owner. A caller-supplied header alone is not an adequate actor proof.

## Current verification boundary

The implementation is covered with mocked REST contract tests, RPC validation tests, CLI parsing,
and worktree-link tests. A live Plane request is intentionally separate and requires a reachable
Plane Community Edition base URL plus the four runtime configuration values above.
