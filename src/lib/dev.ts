/**
 * ทางลัดของเครื่อง dev — ใช้ได้เฉพาะตอนรันบนเครื่อง บน Vercel (ทุก environment) ตายเสมอ
 *
 * แยกไฟล์เพราะ `workid.ts` (ถูก `proxy.ts` เรียก) ใช้ด้วย แต่ห้ามลาก `next/headers` ของ `auth.ts` ตามมา
 *
 * ทำไมต้องเช็คทั้ง `VERCEL` และ `NODE_ENV`: preview deploy ของ Vercel ก็เป็น `NODE_ENV=production`
 * และ env มักถูกตั้งครอบทุก environment พร้อมกัน — ทางลัดต้องตายเพราะ **ที่ที่มันรันอยู่** (ข้อ 16)
 */
export function devShortcutAllowed(): boolean {
  return !process.env.VERCEL && process.env.NODE_ENV !== "production";
}
