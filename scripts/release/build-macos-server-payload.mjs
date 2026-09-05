#!/usr/bin/env node
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error(`macOS payload requires darwin-arm64; received ${process.platform}-${process.arch}.`);
}
await import('./build-desktop-server-payload.mjs');
