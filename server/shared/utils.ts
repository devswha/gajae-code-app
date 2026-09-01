import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { access, lstat, mkdir, readFile, readdir, readlink, realpath, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type {
  AnyRecord,
  ApiSuccessShape,
  AppErrorOptions,
  LLMProvider,
  NormalizedMessage,
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
  WorkspacePathValidationResult,
} from '@/shared/types.js';

type GjcRuntimeModelCatalogLoader = () => Promise<unknown>;
type NormalizedMessageInput = { kind: NormalizedMessage['kind']; provider: NormalizedMessage['provider']; id?: string | null; sessionId?: string | null; timestamp?: string | null } & Record<string, unknown>;
type ProviderSessionActiveModelChangeCacheEntry = ProviderSessionActiveModelChange & { updatedAt: string };
type ProviderSessionActiveModelChangeCacheFile = { version: number; entries: Record<string, ProviderSessionActiveModelChangeCacheEntry> };

let catalogReader: GjcRuntimeModelCatalogLoader | undefined;
const CACHE_FORMAT = 1;

export function registerGjcRuntimeModelCatalogLoader(loader: GjcRuntimeModelCatalogLoader): void {
  catalogReader = loader;
}

export function loadGjcRuntimeModelCatalog(): Promise<unknown> {
  return catalogReader
    ? catalogReader()
    : Promise.reject(new Error('GJC runtime model catalog is unavailable.'));
}

export function createApiSuccessResponse<TData>(data: TData): ApiSuccessShape<TData> {
  return { success: true, data };
}

export function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = options.code ?? 'INTERNAL_ERROR';
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details;
  }
}

export const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT || os.homedir();
export const FORBIDDEN_WORKSPACE_PATHS = [
  '/', '/etc', '/bin', '/sbin', '/usr', '/dev', '/proc', '/sys', '/var', '/boot', '/root', '/lib', '/lib64', '/opt', '/tmp', '/run',
  'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData', 'C:\\System Volume Information', 'C:\\$Recycle.Bin',
];

function pathDialect(value: string): typeof path.posix {
  return process.platform === 'win32' || value.startsWith('\\\\') || /^[a-zA-Z]:([\\/]|$)/.test(value)
    ? path.win32
    : path.posix;
}

function removeExtendedPathPrefix(value: string): string {
  if (value.startsWith('\\\\?\\UNC\\')) return `\\\\${value.slice('\\\\?\\UNC\\'.length)}`;
  return value.startsWith('\\\\?\\') ? value.slice('\\\\?\\'.length) : value;
}

export function normalizeProjectPath(inputPath: string): string {
  if (typeof inputPath !== 'string') return '';
  const source = inputPath.trim();
  if (!source) return '';
  const unprefixed = removeExtendedPathPrefix(source);
  const implementation = pathDialect(unprefixed);
  const result = implementation.normalize(unprefixed);
  if (!result) return '';
  return result === implementation.parse(result).root ? result : result.replace(/[\\/]+$/, '');
}

function outsideRoot(candidate: string, root: string): boolean {
  return candidate !== root && !candidate.startsWith(`${root}${path.sep}`);
}

function protectedWorkspacePath(candidate: string): string | undefined {
  if (FORBIDDEN_WORKSPACE_PATHS.includes(candidate) || candidate === '/') {
    return 'Cannot use system-critical directories as workspace locations';
  }
  for (const protectedPath of FORBIDDEN_WORKSPACE_PATHS) {
    const canonicalProtectedPath = normalizeProjectPath(protectedPath);
    if (candidate !== canonicalProtectedPath && !candidate.startsWith(`${canonicalProtectedPath}${path.sep}`)) continue;
    if (canonicalProtectedPath === '/var' && (candidate.startsWith('/var/tmp') || candidate.startsWith('/var/folders'))) continue;
    return `Cannot create workspace in system directory: ${protectedPath}`;
  }
  return undefined;
}

async function resolveCandidatePath(absolutePath: string): Promise<string> {
  let output = normalizeProjectPath(absolutePath);
  try {
    await access(absolutePath);
    return normalizeProjectPath(await realpath(absolutePath));
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code !== 'ENOENT') throw failure;
    const parent = path.dirname(absolutePath);
    try {
      const actualParent = await realpath(parent);
      output = normalizeProjectPath(path.join(actualParent, path.basename(absolutePath)));
    } catch (parentError) {
      const parentFailure = parentError as NodeJS.ErrnoException;
      if (parentFailure.code !== 'ENOENT') throw parentFailure;
    }
    return output;
  }
}

