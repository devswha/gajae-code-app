import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Collapsible, CollapsibleContent } from './Collapsible';

test('closed collapsibles keep large descendants out of the layout tree', () => {
  const closed = renderToStaticMarkup(createElement(
    Collapsible,
    null,
    createElement(CollapsibleContent, null, 'oversized-tool-result'),
  ));
  const open = renderToStaticMarkup(createElement(
    Collapsible,
    { defaultOpen: true },
    createElement(CollapsibleContent, null, 'oversized-tool-result'),
  ));

  assert.doesNotMatch(closed, /oversized-tool-result/);
  assert.match(open, /oversized-tool-result/);
});
