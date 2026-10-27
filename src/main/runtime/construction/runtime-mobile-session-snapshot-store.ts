import type { RuntimeMobileSessionTabsSnapshot } from '../../../shared/runtime-types'
import { preserveTerminalRetirementProofs } from '../mobile-session-terminal-retirement-proof'
import {
  headlessMobileSnapshotContentUnchanged,
  mobileSnapshotIdentityUnchanged
} from '../mobile-session-snapshot-equality'

export function prepareRuntimeMobileSessionSnapshot(
  existing: RuntimeMobileSessionTabsSnapshot | undefined,
  snapshot: RuntimeMobileSessionTabsSnapshot,
  mainOrderedSnapshot: RuntimeMobileSessionTabsSnapshot | null
): RuntimeMobileSessionTabsSnapshot {
  if (mainOrderedSnapshot) {
    if (
      existing &&
      mobileSnapshotIdentityUnchanged(existing, snapshot) &&
      headlessMobileSnapshotContentUnchanged(existing, mainOrderedSnapshot) &&
      !headlessMobileSnapshotContentUnchanged(snapshot, mainOrderedSnapshot)
    ) {
      return existing
    }
    snapshot = mainOrderedSnapshot
  }
  snapshot = preserveTerminalRetirementProofs(snapshot, existing)
  const snapshotVersion = existing
    ? Math.max(snapshot.snapshotVersion, existing.snapshotVersion + 1)
    : snapshot.snapshotVersion
  return snapshotVersion === snapshot.snapshotVersion ? snapshot : { ...snapshot, snapshotVersion }
}
