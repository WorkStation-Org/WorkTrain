/**
 * error จากฐานที่ผู้เรียกต้องแยกออกจาก error อื่น — neon-http และ PGlite ห่อไม่เหมือนกัน
 * (drizzle ห่อ error ของไดรเวอร์ไว้ใน `cause`) จึงไล่ดูทั้งสายของ `cause`
 */

/** ชน unique index/constraint (SQLSTATE 23505) · `constraint` = ชื่อ index ที่ต้องเป็นตัวที่ชน (ไม่ใส่ = ตัวไหนก็ได้) */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const x = e as { code?: unknown; constraint?: unknown };
    if (x.code === "23505") return constraint === undefined || x.constraint === constraint;
  }
  return false;
}
