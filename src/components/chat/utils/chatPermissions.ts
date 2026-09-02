export function formatToolInputForDisplay(input: unknown) {
  switch (typeof input) {
    case 'undefined':
      return '';
    case 'string':
      return input;
    case 'object':
      if (input === null) return '';
      break;
  }

  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

/**
 * The answer kinds the runtime offered for a permission card, when it said:
 * `context.options` lists e.g. allow_once / allow_always / reject_once /
 * reject_always. Null when the producer sent no options - the card then
 * offers its historical set (everything except always-deny).
 */
export function offeredPermissionKinds(context: unknown): Set<string> | null {
  if (!context || typeof context !== 'object') return null;
  const options = (context as { options?: unknown }).options;
  if (!Array.isArray(options) || options.length === 0) return null;
  const kinds = new Set(options.filter((kind): kind is string => typeof kind === 'string'));
  return kinds.size ? kinds : null;
}
