import type { EndReason } from "@/db/schema";

/**
 * ตัดจบ · เปิดใหม่ · ซ่อนจากรายชื่อ (spec §5 · CONTEXT.md "ตัดจบ") — กติกาล้วน ไม่แตะฐานหรือ WorkID
 *
 * ★ ตัดจบ = ไม่ตรงเงื่อนไขผู้รับ/เส้นทาง Onboarding ปัจจุบันแล้ว ไม่ว่าเพราะลาออก ย้ายทีม/ตำแหน่ง ผู้สร้างแก้เงื่อนไข
 *   หรือหลุดจากกลุ่มเฉพาะกิจ · ตัดทั้งที่ผ่านแล้วและยังไม่ผ่าน (ผ่านแล้ว = ไม่รับเวอร์ชันใหม่ แต่ยังนับว่าผ่าน)
 * ★ กลับมาตรงเงื่อนไข = เปิดแถวเดิมใหม่ (หนึ่งคนมีได้แถวเดียวต่อชุด)
 */

export interface EndCandidate {
  id: number;
  setId: number;
  personId: number;
  passedAt: Date | null;
  endedAt: Date | null;
}

export interface EndPlan {
  end: { id: number; reason: EndReason }[];
  reopen: { id: number; passed: boolean }[];
}

/**
 * `eligible` = ชุด → คนที่ตรงเงื่อนไขตอนนี้ (ผู้รับ ∪ เส้นทาง Onboarding) · `inOrg` = คนที่ยังอยู่ในผัง
 * ★ ผู้เรียกต้องส่งเฉพาะชุดที่ใช้อยู่ และเฉพาะเมื่อถามผังได้ — ถามผังไม่ได้ต้องไม่เรียก (ไม่งั้นตัดจบทุกคน)
 */
export function planEnds(existing: readonly EndCandidate[], eligible: ReadonlyMap<number, ReadonlySet<number>>, inOrg: ReadonlySet<number>): EndPlan {
  const plan: EndPlan = { end: [], reopen: [] };
  for (const a of existing) {
    const matches = eligible.get(a.setId)?.has(a.personId) ?? false;
    if (a.endedAt === null && !matches) plan.end.push({ id: a.id, reason: inOrg.has(a.personId) ? "not_in_audience" : "left_org" });
    else if (a.endedAt !== null && matches) plan.reopen.push({ id: a.id, passed: a.passedAt !== null });
  }
  return plan;
}

/**
 * ด่านกันผังเพี้ยน — รอบ sync อัตโนมัติจะตัดจบเกิน 20 การมอบ หรือเกิน 10% ของการมอบที่ยังเปิดอยู่ = หยุดไว้ก่อน แจ้ง TG
 * ★ ใช้เฉพาะรอบอัตโนมัติ (cron) — ผู้สร้างกดบันทึกเงื่อนไขเองเห็นจำนวนและยืนยันแล้ว ไม่ติดด่าน
 */
export const END_GUARD_MAX = 20;
export const END_GUARD_RATIO = 0.1;

export function endGuardTripped(ends: number, open: number): boolean {
  return ends > END_GUARD_MAX || ends > open * END_GUARD_RATIO;
}

/**
 * ซ่อนจากรายชื่อ (แท็บผู้เรียน · Dashboard) ไหม — รวมไว้ในบรรทัด "ซ่อน n คน · แสดง"
 * - ไม่อยู่ในผังแล้ว (ลาออก) = ซ่อนเสมอ แม้ผ่านแล้ว · `inOrg` null = ถามผังไม่ได้ → ไม่ซ่อนเพราะเรื่องนี้ (ไม่ซ่อนทุกคนเพราะ WorkID ล่ม)
 * - ตัดจบที่ยังไม่ผ่าน = ซ่อน · ตัดจบที่ผ่านแล้ว (ย้ายทีมหลังผ่าน) = ยังแสดงว่าผ่าน
 */
export function hiddenFromLists(a: { personId: number; passedAt: Date | null; endedAt: Date | null }, inOrg: ReadonlySet<number> | null): boolean {
  if (inOrg && !inOrg.has(a.personId)) return true;
  return a.endedAt !== null && a.passedAt === null;
}

/** ข้อความสั้นของเหตุที่ซ่อน — แสดงเมื่อกด "แสดง" คนที่ซ่อน */
export function hiddenReason(a: { personId: number; endedAt: Date | null; endReason: EndReason | null }, inOrg: ReadonlySet<number> | null): string {
  if ((inOrg && !inOrg.has(a.personId)) || a.endReason === "left_org") return "ไม่อยู่ในผังแล้ว";
  return "ไม่ตรงเงื่อนไขผู้รับแล้ว";
}
