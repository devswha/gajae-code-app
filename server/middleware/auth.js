import { userDb } from '../modules/database/index.js';

import { isDesktopMode } from './desktop-auth.js';

const IMPLICIT_OWNER_PASSWORD_HASH = 'disabled:desktop-key-auth';

let implicitOwnerId = null;
const getImplicitOwner = () => {
  if (implicitOwnerId !== null) {
    const cached = userDb.getUserById(implicitOwnerId);
    if (cached) {
      return cached;
    }
    implicitOwnerId = null;
  }

  let owner = userDb.getFirstUser();
  if (!owner) {
    const created = userDb.createUser('owner', IMPLICIT_OWNER_PASSWORD_HASH);
    owner = userDb.getUserById(Number(created.id)) ?? { id: Number(created.id), username: created.username };
  }
  implicitOwnerId = owner.id;
  return owner;
};

// Optional API key middleware for non-desktop deployments.
export const hasValidApiKey = (req) => isDesktopMode() || !process.env.API_KEY
  || req.headers['x-api-key'] === process.env.API_KEY;

const validateApiKey = (req, res, next) => {
  if (!hasValidApiKey(req)) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// The desktop middleware validates the per-boot key before this attaches the
// implicit owner to protected HTTP routes.
const authenticateToken = (req, res, next) => {
  req.user = getImplicitOwner();
  return next();
};

// The WebSocket gateway runs desktopAuth.authenticateWebSocket before this
// attaches the implicit owner.
const authenticateWebSocket = () => {
  const owner = getImplicitOwner();
  return { userId: owner.id, username: owner.username };
};

export {
  validateApiKey,
  authenticateToken,
  authenticateWebSocket,
};
