import { Activity, Loader2 } from 'lucide-react'
import type {
  DiagnosticsStatusPayload,
  PerfDumpProgressPayload
} from '../../../../preload/api-types'
import { Button } from '../ui/button'
import { translate } from '@/i18n/i18n'

type PerfDumpStage = PerfDumpProgressPayload['stage'] | null

export function PrivacyPerfDumpControls({
  status,
  capturing,
  onCapture
}: {
  readonly status: DiagnosticsStatusPayload | null
  readonly capturing: boolean
  readonly onCapture: () => Promise<void>
}): React.JSX.Element {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!status?.perfDumpEnabled || capturing}
      title={
        status && !status.perfDumpEnabled
          ? translate(
              'auto.components.settings.PrivacyPerfDumpControls.a90900c24d',
              'Performance debug dumps are disabled.'
            )
          : undefined
      }
      onClick={() => void onCapture()}
    >
      {capturing ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Activity className="size-3.5" />
      )}
      {translate(
        'auto.components.settings.PrivacyPerfDumpControls.18f7cad8ee',
        'Capture performance dump'
      )}
    </Button>
  )
}

export function getPerfDumpDescription(stage: PerfDumpStage): string {
  if (stage === 'metrics') {
    return translate(
      'auto.components.settings.PrivacyPerfDumpControls.ed819b5b0a',
      'Collecting renderer metrics…'
    )
  }
  if (stage === 'trace') {
    return translate(
      'auto.components.settings.PrivacyPerfDumpControls.7f6c7cc90f',
      'Recording activity trace (10s)…'
    )
  }
  if (stage === 'heap') {
    return translate(
      'auto.components.settings.PrivacyPerfDumpControls.20f8c48f16',
      'Capturing memory snapshot…'
    )
  }
  if (stage === 'compressing') {
    return translate('auto.components.settings.PrivacyPerfDumpControls.05d8e75876', 'Compressing…')
  }
  return translate(
    'auto.components.settings.PrivacyPerfDumpControls.581d264c8c',
    'Records about 10 seconds of app activity and a memory snapshot of the interface. May include terminal text, file paths, and page titles; saved to your computer only — nothing is uploaded.'
  )
}
