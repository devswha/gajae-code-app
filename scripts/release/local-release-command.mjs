import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

// No shell, inherited stdin, credential arguments, or raw command-error output.
// Downloads use exclusive creation in a fresh temporary directory.
export async function releaseCommand(program, args, { output, timeout = 120_000 } = {}) {
  const fd = output ? openSync(output, 'wx', 0o600) : undefined;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(program, args, {
        stdio: ['ignore', fd ?? 'pipe', 'pipe'],
        env: { ...process.env, GH_PROMPT_DISABLED: '1' },
      });
      let stdout = '';
      let stderr = '';
      let failure;
      const timer = setTimeout(() => {
        failure = 'timed out';
        child.kill('SIGKILL');
      }, timeout);
      const collect = (stream, target) => {
        stream?.setEncoding('utf8');
        stream?.on('data', chunk => {
          if (target === 'stdout') stdout += chunk;
          else stderr += chunk;
          if (stdout.length + stderr.length > 8 * 1024 * 1024) {
            failure = 'exceeded the output limit';
            child.kill('SIGKILL');
          }
        });
      };
      collect(child.stdout, 'stdout');
      collect(child.stderr, 'stderr');
      child.on('error', () => { failure = 'could not start'; });
      child.on('close', code => {
        clearTimeout(timer);
        if (failure || code !== 0) reject(new Error(`${program} ${failure ?? `failed (exit ${code})`}; raw output suppressed.`));
        else resolve({ stdout, stderr });
      });
    });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
