import * as React from 'react';

import { cn } from '../../../utils/cn';

function divSection(baseClass: string) {
  return React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function CardSection({ className, ...attributes }, ref) {
    return React.createElement('div', { ref, className: cn(baseClass, className), ...attributes });
  });
}

function headingSection(baseClass: string) {
  return React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(function CardHeading({ className, ...attributes }, ref) {
    return React.createElement('h3', { ref, className: cn(baseClass, className), ...attributes });
  });
}

const Card = divSection('rounded-xl border bg-card text-card-foreground shadow-xs');
const CardHeader = divSection('flex flex-col space-y-1.5 p-4');
const CardTitle = headingSection('leading-none font-semibold tracking-tight');
const CardContent = divSection('p-4 pt-0');
const CardFooter = divSection('flex items-center p-4 pt-0');

Card.displayName = 'Card';
CardHeader.displayName = 'CardHeader';
CardTitle.displayName = 'CardTitle';
CardContent.displayName = 'CardContent';
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardContent, CardFooter };
