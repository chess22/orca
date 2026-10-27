import type * as PtyControllerContract from '../../runtime-pty-controller-contract'
import {
  PTY_CONTROLLER_LIST_PROVIDER_MARGIN_MS,
  PTY_CONTROLLER_LIST_TIMEOUT_MS
} from '../../orca-runtime-postlude'

export function ptyControllerInventoryRequest(
  deadline: number | undefined,
  options: PtyControllerContract.PtyInventoryRefreshOptions | undefined
) {
  const listBudgetMs =
    deadline === undefined
      ? PTY_CONTROLLER_LIST_TIMEOUT_MS
      : Math.max(1, Math.min(PTY_CONTROLLER_LIST_TIMEOUT_MS, deadline - Date.now()))
  return {
    listBudgetMs,
    providerListOptions: {
      deadlineMs: Date.now() + Math.max(1, listBudgetMs - PTY_CONTROLLER_LIST_PROVIDER_MARGIN_MS),
      ...(options?.includeForegroundProcessEvidence === undefined
        ? {}
        : { includeForegroundProcessEvidence: options.includeForegroundProcessEvidence })
    }
  }
}
