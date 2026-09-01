import { useCallback, useEffect, useState } from 'react';

import { voiceId, voicePlayer, type VoiceSnapshot } from '../../../utils/voicePlayer';

export type TtsState = VoiceSnapshot['state'];

function sameSnapshot(left: VoiceSnapshot, right: VoiceSnapshot): boolean {
  return left.state === right.state && left.error === right.error;
}

export function useTts(getText: () => string) {
  const text = getText();
  const messageId = voiceId(text);
  const [snapshot, setSnapshot] = useState(() => voicePlayer.getSnapshot(messageId));

  useEffect(() => {
    const syncSnapshot = () => {
      const current = voicePlayer.getSnapshot(messageId);
      setSnapshot((previous) => (sameSnapshot(previous, current) ? previous : current));
    };

    syncSnapshot();
    return voicePlayer.subscribe(syncSnapshot);
  }, [messageId]);

  const toggle = useCallback(() => {
    voicePlayer.unlock();
    voicePlayer.toggle(text);
  }, [text]);

  return { state: snapshot.state, toggle, error: snapshot.error };
}
