import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { atomic } from "@/db/atomic";
import { attempts, faceConsents, faceEnrollments, faceScans, studySessions, type SCAN_PURPOSES, type SCAN_RESULTS } from "@/db/schema";
import { devShortcutAllowed } from "@/lib/dev";
import { objectStore } from "@/lib/object-store";
import { LIVENESS_MIN_CONFIDENCE, MATCH_MIN_SIMILARITY, rekognitionConfigured, type FaceApi } from "@/lib/rekognition";
import { openBlob, signBlob } from "@/lib/session";
import type { Outcome } from "@/lib/set-service";

/**
 * ความยินยอม PDPA + ลงทะเบียนใบหน้า + การสแกน (spec §8 · ADR-0006)
 *
 * ★ ไม่ยินยอม = ใช้แอปไม่ได้ — ทุกหน้าของผู้เรียนเรียก `hasConsent()` ก่อน
 * ★ การสแกนจริงผ่าน `FaceApi` (AWS Rekognition Liveness + CompareFaces · `src/lib/rekognition.ts`)
 *   ไม่ได้ตั้ง AWS = บน production เริ่มเรียน/สอบไม่ได้ (ตั้งใจปิด ไม่ปล่อยผ่าน) · บนเครื่อง dev มีทางลัด `devScan()`
 */

/** ฉบับของข้อความยินยอม — แก้ข้อความ = เปลี่ยนเลขนี้ = ทุกคนต้องยินยอมใหม่ */
export const CONSENT_VERSION = "face-v1";

/** ใช้ผลสแกนเริ่มรอบเรียน/เริ่มสอบได้ภายในเวลานี้หลังสแกน */
export const SCAN_FRESH_MS = 5 * 60 * 1000;
/** ภาพสแกนเก็บ 90 วันแล้วลบ (spec §8) */
export const SCAN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/** สแกนไม่ผ่านติดกันเท่านี้ = ส่งให้ TG ตรวจภาพด้วยตา (spec §8) */
export const FAILS_BEFORE_REVIEW = 3;
/** TG ยืนยันแล้ว ใช้แทนการสแกนได้ภายในเวลานี้ (ครั้งเดียว) */
export const REVIEW_VALID_MS = 24 * 60 * 60 * 1000;
/** อายุใบสแกน (ระหว่างขอ session กับส่งผล) */
const SCAN_TICKET_MS = 10 * 60 * 1000;
const SCAN_TICKET_KIND = "worktrain.scan";

export type ScanPurpose = (typeof SCAN_PURPOSES)[number];
export type ScanResult = (typeof SCAN_RESULTS)[number];

// ── ความยินยอม ─────────────────────────────────────────────────────────────

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
  // ปิดฉบับเก่ากับลงฉบับใหม่ต้องไปด้วยกัน — ล้มระหว่างกลางไม่ทิ้งคนไว้แบบไม่มีความยินยอมเลย
  await atomic([
    db()
      .update(faceConsents)
      .set({ withdrawnAt: now })
      .where(and(eq(faceConsents.personId, personId), isNull(faceConsents.withdrawnAt))),
    db().insert(faceConsents).values({ personId, consentVersion: CONSENT_VERSION, consentedAt: now }),
  ]);
}

/**
 * ถอนความยินยอม (spec §8) — ลบใบหน้าที่ลงทะเบียน (ใช้อยู่ + ที่รอ TG) ออกจาก R2 · ปิดรอบเรียนที่เปิดอยู่
 * แล้วใช้แอปไม่ได้จนกว่าจะยินยอมใหม่ (ยินยอมใหม่ = ต้องลงทะเบียนใบหน้าใหม่)
 *
 * ★ ลบไฟล์ก่อน แล้วค่อยลงฐานพร้อมกันใน `atomic()` — ล้มกลางทาง = ยังถือว่ายินยอมอยู่ กดถอนซ้ำได้
 *   (ไม่มีทางที่ฐานบอกว่าลบแล้วแต่ภาพยังอยู่)
 * ★ ภาพจากการสแกนยังอยู่จนครบ 90 วันตามที่แจ้งไว้ในหน้ายินยอม (หลักฐานการเรียน/สอบที่ผ่านมา)
 */
