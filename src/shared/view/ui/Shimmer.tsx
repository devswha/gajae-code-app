import * as React from 'react';

import { cn } from '../../../utils/cn';

interface ShimmerProps { children: string; className?: string; as?: React.ElementType; }

const shimmerClassName = [
  'inline-block animate-shimmer bg-size-[250%_100%] bg-clip-text text-transparent',
  'bg-[linear-gradient(90deg,transparent_33%,hsl(var(--foreground))_50%,transparent_67%),linear-gradient(hsl(var(--muted-foreground)),hsl(var(--muted-foreground)))]',
].join(' ');

const Shimmer = React.memo(function Shimmer(props: ShimmerProps) {
  const { as, children, className } = props;
  const Element = as ?? 'span';

  return <Element className={cn(shimmerClassName, className)}>{children}</Element>;
});
Shimmer.displayName = 'Shimmer';

export { Shimmer };
