#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ARTIFACT_PREFIX,
  AUTHOR,
  CLI_NAME,
  DESKTOP_APP_ID,
  NODE_ENGINE_RANGE,
  PACKAGE_NAME,
  PRODUCT_NAME,
  REPOSITORY_URL,
  URL_SCHEME,
} from '../shared/productIdentity.js';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_REPORTED_ERRORS = 100;
const GENERATED_DIRECTORIES = ['dist', 'dist-server', 'release'];
const SKIPPED_RELATIVE_DIRECTORIES = new Set(['website/dist']);
const SKIPPED_DIRECTORIES = new Set([
  '.codegraph',
  '.desktop-build',
  '.git',
  '.gjc',
  '.gjc-worktrees',
  '.omo',
  'node_modules',
]);
const ARCHIVE_FILE_PATTERN = /\.(?:tar|tgz|gz|zip|bz2|xz|deb|appimage)$/i;
const PROTECTED_FILE_HASHES = new Map([
  ['LICENSE', '58328d2c08c0a1ee02081e41c2edf9217bed84475de05b2d35aa7c8d66a37b96'],
  ['NOTICE', '565d83ee84dcc05c3870696cd0f9f78a4597d6d97636f0e8c104628698208509'],
]);
const LEGACY_TOKEN = ['cloud', 'cli'].join('');
const LEGACY_COORDINATE = ['siteboon', 'claudecodeui'].join('/');
const STALE_FORK_COORDINATE = ['devswha', 'claudecodeui'].join('/');
const UPSTREAM_NAME = 'Claude Code UI';
const UPSTREAM_URL = `https://github.com/${LEGACY_COORDINATE}`;
const LEGACY_MATCHERS = [
  {
    label: 'legacy product token',
    expression: new RegExp(LEGACY_TOKEN, 'gi'),
  },
  {
    label: 'legacy spaced product name',
    expression: new RegExp(['cloud', '\\s+', 'cli'].join(''), 'gi'),
  },
  {
    label: 'legacy upstream coordinate',
    expression: new RegExp(LEGACY_COORDINATE, 'gi'),
  },
  {
    label: 'legacy downstream fork coordinate',
    expression: new RegExp(STALE_FORK_COORDINATE, 'gi'),
  },
];
// The changelog now records this project's own releases; the inherited history
// it used to carry lives in the upstream project instead. One provenance line
// remains, and these counts pin it so it cannot quietly grow back.
const CHANGELOG_ALLOWANCES = [
  { matcher: LEGACY_MATCHERS[0], expected: 0 },
  { matcher: LEGACY_MATCHERS[1], expected: 0 },
  { matcher: LEGACY_MATCHERS[2], expected: 0 },
  { matcher: LEGACY_MATCHERS[3], expected: 0 },
];
const DATED_MIGRATION_HISTORY = /^docs\/(?:history|migration)\/\d{4}-\d{2}-\d{2}(?:[-_][^/]+)?\.md$/i;

const errors = [];
const checkedFiles = {
  archive: 0,
  generated: 0,
  source: 0,
};

function addError(message) {
  errors.push(message);
}

function normalizeRelativePath(absolutePath) {
  return relative(REPOSITORY_ROOT, absolutePath).split(sep).join('/');
}

function exactRanges(text, value) {
  const ranges = [];
  let index = text.indexOf(value);

  while (index !== -1) {
    ranges.push({ end: index + value.length, start: index });
    index = text.indexOf(value, index + value.length);
  }

  return ranges;
}

function matchRanges(text, expression) {
  return Array.from(text.matchAll(new RegExp(expression.source, expression.flags))).map((match) => ({
    end: match.index + match[0].length,
    start: match.index,
  }));
}

function isAllowedRange(match, allowedRanges) {
  return allowedRanges.some((range) => match.start >= range.start && match.end <= range.end);
}

function lineAndColumn(text, index) {
  const prefix = text.slice(0, index);
  const line = prefix.split('\n').length;
  const lastNewline = prefix.lastIndexOf('\n');
  return { column: index - lastNewline, line };
}

function scanPath(relativePath) {
  for (const matcher of LEGACY_MATCHERS) {
    if (matcher.expression.test(relativePath)) {
      addError(`${relativePath}: ${matcher.label} in path`);
    }
    matcher.expression.lastIndex = 0;
  }
}

function scanText(relativePath, text, allowedRanges = []) {
  for (const matcher of LEGACY_MATCHERS) {
    for (const match of matchRanges(text, matcher.expression)) {
      if (isAllowedRange(match, allowedRanges)) {
        continue;
      }

      const { column, line } = lineAndColumn(text, match.start);
      addError(`${relativePath}:${line}:${column}: ${matcher.label}`);
    }
  }
}

