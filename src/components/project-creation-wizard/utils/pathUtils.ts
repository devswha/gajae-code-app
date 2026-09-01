const driveRoot = /^[A-Za-z]:\\?$/;

const lastPathSeparator = (path: string) => Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
const isDrivePath = (path: string) => /^[A-Za-z]:/.test(path);

export const getSuggestionRootPath = (inputPath: string): string => {
  const path = inputPath.trim();
  const separator = lastPathSeparator(path);

  if (separator === 2 && isDrivePath(path)) {
    return `${path.slice(0, 2)}\\`;
  }

  return separator > 0 ? path.slice(0, separator) : '~';
};

export const getParentPath = (currentPath: string): string | null => {
  if (currentPath === '~' || currentPath === '/' || driveRoot.test(currentPath)) {
    return null;
  }

  const separator = lastPathSeparator(currentPath);
  if (separator <= 0) {
    return '/';
  }

  if (separator === 2 && isDrivePath(currentPath)) {
    return `${currentPath.slice(0, 2)}\\`;
  }

  return currentPath.slice(0, separator);
};

export const joinFolderPath = (basePath: string, folderName: string): string => {
  const folder = basePath.trim().replace(/[\\/]+$/, '');
  const usesWindowsSeparator = folder.includes('\\') && !folder.includes('/');
  return `${folder}${usesWindowsSeparator ? '\\' : '/'}${folderName.trim()}`;
};
