#!/usr/bin/env node
if (process.platform !== 'linux' || process.arch !== 'x64' || !process.report.getReport().header.glibcVersionRuntime) {
  throw new Error(`Linux payload requires linux-x64 with glibc; received ${process.platform}-${process.arch}.`);
}
await import('./build-desktop-server-payload.mjs');
