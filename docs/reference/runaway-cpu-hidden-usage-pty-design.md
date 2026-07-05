# Runaway CPU From Hidden Usage PTY Working Directory

Date: 2026-07-05

## Goal

Prevent Orca from launching background Claude/Codex usage probes or automatic
agent sessions in an unbounded filesystem root such as `/` or `C:\`, and make
quit cleanup reap any hidden usage PTY that is still running.

The immediate incident is the 2026-07-04 runaway CPU report where a hidden
`claude` process ran `rg --files ... /` for more than 40 minutes while no Orca
window was open.

## User-Visible Symptom

The report's process tree was:

```text
rg ... /
  └── claude
        └── Orca
```

That tree matters. A daemon-owned terminal would normally appear under the
detached daemon process, not directly under the GUI `Orca` process. The direct
`claude -> Orca` parent chain points most strongly at Orca's hidden Claude
rate-limit usage PTY.

The user saw one CPU core pinned near 100% because Claude Code started in `/`
and indexed the whole disk.

## Diagnosis

### Primary root cause: hidden Claude usage PTY has no cwd

`src/main/rate-limits/claude-pty.ts` spawns an interactive `claude` PTY for
`/usage` without passing `cwd`:

```ts
pty.spawn(spawnFile, spawnArgs, {
  name: 'xterm-256color',
  cols: 120,
  rows: 40,
  env: spawnEnv
})
```

On macOS, a GUI app launched by launchd can have process cwd `/`. Because the
hidden PTY omits `cwd`, Claude inherits that root cwd. Claude Code then performs
its startup file indexing from `/`, matching the report's `rg ... /` evidence.

The Codex `/status` PTY fallback in `src/main/rate-limits/codex-fetcher.ts` has
the same shape and should be hardened in the same pass, even though the report
was Claude-specific.

### Cleanup gap: rate-limit stop does not cancel in-flight PTYs

`RateLimitService.stop()` clears timers and window listeners, but it does not
abort an active `fetchClaudeRateLimits()` / `fetchCodexRateLimits()` call or kill
the hidden PTY owned by that call.

The hidden PTY cleanup helper is currently only reached when the PTY exits, the
usage parser finalizes, or the 25 second PTY timeout fires. Quitting Orca during
that window leaves the subprocess lifecycle up to those later events.

### Secondary root cause: daemon fallback can also choose root

The daemon PTY path has a separate hazard:

- `src/main/daemon/pty-subprocess.ts` falls back to `process.env.HOME || '/'`.
- `src/main/providers/local-pty-provider.ts` has the same POSIX fallback.
- The daemon validates cwd only in the Windows preflight path; POSIX daemon
  spawns do not reject `/`.

This is not the best match for the reported parent chain, but it is a real
adjacent bug. A daemon-backed automatic agent launch with no resolved workspace
cwd could still end up indexing root.

### Daemon survival is not itself the bug

Detached daemons intentionally survive normal app quit so sessions can warm
reattach. Legacy protocol daemons can also be preserved so an upgrade does not
kill running agents mid-task.

The bug is not "any daemon exists after quit." The bug is that a hidden
main-process-owned usage PTY can inherit `/`, and quit does not synchronously
reap that hidden PTY.

## Chosen Approach

### 1. Give hidden usage PTYs a tiny explicit cwd

Add a concrete rate-limit PTY cwd resolver, for example
`src/main/rate-limits/hidden-rate-limit-pty-cwd.ts`.

Responsibilities:

- Create or reuse a small Orca-owned directory such as
  `<userData>/rate-limit-pty-cwd`.
- Return that path for local macOS/Linux/Windows PTY spawns.
- Reject root, drive roots, empty strings, and missing/non-directory paths.
- Never fall back to `process.cwd()`.
- Never fall back to `/` or `C:\`.

Then pass the resolved cwd into:

- Claude PTY usage fallback in `claude-pty.ts`.
- Codex PTY status fallback in `codex-fetcher.ts`.

For WSL-backed usage probes, the host `cwd` for `wsl.exe` is not enough. The WSL
shell script should create and `cd` into a bounded Linux directory, such as
`${TMPDIR:-/tmp}/orca-rate-limit-pty-cwd`, before `exec claude` or `exec codex`.

Why this cwd should be tiny instead of the user's home directory:

- The usage probe does not need project files.
- Home directories can still be huge.
- A dedicated empty directory avoids prompts and indexing work tied to a real
  repo or home tree.

### 2. Make hidden usage PTYs abortable and centrally reaped

Add an abort path to the rate-limit PTY fallback flow.

Recommended shape:

- `RateLimitService` owns an `AbortController` for the active fetch cycle.
- `stop()` aborts the controller, clears queued fetch flags, and then detaches
  window listeners/timers.
- `fetchClaudeRateLimits`, `fetchCodexRateLimits`, and their PTY fallback
  functions accept an optional `AbortSignal`.
- Each hidden PTY registers an abort listener that calls
  `cleanupHiddenRateLimitPty(term, disposables, { kill: true })`.
- Cleanup is idempotent and unregisters the abort listener on normal exit,
  timeout, and successful parse.

This should cover both ordinary quit and account-switch races without depending
on a 25 second timeout.

### 3. Harden daemon and local PTY cwd fallback

Replace `HOME || '/'` and `USERPROFILE || 'C:\'` style fallbacks with a safe
resolver:

