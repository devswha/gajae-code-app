/**
 * Packages installed by the dependency tree that must not ship in a Gajae Code
 * App distribution.
 *
 * The app bundles `@gajae-code/coding-agent`, which this project does not
 * control. Its dependency tree is therefore a license surface we inherit
 * rather than choose, and it currently pulls two packages whose terms are
 * incompatible with the licensing this product is heading toward.
 *
 * Removing them is a packaging decision, not a patch: nothing upstream is
 * modified, the deletion is re-applied on every build, and a runtime bump
 * needs no manual review because `check:dependency-licenses` fails when a new
 * incompatible package appears.
 *
 * Each entry must name what the exclusion costs. An exclusion whose package is
 * no longer in the tree also fails the check, so this list cannot rot into a
 * set of rules guarding nothing.
 */
export const EXCLUDED_FROM_DISTRIBUTION = [
  {
    package: 'mupdf',
    license: 'AGPL-3.0-or-later',
    via: '@gajae-code/coding-agent → markit-ai',
    cost:
      'The read tool stops converting PDFs. Its other eighteen converters - Word, '
      + 'PowerPoint, Excel, EPUB, iWork, notebooks, audio, images, HTML, RSS - are '
      + 'untouched, because mupdf is confined to markit-ai\'s pdf converter.',
    reason:
      'A copyleft dependency would impose its terms on this MIT '
      + 'product, and the app cannot drop it upstream: markit-ai is a hard '
      + 'dependency of a package this project does not control. markit-ai itself '
      + 'is MIT, so restoring PDF later means forking it and swapping mupdf for a '
      + 'permissive engine, or handling PDFs above the runtime.',
  },
  {
    package: 'elkjs',
    license: 'EPL-2.0',
    via: '@gajae-code/coding-agent → @gajae-code/utils → beautiful-mermaid',
    cost:
      'Mermaid diagram layout. Nothing reaches it: `render_mermaid` is withheld in '
      + 'server/gjc-agent-tools.ts, so the app never requests the tool that would.',
    reason:
      'EPL-2.0 is not compatible with GPL-family licenses absent a secondary-license '
      + 'election, and it is reachable only through a tool this app deliberately '
      + 'does not enable.',
  },
];

/** Removes the excluded packages from an installed `node_modules` tree. */
export async function removeExcludedDistributionPackages(fs, path, nodeModulesDir) {
  const removed = [];
  for (const entry of EXCLUDED_FROM_DISTRIBUTION) {
    const target = path.join(nodeModulesDir, ...entry.package.split('/'));
    try {
      await fs.rm(target, { recursive: true, force: true });
      removed.push(entry.package);
    } catch (error) {
      throw new Error(`Failed to exclude ${entry.package} from the distribution: ${error.message}`);
    }
  }
  return removed;
}
