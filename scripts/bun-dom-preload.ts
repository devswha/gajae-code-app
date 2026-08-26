/**
 * Gives a DOM to the Bun tests that ask for one, and only to those.
 *
 * The client suite renders through `renderToStaticMarkup` and asserts on HTML
 * strings, which cannot reach a hook, an event or an effect - a dropdown's
 * items only exist once it is open, and no string test can open it. happy-dom
 * closes that gap.
 *
 * It has to be a preload rather than an import inside the test file: Bun
 * evaluates `node_modules` dependencies before local ones, so
 * `@testing-library/dom` captures `document.body` and installs throwing stubs
 * before any local module gets the chance to register a document.
 *
 * The guard is what keeps this from being a global switch. Every Bun file is
 * run as `bun test <file>` (see scripts/run-tests.mjs), so the path is in argv:
 * the server contract suites never see `window`, where code branching on
 * `typeof window` would silently take the browser path.
 */

import { GlobalRegistrator } from '@happy-dom/global-registrator';

const DOM_TEST_MARKER = '.dom.bun.test';

const wantsDom = process.argv.some((argument) => argument.includes(DOM_TEST_MARKER));

if (wantsDom && typeof globalThis.document === 'undefined') {
  GlobalRegistrator.register({ url: 'http://localhost/' });
  // React's test utilities check this before warning about updates that are
  // not wrapped in `act`.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}
