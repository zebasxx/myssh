const { query } = require("../db/connection");

/**
 * Gets user settings
 * @param {string} userId - User UUID
 * @returns {Promise<Object>} Settings object
 */
async function getSettings(userId) {
  const result = await query(`SELECT * FROM user_settings WHERE user_id = $1`, [userId]);

  if (result.rows.length === 0) {
    // Create default settings if not exist
    await query(
      `INSERT INTO user_settings (user_id, auto_copy_selection, right_click_paste)
       VALUES ($1, false, false)`,
      [userId],
    );
    return { autoCopySelection: false, rightClickPaste: false };
  }

  const row = result.rows[0];
  return {
    autoCopySelection: row.auto_copy_selection,
    rightClickPaste: row.right_click_paste,
  };
}

/**
 * Updates user settings
 * @param {string} userId - User UUID
 * @param {Object} settings - Settings to update
 * @returns {Promise<boolean>} True if updated
 */
async function updateSettings(userId, settings) {
  const result = await query(
    `UPDATE user_settings
     SET auto_copy_selection = $1, right_click_paste = $2, updated_at = NOW()
     WHERE user_id = $3`,
    [
      settings.autoCopySelection !== undefined ? settings.autoCopySelection : false,
      settings.rightClickPaste !== undefined ? settings.rightClickPaste : false,
      userId,
    ],
  );

  return result.rowCount > 0;
}

module.exports = {
  getSettings,
  updateSettings,
};
