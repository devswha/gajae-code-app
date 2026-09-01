const DONE_PREFIX = '[Done] ';
const RESET_AFTER_MS = 2000;

let resetId: number | null = null;
let waitsForReturn = false;

const titleWithoutNotice = (title: string): string => title.startsWith(DONE_PREFIX)
  ? title.slice(DONE_PREFIX.length)
  : title;

const isForeground = (): boolean => document.visibilityState === 'visible' && document.hasFocus();

const stopReset = (): void => {
  if (resetId === null) return;
  window.clearTimeout(resetId);
  resetId = null;
};

const detachReturnWatchers = (): void => {
  if (!waitsForReturn || typeof window === 'undefined') return;
  document.removeEventListener('visibilitychange', resetAfterReturn);
  window.removeEventListener('focus', resetAfterReturn, true);
  window.removeEventListener('click', resetAfterReturn, true);
  waitsForReturn = false;
};

const resetTitle = (): void => {
  stopReset();
  detachReturnWatchers();
  document.removeEventListener('visibilitychange', pauseReset);
  if (document.title.startsWith(DONE_PREFIX)) document.title = titleWithoutNotice(document.title);
};

const waitForReturn = (): void => {
  if (waitsForReturn) return;
  document.addEventListener('visibilitychange', resetAfterReturn);
  window.addEventListener('focus', resetAfterReturn, true);
  window.addEventListener('click', resetAfterReturn, true);
  waitsForReturn = true;
};

const armReset = (): void => {
  stopReset();
  resetId = window.setTimeout(resetTitle, RESET_AFTER_MS);
  document.removeEventListener('visibilitychange', pauseReset);
  document.addEventListener('visibilitychange', pauseReset, { once: true });
};

function resetAfterReturn(): void {
  if (isForeground()) armReset();
}

function pauseReset(): void {
  if (document.visibilityState !== 'hidden') return;
  stopReset();
  waitForReturn();
}

export const showCompletionTitleIndicator = (): void => {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  document.title = `${DONE_PREFIX}${titleWithoutNotice(document.title || 'Gajae Code App')}`;
  if (isForeground()) {
    armReset();
  } else {
    stopReset();
    waitForReturn();
  }
};
