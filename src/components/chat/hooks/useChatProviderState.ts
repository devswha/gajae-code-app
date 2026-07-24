import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { PendingPermissionRequest, PermissionMode } from '../types/types';
import type {
  Project,
  ProjectSession,
  LLMProvider,
  ProviderModelsCacheInfo,
  ProviderModelsDefinition,
} from '../../../types/app';

const GJC_PROVIDER: LLMProvider = 'gjc';
const DEFAULT_GJC_MODEL = 'default';
const DEFAULT_PERMISSION_MODE: PermissionMode = 'default';

interface UseChatProviderStateArgs {
  selectedSession: ProjectSession | null;
  selectedProject: Project | null;
}

type ProviderModelsApiResponse = {
  success?: boolean;
  data?: {
    models?: ProviderModelsDefinition;
    cache?: ProviderModelsCacheInfo;
  };
};

type ChangeActiveModelApiResponse = {
  success?: boolean;
  data?: {
    supported?: boolean;
    changed?: boolean;
    model?: string | null;
  };
};

export function useChatProviderState({
  selectedSession,
  selectedProject: _selectedProject,
}: UseChatProviderStateArgs) {
  const [gjcModel, setGjcModelState] = useState<string>(() => (
    localStorage.getItem('gjc-model') || DEFAULT_GJC_MODEL
  ));
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [providerModelCatalog, setProviderModelCatalog] = useState<
    Partial<Record<LLMProvider, ProviderModelsDefinition>>
  >({});
  const [providerModelCacheCatalog, setProviderModelCacheCatalog] = useState<
    Partial<Record<LLMProvider, ProviderModelsCacheInfo>>
  >({});
  const [providerModelsLoading, setProviderModelsLoading] = useState(true);
  const [providerModelsRefreshing, setProviderModelsRefreshing] = useState(false);
  const providerModelsRequestIdRef = useRef(0);

  const setGjcModel = useCallback((model: string) => {
    setGjcModelState(model);
    localStorage.setItem('gjc-model', model);
  }, []);

  const loadProviderModels = useCallback(async (options: { bypassCache?: boolean } = {}) => {
    const requestId = providerModelsRequestIdRef.current + 1;
    providerModelsRequestIdRef.current = requestId;

    if (options.bypassCache) {
      setProviderModelsRefreshing(true);
    } else {
      setProviderModelsLoading(true);
    }

    try {
      const params = new URLSearchParams();
      if (options.bypassCache) {
        params.set('bypassCache', 'true');
      }
      const queryString = params.toString();
      const response = await authenticatedFetch(
        `/api/providers/gjc/models${queryString ? `?${queryString}` : ''}`,
      );
      const body = (await response.json()) as ProviderModelsApiResponse;
      if (providerModelsRequestIdRef.current !== requestId || !body.success || !body.data?.models || !body.data.cache) {
        return;
      }

      const models = body.data.models;
      setProviderModelCatalog({ gjc: models });
      setProviderModelCacheCatalog({ gjc: body.data.cache });

      setGjcModelState((currentModel) => {
        const storedModel = localStorage.getItem('gjc-model');
        const model = models.OPTIONS.some((option) => option.value === storedModel)
          ? storedModel!
          : models.OPTIONS.some((option) => option.value === currentModel)
            ? currentModel
            : models.DEFAULT;
        if (localStorage.getItem('gjc-model') !== model) {
          localStorage.setItem('gjc-model', model);
        }
        return model;
      });
    } catch (error) {
      console.error('Error loading GJC models:', error);
    } finally {
      if (providerModelsRequestIdRef.current === requestId) {
        setProviderModelsLoading(false);
        setProviderModelsRefreshing(false);
      }
    }
  }, []);
  const hardRefreshProviderModels = useCallback(
    () => loadProviderModels({ bypassCache: true }),
    [loadProviderModels],
  );


  useEffect(() => {
    void loadProviderModels();
  }, [loadProviderModels]);

  const selectProviderModel = useCallback(async (
    targetProvider: LLMProvider,
    model: string,
    sessionId?: string | null,
  ) => {
    if (targetProvider !== GJC_PROVIDER) {
      throw new Error('Only GJC models can be selected.');
    }

    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId || (selectedSession?.id === normalizedSessionId && selectedSession.__provider !== GJC_PROVIDER)) {
      setGjcModel(model);
      return {
        scope: 'default' as const,
        changed: false,
        model,
      };
    }

    const response = await authenticatedFetch(
      `/api/providers/gjc/sessions/${encodeURIComponent(normalizedSessionId)}/active-model`,
      {
        method: 'POST',
        body: JSON.stringify({ model }),
      },
    );
    const body = (await response.json()) as ChangeActiveModelApiResponse;
    if (!response.ok || !body.success || !body.data?.supported) {
      throw new Error('Unable to change the active GJC model for this session.');
    }

    setGjcModel(model);

    return {
      scope: 'session' as const,
      changed: body.data.changed === true,
      model: body.data.model || model,
    };
  }, [selectedSession, setGjcModel]);

  return {
    provider: GJC_PROVIDER,
    gjcModel,
    setGjcModel,
    permissionMode: DEFAULT_PERMISSION_MODE,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    providerModelCatalog,
    providerModelCacheCatalog,
    providerModelsLoading,
    providerModelsRefreshing,
    hardRefreshProviderModels,
    selectProviderModel,
  };
}
