import { useTranslation } from 'react-i18next';

type SessionStatusSummaryProps = {
  /** Snapshot read off the live session at each turn end; null before the first turn. */
  sessionState: Record<string, unknown> | null;
};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** `/Users/me/repos/app` -> `~/repos/app`, then the last two segments. */
function compactPath(path: string): string {
  const home = path.replace(/^\/(?:Users|home)\/[^/]+/, '~');
  const segments = home.split('/').filter(Boolean);
  if (home.startsWith('~') || segments.length <= 2) return home;
  return `…/${segments.slice(-2).join('/')}`;
}

/** Drops a provider prefix so `openai/gpt-5-codex` reads as `gpt-5-codex`. */
const compactModel = (modelId: string): string => modelId.split('/').pop() ?? modelId;

/**
 * The facts the TUI keeps in its footer: which model is answering, at what
 * reasoning level, in which directory, and how full the context is.
 *
 * The app showed only a raw token count, because the context window it is a
 * fraction of never left the server. `12.3K` says nothing on its own — the same
 * number is comfortable in a 200k window and nearly fatal in a 32k one.
 *
 * Each field renders only when the session actually reported it. There is no
 * fallback context size: guessing one would print a confident percentage that
 * is simply wrong for the model in use.
 */
export default function SessionStatusSummary({ sessionState }: SessionStatusSummaryProps) {
  const { t } = useTranslation('chat');
  if (!sessionState) return null;

  const model = text(sessionState.modelId);
  const thinking = text(sessionState.thinkingLevel);
  const cwd = text(sessionState.cwd);
  const percent = finite(sessionState.contextPercent);
  const contextWindow = finite(sessionState.contextWindow);

  const parts: Array<{ key: string; label: string; title: string }> = [];

  if (model) {
    parts.push({ key: 'model', label: compactModel(model), title: model });
  }
  if (thinking && thinking !== 'default') {
    parts.push({
      key: 'thinking',
      label: thinking,
      title: t('input.status.reasoning', { defaultValue: 'Reasoning effort' }),
    });
  }
  if (cwd) {
    parts.push({ key: 'cwd', label: compactPath(cwd), title: cwd });
  }
  if (percent !== undefined && contextWindow !== undefined) {
    const used = finite(sessionState.contextTokens);
    // Built without interpolation on purpose: these are numbers, they need no
    // translation, and a `{{window}}` placeholder leaks verbatim anywhere i18n
    // has not initialised. Showing both figures also beats restating the
    // percentage already on screen.
    parts.push({
      key: 'context',
      label: `${Math.round(percent)}%`,
      title: used !== undefined
        ? `${used.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`
        : `${contextWindow.toLocaleString()} token context`,
    });
  }

  if (parts.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground/70">
      {parts.map((part, index) => (
        <span key={part.key} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && <span aria-hidden className="text-muted-foreground/40">·</span>}
          <span className="truncate" title={part.title}>{part.label}</span>
        </span>
      ))}
    </div>
  );
}
