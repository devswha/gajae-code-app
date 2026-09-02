import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const LOCALES_DIR = path.join(ROOT, 'src/i18n/locales');

const OBSOLETE_SIDEBAR_KEYS = [
  'projects.noMatchingProjects',
  'projects.searchPlaceholder',
  'projects.tryDifferentSearch',
  'tooltips.clearSearch',
  'search',
] as const;

const RETAINED_SIDEBAR_KEYS = [
  'projects.title',
  'projects.newProject',
  'projects.deleteProject',
  'projects.renameProject',
  'projects.noProjects',
  'projects.loadingProjects',
  'projects.projectNamePlaceholder',
  'projects.untitledSession',
  'projects.newSession',
  'projects.fetchingProjects',
  'projects.projects',
  'projects.createProjectHint',
  'sessions.newSession',
  'sessions.newTask',
  'sessions.work',
  'sessions.noSessions',
  'sessions.loadingSessions',
  'sessions.createSessionHint',
  'tooltips.refresh',
  'tooltips.createProject',
  'tooltips.createSession',
  'tooltips.selectProjectToCreateSession',
  'tooltips.hideSidebar',
  'tooltips.renameProject',
  'tooltips.deleteProject',
  'tooltips.addToFavorites',
  'tooltips.removeFromFavorites',
  'tooltips.editSessionName',
  'tooltips.deleteSession',
  'tooltips.activeSessionIndicator',
  'tooltips.attentionRequiredIndicator',
  'actions.settings',
  'actions.search',
  'actions.reportIssue',
  'actions.joinCommunity',
  'messages.refreshError',
  'messages.deleteProjectFailed',
  'messages.deleteProjectError',
] as const;

function localeNames(): string[] {
  return readdirSync(LOCALES_DIR)
    .filter((name) => statSync(path.join(LOCALES_DIR, name)).isDirectory())
    .sort();
}

function readJson(filePath: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  return parsed;
}

function valueAt(source: unknown, keyPath: string): unknown {
  let current = source;
  for (const segment of keyPath.split('.')) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = Object.getOwnPropertyDescriptor(current, segment)?.value;
  }
  return current;
}

// The sidebar's inline filter lives under `filter.*` and in SidebarContent; the
// keys and code paths below belong to the removed mode-tab search and must not
// come back under their old names.
test('Given simplified sidebar navigation when locale files are parsed then obsolete sidebar mode/search/delegation keys are absent', () => {
  const failures: string[] = [];

  for (const locale of localeNames()) {
    const sidebar = readJson(path.join(LOCALES_DIR, locale, 'sidebar.json'));
    const common = readJson(path.join(LOCALES_DIR, locale, 'common.json'));

    for (const keyPath of OBSOLETE_SIDEBAR_KEYS) {
      if (valueAt(sidebar, keyPath) !== undefined) {
        failures.push(`${locale}/sidebar.json:${keyPath}`);
      }
    }

    if (valueAt(common, 'mainContent.delegateJob') !== undefined) {
      failures.push(`${locale}/common.json:mainContent.delegateJob`);
    }
  }

  assert.deepEqual(failures, []);
});

test('Given retained simplified sidebar copy when locale files are parsed then key parity stays intact', () => {
  const failures: string[] = [];

  for (const locale of localeNames()) {
    const sidebar = readJson(path.join(LOCALES_DIR, locale, 'sidebar.json'));
    for (const keyPath of RETAINED_SIDEBAR_KEYS) {
      if (valueAt(sidebar, keyPath) === undefined) {
        failures.push(`${locale}/sidebar.json:${keyPath}`);
      }
    }
  }

  assert.deepEqual(failures, []);
});

test('Given search is gone when CSS is inspected then obsolete nav search and glow utilities are absent', () => {
  const css = readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
  const obsoleteCss = [
    '--nav-tab-glow',
    '--nav-tab-ring',
    '--nav-input-bg',
    '--nav-input-focus-ring',
    '.nav-search-input',
  ] as const;

  assert.deepEqual(obsoleteCss.filter((token) => css.includes(token)), []);
});

test('Given the filter empty state lives in SidebarContent when project state source is inspected then no legacy search-empty branch remains', () => {
  const source = readFileSync(path.join(ROOT, 'src/components/sidebar/view/SidebarProjectsState.tsx'), 'utf8');
  const obsoleteSourceText = [
    'Search',
    'filteredProjectsCount === 0',
    "t('projects.noMatchingProjects')",
    "t('projects.tryDifferentSearch')",
  ] as const;

  assert.deepEqual(obsoleteSourceText.filter((text) => source.includes(text)), []);
});

test('Given the Codex-aligned product surface when DESIGN.md is inspected then it documents primary action and disclosure sections without Jobs', () => {
  const design = readFileSync(path.join(ROOT, 'DESIGN.md'), 'utf8');
  const obsoleteDesignText = [
    'jobs surfaces',
    'job activity',
    'job review screens',
    'job badges',
    'job headings',
    'job diffs',
    'raw job event payloads',
    'Job workspace padding',
    'job workspace panel',
    'sidebar search',
    'Jobs Surface',
    'Search flash',
    'job cards',
    'settings and jobs surfaces',
    'src/components/jobs',
  ] as const;

  assert.deepEqual(obsoleteDesignText.filter((text) => design.includes(text)), []);
  assert.match(design, /Codex-aligned hierarchy/i);
  assert.match(design, /Sidebar Primary Navigation/);
  assert.match(design, /compact footer utilities/i);
});
