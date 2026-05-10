const crypto = require("node:crypto");

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits (recommended for GCM)
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Derives a user-specific encryption key from Entra ID object ID and salt
 * Uses PBKDF2 with high iteration count for security
 * @param {string} entraId - User's Entra ID object ID
 * @param {Buffer} salt - Random salt stored in database
 * @returns {Buffer} Derived encryption key
 */
function deriveUserKey(entraId, salt) {
  return crypto.pbkdf2Sync(entraId, salt, 600000, KEY_LENGTH, "sha256");
}

/**
 * Encrypts data using AES-256-GCM
 * @param {string} plaintext - Data to encrypt
 * @param {Buffer} key - Encryption key
 * @returns {Object} { ciphertext (base64), iv (Buffer), authTag (Buffer) }
 */
function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(plaintext, "utf8", "base64");
  ciphertext += cipher.final("base64");
  const authTag = cipher.getAuthTag();

  return { ciphertext, iv, authTag };
}

/**
 * Decrypts data encrypted with encrypt()
 * @param {string} ciphertext - Base64 encoded ciphertext
 * @param {Buffer} key - Encryption key
 * @param {Buffer} iv - Initialization vector
 * @param {Buffer} authTag - Authentication tag
 * @returns {string} Decrypted plaintext
 */
function decrypt(ciphertext, key, iv, authTag) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(ciphertext, "base64", "utf8");
  plaintext += decipher.final("utf8");

  return plaintext;
}

/**
 * Generates a cryptographically random salt
 * @returns {Buffer} Random salt (32 bytes)
 */
function generateSalt() {
  return crypto.randomBytes(32);
}

module.exports = { deriveUserKey, encrypt, decrypt, generateSalt };
