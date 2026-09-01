"use client";

import * as React from 'react';
import { SendHorizonalIcon, SquareIcon } from 'lucide-react';

import { cn } from '../../../utils/cn';

import { Button } from './Button';
import Tooltip from './Tooltip';

type PromptInputStatus = 'ready' | 'submitted' | 'streaming' | 'error';
type PromptInputContextValue = { status: PromptInputStatus };

const promptInputContext = React.createContext<PromptInputContextValue | null>(null);

const usePromptInput = () => {
  const state = React.useContext(promptInputContext);
  if (state === null) {
    throw new Error('PromptInput components must be used within PromptInput');
  }
  return state;
};

export interface PromptInputProps extends React.FormHTMLAttributes<HTMLFormElement> { status?: PromptInputStatus; }

export const PromptInput = React.forwardRef<HTMLFormElement, PromptInputProps>(function PromptInput(
  { className, children, status = 'ready', ...formProps },
  ref
) {
  const state = React.useMemo(() => ({ status }), [status]);

  return (
    <promptInputContext.Provider value={state}>
      <form
        ref={ref}
        data-slot="prompt-input"
        className={cn(
          'relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-md shadow-black/3 transition-all duration-200 focus-within:border-border focus-within:shadow-lg focus-within:ring-1 focus-within:ring-primary/10',
          className
        )}
        {...formProps}
      >
        {children}
      </form>
    </promptInputContext.Provider>
  );
});
PromptInput.displayName = 'PromptInput';

type PromptInputSectionProps = React.HTMLAttributes<HTMLDivElement> & { slot: string; styles: string };

const PromptInputSection = React.forwardRef<HTMLDivElement, PromptInputSectionProps>(function PromptInputSection(
  { className, slot, styles, ...elementProps },
  ref
) {
  return <div ref={ref} data-slot={slot} className={cn(styles, className)} {...elementProps} />;
});

export const PromptInputHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function PromptInputHeader({ className, ...props }, ref) {
    return <PromptInputSection ref={ref} slot="prompt-input-header" styles="px-3 pt-3" className={className} {...props} />;
  }
);
PromptInputHeader.displayName = 'PromptInputHeader';

export const PromptInputBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function PromptInputBody({ className, ...props }, ref) {
    return <PromptInputSection ref={ref} slot="prompt-input-body" styles="relative" className={className} {...props} />;
  }
);
PromptInputBody.displayName = 'PromptInputBody';

export const PromptInputTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function PromptInputTextarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        data-slot="prompt-input-textarea"
        className={cn(
          'chat-input-placeholder block max-h-[40vh] w-full resize-none overflow-y-auto bg-transparent px-4 py-2 text-sm leading-6 text-foreground placeholder-muted-foreground/50 focus:outline-hidden sm:max-h-75',
          className
        )}
        {...props}
      />
    );
  }
);
PromptInputTextarea.displayName = 'PromptInputTextarea';

export const PromptInputFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function PromptInputFooter({ className, ...props }, ref) {
    return <PromptInputSection ref={ref} slot="prompt-input-footer" styles="flex items-center justify-between px-3 pt-0 pb-2" className={className} {...props} />;
  }
);
PromptInputFooter.displayName = 'PromptInputFooter';

export const PromptInputTools = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function PromptInputTools({ className, ...props }, ref) {
    return <PromptInputSection ref={ref} slot="prompt-input-tools" styles="flex items-center gap-1" className={className} {...props} />;
  }
);
PromptInputTools.displayName = 'PromptInputTools';

export interface PromptInputButtonTooltip { content: React.ReactNode; shortcut?: string; side?: 'top' | 'bottom' | 'left' | 'right'; }
export interface PromptInputButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { tooltip?: PromptInputButtonTooltip; }

function tooltipContents({ content, shortcut }: PromptInputButtonTooltip) {
  if (!shortcut) return content;
  return (
    <span className="flex items-center gap-1.5">
      {content}
      <kbd className="rounded bg-white/20 px-1 text-[10px]">{shortcut}</kbd>
    </span>
  );
}

export const PromptInputButton = React.forwardRef<HTMLButtonElement, PromptInputButtonProps>(function PromptInputButton(
  { className, tooltip, children, ...buttonProps },
  ref
) {
  const control = (
    <Button ref={ref} type="button" variant="ghost" size="icon" className={cn('h-8 w-8 [&_svg]:size-4', className)} {...buttonProps}>
      {children}
    </Button>
  );

  return tooltip ? <Tooltip content={tooltipContents(tooltip)} position={tooltip.side ?? 'top'}>{control}</Tooltip> : control;
});
PromptInputButton.displayName = 'PromptInputButton';

export interface PromptInputSubmitProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { status?: PromptInputStatus; }

export const PromptInputSubmit = React.forwardRef<HTMLButtonElement, PromptInputSubmitProps>(function PromptInputSubmit(
  { className, status: suppliedStatus, children, ...buttonProps },
  ref
) {
  const surroundingState = React.useContext(promptInputContext);
  const status = suppliedStatus ?? surroundingState?.status ?? 'ready';
  const shouldStop = status === 'submitted' || status === 'streaming';
  const icon = shouldStop
    ? <SquareIcon className="h-3.5 w-3.5 fill-current" />
    : <SendHorizonalIcon className="h-4 w-4" />;

  return (
    <Button
      ref={ref}
      type={shouldStop ? 'button' : 'submit'}
      variant="default"
      size="icon"
      className={cn('h-8 w-8 shrink-0 rounded-full', className)}
      {...buttonProps}
    >
      {children ?? icon}
    </Button>
  );
});
PromptInputSubmit.displayName = 'PromptInputSubmit';

export { usePromptInput };
