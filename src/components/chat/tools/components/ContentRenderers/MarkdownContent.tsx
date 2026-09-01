import React from 'react';

import { Markdown } from '../../../view/Markdown';

interface MarkdownContentProps { content: string; className?: string; }

const defaultClasses = 'mt-1 prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground prose-a:text-primary prose-code:text-foreground prose-strong:text-foreground';

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content, className = defaultClasses }) => <Markdown className={className}>{content}</Markdown>;
