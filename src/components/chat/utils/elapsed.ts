type Translate = (key: string, options?: Record<string, unknown>) => string;

/** `12s`, `1m 05s`-style label shared by the activity indicator and the work block. */
export function formatElapsed(totalSeconds: number, t: Translate): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return minutes < 1
    ? t('claudeStatus.elapsed.seconds', { count: seconds, defaultValue: '{{count}}s' })
    : t('claudeStatus.elapsed.minutesSeconds', { minutes, seconds, defaultValue: '{{minutes}}m {{seconds}}s' });
}