- Prefer the requested workspace cwd when present and valid.
- For ordinary interactive terminals with no requested cwd, prefer
  `os.homedir()` / Electron home when valid and non-root.
- If no safe default exists, fail the spawn with a user-visible error instead of
  choosing root.
- For recognized automatic agent startup commands, require a non-root explicit
  workspace cwd. Do not silently fall back to home or app data.

Add POSIX daemon validation before `pty.spawn`, not just Windows preflight
validation.

Root handling should be scoped:

- Reject implicit root always.
- Reject root for automatic agent startup commands.
- Do not block a user from manually opening a plain shell at `/` if they
  explicitly requested it; that is a separate UX policy question.

### 4. Keep daemon quit behavior intentional

Do not change normal app quit into "kill every daemon and every daemon session."
That would break the warm-reattach design and could kill real user work during
upgrades.

If we add broader quit cleanup, keep it targeted:

- Hidden rate-limit PTYs: kill on `RateLimitService.stop()`.
- Main-process local fallback PTYs: audit separately and add an explicit
  app-quit disposal path if they can survive provider replacement.
- Detached daemon sessions: preserve on ordinary quit; only kill on explicit
  shutdown, dev-parent cleanup, or a future idle-reap policy.

Legacy daemon idle reaping can be a follow-up design. It should be based on
attached-client/session state and an idle duration, not app quit alone.

## Implementation Plan

1. Add `hidden-rate-limit-pty-cwd.ts`.
   Include root/drive-root detection and directory creation. Keep the API small:
   one function for host cwd and one helper for WSL script cwd setup.

2. Update Claude and Codex hidden PTY fallbacks.
   Pass explicit `cwd` to `pty.spawn`. Insert bounded WSL `mkdir -p && cd`
   before `exec claude` / `exec codex`.

3. Add abort support to hidden PTY fetches.
   Thread `AbortSignal` from `RateLimitService` through Claude and Codex fetchers
   into the PTY fallback functions. Abort should kill the PTY and settle without
   applying stale state.

4. Update `RateLimitService.stop()`.
   Abort the active fetch cycle and clear queued fetch flags before dropping
   listeners. Ensure stop is idempotent.

5. Harden daemon/local default cwd.
   Replace root fallbacks and add POSIX validation. Automatic agent startup
   commands should fail without an explicit safe cwd.

6. Leave daemon lifecycle policy unchanged in this patch.
   Document the existing behavior in the PR and file a follow-up only if we want
   idle reaping for legacy daemons.

## Verification Plan

Unit and contract tests:

- `claude-pty.test.ts`: mocked `node-pty` spawn receives a non-root cwd when
  `process.cwd()` is `/` and `HOME` is missing.
- `codex-fetcher.test.ts`: PTY fallback receives a non-root cwd; WSL command
  script creates and enters the bounded cwd before `exec codex`.
- Claude WSL usage test: command script creates and enters the bounded cwd
  before `exec claude`.
- Hidden PTY abort test: aborting the signal calls `term.kill()` and
  `destroy()` through `cleanupHiddenRateLimitPty`, disposes listeners, and
  leaves no active hidden PTY registrations.
- `RateLimitService.stop()` test: an in-flight Claude/Codex PTY fallback is
  aborted on stop and does not update state after stop.
