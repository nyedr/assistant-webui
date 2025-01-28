import { beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.join(process.cwd(), "data", "test.db");
const DATA_DIR = path.join(process.cwd(), "data");

import { initializeTestDatabase } from "../lib/db/test-init";
import { chat, document, suggestion } from "../lib/db/schema";

// Set test environment
process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
process.env.VITEST = "true";

// Initialize database for tests
let db: Awaited<ReturnType<typeof initializeTestDatabase>>;

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Handle cleanup
async function cleanupDatabase() {
  try {
    if (db) {
      // Delete data in correct order (children before parents)
      await Promise.all([
        db.delete(suggestion).run(),
        db.delete(document).run(),
      ]);
      db.delete(chat).run();

      // Close database connection
      const sqlite = (db as any)._instance;
      if (sqlite) {
        sqlite.close();
      }

      // Clear the db reference
      db = undefined as any;

      // Wait a bit for file handles to be released
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Delete database file with retries
    if (fs.existsSync(TEST_DB_PATH)) {
      let retries = 5;
      while (retries > 0) {
        try {
          fs.unlinkSync(TEST_DB_PATH);
          break;
        } catch (err: any) {
          if (err.code === "EBUSY" || err.code === "EACCES") {
            retries--;
            if (retries === 0) {
              console.error(
                "Failed to delete test database after retries:",
                err
              );
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
          } else if (err.code !== "ENOENT") {
            console.error("Failed to delete test database:", err);
            break;
          }
        }
      }
    }
  } catch (error) {
    console.error("Failed to clean up test database:", error);
  }
}

// Initialize test database before all tests
beforeAll(async () => {
  await cleanupDatabase();
  db = await initializeTestDatabase();
});

// Reset database state before each test
beforeEach(async () => {
  if (db) {
    // Just clear tables instead of recreating database
    await Promise.all([db.delete(suggestion).run(), db.delete(document).run()]);
    db.delete(chat).run();
  } else {
    await cleanupDatabase();
    db = await initializeTestDatabase();
  }
});

// Clean up after all tests
afterAll(async () => {
  await cleanupDatabase();
});

// Export database instance for tests
export { db };
