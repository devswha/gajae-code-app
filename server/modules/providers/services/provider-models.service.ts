import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { IProvider } from '@/shared/interfaces.js';
import type {
  LLMProvider,
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelsCacheInfo,
  ProviderModelsDefinition,
  ProviderModelsResult,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import { readProviderSessionActiveModelChange, writeProviderSessionActiveModelChange } from '@/shared/utils.js';

export const PROVIDER_MODELS_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const PROVIDER_MODELS_CACHE_VERSION = 11;

type ProviderModelsServiceDependencies = { resolveProvider?: (provider: LLMProvider) => Pick<IProvider, 'models'>; cachePath?: string; activeModelChangesPath?: string; now?: () => number };
type ProviderModelsOptions = { bypassCache?: boolean };
type ProviderModelsCacheEntry = { updatedAt: number; expiresAt: number; models: ProviderModelsDefinition };
type ProviderModelsCacheFile = { version: number; entries: Record<string, ProviderModelsCacheEntry> };

const defaultCacheLocation = (): string => path.join(os.homedir(), '.gajae-app', 'provider-models-cache.json');

const hasModelOptionShape = (candidate: unknown): candidate is ProviderModelsDefinition['OPTIONS'][number] => {
  if (!candidate || typeof candidate !== 'object') return false;
  const option = candidate as ProviderModelsDefinition['OPTIONS'][number];
  return typeof option.value === 'string'
    && typeof option.label === 'string'
    && (option.description === undefined || typeof option.description === 'string')
    && (option.roles === undefined || Boolean(option.roles));
};

const hasModelsShape = (candidate: unknown): candidate is ProviderModelsDefinition => {
  if (!candidate || typeof candidate !== 'object') return false;
  const catalog = candidate as ProviderModelsDefinition;
  return typeof catalog.DEFAULT === 'string'
    && Array.isArray(catalog.OPTIONS)
    && catalog.OPTIONS.every(hasModelOptionShape)
    && (catalog.MODELS === undefined || (Array.isArray(catalog.MODELS) && catalog.MODELS.every(hasModelOptionShape)));
};

const hasCacheEntryShape = (candidate: unknown): candidate is ProviderModelsCacheEntry => {
  if (!candidate || typeof candidate !== 'object') return false;
  const entry = candidate as ProviderModelsCacheEntry;
  return typeof entry.updatedAt === 'number' && typeof entry.expiresAt === 'number' && hasModelsShape(entry.models);
};

const deserializeCache = async (fileName: string): Promise<Record<string, ProviderModelsCacheEntry>> => {
  try {
    const parsed = JSON.parse(await readFile(fileName, 'utf8')) as Partial<ProviderModelsCacheFile>;
    if (parsed.version !== PROVIDER_MODELS_CACHE_VERSION || !parsed.entries || typeof parsed.entries !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed.entries).filter(([, item]) => hasCacheEntryShape(item)));
  } catch {
    return {};
  }
};

const cacheDetails = (entry: ProviderModelsCacheEntry, source: ProviderModelsCacheInfo['source']): ProviderModelsCacheInfo => ({
  updatedAt: new Date(entry.updatedAt).toISOString(),
  expiresAt: new Date(entry.expiresAt).toISOString(),
  source,
});