async function symlinkLeavesWorkspace(absolutePath: string, workspaceRoot: string): Promise<boolean> {
  try {
    await access(absolutePath);
    if (!(await lstat(absolutePath)).isSymbolicLink()) return false;
    const target = await readlink(absolutePath);
    return outsideRoot(await realpath(path.resolve(path.dirname(absolutePath), target)), workspaceRoot);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code !== 'ENOENT') throw failure;
    return false;
  }
}

export async function validateWorkspacePath(requestedPath: string): Promise<WorkspacePathValidationResult> {
  try {
    const requested = normalizeProjectPath(requestedPath);
    if (!requested) return { valid: false, error: 'Workspace path is required' };
    const absolute = path.resolve(requested);
    const canonical = normalizeProjectPath(absolute);
    const protectedError = protectedWorkspacePath(canonical);
    if (protectedError) return { valid: false, error: protectedError };
    const resolvedPath = await resolveCandidatePath(absolute);
    const root = normalizeProjectPath(await realpath(WORKSPACES_ROOT));
    if (outsideRoot(resolvedPath, root)) {
      return { valid: false, error: `Workspace path must be within the allowed workspace root: ${WORKSPACES_ROOT}` };
    }
    if (await symlinkLeavesWorkspace(absolute, root)) {
      return { valid: false, error: 'Symlink target is outside the allowed workspace root' };
    }
    return { valid: true, resolvedPath };
  } catch (error) {
    return { valid: false, error: `Path validation failed: ${(error as Error).message}` };
  }
}

export function generateMessageId(prefix = 'msg'): string {
  return `${prefix}_${randomUUID()}`;
}

export function createNormalizedMessage(fields: NormalizedMessageInput): NormalizedMessage {
  const identifier = fields.id || generateMessageId(fields.kind);
  const session = fields.sessionId || '';
  const occurredAt = fields.timestamp || new Date().toISOString();
  return { ...fields, id: identifier, sessionId: session, timestamp: occurredAt, provider: fields.provider };
}

export function createCompleteMessage(opts: { provider: NormalizedMessage['provider']; sessionId?: string | null; actualSessionId?: string | null; exitCode?: number | null; aborted?: boolean }): NormalizedMessage {
  const result = typeof opts.exitCode === 'number' ? opts.exitCode : 1;
  const cancelled = Boolean(opts.aborted);
  return createNormalizedMessage({
    kind: 'complete', provider: opts.provider, sessionId: opts.sessionId || null,
    actualSessionId: opts.actualSessionId || opts.sessionId || null, exitCode: result,
    success: result === 0 && !cancelled, aborted: cancelled,
  });
}

export function sliceTailPage<T>(items: T[], limit: number | null, offset: number): { page: T[]; hasMore: boolean } {
  const endingAt = Math.max(0, items.length - Math.max(0, offset));
  if (limit === null) return { page: items.slice(0, endingAt), hasMore: false };
  const beginningAt = Math.max(0, endingAt - Math.max(0, limit));
  return { page: items.slice(beginningAt, endingAt), hasMore: beginningAt > 0 };
}

export const readObjectRecord = (value: any): AnyRecord | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null
);

export const readOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result.length ? result : undefined;
};

export const readStringArray = (value: unknown): string[] | undefined => (
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined
);

export const readStringRecord = (value: unknown): Record<string, string> | undefined => {
  const source = readObjectRecord(value);
  if (!source) return undefined;
  const strings = Object.fromEntries(Object.entries(source).filter(([, entry]) => typeof entry === 'string')) as Record<string, string>;
  return Object.keys(strings).length ? strings : undefined;
};

export function buildDefaultProviderCurrentActiveModel(models: ProviderModelsDefinition): ProviderCurrentActiveModel {
  return { model: models.DEFAULT };
}

export function getProviderSessionActiveModelChangesPath(): string {
  return path.join(os.homedir(), '.gajae-app', 'provider-session-active-model-changes.json');
}

