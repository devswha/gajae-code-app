import { existsSync } from 'node:fs';
import path from 'node:path';

// Execute npm's JS entrypoint with Node. Windows cannot execFile/spawn a
// .cmd file without cmd.exe, which also changes quoting and argument handling.
export function npmInvocation(args, {
  env = process.env,
  platform = process.platform,
  execPath = process.execPath,
  exists = existsSync,
} = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const candidates = [
    env.npm_execpath,
    paths.join(paths.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    paths.resolve(paths.dirname(execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const cli = candidates.find(candidate => candidate
    && paths.basename(candidate) === 'npm-cli.js' && exists(candidate));
  if (cli) return { command: execPath, args: [cli, ...args] };
  if (platform !== 'win32') return { command: 'npm', args };
  throw new Error('Could not locate npm-cli.js. Install Node.js with npm, or run this command through npm run.');
}
