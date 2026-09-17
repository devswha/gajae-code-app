/**
 * The environment a child process is allowed to see.
 *
 * The server holds credentials that authorize its own API: the desktop shell
 * injects `GJC_DESKTOP_API_KEY` and the bootstrap nonce into the sidecar, and a
 * self-hosted deployment may set `API_KEY`. Everything the server starts -
 * the GJC worker (which runs the agent's `bash`), the user's terminal, `git` -
 * inherits `process.env` verbatim, so `env` in a chat turn, a crash report or
 * `/proc/<pid>/environ` hands those values to anything the agent or the user
 * runs. A local process that learns the key can then call the loopback API as
 * the owner.
 *
 * Children never need them: desktop-privileged calls are made by the server
 * itself. Strip by name rather than allowlisting the whole environment, because
 * the worker, the shell and git legitimately need the user's PATH, HOME,
 * locale, proxy and toolchain variables, and an allowlist here would silently
 * break them.
 */
export const SERVER_ONLY_ENVIRONMENT_NAMES: readonly string[] = [
  'GJC_DESKTOP_API_KEY',
  'GJC_DESKTOP_BOOTSTRAP_NONCE',
  'API_KEY',
];

/** `source` without the values that authenticate a caller to this server. */
export function childEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...source };
  for (const name of SERVER_ONLY_ENVIRONMENT_NAMES) delete environment[name];
  return environment;
}
