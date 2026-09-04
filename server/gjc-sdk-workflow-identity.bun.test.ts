import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, test } from 'node:test';

import { Settings } from '@gajae-code/coding-agent/config/settings';
import { deepInterviewStatePath } from '@gajae-code/coding-agent/gjc-runtime/deep-interview-runtime';
import { createAgentSession } from '@gajae-code/coding-agent/sdk/session';
import { SessionManager } from '@gajae-code/coding-agent/session/session-manager';
import type { ToolSession } from '@gajae-code/coding-agent/tools';

// Regression coverage for issue #18 (upstream fix: Yeachan-Heo/gajae-code#5282).
// The app passes an explicit providerSessionId to createAgentSession for every
// session (gjc-bun-sdk-adapter.ts), which keys the AsyncJobManager endpoint as a
// JSON tuple. Workflow consumers must see the LOGICAL session id — a single
// path component — or deep-interview/ralplan state lands in a percent-encoded
// .gjc/_session-["async-job-endpoint",...] tree and ask fails with
// "session id must be a single path component". RED on runtime 0.15.6 (the
// pre-fix pin), GREEN once the pin carries the upstream fix.

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function materializeToolSession(session: { getToolByName(name: string): unknown; getAllToolNames(): string[] }): Promise<ToolSession> {
  const job = session.getToolByName('job') as { materializeForTests?: () => Promise<{ session?: ToolSession }> } | undefined;
  if (!job?.materializeForTests) throw new Error(`Job tool unavailable: ${session.getAllToolNames().join(', ')}`);
  const toolSession = (await job.materializeForTests()).session;
  if (!toolSession) throw new Error('Job tool exposed no tool session');
  return toolSession;
}

test('an app-shaped SDK session keeps workflow identity path-safe beside the async endpoint key', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gjc-app-workflow-identity-'));
  tempDirs.push(tempDir);
  const cwd = path.join(tempDir, 'project');
  const agentDir = path.join(tempDir, 'agent');
  fs.mkdirSync(cwd, { recursive: true });

  const sessionManager = SessionManager.create(cwd, SessionManager.managedDestination(cwd, agentDir));
  sessionManager.appendMessage({ role: 'user', content: 'persist transcript', timestamp: Date.now() });
  await sessionManager.flush();
  assert.ok(sessionManager.getSessionFile());

  // The adapter always passes an explicit providerSessionId; that is exactly
  // the input shape that produced the JSON-tuple endpoint key.
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    sessionManager,
    providerSessionId: sessionManager.getSessionId(),
    settings: Settings.isolated(),
    disableExtensionDiscovery: true,
    skills: [],
    contextFiles: [],
    promptTemplates: [],
    slashCommands: [],
    enableMCP: false,
    enableLsp: false,
    toolNames: ['job'],
  });

  try {
    const toolSession = await materializeToolSession(session);

    // Workflow/session identity: the logical id, safe as a single path component.
    const logicalId = toolSession.getSessionId?.();
    assert.equal(logicalId, sessionManager.getSessionId());
    assert.match(logicalId ?? '', /^[^/\\]+$/);

    // Async ownership keeps the opaque endpoint key on its own accessor.
    const endpointId = toolSession.getAsyncEndpointId?.();
    assert.equal(typeof endpointId, 'string');
    const endpointParts = JSON.parse(endpointId as string) as unknown[];
    assert.equal(endpointParts[0], 'async-job-endpoint');

    // Workflow state derives from the logical tree only.
    const statePath = deepInterviewStatePath(cwd, logicalId ?? undefined);
    assert.ok(statePath.startsWith(path.join(cwd, '.gjc', `_session-${logicalId}`) + path.sep));

    // And nothing in the project tree took the encoded-endpoint shape.
    const gjcDir = path.join(cwd, '.gjc');
    const entries = fs.existsSync(gjcDir) ? fs.readdirSync(gjcDir) : [];
    assert.deepEqual(entries.filter((entry) => entry.startsWith('_session-') && (entry.includes('[') || entry.includes('%5B'))), []);
  } finally {
    await session.dispose?.();
  }
});
