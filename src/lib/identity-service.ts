import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attempts, faceConsents, faceScans, studySessions, SCAN_RESULTS, type SCAN_PURPOSES } from "@/db/schema";
import { devShortcutAllowed } from "@/lib/dev";

/**
 * ความยินยอม PDPA + การสแกนใบหน้า (spec §8 · ADR-0006)
 *
 * ★ ไม่ยินยอม = ใช้แอปไม่ได้ — ทุกหน้าของผู้เรียนเรียก `hasConsent()` ก่อน
 * ★ ตัวเทียบใบหน้าเป็น `FaceVerifier` · ตัวจริง (AWS Rekognition Liveness + CompareFaces) ยังไม่ได้ทำ —
 *   ระหว่างนี้มีแค่ตัว dev ที่ตายบน Vercel ทุก environment · บน production จึงเริ่มเรียน/สอบไม่ได้จนกว่าจะมีตัวจริง
 */

/** ฉบับของข้อความยินยอม — แก้ข้อความ = เปลี่ยนเลขนี้ = ทุกคนต้องยินยอมใหม่ */
export const CONSENT_VERSION = "face-v1";

/** ใช้ผลสแกนเริ่มรอบเรียน/เริ่มสอบได้ภายในเวลานี้หลังสแกน */
export const SCAN_FRESH_MS = 5 * 60 * 1000;
/** ภาพสแกนเก็บ 90 วันแล้วลบ (spec §8) */
export const SCAN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export async function hasConsent(personId: number): Promise<boolean> {
  const rows = await db()
    .select({ v: faceConsents.consentVersion })
    .from(faceConsents)
    .where(and(eq(faceConsents.personId, personId), isNull(faceConsents.withdrawnAt)));
  return rows.some((r) => r.v === CONSENT_VERSION);
}

/** ยินยอม — ฉบับเก่าที่ยังมีผลถูกปิดก่อน (ยินยอมที่มีผลได้แถวเดียวต่อคน · ฐานบังคับ) */
export async function giveConsent(personId: number, now: Date = new Date()): Promise<void> {
  if (await hasConsent(personId)) return;
  await db()
    .update(faceConsents)
    .set({ withdrawnAt: now })
    .where(and(eq(faceConsents.personId, personId), isNull(faceConsents.withdrawnAt)));
  await db().insert(faceConsents).values({ personId, consentVersion: CONSENT_VERSION, consentedAt: now });
}

// ── การสแกน ────────────────────────────────────────────────────────────────

export type ScanPurpose = (typeof SCAN_PURPOSES)[number];
export type ScanResult = (typeof SCAN_RESULTS)[number];

export interface FaceVerifier {
  /** ตรวจคนจริง + เทียบกับใบหน้าที่ลงทะเบียน */
  verify(input: { personId: number }): Promise<{ result: ScanResult; similarity?: number; objectKey?: string }>;
}

/** ตัวเทียบสำหรับเครื่อง dev — ผ่านเสมอ · ตายบน Vercel ทุก environment */
export const devVerifier: FaceVerifier = {
  async verify() {
    if (!devShortcutAllowed()) throw new Error("devVerifier ใช้ได้เฉพาะบนเครื่อง dev");
    return { result: "pass" };
  },
};

/** ตัวเทียบที่ใช้จริงตอนนี้ · null = ยังไม่มี (production ก่อนมี AWS) */
export function faceVerifier(): FaceVerifier | null {
  return devShortcutAllowed() ? devVerifier : null;
}

export async function recordScan(input: {
  personId: number;
  purpose: ScanPurpose;
  verifier: FaceVerifier | null;
  now?: Date;
}): Promise<{ ok: true; scanId: number; passed: boolean } | { ok: false; error: string }> {
  if (!input.verifier) return { ok: false, error: "ยังไม่ได้ตั้งระบบสแกนใบหน้าบนเซิร์ฟเวอร์นี้" };
  const now = input.now ?? new Date();
  const out = await input.verifier.verify({ personId: input.personId });
  const [row] = await db()
    .insert(faceScans)
    .values({
      personId: input.personId,
      purpose: input.purpose,
      result: out.result,
      similarity: out.similarity === undefined ? null : String(out.similarity),
      objectKey: out.objectKey ?? null,
      deleteAfter: new Date(now.getTime() + SCAN_RETENTION_MS),
      createdAt: now,
    })
    .returning({ id: faceScans.id });
  return { ok: true, scanId: row.id, passed: out.result === "pass" };
}

/**
 * ผลสแกนนี้ใช้เริ่มรอบเรียน/สอบได้ไหม — ของคนนี้ · ตรงจุดประสงค์ · ผ่าน · ยังสด · ยังไม่ถูกใช้
 * (สแกนหนึ่งครั้งใช้ได้ครั้งเดียว — กันการสแกนตอนเช้าแล้วเอาไปใช้ทั้งวัน)
 */
export async function usableScan(input: { personId: number; scanId: number; purpose: ScanPurpose; now: Date }): Promise<string | null> {
  const [scan] = await db()
    .select()
    .from(faceScans)
    .where(and(eq(faceScans.id, input.scanId), eq(faceScans.personId, input.personId)));
  if (!scan) return "ไม่พบผลการสแกน";
  if (scan.purpose !== input.purpose) return "ผลสแกนนี้ใช้กับขั้นตอนอื่น";
  if (scan.result !== "pass") return "สแกนใบหน้าไม่ผ่าน";
  if (scan.createdAt.getTime() < input.now.getTime() - SCAN_FRESH_MS) return "ผลสแกนหมดอายุ สแกนใหม่";
  const usedBySession = await db().select({ id: studySessions.id }).from(studySessions).where(eq(studySessions.scanId, scan.id));
  const usedByAttempt = await db().select({ id: attempts.id }).from(attempts).where(eq(attempts.scanId, scan.id));
  if (usedBySession.length || usedByAttempt.length) return "ผลสแกนนี้ถูกใช้ไปแล้ว สแกนใหม่";
  return null;
}

