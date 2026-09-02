import { Search, X } from 'lucide-react';
import type { KeyboardEvent, RefObject } from 'react';
import type { TFunction } from 'i18next';

import { cn } from '../../../utils/cn';

type SidebarFilterInputProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly t: TFunction;
};

/**
 * The inline filter beneath the primary action. It narrows the tree in place;
 * the command palette (Ctrl+K) remains the place to search everything else.
 *
 * Escape clears the query, and with nothing to clear it returns focus to the
 * page so `/` can bring it back.
 */
export default function SidebarFilterInput({ value, onChange, inputRef, t }: SidebarFilterInputProps) {
  const placeholder = t('filter.placeholder');
  const clearLabel = t('filter.clear');

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (value) onChange('');
    else event.currentTarget.blur();
  };

  return (
    <div className="shrink-0 px-2 pb-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          title={`${placeholder} (/)`}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          data-sidebar-filter
          className={cn(
            'h-8 w-full rounded-md border border-transparent bg-muted/60 pr-7 pl-8 text-sm text-foreground outline-hidden transition-colors',
            'placeholder:text-muted-foreground hover:bg-muted focus-visible:border-input focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-ring',
            '[&::-webkit-search-cancel-button]:appearance-none',
          )}
        />
        {value && (
          <button
            type="button"
            className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-hidden hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
            aria-label={clearLabel}
            title={clearLabel}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
