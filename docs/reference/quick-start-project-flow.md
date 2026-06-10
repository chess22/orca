# Default-Driven Create Project Flow

## Context

The current Add Project experience includes a `Create new project` path. It is flexible, but it asks for too much too early:

- The user must choose Git repository vs folder.
- The user must choose or type a parent location.
- The screen presents several choices before the user has a usable project.

The product direction is to make `Add Project -> Create a new project` feel lightweight while still creating a real project. This is not a demo-project or seeded-template flow. Users should still create their own project, with their own name, but Orca should make sensible defaults and hide the uncommon choices behind advanced settings.

## Current Orca Behavior

The Add Project start screen has:

- `Browse folder`
- `Clone from URL`
- `Remote project`
- `Create new project`

`Create new project` opens `AddRepoCreateStep`, which shows:

- Project type:
  - `Git repository`
  - `Folder`
- Project name
- Parent/location
- `Create project`

The create step supports two flows:

- Git project:
  - Create or reuse an empty target directory.
  - Run `git init`.
  - Create an empty initial commit.
  - Add the repo to Orca.
  - Fetch worktrees.
  - Open the default checkout when available, otherwise reveal the project row.
- Folder project:
  - Create or reuse an empty target directory.
  - Add it as a folder project.
  - Fetch the synthetic folder workspace.
  - Activate and reveal the synthetic root workspace.

Relevant code:

- `src/renderer/src/components/sidebar/AddRepoCreateStep.tsx`
- `src/renderer/src/components/sidebar/CreateProjectLocationField.tsx`
- `src/renderer/src/components/sidebar/AddRepoDialog.tsx`
- `src/renderer/src/components/sidebar/AddRepoDialogStepContent.tsx`
- `src/renderer/src/components/sidebar/clone-defaults.ts`
- `src/main/ipc/repos.ts`
- `src/main/runtime/rpc/methods/repo.ts`
- `src/shared/constants.ts`

## Reference Findings

Looking only at top-level project creation/add-project flows, not worktree creation:

- Superset has a `New Project` flow. It defaults project roots to `~/.superset/projects/<project-name>`.
- Superset separately defaults worktrees to `~/.superset/worktrees`.
- T3Code has an Add Project base directory setting. If unset, Add Project starts at `~/`.
- Emdash uses `localProject.defaultProjectsDirectory` when configured; otherwise the path starts empty and the user chooses/types a location.
- VS Code does not have a direct “create project” equivalent. Its open-folder picker defaults from previous folder/home/current context.
- No checked reference defaulted new developer projects into `Documents`.

The strongest comparable pattern is Superset's split:

```text
~/.superset/projects/<project-name>   # project roots
~/.superset/worktrees/...             # generated worktrees
```

For Orca, the equivalent should be:

```text
~/orca/projects/<project-name>              # created project repo roots
~/orca/workspaces/<repo-name>/<workspace>   # Orca-created workspaces/worktrees
```

## Product Decision

Keep the entry named around creating a project, not “Quick Start.”

Recommended user-facing flow:

```text
Add Project -> Create a new project -> enter name -> Create project
```

Top-level fields:

- Project name

Default behavior:

- Create a Git repository when Git is available.
- Create the project under `~/orca/projects/<project-name>` by default.
- If Git is unavailable, default to a folder project and make the fallback visible.

Advanced settings:

- Project type segmented control:
  - `Git repository`
  - `Folder`
- Location field/picker:
  - Default parent: `~/orca/projects`
  - Final preview: `~/orca/projects/<project-name>`

This keeps the common path small without removing control from users who know where they want the project or do not want Git.

## Default Location

Use:

```text
~/orca/projects/<project-name>
```

Platform examples:

```text
macOS/Linux: /Users/alice/orca/projects/my-project
Windows:     C:\Users\alice\orca\projects\my-project
```

Why this is stronger than `Documents`:

- Competitor evidence does not point to Documents for developer project creation.
- Documents can imply user documents, iCloud backup, and platform permission expectations.
- Code projects are better kept in an explicit project root.

Why this is stronger than `~/<project-name>`:

