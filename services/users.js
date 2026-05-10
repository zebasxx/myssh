const { query } = require("../db/connection");
const { generateSalt } = require("../crypto/encryption");

/**
 * Finds or creates user from Entra ID profile
 * @param {Object} entraProfile - Profile from Microsoft Entra ID
 * @returns {Promise<Object>} User object from database
 */
async function findOrCreateUser(entraProfile) {
  const { oid, email, name } = entraProfile;

  // Try to find existing user
  let result = await query("SELECT * FROM users WHERE entra_id = $1", [oid]);

  if (result.rows.length > 0) {
    // Update last login
    await query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [result.rows[0].id]);
    return result.rows[0];
  }

  // Create new user
  const salt = generateSalt();
  result = await query(
    `INSERT INTO users (entra_id, email, display_name, encryption_key_salt)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [oid, email, name, salt],
  );

  // Create default settings
  await query(`INSERT INTO user_settings (user_id) VALUES ($1)`, [result.rows[0].id]);

  console.log(`New user created: ${email} (${oid})`);

  return result.rows[0];
}

/**
 * Gets user by ID
 * @param {string} userId - User UUID
 * @returns {Promise<Object|null>} User object or null
 */
async function getUserById(userId) {
  const result = await query("SELECT * FROM users WHERE id = $1", [userId]);
  return result.rows[0] || null;
}

module.exports = { findOrCreateUser, getUserById };