function validateExactCount(relativePath, label, ranges, expected) {
  if (ranges.length !== expected) {
    addError(`${relativePath}: expected ${expected} ${label} occurrence(s), found ${ranges.length}`);
  }
}

function validateProtectedFile(relativePath, buffer) {
  const expectedHash = PROTECTED_FILE_HASHES.get(relativePath);
  const actualHash = createHash('sha256').update(buffer).digest('hex');

  if (actualHash !== expectedHash) {
    addError(`${relativePath}: protected legal file hash changed`);
  }
}

function validateProvenanceDocument(relativePath, text) {
  const nameRanges = exactRanges(text, UPSTREAM_NAME);
  const urlRanges = exactRanges(text, UPSTREAM_URL);

  validateExactCount(relativePath, 'upstream name', nameRanges, 1);
  validateExactCount(relativePath, 'upstream URL', urlRanges, 1);
  scanText(relativePath, text, [...nameRanges, ...urlRanges]);
}

function validateChangelog(text) {
  for (const allowance of CHANGELOG_ALLOWANCES) {
    validateExactCount(
      'CHANGELOG.md',
      allowance.matcher.label,
      matchRanges(text, allowance.matcher.expression),
      allowance.expected,
    );
  }
}

function scanSpecialFile(relativePath, buffer) {
  if (PROTECTED_FILE_HASHES.has(relativePath)) {
    validateProtectedFile(relativePath, buffer);
    return;
  }

  const text = buffer.toString('utf8');

  if (relativePath === 'CHANGELOG.md') {
    validateChangelog(text);
    return;
  }

  if (relativePath === 'docs/UPSTREAM.md' || DATED_MIGRATION_HISTORY.test(relativePath)) {
    validateProvenanceDocument(relativePath, text);
    return;
  }

  scanText(relativePath, text);
}

async function scanFile(absolutePath, relativePath, category) {
  scanPath(relativePath);

  const fileStat = await stat(absolutePath);
  const sizeLimit = category === 'archive' ? MAX_ARCHIVE_BYTES : MAX_FILE_BYTES;
  if (fileStat.size > sizeLimit) {
    addError(`${relativePath}: exceeds the ${sizeLimit}-byte scan limit`);
    return;
  }

  const buffer = await readFile(absolutePath);
  checkedFiles[category] += 1;
  scanSpecialFile(relativePath, buffer);
}

async function walkDirectory(directoryPath, category) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const absolutePath = resolve(directoryPath, entry.name);
    const relativePath = normalizeRelativePath(absolutePath);

    if (SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    if (entry.isSymbolicLink()) {
      addError(`${relativePath}: symbolic links are not scanned`);
      continue;
    }

    // Third-party runtime binaries staged into dist-native (e.g. the bundled
    // Bun runtime) are not project-authored content and exceed scan limits.
    if (relativePath === 'dist-native/bun' || relativePath === 'dist-native/bun.exe') {
      continue;
    }

    if (entry.isDirectory()) {
      if (relativePath.startsWith('release/server/.stage-')) {
        continue;
      }
      if (relativePath === 'release/desktop') {
        continue;
      }
      // Per-OS platform artifacts (gitignored; built locally on macOS): the
      // Tauri cargo target dir, staged sidecar binaries, and the embedded
      // server payload are not project-authored content.
      if (
        relativePath === 'src-tauri/target' ||
        relativePath === 'src-tauri/binaries' ||
        relativePath === 'src-tauri/resources/server-payload'
      ) {
        continue;
      }

      if (category === 'source' && GENERATED_DIRECTORIES.includes(entry.name)) {
        continue;
      }
      if (SKIPPED_RELATIVE_DIRECTORIES.has(relativePath)) {
        continue;
      }

      scanPath(relativePath);
      await walkDirectory(absolutePath, category);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fileCategory = ARCHIVE_FILE_PATTERN.test(entry.name) ? 'archive' : category;
    await scanFile(absolutePath, relativePath, fileCategory);
  }
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    addError(`${label}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`);
  }
}

function assertExactObject(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    addError(`${label}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`);
  }
}

async function readJson(relativePath) {
  try {
    return JSON.parse(await readFile(resolve(REPOSITORY_ROOT, relativePath), 'utf8'));
  } catch (error) {
    addError(`${relativePath}: could not parse JSON (${error.message})`);
    return undefined;
  }
}

