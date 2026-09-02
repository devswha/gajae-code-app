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
 *
 * Deleting a package is only safe when nothing imports it at module scope. When
 * something does, `stub` names a first-party package under `./stubs/` that is
 * installed in the deleted package's place so the import resolves; the stub's
 * own code fails the feature, not the runtime. The stub's version is rewritten
 * to the version it replaces so a tree listing still reads correctly.
 */
import { fileURLToPath } from 'node:url';

const STUBS_DIR = new URL('./stubs/', import.meta.url);

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
    // markit-ai loads mupdf inside its PDF converter (`require("mupdf")` /
    // `await import("mupdf")` in a function), so a plain deletion degrades one
    // feature and leaves the runtime loading. No stub is needed.
    stub: null,
  },
  {
    package: 'elkjs',
    license: 'EPL-2.0',
    via: '@gajae-code/coding-agent → @gajae-code/utils → beautiful-mermaid',
    cost:
      'Mermaid diagram layout. Nothing reaches it: `render_mermaid` is withheld in '
      + 'server/gjc-agent-tools.ts, so the app never requests the tool that would, '
      + 'and the TUI-only markdown renderer that also calls it is not part of the worker.',
    reason:
      'EPL-2.0 is not compatible with GPL-family licenses absent a secondary-license '
      + 'election, and it is reachable only through a tool this app deliberately '
      + 'does not enable.',
    // beautiful-mermaid imports `elkjs/lib/elk.bundled.js` at module scope
    // (src/elk-instance.ts, also dist/index.js), and the GJC runtime loads
    // beautiful-mermaid while it loads itself. Without a resolvable package the
    // Bun worker dies at `worker.initialize` with `Cannot find package 'elkjs'`
    // - everywhere except inside this checkout, where Bun walks up to the
    // repository's own node_modules and hides the hole. The stub keeps the
    // import resolvable and makes every layout call fail instead.
    stub: 'elkjs',
  },
];

async function installDistributionStub(fs, path, entry, target, replacedVersion) {
  const stubDir = path.join(fileURLToPath(STUBS_DIR), entry.stub);
  await fs.cp(stubDir, target, { recursive: true });
  const manifestPath = path.join(target, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.name !== entry.package) {
    throw new Error(`Stub ${entry.stub} is named ${manifest.name}, but it replaces ${entry.package}.`);
  }
  if (manifest.license !== 'MIT') {
    throw new Error(`Stub ${entry.stub} must be MIT so it can ship where ${entry.package} cannot.`);
  }
  manifest.version = replacedVersion;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function installedVersion(fs, path, target) {
  try {
    return JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

/**
 * Removes the excluded packages from an installed `node_modules` tree and
 * installs the recorded stubs in their place.
 *
 * Returns the names removed and the names that now hold a stub; a stubbed
 * package is also listed as removed, since none of its code remains.
 */
export async function removeExcludedDistributionPackages(fs, path, nodeModulesDir) {
  const removed = [];
  const stubbed = [];
  for (const entry of EXCLUDED_FROM_DISTRIBUTION) {
    const target = path.join(nodeModulesDir, ...entry.package.split('/'));
    try {
      const replacedVersion = await installedVersion(fs, path, target);
      await fs.rm(target, { recursive: true, force: true });
      removed.push(entry.package);
      if (entry.stub) {
        await installDistributionStub(fs, path, entry, target, replacedVersion ?? '0.0.0-gajae-stub');
        stubbed.push(entry.package);
      }
    } catch (error) {
      throw new Error(`Failed to exclude ${entry.package} from the distribution: ${error.message}`);
    }
  }
  return { removed, stubbed };
}

/** One line for build logs: what left the tree and what stands in for it. */
export function describeDistributionExclusions({ removed, stubbed }) {
  const stubNote = stubbed.length > 0 ? `; stubbed ${stubbed.join(', ')}` : '';
  return `Excluded ${removed.join(', ')}${stubNote} (see scripts/release/distribution-exclusions.mjs).`;
}
