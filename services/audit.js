const { query } = require("../db/connection");

/**
 * Logs an audit event
 * @param {Object} options - Audit event details
 * @param {string} options.userId - User UUID (optional)
 * @param {string} options.action - Action performed (LOGIN, LOGOUT, SSH_CONNECT, etc.)
 * @param {string} options.resourceType - Type of resource (connection, folder, session)
 * @param {string} options.resourceId - Resource UUID
 * @param {string} options.ipAddress - Client IP address
 * @param {string} options.userAgent - Client user agent
 * @param {Object} options.metadata - Additional metadata (JSON)
 * @returns {Promise<void>}
 */
async function logAuditEvent({
  userId = null,
  action,
  resourceType = null,
  resourceId = null,
  ipAddress = null,
  userAgent = null,
  metadata = null,
}) {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, action, resourceType, resourceId, ipAddress, userAgent, metadata ? JSON.stringify(metadata) : null],
    );
  } catch (error) {
    console.error("Failed to log audit event:", error);
    // Don't throw - audit failure shouldn't break the main flow
  }
}

module.exports = { logAuditEvent };
