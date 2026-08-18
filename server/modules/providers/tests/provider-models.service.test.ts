import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createProviderModelsService,
  PROVIDER_MODELS_CACHE_TTL_MS,
} from '@/modules/providers/services/provider-models.service.js';
import type {
  ProviderChangeActiveModelInput,
  LLMProvider,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import { writeProviderSessionActiveModelChange } from '@/shared/utils.js';

const createModels = (value: string): ProviderModelsDefinition => ({
  OPTIONS: [{ value, label: value }],
  DEFAULT: value,
});

const createCurrentActiveModel = (model: string): ProviderCurrentActiveModel => ({
  model,
});

const createSessionActiveModelChange = (
  provider: LLMProvider,
  input: ProviderChangeActiveModelInput,
): ProviderSessionActiveModelChange => ({
  provider,
  sessionId: input.sessionId,
  supported: true,
  changed: true,
  model: input.model,
});

const createEphemeralCachePath = (): string => path.join(
  os.tmpdir(),
  `provider-model-cache-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
);

test('provider models service delegates to the resolved provider model adapter', async () => {
  const calls: LLMProvider[] = [];
  const service = createProviderModelsService({
    cachePath: createEphemeralCachePath(),
    resolveProvider: (provider) => {
      calls.push(provider);
      return {
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      };
    },
  });

  const models = await service.getProviderModels('gjc', { bypassCache: true });

  assert.deepEqual(calls, ['gjc']);
  assert.equal(models.models.DEFAULT, 'gjc-models');
  assert.equal(models.cache.source, 'fresh');
});

test('provider models service returns each provider adapter result without rewriting it', async () => {
  const expectedModels: ProviderModelsDefinition = {
    OPTIONS: [
      { value: 'cursor-a', label: 'Cursor A' },
      { value: 'cursor-b', label: 'Cursor B' },
    ],
    DEFAULT: 'cursor-b',
  };

  const service = createProviderModelsService({
    cachePath: createEphemeralCachePath(),
    resolveProvider: () => ({
      models: {
        getSupportedModels: async () => expectedModels,
        getCurrentActiveModel: async () => createCurrentActiveModel('gjc-active'),
        changeActiveModel: async (input) => createSessionActiveModelChange('gjc', input),
      },
    }),
  });

  const models = await service.getProviderModels('gjc', { bypassCache: true });

  assert.deepEqual(models.models, expectedModels);
});

test('provider models are cached for the three-day ttl', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cache-ttl-'));
  let currentTime = 1_000;
  let loadCount = 0;

  try {
    const service = createProviderModelsService({
      cachePath: path.join(tempRoot, 'models-cache.json'),
      now: () => currentTime,
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => {
            loadCount += 1;
            return createModels(`${provider}-${loadCount}`);
          },
          getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    const first = await service.getProviderModels('gjc');
    const cached = await service.getProviderModels('gjc');
    assert.equal(loadCount, 1);
    assert.equal(cached.models.DEFAULT, first.models.DEFAULT);
    assert.equal(cached.cache.source, 'memory');

    currentTime += PROVIDER_MODELS_CACHE_TTL_MS - 1;
    await service.getProviderModels('gjc');
    assert.equal(loadCount, 1);

    currentTime += 2;
    const refreshed = await service.getProviderModels('gjc');
    assert.equal(loadCount, 2);
    assert.equal(refreshed.models.DEFAULT, 'gjc-2');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('provider models are cached for the three-day ttl when bypassCache is false', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cache-claude-direct-'));
  let loadCount = 0;

  try {
    const service = createProviderModelsService({
      cachePath: path.join(tempRoot, 'models-cache.json'),
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => {
            loadCount += 1;
            return createModels(`${provider}-${loadCount}`);
          },
          getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    const first = await service.getProviderModels('gjc');
    const second = await service.getProviderModels('gjc');

    assert.equal(loadCount, 1);
    assert.equal(first.models.DEFAULT, 'gjc-1');
    assert.equal(second.models.DEFAULT, 'gjc-1');
    assert.equal(second.cache.source, 'memory');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('provider model cache is persisted across service instances', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cache-file-'));
  const cachePath = path.join(tempRoot, 'models-cache.json');

  try {
    const writer = createProviderModelsService({
      cachePath,
      resolveProvider: () => ({
        models: {
          getSupportedModels: async () => createModels('gjc-cached'),
          getCurrentActiveModel: async () => createCurrentActiveModel('gjc-active'),
          changeActiveModel: async (input) => createSessionActiveModelChange('gjc', input),
        },
      }),
    });
    await writer.getProviderModels('gjc');

    const reader = createProviderModelsService({
      cachePath,
      resolveProvider: () => ({
        models: {
          getSupportedModels: async () => {
            throw new Error('loader should not be called for persisted cache hits');
          },
          getCurrentActiveModel: async () => createCurrentActiveModel('gjc-active'),
          changeActiveModel: async (input) => createSessionActiveModelChange('gjc', input),
        },
      }),
    });
    const models = await reader.getProviderModels('gjc');
    assert.equal(models.models.DEFAULT, 'gjc-cached');
    assert.equal(models.cache.source, 'disk');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('concurrent provider model requests share one load operation', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cache-pending-'));
  let loadCount = 0;

  try {
    const service = createProviderModelsService({
      cachePath: path.join(tempRoot, 'models-cache.json'),
      resolveProvider: () => ({
        models: {
          getSupportedModels: async () => {
            loadCount += 1;
            await new Promise((resolve) => setTimeout(resolve, 20));
            return createModels('gjc-cached');
          },
          getCurrentActiveModel: async () => createCurrentActiveModel('gjc-active'),
          changeActiveModel: async (input) => createSessionActiveModelChange('gjc', input),
        },
      }),
    });

    const [first, second] = await Promise.all([
      service.getProviderModels('gjc'),
      service.getProviderModels('gjc'),
    ]);

    assert.equal(loadCount, 1);
    assert.equal(first.models.DEFAULT, 'gjc-cached');
    assert.equal(second.models.DEFAULT, 'gjc-cached');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('bypassCache forces a fresh provider fetch and updates cache metadata', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cache-refresh-'));
  let currentTime = 1_000;
  let loadCount = 0;

  try {
    const service = createProviderModelsService({
      cachePath: path.join(tempRoot, 'models-cache.json'),
      now: () => currentTime,
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => {
            loadCount += 1;
            return createModels(`${provider}-${loadCount}`);
          },
          getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active-${loadCount}`),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    const first = await service.getProviderModels('gjc');
    currentTime += 50;
    const refreshed = await service.getProviderModels('gjc', { bypassCache: true });

    assert.equal(first.models.DEFAULT, 'gjc-1');
    assert.equal(refreshed.models.DEFAULT, 'gjc-2');
    assert.equal(refreshed.cache.source, 'fresh');
    assert.notEqual(refreshed.cache.updatedAt, first.cache.updatedAt);
    assert.equal(loadCount, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('provider models service delegates current active model lookups to the provider adapter', async () => {
  const calls: Array<{ provider: LLMProvider; sessionId?: string }> = [];
  const service = createProviderModelsService({
    resolveProvider: (provider) => ({
      models: {
        getSupportedModels: async () => createModels(`${provider}-models`),
        getCurrentActiveModel: async (sessionId) => {
          calls.push({ provider, sessionId });
          return createCurrentActiveModel(`${provider}-${sessionId}`);
        },
        changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
      },
    }),
  });

  const activeModel = await service.getCurrentActiveModel('gjc', 'session-123');

  assert.deepEqual(calls, [{ provider: 'gjc', sessionId: 'session-123' }]);
  assert.equal(activeModel.model, 'gjc-session-123');
});

test('provider models service delegates active model change requests to the provider adapter', async () => {
  const calls: Array<{ provider: LLMProvider; input: ProviderChangeActiveModelInput }> = [];
  const service = createProviderModelsService({
    resolveProvider: (provider) => ({
      models: {
        getSupportedModels: async () => createModels(`${provider}-models`),
        getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
        changeActiveModel: async (input) => {
          calls.push({ provider, input });
          return createSessionActiveModelChange(provider, input);
        },
      },
    }),
  });

  const changedModel = await service.changeActiveModel('gjc', {
    sessionId: 'session-123',
    model: 'opus',
  });

  assert.deepEqual(calls, [{
    provider: 'gjc',
    input: {
      sessionId: 'session-123',
      model: 'opus',
    },
  }]);
  assert.equal(changedModel.changed, true);
  assert.equal(changedModel.model, 'opus');
});

test('resolveResumeModel prefers a stored changed model over the requested one', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-change-'));
  const activeModelChangesPath = path.join(tempRoot, 'session-model-changes.json');

  try {
    const service = createProviderModelsService({
      activeModelChangesPath,
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    await writeProviderSessionActiveModelChange('gjc', {
      sessionId: 'session-456',
      model: 'composer-2',
    }, {
      filePath: activeModelChangesPath,
    });

    const model = await service.resolveResumeModel('gjc', 'session-456', 'composer-2-fast');
    assert.equal(model, 'composer-2');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('a session that pinned a model reports it, so the picker can show what will run', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-read-'));
  const activeModelChangesPath = path.join(tempRoot, 'session-model-changes.json');

  try {
    const service = createProviderModelsService({
      activeModelChangesPath,
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    await writeProviderSessionActiveModelChange('gjc', {
      sessionId: 'session-pinned',
      model: 'composer-2',
    }, {
      filePath: activeModelChangesPath,
    });

    const pinned = await service.getChangedActiveModel('gjc', 'session-pinned');
    assert.equal(pinned.changed, true);
    assert.equal(pinned.model, 'composer-2');

    // A session that never pinned one must not inherit another session's choice.
    const untouched = await service.getChangedActiveModel('gjc', 'session-untouched');
    assert.equal(untouched.changed, false);
    assert.equal(untouched.model, null);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('a catalog whose sources changed is refetched instead of served stale', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-revision-'));
  const cachePath = path.join(tempRoot, 'cache.json');

  try {
    let revision = 1_000;
    let catalog = 'first';
    let reads = 0;
    const service = createProviderModelsService({
      cachePath,
      resolveProvider: () => ({
        models: {
          getSupportedModels: async () => {
            reads += 1;
            return createModels(catalog);
          },
          getCatalogRevision: async () => revision,
          getCurrentActiveModel: async () => createCurrentActiveModel('active'),
          changeActiveModel: async (input: ProviderChangeActiveModelInput) => createSessionActiveModelChange('gjc', input),
        },
      }),
    });

    const first = await service.getProviderModels('gjc');
    assert.equal(first.models.DEFAULT, 'first');
    assert.equal(reads, 1);

    // Same revision: the cache still answers.
    await service.getProviderModels('gjc');
    assert.equal(reads, 1);

    // The sources changed after the entry was cached, so the TTL must not win.
    catalog = 'second';
    revision = Date.now() + 60_000;
    const afterEdit = await service.getProviderModels('gjc');
    assert.equal(afterEdit.models.DEFAULT, 'second');
    assert.equal(reads, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('a provider without a revision keeps plain TTL caching', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-no-revision-'));
  const cachePath = path.join(tempRoot, 'cache.json');

  try {
    let reads = 0;
    const service = createProviderModelsService({
      cachePath,
      resolveProvider: () => ({
        models: {
          getSupportedModels: async () => {
            reads += 1;
            return createModels('network-catalog');
          },
          getCurrentActiveModel: async () => createCurrentActiveModel('active'),
          changeActiveModel: async (input: ProviderChangeActiveModelInput) => createSessionActiveModelChange('gjc', input),
        },
      }),
    });

    await service.getProviderModels('gjc');
    await service.getProviderModels('gjc');
    assert.equal(reads, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
