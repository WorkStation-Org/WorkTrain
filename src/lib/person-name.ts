import { fetchOrg } from "@/lib/workid";

/**
 * ชื่อคนจาก WorkID — WorkID ตอบชื่อเป็นสามฟิลด์ (WorkID ADR-0002 · README §ชื่อคน)
 *
 * - `fullName` = "ชื่อ-สกุล (ชื่อเล่น)" — **ไว้แสดงเท่านั้น** ห้ามแกะวงเล็บหรือตัดคำจากมัน
 * - `name` = ชื่อ-สกุลล้วน — ใช้ในที่ทางการ/บันทึก (snapshot "ใครทำ" ในแถวของฐาน · หน้ารายชื่อของ TG)
 * - `nickname` = ชื่อเล่น หรือ null — ใช้ในที่เรียกกัน (ข้อความ LINE · "สวัสดี …" · ชื่อบนเมนู)
 *
 * WorkID รุ่นเก่าที่ยังไม่ตอบ `name`/`nickname` ต้องใช้ต่อได้: `name ?? fullName` · `nickname ?? null`
 */
export interface PersonNames {
  name: string;
  nickname: string | null;
}

/** คำแรกของชื่อ — "สมชาย ใจดี" → "สมชาย" */
export function firstWord(s: string): string {
  return s.trim().split(/\s+/)[0] ?? "";
}

/**
 * ชื่อที่ใช้เรียกกัน — ชื่อเล่น ไม่มีก็คำแรกของ `name`
 *
 * ★ ข้อความ LINE ทุกข้อความใช้ตัวนี้ (เจ้าของตัดสิน 9 ต.ค. 2569: LINE แสดงชื่อเล่นเท่านั้น)
 */
export function callName(p: { name: string; nickname?: string | null }): string {
  return p.nickname?.trim() || firstWord(p.name) || p.name;
}

/**
 * หาชื่อเรียกของคนในข้อความ LINE — ตามด้วย personId จากผังปัจจุบัน · ไม่พบในผัง = คำแรกของชื่อที่เก็บไว้ในแถว
 *
 * ชื่อที่เก็บในแถว (snapshot) ของรายงานเก่าอาจเป็น "ชื่อ-สกุล (ชื่อเล่น)" — ไม่แกะวงเล็บ ใช้คำแรกพอ
 */
export type CallNames = (personId: number | null | undefined, snapshot: string) => string;

export function callNamesFrom(people: readonly ({ personId: number } & PersonNames)[]): CallNames {
  const byId = new Map(people.map((p) => [p.personId, p]));
  return (personId, snapshot) => {
    const p = personId == null ? undefined : byId.get(personId);
    return p ? callName(p) : firstWord(snapshot) || snapshot;
  };
}

/** ถามผังครั้งเดียวต่อรอบงาน (`fetchOrg` จำไว้ 5 นาทีอยู่แล้ว) · ถามไม่ได้ = ใช้คำแรกของชื่อในแถว ไม่ทำให้ส่งไม่ได้ */
export async function lineCallNames(): Promise<CallNames> {
  const org = await fetchOrg();
  return callNamesFrom(org.ok ? org.people : []);
}
