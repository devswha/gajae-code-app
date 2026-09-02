import * as React from 'react';

import { cn } from '../../../utils/cn';

type CollapsibleState = { expanded: boolean; update: (next: boolean) => void; };
interface CollapsibleProps extends React.HTMLAttributes<HTMLDivElement> { defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; }

const collapsibleState = React.createContext<CollapsibleState | null>(null);

function useCollapsible() {
  const state = React.useContext(collapsibleState);
  if (state === null) throw new Error('Collapsible components must be used within <Collapsible>');
  return { open: state.expanded, onOpenChange: state.update };
}

const Collapsible = React.forwardRef<HTMLDivElement, CollapsibleProps>(function Collapsible({ defaultOpen = false, open, onOpenChange, className, children, ...attributes }, ref) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const expanded = open === undefined ? uncontrolledOpen : open;
  const update = (next: boolean) => {
    if (open === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return <collapsibleState.Provider value={{ expanded, update }}><div ref={ref} data-state={expanded ? 'open' : 'closed'} className={className} {...attributes}>{children}</div></collapsibleState.Provider>;
});
Collapsible.displayName = 'Collapsible';

const CollapsibleTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(function CollapsibleTrigger({ onClick, children, className, ...attributes }, ref) {
  const { open, onOpenChange } = useCollapsible();
  const toggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    onOpenChange(!open);
    onClick?.(event);
  };
  return <button ref={ref} type="button" aria-expanded={open} data-state={open ? 'open' : 'closed'} onClick={toggle} className={className} {...attributes}>{children}</button>;
});
CollapsibleTrigger.displayName = 'CollapsibleTrigger';

const CollapsibleContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function CollapsibleContent({ className, children, ...attributes }, ref) {
  const { open } = useCollapsible();
  const row = open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]';
  return (
    <div ref={ref} data-state={open ? 'open' : 'closed'} className={cn('grid transition-[grid-template-rows] duration-200 ease-out', row, className)} {...attributes}>
      <div className="overflow-hidden">{open ? children : null}</div>
    </div>
  );
});
CollapsibleContent.displayName = 'CollapsibleContent';

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
