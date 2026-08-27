import { useTranslation } from 'react-i18next';
import { AlertTriangleIcon, HelpCircleIcon } from 'lucide-react';

interface CommandGateCardProps {
  /** The exact text that will be sent on confirm. */
  text: string;
  /** One sentence describing what running it does. */
  summary: string;
  /** False when the app has no entry for this form and is asking by default. */
  classified: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation for a runtime slash command that has not been sent yet.
 *
 * Sits in the same slot as the queued-draft card and the tool-approval banner
 * so the affordance is one the user already recognizes. The difference is when
 * it fires: the approval banner asks about work the server has begun, while
 * this one holds the text client-side, so cancelling means the command never
 * started rather than that it was interrupted.
 */
export default function CommandGateCard({
  text,
  summary,
  classified,
  onConfirm,
  onCancel,
}: CommandGateCardProps) {
  const { t } = useTranslation('chat');
  const Icon = classified ? AlertTriangleIcon : HelpCircleIcon;

  return (
    <div
      role="alertdialog"
      aria-label={t('input.gate.label', { defaultValue: 'Confirm command' })}
      className="settings-content-enter mx-auto mb-2 max-w-chat rounded-xl border border-destructive/30 bg-destructive/[0.04] px-3 py-2.5"
    >
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-destructive/80" aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-destructive/80">
            {classified
              ? t('input.gate.label', { defaultValue: 'Confirm command' })
              : t('input.gate.unknownLabel', { defaultValue: 'Unrecognized command' })}
          </div>
          <p className="mt-0.5 break-words font-mono text-sm text-foreground/90">{text}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{summary}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {t('input.gate.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-destructive px-2.5 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
          >
            {t('input.gate.run', { defaultValue: 'Run' })}
          </button>
        </div>
      </div>
    </div>
  );
}
