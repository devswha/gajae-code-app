import React, { useCallback, useMemo } from 'react';

import type { Project } from '../../../types/app';
import type { SubagentChildTool, CodeEditorDiffInfo  } from '../types/types';

import { getToolConfig, getToolResultConfig, rendersCommandRow, rendersResultInline } from './configs/toolConfigs';
import { OneLineDisplay, BashCommandDisplay, CollapsibleDisplay, ToolCallRow, ToolDiffViewer, MarkdownContent, FileListContent, TodoListContent, TaskListContent, TextContent, QuestionAnswerContent, SubagentContainer } from './components';
import { PlanDisplay } from './components/PlanDisplay';
import { ToolStatusBadge } from './components/ToolStatusBadge';
import type { ToolStatus } from './components/ToolStatusBadge';

type DiffLine = { type: string; content: string; lineNum: number };
interface ToolRendererProps { toolName: string; toolInput: any; toolResult?: any; toolId?: string; mode: 'input' | 'result'; onFileOpen?: (filePath: string, diffInfo?: CodeEditorDiffInfo | null) => void; createDiff?: (oldStr: string, newStr: string) => DiffLine[]; selectedProject?: Project | null; showRawParameters?: boolean; rawToolInput?: string; isSubagentContainer?: boolean; subagentState?: { childTools: SubagentChildTool[]; currentToolIndex: number; isComplete: boolean } }

const deniedPhrases = ['user denied tool use', 'tool disallowed by settings', 'permission request timed out', 'permission request cancelled'];

