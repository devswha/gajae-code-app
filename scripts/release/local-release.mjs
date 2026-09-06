#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { ARTIFACT_PREFIX, PACKAGE_NAME, SERVER_PACKAGE_NAME } from '../../shared/productIdentity.js';

import { releaseCommand } from './local-release-command.mjs';
import { verifyMacosRelease } from './local-release-macos.mjs';
import { assertOutOfTree } from './out-of-tree.mjs';

const demand = (condition, message) => { if (!condition) throw new Error(message); };
const positiveId = value => /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const sha256Pattern = /^[a-f0-9]{64}$/;

export function releaseOptions(values) {
  demand(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(values.repo ?? ''), 'Explicit --repo OWNER/REPO is required.');
  demand(/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/.test(values.tag ?? ''), 'Explicit version --tag is required.');
  demand(/^[a-f0-9]{40}$/.test(values.commit ?? ''), 'Explicit full lowercase 40-character --commit is required.');
  demand(positiveId(values['draft-id']), 'Explicit numeric --draft-id is required.');
  demand(/^[A-Z0-9]{10}$/.test(values['team-id'] ?? ''), 'Explicit 10-character --team-id is required.');
  const version = values.tag.slice(1);
  const pins = new Map();
  for (const entry of values.asset ?? []) {
    const [name, hash, extra] = entry.split('=');
    demand(!extra && /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(name)
      && name.startsWith(ARTIFACT_PREFIX) && name.includes(`-${version}-`) && !name.endsWith('.sha256')
      && sha256Pattern.test(hash ?? '') && !pins.has(name), 'Each --asset must pin a unique versioned payload basename to a lowercase SHA-256.');
    pins.set(name, hash);
  }
  const dmgName = `${ARTIFACT_PREFIX}desktop-${version}-macos-arm64.dmg`;
  const serverName = `${ARTIFACT_PREFIX}server-${version}-linux-x64-node22.tar.gz`;
  demand(pins.has(dmgName) && pins.has(serverName) && pins.size <= 16, 'Pin the canonical macOS DMG and Linux server archive (at most 16 payloads).');
  return { repo: values.repo, tag: values.tag, commit: values.commit, draftId: Number(values['draft-id']),
    teamId: values['team-id'], publish: values.publish === true, version, pins, dmgName, serverName };
}

export function validateDraft(release, options) {
  demand(release.id === options.draftId && release.draft === true && release.published_at === null, 'Expected the exact existing unpublished draft ID; published releases are never edited.');
  demand(release.tag_name === options.tag && release.target_commitish === options.commit, 'Draft tag/target must match the exact supplied tag and full commit, not a branch.');
  demand(release.prerelease === options.version.includes('-'), 'Draft prerelease status does not match the version tag.');
  const expected = [...options.pins.keys()].flatMap(name => [name, `${name}.sha256`]).sort();
  demand(Array.isArray(release.assets)
    && JSON.stringify(release.assets.map(asset => asset.name).sort()) === JSON.stringify(expected), 'Draft assets differ from the explicitly pinned payloads and their checksum files. No assets will be replaced or removed.');
  const ids = new Set();
  for (const asset of release.assets) {
    demand(positiveId(asset.id) && !ids.has(asset.id) && asset.state === 'uploaded'
      && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= 2 * 1024 ** 3, 'Draft has invalid, duplicate, incomplete or oversized assets.');
    ids.add(asset.id);
    if (asset.name.endsWith('.sha256')) demand(asset.size <= 1024, 'Checksum sidecar is too large.');
    if (asset.name === options.dmgName) demand(asset.size <= 250 * 1024 ** 2, 'DMG exceeds the release size limit.');
    demand(asset.digest == null || /^sha256:[a-f0-9]{64}$/.test(asset.digest), 'Unexpected GitHub asset digest format.');
  }
}

export function releaseSnapshot(release) {
  return JSON.stringify({ id: release.id, tag: release.tag_name, commit: release.target_commitish,
    name: release.name, body: release.body, prerelease: release.prerelease,
    assets: release.assets.map(({ id, name, label, size, state, digest, updated_at }) =>
      ({ id, name, label, size, state, digest, updated_at })).sort((a, b) => a.id - b.id) });
}

