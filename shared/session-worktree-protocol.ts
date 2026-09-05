export type SessionLocation = { mode: 'project' | 'worktree'; cwd: string | null; projectPath: string; jobId: string | null };
type Writer = { send(value: unknown): void; setSessionId?(id: string): void; getAppSessionId?(): string | undefined; userId?: string | number | null };
export type SessionWorktreeRun = {
  abortHandle: string;
  readonly aborted: boolean;
  run(message: string, options: Record<string, unknown>, writer: Writer): Promise<void>;
  dispose(): void;
};
export type SessionWorktreeRuntime = {
  prepare(sessionId: string): SessionWorktreeRun | null;
  abort(handle: string): Promise<boolean | null>;
  workerHandle(handle: string): string | undefined;
};
