import { TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Tells the reader when a tool returned less than it found.
 *
 * The runtime reports this as structured `meta.limits` on the tool result: a
 * search that stopped at its match cap, a listing that stopped at its result
 * cap. None of it appears in the text the model receives, so without this the
 * transcript shows a truncated answer that looks complete and the reader has
 * no way to know a wider run would return more.
 *
 * Deliberately not an error. Hitting a cap is normal and often fine; it just
 * has to be visible.
 */

type Limit = { reached: number; suggestion: number };

type Limits = {
  matchLimit?: Limit;
  resultLimit?: Limit;
  headLimit?: Limit;
  columnTruncated?: { maxColumn: number };
};

const limit = (value: unknown): Limit | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const reached = record.reached;
  const suggestion = record.suggestion;
  // A cap of zero is meaningless and a non-number is not a cap at all; either
  // would render a confident sentence about nothing.
  return typeof reached === 'number' && reached > 0 && typeof suggestion === 'number'
    ? { reached, suggestion }
    : undefined;
};

/** Reads `meta.limits` off a tool result, tolerating every shape but the right one. */
export function readToolResultLimits(toolResult: unknown): Limits | undefined {
  if (!toolResult || typeof toolResult !== 'object') return undefined;
  const details = (toolResult as Record<string, unknown>).toolUseResult;
  if (!details || typeof details !== 'object') return undefined;
  const meta = (details as Record<string, unknown>).meta;
  if (!meta || typeof meta !== 'object') return undefined;
  const raw = (meta as Record<string, unknown>).limits;
  if (!raw || typeof raw !== 'object') return undefined;

  const record = raw as Record<string, unknown>;
  const matchLimit = limit(record.matchLimit);
  const resultLimit = limit(record.resultLimit);
  const headLimit = limit(record.headLimit);
  const maxColumn = (record.columnTruncated as Record<string, unknown> | undefined)?.maxColumn;
  const columnTruncated = typeof maxColumn === 'number' && maxColumn > 0
    ? { maxColumn }
    : undefined;

  if (!matchLimit && !resultLimit && !headLimit && !columnTruncated) return undefined;
  return { matchLimit, resultLimit, headLimit, columnTruncated };
}

export function ToolResultLimits({ toolResult }: { toolResult: unknown }) {
  const { t } = useTranslation();
  const limits = readToolResultLimits(toolResult);
  if (!limits) return null;

  const capped = limits.matchLimit ?? limits.resultLimit ?? limits.headLimit;

  return (
    <div className="flex items-start gap-1.5 py-0.5 pl-2 text-xs text-muted-foreground">
      <TriangleAlertIcon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        {capped
          ? t('tools.limitReached', { reached: capped.reached, suggestion: capped.suggestion })
          : t('tools.columnTruncated', { maxColumn: limits.columnTruncated?.maxColumn })}
      </span>
    </div>
  );
}
