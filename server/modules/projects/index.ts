import {
  deleteOrArchiveProject as removeProject,
  deleteSessionJsonlFilesForProjectPath as removeSessionFiles,
} from './services/project-delete.service.js';
import {
  promoteProjectOrigin as promoteOrigin,
  updateProjectDisplayName as renameProject,
} from './services/project-management.service.js';
import {
  grantProjectAlwaysAllow as grantAlwaysAllow,
  resolveRunPermissions as runPermissions,
} from './services/project-permissions.service.js';
import {
  generateDisplayName as displayName,
  getProjectsWithSessions as projectsWithSessions,
} from './services/projects-with-sessions-fetch.service.js';

export {
  displayName as generateDisplayName,
  grantAlwaysAllow as grantProjectAlwaysAllow,
  projectsWithSessions as getProjectsWithSessions,
  runPermissions as resolveProjectRunPermissions,
  promoteOrigin as promoteProjectOrigin,
  removeProject as deleteOrArchiveProject,
  removeSessionFiles as deleteSessionJsonlFilesForProjectPath,
  renameProject as updateProjectDisplayName,
};
