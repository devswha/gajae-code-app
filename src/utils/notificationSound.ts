const SOUND_PREFERENCE = 'notificationSoundEnabled';
const audioApi = typeof window === 'undefined'
  ? undefined
  : window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

let sharedContext: AudioContext | null = null;

const preferenceAllowsSound = (): boolean => typeof localStorage === 'undefined'
  || localStorage.getItem(SOUND_PREFERENCE) !== 'false';

export const setNotificationSoundEnabled = (enabled: boolean): void => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(SOUND_PREFERENCE, `${enabled}`);
};

const contextForPlayback = (): AudioContext | null => {
  if (!audioApi) return null;
  sharedContext ??= new audioApi();
  return sharedContext;
};

const addNote = (context: AudioContext, frequency: number, time: number, length: number, volume: number): void => {
  const source = context.createOscillator();
  const envelope = context.createGain();
  source.type = 'sine';
  source.frequency.setValueAtTime(frequency, time);
  envelope.gain.setValueAtTime(0.0001, time);
  envelope.gain.exponentialRampToValueAtTime(volume, time + 0.015);
  envelope.gain.exponentialRampToValueAtTime(0.0001, time + length);
  source.connect(envelope);
  envelope.connect(context.destination);
  source.start(time);
  source.stop(time + length + 0.02);
};

export const playNotificationSound = async ({ force = false } = {}): Promise<void> => {
  if (!force && !preferenceAllowsSound()) return;

  const context = contextForPlayback();
  if (!context) return;

  try {
    if (context.state === 'suspended') await context.resume();
    const firstNoteAt = context.currentTime;
    addNote(context, 740, firstNoteAt, 0.12, 0.075);
    addNote(context, 988, firstNoteAt + 0.11, 0.16, 0.06);
  } catch (error) {
    // Autoplay policy can reject playback before an interaction occurs.
    console.warn('Unable to play notification sound:', error);
  }
};

export const playChatCompletionSound = (options = {}): Promise<void> => playNotificationSound(options);