export async function withdrawConsent(personId: number, now: Date = new Date()): Promise<Outcome<{ imagesDeleted: number }>> {
  if (!(await hasConsent(personId))) return { ok: false, error: "ยังไม่ได้ให้ความยินยอม" };
  const faces = await db()
    .select()
    .from(faceEnrollments)
    .where(and(eq(faceEnrollments.personId, personId), inArray(faceEnrollments.status, ["active", "pending"])));
  const withImage = faces.filter((f) => f.objectKey);
  if (withImage.length) {
    const store = objectStore();
    // ลบไม่ได้ = ไม่ถอน (ไม่บอกผู้ใช้ว่าลบแล้วทั้งที่ภาพยังอยู่)
    if (!store) return { ok: false, error: "ยังไม่ได้ตั้งที่เก็บไฟล์ (R2) บนเซิร์ฟเวอร์นี้ — ลบภาพไม่ได้ แจ้ง TG" };
    for (const f of withImage) await store.delete(f.objectKey!);
  }
  await atomic([
    db()
      .update(faceConsents)
      .set({ withdrawnAt: now })
      .where(and(eq(faceConsents.personId, personId), isNull(faceConsents.withdrawnAt))),
    ...(faces.length
      ? [db().update(faceEnrollments).set({ status: "deleted", objectKey: null }).where(inArray(faceEnrollments.id, faces.map((f) => f.id)))]
      : []),
    db().update(studySessions).set({ endedAt: now, endReason: "logout" }).where(and(eq(studySessions.personId, personId), isNull(studySessions.endedAt))),
  ]);
  return { ok: true, imagesDeleted: withImage.length };
}

// ── ลงทะเบียนใบหน้า ─────────────────────────────────────────────────────────

export type EnrollmentState = { state: "none" } | { state: "active"; pending: boolean } | { state: "pending_only" };

export async function enrollmentState(personId: number): Promise<EnrollmentState> {
  const rows = await db()
    .select({ status: faceEnrollments.status })
    .from(faceEnrollments)
    .where(and(eq(faceEnrollments.personId, personId), inArray(faceEnrollments.status, ["active", "pending"])));
  const active = rows.some((r) => r.status === "active");
  const pending = rows.some((r) => r.status === "pending");
  if (active) return { state: "active", pending };
  return pending ? { state: "pending_only" } : { state: "none" };
}

async function activeEnrollment(personId: number) {
  const [row] = await db()
    .select()
    .from(faceEnrollments)
    .where(and(eq(faceEnrollments.personId, personId), eq(faceEnrollments.status, "active")));
  return row ?? null;
}

/**
 * แยก prefix ตามอายุภาพ: `faces/enroll/` เก็บจนถูกแทน · `faces/scan/` ลบเมื่อครบ 90 วัน
 * — lifecycle rule ของ R2 ลบ `faces/scan/` ซ้ำอีกชั้นได้โดยไม่แตะภาพลงทะเบียน
 */
function imageKey(personId: number, kind: "enroll" | "scan"): string {
  return `faces/${kind}/${personId}/${randomBytes(12).toString("hex")}.jpg`;
}

// ── การสแกน ────────────────────────────────────────────────────────────────

/** สแกนแบบไหนได้บนเซิร์ฟเวอร์นี้ — AWS ตั้งครบ · เครื่อง dev (ทางลัด) · ปิด (production ที่ยังไม่มี AWS) */
export function scanMode(): "aws" | "dev" | "off" {
  if (rekognitionConfigured()) return "aws";
  return devShortcutAllowed() ? "dev" : "off";
}

/** ขั้นที่ 1 — เปิด liveness session · คืนใบสแกนที่เซ็นแล้ว (ผูกคน + จุดประสงค์) ไว้ยืนยันในขั้นที่ 2 */
export async function beginScan(input: { personId: number; purpose: ScanPurpose; api: FaceApi | null; now?: Date }): Promise<
  Outcome<{ sessionId: string; region: string; ticket: string }>
