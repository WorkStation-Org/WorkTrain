import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ใช้เฉพาะบนเครื่อง dev (src/db/index.ts) — ห้าม bundle เข้า production
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