function decodeToolData(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function statusFor(result: any): ToolStatus {
  if (!result) return 'running';
  if (!result.isError) return 'completed';
  const message = String(result.content || '').toLowerCase().trim();
  return deniedPhrases.some((phrase) => message.includes(phrase)) ? 'denied' : 'error';
}

function resultText(result: any): string {
  if (typeof result?.content === 'string') return result.content;
  return result?.content != null ? String(result.content) : '';
}

function titleFrom(config: any, value: unknown, fallback: string): string {
  return typeof config.title === 'function' ? config.title(value) : config.title || fallback;
}

function CollapsibleBody({ contentType, contentProps, createDiff, onFileOpen, config, data }: any): React.ReactNode {
  if (contentType === 'diff') {
    return createDiff ? <ToolDiffViewer {...contentProps} createDiff={createDiff} onFileClick={() => onFileOpen?.(contentProps.filePath)} /> : null;
  }
  if (contentType === 'markdown') return <MarkdownContent content={contentProps.content || ''} />;
  if (contentType === 'file-list') return <FileListContent files={contentProps.files || []} onFileClick={onFileOpen} title={contentProps.title} />;
  if (contentType === 'todo-list') return contentProps.todos?.length > 0 ? <TodoListContent todos={contentProps.todos} isResult={contentProps.isResult} /> : null;
  if (contentType === 'task') return <TaskListContent content={contentProps.content || ''} />;
  if (contentType === 'question-answer') return <QuestionAnswerContent questions={contentProps.questions || []} answers={contentProps.answers || {}} />;
  if (contentType === 'text') return <TextContent content={contentProps.content || ''} format={contentProps.format || 'plain'} />;
  if (contentType === 'success-message') {
    const message = config.getMessage?.(data) || 'Success';
    return <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>{message}</div>;
  }
  return null;
}

export const ToolRenderer: React.FC<ToolRendererProps> = ({ toolName, toolInput, toolResult, toolId, mode, onFileOpen, createDiff, selectedProject, showRawParameters = false, rawToolInput, isSubagentContainer, subagentState }) => {
  const config = getToolConfig(toolName);
  const displayConfig: any = mode === 'input' ? config.input : getToolResultConfig(toolName);
  const parsedData = useMemo(() => decodeToolData(mode === 'input' ? toolInput : toolResult), [mode, toolInput, toolResult]);
  const toolStatus = useMemo(() => mode === 'input' ? statusFor(toolResult) : undefined, [mode, toolResult]);
  const handleAction = useCallback(() => {
    if (displayConfig?.action === 'open-file' && onFileOpen) onFileOpen(displayConfig.getValue?.(parsedData) || '');
  }, [displayConfig, onFileOpen, parsedData]);

  if (isSubagentContainer && subagentState) {
    return mode === 'result' ? null : <SubagentContainer toolInput={toolInput} toolResult={toolResult} subagentState={subagentState} />;
  }
  if (!displayConfig) return null;

  if (rendersCommandRow(toolName) && mode === 'input') {
    const objectInput = typeof parsedData === 'object' && parsedData !== null ? parsedData as Record<string, unknown> : null;
    const command = objectInput && 'command' in objectInput ? String(objectInput.command || '') : typeof toolInput === 'string' ? toolInput : typeof rawToolInput === 'string' ? rawToolInput : '';
    const details = objectInput ? String(objectInput.description || (objectInput.cwd ? `in ${objectInput.cwd}` : '') || '') : '';
    return <BashCommandDisplay command={command} description={details || undefined} output={resultText(toolResult)} isError={Boolean(toolResult?.isError)} status={toolStatus !== 'completed' ? toolStatus : undefined} defaultOpen={false} />;
  }

  if (displayConfig.type === 'one-line') {
    const value = displayConfig.getValue?.(parsedData) || '';
    const secondary = displayConfig.getSecondary?.(parsedData);
    const output = resultText(toolResult);
    if (mode === 'input' && rendersResultInline(toolName) && output.trim()) {
      return <ToolCallRow toolName={toolName} label={displayConfig.label} value={value} secondary={secondary} output={output} isError={Boolean(toolResult?.isError)} status={toolStatus !== 'completed' ? toolStatus : undefined} />;
    }
    return <OneLineDisplay toolName={toolName} icon={displayConfig.icon} label={displayConfig.label} value={value} secondary={secondary} action={displayConfig.action} onAction={handleAction} style={displayConfig.style} wrapText={displayConfig.wrapText} colorScheme={displayConfig.colorScheme} status={toolStatus !== 'completed' ? toolStatus : undefined} />;
  }

  const contentProps = displayConfig.getContentProps?.(parsedData, { selectedProject, createDiff, onFileOpen }) || {};
  if (displayConfig.type === 'plan') {
    return <PlanDisplay title={titleFrom(displayConfig, parsedData, 'Plan')} content={contentProps.content || ''} defaultOpen={displayConfig.defaultOpen ?? false} isStreaming={mode === 'input' && !toolResult} showRawParameters={mode === 'input' && showRawParameters} rawContent={rawToolInput} toolName={toolName} toolId={toolId} />;
  }
  if (displayConfig.type !== 'collapsible') return null;

  const canOpenFile = (toolName === 'Edit' || toolName === 'Write' || toolName === 'ApplyPatch') && contentProps.filePath && onFileOpen;
  const onTitleClick = canOpenFile ? () => onFileOpen(contentProps.filePath, { old_string: contentProps.oldContent, new_string: contentProps.newContent }) : undefined;
  const badge = toolStatus && toolStatus !== 'completed' ? <ToolStatusBadge status={toolStatus} /> : undefined;
  return <CollapsibleDisplay toolName={toolName} toolId={toolId} title={titleFrom(displayConfig, parsedData, 'Details')} defaultOpen={displayConfig.defaultOpen !== undefined ? displayConfig.defaultOpen : false} onTitleClick={onTitleClick} badge={badge} showRawParameters={mode === 'input' && showRawParameters} rawContent={rawToolInput}><CollapsibleBody contentType={displayConfig.contentType} contentProps={contentProps} createDiff={createDiff} onFileOpen={onFileOpen} config={displayConfig} data={parsedData} /></CollapsibleDisplay>;
};

ToolRenderer.displayName = 'ToolRenderer';
