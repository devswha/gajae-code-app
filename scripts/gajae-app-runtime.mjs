#!/usr/bin/env node

if (process.platform !== 'linux' || process.arch !== 'x64' || process.versions.node.split('.')[0] !== '22') {
  console.error(
    `Gajae App server requires Linux x64 with Node.js 22; received ${process.platform} ${process.arch} Node.js ${process.versions.node}.`,
  );
  process.exit(1);
}

await import('../dist-server/server/cli.js');
