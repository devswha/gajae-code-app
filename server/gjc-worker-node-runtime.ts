import type { GjcWorkerRuntime } from './gjc-worker.js';

/** Node-only production runtime. Kept outside the Bun worker entrypoint graph. */
export async function loadNodeProductionRuntime(): Promise<GjcWorkerRuntime> {
  const [cli, bridge] = await Promise.all([
    import('./gjc-cli.js'),
    import('./gjc-sdk-bridge.js'),
  ]);
  return {
    spawnGjc: (message, options, writer) => cli.spawnGjcWithRuntime(message, options, writer, {
      detached: false,
      notifyRunStopped: () => {},
      notifyRunFailed: () => {},
    }) as ReturnType<GjcWorkerRuntime['spawnGjc']>,
    abortGjcSession: cli.abortGjcSession as GjcWorkerRuntime['abortGjcSession'],
    resolveGjcToolApproval: bridge.resolveGjcToolApproval as GjcWorkerRuntime['resolveGjcToolApproval'],
  };
}