> {
  if (!input.api) return { ok: false, error: "ยังไม่ได้ตั้งระบบสแกนใบหน้าบนเซิร์ฟเวอร์นี้" };
  const enrolled = await enrollmentState(input.personId);
  if (input.purpose !== "enroll" && enrolled.state !== "active") return { ok: false, error: "ต้องลงทะเบียนใบหน้าก่อน" };
  if (input.purpose === "enroll" && (enrolled.state === "pending_only" || (enrolled.state === "active" && enrolled.pending))) {
    return { ok: false, error: "มีคำขอลงทะเบียนใบหน้าที่รอ TG อนุมัติอยู่แล้ว" };
  }
  const sessionId = await input.api.createLivenessSession();
  const now = (input.now ?? new Date()).getTime();
  const ticket = await signBlob({ kind: SCAN_TICKET_KIND, sessionId, personId: input.personId, purpose: input.purpose, exp: now + SCAN_TICKET_MS });
  return { ok: true, sessionId, region: input.api.region, ticket };
}

export interface ScanOutcome {
  scanId: number;
  passed: boolean;
  /** เฉพาะการลงทะเบียน: active = ใช้ได้ทันที (ครั้งแรก) · pending = รอ TG อนุมัติ (ลงทะเบียนใหม่) */
  enrollment?: "active" | "pending";
}

/**
 * ขั้นที่ 2 — อ่านผล liveness แล้วเทียบกับใบหน้าที่ลงทะเบียน **ฝั่งเซิร์ฟเวอร์** · ลงผลทุกครั้ง (รวมที่ไม่ผ่าน)
 */
