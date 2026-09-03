import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { PROJECTS_QUERY_KEY } from '../../../hooks/useProjectsQuery';
import type { Project } from '../../../types/app';
import type { MainContentHeaderProps, MainContentProps, MainContentStateViewProps } from '../types/types';

import MainContentHeader from './MainContentHeader';
import MainContentStateView from './MainContentStateView';

const selectedProject: Project = {
  projectId: 'project-alpha',
  displayName: 'Alpha Workspace',
  fullPath: '/work/alpha',
  origin: 'explicit',
};

const headerProps = {
  activeTab: 'chat',
  setActiveTab: () => undefined,
  selectedProject,
  selectedSession: null,
  isMobile: false,
  onMenuClick: () => undefined,
  workspaceOpen: false,
  onToggleWorkspace: () => undefined,
} satisfies MainContentHeaderProps;

const emptyStateProps = {
  mode: 'empty',
  isMobile: false,
  onMenuClick: () => undefined,
} satisfies MainContentStateViewProps;

const assertNoJobProps = <_T extends never>(): void => undefined;
assertNoJobProps<Extract<keyof MainContentProps, `job${string}` | `onJob${string}`>>();

test('Given a selected project when rendering the main header then the workspace toggle remains available without a background-job control', () => {
  const html = renderToStaticMarkup(createElement(
    MemoryRouter,
    null,
    createElement(MainContentHeader, headerProps),
  ));

  assert.match(html, /lucide-panel-right/);
  assert.doesNotMatch(html, /lucide-hammer|background job/i);
});

const renderEmptyState = (projects: Project[]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  client.setQueryData(PROJECTS_QUERY_KEY, projects);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MainContentStateView, emptyStateProps)));
};

test('Given projects but none selected when rendering the empty state then it asks to pick one, without a background-job control', () => {
  const html = renderEmptyState([selectedProject]);

  assert.match(html, /mainContent\.chooseProject/);
  assert.doesNotMatch(html, /mainContent\.firstProject|main-add-project/);
  assert.doesNotMatch(html, /Delegate a background job/i);
});

test('Given no projects at all when rendering the empty state then the one action is adding a project', () => {
  const html = renderEmptyState([]);

  assert.match(html, /mainContent\.firstProject/);
  assert.match(html, /<button[^>]*data-testid="main-add-project"[^>]*>[\s\S]*?mainContent\.addProject/);
  assert.doesNotMatch(html, /mainContent\.chooseProject|mainContent\.tip/);
});
