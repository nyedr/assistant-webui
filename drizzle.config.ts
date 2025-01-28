import { defineConfig } from "drizzle-kit";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL || "file:./data/chat.db",
  },
});
