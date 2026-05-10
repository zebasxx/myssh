const crypto = require("node:crypto");

// In-memory session store (for production scale, use Redis or PostgreSQL)
const sessions = new Map();

const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

/**
 * Creates a new session for authenticated user
 * @param {Object} user - User object from database
 * @returns {string} Session ID
 */
function createSession(user) {
  const sessionId = crypto.randomBytes(32).toString("hex");
  const session = {
    id: sessionId,
    userId: user.id,
    entraId: user.entra_id,
    email: user.email,
    displayName: user.display_name,
    encryptionKeySalt: user.encryption_key_salt,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_MAX_AGE,
  };
  sessions.set(sessionId, session);
  return sessionId;
}

/**
 * Retrieves session by ID
 * @param {string} sessionId - Session ID
 * @returns {Object|null} Session object or null if not found/expired
 */
function getSession(sessionId) {
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

/**
 * Destroys a session
 * @param {string} sessionId - Session ID to destroy
 */
function destroySession(sessionId) {
  sessions.delete(sessionId);
}

/**
 * Cleanup expired sessions periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(id);
    }
  }
}, CLEANUP_INTERVAL);

module.exports = { createSession, getSession, destroySession };
