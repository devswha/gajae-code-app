#!/usr/bin/env node
/**
 * Check or prepare the version fields that identify a release.
 *
 * A release has two independent SemVer values:
 * - package.json.version identifies the product/release tag.
 * - package.json.desktopVersion identifies native install ordering.
 *
 * The package and Cargo lockfiles are kept in sync by changing only their
 * root package records.  The default command is read-only; --write is the
 * explicit mutation mode.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import semver from 'semver';

import { PACKAGE_NAME } from '../../shared/productIdentity.js';

import {
  DESKTOP_VERSION_BASELINE,
  strictVersion,
} from './updater-artifacts.mjs';

const DESKTOP_PACKAGE_NAME = `${PACKAGE_NAME}-desktop`;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const VERSION_FILE_NAMES = Object.freeze([
  'package.json',
  'package-lock.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
]);

function demand(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseJson(text, filename) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${filename} must contain valid JSON.`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function versionValue(value, label) {
  return strictVersion(value, label);
}

function productVersionValue(value, label) {
  const version = versionValue(value, label);
  const prerelease = semver.prerelease(version);
  demand(prerelease === null || prerelease[0] === 'beta',
    `${label} must use the beta or stable release channel.`);
  return version;
}

function clone(value) {
  return structuredClone(value);
}

function filePath(rootDir, relative) {
  return path.join(rootDir, relative);
}

function sameFileMetadata(left, right) {
  return left.isFile() && right.isFile()
    && left.dev === right.dev && left.ino === right.ino
    && left.size === right.size && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function sameBytes(left, right) {
  const leftBytes = Buffer.isBuffer(left) ? left : Buffer.from(left, 'utf8');
  const rightBytes = Buffer.isBuffer(right) ? right : Buffer.from(right, 'utf8');
  return Buffer.compare(leftBytes, rightBytes) === 0;
}

async function readRegularFile(filename, label = 'Version source file') {
  let before;
  try {
    before = await fs.lstat(filename);
  } catch {
    throw new Error(`${label} is missing: ${filename}`);
  }
  demand(before.isFile(), `${label} must be a regular file: ${filename}`);
  demand(before.size <= MAX_SOURCE_BYTES, `${label} is oversized: ${filename}`);
  const bytes = await fs.readFile(filename);
  const after = await fs.lstat(filename);
  demand(sameFileMetadata(before, after) && bytes.length === after.size,
    `${label} changed during read: ${filename}`);
  return { text: bytes.toString('utf8'), bytes, metadata: before };
}

function replaceUniqueLine(source, pattern, replacement, label) {
  const matches = [...source.matchAll(pattern)];
  demand(matches.length === 1, `${label} must contain exactly one version field.`);
  const match = matches[0];
  const replacementText = typeof replacement === 'function' ? replacement(match) : replacement;
  return source.slice(0, match.index) + replacementText + source.slice(match.index + match[0].length);
}

function replaceJsonTopLevelVersion(source, property, expected, replacement, label) {
  const escapedProperty = escapeRegExp(property);
  const escapedExpected = escapeRegExp(expected);
  const pattern = new RegExp(
    `^ {2}"${escapedProperty}"[ \\t]*:[ \\t]*"${escapedExpected}"([ \\t]*,?[ \\t]*)$`,
    'gm',
  );
  return replaceUniqueLine(
    source,
    pattern,
    match => `  "${property}": "${replacement}"${match[1]}`,
    `${label} ${property}`,
  );
}

function replacePackageLockRootVersion(source, expected, replacement) {
  const packages = /^([ \\t]*)"packages"[ \\t]*:[ \\t]*\{[ \\t]*$/m.exec(source);
  demand(packages !== null, 'package-lock.json is missing its packages object.');
  const entryPattern = new RegExp(
    `^(${escapeRegExp(packages[1])}  )""[ \\t]*:[ \\t]*\\{[ \\t]*$`,
    'gm',
  );
  const entries = [...source.matchAll(entryPattern)].filter(match => match.index > packages.index);
  demand(entries.length === 1, 'package-lock.json must contain exactly one root package entry.');
  const entry = entries[0];
  const propertyIndent = `${entry[1]}  `;
  const rootVersionPattern = new RegExp(
    `^${escapeRegExp(propertyIndent)}"version"[ \\t]*:[ \\t]*"${escapeRegExp(expected)}"([ \\t]*,?[ \\t]*)$`,
    'gm',
  );
  const entryStart = entry.index + entry[0].length;
  const rootVersionMatch = rootVersionPattern.exec(source.slice(entryStart));
  demand(rootVersionMatch !== null, 'package-lock.json root package must contain exactly one version field.');
  const absoluteStart = entryStart + rootVersionMatch.index;
  return source.slice(0, absoluteStart)
    + `${propertyIndent}"version": "${replacement}"${rootVersionMatch[1]}`
    + source.slice(absoluteStart + rootVersionMatch[0].length);
}

function sectionRanges(source, headerPattern) {
  const headers = [...source.matchAll(headerPattern)];
  return headers.map((header, index) => ({
    start: header.index + header[0].length,
    end: headers[index + 1]?.index ?? source.length,
  }));
}

function fieldMatches(section, field) {
  const pattern = new RegExp(`^[ \\t]*${escapeRegExp(field)}[ \\t]*=[ \\t]*"([^"]+)"[ \\t]*(?:#.*)?$`, 'gm');
  return [...section.matchAll(pattern)];
}

function cargoRootSection(source) {
  const ranges = sectionRanges(source, /^\[package\][ \\t]*$/gm);
  demand(ranges.length === 1, 'Cargo.toml must contain exactly one [package] section.');
  const range = ranges[0];
  const section = source.slice(range.start, range.end);
  const names = fieldMatches(section, 'name');
  const versions = fieldMatches(section, 'version');
  demand(names.length === 1 && names[0][1] === DESKTOP_PACKAGE_NAME,
    `Cargo.toml [package] name must be ${DESKTOP_PACKAGE_NAME}.`);
  demand(versions.length === 1, 'Cargo.toml [package] must contain exactly one version field.');
  return { ...range, section, version: versions[0][1], versionMatch: versions[0] };
}

function cargoLockRootSection(source) {
  const ranges = sectionRanges(source, /^\[\[package\]\][ \\t]*$/gm);
  const matches = [];
  for (const range of ranges) {
    const section = source.slice(range.start, range.end);
    const names = fieldMatches(section, 'name');
    if (names.length === 1 && names[0][1] === DESKTOP_PACKAGE_NAME) {
      const versions = fieldMatches(section, 'version');
      demand(versions.length === 1, 'Cargo.lock root package must contain exactly one version field.');
      matches.push({ ...range, section, version: versions[0][1], versionMatch: versions[0] });
    }
  }
  demand(matches.length === 1, 'Cargo.lock must contain exactly one root package record.');
  return matches[0];
}

function replaceCargoSectionVersion(source, sectionInfo, replacement, label) {
  const expected = sectionInfo.version;
  const linePattern = new RegExp(`^([ \\t]*${escapeRegExp('version')}[ \\t]*=[ \\t]*")${escapeRegExp(expected)}("[ \\t]*(?:#.*)?$)`, 'gm');
  const localMatches = [...sectionInfo.section.matchAll(linePattern)];
  demand(localMatches.length === 1, `${label} must contain exactly one version field.`);
  const local = localMatches[0];
  const absoluteStart = sectionInfo.start + local.index;
  return source.slice(0, absoluteStart) + `${local[1]}${replacement}${local[2]}`
    + source.slice(absoluteStart + local[0].length);
}

function validatePackageStructure(packageJson, packageLock) {
  demand(isRecord(packageJson) && packageJson.name === PACKAGE_NAME,
    `package.json name must be ${PACKAGE_NAME}.`);
  demand(isRecord(packageLock) && packageLock.name === PACKAGE_NAME,
    `package-lock.json name must be ${PACKAGE_NAME}.`);
  demand(isRecord(packageLock.packages) && isRecord(packageLock.packages['']),
    'package-lock.json is missing its root package record.');
  demand(packageLock.packages[''].name === PACKAGE_NAME,
    `package-lock.json root package name must be ${PACKAGE_NAME}.`);
}

function validateSynchronizedVersions(values) {
  const productVersions = [
    values.packageVersion,
    values.lockVersion,
    values.lockRootVersion,
  ];
  const desktopVersions = [values.desktopVersion, values.cargoVersion, values.cargoLockVersion];
  demand(productVersions.every(version => version === values.packageVersion),
    'Product version fields are out of sync; no files were changed.');
  demand(desktopVersions.every(version => version === values.desktopVersion),
    'Desktop version fields are out of sync; no files were changed.');
}

function parseVersionSources(rootDir, sources) {
  const packageJson = parseJson(sources.packageJson.text, 'package.json');
  const packageLock = parseJson(sources.packageLock.text, 'package-lock.json');
  validatePackageStructure(packageJson, packageLock);

  const cargo = cargoRootSection(sources.cargoToml.text);
  const cargoLock = cargoLockRootSection(sources.cargoLock.text);
  const packageVersion = productVersionValue(packageJson.version, 'package.json version');
  const desktopVersion = versionValue(packageJson.desktopVersion, 'package.json desktopVersion');
  const lockVersion = productVersionValue(packageLock.version, 'package-lock.json version');
  const lockRootVersion = productVersionValue(packageLock.packages[''].version,
    'package-lock.json root package version');
  const cargoVersion = versionValue(cargo.version, 'Cargo.toml package version');
  const cargoLockVersion = versionValue(cargoLock.version, 'Cargo.lock root package version');
  validateSynchronizedVersions({
    packageVersion,
    desktopVersion,
    lockVersion,
    lockRootVersion,
    cargoVersion,
    cargoLockVersion,
  });
  demand(semver.gte(desktopVersion, DESKTOP_VERSION_BASELINE),
    `Current desktopVersion must be at least the updater baseline ${DESKTOP_VERSION_BASELINE}.`);

  return {
    rootDir,
    productVersion: packageVersion,
    desktopVersion,
    files: sources,
    cargo,
    cargoLock,
  };
}

async function readSources(rootDir) {
  const [packageJson, packageLock, cargoToml, cargoLock] = await Promise.all(
    VERSION_FILE_NAMES.map(relative => readRegularFile(filePath(rootDir, relative))),
  );
  return { packageJson, packageLock, cargoToml, cargoLock };
}

function candidateVersions(current, candidate = {}) {
  const productVersion = candidate.productVersion;
  const desktopVersion = candidate.desktopVersion;
  demand(typeof productVersion === 'string' && typeof desktopVersion === 'string',
    'Both --product-version and --desktop-version are required for a candidate.');
  const validatedProduct = productVersionValue(productVersion, 'Candidate product version');
  const validatedDesktop = versionValue(desktopVersion, 'Candidate desktopVersion');
  demand(semver.gt(validatedProduct, current.productVersion),
    `Candidate product version ${validatedProduct} must be greater than current ${current.productVersion}.`);
  demand(semver.gt(validatedDesktop, current.desktopVersion),
    `Candidate desktopVersion ${validatedDesktop} must be greater than current ${current.desktopVersion}.`);
  demand(semver.gt(validatedDesktop, DESKTOP_VERSION_BASELINE),
    `Candidate desktopVersion ${validatedDesktop} must be greater than the updater baseline ${DESKTOP_VERSION_BASELINE}.`);
  return { productVersion: validatedProduct, desktopVersion: validatedDesktop };
}

function buildUpdatedSources(state, candidate) {
  const packageJsonBefore = parseJson(state.files.packageJson.text, 'package.json');
  const packageLockBefore = parseJson(state.files.packageLock.text, 'package-lock.json');
  const packageJsonAfter = clone(packageJsonBefore);
  packageJsonAfter.version = candidate.productVersion;
  packageJsonAfter.desktopVersion = candidate.desktopVersion;
  const packageLockAfter = clone(packageLockBefore);
  packageLockAfter.version = candidate.productVersion;
  packageLockAfter.packages[''].version = candidate.productVersion;

  const packageJsonText = replaceJsonTopLevelVersion(
    replaceJsonTopLevelVersion(state.files.packageJson.text, 'version', state.productVersion,
      candidate.productVersion, 'package.json'),
    'desktopVersion', state.desktopVersion, candidate.desktopVersion, 'package.json',
  );
  const packageLockText = replacePackageLockRootVersion(
    replaceJsonTopLevelVersion(state.files.packageLock.text, 'version', state.productVersion,
      candidate.productVersion, 'package-lock.json'),
    state.productVersion,
    candidate.productVersion,
  );
  const cargoTomlText = replaceCargoSectionVersion(
    state.files.cargoToml.text, state.cargo, candidate.desktopVersion, 'Cargo.toml [package]',
  );
  const cargoLockText = replaceCargoSectionVersion(
    state.files.cargoLock.text, state.cargoLock, candidate.desktopVersion, 'Cargo.lock root package',
  );

  // Textual replacements above preserve every byte outside the version
  // fields. These semantic checks also protect against an accidental change
  // to dependencies or package metadata if a source layout changes later.
  const packageJsonCheck = parseJson(packageJsonText, 'updated package.json');
  const packageLockCheck = parseJson(packageLockText, 'updated package-lock.json');
  demand(JSON.stringify(packageJsonCheck) === JSON.stringify(packageJsonAfter),
    'package.json update changed fields other than its version values.');
  demand(JSON.stringify(packageLockCheck) === JSON.stringify(packageLockAfter),
    'package-lock.json update changed fields other than its root version values.');
  demand(replaceCargoSectionVersion(cargoTomlText, cargoRootSection(cargoTomlText), state.cargo.version,
    'Cargo.toml rollback check') === state.files.cargoToml.text,
  'Cargo.toml update changed bytes other than its package version.');
  demand(replaceCargoSectionVersion(cargoLockText, cargoLockRootSection(cargoLockText), state.cargoLock.version,
    'Cargo.lock rollback check') === state.files.cargoLock.text,
  'Cargo.lock update changed bytes other than its root package version.');

  return [
    { relative: 'package.json', filename: filePath(state.rootDir, 'package.json'), source: state.files.packageJson, text: packageJsonText, bytes: Buffer.from(packageJsonText) },
    { relative: 'package-lock.json', filename: filePath(state.rootDir, 'package-lock.json'), source: state.files.packageLock, text: packageLockText, bytes: Buffer.from(packageLockText) },
    { relative: 'src-tauri/Cargo.toml', filename: filePath(state.rootDir, 'src-tauri/Cargo.toml'), source: state.files.cargoToml, text: cargoTomlText, bytes: Buffer.from(cargoTomlText) },
    { relative: 'src-tauri/Cargo.lock', filename: filePath(state.rootDir, 'src-tauri/Cargo.lock'), source: state.files.cargoLock, text: cargoLockText, bytes: Buffer.from(cargoLockText) },
  ];
}

async function readVersionStateInternal(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')) {
  const rootDir = path.resolve(root);
  return parseVersionSources(rootDir, await readSources(rootDir));
}

export async function readVersionState(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')) {
  const state = await readVersionStateInternal(root);
  return {
    rootDir: state.rootDir,
    productVersion: state.productVersion,
    desktopVersion: state.desktopVersion,
  };
}

export async function planVersionUpdate(root, candidate) {
  const state = await readVersionStateInternal(root);
  if (candidate === undefined) {
    return {
      mode: 'check',
      current: { productVersion: state.productVersion, desktopVersion: state.desktopVersion },
      candidate: null,
      changed: false,
      files: [],
    };
  }
  const validated = candidateVersions(state, candidate);
  return {
    mode: 'check',
    current: { productVersion: state.productVersion, desktopVersion: state.desktopVersion },
    candidate: validated,
    changed: true,
    files: buildUpdatedSources(state, validated),
  };
}

async function writeTemporary(filename, text, mode) {
  const temporary = `${filename}.gajae-version-${randomUUID()}`;
  try {
    const handle = await fs.open(temporary, 'wx', mode & 0o7777);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.chmod(mode & 0o7777);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return temporary;
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

async function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function replaceFilesAtomically(files, { beforeRename } = {}) {
  demand(beforeRename === undefined || typeof beforeRename === 'function',
    'Version replacement hook must be a function.');
  const temporaryFiles = [];
  const replaced = [];
  try {
    for (const file of files) {
      const current = await readRegularFile(file.filename, 'Version target');
      demand(sameFileMetadata(current.metadata, file.source.metadata)
        && sameBytes(current.bytes, file.source.bytes),
      `Version target changed before write: ${file.filename}`);
      temporaryFiles.push({
        ...file,
        temporary: await writeTemporary(file.filename, file.text, current.metadata.mode),
      });
    }
    for (const file of temporaryFiles) {
      const current = await readRegularFile(file.filename, 'Version target');
      demand(sameFileMetadata(current.metadata, file.source.metadata)
        && sameBytes(current.bytes, file.source.bytes),
      `Version target changed during preparation: ${file.filename}`);
      if (beforeRename) await beforeRename(file, replaced.length);
      const latest = await readRegularFile(file.filename, 'Version target');
      demand(sameFileMetadata(latest.metadata, file.source.metadata)
        && sameBytes(latest.bytes, file.source.bytes),
      `Version target changed before replacement: ${file.filename}`);
      await fs.rename(file.temporary, file.filename);
      replaced.push(file);
      file.temporary = null;
      file.candidateMetadata = await fs.lstat(file.filename).catch(() => undefined);
    }
    await Promise.all([...new Set(temporaryFiles.map(file => path.dirname(file.filename)))].map(syncDirectory));
  } catch (error) {
    const rollbackErrors = [];
    for (const file of replaced.reverse()) {
      try {
        const current = await readRegularFile(file.filename, 'Rollback target');
        demand(sameBytes(current.bytes, file.bytes)
          && (file.candidateMetadata === undefined
            || sameFileMetadata(current.metadata, file.candidateMetadata)),
          `Rollback target changed during update: ${file.filename}`);
        const restore = await writeTemporary(file.filename, file.source.text, file.source.metadata.mode);
        await fs.rename(restore, file.filename);
        await syncDirectory(path.dirname(file.filename));
      } catch (rollbackError) {
        rollbackErrors.push(`${file.filename}: ${rollbackError.message}`);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`Version update failed and rollback was incomplete: ${rollbackErrors.join('; ')}`, { cause: error });
    }
    throw new Error(`Version update failed; no files were changed: ${error.message}`, { cause: error });
  } finally {
    for (const file of temporaryFiles) {
      if (file.temporary) await fs.unlink(file.temporary).catch(() => {});
    }
  }
}

export async function writeVersionUpdate(root, candidate, options = {}) {
  const state = await readVersionStateInternal(root);
  const validated = candidateVersions(state, candidate);
  const files = buildUpdatedSources(state, validated);
  await replaceFilesAtomically(files, options);
  const result = await readVersionStateInternal(root);
  demand(result.productVersion === validated.productVersion && result.desktopVersion === validated.desktopVersion,
    'Version update completed without synchronized version fields.');
  return {
    mode: 'write',
    current: { productVersion: state.productVersion, desktopVersion: state.desktopVersion },
    candidate: validated,
    changed: true,
    files: files.map(file => file.relative),
  };
}

function usage() {
  return `Usage: node scripts/release/prepare-version.mjs [options]

Check the current release version fields (default, read-only):
  --root PATH
  --product-version VERSION --desktop-version VERSION   validate a candidate without writing
  --version VERSION --desktop-version VERSION           alias for --product-version
  --check                                                 explicit read-only mode
  --dry-run                                               explicit read-only candidate mode

Prepare all synchronized version fields:
  --write --product-version VERSION --desktop-version VERSION

--write is the only mode that changes files. The complete published history
check remains part of the release publication verifier.`;
}

function parseCliArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        root: { type: 'string' },
        'product-version': { type: 'string' },
        version: { type: 'string' },
        'desktop-version': { type: 'string' },
        write: { type: 'boolean' },
        check: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        help: { type: 'boolean' },
      },
      allowPositionals: false,
    });
  } catch (error) {
    throw new Error(`${error.message}\n\n${usage()}`);
  }
  const values = parsed.values;
  if (values.help) return { help: true };
  demand(!(values.write && (values.check || values['dry-run'])),
    '--write cannot be combined with --check or --dry-run.');
  demand(!(values['product-version'] !== undefined && values.version !== undefined),
    '--product-version and --version cannot be combined.');
  const productInput = values['product-version'] ?? values.version;
  const hasProduct = productInput !== undefined;
  const hasDesktop = values['desktop-version'] !== undefined;
  demand(hasProduct === hasDesktop,
    'Candidate mode requires both --product-version and --desktop-version.');
  const candidate = hasProduct
    ? { productVersion: productInput, desktopVersion: values['desktop-version'] }
    : undefined;
  return {
    root: values.root,
    candidate,
    write: values.write === true,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  const root = path.resolve(options.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
  const result = options.write
    ? await writeVersionUpdate(root, options.candidate)
    : await planVersionUpdate(root, options.candidate);
  console.log(JSON.stringify({
    ...result,
    root,
    files: result.files.map(file => typeof file === 'string' ? file : file.relative),
  }, null, 2));
}

export { candidateVersions, parseCliArgs, usage };

const entry = process.argv[1] ? await fs.realpath(path.resolve(process.argv[1])).catch(() => null) : null;
const modulePath = await fs.realpath(fileURLToPath(import.meta.url));
if (entry === modulePath) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
