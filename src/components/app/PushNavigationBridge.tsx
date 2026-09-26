import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const SESSION_PATH = /^\/session\/[A-Za-z0-9._:-]{1,128}$/u;

/**
 * The push worker (public/sw.js) posts `notification:navigate` after focusing
 * an open window; only a session route or the root is accepted from it.
 */
export function pushNavigationPath(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const { type, urlPath } = message as { type?: unknown; urlPath?: unknown };
  if (type !== 'notification:navigate' || typeof urlPath !== 'string') return null;
  return urlPath === '/' || SESSION_PATH.test(urlPath) ? urlPath : null;
}

export default function PushNavigationBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;
    const receive = (event: MessageEvent) => {
      const path = pushNavigationPath(event.data);
      if (path) navigate(path);
    };
    navigator.serviceWorker.addEventListener('message', receive);
    return () => navigator.serviceWorker.removeEventListener('message', receive);
  }, [navigate]);
  return null;
}
