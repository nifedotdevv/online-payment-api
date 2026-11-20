import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// Load .env for local runs; in Docker the env comes from compose.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/models/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
