# Claude Fable Weekly Usage Meter

## Problem

Claude Code now exposes weekly subscription usage alongside the 5-hour window. Anthropic documents `rate_limits.five_hour` and `rate_limits.seven_day` in Claude Code statusline JSON, with weekly data present for Claude.ai subscribers after the first API response. The existing Orca Claude meter already has a weekly slot in shared state, but the hidden CLI fallback only recognizes older `/usage` copy.

Relevant code:

- `src/shared/rate-limit-types.ts:46` models provider usage with `session` and `weekly` windows.
- `src/main/rate-limits/claude-fetcher.ts:373` maps OAuth `five_hour` and `seven_day` into Orca's Claude provider state.
- `src/main/rate-limits/claude-pty.ts:18` parses hidden `claude` `/usage` output, but `WEEKLY_RE` only accepts `Current week`.
- `src/renderer/src/components/status-bar/StatusBar.tsx:1112` renders both session and weekly windows when both are present.
- `src/renderer/src/components/status-bar/tooltip.tsx:138` includes weekly usage in the details popover.

Research:

- Official Claude Code statusline docs: `rate_limits.five_hour.used_percentage` and `rate_limits.seven_day.used_percentage`, plus matching `resets_at`, are the 5-hour and 7-day rate-limit fields.
- `harveyxiacn/cc-usage-monitor` uses Claude Code's statusline `rate_limits` data and shows both `5h` and `7d` windows, matching Orca's existing `session` and `weekly` model.

## Goal

Make Orca's existing Claude status-bar meter show the weekly Fable/Claude usage window whenever Claude Code reports it, including newer `/usage` panel wording such as `Weekly limits` or `7-day`.

## Non-goals

- Do not infer subscription quota from token logs.
- Do not add a separate Fable-only quota unless Claude exposes a stable, separate field.
- Do not spend user Claude quota during automated verification.
- Do not change provider account switching, polling cadence, or OAuth credential handling.

## Design

1. Keep `ProviderRateLimits.weekly` as the canonical UI field. OAuth already maps `seven_day` to `weekly`, and the status bar already renders it next to the 5-hour window.
2. Accept both OAuth `utilization` windows and Claude Code-style `used_percentage` windows with epoch-second `resets_at` values.
3. Broaden the hidden Claude CLI parser so the weekly label accepts both old `Current week` wording and newer usage/statusline wording: `Weekly limits`, `Weekly usage`, `weekly rate limit`, and `7-day`.
4. Broaden percent parsing to treat `consumed` like `used`, because Anthropic describes rate-limit percentages as consumed.
5. Add focused tests for the new weekly wording and retain existing old-copy coverage.

## Edge Cases

- Weekly data may be absent for API-key users or before the first Claude API response; keep `weekly: null`.
- The hidden PTY fallback may still only return session data; the status bar should continue showing the 5-hour meter without error.
- Reset timestamps/descriptions may be absent from CLI output; keep `resetsAt: null` and parse only visible reset text.
- Fable currently draws from Claude plan usage surfaced as the 7-day window; if Anthropic adds a stable distinct Fable bucket later, model it separately instead of guessing from labels.

## Rollout

1. Update OAuth window mapping for statusline-style percentages and reset timestamps.
2. Update `claude-pty` weekly label and percent parsing.
3. Add focused tests for statusline-style OAuth data, `Weekly limits`, and `7-day` wording.
4. Run focused tests, then typecheck/lint.
5. Validate in Electron by injecting a Claude provider state with both 5-hour and weekly data and capturing status-bar screenshots.
6. Commit, push, open a PR, and attach screenshots in a PR comment.
