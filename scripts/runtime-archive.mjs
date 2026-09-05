import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

export async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function downloadVerifiedArchive(url, destination, expectedSha256, { fetchImpl = fetch } = {}) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('A pinned SHA-256 digest is required.');
  try {
    const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
    if (!response.ok || !response.body) throw new Error(`Runtime download failed with HTTP ${response.status}.`);
    await pipeline(response.body, createWriteStream(destination, { mode: 0o600 }));
    if (await sha256(destination) !== expectedSha256) throw new Error('Downloaded runtime archive failed SHA-256 verification.');
  } catch (error) {
    await fs.rm(destination, { force: true });
    throw error;
  }
}

/** Paths are data in environment variables, never PowerShell source or shell arguments. */
export async function extractWindowsZip(archivePath, destinationDirectory, {
  env = process.env,
  execute = promisify(execFile),
} = {}) {
  const systemRootKey = Object.keys(env).find(key => key.toLowerCase() === 'systemroot');
  const systemRoot = env[systemRootKey] || 'C:\\Windows';
  await execute(path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference = "Stop"; Expand-Archive -LiteralPath $env:GAJAE_RUNTIME_ARCHIVE -DestinationPath $env:GAJAE_RUNTIME_EXTRACT -Force',
  ], {
    shell: false,
    windowsHide: true,
    timeout: 300_000,
    env: { ...env, GAJAE_RUNTIME_ARCHIVE: archivePath, GAJAE_RUNTIME_EXTRACT: destinationDirectory },
  });
}
