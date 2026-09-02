/**
 * Gajae Code App stub for `elkjs/lib/elk.bundled.js`.
 *
 * The real package is EPL-2.0 and is removed from every distribution (see
 * scripts/release/distribution-exclusions.mjs). `beautiful-mermaid`, which the
 * bundled GJC runtime depends on, imports this file at module scope, so an
 * absent package fails the whole runtime at load time instead of failing the
 * one feature that needs it. This file exists so the import resolves; every
 * layout request it receives fails with the error below.
 *
 * Surface kept, and why:
 *   - default export: a class constructed with `new` (elk-instance.ts:61)
 *   - `instance.worker.worker`: the "raw worker" beautiful-mermaid reaches
 *     into, with `onmessage`, `postMessage` and `dispatcher.saveDispatch`
 *     (elk-instance.ts:73, :94, :105)
 *   - `layout()` and the `known*` queries of the public ELK API, for any other
 *     caller that goes through the documented interface.
 *
 * Nothing here is derived from elkjs; it is first-party code under this
 * project's MIT licence.
 */

export const ELK_NOT_BUNDLED_MESSAGE =
  'ELK layout is not bundled in this distribution: Gajae Code App ships a stub in place of '
  + 'elkjs (EPL-2.0), so Mermaid diagrams that need ELK layout cannot be rendered here.';

export class ElkLayoutUnavailableError extends Error {
  constructor() {
    super(ELK_NOT_BUNDLED_MESSAGE);
    this.name = 'ElkLayoutUnavailableError';
    this.code = 'ELK_NOT_BUNDLED';
  }
}

/** Stands in for ELK's FakeWorker: answers every message with the error. */
class StubWorker {
  constructor() {
    this.onmessage = null;
    this.dispatcher = { saveDispatch: (message) => this.answer(message) };
  }

  answer(message) {
    const id = message?.data?.id;
    if (typeof this.onmessage === 'function') {
      this.onmessage({ data: { id, error: new ElkLayoutUnavailableError() } });
    }
  }

  postMessage(message) {
    setTimeout(() => this.answer({ data: message }), 0);
  }

  terminate() {}
}

export default class ELK {
  constructor(options = {}) {
    this.defaultLayoutOptions = options.defaultLayoutOptions ?? {};
    this.worker = { worker: new StubWorker() };
  }

  layout() {
    return Promise.reject(new ElkLayoutUnavailableError());
  }

  knownLayoutAlgorithms() {
    return Promise.resolve([]);
  }

  knownLayoutOptions() {
    return Promise.resolve([]);
  }

  knownLayoutCategories() {
    return Promise.resolve([]);
  }

  terminateWorker() {}
}
