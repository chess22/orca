import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'
import { startedMainTerminalSurfaces, type SurfacesOwner } from './main-terminal-surface-publisher'
export {
  mainTerminalRegistered,
  mainTerminalSurfaces,
  startedMainTerminalSurfaces,
  windowListsTab,
  type MainTerminalSurfacesHost,
  type SurfacesOwner
} from './main-terminal-surface-publisher'

type PaneClaim = {
  tabId?: string | null
  paneKey?: string | null
  surfaceRecordedAtGraphSequence?: number
}

/** A terminal record's update with no pane claim: main's layout answers for the pane (L80). */
export function withoutPaneClaim<State extends PaneClaim>(
  state: State
): Omit<State, keyof PaneClaim> {
  const {
    tabId: _tabId,
    paneKey: _paneKey,
    surfaceRecordedAtGraphSequence: _stamp,
    ...rest
  } = state
  return rest
}

/** What main's composed panes read from a terminal record (terminalHoldsPane and liveness). */
export type MainPaneRecordFacts = {
  connected: boolean
  incarnationId: string | null
  worktreeId: string
}

/** The facts of a record before an update; undefined for a record not yet made. */
export function mainPaneRecordFacts(
  record: MainPaneRecordFacts | undefined
): MainPaneRecordFacts | undefined {
  return (
    record && {
      connected: record.connected,
      incarnationId: record.incarnationId,
      worktreeId: record.worktreeId
    }
  )
}

/**
 * A terminal record arrived, or its connection, incarnation or workspace changed: main's panes
 * that bind its id re-compose, though no layout changed. Read after the update, so the record
 * the panes compare against is the one now registered; an unchanged refresh notes nothing.
 */
export function noteMainPaneRecordChange(
  runtime: SurfacesOwner,
  prior: MainPaneRecordFacts | undefined,
  next: MainPaneRecordFacts & { ptyId: string }
): void {
  if (
    prior &&
    prior.connected === next.connected &&
    prior.incarnationId === next.incarnationId &&
    prior.worktreeId === next.worktreeId
  ) {
    return
  }
  const surfaces = startedMainTerminalSurfaces(runtime)
  if (surfaces?.bindsTerminal(next.ptyId)) {
    surfaces.terminalChanged()
  }
}

/** Whether main's layout still holds the pane; null before main has published its panes. */
export function mainLayoutHoldsPane(runtime: SurfacesOwner, paneKey: string): boolean | null {
  const surfaces = startedMainTerminalSurfaces(runtime)
  const pane = parsePaneKey(paneKey)
  return surfaces && pane ? surfaces.paneOf(pane.tabId, pane.leafId) !== null : null
}

/** Whether another pane still holds an agent session: a terminal of it that has not exited, or no
 *  terminal at all, which switch-on holds only while main's layout still holds the pane. */
export function paneHoldsSession(
  runtime: SurfacesOwner,
  paneKey: string,
  panePtyIds: readonly string[],
  exited: (ptyId: string) => boolean
): boolean {
  if (panePtyIds.length > 0) {
    return panePtyIds.some((ptyId) => !exited(ptyId))
  }
  return !ORCA_LAYOUT_OWNER_IS_MAIN || mainLayoutHoldsPane(runtime, paneKey) !== false
}

/**
 * Switch-on, whether a pane in the workspace is main's own: then the pane existing proves nothing
 * about its terminal, whose record and the host's inventory decide whether it runs. A paired
 * server's workspace (a `runtime:<env>` window graph) keeps the window's rule.
 */
export function mainDecidesLeafLiveness(runtime: SurfacesOwner, worktreeId: string): boolean {
  return ORCA_LAYOUT_OWNER_IS_MAIN && mainListsEveryPane(runtime, worktreeId)
}

/** Whether main lists the workspace's panes, so terminal.list shows every saved one. */
export function mainListsEveryPane(runtime: SurfacesOwner, worktreeId: string): boolean {
  return startedMainTerminalSurfaces(runtime)?.ownsWorkspace(worktreeId) === true
}

/**
 * The runtime's panes plus every terminal main's layout binds, registered or not: a saved SSH
 * terminal not re-registered since a restart may still run, so a worktree stop still names it.
 */
export function withMainBoundLeaves(
  runtime: SurfacesOwner,
  leaves: Iterable<{ worktreeId: string; ptyId: string | null }>
): { worktreeId: string; ptyId: string | null }[] {
  return [...leaves, ...(startedMainTerminalSurfaces(runtime)?.boundLeaves() ?? [])]
}
