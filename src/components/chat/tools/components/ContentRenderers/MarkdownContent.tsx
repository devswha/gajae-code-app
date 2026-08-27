import React from 'react';

import { Markdown } from '../../../view/Markdown';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

/**
 * Renders markdown content with proper styling
 * Used by: exit_plan_mode, long text results, etc.
 */
export const MarkdownContent: React.FC<MarkdownContentProps> = ({
  content,
  className = 'mt-1 prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground prose-a:text-primary prose-code:text-foreground prose-strong:text-foreground'
}) => {
  return (
    <Markdown className={className}>
      {content}
    </Markdown>
  );
};
