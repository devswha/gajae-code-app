import React from 'react';

interface TextContentProps { content: string; format?: 'plain' | 'json' | 'code'; className?: string; }

const classes = {
  json: 'mt-1 overflow-x-auto rounded-lg border border-border bg-card p-2.5 font-mono text-xs text-foreground',
  code: 'mt-1 overflow-hidden rounded-lg border border-border bg-muted/30 p-2 font-mono text-xs wrap-break-word whitespace-pre-wrap text-muted-foreground',
  plain: 'mt-1 text-sm whitespace-pre-wrap text-foreground',
};

function prettify(value: string): string {
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch (error) { console.warn('Failed to parse JSON content:', error); return value; }
}

export const TextContent: React.FC<TextContentProps> = ({ content, format = 'plain', className = '' }) => {
  if (format === 'plain') return <div className={`${classes.plain} ${className}`}>{content}</div>;
  const value = format === 'json' ? prettify(content) : content;
  return <pre className={`${classes[format]} ${className}`}>{value}</pre>;
};