export const createProviderModelsService = (dependencies: ProviderModelsServiceDependencies = {}) => {
  const locateProvider = dependencies.resolveProvider ?? providerRegistry.resolveProvider;
  const fileName = dependencies.cachePath ?? defaultCacheLocation();
  const clock = dependencies.now ?? Date.now;
  const remembered = new Map<LLMProvider, ProviderModelsCacheEntry>();
  const fetching = new Map<LLMProvider, Promise<ProviderModelsResult>>();
  let diskRead: Promise<void> | undefined;
  let diskWasRead = false;

  const usable = (provider: LLMProvider, time: number, source: ProviderModelsCacheInfo['source']): ProviderModelsResult | undefined => {
    const entry = remembered.get(provider);
    if (!entry) return undefined;
    if (entry.expiresAt <= time) {
      remembered.delete(provider);
      return undefined;
    }
    return { models: entry.models, cache: cacheDetails(entry, source) };
  };

  const sourceHasChanged = async (provider: LLMProvider, entry: ProviderModelsResult): Promise<boolean> => {
    if (!Number.isFinite(Date.parse(entry.cache.updatedAt))) return false;
    try {
      const revision = await locateProvider(provider).models.getCatalogRevision?.();
      return typeof revision === 'number' && revision > Date.parse(entry.cache.updatedAt);
    } catch {
      return false;
    }
  };

  const writeCache = async (): Promise<void> => {
    try {
      const time = clock();
      const entries = Object.fromEntries([...remembered].filter(([, entry]) => entry.expiresAt > time));
      await mkdir(path.dirname(fileName), { recursive: true });
      await writeFile(fileName, `${JSON.stringify({ version: PROVIDER_MODELS_CACHE_VERSION, entries }, null, 2)}\n`, 'utf8');
    } catch (error) {
      console.warn('Unable to persist provider models cache:', error);
    }
  };

  const readCacheOnce = async (): Promise<void> => {
    if (diskWasRead) return;
    diskRead ??= (async () => {
      const time = clock();
      for (const [key, entry] of Object.entries(await deserializeCache(fileName))) {
        if (entry.expiresAt > time) remembered.set(key as LLMProvider, entry);
      }
      diskWasRead = true;
    })().finally(() => { diskRead = undefined; });
    await diskRead;
  };

  const retrieve = (provider: LLMProvider): Promise<ProviderModelsResult> => {
    const request = locateProvider(provider).models.getSupportedModels().then(async (models) => {
      const updatedAt = clock();
      const entry = { updatedAt, expiresAt: updatedAt + PROVIDER_MODELS_CACHE_TTL_MS, models };
      remembered.set(provider, entry);
      await writeCache();
      return { models, cache: cacheDetails(entry, 'fresh') };
    }).finally(() => { fetching.delete(provider); });
    fetching.set(provider, request);
    return request;
  };

  const getProviderModels = async (provider: LLMProvider, options: ProviderModelsOptions = {}): Promise<ProviderModelsResult> => {
    if (options.bypassCache) return fetching.get(provider) ?? retrieve(provider);

    const fromMemory = usable(provider, clock(), 'memory');
    if (fromMemory && !await sourceHasChanged(provider, fromMemory)) return fromMemory;
    const inFlight = fetching.get(provider);
    if (inFlight) return inFlight;

    await readCacheOnce();
    const fromDisk = usable(provider, clock(), 'disk');
    if (fromDisk && !await sourceHasChanged(provider, fromDisk)) return fromDisk;
    return fetching.get(provider) ?? retrieve(provider);
  };

  return {
    getProviderModels,
    getCurrentActiveModel: (provider: LLMProvider, sessionId?: string): Promise<ProviderCurrentActiveModel> => locateProvider(provider).models.getCurrentActiveModel(sessionId),
    getChangedActiveModel: (provider: LLMProvider, sessionId: string): Promise<ProviderSessionActiveModelChange> => readProviderSessionActiveModelChange(provider, sessionId, { filePath: dependencies.activeModelChangesPath }),
    changeActiveModel: (provider: LLMProvider, input: ProviderChangeActiveModelInput): Promise<ProviderSessionActiveModelChange> => locateProvider(provider).models.changeActiveModel(input),
    /**
     * The model a turn runs on: the session's pin when it has one, else what
     * the request asked for. On a session's first turn an explicit request
     * becomes the pin, so the choice made before the first message survives
     * a reload and a later change of the global default; `default` pins
     * nothing and the session keeps following the app default.
     */
    async resolveResumeModel(provider: LLMProvider, sessionId: string | undefined, requestedModel?: string | null, options: { firstTurn?: boolean } = {}): Promise<string | undefined> {
      const requested = typeof requestedModel === 'string' ? requestedModel.trim() : '';
      if (!sessionId?.trim()) return requested || undefined;
      const saved = await readProviderSessionActiveModelChange(provider, sessionId, { filePath: dependencies.activeModelChangesPath });
      if (saved.supported && saved.changed && saved.model?.trim()) return saved.model.trim();
      if (options.firstTurn && requested && requested !== 'default') {
        await writeProviderSessionActiveModelChange(provider, { sessionId, model: requested }, { filePath: dependencies.activeModelChangesPath });
      }
      return requested || undefined;
    },
    clearCache(): void {
      remembered.clear();
      fetching.clear();
      diskRead = undefined;
      diskWasRead = false;
    },
  };
};

export const providerModelsService = createProviderModelsService();
