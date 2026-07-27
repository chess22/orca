# AGENTS.md

## Design System

All UI work — layout, color, typography, spacing, component selection, UX behavior — must follow [`docs/STYLEGUIDE.md`](./docs/STYLEGUIDE.md). Use the tokens defined in `src/renderer/src/assets/main.css` (the canonical source) and the shadcn primitives in `src/renderer/src/components/ui/`. Don't invent new color values, font sizes, or shadow tiers when a documented one already covers the role. When STYLEGUIDE.md is silent, follow the resolution order in its final section.

## Code Comments: Document the "Why", Briefly

When writing or modifying code driven by a design doc or non-obvious constraint, add a comment explaining **why** the code behaves the way it does.

Keep comments short — one or two lines. Capture only the non-obvious reason (safety constraint, compatibility shim, design-doc rule). Don't restate what the code does, narrate the mechanism, cite design-doc sections verbatim, or explain adjacent API choices unless they're the point.

## Lint Rules: Do Not Disable Max Lines

Never add a `max-lines` disable (`eslint-disable max-lines`, `oxlint-disable max-lines`, or line-specific variants), and never add a per-file `max-lines` bump in `mobile/.oxlintrc.json`. Split the file, extract focused modules, move fixtures/builders into named files, or otherwise reduce the counted lines instead.

This is enforced in CI by `pnpm check:max-lines-ratchet` (`config/scripts/check-max-lines-ratchet.mjs`). Files already over the limit are grandfathered in `config/max-lines-baseline.txt`; that list may only **shrink**. Adding a new suppression fails the build. If you remove a suppression (great — split it!), run `pnpm check:max-lines-ratchet --prune` to drop its baseline line.

## File and Module Naming

Never use vague names like `helpers`, `utils`, `common`, `misc`, or `shared-stuff` for files, folders, or modules. They carry zero info and tend to become dumping grounds. Name files after what they _actually_ contain — prefer the concrete domain concept (e.g. `tab-group-state.ts`, `terminal-orphan-cleanup.ts`) over the generic role (`tabs-helpers.ts`, `terminal-utils.ts`). If you find yourself reaching for `helpers`, the file probably has more than one responsibility and should be split, or there's a better name hiding in the code that describes what the functions operate on.

## Worktree Safety

Always use the primary working directory (the worktree) for all file reads and edits. Never follow absolute paths from subagent results that point to the main repo.

## Cross-Platform Support

Orca targets macOS, Linux, and Windows. Keep all platform-dependent behavior behind runtime checks:

- **Keyboard shortcuts**: Never hardcode `e.metaKey`. Use a platform check (`navigator.userAgent.includes('Mac')`) to pick `metaKey` on Mac and `ctrlKey` on Linux/Windows. Electron menu accelerators should use `CmdOrCtrl`.
- **Shortcut labels in UI**: Display `⌘` / `⇧` on Mac and `Ctrl+` / `Shift+` on other platforms.
- **File paths**: Use `path.join` or Electron/Node path utilities — never assume `/` or `\`.

## SSH Use Case

All changes must consider the SSH use case. Don't assume local-only execution.

## Git Provider Compatibility

Source-control and review changes must consider GitLab and other supported git providers, not only GitHub. Keep provider-specific behavior behind explicit checks, and avoid GitHub-only naming for generic review concepts.

## GitHub CLI Usage

Be mindful of the user's `gh` CLI API rate limit — batch requests where possible and avoid unnecessary calls. All code, commands, and scripts must be compatible with macOS, Linux, and Windows.
Never commit PR evidence images; attach them to the PR conversation instead (but never use gh-attach).

## Type Declarations: Prefer `.ts` Over `.d.ts`

## Cross-Session Communication (Orca-Managed Terminals)

When one agent session needs to reach another running in a different Orca-managed worktree/terminal (e.g. requesting a fix reflect into another branch, flagging a blocking issue), follow these rules to avoid lost or misattributed messages:

- **Always identify yourself** at the start of every message with your worktree folder name and branch (e.g. `[my-worktree / my-branch より]`). A bare description of the change is not enough — the recipient needs to know who is asking.
- **Share your own contact terminal handle in your first message**, not only after confusion arises. Look up your own handle with `orca terminal list --worktree "path:<your worktree>"` and include it so the other side can reply directly instead of guessing where to send a response.
- **`worktree set --comment` is a single overwritable field, not a thread.** Use it only for a durable "current status" summary that must survive a session restart or handoff — never for back-and-forth dialogue, since each write erases the previous message. For actual conversation, use `terminal send` to a specific terminal handle (its output history persists).
- **Do not trust a paraphrase of unfamiliar code — verify against primary sources.** When another session describes what a commit or file contains, check it yourself (`git show --stat <sha>`, `git diff`, reading the file) before agreeing or disagreeing. Misattributed claims (e.g. confusing "a commit's own diff" with "the full code state at that commit") are easy to make and easy to verify away.
- **When handing off to a successor session, the handoff document must include any unresolved external requests and the requester's contact terminal handle.** A successor that starts clean from a handoff doc has no memory of prior cross-session exchanges unless they are written down explicitly.
