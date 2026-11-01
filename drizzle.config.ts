import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./database/schema/index.ts",
  out: "./database/migrations",
});
