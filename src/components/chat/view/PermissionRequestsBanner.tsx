import React from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlertIcon } from 'lucide-react';

import type { PendingPermissionRequest, PermissionDecision } from '../types/types';
import { formatToolInputForDisplay, offeredPermissionKinds } from '../utils/chatPermissions';
import { getPermissionPanel, registerPermissionPanel } from '../tools/configs/permissionPanelRegistry';
import { AskUserQuestionPanel } from '../tools/components/InteractiveRenderers';
import {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationActions,
  ConfirmationAction,
} from '../../../shared/view/ui';

/**
 * Both ask producers get the same panel.
 *
 * `gjc-sdk-bridge.ts` labels its requests `AskUserQuestion`, while the Protocol
 * v1 worker path in `gjc-bun-ask-controller.ts` labels them `ask` — and only
 * the first was registered, so a question from the worker fell through to the
 * generic Allow/Deny confirmation below. That hid the question and its options
 * behind "View tool input", and worse, its bare Allow carries no answer, which
 * the controller rejects on purpose (`accepted: false`) and leaves the question
 * open. The turn simply appeared to hang.
 */
for (const toolName of ['ask', 'AskUserQuestion']) {
  registerPermissionPanel(toolName, AskUserQuestionPanel);
}

interface PermissionRequestsBannerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (requestIds: string | string[], decision: PermissionDecision) => void;
}

/** The runtime's own summary of the call (the command for bash, "Delete x" for edits), when it sent one. */
function requestTitle(request: PendingPermissionRequest): string | null {
  const context = request.context;
  if (!context || typeof context !== 'object') return null;
  const title = (context as { title?: unknown }).title;
  return typeof title === 'string' && title.trim() ? title.trim() : null;
}

export default function PermissionRequestsBanner({
  pendingPermissionRequests,
  handlePermissionDecision,
}: PermissionRequestsBannerProps) {
  const { t } = useTranslation('chat');
  // Filter out plan tool requests — they are handled inline by PlanDisplay
  const filteredRequests = pendingPermissionRequests.filter(
    (r) => r.toolName !== 'ExitPlanMode' && r.toolName !== 'exit_plan_mode'
  );

  if (!filteredRequests.length) {
    return null;
  }

  return (
    <div className="mb-3 space-y-2">
      {filteredRequests.map((request) => {
        const CustomPanel = getPermissionPanel(request.toolName);
        if (CustomPanel) {
          return (
            <CustomPanel
              key={request.requestId}
              request={request}
              onDecision={handlePermissionDecision}
            />
          );
        }

        const rawInput = formatToolInputForDisplay(request.input);
        const title = requestTitle(request);
        // Offer only what the runtime asked for; with no statement, the card
        // keeps its historical set - everything except always-deny.
        const offered = offeredPermissionKinds(request.context);
        const showsAlwaysAllow = offered === null || offered.has('allow_always');
        const showsAlwaysDeny = offered !== null && offered.has('reject_always');

        return (
          <Confirmation key={request.requestId} approval="pending" data-tool={request.toolName}>
            <ConfirmationTitle className="flex items-start gap-3">
              <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <ConfirmationRequest>
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{t('permissionCard.title')}</span>
                  <span className="ml-2 text-muted-foreground">
                    {t('permissionCard.tool')} <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{request.toolName}</code>
                  </span>
                  {title && (
                    <code className="mt-1 block truncate font-mono text-xs text-foreground/80" title={title}>{title}</code>
                  )}
                </div>
              </ConfirmationRequest>
            </ConfirmationTitle>

            {rawInput && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  {t('permissionCard.viewInput')}
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap text-muted-foreground">
                  {rawInput}
                </pre>
              </details>
            )}

            <ConfirmationActions className="flex-wrap">
              <ConfirmationAction
                variant="outline"
                onClick={() => handlePermissionDecision(request.requestId, { allow: false, message: 'User denied tool use' })}
              >
                {t('permissionCard.deny')}
              </ConfirmationAction>
              {showsAlwaysDeny && (
                <ConfirmationAction
                  variant="outline"
                  data-action="always-deny"
                  title={t('permissionCard.alwaysDenyHint')}
                  onClick={() => handlePermissionDecision(request.requestId, { allow: false, always: true, message: 'User denied tool use (always)' })}
                >
                  {t('permissionCard.alwaysDeny', { tool: request.toolName })}
                </ConfirmationAction>
              )}
              {showsAlwaysAllow && (
                <ConfirmationAction
                  variant="outline"
                  data-action="always-allow"
                  title={t('permissionCard.alwaysAllowHint')}
                  onClick={() => handlePermissionDecision(request.requestId, { allow: true, always: true })}
                >
                  {t('permissionCard.alwaysAllow', { tool: request.toolName })}
                </ConfirmationAction>
              )}
              <ConfirmationAction
                variant="default"
                onClick={() => handlePermissionDecision(request.requestId, { allow: true })}
              >
                {t('permissionCard.allow')}
              </ConfirmationAction>
            </ConfirmationActions>
          </Confirmation>
        );
      })}
    </div>
  );
}
