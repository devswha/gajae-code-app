import path from 'node:path';

const CHILD_PATHS = [
  'PATH', 'LD_LIBRARY_PATH', 'LD_PRELOAD', 'PYTHONHOME', 'PYTHONPATH',
  'GTK_PATH', 'GTK_EXE_PREFIX', 'GTK_DATA_PREFIX', 'GTK_IM_MODULE_FILE',
  'GIO_MODULE_DIR', 'GIO_EXTRA_MODULES', 'GI_TYPELIB_PATH',
  'GDK_PIXBUF_MODULE_FILE', 'GDK_PIXBUF_MODULEDIR', 'GSETTINGS_SCHEMA_DIR',
  'QT_PLUGIN_PATH', 'QT_QPA_PLATFORM_PLUGIN_PATH', 'QML2_IMPORT_PATH', 'XDG_DATA_DIRS',
] as const;

/** Keep AppRun's GTK/Python search paths inside the shell, not its tools. */
export function sanitizeAppImageEnvironment(environment: NodeJS.ProcessEnv, platform = process.platform): void {
  if (platform !== 'linux' || environment.GJC_DESKTOP !== '1' || !environment.APPDIR) return;
  const appDir = path.posix.normalize(environment.APPDIR).replace(/\/$/, '');
  if (!appDir || !path.posix.isAbsolute(appDir)) return;
  const belongsToImage = (value: string) => {
    const normalized = path.posix.normalize(value);
    return normalized === appDir || normalized.startsWith(`${appDir}/`);
  };
  for (const name of CHILD_PATHS) {
    const value = environment[name];
    if (!value) continue;
    const entries = value.split(name === 'LD_PRELOAD' ? /[:\s]+/ : ':');
    if (!entries.some(belongsToImage)) continue;
    const kept = entries.filter(entry => entry && !belongsToImage(entry));
    if (kept.length) environment[name] = kept.join(name === 'LD_PRELOAD' ? ' ' : ':');
    else delete environment[name];
  }
}
