import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The writable copy catches resource seals that fail after Finder installs
// an app. A failed attach may still have mounted the image before reporting
// its error, so only confirmed detachment permits recursive cleanup.
export function verifyCopiedFromImage(imagePath, appName, {
  run, temporaryRoot = tmpdir(),
}) {
  const directory = mkdtempSync(join(temporaryRoot, 'gajae-dmg-check-'));
  const mountPoint = join(directory, 'mount');
  const copyRoot = join(directory, 'copy');
  let attachAttempted = false;
  let detached = false;
  try {
    mkdirSync(mountPoint);
    mkdirSync(copyRoot);
    let verificationError;
    try {
      attachAttempted = true;
      run('hdiutil', ['attach', imagePath, '-nobrowse', '-readonly', '-mountpoint', mountPoint]);
      const copied = join(copyRoot, appName);
      run('ditto', [join(mountPoint, appName), copied]);
      run('codesign', ['--verify', '--deep', '--strict', copied]);
    } catch (error) {
      verificationError = error;
    }
    try {
      run('hdiutil', ['detach', mountPoint]);
      detached = true;
    } catch (error) {
      throw new Error(`Could not confirm image detachment; inspect/detach ${mountPoint} before removing retained temporary directory ${directory}.`, { cause: error });
    }
    if (verificationError) throw verificationError;
  } finally {
    if (!attachAttempted || detached) rmSync(directory, { recursive: true, force: true });
  }
}
