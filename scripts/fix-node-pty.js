#!/usr/bin/env node
import { promises as filesystem } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const nodePtyPrebuilds = join(scriptDirectory, '..', 'node_modules', 'node-pty', 'prebuilds');
const macosArchitectures = ['darwin-arm64', 'darwin-x64'];

async function makeSpawnHelperExecutable(directory) {
  const helper = join(nodePtyPrebuilds, directory, 'spawn-helper');
  try {
    await filesystem.access(helper);
    await filesystem.chmod(helper, 0o755);
    console.log(`[postinstall] Fixed permissions for ${helper}`);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    console.warn(`[postinstall] Warning: Could not fix ${helper}: ${error.message}`);
  }
}

async function repairMacosHelpers() {
  if (process.platform !== 'darwin') return;
  for (const architecture of macosArchitectures) {
    await makeSpawnHelperExecutable(architecture);
  }
}

repairMacosHelpers().catch(console.error);
