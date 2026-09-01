import * as React from 'react';

import { cn } from '../../../utils/cn';

export type QueueItemStatus = 'completed' | 'in_progress' | 'pending';

const queueStatusContext = React.createContext<QueueItemStatus | undefined>(undefined);

function useQueueItemStatus(): QueueItemStatus {
  const status = React.useContext(queueStatusContext);
  if (status === undefined) throw new Error('QueueItem sub-components must be used within <QueueItem>');
  return status;
}

function StatusMark({ status }: { status: QueueItemStatus }) {
  switch (status) {
    case 'completed':
      return <svg className="h-3.5 w-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
    case 'in_progress':
      return <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />;
    case 'pending':
      return <svg className="h-3.5 w-3.5 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" strokeWidth={2} /></svg>;
  }
}

export const Queue = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function Queue({ className, ...attributes }, ref) {
  return <div ref={ref} data-slot="queue" role="list" className={cn('space-y-0.5', className)} {...attributes} />;
});
Queue.displayName = 'Queue';

export interface QueueItemProps extends React.HTMLAttributes<HTMLDivElement> { status?: QueueItemStatus; }

export const QueueItem = React.forwardRef<HTMLDivElement, QueueItemProps>(function QueueItem({ status = 'pending', className, children, ...attributes }, ref) {
  return (
    <queueStatusContext.Provider value={status}>
      <div ref={ref} data-slot="queue-item" data-status={status} role="listitem" className={cn('flex items-start gap-2 py-0.5', className)} {...attributes}>
        {children}
      </div>
    </queueStatusContext.Provider>
  );
});
QueueItem.displayName = 'QueueItem';

export const QueueItemIndicator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function QueueItemIndicator({ className, ...attributes }, ref) {
  return <div ref={ref} data-slot="queue-item-indicator" aria-hidden="true" className={cn('mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center', className)} {...attributes}><StatusMark status={useQueueItemStatus()} /></div>;
});
QueueItemIndicator.displayName = 'QueueItemIndicator';

export const QueueItemContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function QueueItemContent({ className, children, ...attributes }, ref) {
  const styles: Record<QueueItemStatus, string> = {
    completed: 'text-muted-foreground line-through',
    in_progress: 'font-medium text-foreground',
    pending: 'text-foreground',
  };
  return <div ref={ref} data-slot="queue-item-content" className={cn('min-w-0 flex-1 text-xs', styles[useQueueItemStatus()], className)} {...attributes}>{children}</div>;
});
QueueItemContent.displayName = 'QueueItemContent';
