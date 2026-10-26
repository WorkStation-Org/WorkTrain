/**
 * เตรียมฐาน PGlite บนเครื่อง dev: รัน migration ทุกไฟล์ (รวมร่าง ACL ผู้ช่วย 1 ใน 0001)
 *
 *   DATABASE_URL=pglite:.pglite node scripts/dev-setup.mjs
 *
 * ใช้คู่กับ WORKTRAIN_DEV_ACTOR="<เลข>:<อีเมล>:<ชื่อ>:admin|member|viewer" เพื่อสลับเป็นคนต่าง ๆ
 * ผังองค์กร (ตำแหน่ง · หัวหน้า · กลุ่ม LINE) ยังมาจาก WorkID จริง — ต้องตั้ง WORKID_API_KEY ด้วย
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const url = process.env.DATABASE_URL ?? "";
if (!url.startsWith("pglite:")) {
  console.error("ต้องตั้ง DATABASE_URL=pglite:<โฟลเดอร์> — สคริปต์นี้ไม่แตะ Neon");
  process.exit(1);
}
const pg = new PGlite(url.slice("pglite:".length) || ".pglite");
await pg.exec("create table if not exists __dev_migrations (tag text primary key)");
const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url)));
for (const { tag } of journal.entries) {
  const done = await pg.query("select 1 from __dev_migrations where tag = $1", [tag]);
  if (done.rows.length) continue;
  const file = readFileSync(new URL(`../drizzle/${tag}.sql`, import.meta.url), "utf8");
  for (const stmt of file.split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
  await pg.query("insert into __dev_migrations (tag) values ($1)", [tag]);
  console.log(`migrated ${tag}`);
}
console.log("พร้อมแล้ว");
await pg.close();
