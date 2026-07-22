import { isAbsolute, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import manifest from './gjc-runtime-manifest.json' with { type: 'json' };

type RuntimeManifestFile = {
  package: string;
  path: string;
  sha256: string;
};

type RuntimeManifestPlatform = {
  files: RuntimeManifestFile[];
};

type RuntimeManifest = {
  schemaVersion: number;
  gjcSdk: string;
  bun: string;
  natives: string;
  platforms: Record<string, RuntimeManifestPlatform>;
};

type BunRuntime = {
  version: string;
  resolveSync(specifier: string, from: string): string;
  file(path: string): { arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> };
};

type PackageMetadata = { name?: unknown; version?: unknown };

const RUNTIME_MANIFEST_FAILURE = 'GJC runtime manifest validation failed.';
const SHA256 = /^[a-f0-9]{64}$/;
const resolverFrom = fileURLToPath(new URL('.', import.meta.url));

function validFile(file: unknown): file is RuntimeManifestFile {
  return typeof file === 'object'
    && file !== null
    && typeof (file as RuntimeManifestFile).package === 'string'
    && typeof (file as RuntimeManifestFile).path === 'string'
    && (file as RuntimeManifestFile).path.startsWith('native/')
    && !(file as RuntimeManifestFile).path.includes('..')
    && SHA256.test((file as RuntimeManifestFile).sha256);
}

async function runtimeManifest(bun: BunRuntime): Promise<RuntimeManifest | null> {
  let value: unknown = manifest;
  const overrideAllowed = process.env.GJC_ALLOW_RUNTIME_MANIFEST_OVERRIDE;
  const overridePath = process.env.GJC_RUNTIME_MANIFEST_PATH;
  if (overrideAllowed === '1') {
    console.error('GJC runtime manifest override enabled.');
    if (!overridePath || !isAbsolute(overridePath)) return null;
    try {
      value = JSON.parse(await bun.file(overridePath).text());
    } catch {
      return null;
    }
  }
  return typeof value === 'object'
    && value !== null
    && (value as RuntimeManifest).schemaVersion === 1
    && typeof (value as RuntimeManifest).gjcSdk === 'string'
    && typeof (value as RuntimeManifest).bun === 'string'
    && typeof (value as RuntimeManifest).natives === 'string'
    && typeof (value as RuntimeManifest).platforms === 'object'
    && (value as RuntimeManifest).platforms !== null
    && Object.values((value as RuntimeManifest).platforms).every((platform) => Array.isArray(platform.files) && platform.files.every(validFile))
    ? value as RuntimeManifest
    : null;
}

function bunRuntime(): BunRuntime | null {
  const candidate = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;
  return candidate
    && typeof candidate.version === 'string'
    && typeof candidate.resolveSync === 'function'
    && typeof candidate.file === 'function'
    ? candidate
    : null;
}

async function packageMetadata(bun: BunRuntime, packageRoot: string): Promise<PackageMetadata | null> {
  try {
    const metadata = JSON.parse(await bun.file(join(packageRoot, 'package.json')).text()) as PackageMetadata;
    return metadata && typeof metadata === 'object' ? metadata : null;
  } catch {
    return null;
  }
}

async function packageRoot(bun: BunRuntime, specifier: string): Promise<string | null> {
  const resolved = bun.resolveSync(specifier, resolverFrom);
  let directory = dirname(resolved);
  while (directory !== dirname(directory)) {
    const metadata = await packageMetadata(bun, directory);
    if (metadata?.name === specifier) return directory;
    directory = dirname(directory);
  }
  return null;
}

async function sha256Hex(bun: BunRuntime, path: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await bun.file(path).arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Verifies the pinned Bun runtime and installed GJC packages before starting a Bun worker.
 * This module remains importable in Node; only this function requires Bun globals.
 */
export async function verifyRuntimeManifest(): Promise<void> {
  try {
    const bun = bunRuntime();
    const expected = bun ? await runtimeManifest(bun) : null;
    const platform = `${process.platform}-${process.arch}`;
    if (!expected || !bun) throw new Error();
    if (bun.version !== expected.bun) throw new Error();

    const [sdkRoot, nativesRoot] = await Promise.all([
      packageRoot(bun, '@gajae-code/coding-agent'),
      packageRoot(bun, '@gajae-code/natives'),
    ]);
    if (!sdkRoot || !nativesRoot) throw new Error();

    const [sdk, natives] = await Promise.all([
      packageMetadata(bun, sdkRoot),
      packageMetadata(bun, nativesRoot),
    ]);
    if (sdk?.version !== expected.gjcSdk || natives?.version !== expected.natives) throw new Error();

    const closure = expected.platforms[platform];
    const platformRoot = join(dirname(nativesRoot), `natives-${platform}`);
    const platformPackage = await packageMetadata(bun, platformRoot);
    if (!closure || platformPackage?.name !== `@gajae-code/natives-${platform}`
      || platformPackage.version !== expected.natives || closure.files.length === 0) {
      throw new Error();
    }

    for (const file of closure.files) {
      const root = file.package === '@gajae-code/natives'
        ? nativesRoot
        : file.package === `@gajae-code/natives-${platform}`
        ? platformRoot
        : null;
      if (!root || await sha256Hex(bun, join(root, file.path)) !== file.sha256) throw new Error();
    }
  } catch {
    throw new Error(RUNTIME_MANIFEST_FAILURE);
  }
}
