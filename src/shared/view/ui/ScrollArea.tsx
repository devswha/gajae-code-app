import * as React from 'react';

import { cn } from '../../../utils/cn';

type ScrollAreaProps = React.HTMLAttributes<HTMLDivElement>;

const scrollViewportStyle = { WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' } as const;

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  attributes,
  viewportRef,
) {
  const { children, className, ...containerAttributes } = attributes;

  return (
    <div className={cn(className, 'relative overflow-hidden')} {...containerAttributes}>
      {/* The viewport owns scrolling so the shell can keep its inherited corners. */}
      <div
        ref={viewportRef}
        className="h-full w-full overflow-auto rounded-[inherit]"
        style={scrollViewportStyle}
      >
        {children}
      </div>
    </div>
  );
});

ScrollArea.displayName = 'ScrollArea';

export { ScrollArea };
