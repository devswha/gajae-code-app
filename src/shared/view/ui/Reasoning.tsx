"use client";

import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { BrainIcon, ChevronDownIcon } from 'lucide-react';

import { cn } from '../../../utils/cn';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './Collapsible';
import { Shimmer } from './Shimmer';

type ReasoningContextValue = {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
};

const reasoningContext = React.createContext<ReasoningContextValue | null>(null);
const AUTO_CLOSE_DELAY = 1000;
const MILLISECONDS_PER_SECOND = 1000;

const useReasoning = () => {
  const state = React.useContext(reasoningContext);
  if (state === null) {
    throw new Error('Reasoning components must be used within Reasoning');
  }
  return state;
};

export interface ReasoningProps extends React.HTMLAttributes<HTMLDivElement> {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
}

function useReasoningOpenState(open: boolean | undefined, initialOpen: boolean, onOpenChange: ((open: boolean) => void) | undefined) {
  const [localOpen, setLocalOpen] = React.useState(initialOpen);
  const controlled = open !== undefined;
  const isOpen = controlled ? open : localOpen;
  const setIsOpen = React.useCallback((nextOpen: boolean) => {
    if (!controlled) setLocalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [controlled, onOpenChange]);

  return { isOpen, setIsOpen };
}

function useReasoningDuration(isStreaming: boolean, suppliedDuration: number | undefined) {
  const [duration, setDuration] = React.useState<number | undefined>(suppliedDuration);
  const startedAt = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (suppliedDuration !== undefined) setDuration(suppliedDuration);
  }, [suppliedDuration]);

  React.useEffect(() => {
    if (isStreaming) {
      if (startedAt.current === null) startedAt.current = Date.now();
      return;
    }
    if (startedAt.current !== null) {
      setDuration(Math.ceil((Date.now() - startedAt.current) / MILLISECONDS_PER_SECOND));
      startedAt.current = null;
    }
  }, [isStreaming]);

  return duration;
}

export const Reasoning: React.FC<ReasoningProps> = ({
  className,
  isStreaming = false,
  open,
  defaultOpen,
  onOpenChange,
  duration: suppliedDuration,
  children,
  ...props
}) => {
  const initiallyOpen = defaultOpen ?? isStreaming;
  const preventStreamingExpansion = defaultOpen === false;
  const { isOpen, setIsOpen } = useReasoningOpenState(open, initiallyOpen, onOpenChange);
  const duration = useReasoningDuration(isStreaming, suppliedDuration);
  const streamed = React.useRef(isStreaming);
  const [closedAfterStream, setClosedAfterStream] = React.useState(false);

  React.useEffect(() => {
    if (isStreaming) streamed.current = true;
  }, [isStreaming]);

  React.useEffect(() => {
    if (isStreaming && !isOpen && !preventStreamingExpansion) setIsOpen(true);
  }, [isOpen, isStreaming, preventStreamingExpansion, setIsOpen]);

  React.useEffect(() => {
    if (!streamed.current || isStreaming || !isOpen || closedAfterStream) return;
    const closeTimer = setTimeout(() => {
      setIsOpen(false);
      setClosedAfterStream(true);
    }, AUTO_CLOSE_DELAY);
    return () => clearTimeout(closeTimer);
  }, [closedAfterStream, isOpen, isStreaming, setIsOpen]);

  const state = React.useMemo(
    () => ({ duration, isOpen, isStreaming, setIsOpen }),
    [duration, isOpen, isStreaming, setIsOpen]
  );

  return (
    <reasoningContext.Provider value={state}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className={cn('not-prose', className)} {...props}>
        {children}
      </Collapsible>
    </reasoningContext.Provider>
  );
};
Reasoning.displayName = 'Reasoning';

export interface ReasoningTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  getThinkingMessage?: (isStreaming: boolean, duration: number | undefined, t: ThinkingTranslator) => React.ReactNode;
}

type ThinkingTranslator = (key: string, options?: Record<string, unknown>) => string;

function standardThinkingMessage(isStreaming: boolean, duration: number | undefined, t: ThinkingTranslator): React.ReactNode {
  if (isStreaming || duration === 0) return <Shimmer>{t('reasoning.thinking')}</Shimmer>;
  if (duration === undefined) return <span>{t('reasoning.thoughtBriefly')}</span>;
  return <span>{t('reasoning.thoughtFor', { count: duration })}</span>;
}

export const ReasoningTrigger: React.FC<ReasoningTriggerProps> = ({
  className,
  children,
  getThinkingMessage = standardThinkingMessage,
  ...props
}) => {
  const { duration, isOpen, isStreaming } = useReasoning();
  const { t } = useTranslation('chat');
  const label = children ?? (
    <>
      <BrainIcon className="h-3.5 w-3.5" />
      {getThinkingMessage(isStreaming, duration, t as ThinkingTranslator)}
      <ChevronDownIcon className={cn('h-3 w-3 transition-transform', isOpen ? 'rotate-180' : 'rotate-0')} />
    </>
  );

  return (
    <CollapsibleTrigger
      className={cn(
        'flex w-fit items-center gap-1.5 text-xs text-muted-foreground/70 transition-colors hover:text-foreground',
        className
      )}
      {...props}
    >
      {label}
    </CollapsibleTrigger>
  );
};
ReasoningTrigger.displayName = 'ReasoningTrigger';

export interface ReasoningContentProps extends React.HTMLAttributes<HTMLDivElement> { children: React.ReactNode; }

export const ReasoningContent: React.FC<ReasoningContentProps> = ({ className, children, ...props }) => (
  <CollapsibleContent className={cn('mt-4 text-sm text-muted-foreground', className)} {...props}>
    {children}
  </CollapsibleContent>
);
ReasoningContent.displayName = 'ReasoningContent';
