import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';

import { cn } from '../../../utils/cn';

const Command = React.forwardRef<React.ElementRef<typeof CommandPrimitive>, React.ComponentPropsWithoutRef<typeof CommandPrimitive>>(function Command({ className, ...attributes }, ref) {
  return <CommandPrimitive ref={ref} className={cn('flex flex-col', className)} {...attributes} />;
});
Command.displayName = CommandPrimitive.displayName;

const CommandInput = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Input>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>>(function CommandInput({ className, ...attributes }, ref) {
  return (
    <div className="flex items-center border-b px-3">
      <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <CommandPrimitive.Input ref={ref} className={cn('flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-hidden', 'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50', className)} {...attributes} />
    </div>
  );
});
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<React.ElementRef<typeof CommandPrimitive.List>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>>(function CommandList({ className, ...attributes }, ref) {
  return <CommandPrimitive.List ref={ref} className={cn('max-h-75 overflow-x-hidden overflow-y-auto', className)} {...attributes} />;
});
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Empty>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>>(function CommandEmpty(attributes, ref) {
  return <CommandPrimitive.Empty ref={ref} className="py-6 text-center text-sm text-muted-foreground" {...attributes} />;
});
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Group>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>>(function CommandGroup({ className, ...attributes }, ref) {
  const groupClass = cn('overflow-hidden p-1 text-foreground', '**:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground', className);
  return <CommandPrimitive.Group ref={ref} className={groupClass} {...attributes} />;
});
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandItem = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Item>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>>(function CommandItem({ className, ...attributes }, ref) {
  return <CommandPrimitive.Item ref={ref} className={cn('relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none', 'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground', 'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50', className)} {...attributes} />;
});
CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandSeparator = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Separator>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>>(function CommandSeparator({ className, ...attributes }, ref) {
  return <CommandPrimitive.Separator ref={ref} className={cn('-mx-1 h-px bg-border', className)} {...attributes} />;
});
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator };
