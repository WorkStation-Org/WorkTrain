import { db } from "@/db";

/**
 * รันหลายคำสั่งให้ลงหรือไม่ลงพร้อมกัน — **ห้ามใช้ `db().transaction()`**
 *
 * `batch()` ของ neon-http ส่งทุกคำสั่งไปในทรานแซกชันเดียวฝั่งเซิร์ฟเวอร์ จึงได้ atomicity จริง
 * บน production · ในเทสต์ (PGlite) ไม่มี `batch` จึงรันเรียงกัน — ตัวช่วยนี้รับประกันของบน
 * production ไม่ใช่ของในเทสต์ (ยกมาจาก WorkService `src/db/atomic.ts`)
 *
 * ⚠️ คำสั่งทุกตัวต้องประกอบให้ครบ**ก่อน**ส่ง ใช้ผลของคำสั่งแรกตัดสินคำสั่งถัดไปไม่ได้
 * (ใช้กับการบันทึก ACL พร้อมข้อยกเว้นรายคน — `src/db/acl.ts`)
 *
 * คืนผลของทุกคำสั่งตามลำดับ
 */
export async function atomic(queries: readonly PromiseLike<unknown>[]): Promise<unknown[]> {
  if (queries.length === 0) return [];
  const client = db() as unknown as { batch?: (q: readonly unknown[]) => Promise<unknown[]> };
  if (typeof client.batch === "function") return client.batch(queries);
  const results: unknown[] = [];
  for (const q of queries) results.push(await q);
  return results;
}
