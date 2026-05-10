const { query } = require("./connection");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Runs database migrations if needed
 */
async function migrate() {
  try {
    console.log("Checking database schema...");

    // Check if users table exists
    const result = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'users'
      )
    `);

    if (result.rows[0].exists) {
      console.log("Database schema already exists");
      return;
    }

    console.log("Running database migrations...");

    // Run schema file
    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await query(schema);

    console.log("Database migration complete");
  } catch (error) {
    console.error("Database migration failed:", error);
    throw error;
  }
}

module.exports = { migrate };
