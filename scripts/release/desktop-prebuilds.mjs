import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

// Packages such as bare-fs publish Android, iOS, Linux and macOS binaries in
// one tarball. linuxdeploy inspects every ELF in an AppDir, including Android
// binaries it cannot resolve with the host's ldd. Keep only host prebuilds.
// npm may also install both glibc and musl optional packages; the desktop
// target is glibc, so musl-only packages cannot be part of its native closure.
export async function pruneForeignPrebuilds(directory, platform = process.platform, arch = process.arch) {
  const removed = [];
  const host = `${platform}-${arch}`;
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(current, entry.name);
      const packageDirectory = path.basename(current) === 'node_modules'
        || (path.basename(current).startsWith('@') && path.basename(path.dirname(current)) === 'node_modules');
      let muslOnly = false;
      if (platform === 'linux' && packageDirectory) {
        try {
          const { libc } = JSON.parse(await readFile(path.join(candidate, 'package.json'), 'utf8'));
          muslOnly = Array.isArray(libc) && libc.includes('musl') && !libc.includes('glibc');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      if (muslOnly || (path.basename(current) === 'prebuilds'
        && /^(?:android|darwin|ios|linux|win32|freebsd|openbsd)-/.test(entry.name)
        && entry.name !== host)) {
        await rm(candidate, { recursive: true });
        removed.push(path.relative(directory, candidate));
      } else await visit(candidate);
    }
  }
  await visit(directory);
  return removed.sort();
}