export function assertChecksum(text, name, hash) {
  const match = /^([a-f0-9]{64}) [ *]([^\r\n]+)\n?$/.exec(text);
  demand(match?.[1] === hash && match?.[2] === name, 'Checksum sidecar must contain exactly the pinned hash and payload basename.');
}

async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// Resolves lightweight and annotated tags. A draft may not have created its
// tag yet, but its target_commitish must already be the exact commit.
export async function inspectReleaseTag(options, api) {
  const pages = await api(`git/matching-refs/tags/${options.tag}`, ['--paginate', '--slurp']);
  demand(Array.isArray(pages) && pages.every(Array.isArray), 'Unexpected tag reference response.');
  const refs = pages.flat().filter(ref => ref.ref === `refs/tags/${options.tag}`);
  demand(refs.length <= 1, 'Ambiguous release tag.');
  if (refs.length === 0) return 'absent';
  const initial = refs[0].object?.sha;
  let object = refs[0].object;
  const seen = new Set();
  while (object?.type === 'tag') {
    demand(/^[a-f0-9]{40}$/.test(object.sha) && !seen.has(object.sha) && seen.size < 10, 'Invalid or cyclic annotated release tag.');
    seen.add(object.sha);
    object = (await api(`git/tags/${object.sha}`)).object;
  }
  demand(object?.type === 'commit' && object.sha === options.commit, 'Existing remote tag does not resolve to the supplied commit.');
  return initial;
}

