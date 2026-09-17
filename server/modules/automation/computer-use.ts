import { appConfigDb } from '@/modules/database/index.js';

/**
 * Whether GJC sessions started by this app may drive native applications
 * through CUA Driver at all.
 *
 * Off by default, by owner decision (2026-09-18, #131): the agent must not
 * take over the user's pointer, keyboard or screen unless the user asked for
 * exactly that. The driver's background delivery is documented as best-effort,
 * not a guarantee, which is why the default is "withheld unless asked" rather
 * than "background unless asked". While off, the worker never offers the
 * `computer` tool and the automation service refuses every computer call, so a
 * session cannot reach the driver by any route.
 */
const CONFIG_KEY = 'automation.computerUse.v1';

export class ComputerUseStore {
  constructor(private readonly storage: Pick<typeof appConfigDb, 'get' | 'set'> = appConfigDb) {}

  get(): boolean {
    return this.storage.get(CONFIG_KEY) === '1';
  }

  set(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new Error('Computer use must be true or false.');
    this.storage.set(CONFIG_KEY, value ? '1' : '0');
    return value;
  }
}

export const computerUseStore = new ComputerUseStore();

/** The opt-in a run's options carry to the worker. */
export function resolveGjcComputerUse(store: Pick<ComputerUseStore, 'get'> = computerUseStore): boolean {
  return store.get();
}
