import * as React from 'react';

import { cn } from '../../../utils/cn';

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const inputClassName = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50';

const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(inputProps, inputRef) {
  const { className, type, ...nativeAttributes } = inputProps;

  return (
    <input
      type={type}
      className={cn(inputClassName, className)}
      ref={inputRef}
      {...nativeAttributes}
    />
  );
});

Input.displayName = 'Input';

export { Input };
