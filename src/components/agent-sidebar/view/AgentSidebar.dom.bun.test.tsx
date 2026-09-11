import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

import { AGENT_SIDEBAR_STORAGE_KEY, DEFAULT_AGENT_SIDEBAR_WIDTH } from '../agentSidebarState';
import { useAgentSidebar } from '../hooks/useAgentSidebar';

import AgentSidebar from './AgentSidebar';

const originalObserver = globalThis.ResizeObserver;
const originalBounds = HTMLElement.prototype.getBoundingClientRect;
let containerWidth = 1_600;
const observers: Array<{ resize: () => void; disconnected: boolean }> = [];

function stubEnvironment() {
  globalThis.ResizeObserver = class {
    observer: { resize: () => void; disconnected: boolean };
    constructor(resize: () => void) {
      this.observer = { resize, disconnected: false };
      observers.push(this.observer);
    }
    observe() {}
    unobserve() {}
    disconnect() { this.observer.disconnected = true; }
  } as unknown as typeof ResizeObserver;
  // The hook resizes against `container.right - clientX`, so the stub has to be
  // a whole rect and not just a width.
  HTMLElement.prototype.getBoundingClientRect = () => ({
    left: 0,
    right: containerWidth,
    width: containerWidth,
    top: 0,
    bottom: 0,
    height: 0,
    x: 0,
    y: 0,
  }) as DOMRect;
}

function seed(state: { open: boolean; width: number }) {
  localStorage.setItem(AGENT_SIDEBAR_STORAGE_KEY, JSON.stringify(state));
}

function persisted(): { open: boolean; width: number } {
  return JSON.parse(localStorage.getItem(AGENT_SIDEBAR_STORAGE_KEY) ?? 'null');
}

function Harness({ mobile = false }: { mobile?: boolean }) {
  const sidebar = useAgentSidebar({ isMobile: mobile });
  return createElement('div', null,
    createElement('div', { ref: sidebar.containerRef },
      createElement('output', null, String(sidebar.width)),
      createElement('button', { onClick: sidebar.open }, 'Open'),
      createElement('button', { onClick: sidebar.toggle }, 'Toggle'),
      // The drawer has no handle, so the mobile keyboard guard is reached here.
      createElement('button', { onKeyDown: sidebar.handleResizeKeyDown }, 'Keys'),
      sidebar.isOpen
        ? createElement(AgentSidebar, {
          width: sidebar.width,
          isMobile: mobile,
          onResizeStart: sidebar.handleResizeStart,
          onResizeKeyDown: sidebar.handleResizeKeyDown,
          onClose: sidebar.close,
        })
        : null,
    ),
  );
}

function width(): string {
  return screen.getByRole('status').textContent ?? '';
}

afterEach(() => {
  cleanup();
  localStorage.removeItem(AGENT_SIDEBAR_STORAGE_KEY);
  globalThis.ResizeObserver = originalObserver;
  HTMLElement.prototype.getBoundingClientRect = originalBounds;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  containerWidth = 1_600;
  observers.length = 0;
});

test('the sidebar starts closed and opening it persists the open state', () => {
  stubEnvironment();
  render(createElement(Harness));

  assert.equal(screen.queryByRole('complementary'), null);

  fireEvent.click(screen.getByText('Open'));

  assert.ok(screen.getByRole('complementary', { name: 'agentSidebar.title' }));
  assert.deepEqual(persisted(), { open: true, width: DEFAULT_AGENT_SIDEBAR_WIDTH });
});

test('the header toggle opens and closes the sidebar in turn', () => {
  stubEnvironment();
  render(createElement(Harness));

  fireEvent.click(screen.getByText('Toggle'));
  assert.ok(screen.getByRole('complementary', { name: 'agentSidebar.title' }));
  assert.equal(persisted().open, true);

  fireEvent.click(screen.getByText('Toggle'));
  assert.equal(screen.queryByRole('complementary'), null);
  assert.equal(persisted().open, false);
});

test('the close control closes the sidebar and persists it closed', () => {
  stubEnvironment();
  seed({ open: true, width: DEFAULT_AGENT_SIDEBAR_WIDTH });
  render(createElement(Harness));

  fireEvent.click(screen.getByRole('button', { name: 'agentSidebar.close' }));

  assert.equal(screen.queryByRole('complementary'), null);
  assert.equal(persisted().open, false);
});

