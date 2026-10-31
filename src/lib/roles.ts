/**
 * role ของแอป `worktrain` ใน WorkID — แยกไฟล์จาก `auth.ts` โดยเจตนา
 *
 * `session.ts` ถูกเรียกจาก `proxy.ts` ซึ่งห้ามลาก `next/headers` (ที่ `auth.ts` ใช้) เข้ามา
 * และ `auth.ts` ก็ import `session.ts` อยู่แล้ว — ถ้าค่า `ROLES` อยู่ใน `auth.ts` จะเกิด import วน
 * ที่ทำให้ `ROLES` ยังไม่มีค่าตอน `session.ts` โหลด
 *
 * `user`   = พนักงานทุกคน (default role ของแอปที่ WorkID) — เรียน · สอบ · เห็นสถิติของตัวเอง
 * `author` = ผู้สร้าง (PD · Sales Manager ฯลฯ) — สร้างชุดการเรียนรู้ · เห็นผลของชุดที่ตัวเองสร้าง
 * `admin`  = TG — ทุกอย่าง · เห็นทุกคน
 *
 * ผู้อนุมัติกับหัวหน้าไม่ใช่ role — ผู้อนุมัติถูกระบุในชุดการเรียนรู้ · หัวหน้ามาจากผัง WorkID
 * (spec §1 · ADR-0004)
 */
export type Role = "admin" | "author" | "user";

export const ROLES: readonly Role[] = ["admin", "author", "user"];
