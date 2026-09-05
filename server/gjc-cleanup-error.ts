/** Reserved worker control-plane failure; never inferred from provider text. */
export const GJC_CLEANUP_UNCONFIRMED_CODE = 'worker_cleanup_unconfirmed';
export const GJC_CLEANUP_UNCONFIRMED_MESSAGE = 'GJC worker cleanup could not be confirmed.';

const cleanupFailures = new WeakSet<object>();

export class GjcCleanupUnconfirmedError extends Error {
  constructor() {
    super(GJC_CLEANUP_UNCONFIRMED_MESSAGE);
    this.name = 'GjcCleanupUnconfirmedError';
    cleanupFailures.add(this);
  }
}

export function isGjcCleanupUnconfirmedError(error: unknown): error is GjcCleanupUnconfirmedError {
  return typeof error === 'object' && error !== null && cleanupFailures.has(error);
}
