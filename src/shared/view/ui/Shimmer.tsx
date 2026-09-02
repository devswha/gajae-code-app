import * as React from 'react';

import { cn } from '../../../utils/cn';

interface ShimmerProps { children: string; className?: string; as?: React.ElementType; }

/**
 * Muted text with a band of the foreground colour sliding across it, the
 * "thinking" glow of Cursor and Codex. The band is the first gradient layer,
 * clipped to the glyphs, over a flat muted layer; `shimmer` in `index.css`
 * moves it, and is tuned with the sizes here - change one, change the other.
 */
const shimmerClassName = [
  'inline-block animate-shimmer bg-size-[200%_100%] bg-clip-text text-transparent',
  'bg-[linear-gradient(90deg,transparent_35%,hsl(var(--foreground))_50%,transparent_65%),linear-gradient(hsl(var(--muted-foreground)),hsl(var(--muted-foreground)))]',
].join(' ');

const Shimmer = React.memo(function Shimmer(props: ShimmerProps) {
  const { as, children, className } = props;
  const Element = as ?? 'span';

  return <Element className={cn(shimmerClassName, className)}>{children}</Element>;
});
Shimmer.displayName = 'Shimmer';

export { Shimmer };
