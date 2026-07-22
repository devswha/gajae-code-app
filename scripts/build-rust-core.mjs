#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'native', 'gajae-core', 'Cargo.toml');
const outputDir = path.join(rootDir, 'dist-native');
const executableName = process.platform === 'win32' ? 'gajae-core.exe' : 'gajae-core';

const args = process.argv.slice(2);
const release = args.length === 1 && args[0] === '--release';
if (args.length > (release ? 1 : 0)) {
  throw new Error('Usage: node scripts/build-rust-core.mjs [--release]');
}

function runCargo(commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn('cargo', commandArgs, {
      cwd: rootDir,
      env: process.env,
      stdio: ['inherit', 'pipe', 'inherit'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`cargo exited with code ${code}`));
        return;
      }

      let executable;
      try {
        for (const line of output.split('\n')) {
          if (!line) continue;
          const message = JSON.parse(line);
          if (
            message.reason === 'compiler-artifact' &&
            message.target?.name === 'gajae-core' &&
            message.target?.kind?.includes('bin') &&
            message.executable
          ) {
            executable = message.executable;
          }
        }
      } catch (error) {
        reject(new Error('Cargo emitted invalid JSON build output.', { cause: error }));
        return;
      }
      if (!executable) {
        reject(new Error('Cargo did not report the gajae-core executable.'));
        return;
      }
      resolve(executable);
    });
  });
}

const cargoArgs = [
  'build',
  '--locked',
  '--message-format=json-render-diagnostics',
  '--manifest-path',
  manifestPath,
  ...(release ? ['--release'] : []),
];
const source = await runCargo(cargoArgs);

const profile = release ? 'release' : 'debug';
const destination = path.join(outputDir, executableName);
// Replace only the core executable; dist-native also hosts the bundled Bun
// runtime (scripts/fetch-bun.mjs), which a core rebuild must not delete.
await fs.rm(destination, { force: true });
await fs.mkdir(outputDir, { recursive: true });
await fs.copyFile(source, destination);
if (process.platform !== 'win32') await fs.chmod(destination, 0o755);
console.log(`Built ${path.relative(rootDir, destination)} (${profile})`);
