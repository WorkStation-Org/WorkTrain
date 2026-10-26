import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";

/**
 * Postgres จริงในหน่วยความจำ (PGlite) สำหรับเทสต์ — ยกแนวทางมาจาก WorkService `tests/helpers/pgdb.ts`
 *
 * ทำไมต้องเป็น Postgres จริง: กติกาสำคัญหลายข้อบังคับด้วยฐานข้อมูล ไม่ใช่ด้วยโค้ด —
 * `wd_assert` ที่ยกเลิก batch เมื่อชนกัน · trigger ที่ห้ามแก้ audit · unique ของเลขเรื่อง
 * mock ไม่มีวันจับบั๊กของสิ่งเหล่านี้ได้
 *
 * migration รันจากไฟล์จริงใน `drizzle/` ตาม `_journal.json` — แก้ migration แล้วพัง เทสต์แดงทันที
 */
type Holder = { __wtrTestPg?: { client: PGlite; db: PgliteDatabase<typeof schema> } };
const holder = globalThis as unknown as Holder;

export function testDb(): PgliteDatabase<typeof schema> {
  const h = holder.__wtrTestPg;
  if (!h) throw new Error("ต้องเรียก setupTestDb() ใน beforeAll ก่อน");
  return h.db;
}

/**
 * ★★ ทำให้ฐานของเทสต์ปฏิเสธ `transaction()` แบบเดียวกับ neon-http ของ production
 *
 * ความสามารถของสอง driver ตรงข้ามกันพอดี (production มี batch ไม่มี transaction · PGlite กลับกัน)
 * WorkService เคยมี endpoint ที่ใช้ transaction แล้วผ่านเทสต์ทุกครั้งแต่ 500 บน production ทุกครั้ง
 */
function refuseTransactions<T extends object>(instance: T): T {
  return new Proxy(instance, {
    get(target, prop, receiver) {
      if (prop === "transaction") {
        return () => {
          throw new Error("No transactions support in neon-http driver (จำลอง production — ใช้ atomic() แทน)");
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export async function setupTestDb(): Promise<void> {
  const client = new PGlite();
  holder.__wtrTestPg = { client, db: refuseTransactions(drizzle(client, { schema })) };

  const dir = path.resolve(process.cwd(), "drizzle");
  const journal = JSON.parse(fs.readFileSync(path.join(dir, "meta", "_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  for (const entry of journal.entries) {
    const file = fs.readFileSync(path.join(dir, `${entry.tag}.sql`), "utf8");
    for (const raw of file.split("--> statement-breakpoint")) {
      const stmt = raw.trim();
      if (stmt) await client.exec(stmt);
    }
  }
}

/** ล้างทุกตาราง — TRUNCATE ไม่ติด trigger ระดับแถวของ matter_events */
export async function truncateAll(): Promise<void> {
  const db = testDb();
  const rows = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
  const names = rows.rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await db.execute(sql.raw(`truncate table ${names} restart identity cascade`));
}
