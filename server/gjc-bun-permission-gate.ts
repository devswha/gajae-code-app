import type {
  ClientBridgePermissionOption,
  ClientBridgePermissionOutcome,
  ClientBridgePermissionToolCall,
} from '@gajae-code/coding-agent/session/client-bridge';

import { selectPermissionOption, type GjcBunAskController } from './gjc-bun-ask-controller.js';
import { gjcAutoApprovalNotice, gjcAutoApprovalReason, type GjcRunPermissions } from './gjc-permission-policy.js';
import { GJC_CHECKOUT_ESCAPE_NOTICE, GJC_SHARED_CHECKOUT_NOTICE, sharedCheckoutGate, type SharedCheckoutGate } from './gjc-shared-checkout-guard.js';
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
 *
 * One class of call outranks the policy: git state changes that touch a
 * checkout other readers depend on. Approving those in advance approves them
 * on behalf of everyone else reading that directory, which is not the granting
 * user's to waive turn by turn - so they become a card even under `bypass`.
 * That covers a session in the shared project checkout (every git state
 * change) and a worktree session whose command leaves its own checkout, which
 * is the normal case for a repository since the run-location default moved to
 * a managed worktree.
 */
export function createGjcPermissionProvider(
  permissions: GjcRunPermissions,
  askController: Pick<GjcBunAskController, 'requestPermission'>,
  writer: GjcWorkerWriter,
  ownedCheckoutRoot?: string,
): GjcPermissionProvider {
  const noticed = new Set<string>();
  let checkoutNoticeSent: SharedCheckoutGate | null = null;
  return async (toolCall, options, signal) => {
    const reason = gjcAutoApprovalReason(permissions, toolCall.toolName);
    const gate = sharedCheckoutGate(toolCall.toolName, toolCall.rawInput, ownedCheckoutRoot);
    if (gate) {
      // Explain only when this actually overrode an approval. A policy that was
      // going to ask anyway shows the same card it always did, and a sentence
      // about why would be noise on every commit.
      if (reason && checkoutNoticeSent !== gate) {
        checkoutNoticeSent = gate;
        const content = gate === 'escape' ? GJC_CHECKOUT_ESCAPE_NOTICE : GJC_SHARED_CHECKOUT_NOTICE;
        writer.send({ kind: 'system_notice', level: 'info', content });
      }
      return askController.requestPermission(toolCall, options, signal);
    }
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
