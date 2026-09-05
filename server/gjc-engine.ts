/**
 * The GJC engine's public surface.
 *
 * Everything else under `server/gjc-*` is the engine's inside. This file is the
 * only part of it the application is allowed to reach, and the list below is
 * therefore the entire contract between the two - a contract that has to survive
 * the engine moving to its own repository.
 *
 * It is deliberately small. Before this existed the application imported four
 * engine modules by path, which made every internal symbol look like part of the
 * interface and left nobody able to say what moving the engine would break. The
 * answer is this file.
 *
 * The fifth thing the application consumes is not importable: the worker is a
 * **process**, spawned by path from `gjc-worker-client.ts`, speaking the protocol
 * specified in `docs/GJC-WORKER-PROTOCOL.md`. That is the boundary that matters
 * most, and it is already the arm's-length one.
 *
 * Adding an export here is a decision about the engine's published API. Reaching
 * around it is a lint error.
 */

// The wire contract. Types and codec, shared by both ends of the worker
// protocol; the normative description is docs/GJC-WORKER-PROTOCOL.md.
export {
  GJC_WORKER_PROTOCOL_VERSION,
  GJC_WORKER_MAX_FRAME_BYTES,
  GjcWorkerNdjsonDecoder,
  GjcWorkerProtocolError,
  GjcWorkerRequestTracker,
  parseGjcWorkerFrame,
  redactGjcWorkerSecrets,
  serializeGjcWorkerFrame,
} from './gjc-worker-protocol.js';
export type {
  GjcWorkerEventFrame,
  GjcWorkerEventMethod,
  GjcWorkerFrame,
  GjcWorkerGlobalEventMethod,
  GjcWorkerRequestFrame,
  GjcWorkerRequestMethod,
  GjcWorkerResponseFrame,
  GjcWorkerResponsePayload,
  JsonObject,
  JsonValue,
} from './gjc-worker-protocol.js';

// A worker that cannot confirm owned cleanup must be reaped before settlement.
export { GJC_CLEANUP_UNCONFIRMED_CODE } from './gjc-cleanup-error.js';

// Which builtin tools a browser-hosted session may use. The application sends
// this to the worker at session start; the reasons for each decision, and the
// test that keeps the runtime from adding to it, live with the engine.
export { GJC_AGENT_TOOL_NAMES } from './gjc-agent-tools.js';

// The per-project permission policy a run starts with. The application stores
// it and sends it in the session options; the worker enforces it against the
// runtime's permission gate.
export {
  DEFAULT_GJC_PERMISSION_MODE,
  GJC_INVALID_PERMISSIONS_CODE,
  GJC_INVALID_PERMISSIONS_MESSAGE,
  GJC_PERMISSION_MODES,
  GjcRunPermissionsError,
  gjcAutoApprovalNotice,
  gjcAutoApprovalReason,
  isGjcPermissionMode,
  isGjcPermissionToolName,
  parseGjcRunPermissions,
} from './gjc-permission-policy.js';
export type { GjcPermissionMode, GjcRunPermissions } from './gjc-permission-policy.js';

// Windows job-object launch, so a worker and its descendants die with the
// application instead of outliving it.
export {
  createWindowsJobLaunch,
  GJC_WINDOWS_JOB_GUARD_ACK,
  GJC_WINDOWS_JOB_GUARD_READY,
} from './gjc-windows-job.js';

// The fixed failure surface for a run whose model cannot be paired with a
// credential the runtime can use. The worker answers with the code and fixed
// text; the application relays that text instead of the generic failure.
export {
  GJC_MODEL_UNRESOLVED_CODE,
  GJC_MODEL_UNRESOLVED_MESSAGE,
} from './gjc-model-resolution.js';

// The command and skill surface the runtime advertises, generated from the
// installed runtime rather than hand-listed.
export { GJC_APP_BUILTIN_COMMANDS, GJC_BUNDLED_SKILLS } from './gjc-command-surface.generated.js';
