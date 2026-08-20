/**
 * Returns the primary selector from the scalar forms GJC accepts for a model
 * role. A role may be one selector or an inline YAML fallback sequence; the
 * app's catalog has room for one selector per role, so it presents the first
 * entry until a live session reports which fallback actually ran.
 */
export function primaryModelSelector(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith('[')) return unquote(trimmed);
  if (!trimmed.endsWith(']')) return undefined;

  const content = trimmed.slice(1, -1).trim();
  if (!content) return undefined;

  let quote: '"' | "'" | null = null;
  let escaped = false;
  let end = content.length;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : quote ?? character;
      continue;
    }
    if (character === ',' && quote === null) {
      end = index;
      break;
    }
  }

  return unquote(content.slice(0, end).trim());
}

function unquote(value: string): string | undefined {
  if (!value) return undefined;
  if ((value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))) {
    const unquoted = value.slice(1, -1).trim();
    return unquoted || undefined;
  }
  return value;
}
