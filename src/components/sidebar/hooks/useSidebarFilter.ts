import { type RefObject, useEffect, useRef, useState } from 'react';

import { useConversationMessageSearch } from '../../command-palette/sources/useSessionMessageSearch';
import { filterSessions, normalizeFilterQuery } from '../utils/sessionFilter';
import type { SidebarProjectListProps } from '../view/SidebarProjectList';

/** Typing pauses this long before the tree re-filters, matching the palette. */
export const FILTER_DEBOUNCE_MS = 150;

const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

type SidebarFilter = {
  query: string;
  setQuery: (value: string) => void;
  /** True once a debounced, non-empty query is being applied. */
  active: boolean;
  /** The list props with the filter applied; identical to the input when inactive. */
  listProps: SidebarProjectListProps;
  /** Sessions left visible by the filter; meaningful only while active. */
  matchCount: number;
  inputRef: RefObject<HTMLInputElement | null>;
};

/**
 * Owns the sidebar filter: the raw query, its debounced copy, the message-body
 * search behind it, and the `/` shortcut that focuses the field from anywhere
 * that is not already a text field.
 *
 * While a query is active every matching project is force-expanded so hits in
 * a collapsed project are visible; the user's own expansion state is untouched
 * and returns when the query clears.
 */
export function useSidebarFilter(source: SidebarProjectListProps): SidebarFilter {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!normalizeFilterQuery(query)) {
      setDebouncedQuery('');
      return;
    }
    const timer = window.setTimeout(() => setDebouncedQuery(query), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const active = normalizeFilterQuery(debouncedQuery).length > 0;
  const messageMatches = useConversationMessageSearch(debouncedQuery, active);

  useEffect(() => {
    const focusFilter = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (isEditable(event.target)) return;
      const input = inputRef.current;
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    document.addEventListener('keydown', focusFilter);
    return () => document.removeEventListener('keydown', focusFilter);
  }, []);

  const filtered = filterSessions({
    query: debouncedQuery,
    projects: source.filteredProjects,
    getProjectSessions: source.getProjectSessions,
    messageMatchIds: new Set(messageMatches.map((match) => match.sessionId)),
  });

  const listProps: SidebarProjectListProps = filtered.active
    ? { ...source, filteredProjects: filtered.projects, getProjectSessions: filtered.sessionsFor, forceExpanded: true }
    : source;

  return { query, setQuery, active: filtered.active, listProps, matchCount: filtered.sessionCount, inputRef };
}
