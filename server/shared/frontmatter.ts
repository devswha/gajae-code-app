import matter from 'gray-matter';

const inertEngine = (): Record<string, never> => ({});

const parserConfiguration = {
  language: 'yaml',
  engines: Object.fromEntries(
    ['js', 'javascript', 'json'].map((name) => [name, inertEngine]),
  ),
};

export function parseFrontMatter(content: string) {
  return matter(content, parserConfiguration);
}
