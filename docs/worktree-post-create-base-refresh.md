# Worktree Pre-Create Base Refresh

## Problem

When creating a local worktree from a remote-tracking base such as `origin/main`,
Orca previously allowed one stale-on-create path:

- `baseBranch` resolved to a remote-tracking ref.
- The remote-tracking ref already existed locally.
- The cached ref was stale.

That path started `git fetch` in the background and then continued to
`git worktree add`, so the new worktree could be created from the old local
`refs/remotes/<remote>/<branch>` value.

Issue #2307 asks for the next worktree after a merge to be based on the latest
remote base. A post-create repair is not safe enough because the renderer may
activate the worktree, launch setup, or start an agent immediately after create
returns.

## Decision

For remote-tracking bases, refresh before `git worktree add`.

Local and SSH create paths now follow the same rule:

1. Resolve whether `baseBranch` names a configured remote-tracking ref.
2. If it does, refresh only that remote-tracking ref before creating the worktree:
   `git fetch --no-tags <remote> +refs/heads/<branch>:refs/remotes/<remote>/<branch>`.
3. Do not update local branches such as `main`; the refreshed ref is
   `refs/remotes/<remote>/<branch>`.
4. Bypass the runtime's completed-fetch freshness cache for this create-time
   refresh. Sharing an already in-flight exact-base refresh is still allowed.
5. If the refresh fails, fail the create before any worktree is created.
6. If the base ref did not exist before refresh and still does not exist after a
   successful refresh, fail the create with a clear missing-base error.
7. Only after the refresh succeeds, run `git worktree add`.

## Non-Goals

- Do not mutate a worktree after it has been returned to the renderer.
- Do not run `git reset --hard` as part of stale-base repair.
- Do not pull, merge, rebase, or fast-forward local `main`.
- Do not change explicit local-base semantics. Local bases such as `main` keep
  the legacy best-effort fetch behavior.
- Do not change `refreshLocalBaseRefOnWorktreeCreate`; that setting may still
  fast-forward a local branch pointer, but it is separate from refreshing the
  remote-tracking base before create.

## Why Pre-Create Beats Post-Create

The tempting alternative was:

```text
create from stale ref -> wait for fetch -> if fast-forward, reset new worktree
```

That is unsafe because there is no atomic boundary between "the worktree is
untouched" and `git reset --hard`. Setup scripts, agents, or user edits can
start as soon as create returns. A clean-status check before reset still has a
race window.

The chosen design is slower on cold network paths, but it has the property we
need: when create succeeds from a remote-tracking base, setup and agents start
from the refreshed base immediately.

## Failure Behavior

- Exact base-ref fetch fails/offline: create fails before `git worktree add`.
- Base ref missing after successful fetch: create fails before `git worktree add`.
- Remote-tracking base already exists: still refresh that one ref before create.
- Recent successful full-remote fetch exists in the 30s cache: still refresh the
  selected base ref before create, because a merge can land immediately after
  the cached fetch.
- Local/non-remote base: preserve best-effort fetch and create from the
  requested local base.
- SSH remote-tracking base: fail closed on fetch failure before asking the relay
  to create the worktree.

## Data Flow

```text
[Create request]
      |
      v
[Resolve baseBranch]
      |
      +-- remote-tracking? -- yes --> [fetch exact remote-tracking base ref]
      |                                  |
      |                                  +-- fail --> [no worktree created]
      |                                  |
      |                                  v
      |                             [git worktree add]
      |
      +-- no ---------------------> [legacy best-effort fetch]
                                      |
                                      v
                                 [git worktree add]
```

## Tests

- Existing remote-tracking ref: create waits for refresh before `git worktree add`.
- Refresh failure: create fails and does not call `git worktree add`.
- Recent fetch cache: create still refreshes the exact base ref.
- SSH remote-tracking ref: fetch failure prevents relay worktree creation.
- Read-only reconcile remains non-mutating when a fetched base has moved.
