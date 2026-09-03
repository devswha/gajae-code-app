import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { markDesktopShell, openExternalUrl, routeExternalAnchors, safeExternalUrl } from './externalLink';

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

test('a target=_blank anchor is routed through the sidecar in the desktop shell and left alone in a browser', () => {
  const fetch = installFetch();
  const dispose = routeExternalAnchors(document);
  document.body.innerHTML = '<a id="docs" href="https://example.com/docs" target="_blank">docs</a><a id="same" href="https://example.com/same">same tab</a>';
  const click = (id: string) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    document.getElementById(id)?.dispatchEvent(event);
    return event.defaultPrevented;
  };
  try {
    assert.equal(click('docs'), false, 'a browser keeps the anchor');
    markDesktopShell(true);
    assert.equal(click('docs'), true, 'the shell takes the anchor');
    assert.equal(fetch.calls[0]?.body && (fetch.calls[0].body as { url: string }).url, 'https://example.com/docs');
    assert.equal(click('same'), false, 'same-tab navigation is not an external link');
    assert.equal(fetch.calls.length, 1);
  } finally {
    dispose();
    fetch.restore();
  }
});
