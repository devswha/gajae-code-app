import type {
  ClientBridgePermissionOption,
  ClientBridgePermissionOutcome,
  ClientBridgePermissionToolCall,
} from '@gajae-code/coding-agent/session/client-bridge';

import { selectPermissionOption, type GjcBunAskController } from './gjc-bun-ask-controller.js';
import { gjcAutoApprovalNotice, gjcAutoApprovalReason, type GjcRunPermissions } from './gjc-permission-policy.js';
import type { GjcWorkerWriter } from './gjc-worker.js';

export type GjcPermissionProvider = (
  toolCall: ClientBridgePermissionToolCall,
  options: ClientBridgePermissionOption[],
  signal?: AbortSignal,
) => Promise<ClientBridgePermissionOutcome>;

/**
 * The permission provider a run installs on its SDK session.
 *
 * The runtime consults it for every gated tool call once the session is in
 * `prompt` mode. Calls the project's policy already covers are approved here,
 * inside the worker, so no card reaches the browser and the run is never
 * reported as waiting for input; everything else becomes a permission card
 * through the ask controller. Each auto-approval is noted in the transcript
 * once per tool per run, so a bypassed session still shows what ran unasked.
 */
export function createGjcPermissionProvider(
  permissions: GjcRunPermissions,
  askController: Pick<GjcBunAskController, 'requestPermission'>,
  writer: GjcWorkerWriter,
): GjcPermissionProvider {
  const noticed = new Set<string>();
  return async (toolCall, options, signal) => {
    const reason = gjcAutoApprovalReason(permissions, toolCall.toolName);
    if (!reason) return askController.requestPermission(toolCall, options, signal);
    if (!noticed.has(toolCall.toolName)) {
      noticed.add(toolCall.toolName);
      writer.send({ kind: 'system_notice', level: 'info', content: gjcAutoApprovalNotice(toolCall.toolName, reason) });
    }
    // `allow_once` keeps this provider in the loop: a cached `allow_always`
    // inside the runtime would decide the next call before this policy sees it.
    return selectPermissionOption(options, 'allow_once') ?? { outcome: 'cancelled' };
  };
}