export function getGjcLiveSessionRoot(): string {
  return process.env.GJC_LIVE_SESSION_DIR || path.join(os.homedir(), '.gajae-app', 'gjc-live-sessions');
}

const sessionModelKey = (provider: LLMProvider, sessionId: string): string => `${provider}:${sessionId}`;

function blankCache(): ProviderSessionActiveModelChangeCacheFile {
  return { version: CACHE_FORMAT, entries: {} };
}

function isStoredModelChange(value: unknown): value is ProviderSessionActiveModelChangeCacheEntry {
  const entry = readObjectRecord(value);
  return Boolean(entry && typeof entry.provider === 'string' && typeof entry.sessionId === 'string' && typeof entry.supported === 'boolean' && typeof entry.changed === 'boolean' && (typeof entry.model === 'string' || entry.model === null) && typeof entry.updatedAt === 'string');
}

async function loadModelChangeCache(filePath: string): Promise<ProviderSessionActiveModelChangeCacheFile> {
  try {
    const document = readObjectRecord(JSON.parse(await readFile(filePath, 'utf8')));
    if (!document || document.version !== CACHE_FORMAT || !readObjectRecord(document.entries)) return blankCache();
    return {
      version: CACHE_FORMAT,
      entries: Object.fromEntries(Object.entries(document.entries).filter((pair): pair is [string, ProviderSessionActiveModelChangeCacheEntry] => isStoredModelChange(pair[1]))),
    };
  } catch {
    return blankCache();
  }
}

async function saveModelChangeCache(filePath: string, document: ProviderSessionActiveModelChangeCacheFile): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function unsupportedModelChange(provider: LLMProvider, sessionId: string): ProviderSessionActiveModelChange {
  return { provider, sessionId, supported: false, changed: false, model: null };
}

export async function readProviderSessionActiveModelChange(provider: LLMProvider, sessionId: string, options: { filePath?: string; supported?: boolean } = {}): Promise<ProviderSessionActiveModelChange> {
  const session = sessionId.trim();
  if (!session || !(options.supported ?? true)) return unsupportedModelChange(provider, session);
  const stored = (await loadModelChangeCache(options.filePath ?? getProviderSessionActiveModelChangesPath())).entries[sessionModelKey(provider, session)];
  if (!stored || !stored.changed || !stored.model?.trim()) return { provider, sessionId: session, supported: true, changed: false, model: null };
  return { provider, sessionId: session, supported: true, changed: true, model: stored.model.trim() };
}

export async function writeProviderSessionActiveModelChange(provider: LLMProvider, input: ProviderChangeActiveModelInput, options: { filePath?: string; supported?: boolean } = {}): Promise<ProviderSessionActiveModelChange> {
  const session = input.sessionId.trim();
  const model = input.model.trim();
  if (!(options.supported ?? true)) return unsupportedModelChange(provider, session);
  if (!session || !model) return { provider, sessionId: session, supported: true, changed: false, model: null };
  const filePath = options.filePath ?? getProviderSessionActiveModelChangesPath();
  const document = await loadModelChangeCache(filePath);
  document.entries[sessionModelKey(provider, session)] = { provider, sessionId: session, supported: true, changed: true, model, updatedAt: new Date().toISOString() };
  await saveModelChangeCache(filePath, document);
  return { provider, sessionId: session, supported: true, changed: true, model };
}

function payloadText(payload: unknown): string | null {
  if (typeof payload === 'string') return payload;
  if (Buffer.isBuffer(payload)) return payload.toString('utf8');
  if (payload instanceof ArrayBuffer) return Buffer.from(payload).toString('utf8');
  if (!Array.isArray(payload)) return null;
  const chunks = payload.map((entry) => {
    if (Buffer.isBuffer(entry)) return entry;
    if (entry instanceof ArrayBuffer) return Buffer.from(entry);
    return ArrayBuffer.isView(entry) ? Buffer.from(entry.buffer, entry.byteOffset, entry.byteLength) : null;
  }).filter((entry): entry is Buffer => entry !== null);
  return chunks.length ? Buffer.concat(chunks).toString('utf8') : null;
}

export const parseIncomingJsonObject = (payload: unknown): AnyRecord | null => {
  const text = payloadText(payload);
  if (typeof text !== 'string' || !text.trim().length) return null;
  try {
    return readObjectRecord(JSON.parse(text));
  } catch {
    return null;
  }
};

