import * as React from 'react';

import { cn } from '../../../utils/cn';

import { Alert } from './Alert';
import { Button } from './Button';

type ApprovalState = 'pending' | 'approved' | 'rejected' | undefined;
type ConfirmationContextValue = { approval: ApprovalState };

const confirmationContext = React.createContext<ConfirmationContextValue | null>(null);

const useConfirmation = () => {
  const confirmation = React.useContext(confirmationContext);
  if (confirmation === null) {
    throw new Error('Confirmation components must be used within Confirmation');
  }
  return confirmation;
};

export interface ConfirmationProps extends React.HTMLAttributes<HTMLDivElement> { approval?: ApprovalState; }

export const Confirmation: React.FC<ConfirmationProps> = ({ className, approval = 'pending', children, ...props }) => {
  const state = React.useMemo(() => ({ approval }), [approval]);
  return (
    <confirmationContext.Provider value={state}>
      <Alert className={cn('flex flex-col gap-2', className)} {...props}>{children}</Alert>
    </confirmationContext.Provider>
  );
};
Confirmation.displayName = 'Confirmation';

export type ConfirmationTitleProps = React.HTMLAttributes<HTMLDivElement>;

export const ConfirmationTitle: React.FC<ConfirmationTitleProps> = ({ className, ...props }) => (
  <div
    data-slot="confirmation-title"
    className={cn('inline text-sm text-muted-foreground', className)}
    {...props}
  />
);
ConfirmationTitle.displayName = 'ConfirmationTitle';

type ConfirmationStateChildren = { children?: React.ReactNode };

function ConfirmationState({ approval, children }: ConfirmationStateChildren & { approval: Exclude<ApprovalState, undefined> }) {
  return useConfirmation().approval === approval ? <>{children}</> : null;
}

export interface ConfirmationRequestProps { children?: React.ReactNode; }
export const ConfirmationRequest: React.FC<ConfirmationRequestProps> = ({ children }) => (
  <ConfirmationState approval="pending">{children}</ConfirmationState>
);
ConfirmationRequest.displayName = 'ConfirmationRequest';

export type ConfirmationActionsProps = React.HTMLAttributes<HTMLDivElement>;

export const ConfirmationActions: React.FC<ConfirmationActionsProps> = ({ className, ...props }) => {
  const { approval } = useConfirmation();
  if (approval !== 'pending') return null;
  return (
    <div
      data-slot="confirmation-actions"
      className={cn('flex items-center justify-end gap-2 self-end', className)}
      {...props}
    />
  );
};
ConfirmationActions.displayName = 'ConfirmationActions';

export type ConfirmationActionProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'outline' | 'ghost' | 'destructive'; };

export const ConfirmationAction: React.FC<ConfirmationActionProps> = ({ variant = 'default', ...props }) => (
  <Button className="h-8 px-3 text-sm" variant={variant} type="button" {...props} />
);
ConfirmationAction.displayName = 'ConfirmationAction';