test('dragging the separator resizes the sidebar and restores the document cursor', () => {
  stubEnvironment();
  seed({ open: true, width: DEFAULT_AGENT_SIDEBAR_WIDTH });
  render(createElement(Harness));

  const separator = screen.getByRole('separator');
  fireEvent.mouseDown(separator);
  assert.equal(document.body.style.cursor, 'col-resize');
  assert.equal(document.body.style.userSelect, 'none');

  fireEvent.mouseMove(document, { clientX: 1_100 });
  assert.equal(width(), '500');
  assert.equal(screen.getByRole('separator').getAttribute('aria-valuenow'), '500');

  fireEvent.mouseUp(document);
  assert.equal(document.body.style.cursor, '');
  assert.equal(document.body.style.userSelect, '');
  assert.equal(width(), '500');
});

test('a drag past the chat-safe edge stops at the row ceiling', () => {
  stubEnvironment();
  seed({ open: true, width: DEFAULT_AGENT_SIDEBAR_WIDTH });
  render(createElement(Harness));

  fireEvent.mouseDown(screen.getByRole('separator'));
  fireEvent.mouseMove(document, { clientX: 0 });
  fireEvent.mouseUp(document);

  // 1600 * 0.8 = 1280 leaves the chat a fifth of the row.
  assert.equal(width(), '1280');
  assert.equal(persisted().width, 1_280);
});

test('unmounting mid-drag still restores the document cursor and selection', () => {
  stubEnvironment();
  seed({ open: true, width: DEFAULT_AGENT_SIDEBAR_WIDTH });
  const view = render(createElement(Harness));

  fireEvent.mouseDown(screen.getByRole('separator'));
  assert.equal(document.body.style.cursor, 'col-resize');

  view.unmount();

  assert.equal(document.body.style.cursor, '');
  assert.equal(document.body.style.userSelect, '');
});

test('arrow keys on the separator widen and narrow the docked sidebar', () => {
  stubEnvironment();
  seed({ open: true, width: DEFAULT_AGENT_SIDEBAR_WIDTH });
  render(createElement(Harness));

  const separator = screen.getByRole('separator');
  fireEvent.keyDown(separator, { key: 'ArrowLeft' });
  assert.equal(width(), '408');

  fireEvent.keyDown(separator, { key: 'ArrowRight' });
  fireEvent.keyDown(separator, { key: 'ArrowRight' });
  assert.equal(width(), '360');
});

test('saved wide sidebars follow window shrink and never exceed the chat-safe row', () => {
  stubEnvironment();
  seed({ open: true, width: 1_200 });
  const view = render(createElement(Harness));

  assert.equal(width(), '1200');
  act(() => { containerWidth = 768; observers[0].resize(); });
  assert.equal(width(), '568');
  act(() => { containerWidth = 488; observers[0].resize(); });
  assert.equal(width(), '288');

  view.unmount();
  assert.equal(observers[0].disconnected, true);
});

test('the mobile drawer never resizes and never overwrites the saved desktop width', () => {
  stubEnvironment();
  seed({ open: true, width: 1_200 });
  containerWidth = 390;
  render(createElement(Harness, { mobile: true }));

  assert.equal(observers.length, 0);
  assert.equal(screen.queryByRole('separator'), null);
  assert.ok(screen.getByRole('complementary', { name: 'agentSidebar.title' }));

  const backdrop = screen.getAllByRole('button', { name: 'agentSidebar.close' })[0];
  assert.match(backdrop.className, /fixed inset-0/);
  fireEvent.click(backdrop);

  assert.equal(screen.queryByRole('complementary'), null);
  assert.equal(persisted().width, 1_200);
});

test('the mobile close button dismisses the drawer', () => {
  stubEnvironment();
  seed({ open: true, width: 1_200 });
  render(createElement(Harness, { mobile: true }));

  const closeButton = screen.getAllByRole('button', { name: 'agentSidebar.close' })[1];
  fireEvent.click(closeButton);

  assert.equal(screen.queryByRole('complementary'), null);
  assert.equal(persisted().open, false);
});

test('the resize keys are ignored on mobile even when they reach the handler', () => {
  stubEnvironment();
  seed({ open: true, width: 1_200 });
  render(createElement(Harness, { mobile: true }));

  fireEvent.keyDown(screen.getByText('Keys'), { key: 'ArrowLeft' });
  fireEvent.keyDown(screen.getByText('Keys'), { key: 'ArrowRight' });

  assert.equal(width(), String(DEFAULT_AGENT_SIDEBAR_WIDTH));
  assert.equal(persisted().width, 1_200);
});
