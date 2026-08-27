type CodeEditorFooterProps = {
  content: string;
  linesLabel: string;
  charactersLabel: string;
  shortcutsLabel: string;
};

export default function CodeEditorFooter({
  content,
  linesLabel,
  charactersLabel,
  shortcutsLabel,
}: CodeEditorFooterProps) {
  return (
    <div className="flex flex-shrink-0 items-center justify-between border-t border-border bg-muted px-3 py-1.5">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          {linesLabel} {content.split('\n').length}
        </span>
        <span>
          {charactersLabel} {content.length}
        </span>
      </div>

      <div className="text-xs text-muted-foreground">{shortcutsLabel}</div>
    </div>
  );
}
