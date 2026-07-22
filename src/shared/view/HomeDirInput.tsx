import { useEffect, useRef, useState } from 'react';

import { api } from '../../utils/api';

type HomeDirInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
};

const DEBOUNCE_MS = 200;

/**
 * Home-relative directory input with server-backed autocomplete
 * (/api/providers/fs/dir-suggestions). Suggestions render below the input;
 * click or Tab (first match) completes. Best-effort — endpoint errors just
 * hide the dropdown.
 */
export default function HomeDirInput({ value, onChange, onSubmit, placeholder, className }: HomeDirInputProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    if (!value.trim()) {
      setSuggestions([]);
      return undefined;
    }
    const seq = ++requestSeqRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const response = await api.dirSuggestions(value.trim());
        if (!response.ok) return;
        const body = await response.json();
        const list: string[] = body?.data?.suggestions ?? [];
        if (seq === requestSeqRef.current) {
          // Typing the exact suggestion should collapse the dropdown.
          setSuggestions(list.filter((entry) => entry !== value.trim()));
        }
      } catch {
        // best-effort
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [value]);

  const pick = (suggestion: string) => {
    onChange(`${suggestion}/`);
    setOpen(true);
  };

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so a click on a suggestion still lands.
          window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Tab' && suggestions.length > 0 && open) {
            event.preventDefault();
            pick(suggestions[0]);
            return;
          }
          if (event.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            setOpen(false);
            onSubmit?.();
          }
        }}
        placeholder={placeholder}
        className={className ?? 'w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-blue-500/60'}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-card shadow-lg">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              // onMouseDown so the pick beats the input's onBlur close.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(suggestion);
              }}
              className="block w-full truncate px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted/60"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
