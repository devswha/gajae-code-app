import { useCallback } from 'react';

import { observeOutgoingChatMessage } from '../../hooks/useSessionAttentionSync';

export function useAppMessageSender(sendToServer: (message: unknown) => boolean) {
  return useCallback((message: unknown) => {
    const accepted = sendToServer(message);
    if (!accepted) return false;
    observeOutgoingChatMessage(message);
    return true;
  }, [sendToServer]);
}
