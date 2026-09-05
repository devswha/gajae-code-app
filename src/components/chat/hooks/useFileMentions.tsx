import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';

import { api } from '../../../utils/api';
import { escapeRegExp } from '../utils/chatFormatting';
import type { Project } from '../../../types/app';

interface ProjectFileNode { name: string; type: 'file' | 'directory'; path?: string; children?: ProjectFileNode[]; }
export interface MentionableFile { name: string; path: string; relativePath?: string; }
interface UseFileMentionsOptions { selectedProject: Project | null; sessionId?: string | null; executionCwd?: string | null; input: string; setInput: Dispatch<SetStateAction<string>>; textareaRef: RefObject<HTMLTextAreaElement | null>; }

const collectFiles = (nodes: ProjectFileNode[], parent = ''): MentionableFile[] => nodes.flatMap((node) => {
  const path = parent ? `${parent}/${node.name}` : node.name;
  if (node.type === 'directory') return node.children ? collectFiles(node.children, path) : [];
  return node.type === 'file' ? [{ name: node.name, path, relativePath: node.path }] : [];
});

const findMention = (text: string, position: number) => {
  const beforeCaret = text.slice(0, position);
  const marker = beforeCaret.lastIndexOf('@');
  if (marker < 0) return null;
  const query = beforeCaret.slice(marker + 1);
  return query.includes(' ') ? null : { marker, query };
};

const rankFiles = (files: MentionableFile[], query: string) => {
  const needle = query.toLowerCase();
  return files.filter((file) => file.name.toLowerCase().includes(needle) || file.path.toLowerCase().includes(needle)).slice(0, 10);
};

export function useFileMentions({ selectedProject, sessionId, executionCwd, input, setInput, textareaRef }: UseFileMentionsOptions) {
  const [files, setFiles] = useState<MentionableFile[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const [filteredFiles, setFilteredFiles] = useState<MentionableFile[]>([]);
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const [selectedFileIndex, setSelectedFileIndex] = useState(-1);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [atSymbolPosition, setAtSymbolPosition] = useState(-1);

  useEffect(() => {
    const request = new AbortController();
    const projectId = selectedProject?.projectId;
    setFiles([]);
    setFilteredFiles([]);
    if (!projectId) return () => request.abort();

    const load = async () => {
      try {
        const response = await api.getFiles(projectId, { signal: request.signal }, sessionId ?? undefined);
        if (response.ok) {
          const files = collectFiles((await response.json()) as ProjectFileNode[]);
          if (!request.signal.aborted) setFiles(files);
        }
      } catch (error) {
        if ((error as { name?: string })?.name !== 'AbortError') console.error('Error fetching files:', error);
      }
    };

    void load();
    return () => request.abort();
  }, [selectedProject?.projectId, sessionId, executionCwd]);

  useEffect(() => {
    const mention = findMention(input, cursorPosition);
    if (!mention) {
      setShowFileDropdown(false);
      setAtSymbolPosition(-1);
      return;
    }

    setAtSymbolPosition(mention.marker);
    setShowFileDropdown(true);
    setSelectedFileIndex(-1);
    setFilteredFiles(rankFiles(files, mention.query));
  }, [files, input, cursorPosition]);

  const activePaths = useMemo(() => mentions.filter((path) => input.includes(path)), [mentions, input]);
  const mentionPaths = useMemo(() => Array.from(new Set(activePaths)).sort((a, b) => b.length - a.length), [activePaths]);
  const mentionExpression = useMemo(() => mentionPaths.length ? new RegExp(`(${mentionPaths.map(escapeRegExp).join('|')})`, 'g') : null, [mentionPaths]);
  const mentionPathSet = useMemo(() => new Set(mentionPaths), [mentionPaths]);

  const renderInputWithMentions = useCallback((text: string) => {
    if (!text || !mentionExpression) return text;
    return text.split(mentionExpression).map((part, index) => mentionPathSet.has(part)
      ? <span key={`mention-${index}`} className="-ml-0.5 rounded-md bg-primary/20 box-decoration-clone px-0.5 text-transparent">{part}</span>
      : <span key={`text-${index}`}>{part}</span>);
  }, [mentionExpression, mentionPathSet]);

  const selectFile = useCallback((file: MentionableFile) => {
    const prefix = input.slice(0, atSymbolPosition);
    const fromMarker = input.slice(atSymbolPosition);
    const firstSpace = fromMarker.indexOf(' ');
    const suffix = firstSpace < 0 ? '' : fromMarker.slice(firstSpace);
    const nextInput = `${prefix}${file.path} ${suffix}`;
    const nextPosition = prefix.length + file.path.length + 1;
    const textarea = textareaRef.current;

    if (textarea && !textarea.matches(':focus')) textarea.focus();
    setInput(nextInput);
    setCursorPosition(nextPosition);
    setMentions((previous) => previous.includes(file.path) ? previous : [...previous, file.path]);
    setShowFileDropdown(false);
    setAtSymbolPosition(-1);

    if (!textarea) return;
    requestAnimationFrame(() => {
      const current = textareaRef.current;
      if (!current) return;
      current.setSelectionRange(nextPosition, nextPosition);
      if (!current.matches(':focus')) current.focus();
    });
  }, [atSymbolPosition, input, setInput, textareaRef]);

  const handleFileMentionsKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!showFileDropdown || !filteredFiles.length) return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedFileIndex((index) => index < filteredFiles.length - 1 ? index + 1 : 0);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedFileIndex((index) => index > 0 ? index - 1 : filteredFiles.length - 1);
      return true;
    }
    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault();
      selectFile(filteredFiles[selectedFileIndex >= 0 ? selectedFileIndex : 0]);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setShowFileDropdown(false);
      return true;
    }
    return false;
  }, [filteredFiles, selectedFileIndex, selectFile, showFileDropdown]);

  return { showFileDropdown, filteredFiles, selectedFileIndex, renderInputWithMentions, selectFile, setCursorPosition, handleFileMentionsKeyDown };
}
