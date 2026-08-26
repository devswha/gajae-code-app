import type { ConfirmActionType, FileStatusCode, GitStatusGroupEntry } from '../types/types';

export const DEFAULT_BRANCH = 'main';
// High enough for the commit graph to show meaningful branch structure.
export const RECENT_COMMITS_LIMIT = 50;

export const FILE_STATUS_GROUPS: GitStatusGroupEntry[] = [
  { key: 'modified', status: 'M' },
  { key: 'added', status: 'A' },
  { key: 'deleted', status: 'D' },
  { key: 'untracked', status: 'U' },
];

export const FILE_STATUS_LABELS: Record<FileStatusCode, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  U: 'Untracked',
};

export const FILE_STATUS_BADGE_CLASSES: Record<FileStatusCode, string> = {
  M: 'border-primary/20 bg-primary/10 text-primary',
  A: 'border-diff-added/20 bg-diff-added text-diff-added-foreground',
  D: 'border-diff-removed/20 bg-diff-removed text-diff-removed-foreground',
  U: 'bg-muted text-muted-foreground border-border',
};

export const CONFIRMATION_TITLES: Record<ConfirmActionType, string> = {
  discard: 'Discard Changes',
  delete: 'Delete File',
  commit: 'Confirm Action',
  pull: 'Confirm Pull',
  push: 'Confirm Push',
  publish: 'Publish Branch',
  revertLocalCommit: 'Revert Local Commit',
  deleteBranch: 'Delete Branch',
};

export const CONFIRMATION_ACTION_LABELS: Record<ConfirmActionType, string> = {
  discard: 'Discard',
  delete: 'Delete',
  commit: 'Confirm',
  pull: 'Pull',
  push: 'Push',
  publish: 'Publish',
  revertLocalCommit: 'Revert Commit',
  deleteBranch: 'Delete',
};

export const CONFIRMATION_BUTTON_CLASSES: Record<ConfirmActionType, string> = {
  discard: 'bg-destructive hover:bg-destructive/90',
  delete: 'bg-destructive hover:bg-destructive/90',
  commit: 'bg-primary hover:bg-primary/90',
  pull: 'bg-primary hover:bg-primary/90',
  push: 'bg-primary hover:bg-primary/90',
  publish: 'bg-primary hover:bg-primary/90',
  revertLocalCommit: 'bg-primary hover:bg-primary/90',
  deleteBranch: 'bg-destructive hover:bg-destructive/90',
};

export const CONFIRMATION_ICON_CONTAINER_CLASSES: Record<ConfirmActionType, string> = {
  discard: 'bg-destructive/10 text-destructive',
  delete: 'bg-destructive/10 text-destructive',
  commit: 'bg-primary/10 text-primary',
  pull: 'bg-primary/10 text-primary',
  push: 'bg-primary/10 text-primary',
  publish: 'bg-primary/10 text-primary',
  revertLocalCommit: 'bg-primary/10 text-primary',
  deleteBranch: 'bg-destructive/10 text-destructive',
};

export const CONFIRMATION_ICON_CLASSES: Record<ConfirmActionType, string> = {
  discard: 'text-destructive',
  delete: 'text-destructive',
  commit: 'text-primary',
  pull: 'text-primary',
  push: 'text-primary',
  publish: 'text-primary',
  revertLocalCommit: 'text-primary',
  deleteBranch: 'text-destructive',
};
