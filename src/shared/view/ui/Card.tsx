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

function paragraphSection(baseClass: string) {
  return React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(function CardParagraph({ className, ...attributes }, ref) {
    return React.createElement('p', { ref, className: cn(baseClass, className), ...attributes });
  });
}

const Card = divSection('rounded-xl border bg-card text-card-foreground shadow-xs');
const CardHeader = divSection('flex flex-col space-y-1.5 p-4');
const CardTitle = headingSection('leading-none font-semibold tracking-tight');
const CardDescription = paragraphSection('text-sm text-muted-foreground');
const CardContent = divSection('p-4 pt-0');
const CardFooter = divSection('flex items-center p-4 pt-0');
const CardAction = divSection('ml-auto shrink-0');

Card.displayName = 'Card';
CardHeader.displayName = 'CardHeader';
CardTitle.displayName = 'CardTitle';
CardDescription.displayName = 'CardDescription';
CardContent.displayName = 'CardContent';
CardFooter.displayName = 'CardFooter';
CardAction.displayName = 'CardAction';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction };
