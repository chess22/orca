import {
  beginMacUpdateDownload,
  deferMacQuitUntilInstallerReady,
  isMacInstallRequested,
  setMacInstallPreflightInProgress
} from '../updater-mac-install'
import { recordUpdaterLifecycle } from '../updater-lifecycle-diagnostics'
import { isExternallyManagedLinuxInstall } from '../linux-update-package-type'
import { LINUX_PACKAGE_EXTERNALLY_MANAGED_MESSAGE } from '../linux-package-downloaded-status'
import { QUIT_AND_INSTALL_DELAY_MS } from './updater-state'
import { UpdaterRemoteStatus } from './updater-remote-status'
import { prepareThisProcessShipItStaging } from './shipit-leftover-recovery'

/** Coordinates renderer-facing download/install actions and their duplicate guards. */
export abstract class UpdaterDownloadInstall extends UpdaterRemoteStatus {
  protected scheduleHeadlessLocalBuildInstallAction(action: 'download' | 'install'): void {
    const queued = this.headlessLocalBuildInstall.getQueuedAction(action)
    if (!queued) {
      this.headlessLocalBuildInstall.fail(new Error(`The queued ${action} action was unavailable.`))
      return
    }
    setTimeout(() => {
      const observedVersion =
        this.currentStatus.state === 'available' ||
        this.currentStatus.state === 'downloading' ||
        this.currentStatus.state === 'downloaded' ||
        this.currentStatus.state === 'error'
          ? (this.currentStatus.version ?? null)
          : null
      const take = this.headlessLocalBuildInstall.takeAction(queued, {
        version: observedVersion,
        source: this.activeUpdateSource,
        feedIdentity: this.activeLocalBuildFeed?.url ?? null
      })
      if (take === 'missing') {
        return
      }
      if (take === 'drifted') {
        this.headlessLocalBuildInstall.fail(
          new Error(`The queued ${action} action no longer matches the verified build feed.`)
        )
        return
      }
      const accepted = action === 'download' ? this.downloadUpdate() : this.quitAndInstall()
      if (!accepted) {
        this.headlessLocalBuildInstall.fail(
          new Error(`The updater refused the queued ${action} action.`)
        )
      }
    }, 0)
  }

  protected quitAndInstall(): boolean {
    if (
      this.localBuildSelectionInProgress ||
      this.pinnedBuildSelectionInProgress ||
      this.pendingQuitAndInstallTimer ||
      this.quitAndInstallInProgress ||
      isMacInstallRequested()
    ) {
      return false
    }

    if (this.deferHeadlessServeInstall('install', this.getPendingInstallVersion())) {
      return false
    }
    // A queued check must not repoint the feed while native staging or installation is pending.
    this.finishActiveUpdateCheckAttempt()
    this.clearBackgroundCheckLaunchPending()
    if (
      !this.isMacStagingDeferredToInstall() &&
      deferMacQuitUntilInstallerReady(
        this.currentStatus,
        this.hasInstallableDownloadedVersion(),
        () => this.getPendingInstallVersion(),
        (status) => this.sendStatus(status)
      )
    ) {
      return false
    }

    if (process.platform === 'darwin') {
      setMacInstallPreflightInProgress(true)
    }
    this.headlessLocalBuildInstall.markInstalling()
    // Why: defer the quit a tick so the renderer can flush dismissals/state before windows start closing.
    this.pendingQuitAndInstallTimer = setTimeout(() => {
      void this.performQuitAndInstall()
    }, QUIT_AND_INSTALL_DELAY_MS)
    return true
  }

  protected downloadUpdate(): boolean {
    if (
      this.localBuildSelectionInProgress ||
      this.pinnedBuildSelectionInProgress ||
      this.pendingQuitAndInstallTimer ||
      this.quitAndInstallInProgress ||
      isMacInstallRequested() ||
      this.downloadInFlight
    ) {
      return false
    }
    // Why: allow retry from 'error' (availableVersion stays cached) so the error card's Retry Download button works.
    const canStart =
      this.currentStatus.state === 'available' ||
      (this.currentStatus.state === 'error' && this.hasInstallableDownloadedVersion())
    if (!canStart) {
      return false
    }
    const version =
      this.currentStatus.state === 'available' ? this.currentStatus.version : this.availableVersion
    if (!version) {
      return false
    }
    // Why: main owns this verdict, not the card — an older renderer or a direct IPC call must not be
    // able to spend a package download that this host could never install.
    if (isExternallyManagedLinuxInstall()) {
      recordUpdaterLifecycle('linux_package_externally_managed_download_blocked', {
        version
      })
      // Why: a pinned jump resolves to 'release' on Linux (no dev-channel artifact is built for it),
      // so refusing without unwinding would strand isPinnedBuildActive and silently kill every
      // background check for the rest of the process. A no-op on the ordinary release path.
      this.clearAvailableUpdateContext()
      this.restoreReleaseUpdateSource()
      this.sendStatus({
        state: 'error',
        message: LINUX_PACKAGE_EXTERNALLY_MANAGED_MESSAGE,
        version,
        retryable: false
      })
      return false
    }
    if (this.deferHeadlessServeInstall('download', version)) {
      return false
    }
    this.downloadInFlight = true
    const localBuildDownload = this.activeUpdateSource === 'local'
    beginMacUpdateDownload()
    // Why: setup can take seconds before progress emits; surface acceptance now so the action never looks inert.
    this.sendStatus({ state: 'downloading', percent: 0, version })
    const startDownload = (): void => {
      this.getAutoUpdater()
        .downloadUpdate()
        .catch((err) => {
          this.downloadInFlight = false
          const message = String(err?.message ?? err)
          if (localBuildDownload) {
            this.sendLocalBuildErrorAndRestore(message)
          } else {
            this.sendErrorStatus(message)
          }
        })
    }
    // Why before the download: Squirrel stages as soon as it ends, unless staging waits for install.
    const preparingStaging = this.isMacStagingDeferredToInstall()
      ? null
      : prepareThisProcessShipItStaging()
    if (preparingStaging) {
      void preparingStaging.then(startDownload)
    } else {
      startDownload()
    }
    return true
  }

  protected isQuittingForUpdate(): boolean {
    return this.quittingForUpdate
  }
}
