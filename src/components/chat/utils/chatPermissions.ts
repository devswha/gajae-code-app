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
