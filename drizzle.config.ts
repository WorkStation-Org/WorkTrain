// อ่าน .env.local (ไฟล์เดียวกับที่ next dev ใช้) — dotenv/config เปล่า ๆ อ่านแค่ .env
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