- It avoids cluttering home.
- It is easier to explain and clean up.
- It creates an Orca-owned place for projects without mixing them into generated workspaces.

Why this is stronger than `~/orca/workspaces/<project-name>`:

- Orca already uses `workspaceDir` for generated workspaces/worktrees.
- Created project roots should not be interleaved with Orca-created worktrees.
- The mental model remains clean: `projects` are roots, `workspaces` are generated working copies.

Implementation detail:

- Add a new default create-project parent resolver instead of reusing `workspaceDir` directly.
- Default to `path.join(homeDir, 'orca', 'projects')`.
- Use platform path APIs. Do not assume `/`.
- For active runtime environments, create the project on the runtime host using that host's home directory equivalent. Do not use the local native folder picker for runtime paths.

## UX Details

Initial screen:

- Title: `Create a new project`
- Name input:
  - Required.
  - Autofocused.
  - Placeholder like `my-project`.
- Summary row:
  - `Git repository in ~/orca/projects`
  - If Git is unavailable: `Folder in ~/orca/projects`
- Collapsed advanced settings trigger:
  - `Advanced settings`

Advanced expanded state:

- Project type segmented control using shadcn-style primitives.
- Location field with Browse button in local mode.
- Path preview showing the final target directory.

Create button:

- Disabled until the name is valid.
- Label: `Create project`.
- Busy label: `Creating...`.

Success behavior:

- Close the modal.
- Add the project to Orca.
- Open the default checkout for Git projects.
- Activate and reveal the synthetic root workspace for folder projects.

Failure behavior:

- Keep the modal open.
- Show the filesystem/Git error inline.
- Do not leave an orphan sidebar project.

## Git Behavior

Default to Git when available because it shows more of Orca:

- Source control.
- Diffs.
- Branch/workspace flows.
- Repo-aware agents.
- Default checkout activation.

Git should be a default, not a required visible decision.

If Git availability is known before rendering:

- Available: default project type is `Git repository`.
- Unavailable: default project type is `Folder`, with a short explanation near the advanced summary.

If Git initialization fails during creation:

- Show an error and keep the user on the screen.
- Do not silently fall back to folder after the user believed they were creating a Git project.

## Implementation Plan

1. Add default parent resolution.

   Create a focused helper for the default create-project parent:

   ```text
   <home>/orca/projects
   ```

   It should be cross-platform and should not reuse the worktree `workspaceDir` as the project root parent.

2. Initialize `AddRepoCreateStep` with defaults.

   - `createKind`: `git` when Git is available, otherwise `folder`.
   - `createParent`: default create-project parent.
   - `createName`: empty; user must enter it.

3. Move low-frequency choices under advanced settings.

   - Keep name visible.
   - Collapse project type and location.
   - Show the default summary when collapsed.
   - Use a segmented control for Git vs folder.

4. Preserve existing creation behavior.

   - Continue calling `repos:create` / runtime `repo.create`.
   - Continue using the Git default-checkout handoff.
   - Continue activating folder projects through the synthetic workspace path.

5. Handle local vs runtime paths.

   - Local mode can use the native folder picker.
   - Runtime mode should require typed runtime paths or a runtime-aware picker.
   - The default runtime parent should be resolved on the runtime host, not the client.

6. Tests.

   Add focused tests for:

   - Default parent resolves to `<home>/orca/projects`.
   - Name-only happy path creates under the default parent.
   - Advanced settings can change project type.
   - Advanced settings can change location.
   - Git-unavailable state defaults to folder.
   - Runtime mode does not use the local folder picker.
   - Git project success uses the existing default-checkout handoff.
   - Folder project success activates/reveals the synthetic workspace.

## Open Questions

- How should the renderer learn Git availability before rendering the create form?
- Should `~/orca/projects` be user-configurable independently, or only overridable per create?
- Should the path default be remembered after the user changes it, or reset to `~/orca/projects` every time?

## Recommendation

Implement the default-driven create flow:

```text
Add Project -> Create a new project -> enter name -> Create project
```

Use `~/orca/projects/<project-name>` as the default target, create a Git repository by default when available, and keep project type/location in advanced settings.
