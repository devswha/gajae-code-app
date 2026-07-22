import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { isServerDrainingCloseEvent, ServerDrainingOverlay } from './WebSocketContext';

test('classifies only the server draining close signal', () => {
  assert.equal(isServerDrainingCloseEvent({ code: 1001, reason: 'server-draining' }), true);

  for (const event of [
    { code: 1000, reason: 'server-draining' },
    { code: 1001, reason: 'server-restarting' },
    { code: 1011, reason: 'server-draining' },
    { code: 1001, reason: '' },
  ]) {
    assert.equal(isServerDrainingCloseEvent(event), false);
  }
});

test('renders an accessible server-draining overlay with preservation guidance', () => {
  const markup = renderToStaticMarkup(createElement(ServerDrainingOverlay, { isServerDraining: true }));

  assert.match(markup, /role="alertdialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /aria-labelledby="server-draining-title"/);
  assert.match(markup, /aria-describedby="server-draining-description"/);
  assert.match(markup, /Server is shutting down/);
  assert.match(markup, /server is cleaning up active work/i);
  assert.match(markup, /job state is preserved/i);
});

test('does not render the overlay outside the server-draining state', () => {
  assert.equal(renderToStaticMarkup(createElement(ServerDrainingOverlay, { isServerDraining: false })), '');
});
