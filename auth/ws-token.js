const crypto = require("node:crypto");

const WS_TOKEN_TTL = 60 * 1000; // 60 seconds
const tokens = new Map();

/**
 * Generates a temporary token for WebSocket authentication
 * @param {string} sessionId - User's session ID
 * @param {string} userId - User's ID
 * @returns {string} WebSocket token
 */
function generateWsToken(sessionId, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  tokens.set(token, {
    sessionId,
    userId,
    expiresAt: Date.now() + WS_TOKEN_TTL,
  });

  // Cleanup expired token
  setTimeout(() => tokens.delete(token), WS_TOKEN_TTL);

  return token;
}

/**
 * Validates and consumes a WebSocket token (single use)
 * @param {string} token - WebSocket token
 * @returns {Object|null} { sessionId, userId } or null if invalid
 */
function validateWsToken(token) {
  const data = tokens.get(token);
  if (!data) return null;
  if (Date.now() > data.expiresAt) {
    tokens.delete(token);
    return null;
  }

  tokens.delete(token); // Single use
  return data;
}

module.exports = { generateWsToken, validateWsToken };