export const readJsonConfig = async (filePath: string): Promise<Record<string, unknown>> => {
  try {
    return readObjectRecord(JSON.parse(await readFile(filePath, 'utf8'))) ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
};

export const writeJsonConfig = async (filePath: string, data: Record<string, unknown>): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

async function containsGitMarker(directory: string): Promise<boolean> {
  try {
    const marker = await stat(path.join(directory, '.git'));
    return marker.isDirectory() || marker.isFile();
  } catch {
    return false;
  }
}

export async function findTopmostGitRoot(startPath: string): Promise<string | null> {
  let cursor = path.resolve(startPath);
  let result: string | null = null;
  for (;;) {
    if (await containsGitMarker(cursor)) result = cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) return result;
    cursor = parent;
  }
}

export function normalizeSessionName(rawValue: string | undefined, fallback: string): string {
  const title = (rawValue ?? '').replace(/\s+/g, ' ').trim();
  return title ? title.slice(0, 120) : fallback;
}

export function normalizeProviderTimestamp(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value < 1_000_000_000_000 ? value * 1000 : value).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return normalizeProviderTimestamp(numeric);
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

export function readJsonRecord(value: unknown): AnyRecord | null {
  if (typeof value !== 'string') return readObjectRecord(value);
  try {
    return readObjectRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

export function getOpenCodeDatabasePath(): string {
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

export function unwrapJsonStringLiteral(value: string): string {
  const candidate = value.trim();
  if (!candidate.startsWith('"') || !candidate.endsWith('"')) return value;
  try {
    const decoded = JSON.parse(candidate);
    return typeof decoded === 'string' ? decoded : value;
  } catch {
    return value;
  }
}

export function sanitizeLeafDirectoryName(inputName: string, label = 'directory name'): string {
  const name = inputName.trim();
  if (!name) throw new Error(`${label} is required.`);
  if (name.includes('..') || name.includes(path.posix.sep) || name.includes(path.win32.sep) || name !== path.basename(name)) {
    throw new Error(`Invalid ${label} "${inputName}".`);
  }
  return name;
}

export async function findFilesRecursivelyCreatedAfter(rootDir: string, extension: string, lastScanAt: Date | null, fileList: string[] = []): Promise<string[]> {
  try {
    for (const entry of await readdir(rootDir, { withFileTypes: true })) {
      const candidate = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        await findFilesRecursivelyCreatedAfter(candidate, extension, lastScanAt, fileList);
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        if (!lastScanAt || (await stat(candidate)).birthtime > lastScanAt) fileList.push(candidate);
      }
    }
  } catch {
    // Discovery treats inaccessible provider storage as empty.
  }
  return fileList;
}

export async function readFileTimestamps(filePath: string): Promise<{ createdAt?: string; updatedAt?: string }> {
  try {
    const metadata = await stat(filePath);
    return { createdAt: metadata.birthtime.toISOString(), updatedAt: metadata.mtime.toISOString() };
  } catch {
    return {};
  }
}

export async function buildLookupMap(filePath: string, keyField: string, valueField: string): Promise<Map<string, string>> {
  const output = new Map<string, string>();
  try {
    const stream = fs.createReadStream(filePath);
    const rows = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const row of rows) {
      const source = row.trim();
      if (!source) continue;
      const document = JSON.parse(source) as Record<string, unknown>;
      const key = document[keyField];
      const value = document[valueField];
      if (typeof key === 'string' && typeof value === 'string' && !output.has(key)) output.set(key, value);
    }
  } catch {
    // Lookup files are optional during synchronization.
  }
  return output;
}

export async function extractFirstValidJsonlData<T>(filePath: string, extractor: (parsedJson: unknown) => T | null | undefined, signal?: AbortSignal): Promise<T | null> {
  try {
    const stream = fs.createReadStream(filePath, { signal });
    const rows = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const row of rows) {
      signal?.throwIfAborted();
      const source = row.trim();
      if (!source) continue;
      const result = extractor(JSON.parse(source));
      if (result) {
        rows.close();
        stream.close();
        return result;
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return null;
}

export function flattenPromptForWindowsShell(prompt: string): string {
  return process.platform === 'win32' && typeof prompt === 'string'
    ? prompt.replace(/\s*\r?\n\s*/g, ' ').trim()
    : prompt;
}
