#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { promisify, parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export const REQUIRED_SIGNING_SECRETS = Object.freeze([
  'APPLE_CERTIFICATE_P12',
  'APPLE_CERTIFICATE_PASSWORD',
  'APPLE_ID',
  'APPLE_TEAM_ID',
  'APPLE_APP_PASSWORD',
]);

const execFileAsync = promisify(execFile);

async function runCommand(command, args) {
  const { stdout } = await execFileAsync(command, args, {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
    // A missing or locked credential must fail instead of prompting in CI.
    env: { ...process.env, GH_PROMPT_DISABLED: '1' },
  });
  return stdout;
}

function report(mode, scope, checks, limits = []) {
  return {
    mode, scope,
    status: checks.every(check => check.status === 'pass') ? 'ready' : 'blocked',
    checks, limits,
  };
}

const check = (name, pass, detail) => ({ name, status: pass ? 'pass' : 'fail', detail });

export function checkCiSigning(env = process.env) {
  return report('ci', 'credential-presence', REQUIRED_SIGNING_SECRETS.map(name =>
    check(name, typeof env[name] === 'string' && env[name].trim().length > 0,
      typeof env[name] === 'string' && env[name].trim().length > 0 ? 'Configured.' : 'Missing or empty.')),
  ['Presence only; certificate import, signing, notarization and artifact acceptance must still pass.']);
}

function parseSecretMetadata(stdout) {
  const entries = JSON.parse(stdout);
  if (!Array.isArray(entries) || entries.some(entry =>
    !entry || typeof entry.name !== 'string' || typeof entry.updatedAt !== 'string')) {
    throw new Error('Unexpected secret metadata.');
  }
  return new Map(entries.map(entry => [entry.name, entry.updatedAt]));
}

export async function checkGitHubSigning({ repo, environment = 'release' }, { run = runCommand } = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? '') || !environment || environment.startsWith('-')) {
    return report('github', 'secret-metadata', [check('arguments', false, 'Provide --repo OWNER/REPO and an environment name.')]);
  }
  // Repository secrets are also visible in an environment job. Environment
  // entries take precedence. Never request, echo or persist secret values.
  const results = await Promise.allSettled(['environment', 'repository'].map(async scope => {
    const args = ['secret', 'list', '--repo', repo, '--json', 'name,updatedAt'];
    if (scope === 'environment') args.push('--env', environment);
    return parseSecretMetadata(await run('gh', args));
  }));
  const checks = results.map((result, index) => check(
    `${index === 0 ? 'environment' : 'repository'}-metadata`, result.status === 'fulfilled',
    result.status === 'fulfilled' ? 'Read secret names and update times.' : 'Metadata query failed or timed out; credentials are unverified. Raw command output suppressed.',
  ));
  for (const name of REQUIRED_SIGNING_SECRETS) {
    const sourceIndex = results.findIndex(result => result.status === 'fulfilled' && result.value.has(name));
    const entry = check(name, sourceIndex !== -1, sourceIndex === -1 ? 'Not found in the queried scopes.' : 'Secret metadata exists.');
    if (sourceIndex !== -1) {
      entry.source = sourceIndex === 0 ? 'environment' : 'repository';
      entry.updatedAt = results[sourceIndex].value.get(name);
    }
    checks.push(entry);
  }
  return { ...report('github', 'secret-metadata', checks, [
    'Names do not prove that values are nonempty, valid or accessible to a workflow run.',
    'Organization-level secret grants are not queried; inspect them separately for organization-owned repositories.',
  ]), repo, environment };
}

export function parseDeveloperIdentities(stdout) {
  return [...stdout.matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"(Developer ID Application: [^"\r\n]+ \(([A-Z0-9]{10})\))"\s*$/gm)]
    .map(([, fingerprint, name, teamId]) => ({ fingerprint: fingerprint.toUpperCase(), name, teamId }));
}

