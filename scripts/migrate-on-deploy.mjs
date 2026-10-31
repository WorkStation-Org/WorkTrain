/**
 * รัน migration ให้เสร็จ**ก่อน** build ของ production — ยกแนวคิดมาจาก WorkService
 *
 * ทำไมต้องมี: WorkService 21 ก.ย. 2026 merge แล้ว Vercel deploy โค้ดใหม่อัตโนมัติ แต่ migration
 * เป็นขั้นที่คนต้องจำเอง ⇒ ฐานค้างรุ่นเก่า หน้าลูกค้า 500 อยู่ห้าชั่วโมง
 * ที่นี่: migration ล้ม = build ล้ม = โค้ดที่ต้องการ schema ใหม่ไม่มีทางขึ้น production
 *
 * รันเฉพาะ `VERCEL_ENV=production` · preview ไม่แตะฐาน (ทุก PR ใช้ฐาน preview ร่วมกัน)
 * ฐานที่ล้ำหน้าโค้ด (rollback) ไม่แตะและไม่ทำให้ build ล้ม — ไม่งั้นจะ rollback ไม่ได้ตอนที่ต้องการที่สุด
 *
 * ★ รัน migration ผ่าน Pool (websocket) ไม่ใช่ neon-http — migrator ของ driver นี้รันทุกไฟล์ใน
 *   **transaction เดียว** · เหตุจริง 25 ก.ย. 2026: deploy แรกถูกยกเลิกกลาง build ตอนที่ neon-http
 *   migrator สร้างตารางไปแล้วแต่ยังไม่ได้สร้าง index/ฟังก์ชัน และยังไม่ได้บันทึกว่ารันแล้ว
 *   ⇒ ฐานค้างครึ่งทาง deploy ถัดไปจะล้มด้วย "already exists" ทุกครั้ง (ต้องซ่อมมือ)
 *   neon-http ไม่มี transaction จึงกันกรณีนี้ไม่ได้ (ดู src/db/atomic.ts)
 */
import { readFileSync } from "node:fs";
import { neon, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

export function shouldMigrate(vercelEnv) {
  return vercelEnv === "production";
}

export function migrationPlan(before, expected) {
  if (before === expected) return "up_to_date";
  return before > expected ? "rollback" : "run";
}

function expectedMigrations() {
  return JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url))).entries.length;
}

/** ฐานใหม่ยังไม่มีตารางของ drizzle = ยังไม่เคยรันเลย (0) ไม่ใช่ error */
async function appliedMigrations(sql) {
  try {
    const rows = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    return rows[0].n;
  } catch (err) {
    if (/does not exist/.test(String(err?.message ?? err))) return 0;
    throw err;
  }
}

async function main() {
  const vercelEnv = process.env.VERCEL_ENV;
  if (!shouldMigrate(vercelEnv)) {
    console.log(`[migrate-on-deploy] ข้าม — VERCEL_ENV=${vercelEnv ?? "(ไม่ได้ตั้ง)"}`);
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error("[migrate-on-deploy] production แต่ไม่มี DATABASE_URL — ตั้งค่าผิด ไม่ใช่เคสที่ควรข้ามเงียบ ๆ");
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);
  const expected = expectedMigrations();
  const before = await appliedMigrations(sql);
  const plan = migrationPlan(before, expected);
  if (plan === "up_to_date") return console.log(`[migrate-on-deploy] ฐานอยู่ที่ ${before} ตรงกับโค้ดแล้ว`);
  if (plan === "rollback") {
    return console.log(`[migrate-on-deploy] ฐานอยู่ที่ ${before} ล้ำหน้าโค้ด (${expected}) — rollback ไม่แตะฐาน`);
  }
  console.log(`[migrate-on-deploy] ฐานอยู่ที่ ${before} โค้ดต้องการ ${expected} — เริ่มรัน`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  } catch (err) {
    // สอง build พร้อมกันรันทับกันได้ ตัวที่แพ้ล้มด้วย "already exists" — ถ้าฐานถึงเป้าแล้วถือว่าสำเร็จ
    const after = await appliedMigrations(sql);
    if (after === expected) return console.log(`[migrate-on-deploy] อีก build หนึ่งรันสำเร็จไปแล้ว (${after})`);
    console.error(`[migrate-on-deploy] ล้ม — ฐานอยู่ที่ ${after} เป้าหมาย ${expected}`);
    throw err;
  } finally {
    await pool.end();
  }
  const after = await appliedMigrations(sql);
  if (after !== expected) {
    console.error(`[migrate-on-deploy] รันจบแต่ฐานอยู่ที่ ${after} ไม่ใช่ ${expected}`);
    process.exit(1);
  }
  console.log(`[migrate-on-deploy] ฐานอยู่ที่ ${after} แล้ว`);
}

if (process.argv[1]?.endsWith("migrate-on-deploy.mjs")) {
  await main();
}
