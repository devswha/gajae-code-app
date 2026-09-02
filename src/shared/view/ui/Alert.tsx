import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../../utils/cn';

const alertVariants = cva('relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[--spacing(4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current', {
  variants: {
    variant: {
      default: 'bg-card text-card-foreground',
      destructive: 'bg-card text-destructive data-[slot=alert-description]:*:text-destructive/90 [&>svg]:text-current',
    },
  },
  defaultVariants: { variant: 'default' },
});

type AlertProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>;

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(function Alert({ className, variant, ...attributes }, ref) {
  return <div ref={ref} role="alert" data-slot="alert" className={cn(alertVariants({ variant }), className)} {...attributes} />;
});

Alert.displayName = 'Alert';

export { Alert };
