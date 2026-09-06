import { projectsDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { IProvider } from '@/shared/interfaces.js';
import type { LLMProvider, ProviderSkill } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type ProviderSkillsServiceDependencies = {
  resolveProvider?: (provider: LLMProvider) => Pick<IProvider, 'skills'>;
  resolveProjectPath?: (projectId: string) => string | null;
};

const createProviderSkillsService = (dependencies: ProviderSkillsServiceDependencies = {}) => {
  const resolveProvider = dependencies.resolveProvider ?? providerRegistry.resolveProvider;
  const resolveProjectPath = dependencies.resolveProjectPath ?? projectsDb.getProjectPathById;

  return {
    async listProviderSkills(provider: LLMProvider, projectId?: string, sessionWorkspace?: string): Promise<ProviderSkill[]> {
      let workspacePath: string | undefined = sessionWorkspace;
      if (projectId) {
        workspacePath ??= resolveProjectPath(projectId) ?? undefined;
        if (!workspacePath) {
          throw new AppError(`Project "${projectId}" was not found.`, {
            code: 'PROJECT_NOT_FOUND',
            statusCode: 404,
          });
        }
      }

      return resolveProvider(provider).skills.listSkills({ workspacePath });
    },
  };
};

export const providerSkillsService = createProviderSkillsService();