export async function finishScan(input: { personId: number; ticket: string; api: FaceApi | null; now?: Date }): Promise<Outcome<ScanOutcome>> {
  if (!input.api) return { ok: false, error: "ยังไม่ได้ตั้งระบบสแกนใบหน้าบนเซิร์ฟเวอร์นี้" };
  const store = objectStore();
  if (!store) return { ok: false, error: "ยังไม่ได้ตั้งที่เก็บไฟล์ (R2) บนเซิร์ฟเวอร์นี้" };
  const now = input.now ?? new Date();
  const t = (await openBlob(input.ticket)) as { kind?: string; sessionId?: string; personId?: number; purpose?: ScanPurpose; exp?: number } | null;
  if (!t || t.kind !== SCAN_TICKET_KIND || t.personId !== input.personId || !t.sessionId || !t.purpose) return { ok: false, error: "ใบสแกนไม่ถูกต้อง" };
  if ((t.exp ?? 0) < now.getTime()) return { ok: false, error: "ใบสแกนหมดอายุ สแกนใหม่" };
  const purpose = t.purpose;

  // จอง liveness session ก่อนอ่านผล — ใบสแกนหนึ่งใบได้ผลแถวเดียว (ส่งซ้ำ/ส่งพร้อมกัน = ปฏิเสธ)
  // แถวเริ่มเป็น `error` แล้วแก้เป็นผลจริงด้านล่าง · ล้มกลางทางค้างเป็น `error` ซึ่งใช้เริ่มอะไรไม่ได้
  const [claimed] = await db()
    .insert(faceScans)
    .values({
      personId: input.personId,
      purpose,
      result: "error",
      livenessSessionId: t.sessionId,
      deleteAfter: new Date(now.getTime() + SCAN_RETENTION_MS),
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: faceScans.id });
  if (!claimed) return { ok: false, error: "ใบสแกนนี้ใช้ไปแล้ว สแกนใหม่" };
  const scanId = claimed.id;
  const record = async (result: ScanResult, similarity: number | null) => {
    await db()
      .update(faceScans)
      .set({ result, similarity: similarity === null ? null : similarity.toFixed(2) })
      .where(eq(faceScans.id, scanId));
    return { scanId };
  };

  const live = await input.api.livenessResult(t.sessionId);
  const isLive = live.status === "SUCCEEDED" && (live.confidence ?? 0) >= LIVENESS_MIN_CONFIDENCE && live.referenceImage !== null;
  let scanImageKey: string | null = null;
  if (live.referenceImage && !(purpose === "enroll" && isLive)) {
    // ภาพสแกน (รวมการลงทะเบียนที่ไม่ผ่าน liveness) ลบเมื่อครบ 90 วัน — ลงคีย์ในแถวก่อนอัปโหลด
    // ให้ cron เห็นเสมอแม้ขั้นถัดไปล้ม (ไม่มีภาพกำพร้าใน R2)
    scanImageKey = imageKey(input.personId, "scan");
    await db().update(faceScans).set({ objectKey: scanImageKey }).where(eq(faceScans.id, scanId));
    await store.put(scanImageKey, live.referenceImage, "image/jpeg");
  }
  if (!isLive) return { ok: true, ...(await record("liveness_fail", null)), passed: false };

  if (purpose === "enroll") {
    const enrollKey = imageKey(input.personId, "enroll");
    await store.put(enrollKey, live.referenceImage!, "image/jpeg");
    // เคยมีใบหน้ามาก่อน (ใช้อยู่ · ถูกแทน · ถูกลบตอนถอนความยินยอม) = ลงทะเบียนใหม่ ต้องให้ TG อนุมัติ
    // — ไม่อย่างนั้น "ถอนแล้วยินยอมใหม่" จะเป็นทางลงทะเบียนหน้าคนอื่นแทนโดยไม่มีใครดู
    const hadBefore = (
      await db()
        .select({ id: faceEnrollments.id })
        .from(faceEnrollments)
        .where(and(eq(faceEnrollments.personId, input.personId), inArray(faceEnrollments.status, ["active", "superseded", "deleted"])))
        .limit(1)
    ).length > 0;
    const status = hadBefore ? "pending" : "active";
    await db().insert(faceEnrollments).values({ personId: input.personId, objectKey: enrollKey, status, createdAt: now });
    return { ok: true, ...(await record("pass", null)), passed: true, enrollment: status };
  }

  const enrolled = await activeEnrollment(input.personId);
  const enrolledBytes = enrolled?.objectKey ? await store.get(enrolled.objectKey) : null;
  if (!enrolledBytes) return { ok: false, error: "ไม่พบภาพใบหน้าที่ลงทะเบียน — ขอลงทะเบียนใหม่" };
  const similarity = await input.api.compareFaces(enrolledBytes, live.referenceImage!);
  const result: ScanResult = similarity !== null && similarity >= MATCH_MIN_SIMILARITY ? "pass" : "no_match";
  return { ok: true, ...(await record(result, similarity)), passed: result === "pass" };
}

async function insertScan(personId: number, purpose: ScanPurpose, result: ScanResult, now: Date): Promise<{ scanId: number }> {
  const [row] = await db()
    .insert(faceScans)
    .values({ personId, purpose, result, deleteAfter: new Date(now.getTime() + SCAN_RETENTION_MS), createdAt: now })
    .returning({ id: faceScans.id });
  return { scanId: row.id };
}

/**
 * ทางลัดบนเครื่อง dev — ผ่านเสมอโดยไม่มีกล้อง · ตายบน Vercel ทุก environment
 * ลงทะเบียนครั้งแรกได้ใบหน้าที่ไม่มีภาพ (ใช้ได้กับทางลัดนี้เท่านั้น — สแกนจริงจะบอกให้ลงทะเบียนใหม่)
 */
