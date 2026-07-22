import os from 'node:os';
import path from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import crossSpawn from 'cross-spawn';

import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { createCompleteMessage, createNormalizedMessage } from './shared/utils.js';
import { attachGjcSdkBridge } from './gjc-sdk-bridge.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else. Mirrors opencode-cli.js.
const spawnFunction = crossSpawn;

const PROVIDER = 'gjc';

// Stable run-handle and provider-session id aliases -> child process. A fresh
// run is registered by handle before its NDJSON header reveals the provider id.
const activeGjcProcesses = new Map();
const MAX_PROMPT_BYTES = 10 * 1024 * 1024;
const MAX_NDJSON_LINE_BYTES = 32 * 1024 * 1024;
const ABORT_GRACE_PERIOD_MS = 5000;
const SDK_USAGE_FLUSH_GRACE_MS = 100;
const SDK_ABORT_TIMEOUT_MS = 1000;
const SDK_BRIDGE_CLOSE_GRACE_MS = 500;
const PROVIDER_PROBE_GRACE_MS = 500;

async function settleWithin(operation, timeoutMs, fallback) {
  let timeout;
  const timedOut = new Promise((resolve) => {
    timeout = setTimeout(() => resolve(fallback), timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(operation).catch(() => fallback),
      timedOut,
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Adds a process under a stable run key or provider-session alias. The caller
 * owns the Map, which keeps this lifecycle behavior testable without spawning.
 */
export function registerGjcProcessAlias(processes, sessionKey, gjcProcess) {
  if (!sessionKey || !gjcProcess) {
    return;
  }

  const sessionKeys = gjcProcess.gjcSessionKeys || new Set();
  sessionKeys.add(sessionKey);
  gjcProcess.gjcSessionKeys = sessionKeys;
  processes.set(sessionKey, gjcProcess);
}

function removeGjcProcessAliases(processes, gjcProcess) {
  for (const sessionKey of gjcProcess.gjcSessionKeys || []) {
    if (processes.get(sessionKey) === gjcProcess) {
      processes.delete(sessionKey);
    }
  }
}

/**
 * Sends a signal to the whole detached process group where supported. On
 * Windows, Node cannot signal a POSIX process group, so retain child.kill().
 */
function signalGjcProcess(gjcProcess, signal) {
  try {
    if (
      gjcProcess.gjcDetachedProcessGroup !== false
      && process.platform !== 'win32'
      && Number.isInteger(gjcProcess.pid)
      && gjcProcess.pid > 0
    ) {
      return process.kill(-gjcProcess.pid, signal);
    }

    return gjcProcess.kill(signal) === true;
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      console.warn(`[gjc] Failed to send ${signal}:`, error);
    }
    return false;
  }
}

// Default scratch directory for session storage. Passing `--session-dir` keeps
// live runs from writing into the real `~/.gjc/agent/sessions` store; auth and
// config are still read from the real home (we deliberately do NOT set
// GJC_CODING_AGENT_DIR, which would isolate credentials too and break the
// default model).
const DEFAULT_SESSION_DIR = path.join(os.tmpdir(), 'gjc-live-sessions');

/**
 * Builds the gjc prompt argv token. Prompts are always written to a private
 * temp file so they never appear in the process list or get parsed as flags.
 * Returns the `@file` argv token and the temp file to clean up.
 */
export function buildPromptArg(message, tmpDir = os.tmpdir()) {
  const promptText = String(message ?? '');
  if (Buffer.byteLength(promptText, 'utf8') > MAX_PROMPT_BYTES) {
    throw new RangeError(`gjc prompt exceeds the ${MAX_PROMPT_BYTES}-byte limit`);
  }

  const tempFile = path.join(tmpDir, `gjc-prompt-${randomUUID()}.txt`);
  // 0600: prompts can carry sensitive text and os.tmpdir() is world-readable.
  writeFileSync(tempFile, promptText, { encoding: 'utf8', mode: 0o600 });
  return { arg: `@${tempFile}`, tempFile };
}

/**
 * Reads the gjc session id from the NDJSON header event.
 *
 * gjc puts the session id at the top level of the `session` event
 * (`{ type: 'session', id, cwd, timestamp }`) — unlike per-message events whose
 * `id` is an entry id, so this must only be called for the header event.
 */
function readGjcSessionId(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  return event.id || event.sessionId || event.sessionID || null;
}

/**
 * Normalizes a gjc `message.content` field into an array of content parts.
 */
function normalizeGjcContent(content) {
  if (Array.isArray(content)) {
    return content;
  }
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return [];
}

/**
 * Reads the textual body of a gjc `text`/`thinking` content part. gjc uses
 * `thinking` for reasoning parts, but history/older builds use `text`; accept
 * either (matches the read-only gjc-sessions provider).
 */
function readGjcPartText(part) {
  if (typeof part.text === 'string') {
    return part.text;
  }
  if (typeof part.thinking === 'string') {
    return part.thinking;
  }
  return '';
}

/**
 * Flattens a gjc tool-result payload (string, content-part array, or object)
 * into a display string.
 */
function stringifyGjcToolOutput(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (entry && typeof entry === 'object' && typeof entry.text === 'string') {
          return entry.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Spawns `gjc -p --mode json` for a single non-interactive run and streams its
 * NDJSON output to the writer as normalized messages. The returned promise
 * exposes `abortHandle` and the owned `processId` immediately so the worker can
 * correlate cancellation and the supervisor can clean up a crashed process tree.
 *
 * Mirrors spawnOpenCode: same Map-based lifecycle, stdout line buffering,
 * session-created handshake, terminal `complete`, and error handling. The
 * gjc-specific bits are the argv/stdin contract and the NDJSON event mapping.
 */
export function spawnGjcWithRuntime(message, options = {}, writer, runtime = {}) {
  const processKey = options.runHandle || options.sessionId || randomUUID();
  let processId;
  const runPromise = new Promise((resolve, reject) => {
    const { sessionId, projectPath, cwd, model, sessionDir, sessionSummary } = options;
    const workingDir = cwd || projectPath || process.cwd();
    const resolvedSessionDir = sessionDir || DEFAULT_SESSION_DIR;

    let capturedSessionId = sessionId || null;
    let sessionCreatedSent = false;
    let stdoutLineBuffers = [];
    let stdoutLineBufferLength = 0;
    let discardingOversizedStdoutLine = false;
    let terminalNotificationSent = false;
    let completeSent = false;
    let terminalPromise = null;
    let gjcProcess = null;
    let sdkBridge = null;
    let sdkBridgeSessionId = null;
    let sdkAttachSessionId = null;
    let sdkAttachGeneration = 0;
    let sdkUsagePromise = null;

    const {
      spawn = spawnFunction,
      attachSdkBridge: attachBridge = attachGjcSdkBridge,
      isProviderInstalled = providerAuthService.isProviderInstalled.bind(providerAuthService),
      notifyRunFailed: notifyFailed = notifyRunFailed,
      notifyRunStopped: notifyStopped = notifyRunStopped,
      detached = true,
      sdkUsageFlushGraceMs = SDK_USAGE_FLUSH_GRACE_MS,
      sdkBridgeCloseGraceMs = SDK_BRIDGE_CLOSE_GRACE_MS,
      providerProbeGraceMs = PROVIDER_PROBE_GRACE_MS,
    } = runtime;
    // Assistant text arrives as monotonically growing snapshots (gjc emits the
    // accumulated partial message on every streaming update). The frontend
    // `stream_delta` contract expects *deltas* that it appends, so we track how
    // much text has been emitted and forward only the new suffix.
    let streamedText = '';
    let streamActive = false;
    // Dedupe non-streamed emissions (thinking / tool_use / tool_result / error),
    // which repeat across message_end and turn_end for the same logical message.
    const emittedKeys = new Set();

    const sendNormalized = (fields) => {
      writer.send(createNormalizedMessage({
        sessionId: capturedSessionId || sessionId || null,
        provider: PROVIDER,
        ...fields,
      }));
    };
    const closeSdkBridge = async ({ flushUsage = false } = {}) => {
      sdkAttachGeneration += 1;
      sdkAttachSessionId = null;
      const bridge = sdkBridge;
      sdkBridge = null;
      sdkBridgeSessionId = null;
      if (gjcProcess?.gjcSdkBridge === bridge) {
        gjcProcess.gjcSdkBridge = null;
      }
      if (!bridge) {
        return;
      }

      if (flushUsage && sdkUsagePromise) {
        await settleWithin(
          () => sdkUsagePromise,
          sdkUsageFlushGraceMs,
          undefined,
        );
      }
      await settleWithin(
        () => bridge.close(),
        sdkBridgeCloseGraceMs,
        undefined,
      );
    };

    const attachSdkBridge = (nextSessionId) => {
      if (!nextSessionId || gjcProcess?.hasClosed) {
        return;
      }
      if (
        (sdkBridge && sdkBridgeSessionId === nextSessionId)
        || sdkAttachSessionId === nextSessionId
      ) {
        return;
      }

      const generation = ++sdkAttachGeneration;
      sdkAttachSessionId = nextSessionId;
      if (sdkBridge) {
        const previousBridge = sdkBridge;
        sdkBridge = null;
        sdkBridgeSessionId = null;
        if (gjcProcess?.gjcSdkBridge === previousBridge) {
          gjcProcess.gjcSdkBridge = null;
        }
        void previousBridge.close().catch(() => {});
      }

      void attachBridge({
        cwd: workingDir,
        sessionId: nextSessionId,
        writer,
      }).then(async (bridge) => {
        if (!bridge) {
          return;
        }
        if (
          generation !== sdkAttachGeneration
          || gjcProcess?.hasClosed
          || capturedSessionId !== nextSessionId
        ) {
          await bridge.close();
          return;
        }

        sdkBridge = bridge;
        sdkBridgeSessionId = nextSessionId;
        if (gjcProcess) {
          gjcProcess.gjcSdkBridge = bridge;
        }
      }).catch(() => {
        // SDK v3 is optional; keep the existing NDJSON-only path fail-soft.
      }).finally(() => {
        if (generation === sdkAttachGeneration) {
          sdkAttachSessionId = null;
        }
      });
    };

    const emitOnce = (key, emit) => {
      if (emittedKeys.has(key)) {
        return;
      }
      emittedKeys.add(key);
      emit();
    };

    const notifyTerminalState = ({ code = null, error = null } = {}) => {
      if (terminalNotificationSent) {
        return;
      }

      terminalNotificationSent = true;
      const finalSessionId = capturedSessionId || sessionId || processKey;
      if (code === 0 && !error) {
        notifyStopped({
          userId: writer?.userId || null,
          provider: PROVIDER,
          sessionId: finalSessionId,
          sessionName: sessionSummary,
          stopReason: 'completed',
        });
        return;
      }

      notifyFailed({
        userId: writer?.userId || null,
        provider: PROVIDER,
        sessionId: finalSessionId,
        sessionName: sessionSummary,
        error: error || `gjc CLI exited with code ${code}`,
      });
    };

    const registerSession = (nextSessionId) => {
      if (!nextSessionId) {
        return;
      }
      if (capturedSessionId === nextSessionId) {
        attachSdkBridge(nextSessionId);
        return;
      }

      capturedSessionId = nextSessionId;
      if (gjcProcess) {
        registerGjcProcessAlias(activeGjcProcesses, capturedSessionId, gjcProcess);
        gjcProcess.sessionId = capturedSessionId;
      }

      if (writer.setSessionId && typeof writer.setSessionId === 'function') {
        writer.setSessionId(capturedSessionId);
      }

      if (!sessionId && !sessionCreatedSent) {
        sessionCreatedSent = true;
        writer.send(createNormalizedMessage({
          kind: 'session_created',
          newSessionId: capturedSessionId,
          sessionId: capturedSessionId,
          provider: PROVIDER,
        }));
      }

      attachSdkBridge(capturedSessionId);
    };

    const finalizeStream = () => {
      if (streamActive) {
        sendNormalized({ kind: 'stream_end' });
        streamActive = false;
      }
    };

    // Emit the new suffix of the accumulated assistant text as a stream_delta.
    // A fresh stream starts whenever no stream is currently open, so each
    // assistant turn accumulates independently.
    const streamAssistantText = (content) => {
      if (!streamActive) {
        streamedText = '';
      }

      const fullText = content
        .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('');

      if (fullText.length > streamedText.length && fullText.startsWith(streamedText)) {
        const delta = fullText.slice(streamedText.length);
        streamedText = fullText;
        streamActive = true;
        sendNormalized({ kind: 'stream_delta', content: delta });
      }
    };

    const emitGjcAssistantError = (msg) => {
      const detail = typeof msg.errorMessage === 'string' && msg.errorMessage.trim()
        ? msg.errorMessage.trim()
        : 'gjc run failed';
      const status = typeof msg.errorStatus === 'number' ? ` (status ${msg.errorStatus})` : '';
      emitOnce(`error:${detail}${status}`, () => {
        sendNormalized({ kind: 'error', content: `${detail}${status}` });
      });
    };

    const emitGjcToolCallPart = (part) => {
      const toolId = part.id || part.toolCallId || part.callId || '';
      const toolInput = part.arguments ?? part.toolInput ?? part.input;
      const key = `tool_use:${toolId || stringifyGjcToolOutput(toolInput)}`;
      emitOnce(key, () => {
        sendNormalized({
          kind: 'tool_use',
          toolName: part.name || part.toolName || 'Unknown',
          toolInput,
          toolId,
        });
      });
    };

    const emitGjcToolResult = (toolId, output, isError) => {
      emitOnce(`tool_result:${toolId}`, () => {
        sendNormalized({
          kind: 'tool_result',
          toolId,
          content: stringifyGjcToolOutput(output),
          isError: Boolean(isError),
        });
      });
    };

    // A gjc tool result arrives as its own message (role: 'toolResult'). The
    // output lives on the message content; history/older builds fold it into a
    // `toolResult` content part — handle both.
    const emitGjcToolResultMessage = (msg) => {
      const parts = normalizeGjcContent(msg.content);
      const resultPart = parts.find((part) => part && part.type === 'toolResult');
      if (resultPart) {
        const toolId = msg.toolCallId || resultPart.toolCallId || resultPart.id || resultPart.callId || '';
        emitGjcToolResult(
          toolId,
          resultPart.output ?? resultPart.content ?? resultPart.result,
          msg.isError || resultPart.isError,
        );
        return;
      }

      const toolId = msg.toolCallId || msg.toolId || '';
      emitGjcToolResult(toolId, msg.content, msg.isError);
    };

    const handleGjcMessage = (msg, { streamText, final }) => {
      if (!msg || typeof msg !== 'object') {
        return;
      }

      // Volatile/custom context messages (e.g. project-context injections) are
      // flagged display:false and must not surface in the chat transcript.
      if (msg.display === false) {
        return;
      }

      const role = typeof msg.role === 'string' ? msg.role : 'assistant';

      // User prompts are echoed optimistically by the client; internal roles
      // (custom, developer, hookMessage, ...) are not chat content.
      if (role !== 'assistant' && role !== 'toolResult') {
        return;
      }

      if (role === 'toolResult') {
        if (final) {
          emitGjcToolResultMessage(msg);
        }
        return;
      }

      // role === 'assistant'
      if (msg.stopReason === 'aborted') {
        // The websocket abort handler emits the terminal complete on this run's
        // behalf; just close any open stream.
        if (final) {
          finalizeStream();
        }
        return;
      }

      const content = normalizeGjcContent(msg.content);

      if (streamText && msg.stopReason !== 'error') {
        streamAssistantText(content);
      }

      if (!final) {
        return;
      }

      finalizeStream();

      if (msg.stopReason === 'error') {
        emitGjcAssistantError(msg);
        return;
      }

      for (const part of content) {
        if (!part || typeof part !== 'object') {
          continue;
        }
        if (part.type === 'thinking') {
          const text = readGjcPartText(part);
          if (text.trim()) {
            emitOnce(`thinking:${text}`, () => {
              sendNormalized({ kind: 'thinking', content: text });
            });
          }
        } else if (part.type === 'toolCall') {
          emitGjcToolCallPart(part);
        } else if (part.type === 'toolResult') {
          // Defensive: some builds fold tool output into an assistant content part.
          const toolId = part.toolCallId || part.id || part.callId || '';
          emitGjcToolResult(toolId, part.output ?? part.content ?? part.result, part.isError);
        }
      }
    };

    const processGjcOutputLine = (line) => {
      if (!line || !line.trim()) {
        return;
      }

      let event;
      try {
        event = JSON.parse(line);
      } catch {
        // Malformed / partial NDJSON line — skip it (do not surface to the UI).
        return;
      }

      if (!event || typeof event !== 'object') {
        return;
      }

      switch (event.type) {
        case 'session':
          registerSession(readGjcSessionId(event));
          return;
        case 'message_start':
        case 'message_update':
          handleGjcMessage(event.message, { streamText: true, final: false });
          return;
        case 'message_end':
          handleGjcMessage(event.message, { streamText: true, final: true });
          return;
        case 'turn_end':
          // message_end already streamed/finalized this turn's assistant text;
          // turn_end carries the same message, so only reconcile discrete parts.
          handleGjcMessage(event.message, { streamText: false, final: true });
          return;
        case 'agent_end': {
          // Crash paths surface the failing assistant message only via agent_end.
          const messages = Array.isArray(event.messages) ? event.messages : [];
          for (const finalMessage of messages) {
            if (
              finalMessage
              && typeof finalMessage === 'object'
              && finalMessage.role === 'assistant'
              && finalMessage.stopReason === 'error'
            ) {
              emitGjcAssistantError(finalMessage);
            }
          }
          if (sdkBridge && !sdkUsagePromise) {
            sdkUsagePromise = sdkBridge.emitTokenBudget();
          }
          return;
        }
        default:
          // agent_start, turn_start, tool_execution_*, model_change, custom, ...
          // carry no directly renderable content.
          return;
      }
    };

    let promptTempFile = null;
    const cleanupPromptTempFile = () => {
      if (promptTempFile) {
        try {
          unlinkSync(promptTempFile);
        } catch {
          // Best-effort cleanup; the OS temp-file cleaner is the last fallback.
        }
        promptTempFile = null;
      }
    };

    const discardOversizedStdoutLine = () => {
      stdoutLineBuffers = [];
      stdoutLineBufferLength = 0;
      sendNormalized({
        kind: 'error',
        content: 'gjc output line exceeded the 32 MB limit and was discarded.',
      });
    };

    const flushStdoutLineBuffer = () => {
      if (discardingOversizedStdoutLine || stdoutLineBufferLength === 0) {
        stdoutLineBuffers = [];
        stdoutLineBufferLength = 0;
        return;
      }

      const line = Buffer.concat(stdoutLineBuffers, stdoutLineBufferLength).toString('utf8').trim();
      stdoutLineBuffers = [];
      stdoutLineBufferLength = 0;
      processGjcOutputLine(line);
    };

    const handleStdoutChunk = (data) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      let offset = 0;

      while (offset < chunk.length) {
        const newlineIndex = chunk.indexOf(0x0a, offset);
        const hasNewline = newlineIndex !== -1;
        const segmentEnd = hasNewline ? newlineIndex : chunk.length;
        const segment = chunk.subarray(offset, segmentEnd);

        if (discardingOversizedStdoutLine) {
          if (hasNewline) {
            discardingOversizedStdoutLine = false;
          }
        } else if (stdoutLineBufferLength + segment.length > MAX_NDJSON_LINE_BYTES) {
          discardOversizedStdoutLine();
          discardingOversizedStdoutLine = !hasNewline;
        } else if (hasNewline) {
          const line = stdoutLineBufferLength === 0
            ? segment.toString('utf8').trim()
            : Buffer.concat([...stdoutLineBuffers, segment], stdoutLineBufferLength + segment.length)
              .toString('utf8')
              .trim();
          stdoutLineBuffers = [];
          stdoutLineBufferLength = 0;
          processGjcOutputLine(line);
        } else if (segment.length > 0) {
          stdoutLineBuffers.push(Buffer.from(segment));
          stdoutLineBufferLength += segment.length;
        }

        if (!hasNewline) {
          return;
        }
        offset = newlineIndex + 1;
      }
    };

    const args = ['-p', '--mode', 'json', '--session-dir', resolvedSessionDir];
    if (sessionId) {
      args.push('-r', sessionId);
    }
    if (model) {
      args.push('--model', model);
    }
    const builtPrompt = buildPromptArg(message);
    promptTempFile = builtPrompt.tempFile;
    args.push(builtPrompt.arg);

    try {
      gjcProcess = spawn('gjc', args, {
        cwd: workingDir,
        detached,
        stdio: ['pipe', 'pipe', 'pipe'],
        // GJC_NOTIFICATIONS=0 is an authoritative opt-out for the ephemeral harness.
        env: { ...process.env, GJC_NOTIFICATIONS: '0' },
      });
    } catch (error) {
      cleanupPromptTempFile();
      reject(error);
      return;
    }

    processId = gjcProcess.pid;
    registerGjcProcessAlias(activeGjcProcesses, processKey, gjcProcess);
    gjcProcess.sessionId = processKey;
    gjcProcess.gjcDetachedProcessGroup = detached;
    if (capturedSessionId) {
      attachSdkBridge(capturedSessionId);
    }

    // Prompt is passed by `@file` (gjc -p ignores piped stdin), so close stdin
    // right away so gjc does not block waiting on it.
    if (gjcProcess.stdin) {
      gjcProcess.stdin.on('error', () => {});
      gjcProcess.stdin.end();
    }

    gjcProcess.stdout.on('data', handleStdoutChunk);

    gjcProcess.stderr.on('data', (data) => {
      const stderrText = data.toString();
      if (!stderrText.trim()) {
        return;
      }

      // gjc uses stderr for diagnostics; real run failures come through stdout
      // as `stopReason: 'error'`. Log, don't surface as chat errors.
      console.error(`[gjc] ${stderrText.trimEnd()}`);
    });

    const settleProcess = ({ code = null, error = null } = {}) => {
      if (terminalPromise) {
        return terminalPromise;
      }

      gjcProcess.hasClosed = true;
      terminalPromise = (async () => {
        const finalSessionId = capturedSessionId || sessionId || processKey;
        if (gjcProcess.gjcAbortEscalationTimer) {
          clearTimeout(gjcProcess.gjcAbortEscalationTimer);
          gjcProcess.gjcAbortEscalationTimer = null;
        }
        removeGjcProcessAliases(activeGjcProcesses, gjcProcess);
        cleanupPromptTempFile();
        flushStdoutLineBuffer();
        await closeSdkBridge({ flushUsage: true });

        // Every usage/error event must precede the single terminal completion.
        finalizeStream();
        const suppressTerminal = gjcProcess.aborted || gjcProcess.abortPending;
        if (!suppressTerminal) {
          let errorContent = null;
          if (error) {
            const installed = await settleWithin(
              () => isProviderInstalled(PROVIDER),
              providerProbeGraceMs,
              true,
            );
            errorContent = installed
              ? error.message
              : 'gjc CLI is not installed. Ensure the `gjc` command is available on PATH.';
          } else if (code === 127 || code === null) {
            const installed = await settleWithin(
              () => isProviderInstalled(PROVIDER),
              providerProbeGraceMs,
              true,
            );
            if (!installed) {
              errorContent = 'gjc CLI is not installed. Ensure the `gjc` command is available on PATH.';
            }
          }

          if (errorContent) {
            writer.send(createNormalizedMessage({
              kind: 'error',
              content: errorContent,
              sessionId: finalSessionId,
              provider: PROVIDER,
            }));
          }
          if (!completeSent) {
            completeSent = true;
            writer.send(createCompleteMessage({
              provider: PROVIDER,
              sessionId: finalSessionId,
              exitCode: error ? 1 : code,
            }));
          }
        }

        try {
          notifyTerminalState({ code, error });
        } catch {
          // Notification failures cannot prevent run settlement.
        }
        if (!error && code === 0) {
          resolve();
          return;
        }
        reject(error || new Error(
          code === null
            ? 'gjc CLI process was terminated'
            : `gjc CLI exited with code ${code}`,
        ));
      })();
      return terminalPromise;
    };

    gjcProcess.on('close', (code) => {
      void settleProcess({ code });
    });
    gjcProcess.on('error', (error) => {
      void settleProcess({ error });
    });
  });
  return Object.assign(runPromise, { abortHandle: processKey, processId });
}

function spawnGjc(message, options = {}, writer) {
  return spawnGjcWithRuntime(message, options, writer);
}
function scheduleGjcAbortEscalation(gjcProcess) {
  if (gjcProcess.hasClosed || gjcProcess.gjcAbortEscalationTimer) {
    return;
  }

  const escalationTimer = setTimeout(() => {
    gjcProcess.gjcAbortEscalationTimer = null;
    const killed = signalGjcProcess(gjcProcess, 'SIGKILL');
    if (!killed && !gjcProcess.hasClosed) {
      console.warn('[gjc] Failed to force-stop aborted process group');
    }
  }, ABORT_GRACE_PERIOD_MS);
  escalationTimer.unref?.();
  gjcProcess.gjcAbortEscalationTimer = escalationTimer;
}

function abortGjcWithSignal(gjcProcess) {
  if (!signalGjcProcess(gjcProcess, 'SIGTERM')) {
    return false;
  }

  gjcProcess.aborted = true;
  gjcProcess.abortPending = false;
  scheduleGjcAbortEscalation(gjcProcess);
  return true;
}

async function abortGjcWithSdk(gjcProcess) {
  const bridge = gjcProcess.gjcSdkBridge;
  if (!bridge) {
    return false;
  }

  const configuredTimeout = gjcProcess.gjcSdkAbortTimeoutMs;
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 0
    ? configuredTimeout
    : SDK_ABORT_TIMEOUT_MS;
  let abortResult;
  try {
    abortResult = bridge.abort();
  } catch {
    return false;
  }
  let timeout;
  const timedOut = new Promise((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve(abortResult)
        .then(Boolean)
        .catch(() => false),
      timedOut,
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
function abortGjcProcess(gjcProcess) {
  if (gjcProcess.aborted) {
    return Promise.resolve(true);
  }
  if (gjcProcess.gjcAbortPromise) {
    return gjcProcess.gjcAbortPromise;
  }

  // Mark the request before awaiting the SDK so a concurrent child close cannot
  // emit a non-aborted terminal frame. The websocket handler owns that terminal.
  gjcProcess.abortPending = true;
  const attemptPromise = (async () => {
    if (await abortGjcWithSdk(gjcProcess)) {
      gjcProcess.aborted = true;
      scheduleGjcAbortEscalation(gjcProcess);
      return true;
    }

    if (gjcProcess.hasClosed) {
      gjcProcess.aborted = true;
      return true;
    }
    return abortGjcWithSignal(gjcProcess);
  })();
  const abortPromise = attemptPromise.finally(() => {
    gjcProcess.abortPending = false;
    if (gjcProcess.gjcAbortPromise === abortPromise) {
      gjcProcess.gjcAbortPromise = null;
    }
  });

  gjcProcess.gjcAbortPromise = abortPromise;
  return abortPromise;
}

async function abortGjcSession(sessionId) {
  const gjcProcess = activeGjcProcesses.get(sessionId);
  return gjcProcess ? abortGjcProcess(gjcProcess) : false;
}

function isGjcSessionActive(sessionId) {
  return activeGjcProcesses.has(sessionId);
}

function getActiveGjcSessions() {
  return Array.from(activeGjcProcesses.keys());
}

export {
  spawnGjc,
  abortGjcSession,
  abortGjcProcess,
  isGjcSessionActive,
  getActiveGjcSessions,
};
