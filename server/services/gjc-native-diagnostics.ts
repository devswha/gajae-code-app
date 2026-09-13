/**
 * Bounded, privacy-safe evidence for the native (gajae-core) client.
 *
 * `GjcNativeClient` collapses every spawn, exit, readiness-timeout and
 * protocol fault into one generic `GJC native client is unavailable.`
 * message. That message is load-bearing — `GjcJobsClient.request` matches it
 * exactly to classify `authority_unavailable` — so it must not change. This
 * recorder preserves the evidence the message erases, without altering it.
 *
 * Records are in-memory only, bounded in count, and restricted to a closed
 * stage vocabulary plus enumerated details (exit code, signal, errno, byte
 * counts, elapsed ms). Free text is admitted only from the native binary's
 * own stderr, and only after path redaction, so a panic message stays
 * readable while filesystem layout does not leak.
 */

/** Closed stage vocabulary. Never built from input. */
export const NATIVE_STAGES = [
  'spawn',
  'spawn_failed',
  'ready',
  'ready_timeout',
  'exit',
  'protocol_error',
  'stderr',
  'restart_scheduled',
  'closed',
] as const;
export type NativeStage = (typeof NATIVE_STAGES)[number];

export type NativeEvidence = {
  stage: NativeStage;
  command: 'git' | 'jobs';
  /** Client-local spawn counter: which native process this describes. */
  generation: number;
  /** Milliseconds since the client was constructed. */
  atMs: number;
  /** Enumerated, non-identifying detail. Never user content. */
  detail?: string;
};

const FAILURE_STAGES: readonly NativeStage[] = ['spawn_failed', 'ready_timeout', 'protocol_error', 'exit'];
const isFailure = (stage: NativeStage): boolean => FAILURE_STAGES.includes(stage);

const MAX_EVENTS = 32;
const MAX_DETAIL = 200;
/** Absolute POSIX/Windows paths, reduced to a fixed placeholder. */
const ABSOLUTE_PATH = /(?:[A-Za-z]:)?(?:\/|\\\\)(?:[\w.@+-]+(?:\/|\\\\)){1,}[\w.@+-]*/gu;

/**
 * Replace absolute filesystem paths with `<path>`. The native binary's stderr
 * is our own diagnostic output, but it can embed a workdir or database path;
 * the surrounding message is what identifies the fault, not the location.
 */
export function redactPaths(text: string): string {
  return text.replace(ABSOLUTE_PATH, '<path>');
}

/** Reduce a spawn/stream error to its errno-style code, never its message. */
export function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,31}$/u.test(code)) return code;
  if (error instanceof Error && error.name && error.name !== 'Error') return error.name;
  return 'unknown';
}

/** Bounded ring of native-client evidence for one client instance. */
export class NativeDiagnostics {
  private readonly events: NativeEvidence[] = [];
  private readonly started = Date.now();

  constructor(private readonly command: 'git' | 'jobs') {}

  record(stage: NativeStage, generation: number, detail?: string): void {
    const event: NativeEvidence = {
      stage,
      command: this.command,
      generation,
      atMs: Date.now() - this.started,
    };
    if (detail !== undefined) event.detail = redactPaths(detail).slice(0, MAX_DETAIL);
    this.events.push(event);
    // Keep the newest evidence: a failure is explained by its latest
    // generation, and an old healthy spawn must not push it out.
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  snapshot(): NativeEvidence[] {
    return this.events.map((event) => ({ ...event }));
  }

  /** Fixed summary category for the most recent failure, if any. */
  category(): NativeStage | 'none' {
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const { stage } = this.events[index];
      if (isFailure(stage)) return stage;
    }
    return 'none';
  }

  /** Whether this generation already has a more specific failure recorded. */
  hasFailure(generation: number): boolean {
    return this.events.some((event) => event.generation === generation && isFailure(event.stage));
  }
}

/**
 * Carries native-client evidence without changing the generic message.
 * `message` stays byte-identical to the historical failure string so existing
 * equality-based classification keeps working.
 */
export class GjcNativeUnavailableError extends Error {
  readonly category: NativeStage | 'none';
  readonly evidence: NativeEvidence[];
  constructor(message: string, diagnostics?: NativeDiagnostics) {
    super(message);
    this.name = 'GjcNativeUnavailableError';
    this.category = diagnostics?.category() ?? 'none';
    this.evidence = diagnostics?.snapshot() ?? [];
  }
}
