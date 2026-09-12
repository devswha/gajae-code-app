import { createHmac, timingSafeEqual } from 'node:crypto';

import { isNativeSecret, type DesktopNativeBinding } from '../shared/desktop-native-init.js';
export { isNativeSecret, type DesktopNativeBinding } from '../shared/desktop-native-init.js';
export function authenticNativeChallenge(value: Record<string, unknown>, binding: DesktopNativeBinding, nonce: string): boolean {
  if (Object.keys(value).length !== 5 || value.protocolVersion !== 1 || value.kind !== 'challenge'
    || value.epoch !== binding.epoch || value.nonce !== nonce || !isNativeSecret(value.proof)) return false;
  const expected = createHmac('sha256', binding.secret)
    .update(`gajae-native-update-v1\0${binding.epoch}\0${nonce}`, 'utf8').digest();
  return timingSafeEqual(expected, Buffer.from(value.proof, 'hex'));
}