export async function checkLocalSigning({ keychain, profile, identity, 'notary-keychain': notaryKeychain }, {
  platform = process.platform, arch = process.arch, exists = existsSync, run = runCommand,
} = {}) {
  const checks = [
    check('platform', platform === 'darwin' && arch === 'arm64', 'The current desktop packaging lane requires macOS arm64.'),
    check('keychain', typeof keychain === 'string' && isAbsolute(keychain) && exists(keychain), 'Provide an existing, explicit absolute --keychain path; no keychain enumeration is performed.'),
    check('profile', typeof profile === 'string' && profile.trim().length > 0 && !profile.startsWith('-'), 'Provide the known --profile name; profiles are never enumerated.'),
    check('notary-keychain', notaryKeychain === undefined || (isAbsolute(notaryKeychain) && exists(notaryKeychain)), 'Use the named profile in its default store, or an explicit existing --notary-keychain path if it was stored there.'),
    check('identity', typeof identity === 'string' && identity.trim().length > 0 && identity !== '-', 'Set APPLE_SIGNING_IDENTITY or --identity to an exact Developer ID Application name or fingerprint.'),
  ];
  const finish = () => report('local', 'identity-and-notary-authentication', checks, [
    'No private key or credential was exported, and no signing, submission, publication or keychain mutation was performed.',
    'Private-key access during codesign, matching notarization team, new artifact signatures, stapling and Gatekeeper acceptance remain unverified.',
    'Local readiness does not configure a GitHub-hosted runner. Keep APPLE_SIGNING_IDENTITY exported for every build and DMG step.',
  ]);
  if (checks.some(entry => entry.status === 'fail')) return finish();
  try {
    const identities = parseDeveloperIdentities(await run('security', ['find-identity', '-v', '-p', 'codesigning', keychain]));
    const selected = identities.filter(candidate => candidate.name === identity || candidate.fingerprint === identity.toUpperCase());
    checks.push(check('developer-id', selected.length === 1, selected.length === 1
      ? 'Exactly one valid matching Developer ID Application identity exists in the specified keychain.'
      : 'The specified Developer ID Application identity is absent, invalid or ambiguous.'));
  } catch {
    checks.push(check('developer-id', false, 'Targeted identity query failed or timed out. Raw command output suppressed.'));
  }
  try {
    const args = ['notarytool', 'history', '--keychain-profile', profile, '--output-format', 'json', '--no-progress'];
    // Signing certificates and notary profiles need not share a keychain.
    // Only query the exact named profile, including in the default store.
    if (notaryKeychain !== undefined) args.push('--keychain', notaryKeychain);
    const result = JSON.parse(await run('xcrun', args));
    if (!Array.isArray(result?.history)) throw new Error('Unexpected history response.');
    checks.push(check('notary-authentication', true, 'The named keychain profile authenticated a read-only notarization history request; submission details suppressed.'));
  } catch {
    checks.push(check('notary-authentication', false, 'The named profile could not validate a history request (missing/locked profile, credentials, network, timeout or response format). Raw command output suppressed.'));
  }
  return finish();
}

const usage = `Usage:
  node scripts/release/check-signing-readiness.mjs --mode ci
  node scripts/release/check-signing-readiness.mjs --mode github --repo OWNER/REPO [--environment release]
  node scripts/release/check-signing-readiness.mjs --mode local --keychain /absolute/keychain --profile NAME [--identity NAME_OR_SHA1] [--notary-keychain /absolute/keychain]

JSON only; exit 0 means the stated prerequisite scope passed, exit 1 means blocked,
exit 2 means invalid arguments. Commands time out after 30 seconds. No secrets are printed.
Local mode uses APPLE_SIGNING_IDENTITY when --identity is omitted. See SIGNING-READINESS.md.
`;

async function main() {
  let values;
  try {
    ({ values } = parseArgs({ options: Object.fromEntries([
      'mode', 'repo', 'environment', 'keychain', 'profile', 'identity', 'notary-keychain',
    ].map(name => [name, { type: 'string' }]).concat([['help', { type: 'boolean' }]])) }));
    if (values.help) { process.stdout.write(usage); return; }
    const allowed = {
      ci: ['mode'], github: ['mode', 'repo', 'environment'], local: ['mode', 'keychain', 'profile', 'identity', 'notary-keychain'],
    }[values.mode];
    if (!allowed || Object.keys(values).some(name => !allowed.includes(name))) throw new Error('Invalid mode.');
  } catch {
    // parseArgs errors can echo arbitrary supplied values. Emit only our usage.
    process.stderr.write(usage);
    process.exitCode = 2;
    return;
  }
  const result = values.mode === 'ci' ? checkCiSigning()
    : values.mode === 'github' ? await checkGitHubSigning(values)
      : await checkLocalSigning({ ...values, identity: values.identity ?? process.env.APPLE_SIGNING_IDENTITY });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === 'ready' ? 0 : 1;
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
