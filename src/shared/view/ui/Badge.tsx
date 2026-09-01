import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../../utils/cn';

const badgeVariantClasses = {
  default: 'border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary/80',
  secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
  destructive: 'border-transparent bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/80',
  outline: 'text-foreground',
};

const badgeVariants = cva(
  [
    'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold',
    'transition-colors focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden',
  ].join(' '),
  {
    variants: {
      variant: badgeVariantClasses,
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

type BadgeProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>;

function Badge(attributes: BadgeProps) {
  const { className, variant, ...elementAttributes } = attributes;
  const classes = cn(badgeVariants({ variant }), className);

  return <div className={classes} {...elementAttributes} />;
}

export { Badge, badgeVariants };
