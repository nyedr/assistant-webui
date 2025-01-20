import postgres from "postgres";

const sql = postgres("postgres://postgres:12031991@localhost:5432/postgres");

async function dropTables() {
  try {
    await sql`
      DROP TABLE IF EXISTS "Chat", "Message", "Vote", "Document", "Suggestion", "User" CASCADE;
    `;
    console.log("Tables dropped successfully");
  } catch (error) {
    console.error("Error dropping tables:", error);
  } finally {
    await sql.end();
  }
}

dropTables();
