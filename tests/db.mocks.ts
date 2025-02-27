import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { chat, document, suggestion } from "../lib/db/schema";

// Define schema object
const schema = { chat, document, suggestion } as const;

// Define the database type using schema
type DbSchema = typeof schema;
type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export const createTestDb = () => {
  const sqlite = new Database(":memory:");

  // Enable foreign keys
  sqlite.exec("PRAGMA foreign_keys = ON");

  // Create tables with new schema
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS chat (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      chat TEXT NOT NULL DEFAULT '{"currentId":null,"messages":[]}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      folder_id TEXT,
      meta TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS document (
      id TEXT PRIMARY KEY NOT NULL,
      createdAt TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      kind TEXT NOT NULL DEFAULT 'text'
    );

    CREATE TABLE IF NOT EXISTS suggestion (
      id TEXT PRIMARY KEY NOT NULL,
      documentId TEXT NOT NULL,
      documentCreatedAt TEXT NOT NULL,
      originalText TEXT NOT NULL,
      suggestedText TEXT NOT NULL,
      description TEXT,
      isResolved INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (documentId) REFERENCES document(id)
    );

    CREATE INDEX IF NOT EXISTS idx_NEXT_PUBLIC_CHAT_created_at ON chat(created_at);
    CREATE INDEX IF NOT EXISTS idx_NEXT_PUBLIC_CHAT_updated_at ON chat(updated_at);
    CREATE INDEX IF NOT EXISTS idx_NEXT_PUBLIC_CHAT_folder_id ON chat(folder_id);
  `);

  return drizzle(sqlite, { schema });
};

// Export types
export type { DbSchema, TestDb };
