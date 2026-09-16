import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';

import { useChatFollowScroll } from './useChatFollowScroll';

type ObserverEntry = { callback: ResizeObserverCallback; target: Element | null };

const observers: ObserverEntry[] = [];
const NativeResizeObserver = globalThis.ResizeObserver;

class TestResizeObserver {
  private readonly entry: ObserverEntry;

  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, target: null };
    observers.push(this.entry);
  }

  observe(target: Element) {
    this.entry.target = target;
  }

  unobserve(target: Element) {
    if (this.entry.target === target) this.entry.target = null;
  }

  disconnect() {
    this.entry.target = null;
  }
}

globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;

function notifyResize(target: Element) {
  for (const observer of observers) {
    if (observer.target === target) observer.callback([], {} as ResizeObserver);
  }
}

function Harness({ mounted = true }: { mounted?: boolean }) {
  const [height, setHeight] = useState(200);
  const heightRef = useRef(height);
  heightRef.current = height;
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const follow = useChatFollowScroll({ container, enabled: true });
  // Matches the production wiring: a stable callback ref, so React attaches and
  // detaches it with the pane instead of on every render.
  const attach = useCallback((node: HTMLDivElement | null) => {
    setContainer(node);
    if (!node) return;
    Object.defineProperties(node, {
      clientHeight: { configurable: true, get: () => 100 },
      clientWidth: { configurable: true, get: () => 300 },
      scrollHeight: { configurable: true, get: () => heightRef.current },
    });
  }, []);

  return (
    <>
      {mounted && (
        <div ref={attach} data-testid="container" style={{ height: 100, overflowY: 'auto' }}>
          <div data-testid="content" style={{ height }} />
        </div>
      )}
      <button onClick={() => setHeight((value) => value + 100)} type="button">grow</button>
      <button onClick={follow.scrollToBottom} type="button">bottom</button>
      <output data-testid="following">{String(follow.isFollowing)}</output>
    </>
  );
}

function setup(props: { mounted?: boolean } = {}) {
  const view = render(<Harness {...props} />);
  const grow = () => {
    act(() => {
      fireEvent.click(view.getByText('grow'));
      notifyResize(view.getByTestId('content'));
    });
  };
  const container = () => view.getByTestId('container') as HTMLDivElement;
  return { ...view, container, content: () => view.getByTestId('content'), grow };
}

function assertAtBottom(node: HTMLDivElement) {
  assert.ok(node.scrollHeight - node.scrollTop - node.clientHeight < 50);
}

afterEach(() => {
  cleanup();
  observers.length = 0;
});

test('follows content growth initially', () => {
  const { container, grow } = setup();
  grow();
  assertAtBottom(container());
});

test('wheel-up intent stops following future growth', () => {
  const { container, grow } = setup();
  container().scrollTop = 30;
  fireEvent.wheel(container(), { deltaY: -100 });
  grow();
  assert.equal(container().scrollTop, 30);
});

test('scrolling to the bottom resumes following', () => {
  const { container, grow } = setup();
  fireEvent.wheel(container(), { deltaY: -100 });
  container().scrollTop = container().scrollHeight - container().clientHeight;
  fireEvent.scroll(container());
  grow();
  assertAtBottom(container());
});

test('scrollToBottom resumes following', () => {
  const { container, getByText, grow } = setup();
  fireEvent.wheel(container(), { deltaY: -100 });
  fireEvent.click(getByText('bottom'));
  grow();
  assertAtBottom(container());
});

test('a passive scroll away from the bottom does not stop following', () => {
  const { container, grow } = setup();
  container().scrollTop = 20;
  fireEvent.scroll(container());
  grow();
  assertAtBottom(container());
});

test('scrollbar interaction stops following growth', () => {
  const { container, grow } = setup();
  // The vertical scrollbar track lies past the client box.
  fireEvent.pointerDown(container(), { offsetX: 305 });
  container().scrollTop = 30;
  fireEvent.scroll(container());
  grow();
  assert.equal(container().scrollTop, 30);
});

test('a click on the pane gutter keeps following', () => {
  const { container, grow } = setup();
  fireEvent.pointerDown(container(), { offsetX: 12 });
  grow();
  assertAtBottom(container());
});

test('PageUp from a transcript child stops following', () => {
  const { container, content, grow } = setup();
  container().scrollTop = 30;
  fireEvent.keyDown(content(), { key: 'PageUp' });
  grow();
  assert.equal(container().scrollTop, 30);
});

test('a pane that mounts after the first render still follows growth', () => {
  // The landing view owns the viewport until the first message; the chat
  // interface itself is never remounted, so binding only at mount left every
  // later session without auto-scroll.
  const { container, grow, rerender } = setup({ mounted: false });
  act(() => rerender(<Harness mounted />));
  grow();
  assertAtBottom(container());
});

test('a remounted pane rebinds scroll intent and following', () => {
  const { container, grow, rerender } = setup();
  grow();
  act(() => rerender(<Harness mounted={false} />));
  act(() => rerender(<Harness mounted />));
  grow();
  assertAtBottom(container());
  container().scrollTop = 30;
  fireEvent.wheel(container(), { deltaY: -100 });
  grow();
  assert.equal(container().scrollTop, 30);
});

after(() => {
  globalThis.ResizeObserver = NativeResizeObserver;
});
