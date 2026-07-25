export type AppIdentity = {
  name: string
  isDev: boolean
  devLabel: string | null
  devBranch: string | null
  devWorktreeName: string | null
  devRepoRoot: string | null
  dockBadgeLabel: string | null
  // Why: only populated for a packaged Orca Dev/Test parallel-identity build
  // (see PACKAGED_PARALLEL_IDENTITIES); null for production Orca and for
  // interactive `pnpm dev` runs, which already surface devBranch instead.
  buildBranch: string | null
  buildCommitHash: string | null
}
