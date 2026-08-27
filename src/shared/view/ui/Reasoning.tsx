"use client";

import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { BrainIcon, ChevronDownIcon } from 'lucide-react';

import { cn } from '../../../utils/cn';

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './Collapsible';
import { Shimmer } from './Shimmer';

/* ─── Context ────────────────────────────────────────────────────── */

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
}

const ReasoningContext = React.createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
  const context = React.useContext(ReasoningContext);
  if (!context) {
    throw new Error('Reasoning components must be used within Reasoning');
  }
  return context;
};

/* ─── Reasoning (root) ───────────────────────────────────────────── */

const AUTO_CLOSE_DELAY = 1000;
const MS_IN_S = 1000;

export interface ReasoningProps extends React.HTMLAttributes<HTMLDivElement> {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
}

export const Reasoning = React.memo<ReasoningProps>(
  ({
    className,
    isStreaming = false,
    open: controlledOpen,
    defaultOpen,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }) => {
    const resolvedDefaultOpen = defaultOpen ?? isStreaming;
    const isExplicitlyClosed = defaultOpen === false;

    // Controllable open state
    const [internalOpen, setInternalOpen] = React.useState(resolvedDefaultOpen);
    const isControlled = controlledOpen !== undefined;
    const isOpen = isControlled ? controlledOpen : internalOpen;
    const setIsOpen = React.useCallback(
      (next: boolean) => {
        if (!isControlled) setInternalOpen(next);
        onOpenChange?.(next);
      },
      [isControlled, onOpenChange]
    );

    // Duration tracking
    const [duration, setDuration] = React.useState<number | undefined>(durationProp);
    const hasEverStreamedRef = React.useRef(isStreaming);
    const [hasAutoClosed, setHasAutoClosed] = React.useState(false);
    const startTimeRef = React.useRef<number | null>(null);

    // Sync external duration prop
    React.useEffect(() => {
      if (durationProp !== undefined) setDuration(durationProp);
    }, [durationProp]);

    // Track streaming start/end for duration
    React.useEffect(() => {
      if (isStreaming) {
        hasEverStreamedRef.current = true;
        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now();
        }
      } else if (startTimeRef.current !== null) {
        setDuration(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S));
        startTimeRef.current = null;
      }
    }, [isStreaming]);

    // Auto-open when streaming starts
    React.useEffect(() => {
      if (isStreaming && !isOpen && !isExplicitlyClosed) {
        setIsOpen(true);
      }
    }, [isStreaming, isOpen, setIsOpen, isExplicitlyClosed]);

    // Auto-close after streaming ends
    React.useEffect(() => {
      if (hasEverStreamedRef.current && !isStreaming && isOpen && !hasAutoClosed) {
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosed(true);
        }, AUTO_CLOSE_DELAY);
        return () => clearTimeout(timer);
      }
    }, [isStreaming, isOpen, setIsOpen, hasAutoClosed]);

    const contextValue = React.useMemo(
      () => ({ duration, isOpen, isStreaming, setIsOpen }),
      [duration, isOpen, isStreaming, setIsOpen]
    );

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          open={isOpen}
          onOpenChange={setIsOpen}
          className={cn('not-prose', className)}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  }
);
Reasoning.displayName = 'Reasoning';

/* ─── ReasoningTrigger ───────────────────────────────────────────── */

export interface ReasoningTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  getThinkingMessage?: (isStreaming: boolean, duration: number | undefined, t: ThinkingTranslator) => React.ReactNode;
}

type ThinkingTranslator = (key: string, options?: Record<string, unknown>) => string;

const defaultGetThinkingMessage = (
  isStreaming: boolean,
  duration: number | undefined,
  t: ThinkingTranslator,
): React.ReactNode => {
  if (isStreaming || duration === 0) {
    return <Shimmer>{t('reasoning.thinking')}</Shimmer>;
  }
  if (duration === undefined) {
    return <span>{t('reasoning.thoughtBriefly')}</span>;
  }
  return <span>{t('reasoning.thoughtFor', { count: duration })}</span>;
};

export const ReasoningTrigger = React.memo<ReasoningTriggerProps>(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    ...props
  }) => {
    const { isStreaming, isOpen, duration } = useReasoning();
    const { t } = useTranslation('chat');

    return (
      <CollapsibleTrigger
        // A marginal note about how the answer was reached, not the answer:
        // it sits at label size, only as wide as its text, and stays quiet
        // until hovered. Several of these can appear in a single turn.
        className={cn(
          'flex w-fit items-center gap-1.5 text-xs text-muted-foreground/70 transition-colors hover:text-foreground',
          className
        )}
        {...props}
      >
        {children ?? (
          <>
            <BrainIcon className="h-3.5 w-3.5" />
            {getThinkingMessage(isStreaming, duration, t as ThinkingTranslator)}
            <ChevronDownIcon
              className={cn(
                'h-3 w-3 transition-transform',
                isOpen ? 'rotate-180' : 'rotate-0'
              )}
            />
          </>
        )}
      </CollapsibleTrigger>
    );
  }
);
ReasoningTrigger.displayName = 'ReasoningTrigger';

/* ─── ReasoningContent ───────────────────────────────────────────── */

export interface ReasoningContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const ReasoningContent = React.memo<ReasoningContentProps>(
  ({ className, children, ...props }) => (
    <CollapsibleContent
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    >
      {children}
    </CollapsibleContent>
  )
);
ReasoningContent.displayName = 'ReasoningContent';