- `pty-subprocess.test.ts`: daemon POSIX spawns never default to `/`; automatic
  agent startup without a safe explicit cwd fails before `pty.spawn`.
- `local-pty-provider.test.ts`: local provider default cwd never returns `/` or
  a Windows drive root when home cannot be resolved.

Perf and leak evidence:

- Count active hidden usage PTYs before and after stop, timeout, parser success,
  and natural exit; the count must return to zero in every path.
- Assert no extra polling or retry loop is introduced. The fix should add no
  timers beyond existing PTY timeout/parser timers.
- Optional packaged macOS repro: launch with a simulated root process cwd and
  missing `HOME`, trigger Claude usage refresh, and verify the spawned `claude`
  cwd is the bounded Orca directory, not `/`.

Manual validation:

- Trigger a Claude rate-limit refresh and confirm usage still renders.
- Trigger Codex `/status` PTY fallback and confirm status still renders.
- Quit while a mocked or deliberately slow usage PTY is in flight and confirm
  the child process is killed immediately.
- Confirm ordinary daemon sessions still warm-reattach after normal app quit.

## Non-Goals

- Do not remove daemon warm reattach.
- Do not kill all legacy daemon sessions on ordinary quit.
- Do not disable Claude/Codex usage polling.
- Do not solve every old-daemon retention policy question in this patch.
- Do not prevent a user from manually running commands in `/` after explicitly
  choosing that cwd.

## Rollout And Risk

This is low product-risk if scoped to hidden usage PTYs and implicit cwd
fallbacks. The highest compatibility risk is WSL: setting the host `cwd` does
not control the inner Linux cwd, so WSL command scripts must do their own
bounded `cd`.

The daemon hardening should be slightly more conservative than the hidden PTY
fix because terminals can be user-directed. Automatic agent launches should be
strict; plain user shells should only reject unsafe implicit defaults.

Success means:

- The report's `claude -> Orca` hidden PTY path cannot inherit `/`.
- Quitting Orca aborts in-flight hidden usage PTYs immediately.
- Daemon-backed automatic agents cannot silently start in `/`.
- Normal daemon warm reattach still works.

## Additional Considerations From Code Review

These surfaced while auditing the current code and refine, but do not change, the
chosen approach.

### The missing cwd is an omission, not an intentional choice

Every other PTY spawn in the codebase passes an explicit `cwd`
(`local-pty-provider.ts`, `pty-subprocess.ts`, the daemon spawn-health probe).
The rate-limit PTYs are the only spawns that omit it, so they inherit the main
process cwd (`/` under launchd). There is no load-bearing reason for the root
cwd; the `/usage` and `/status` probes only drive a TUI and scrape output, and
never read project files. Adding a bounded cwd removes no capability.

### Trust prompt behavior changes, and is already handled

A fresh `<userData>/rate-limit-pty-cwd` is an untrusted directory on every run,
so Claude Code's "Do you trust the files in this folder?" prompt will now appear
more reliably rather than being avoided. The existing auto-accept
(`TRUST_PROMPT_RE` -> `y\r` in `claude-pty.ts`) already covers this. The tiny cwd
bounds indexing scope once trusted; it does not skip the trust prompt. Verify the
auto-accept still fires against the new directory.

### Codex PTY relies on prompt detection, not cwd

The Codex fallback waits for a shell-prompt regex before sending `/status`, so
changing its cwd does not affect command delivery. No regression expected on that
path.

### Abort-on-quit is already scoped away from daemon lifecycle

`RateLimitService.stop()` runs on `before-quit`, while daemon/local PTY teardown
is deferred to `will-quit`. The `AbortController` change therefore lives on a
different code path from daemon disposal, which reinforces the §4 constraint that
this patch must not touch daemon survival.

### Cleanup helper is already idempotent

`cleanupHiddenRateLimitPty` splices its disposables and guards the double-kill on
Windows, and is already invoked on all four settle paths (timeout, finalize,
exit, settle-timer). Wiring an abort listener into the same helper is consistent
and will not double-kill.

### WSL missing-directory failure mode

Beyond the known "host cwd does not set inner Linux cwd" risk: if the WSL script
`cd`s into a bounded dir that does not exist without a preceding `mkdir -p`, the
probe can fail outright rather than merely indexing the wrong tree. The `mkdir -p
&& cd` must run before `exec` so a first-run WSL probe still renders usage.
