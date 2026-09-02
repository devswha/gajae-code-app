import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';

import { Shimmer } from '../../../shared/view/ui';
import type { ChatMessage } from '../types/types';
import { useElapsedSeconds } from '../hooks/useElapsedSeconds';
import { formatElapsed } from '../utils/elapsed';
import { formatLiveActivity } from '../utils/toolActivity';
import type { LiveActivity } from '../utils/toolActivity';
import { groupConsecutiveTools } from '../utils/toolGrouping';
import { formatTurnWorkCounts, isPendingWorkBlock, summarizeTurnWork } from '../utils/turnWork';
import type { TurnWorkBlockItem } from '../utils/turnWork';

import GroupedMessageList from './GroupedMessageList';
import type { MessageRenderProps } from './GroupedMessageList';
import RunningActivityRow from './RunningActivityRow';

interface TurnWorkBlockProps extends MessageRenderProps {
  block: TurnWorkBlockItem;
  prevMessage: ChatMessage | null;
  /** The viewed session's run is in flight and this block is the turn it is working on. */
  running?: boolean;
  /** What the run is doing now; shown in the header while `running`. */
  liveActivity?: LiveActivity | null;
  /** When the run started (client clock), for the header's elapsed time while `running`. */
  runStartedAt?: number | null;
}

const SEPARATOR = ' · ';
const THINKING: LiveActivity = { kind: 'thinking' };

/**
 * One row for a whole turn's tool activity.
 *
 * Running: `Working · Reading src/foo.ts · 12s` - the run's one status line,
 * there is no other. Before the first call the block is empty and the row is
 * just `Thinking… · 3s` with the pulse, nothing to open. Finished: `Worked
 * for 42s · 5 files read · 3 commands · 2 edits`, counts by category, the
 * duration omitted when the transcript's timestamps cannot support one. A
 * failure is never hidden: the row carries the error label and how many calls
 * failed, but the body stays folded at every level that has a block -
 * unfolding a turn's whole work for one non-zero exit would undo the fold.
 *
 * Open, the body is exactly what the pane would have rendered - same-tool
 * groups, cards, subagent containers - so nothing is lost, and every card
 * keeps its own fold.
 */
export default function TurnWorkBlock({ block, prevMessage, running = false, liveActivity, runStartedAt = null, ...renderProps }: TurnWorkBlockProps) {
  if (isPendingWorkBlock(block)) {
    return <RunningActivityRow liveActivity={liveActivity} runStartedAt={running ? runStartedAt : null} variant="pending-block" />;
  }
  return <FoldedTurnWork block={block} prevMessage={prevMessage} running={running} liveActivity={liveActivity} runStartedAt={runStartedAt} {...renderProps} />;
}

function FoldedTurnWork({ block, prevMessage, running = false, liveActivity, runStartedAt = null, ...renderProps }: TurnWorkBlockProps) {
  const { t } = useTranslation('chat');
  const [isExpanded, setIsExpanded] = useState(false);
  const bodyId = useId();
  const elapsedSeconds = useElapsedSeconds(running ? runStartedAt : null);
  const summary = summarizeTurnWork(block);
  const items = groupConsecutiveTools(block.messages, renderProps.density);

  let leading: string;
  let detail: string[];
  if (running) {
    leading = t('workBlock.working', { defaultValue: 'Working' });
    detail = [formatLiveActivity(liveActivity ?? THINKING, t)];
    if (runStartedAt !== null) detail.push(formatElapsed(elapsedSeconds, t));
  } else {
    leading = summary.durationMs === null
      ? t('workBlock.worked', { defaultValue: 'Worked' })
      : t('workBlock.workedFor', { duration: formatElapsed(summary.durationMs / 1000, t), defaultValue: 'Worked for {{duration}}' });
    detail = formatTurnWorkCounts(summary, t);
  }

  return (
    <div className="chat-message tool px-3 sm:px-0" data-message-timestamp={block.timestamp || undefined} data-work-block={running ? 'running' : 'finished'}>
      <button
        type="button"
        className="group flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-muted/30"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
        aria-controls={bodyId}
        aria-label={t('workBlock.toggle', { defaultValue: "Show or hide this turn's tool activity" })}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          aria-hidden
        />
        {running ? (
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />
        ) : null}
        <span className="shrink-0 font-medium text-foreground">{leading}</span>
        {detail.length > 0 && (
          <span className="min-w-0 truncate text-muted-foreground">
            <span aria-hidden>{SEPARATOR}</span>
            {running ? (
              <>
                <Shimmer className="max-w-full truncate">{`${detail[0]}…`}</Shimmer>
                {detail.slice(1).map((segment) => (
                  <span key={segment} className="tabular-nums"><span aria-hidden>{SEPARATOR}</span>{segment}</span>
                ))}
              </>
            ) : detail.join(SEPARATOR)}
          </span>
        )}
        {summary.failed > 0 && (
          <span className="shrink-0 text-[11px] text-destructive">
            {t('tools.error')}
            <span aria-hidden>{SEPARATOR}</span>
            {t('workBlock.failed', { count: summary.failed, defaultValue: '{{count}} failed' })}
          </span>
        )}
      </button>

      {isExpanded && (
        <div id={bodyId} className="mt-2 ml-1.5 space-y-3 border-l border-border/60 pl-3 sm:space-y-4">
          <GroupedMessageList items={items} prevMessage={prevMessage} {...renderProps} />
        </div>
      )}
    </div>
  );
}
