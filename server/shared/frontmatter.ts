import grayMatter from 'gray-matter';

// Frontmatter is metadata only: embedded executable-looking values must stay inert.
const inertEngine = (): Record<string, never> => ({});
// Explicit no-op engines keep metadata parsing from becoming a code-execution surface.
const inertEngines = Object.fromEntries(['js', 'javascript', 'json'].map((name) => [name, inertEngine]));
const parserConfiguration = { language: 'yaml', engines: inertEngines };

export function parseFrontMatter(content: string) {
  return grayMatter(content, parserConfiguration);
}
