/**
 * The app's one syntax highlighter.
 *
 * The default `Prism` build of react-syntax-highlighter statically bundles
 * every Prism language (~620 KB in vendor-syntax). This module is the
 * PrismLight build with only the languages a coding-agent chat actually
 * shows, registered together with their common fence aliases. An
 * unregistered language degrades to an unhighlighted block, which is the
 * correct fallback for exotic fences.
 *
 * Both markdown surfaces (chat Markdown, editor MarkdownCodeBlock) import
 * from here; do not import react-syntax-highlighter directly elsewhere, or
 * the full-bundle build comes back.
 */
import type * as React from 'react';
import PrismLightModule from 'react-syntax-highlighter/dist/esm/prism-light';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import toml from 'react-syntax-highlighter/dist/esm/languages/prism/toml';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';

// Vite resolves these ESM files directly; the node/tsx test lane goes through
// CJS interop and hands us `{ default }` wrappers instead. Unwrap both shapes.
type PrismLightComponent = React.ComponentType<Record<string, unknown>> & {
  registerLanguage: (name: string, language: unknown) => void;
};
const unwrap = <T,>(module: T): T =>
  (module as { default?: T })?.default ?? module;

const SyntaxHighlighter = unwrap(PrismLightModule) as PrismLightComponent;

const registrations: Array<[string[], unknown]> = [
  [['bash', 'sh', 'shell', 'zsh', 'shellscript'], bash],
  [['css'], css],
  [['diff', 'patch'], diff],
  [['go', 'golang'], go],
  [['javascript', 'js', 'mjs', 'cjs'], javascript],
  [['json', 'jsonc'], json],
  [['jsx'], jsx],
  [['markdown', 'md'], markdown],
  [['markup', 'html', 'xml', 'svg'], markup],
  [['python', 'py'], python],
  [['rust', 'rs'], rust],
  [['sql'], sql],
  [['toml'], toml],
  [['tsx'], tsx],
  [['typescript', 'ts'], typescript],
  [['yaml', 'yml'], yaml],
];

for (const [names, language] of registrations) {
  for (const name of names) {
    SyntaxHighlighter.registerLanguage(name, unwrap(language));
  }
}

export { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
export default SyntaxHighlighter;
