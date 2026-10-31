import { createRequire } from "node:module";
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * ★ กติกาเครือข้อ 2: ต่อได้เฉพาะ Neon ของ WorkTrain · ข้อมูล WorkID/GateWay อ่านผ่าน API เท่านั้น
 *
 * ★ lazy โดยเจตนา — `next build` ใน CI ต้องผ่านโดยไม่มี DATABASE_URL
 *
 * ★ neon-http **ไม่มี transaction** (`db().transaction()` โยน error ทุกครั้งบน production)
 *   ของที่ต้องลงพร้อมกันใช้ `atomic()` ใน `./atomic.ts` เท่านั้น · เทสต์จำลองข้อจำกัดนี้ไว้
 *   (`src/db/__tests__/pgdb.ts`) เพราะ WorkService เคยเจอโค้ดที่ผ่านเทสต์แต่ 500 บน production
 */
export type Db = NeonHttpDatabase<typeof schema>;

let _db: Db | null = null;

export function db(): Db {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set — WorkTrain cannot reach its database");
    _db = url.startsWith("pglite:") ? devPglite(url) : drizzle(neon(url), { schema });
  }
  return _db;
}

/**
 * `DATABASE_URL=pglite:.pglite` — Postgres ในไฟล์บนเครื่อง dev ไม่ต้องมี Neon (ดู README §รันบนเครื่อง)
 *
 * ★ ตายบน Vercel เสมอ — production ต้องเป็น Neon เท่านั้น
 * ★ โหลดด้วย `createRequire` ไม่ใช่ `import` เพื่อไม่ให้ bundler ลาก PGlite (devDependency ที่มี wasm)
 *   เข้า bundle ของ production · PGlite ไม่มี `batch` ดังนั้น `atomic()` จะรันเรียงกัน —
 *   เหมือนในเทสต์ ไม่ใช่เหมือน production (ดู `./atomic.ts`)
 * ★ migration ต้องรันเองครั้งแรก: `npm run db:dev-setup`
 */
function devPglite(url: string): Db {
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL แบบ pglite: ใช้ได้เฉพาะบนเครื่อง dev");
  }
  const req = createRequire(`${process.cwd()}/package.json`);
  const { PGlite } = req("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  const { drizzle: pgliteDrizzle } = req("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
  const holder = globalThis as unknown as { __wtrDevPg?: InstanceType<typeof PGlite> };
  holder.__wtrDevPg ??= new PGlite(url.slice("pglite:".length) || ".pglite");
  return pgliteDrizzle(holder.__wtrDevPg, { schema }) as unknown as Db;
}

export { schema };
