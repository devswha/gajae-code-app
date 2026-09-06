// This pipe belongs to the desktop parent. No TCP shutdown endpoint is exposed.
const { pathToFileURL } = require('node:url');
const entrypoint = process.argv[1];
let pending = '';
let stopping = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  pending += chunk;
  if (pending.length > 1024) process.exit(1);
  const lines = pending.split('\n');
  pending = lines.pop();
  for (const line of lines) {
    if (line !== 'gajae-desktop-shutdown' || stopping) continue;
    stopping = true;
    if (process.listenerCount('SIGTERM') > 0) process.emit('SIGTERM');
    else process.exit(0); // Startup has not installed the shutdown fence yet.
  }
});
import(pathToFileURL(entrypoint).href).catch((error) => {
  console.error(error);
  process.exit(1);
});