export async function devScan(input: { personId: number; purpose: ScanPurpose; now?: Date }): Promise<Outcome<ScanOutcome>> {
  if (!devShortcutAllowed()) return { ok: false, error: "ทางลัดสแกนใช้ได้เฉพาะบนเครื่อง dev" };
  const now = input.now ?? new Date();
  const state = await enrollmentState(input.personId);
  if (input.purpose === "enroll") {
    if (state.state !== "none") return { ok: false, error: "ลงทะเบียนใบหน้าแล้ว" };
    await db().insert(faceEnrollments).values({ personId: input.personId, objectKey: null, status: "active", createdAt: now });
    return { ok: true, ...(await insertScan(input.personId, "enroll", "pass", now)), passed: true, enrollment: "active" };
  }
  if (state.state !== "active") return { ok: false, error: "ต้องลงทะเบียนใบหน้าก่อน" };
  return { ok: true, ...(await insertScan(input.personId, input.purpose, "pass", now)), passed: true };
}

/**
 * ผลสแกนนี้ใช้เริ่มรอบเรียน/สอบได้ไหม — ของคนนี้ · ตรงจุดประสงค์ · ผ่าน (หรือ TG ยืนยันแล้ว) · ยังสด · ยังไม่ถูกใช้
 * (สแกนหนึ่งครั้งใช้ได้ครั้งเดียว — กันการสแกนตอนเช้าแล้วเอาไปใช้ทั้งวัน)
 */
export async function usableScan(input: { personId: number; scanId: number; purpose: ScanPurpose; now: Date }): Promise<string | null> {
  const [scan] = await db()
    .select()
    .from(faceScans)
    .where(and(eq(faceScans.id, input.scanId), eq(faceScans.personId, input.personId)));
  if (!scan) return "ไม่พบผลการสแกน";
  if (scan.purpose !== input.purpose) return "ผลสแกนนี้ใช้กับขั้นตอนอื่น";
  const confirmed = scan.review === "confirmed" && scan.reviewedAt !== null;
  if (scan.result !== "pass" && !confirmed) return "สแกนใบหน้าไม่ผ่าน";
  if (scan.result !== "pass" && confirmed) {
    // TG ยืนยันทั้งชุดพร้อมกัน แต่ใช้แทนการสแกนได้ครั้งเดียว — เฉพาะสแกนล่าสุดของชุด
    const [latest] = await db()
      .select({ id: faceScans.id })
      .from(faceScans)
      .where(and(eq(faceScans.personId, input.personId), eq(faceScans.review, "confirmed"), eq(faceScans.reviewedAt, scan.reviewedAt!)))
      .orderBy(desc(faceScans.createdAt), desc(faceScans.id))
      .limit(1);
    if (latest?.id !== scan.id) return "ผลที่ TG ยืนยันใช้ได้ครั้งเดียว";
  }
  const freshFrom = confirmed ? scan.reviewedAt!.getTime() : scan.createdAt.getTime();
  const window = confirmed ? REVIEW_VALID_MS : SCAN_FRESH_MS;
  if (freshFrom < input.now.getTime() - window) return "ผลสแกนหมดอายุ สแกนใหม่";
  const usedBySession = await db().select({ id: studySessions.id }).from(studySessions).where(eq(studySessions.scanId, scan.id));
  const usedByAttempt = await db().select({ id: attempts.id }).from(attempts).where(eq(attempts.scanId, scan.id));
  if (usedBySession.length || usedByAttempt.length) return "ผลสแกนนี้ถูกใช้ไปแล้ว สแกนใหม่";
  return null;
}

/** ผลสแกนที่ TG ยืนยันแล้วและยังใช้ได้ (ล่าสุด) ของจุดประสงค์นี้ — หน้าผู้เรียนใช้แทนการสแกนใหม่ */
export async function confirmedScanFor(personId: number, purpose: ScanPurpose, now: Date = new Date()): Promise<number | null> {
  const rows = await db()
    .select({ id: faceScans.id })
    .from(faceScans)
    .where(and(eq(faceScans.personId, personId), eq(faceScans.purpose, purpose), eq(faceScans.review, "confirmed")))
    // ทั้งชุดถูกตรวจพร้อมกัน (reviewedAt เท่ากัน) — เลือกสแกนล่าสุดของชุดเสมอ
    .orderBy(desc(faceScans.reviewedAt), desc(faceScans.createdAt), desc(faceScans.id))
    .limit(5);
  for (const r of rows) if ((await usableScan({ personId, scanId: r.id, purpose, now })) === null) return r.id;
  return null;
}

