const { query } = require("../db/connection");

/**
 * Lists all folders for a user
 * @param {string} userId - User UUID
 * @returns {Promise<Array>} Array of folder objects
 */
async function listFolders(userId) {
  const result = await query(
    `SELECT * FROM folders WHERE user_id = $1 ORDER BY name ASC`,
    [userId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    type: "folder",
    name: row.name,
    parentId: row.parent_folder_id,
    collapsed: row.collapsed,
  }));
}

/**
 * Gets a single folder by ID
 * @param {string} userId - User UUID
 * @param {string} folderId - Folder UUID
 * @returns {Promise<Object|null>} Folder object or null
 */
async function getFolder(userId, folderId) {
  const result = await query(`SELECT * FROM folders WHERE id = $1 AND user_id = $2`, [
    folderId,
    userId,
  ]);

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    type: "folder",
    name: row.name,
    parentId: row.parent_folder_id,
    collapsed: row.collapsed,
  };
}

/**
 * Creates a new folder
 * @param {string} userId - User UUID
 * @param {Object} folder - Folder data
 * @returns {Promise<string>} New folder ID
 */
async function createFolder(userId, folder) {
  const result = await query(
    `INSERT INTO folders (user_id, name, parent_folder_id, collapsed)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [userId, folder.name, folder.parentId || null, folder.collapsed || false],
  );

  return result.rows[0].id;
}

/**
 * Updates a folder
 * @param {string} userId - User UUID
 * @param {string} folderId - Folder UUID
 * @param {Object} folder - Updated folder data
 * @returns {Promise<boolean>} True if updated
 */
async function updateFolder(userId, folderId, folder) {
  const result = await query(
    `UPDATE folders
     SET name = $1, parent_folder_id = $2, collapsed = $3, updated_at = NOW()
     WHERE id = $4 AND user_id = $5`,
    [folder.name, folder.parentId || null, folder.collapsed || false, folderId, userId],
  );

  return result.rowCount > 0;
}

/**
 * Deletes a folder (cascades to child folders and connections)
 * @param {string} userId - User UUID
 * @param {string} folderId - Folder UUID
 * @returns {Promise<boolean>} True if deleted
 */
async function deleteFolder(userId, folderId) {
  const result = await query(`DELETE FROM folders WHERE id = $1 AND user_id = $2`, [
    folderId,
    userId,
  ]);

  return result.rowCount > 0;
}

module.exports = {
  listFolders,
  getFolder,
  createFolder,
  updateFolder,
  deleteFolder,
};
