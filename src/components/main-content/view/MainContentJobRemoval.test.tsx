import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import type { Project } from '../../../types/app';
import type { MainContentHeaderProps, MainContentProps, MainContentStateViewProps } from '../types/types';

import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';

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
  filesPanelOpen: false,
  onToggleFilesPanel: () => undefined,
} satisfies MainContentHeaderProps;

const emptyStateProps = {
  mode: 'empty',
  isMobile: false,
  onMenuClick: () => undefined,
} satisfies MainContentStateViewProps;

const assertNoJobProps = <_T extends never>(): void => undefined;
assertNoJobProps<Extract<keyof MainContentProps, `job${string}` | `onJob${string}`>>();

test('Given a selected project when rendering the main header then Files remains available without a background-job control', () => {
  const html = renderToStaticMarkup(createElement(
    MemoryRouter,
    null,
    createElement(MainContentHeader, headerProps),
  ));

  assert.match(html, /lucide-folder-open/);
  assert.doesNotMatch(html, /lucide-hammer|background job/i);
});

test('Given no selected project when rendering the empty state then project guidance has no background-job control', () => {
  const html = renderToStaticMarkup(createElement(MainContentStateView, emptyStateProps));

  assert.match(html, /mainContent\.chooseProject/);
  assert.doesNotMatch(html, /Delegate a background job/i);
});
