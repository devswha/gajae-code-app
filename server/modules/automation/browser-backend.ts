import {
  DEFAULT_GJC_BROWSER_BACKEND,
  GJC_BROWSER_BACKENDS,
  isGjcBrowserBackend,
  type GjcBrowserBackend,
} from '@/gjc-engine.js';
import { appConfigDb } from '@/modules/database/index.js';

/**
 * Which browser surface GJC sessions started by this app offer the model.
 *
 * `builtin` (the default) selects the application's built-in browser surface.
 * `aside` (experimental) asks the runtime for its own Aside backend: the
 * runtime hides the built-in browser tool and routes browser work through the
 * user-installed Aside CLI. The app stores only the choice; the routing, the
 * Aside skill and the CLI discovery all belong to the runtime.
 * `ego` (PoC) hides every built-in browser tool and routes browser work through
 * the user-installed `ego-browser` CLI (ego lite) with an app-owned routing
 * block, because the runtime has no ego backend of its own.
 */
const CONFIG_KEY = 'automation.browserBackend.v1';

export class BrowserBackendStore {
  constructor(private readonly storage: Pick<typeof appConfigDb, 'get' | 'set'> = appConfigDb) {}

  get(): GjcBrowserBackend {
    const stored = this.storage.get(CONFIG_KEY);
    // Keep old installations working without rewriting their configuration.
    if (stored === 'native') return 'builtin';
    return isGjcBrowserBackend(stored) ? stored : DEFAULT_GJC_BROWSER_BACKEND;
  }

  set(value: unknown): GjcBrowserBackend {
    if (!isGjcBrowserBackend(value)) {
      throw new Error(`Browser backend must be one of ${GJC_BROWSER_BACKENDS.join(', ')}.`);
    }
    this.storage.set(CONFIG_KEY, value);
    return value;
  }
}

export const browserBackendStore = new BrowserBackendStore();

/** The backend a run's options carry to the worker. */
export function resolveGjcBrowserBackend(store: Pick<BrowserBackendStore, 'get'> = browserBackendStore): GjcBrowserBackend {
  return store.get();
}
