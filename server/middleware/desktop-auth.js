import { createHash, timingSafeEqual } from 'node:crypto';

export const DESKTOP_AUTH_COOKIE_NAME = 'gajae_desktop_api_key';
export const DESKTOP_BOOTSTRAP_PATH = '/desktop/bootstrap';
export const isDesktopMode = (env = process.env) => env.GJC_DESKTOP === '1';


const secureEqual = (actual, expected) => {
  if (typeof actual !== 'string' || typeof expected !== 'string') {
    return false;
  }

  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
};

const getServerPort = (server) => {
  const address = server.address();
  return address && typeof address !== 'string' ? address.port : null;
};

/**
 * Desktop sidecars receive per-launch secrets only through their supervisor
 * environment. The adapter deliberately never exposes either secret in a
 * response body, URL, or diagnostic.
 */
export function createDesktopAuth({ env = process.env, server }) {
  const enabled = isDesktopMode(env);
  const apiKey = env.GJC_DESKTOP_API_KEY;
  let bootstrapNonce = env.GJC_DESKTOP_BOOTSTRAP_NONCE;

  if (enabled && (!apiKey || !bootstrapNonce)) {
    throw new Error('Desktop mode requires GJC_DESKTOP_API_KEY and GJC_DESKTOP_BOOTSTRAP_NONCE');
  }

  const expectedOrigin = () => {
    const port = getServerPort(server);
    return port === null ? null : `http://127.0.0.1:${port}`;
  };

  const isExactOrigin = (request) => {
    const origin = request.headers.origin;
    const expected = expectedOrigin();
    return typeof origin === 'string' && expected !== null && origin === expected;
  };

  // Browsers omit the Origin header on same-origin GET fetches and top-level
  // navigations, so HTTP authentication accepts an absent Origin (the launch
  // cookie remains required) while rejecting any mismatched Origin.
  // WebSocket handshakes always carry Origin, so they stay exact-match.
  const isAllowedHttpOrigin = (request) => {
    if (request.headers.origin === undefined) {
      return true;
    }
    return isExactOrigin(request);
  };

  const hasApiKey = (request) => secureEqual(
    parseCookieHeader(request.headers.cookie)[DESKTOP_AUTH_COOKIE_NAME],
    apiKey
  );

  const reject = (response) => response.status(401).json({ error: 'Unauthorized' });

  return {
    enabled,
    expectedOrigin,
    corsOptions: enabled ? {
      origin(origin, callback) {
        callback(null, origin === expectedOrigin());
      }
    } : null,
    bootstrap(request, response) {
      if (!enabled || request.method !== 'GET' || bootstrapNonce === null ||
          !secureEqual(typeof request.query.nonce === 'string' ? request.query.nonce : '', bootstrapNonce)) {
        return response.status(401).json({ error: 'Unauthorized' });
      }

      bootstrapNonce = null;
      response.cookie(DESKTOP_AUTH_COOKIE_NAME, apiKey, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
      return response.redirect(303, '/');
    },
    authenticateHttp(request, response, next) {
      if (!enabled) {
        return next();
      }
      if (!isAllowedHttpOrigin(request) || !hasApiKey(request)) {
        return reject(response);
      }
      return next();
    },
    authenticatePage(request, response, next) {
      if (!enabled || hasApiKey(request)) {
        return next();
      }
      return reject(response);
    },
    authenticateWebSocket(request) {
      return !enabled || (isExactOrigin(request) && hasApiKey(request));
    },
  };
}

const parseCookieHeader = (cookieHeader) => {
  if (typeof cookieHeader !== 'string') {
    return {};
  }

  return cookieHeader.split(';').reduce((cookies, entry) => {
    const separator = entry.indexOf('=');
    if (separator < 0) {
      return cookies;
    }
    const name = entry.slice(0, separator).trim();
    if (name) {
      cookies[name] = entry.slice(separator + 1).trim();
    }
    return cookies;
  }, {});
};
