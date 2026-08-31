import { defineConfig } from "drizzle-kit";

import "./env.config";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required. Add it to .env.local, .env, or the process environment.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/auth-schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
