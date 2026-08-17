import { useCallback, useState } from 'react';

import type { Project } from '../../../types/app';
import type { CodeEditorDiffInfo, CodeEditorFile } from '../types/types';

type UseEditorFileOptions = {
  selectedProject: Project | null;
};

/**
 * Tracks which file the editor is showing.
 *
 * Width, expansion and the resize handle belong to the Workspace panel that
 * hosts the editor, not to the file being edited, so this hook stays limited to
 * opening and closing one file.
 */
export const useEditorFile = ({ selectedProject }: UseEditorFileOptions) => {
  const [editingFile, setEditingFile] = useState<CodeEditorFile | null>(null);

  const handleFileOpen = useCallback(
    (filePath: string, diffInfo: CodeEditorDiffInfo | null = null, options: { projectId?: string } = {}) => {
      const normalizedPath = filePath.replace(/\\/g, '/');
      const fileName = normalizedPath.split('/').pop() || filePath;

      setEditingFile({
        name: fileName,
        path: filePath,
        // DB projectId is forwarded to the editor so it can read/save files
        // via `/api/projects/:projectId/file` endpoints. Callers opening files
        // that belong to a DIFFERENT project (e.g. the fixed-root files panel)
        // pass their own projectId via options.
        projectId: options.projectId ?? selectedProject?.projectId,
        diffInfo,
      });
    },
    [selectedProject?.projectId],
  );

  const handleCloseEditor = useCallback(() => {
    setEditingFile(null);
  }, []);

  return {
    editingFile,
    handleFileOpen,
    handleCloseEditor,
  };
};
