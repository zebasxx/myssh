const { getSession } = require("../auth/session");

/**
 * Middleware to require authentication for routes
 * Returns 401 if not authenticated
 */
function requireAuth(req, res, next) {
  const sessionId = req.cookies?.myssh_session;
  const session = getSession(sessionId);

  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.user = session;
  next();
}

/**
 * Middleware to optionally attach user if authenticated
 * Does not require authentication
 */
function attachUser(req, res, next) {
  const sessionId = req.cookies?.myssh_session;
  const session = getSession(sessionId);

  if (session) {
    req.user = session;
  }

  next();
}

module.exports = { requireAuth, attachUser };