function validatePackageMetadata(packageJson, packageLock) {
  if (!packageJson || !packageLock) {
    return;
  }

  assertEqual('package.json name', packageJson.name, PACKAGE_NAME);
  assertEqual('package.json private', packageJson.private, true);
  assertEqual('package.json productName', packageJson.productName, PRODUCT_NAME);
  assertExactObject('package.json bin', packageJson.bin, {
    [CLI_NAME]: 'dist-server/server/cli.js',
  });
  assertEqual('package.json homepage', packageJson.homepage, REPOSITORY_URL);
  assertEqual('package.json repository URL', packageJson.repository?.url, `git+${REPOSITORY_URL}.git`);
  assertEqual('package.json bugs URL', packageJson.bugs?.url, `${REPOSITORY_URL}/issues`);
  assertEqual('package.json author', packageJson.author, AUTHOR);
  assertEqual('package.json Node engine', packageJson.engines?.node, NODE_ENGINE_RANGE);
  assertEqual('package.json build app ID', packageJson.build?.appId, DESKTOP_APP_ID);
  assertEqual('package.json build product name', packageJson.build?.productName, PRODUCT_NAME);
  assertEqual('package.json executable name', packageJson.build?.executableName, CLI_NAME);
  assertEqual(
    'package.json artifact name',
    packageJson.build?.artifactName,
    `${ARTIFACT_PREFIX}desktop-${'${version}'}-${'${os}'}-${'${arch}'}.${'${ext}'}`,
  );
  assertExactObject('package.json protocol metadata', packageJson.build?.protocols, [
    {
      name: PRODUCT_NAME,
      schemes: [URL_SCHEME],
    },
  ]);
  assertEqual('package.json mac bundle name', packageJson.build?.mac?.extendInfo?.CFBundleName, PRODUCT_NAME);
  assertEqual('package.json mac bundle display name', packageJson.build?.mac?.extendInfo?.CFBundleDisplayName, PRODUCT_NAME);
  assertEqual(
    'package.json mac URL name',
    packageJson.build?.mac?.extendInfo?.CFBundleURLTypes?.[0]?.CFBundleURLName,
    PRODUCT_NAME,
  );
  assertExactObject(
    'package.json mac URL scheme',
    packageJson.build?.mac?.extendInfo?.CFBundleURLTypes?.[0]?.CFBundleURLSchemes,
    [URL_SCHEME],
  );
  assertEqual('package.json check script', packageJson.scripts?.['check:identity'], 'node scripts/check-identity.mjs');

  for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
    if (name === 'release' || /publish|update|platform/i.test(name) || /npm\s+publish\b/i.test(command)) {
      addError(`package.json scripts.${name}: forbidden publication or platform command`);
    }
  }

  const lockRoot = packageLock.packages?.[''];
  assertEqual('package-lock.json name', packageLock.name, packageJson.name);
  assertEqual('package-lock.json version', packageLock.version, packageJson.version);
  assertEqual('package-lock.json root name', lockRoot?.name, packageJson.name);
  assertEqual('package-lock.json root version', lockRoot?.version, packageJson.version);
  assertExactObject('package-lock.json root bin', lockRoot?.bin, packageJson.bin);
  assertEqual('package-lock.json Node engine', lockRoot?.engines?.node, packageJson.engines?.node);
}

const packageJson = await readJson('package.json');
const packageLock = await readJson('package-lock.json');
validatePackageMetadata(packageJson, packageLock);
await walkDirectory(REPOSITORY_ROOT, 'source');

for (const generatedDirectory of GENERATED_DIRECTORIES) {
  const absolutePath = resolve(REPOSITORY_ROOT, generatedDirectory);
  try {
    const directoryStat = await stat(absolutePath);
    if (directoryStat.isDirectory()) {
      await walkDirectory(absolutePath, 'generated');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      addError(`${generatedDirectory}: could not inspect generated directory (${error.message})`);
    }
  }
}

if (errors.length > 0) {
  errors.sort((left, right) => left.localeCompare(right));
  console.error(`Identity check failed with ${errors.length} violation(s).`);
  for (const error of errors.slice(0, MAX_REPORTED_ERRORS)) {
    console.error(`- ${error}`);
  }
  if (errors.length > MAX_REPORTED_ERRORS) {
    console.error(`- ${errors.length - MAX_REPORTED_ERRORS} additional violation(s) omitted`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Identity check passed (${checkedFiles.source} source, ${checkedFiles.generated} generated, ${checkedFiles.archive} archive file(s) scanned).`,
  );
}
