import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ShieldAlertIcon } from 'lucide-react';

import { approveShortcutLabel, useApproveShortcut } from '../hooks/useApproveShortcut';
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
 * A question from the worker (`gjc-bun-ask-controller.ts`, tool name `ask`)
 * must reach this panel. Left unregistered it falls through to the generic
 * Allow/Deny confirmation below, which hides the question and its options
 * behind "View tool input" - and its bare Allow carries no answer, which the
 * controller rejects on purpose (`accepted: false`) and leaves the question
 * open. The turn simply appears to hang.
 */
registerPermissionPanel('ask', AskUserQuestionPanel);

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

  // Cmd/Ctrl+Enter approves the oldest request that is a plain Allow/Deny
  // card; a custom panel (a question) needs an answer, not an approval.
  const firstApprovable = filteredRequests.find((request) => !getPermissionPanel(request.toolName));
  useApproveShortcut(Boolean(firstApprovable), () => {
    if (firstApprovable) handlePermissionDecision(firstApprovable.requestId, { allow: true });
  });

  if (!filteredRequests.length) {
    return null;
  }

  return (
    <div className="mb-3 space-y-2">
      {filteredRequests.map((request) => {
        const CustomPanel = getPermissionPanel(request.toolName);
        if (CustomPanel) {
          return (
            <div key={request.requestId} data-permission-request-id={request.requestId} tabIndex={-1} className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <CustomPanel request={request} onDecision={handlePermissionDecision} />
            </div>
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
          <Confirmation key={request.requestId} approval="pending" data-tool={request.toolName} data-permission-request-id={request.requestId} tabIndex={-1} className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <ConfirmationTitle className="flex items-start gap-3">
              <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <ConfirmationRequest>
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{t('permissionCard.title')}</span>
                  <span className="ml-2 text-muted-foreground">
                    {t('permissionCard.tool')} <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{request.toolName}</code>
                  </span>
                  {/* The whole command, wrapped: approving a command has to mean
                      approving what it actually runs, not its first 60 characters. */}
                  {title && (
                    <code className="mt-2 block max-h-28 overflow-y-auto rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-xs wrap-anywhere whitespace-pre-wrap text-foreground/90" title={title}>{title}</code>
                  )}
                </div>
              </ConfirmationRequest>
            </ConfirmationTitle>

            {rawInput && (
              <details className="group mt-1">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-3 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
                  {t('permissionCard.viewInput')}
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap text-muted-foreground">
                  {rawInput}
                </pre>
              </details>
            )}

            {/* One decision, weighted like a native sheet: the standing rules
                are quiet options on the left, the one-off pair on the right. */}
            <div className="flex flex-wrap items-center gap-2">
              {showsAlwaysAllow && (
                <ConfirmationAction
                  variant="ghost"
                  data-action="always-allow"
                  title={t('permissionCard.alwaysAllowHint')}
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => handlePermissionDecision(request.requestId, { allow: true, always: true })}
                >
                  {t('permissionCard.alwaysAllow', { tool: request.toolName })}
                </ConfirmationAction>
              )}
              {showsAlwaysDeny && (
                <ConfirmationAction
                  variant="ghost"
                  data-action="always-deny"
                  title={t('permissionCard.alwaysDenyHint')}
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => handlePermissionDecision(request.requestId, { allow: false, always: true, message: 'User denied tool use (always)' })}
                >
                  {t('permissionCard.alwaysDeny', { tool: request.toolName })}
                </ConfirmationAction>
              )}
              <ConfirmationActions className="ml-auto">
                <ConfirmationAction
                  variant="outline"
                  onClick={() => handlePermissionDecision(request.requestId, { allow: false, message: 'User denied tool use' })}
                >
                  {t('permissionCard.deny')}
                </ConfirmationAction>
                <ConfirmationAction
                  variant="default"
                  aria-keyshortcuts={request === firstApprovable ? 'Meta+Enter Control+Enter' : undefined}
                  onClick={() => handlePermissionDecision(request.requestId, { allow: true })}
                >
                  {t('permissionCard.allow')}
                  {request === firstApprovable && (
                    <kbd aria-hidden className="ml-1.5 rounded bg-primary-foreground/20 px-1 py-0.5 font-mono text-[10px]">{approveShortcutLabel()}</kbd>
                  )}
                </ConfirmationAction>
              </ConfirmationActions>
            </div>
          </Confirmation>
        );
      })}
    </div>
  );
}