export async function processLocalRelease(options, {
  run = releaseCommand, verifyMac = verifyMacosRelease, platform = process.platform, arch = process.arch,
} = {}) {
  demand(platform === 'darwin' && arch === 'arm64', 'Local signed release verification requires macOS arm64.');
  const endpoint = path => `repos/${options.repo}/${path}`;
  const api = async (path, args = []) => JSON.parse((await run('gh', ['api', '--hostname', 'github.com', endpoint(path), ...args])).stdout);
  const readDraft = async () => {
    const release = await api(`releases/${options.draftId}`);
    // A separately paginated listing prevents ignoring unreviewed extra assets.
    const pages = await api(`releases/${options.draftId}/assets`, ['--paginate', '--slurp']);
    demand(Array.isArray(pages) && pages.every(Array.isArray), 'Unexpected release asset response.');
    release.assets = pages.flat();
    validateDraft(release, options);
    return release;
  };
  const before = await readDraft();
  const snapshot = releaseSnapshot(before);
  const tagSnapshot = await inspectReleaseTag(options, api);
  demand((await api(`git/commits/${options.commit}`)).sha === options.commit, 'The supplied commit is not a remote Git commit.');
  const source = JSON.parse((await run('gh', ['api', '--hostname', 'github.com',
    endpoint(`contents/package.json?ref=${options.commit}`), '--header', 'Accept: application/vnd.github.raw+json'])).stdout);
  demand(source.name === PACKAGE_NAME && source.version === options.version && typeof source.desktopVersion === 'string', 'Pinned commit package/version does not match the release tag.');

  const root = await mkdtemp(join(tmpdir(), 'gajae-local-release-'));
  let preserveDirectory = false;
  let publicationRequested = false;
  try {
    await assertOutOfTree(root, 'Release verification');
    const hashes = {};
    for (const asset of before.assets) {
      const output = join(root, asset.name);
      // Asset IDs bind downloads to the inspected objects, not mutable names.
      await run('gh', ['api', '--hostname', 'github.com', endpoint(`releases/assets/${asset.id}`),
        '--header', 'Accept: application/octet-stream'], { output, timeout: 600_000 });
      demand((await stat(output)).size === asset.size, 'Downloaded asset size differs from draft metadata.');
      const hash = await fileHash(output);
      if (asset.digest) demand(asset.digest === `sha256:${hash}`, 'Downloaded asset differs from its GitHub digest.');
      if (options.pins.has(asset.name)) demand(options.pins.get(asset.name) === hash, 'Downloaded payload differs from the independently supplied SHA-256.');
      hashes[asset.name] = hash;
    }
    for (const [name, hash] of options.pins) assertChecksum(await readFile(join(root, `${name}.sha256`), 'utf8'), name, hash);

    const archive = join(root, options.serverName);
    const members = (await run('tar', ['-tzf', archive])).stdout.split('\n').filter(name => name === 'package.json' || name === './package.json');
    demand(members.length === 1, 'Server archive must have exactly one root package.json.');
    const server = JSON.parse((await run('tar', ['-xOzf', archive, '--', members[0]])).stdout);
    demand(server.name === SERVER_PACKAGE_NAME && server.version === options.version, 'Server archive package/version does not match the release tag.');
    await verifyMac({ dmg: join(root, options.dmgName), root, teamId: options.teamId,
      version: options.version, desktopVersion: source.desktopVersion }, { run });

    // Downloads/signature checks take time. Re-read every mutable release
    // input and the tag immediately before the sole optional write.
    demand(releaseSnapshot(await readDraft()) === snapshot, 'Draft metadata or assets changed during verification; publication refused.');
    demand(await inspectReleaseTag(options, api) === tagSnapshot, 'Tag changed during verification; publication refused.');
    if (options.publish) {
      let published;
      try {
        publicationRequested = true;
        published = await api(`releases/${options.draftId}`, ['--method', 'PATCH', '--field', 'draft=false']);
      } catch {
        throw new Error('Publication request failed; its outcome may be unknown. Inspect the exact release ID before any retry. No automatic retry or rollback is performed.');
      }
      demand(published.id === options.draftId && published.draft === false
        && published.tag_name === options.tag && published.target_commitish === options.commit
        && releaseSnapshot(published) === snapshot,
      'Publication response is unexpected; inspect the exact release ID and assets. No automatic rollback is performed.');
    }
    return { status: options.publish ? 'published' : 'verified-draft', repo: options.repo, draftId: options.draftId,
      tag: options.tag, commit: options.commit, teamId: options.teamId, hashes,
      limits: ['Independent hashes bind the operator-selected builds to this release; this is not a reproducible-build attestation.',
        'Runtime/GUI/Linux acceptance remains a separate prerequisite. Additional payloads receive hash validation only.',
        'Keep a single publisher: the final recheck and publication request are separate operations, not an atomic guarantee.'] };
  } catch (error) {
    preserveDirectory = error.preserveDirectory === true;
    if (publicationRequested) error.publicationMayHaveOccurred = true;
    throw error;
  } finally {
    if (!preserveDirectory) await rm(root, { recursive: true, force: true }).catch(() => {
      throw Object.assign(new Error(`Temporary cleanup failed; inspect ${root} and the release ID.`), { publicationMayHaveOccurred: publicationRequested });
    });
  }
}

const usage = `Usage: node scripts/release/local-release.mjs --repo OWNER/REPO --draft-id ID
  --tag vVERSION --commit FULL_SHA --team-id TEAMID1234
  --asset PAYLOAD_BASENAME=SHA256 --asset OTHER_PAYLOAD_BASENAME=SHA256 [--publish]

Default: verify an existing draft without changing it. --publish explicitly
repeats all checks then publishes that exact draft ID. Never uploads, overwrites,
deletes or creates release assets. Pin every payload; checksum sidecars are required.
See LOCAL-RELEASE.md. No credential export or hosted signing secrets are used.
`;

async function main() {
  let options;
  try {
    const { values } = parseArgs({ options: {
      ...Object.fromEntries(['repo', 'draft-id', 'tag', 'commit', 'team-id'].map(name => [name, { type: 'string' }])),
      asset: { type: 'string', multiple: true }, publish: { type: 'boolean' }, help: { type: 'boolean' },
    } });
    if (values.help) { process.stdout.write(usage); return; }
    options = releaseOptions(values);
  } catch {
    process.stderr.write(usage);
    process.exitCode = 2;
    return;
  }
  try {
    process.stdout.write(`${JSON.stringify(await processLocalRelease(options), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: error.publicationMayHaveOccurred ? 'publication-outcome-unknown' : 'blocked', error: error.message })}\n`);
    process.exitCode = 1;
  }
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isDirectInvocation()) await main();