// ── TG ตรวจ ────────────────────────────────────────────────────────────────

/** สแกนเรียน/สอบล่าสุดของคนนี้ไม่ผ่านติดกันกี่ครั้ง (นับจากล่าสุดย้อนไปจนเจอที่ผ่านหรือ TG ตรวจแล้ว) */
export async function consecutiveFails(personId: number): Promise<number> {
  const rows = await db()
    .select({ result: faceScans.result, review: faceScans.review })
    .from(faceScans)
    .where(and(eq(faceScans.personId, personId), inArray(faceScans.purpose, ["study", "exam"])))
    .orderBy(desc(faceScans.createdAt), desc(faceScans.id))
    .limit(20);
  let n = 0;
  for (const r of rows) {
    if (r.result === "pass" || r.review !== null) break;
    n += 1;
  }
  return n;
}

/** คิวของ TG (spec §8): คนที่สแกนไม่ผ่านติดกันตั้งแต่ 3 ครั้ง (พร้อมภาพทั้งชุด) + คำขอลงทะเบียนใบหน้าใหม่ */
export async function reviewQueue() {
  const failed = await db()
    .select()
    .from(faceScans)
    .where(and(inArray(faceScans.purpose, ["study", "exam"]), isNull(faceScans.review)))
    .orderBy(desc(faceScans.createdAt), desc(faceScans.id));
  const byPerson = new Map<number, (typeof failed)[number][]>();
  for (const s of failed) byPerson.set(s.personId, [...(byPerson.get(s.personId) ?? []), s]);
  const scanReviews: { personId: number; scans: (typeof failed)[number][] }[] = [];
  for (const [personId, scans] of byPerson) {
    const n = await consecutiveFails(personId);
    if (n >= FAILS_BEFORE_REVIEW) scanReviews.push({ personId, scans: scans.slice(0, n) });
  }
  const enrollments = await db().select().from(faceEnrollments).where(eq(faceEnrollments.status, "pending")).orderBy(faceEnrollments.createdAt);
  return { scanReviews, enrollments };
}

/**
 * TG ตรวจภาพที่สแกนไม่ผ่านด้วยตา — ยืนยัน = สแกนล่าสุดใช้เริ่มเรียน/สอบได้ภายใน 24 ชม. (ครั้งเดียว) · ปฏิเสธ = ต้องสแกนใหม่
 * ทั้งชุดที่ไม่ผ่านติดกันถูกปิดด้วยผลเดียวกัน (ไม่ขึ้นในคิวอีก)
 */
export async function reviewFailedScans(input: { reviewerPersonId: number; personId: number; confirm: boolean; now?: Date }): Promise<
  Outcome<{ scanId: number }>
> {
  const now = input.now ?? new Date();
  if (input.reviewerPersonId === input.personId) return { ok: false, error: "ตรวจการสแกนของตัวเองไม่ได้ — ให้ TG คนอื่นตรวจ" };
  const n = await consecutiveFails(input.personId);
  if (n < FAILS_BEFORE_REVIEW) return { ok: false, error: "ไม่มีชุดสแกนที่รอตรวจของคนนี้" };
  const rows = await db()
    .select({ id: faceScans.id })
    .from(faceScans)
    .where(and(eq(faceScans.personId, input.personId), inArray(faceScans.purpose, ["study", "exam"])))
    .orderBy(desc(faceScans.createdAt), desc(faceScans.id))
    .limit(n);
  await db()
    .update(faceScans)
    .set({ review: input.confirm ? "confirmed" : "rejected", reviewedByPersonId: input.reviewerPersonId, reviewedAt: now })
    .where(inArray(faceScans.id, rows.map((r) => r.id)));
  return { ok: true, scanId: rows[0].id };
}

