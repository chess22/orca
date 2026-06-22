import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Info, RefreshCw } from 'lucide-react'
import type { ManagedAgentSkillFallback } from '../../../../shared/skills'
import { buildAgentFeatureSkillUpdateCommand } from '@/lib/agent-feature-install-commands'
import {
  notifyInstalledAgentSkillsChanged,
  useInstalledAgentSkill
} from '@/hooks/useInstalledAgentSkills'
import {
  getManagedSkillContextCopy,
  getManagedSkillFallbackDisplayMessage
} from './managed-agent-skill-dialog-copy'
import {
  advanceManagedAgentSkillFallbackQueue,
  enqueueManagedAgentSkillFallback,
  getInstalledStateSourceKinds,
  prepareManagedAgentSkillSetupTerminal,
  replaceActiveAfterManagedAgentSkillRecheck,
  type ManagedAgentSkillDialogState
} from './managed-agent-skill-dialog-state'
import { AgentSkillSetupPanel } from '@/components/settings/AgentSkillSetupPanel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  AGENT_SKILL_CLI_PREREQUISITE_NOTICE,
  isOrcaCliAvailableOnPath
} from '@/lib/agent-skill-cli-prerequisite'
import { translate } from '@/i18n/i18n'

const DISMISS_STORAGE_PREFIX = 'orca:managed-agent-skill-setup-dismissed:'

export function ManagedAgentSkillSetupDialogHost(): React.JSX.Element | null {
  const [dialogState, setDialogState] = useState<ManagedAgentSkillDialogState>({
    active: null,
    queue: []
  })
  const queuedKeysRef = useRef(new Set<string>())
  const snoozedKeysRef = useRef(new Set<string>())
  const [rechecking, setRechecking] = useState(false)
  const active = dialogState.active
  const installedState = useInstalledAgentSkill(active?.skillName ?? 'linear-tickets', {
    enabled: active !== null,
    discoveryTarget: active?.request.discoveryTarget,
    projectRootPath: active?.request.discoveryTarget?.projectRootPath,
    sourceKinds: active ? getInstalledStateSourceKinds(active.scope) : undefined
  })

  const enqueueFallback = useCallback((event: ManagedAgentSkillFallback): void => {
    if (isDismissed(event.uiKey) || snoozedKeysRef.current.has(event.uiKey)) {
      return
    }
    if (queuedKeysRef.current.has(event.uiKey)) {
      return
    }
    queuedKeysRef.current.add(event.uiKey)
    setDialogState((current) => enqueueManagedAgentSkillFallback(current, event))
  }, [])

  const advanceQueue = useCallback((): void => {
    setDialogState((current) => {
      if (current.active) {
        queuedKeysRef.current.delete(current.active.uiKey)
      }
      return advanceManagedAgentSkillFallbackQueue(current)
    })
    setRechecking(false)
  }, [])

  useEffect(() => {
    const unsubscribeFallback = window.api.skills.onManagedFallback(enqueueFallback)
    const unsubscribeUpdated = window.api.skills.onManagedUpdated(() => {
      notifyInstalledAgentSkillsChanged()
    })
    return () => {
      unsubscribeFallback()
      unsubscribeUpdated()
    }
  }, [enqueueFallback])

  const contextCopy = active ? getManagedSkillContextCopy(active.context) : ''
  const installedCommand = useMemo(
    () => (active ? buildAgentFeatureSkillUpdateCommand(active.skillName) : ''),
    [active]
  )

  const recheck = useCallback(async (): Promise<void> => {
    if (!active) {
      return
    }
    setRechecking(true)
    try {
      const result = await window.api.skills.ensureManagedReady({ ...active.request, force: true })
      if (result.status === 'fallback') {
        setDialogState((current) => replaceActiveAfterManagedAgentSkillRecheck(current, result))
        return
      }
      notifyInstalledAgentSkillsChanged()
      advanceQueue()
    } finally {
      setRechecking(false)
    }
  }, [active, advanceQueue])

  if (!active) {
    return null
  }

  const command = active.manualCommand?.command
  const loading = installedState.loading || rechecking

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          snoozedKeysRef.current.add(active.uiKey)
          advanceQueue()
        }
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[640px]">
        <div className="px-6 pt-6 pr-14">
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.skills.ManagedAgentSkillSetupDialogHost.title',
                'Agent skill setup needed'
              )}
            </DialogTitle>
            <DialogDescription>{contextCopy}</DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex items-start gap-2 text-[13px] leading-snug text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            <p>{getManagedSkillFallbackDisplayMessage(active.reason)}</p>
          </div>
        </div>
        {command ? (
          <AgentSkillSetupPanel
            className="px-6 pt-4 pb-3"
            variant="inline"
            hideHeader
            title={translate(
              'auto.components.skills.ManagedAgentSkillSetupDialogHost.panelTitle',
              'Set up managed agent skill'
            )}
            description={contextCopy}
            command={command}
            installedCommand={installedCommand}
            terminalTitle={translate(
              'auto.components.skills.ManagedAgentSkillSetupDialogHost.terminalTitle',
              'Set up agent skill'
            )}
            terminalAriaLabel={translate(
              'auto.components.skills.ManagedAgentSkillSetupDialogHost.terminalAria',
              'Agent skill setup terminal'
            )}
            terminalWorktreeId={`managed-agent-skill-setup-${active.skillName}-${active.context}`}
            terminalHeightPx={240}
            installed={installedState.installed}
            loading={loading}
            error={installedState.error}
            installLabel={
              active.manualCommand?.kind === 'update'
                ? translate(
                    'auto.components.skills.ManagedAgentSkillSetupDialogHost.update',
                    'Update'
                  )
                : translate(
                    'auto.components.skills.ManagedAgentSkillSetupDialogHost.install',
                    'Install'
                  )
            }
            installedInstallLabel={translate(
              'auto.components.skills.ManagedAgentSkillSetupDialogHost.update',
              'Update'
            )}
            preInstallNotice={AGENT_SKILL_CLI_PREREQUISITE_NOTICE}
            isPrerequisiteAvailable={isOrcaCliAvailableOnPath}
            onBeforeOpenTerminal={prepareManagedAgentSkillSetupTerminal}
            onRecheck={recheck}
          />
        ) : (
          <div className="px-6 pt-4 pb-3">
            <Button type="button" variant="outline" size="sm" onClick={() => void recheck()}>
              <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
              {translate(
                'auto.components.skills.ManagedAgentSkillSetupDialogHost.recheck',
                'Re-check'
              )}
            </Button>
          </div>
        )}
        <DialogFooter className="px-6 pb-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setDismissed(active.uiKey)
              advanceQueue()
            }}
          >
            {translate(
              'auto.components.skills.ManagedAgentSkillSetupDialogHost.dontShowAgain',
              "Don't show again"
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              snoozedKeysRef.current.add(active.uiKey)
              advanceQueue()
            }}
          >
            {translate('auto.components.skills.ManagedAgentSkillSetupDialogHost.notNow', 'Not now')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function isDismissed(uiKey: string): boolean {
  try {
    return window.localStorage.getItem(`${DISMISS_STORAGE_PREFIX}${uiKey}`) === 'true'
  } catch {
    return false
  }
}

function setDismissed(uiKey: string): void {
  try {
    window.localStorage.setItem(`${DISMISS_STORAGE_PREFIX}${uiKey}`, 'true')
  } catch {
    // Local storage can be unavailable in constrained test/browser contexts.
  }
}
