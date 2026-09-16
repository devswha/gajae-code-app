import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { registerPaletteOps, resetPaletteOps } from '../../../stores/usePaletteOpsStore';

import { Markdown } from './Markdown';

afterEach(() => {
  cleanup();
  resetPaletteOps();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

test('absolute HTTP(S) Markdown links always use the external browser action', () => {
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke: async () => undefined };

  for (const backend of ['builtin', 'aside', 'ego'] as const) {
    const externalUrls: string[] = [];
    const builtinUrls: string[] = [];
    const unregister = registerPaletteOps({
      openBuiltinBrowser: (url) => builtinUrls.push(url),
      openExternalUrl: (url) => externalUrls.push(url),
    });
    const view = render(
      <Markdown>{`[HTTP ${backend}](http://localhost:5173/path) [HTTPS ${backend}](https://example.com/docs)`}</Markdown>,
    );

    fireEvent.click(screen.getByRole('link', { name: `HTTP ${backend}` }));
    fireEvent.click(screen.getByRole('link', { name: `HTTPS ${backend}` }));
    assert.deepEqual(externalUrls, ['http://localhost:5173/path', 'https://example.com/docs'], backend);
    assert.deepEqual(builtinUrls, [], backend);

    view.unmount();
    unregister();
  }
});

test('a transcript link cannot carry a scheme the app would not navigate to', () => {
  // The markdown in an answer is attacker-influenced text. `javascript:` runs
  // in the app, `data:` makes the app the host of a document, and `tauri://`
  // is the desktop shell's own origin - which this webview, loaded over
  // loopback HTTP, is deliberately kept off. The text stays; the link does not.
  const view = render(
    <Markdown>
      {'[run it](javascript:alert(1)) [inline doc](data:text/html,<script>alert(1)</script>) [shell](tauri://localhost/index.html) [ok](https://example.com/)'}
    </Markdown>,
  );
  for (const name of ['run it', 'inline doc', 'shell']) {
    assert.equal(screen.queryByRole('link', { name }), null, name);
    assert.ok(screen.getByText(name), `${name} is still readable`);
  }
  assert.ok(screen.getByRole('link', { name: 'ok' }), 'an https link is untouched');
  view.unmount();
});
