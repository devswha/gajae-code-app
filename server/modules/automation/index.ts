export {
  default as automationRoutes,
  createAutomationRouter,
  createBrowserAutomationRouter,
} from './automation.routes.js';
export {
  automationService, AutomationService, configureDesktopRestartAdmission,
  createAutomationDesktopRestartReader, createBrowserDesktopRestartReader, createComputerDesktopRestartReader,
} from './automation.service.js';
export { BrowserBackendStore, browserBackendStore, resolveGjcBrowserBackend } from './browser-backend.js';
export { ComputerUseStore, computerUseStore, resolveGjcComputerUse } from './computer-use.js';
export {
  EgoActivityReader, EgoActivityStore, egoActivityReader, egoActivityStore,
  type EgoActivityResponse,
} from './ego-activity.js';
export { CUA_SAFE_TOOLS, type CuaSafeTool } from './cua-client.js';
export type { BrowserCommand, BrowserSessionState } from './browser-protocol.js';
