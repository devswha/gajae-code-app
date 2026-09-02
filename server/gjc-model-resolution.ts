/**
 * Fixed failure surface for a GJC run whose model cannot be paired with a
 * credential the runtime can use — a default role that resolves to nothing,
 * or a pinned model whose provider has no stored credential and no key the
 * auth layer can resolve (`models.yml` `apiKey`/`apiKeyEnv`, env fallback).
 *
 * Mirrors `gjc-permission-policy.ts`: one application error code, fixed text
 * that is safe to relay to a browser because it carries no frame content, an
 * error class the adapter throws, and a guard the worker answers with.
 */

/** Application error code a worker answers a run with when its model cannot be resolved. */
export const GJC_MODEL_UNRESOLVED_CODE = 'model_unresolved';
/** Fixed text for that failure; safe to relay to a browser because it carries no frame content. */
export const GJC_MODEL_UNRESOLVED_MESSAGE = 'The GJC model could not be resolved. Check the model selection and provider sign-in, then try again.';

export class GjcModelResolutionError extends Error {
  readonly code = GJC_MODEL_UNRESOLVED_CODE;

  constructor() {
    super(GJC_MODEL_UNRESOLVED_MESSAGE);
    this.name = 'GjcModelResolutionError';
  }
}

export function isGjcModelResolutionError(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === GJC_MODEL_UNRESOLVED_CODE;
}