/** TG อนุมัติ/ปฏิเสธคำขอลงทะเบียนใบหน้าใหม่ — อนุมัติ = ใบหน้าเดิมถูกแทน (กันการลงทะเบียนหน้าคนอื่นแทน) */
export async function reviewEnrollment(input: { reviewerPersonId: number; enrollmentId: number; approve: boolean; now?: Date }): Promise<Outcome> {
  const now = input.now ?? new Date();
  const [e] = await db().select().from(faceEnrollments).where(eq(faceEnrollments.id, input.enrollmentId));
  if (!e || e.status !== "pending") return { ok: false, error: "ไม่มีคำขอนี้ หรือมีคนตัดสินไปแล้ว" };
  if (e.personId === input.reviewerPersonId) return { ok: false, error: "อนุมัติใบหน้าของตัวเองไม่ได้ — ให้ TG คนอื่นตรวจ" };
  if (!input.approve) {
    await db()
      .update(faceEnrollments)
      .set({ status: "rejected", reviewedByPersonId: input.reviewerPersonId, reviewedAt: now })
      .where(eq(faceEnrollments.id, e.id));
  } else {
    await atomic([
      db()
        .update(faceEnrollments)
        .set({ status: "superseded" })
        .where(and(eq(faceEnrollments.personId, e.personId), eq(faceEnrollments.status, "active"))),
      db().update(faceEnrollments).set({ status: "active", reviewedByPersonId: input.reviewerPersonId, reviewedAt: now }).where(eq(faceEnrollments.id, e.id)),
    ]);
  }
  // ภาพที่ถูกปฏิเสธ/ถูกแทนไม่มีเหตุให้เก็บต่อ (spec §8 · PDPA) — ล้มตรงนี้ cron เช้าลบซ้ำให้
  await deleteRetiredEnrollmentImages(e.personId);
  return { ok: true };
}

/**
 * ลบภาพของใบหน้าที่ถูกแทน (`superseded`) หรือถูกปฏิเสธ (`rejected`) — ลบจาก R2 ก่อนแล้วค่อยล้างคีย์
 * (ลบไม่สำเร็จ = คีย์ยังอยู่ รอบถัดไปลองใหม่) · `personId` = เฉพาะคนนั้น · ไม่ใส่ = ทุกคน (cron) · คืนจำนวนที่ลบ
 */
export async function deleteRetiredEnrollmentImages(personId?: number, limit = 500): Promise<number> {
  const store = objectStore();
  if (!store) return 0;
  const retired = and(inArray(faceEnrollments.status, ["superseded", "rejected"]), isNotNull(faceEnrollments.objectKey));
  const rows = await db()
    .select({ id: faceEnrollments.id, objectKey: faceEnrollments.objectKey })
    .from(faceEnrollments)
    .where(personId === undefined ? retired : and(retired, eq(faceEnrollments.personId, personId)))
    .limit(limit);
  for (const r of rows) {
    await store.delete(r.objectKey!);
    await db().update(faceEnrollments).set({ objectKey: null }).where(eq(faceEnrollments.id, r.id));
  }
  return rows.length;
}

/** ลิงก์ดูภาพใบหน้าอายุสั้น — TG เท่านั้น (ผู้เรียกตรวจสิทธิ์) */
export async function faceImageLink(objectKey: string): Promise<string | null> {
  const store = objectStore();
  return store ? store.presignGet({ key: objectKey, contentType: "image/jpeg", disposition: "inline" }) : null;
}

/** ลบภาพสแกนที่ครบ 90 วัน (spec §8) — รันใน cron เช้า · คืนจำนวนที่ลบ */
export async function deleteExpiredScanImages(now: Date = new Date(), limit = 500): Promise<number> {
  const store = objectStore();
  if (!store) return 0;
  const rows = await db()
    .select({ id: faceScans.id, objectKey: faceScans.objectKey })
    .from(faceScans)
    .where(and(isNotNull(faceScans.objectKey), lt(faceScans.deleteAfter, now)))
    .limit(limit);
  for (const r of rows) {
    await store.delete(r.objectKey!);
    await db().update(faceScans).set({ objectKey: null }).where(eq(faceScans.id, r.id));
  }
  return rows.length;
}
