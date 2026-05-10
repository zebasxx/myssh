const { query } = require("../db/connection");
const { deriveUserKey, encrypt, decrypt } = require("../crypto/encryption");

/**
 * Encrypts connection secrets before storing
 * @param {Object} connection - Connection object with secrets
 * @param {Object} user - User object with encryption salt
 * @returns {Object} Encrypted data for database
 */
async function encryptConnectionSecrets(connection, user) {
  const key = deriveUserKey(user.entra_id, user.encryption_key_salt);

  const privateKeyEnc = encrypt(connection.privateKeyContent, key);
  const result = {
    encrypted_private_key: privateKeyEnc.ciphertext,
    private_key_iv: privateKeyEnc.iv,
    private_key_auth_tag: privateKeyEnc.authTag,
  };

  if (connection.privateKeyPassphrase) {
    const passphraseEnc = encrypt(connection.privateKeyPassphrase, key);
    result.encrypted_passphrase = passphraseEnc.ciphertext;
    result.passphrase_iv = passphraseEnc.iv;
    result.passphrase_auth_tag = passphraseEnc.authTag;
  }

  return result;
}

/**
 * Decrypts connection secrets
 * @param {Object} row - Database row
 * @param {Object} user - User object with encryption salt
 * @returns {Object} Decrypted secrets
 */
function decryptConnectionSecrets(row, user) {
  const key = deriveUserKey(user.entra_id, user.encryption_key_salt);

  const privateKeyContent = decrypt(
    row.encrypted_private_key,
    key,
    row.private_key_iv,
    row.private_key_auth_tag,
  );

  let privateKeyPassphrase = null;
  if (row.encrypted_passphrase) {
    privateKeyPassphrase = decrypt(
      row.encrypted_passphrase,
      key,
      row.passphrase_iv,
      row.passphrase_auth_tag,
    );
  }

  return { privateKeyContent, privateKeyPassphrase };
}

/**
 * Lists all connections for a user (with decrypted secrets)
 * @param {string} userId - User UUID
 * @param {Object} user - User object for decryption
 * @returns {Promise<Array>} Array of connection objects
 */
async function listConnections(userId, user) {
  const result = await query(
    `SELECT * FROM connections WHERE user_id = $1 ORDER BY name ASC`,
    [userId],
  );

  return result.rows.map((row) => {
    const secrets = decryptConnectionSecrets(row, user);
    return {
      id: row.id,
      type: "connection",
      name: row.name,
      parentId: row.folder_id,
      host: row.host,
      port: row.port,
      username: row.username,
      privateKeyContent: secrets.privateKeyContent,
      privateKeyPassphrase: secrets.privateKeyPassphrase,
      notes: row.notes,
    };
  });
}

/**
 * Gets a single connection by ID (with decrypted secrets)
 * @param {string} userId - User UUID
 * @param {string} connectionId - Connection UUID
 * @param {Object} user - User object for decryption
 * @returns {Promise<Object|null>} Connection object or null
 */
async function getConnection(userId, connectionId, user) {
  const result = await query(
    `SELECT * FROM connections WHERE id = $1 AND user_id = $2`,
    [connectionId, userId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const secrets = decryptConnectionSecrets(row, user);

  return {
    id: row.id,
    type: "connection",
    name: row.name,
    parentId: row.folder_id,
    host: row.host,
    port: row.port,
    username: row.username,
    privateKeyContent: secrets.privateKeyContent,
    privateKeyPassphrase: secrets.privateKeyPassphrase,
    notes: row.notes,
  };
}

/**
 * Creates a new connection
 * @param {string} userId - User UUID
 * @param {Object} connection - Connection data
 * @param {Object} user - User object for encryption
 * @returns {Promise<string>} New connection ID
 */
async function createConnection(userId, connection, user) {
  const encrypted = await encryptConnectionSecrets(connection, user);

  const result = await query(
    `INSERT INTO connections
     (user_id, folder_id, name, host, port, username, encrypted_private_key,
      private_key_iv, private_key_auth_tag, encrypted_passphrase, passphrase_iv,
      passphrase_auth_tag, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      userId,
      connection.parentId || null,
      connection.name,
      connection.host,
      connection.port || 22,
      connection.username || null,
      encrypted.encrypted_private_key,
      encrypted.private_key_iv,
      encrypted.private_key_auth_tag,
      encrypted.encrypted_passphrase || null,
      encrypted.passphrase_iv || null,
      encrypted.passphrase_auth_tag || null,
      connection.notes || null,
    ],
  );

  return result.rows[0].id;
}

/**
 * Updates a connection
 * @param {string} userId - User UUID
 * @param {string} connectionId - Connection UUID
 * @param {Object} connection - Updated connection data
 * @param {Object} user - User object for encryption
 * @returns {Promise<boolean>} True if updated
 */
async function updateConnection(userId, connectionId, connection, user) {
  const encrypted = await encryptConnectionSecrets(connection, user);

  const result = await query(
    `UPDATE connections
     SET folder_id = $1, name = $2, host = $3, port = $4, username = $5,
         encrypted_private_key = $6, private_key_iv = $7, private_key_auth_tag = $8,
         encrypted_passphrase = $9, passphrase_iv = $10, passphrase_auth_tag = $11,
         notes = $12, updated_at = NOW()
     WHERE id = $13 AND user_id = $14`,
    [
      connection.parentId || null,
      connection.name,
      connection.host,
      connection.port || 22,
      connection.username || null,
      encrypted.encrypted_private_key,
      encrypted.private_key_iv,
      encrypted.private_key_auth_tag,
      encrypted.encrypted_passphrase || null,
      encrypted.passphrase_iv || null,
      encrypted.passphrase_auth_tag || null,
      connection.notes || null,
      connectionId,
      userId,
    ],
  );

  return result.rowCount > 0;
}

/**
 * Deletes a connection
 * @param {string} userId - User UUID
 * @param {string} connectionId - Connection UUID
 * @returns {Promise<boolean>} True if deleted
 */
async function deleteConnection(userId, connectionId) {
  const result = await query(`DELETE FROM connections WHERE id = $1 AND user_id = $2`, [
    connectionId,
    userId,
  ]);

  return result.rowCount > 0;
}

module.exports = {
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  deleteConnection,
  decryptConnectionSecrets,
};
