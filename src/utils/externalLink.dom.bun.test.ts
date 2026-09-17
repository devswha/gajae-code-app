import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { markDesktopShell, openBrowserUrl, openExternalUrl, routeExternalAnchors, safeExternalUrl } from './externalLink';

type FetchCall = { url: string; body: unknown };

const installFetch = () => {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
};

const installWindowOpen = () => {
  const opened: string[] = [];
  const original = window.open;
  window.open = ((url?: string | URL) => { opened.push(String(url)); return null; }) as typeof window.open;
  return { opened, restore: () => { window.open = original; } };
};

afterEach(() => {
  markDesktopShell(false);
  document.body.innerHTML = '';
});

test('only https pages with a host leave the app', () => {
  assert.equal(safeExternalUrl('https://auth.example.com/x?y=1'), 'https://auth.example.com/x?y=1');
  for (const bad of ['http://example.com', 'javascript:alert(1)', 'file:///etc/passwd', 'https://', 42, null, 'x'.repeat(5000)]) {
    assert.equal(safeExternalUrl(bad), null, `${String(bad).slice(0, 30)} must not pass`);
  }
});

test('in a browser the link opens a new tab, and noopener returning null is not a failure', async () => {
  const opener = installWindowOpen();
  const fetch = installFetch();
  try {
    assert.equal(await openExternalUrl('https://example.com/docs'), true);
    assert.deepEqual(opener.opened, ['https://example.com/docs']);
    assert.equal(fetch.calls.length, 0, 'the browser does not ask the server');
    assert.equal(await openExternalUrl('http://example.com'), false);
  } finally {
    opener.restore();
    fetch.restore();
  }
});

test('inside the desktop shell the sidecar opens the link, not window.open', async () => {
  markDesktopShell(true);
  const opener = installWindowOpen();
  const fetch = installFetch();
  try {
    assert.equal(await openExternalUrl('https://auth.example.com/oauth'), true);
    assert.deepEqual(fetch.calls.map((call) => [call.url, call.body]), [['/api/system/open-url', { url: 'https://auth.example.com/oauth' }]]);
    assert.deepEqual(opener.opened, []);
  } finally {
    opener.restore();
    fetch.restore();
  }
});

test('external browser HTTP and HTTPS pages use the desktop opener without widening OAuth links', async () => {
  markDesktopShell(true);
  const opener = installWindowOpen();
  const fetch = installFetch();
  try {
    for (const url of ['http://localhost:5173/path', 'https://example.com/docs']) {
      assert.equal(await openBrowserUrl(url), true);
    }
    assert.deepEqual(fetch.calls, [
      { url: '/api/system/open-browser-url', body: { url: 'http://localhost:5173/path' } },
      { url: '/api/system/open-browser-url', body: { url: 'https://example.com/docs' } },
    ]);
    for (const bad of ['about:blank', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,test', null]) {
      assert.equal(await openBrowserUrl(bad), false);
    }
    assert.equal(await openExternalUrl('http://localhost:5173'), false);
    assert.equal(fetch.calls.length, 2);
    assert.deepEqual(opener.opened, []);
  } finally {
    opener.restore();
    fetch.restore();
  }
});

test('a target=_blank anchor is routed through the sidecar in the desktop shell and left alone in a browser', () => {
  const fetch = installFetch();
  const dispose = routeExternalAnchors(document);
  // A later document-bubble observer stands in for the shell's own injected
  // link handler: when our capture listener takes a link it must never run.
  const downstream: Array<{ dp: boolean }> = [];
  const observer = (event: Event): void => {
    downstream.push({ dp: event.defaultPrevented });
    event.preventDefault();
  };
  document.addEventListener('click', observer);
  document.body.innerHTML = '<a id="docs" href="https://example.com/docs" target="_blank">docs</a><a id="same" href="https://example.com/same">same tab</a>';
  const click = (id: string): void => {
    document.getElementById(id)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  };
  try {
    click('docs');
    assert.equal(fetch.calls.length, 0, 'a browser keeps the anchor');
    assert.equal(downstream.length, 1, 'a browser click reaches later listeners');
    markDesktopShell(true);
    click('docs');
    assert.equal(fetch.calls.length, 1, 'the shell takes the anchor');
    assert.equal(fetch.calls[0]?.body && (fetch.calls[0].body as { url: string }).url, 'https://example.com/docs');
    assert.equal(downstream.length, 1, 'a handled link stops later click listeners');
    click('same');
    assert.equal(fetch.calls.length, 1, 'same-tab navigation is not an external link');
    assert.equal(downstream.length, 2, 'same-tab anchors pass through untouched');
  } finally {
    dispose();
    document.removeEventListener('click', observer);
    fetch.restore();
  }
});
