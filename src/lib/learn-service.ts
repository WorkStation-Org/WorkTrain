import { randomInt } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { atomic } from "@/db/atomic";
import {
  assignments,
  attempts,
  choices,
  documentViews,
  documents,
  examForms,
  learningSets,
  questions,
  readingProgress,
  setVersions,
  studySessions,
  versionAcknowledgements,
  type FormKind,
} from "@/db/schema";
import {
  buildLayout,
  currentIndex,
  leaveForcesSubmit,
  needsRelearn,
  pickForm,
  score,
  type LayoutItem,
  type Rng,
} from "@/domain/exam";
import { usableScan } from "@/lib/identity-service";
import { objectStore } from "@/lib/object-store";
import type { Outcome } from "@/lib/set-service";
import { formatBangkok } from "@/lib/time";
import { watermarkPdf } from "@/lib/watermark";

/**
 * ฝั่งผู้เรียน (spec §9 · §10) — รอบเรียน · ความคืบหน้าการอ่าน · ครั้งที่สอบ
 *
 * ★ ทุกฟังก์ชันรับ `personId` ของคนที่ล็อกอิน แล้วตรวจเองว่าการมอบ/ครั้งที่สอบเป็นของคนนี้ — ไม่เชื่อ id จากหน้าจอ
 * ★ เวลามาจากเซิร์ฟเวอร์เสมอ (`now`) — หมดเวลาสอบตัดสินที่นี่ ไม่ใช่ที่นาฬิกาของเบราว์เซอร์
 * ★ Pricelist ไม่ส่งไฟล์ต้นฉบับ — `pricelistPdf()` ประทับลายน้ำของคนเปิดลงทุกหน้าก่อนส่ง (ADR-0010) · Excel ยังแสดงไม่ได้
 */

/** นิ่งเกินนี้ = จบรอบเรียน ต้องสแกนใหม่ (spec §9) */
export const IDLE_END_MS = 2 * 60 * 1000;
/** เวลาอ่านที่รับต่อ heartbeat หนึ่งครั้ง — กันเบราว์เซอร์ส่งตัวเลขเกินจริง */
export const MAX_SECONDS_PER_BEAT = 30;

const secureRng: Rng = () => randomInt(0, 2 ** 32) / 2 ** 32;

type AssignmentRow = typeof assignments.$inferSelect;
type SetRow = typeof learningSets.$inferSelect;

async function myAssignment(personId: number, assignmentId: number): Promise<{ a: AssignmentRow; set: SetRow } | null> {
  const [row] = await db()
    .select({ a: assignments, set: learningSets })
    .from(assignments)
    .innerJoin(learningSets, eq(learningSets.id, assignments.setId))
    .where(and(eq(assignments.id, assignmentId), eq(assignments.personId, personId)));
  return row ?? null;
}

/** เวอร์ชันล่าสุดที่อนุมัติแล้ว — ผู้เรียนเห็นและสอบจากเวอร์ชันนี้ */
async function approvedVersion(setId: number) {
  const rows = await db()
    .select()
    .from(setVersions)
    .where(eq(setVersions.setId, setId))
    .orderBy(desc(setVersions.versionNo));
  return rows.find((v) => v.approvedAt !== null) ?? null;
}

/** เอกสารที่ผู้เรียนต้องอ่าน — PDF ทุกชนิด (Pricelist แสดงแบบมีลายน้ำ) · Excel ยังแสดงทีละหน้าไม่ได้ */
async function requiredDocuments(versionId: number) {
  const rows = await db().select().from(documents).where(eq(documents.versionId, versionId)).orderBy(asc(documents.sortOrder));
  return rows.filter((d) => d.pageCount !== null);
}

// ── เวอร์ชันใหม่ (spec §7 · ADR-0008) ───────────────────────────────────────

type VersionRow = typeof setVersions.$inferSelect;

export interface PendingUpdate {
  version: VersionRow;
  kind: "small" | "large";
}

/**
 * สิ่งที่ผู้เรียนที่ผ่านแล้วยังค้างจากเวอร์ชันใหม่ — เวอร์ชันที่อนุมัติหลังวันที่ผ่าน เรียงเก่าไปใหม่ ทีละเวอร์ชัน
 * เปลี่ยนเล็ก = ต้องกดรับทราบ · เปลี่ยนใหญ่ = ต้องสอบส่วนที่เปลี่ยนให้ผ่าน · ไม่มีค้าง = null
 * ★ ผ่านแล้วไม่ย้อนกลับเป็นไม่ผ่าน (`passedAt` คงเดิม) — WorkHR และ Dashboard ยังนับว่าผ่าน
 */
export async function pendingUpdate(a: Pick<AssignmentRow, "id" | "setId" | "passedAt">): Promise<PendingUpdate | null> {
  if (!a.passedAt) return null;
  const later = await db()
    .select()
    .from(setVersions)
    .where(and(eq(setVersions.setId, a.setId), isNotNull(setVersions.approvedAt), gt(setVersions.approvedAt, a.passedAt), gt(setVersions.versionNo, 1)))
    .orderBy(asc(setVersions.versionNo));
  if (!later.length) return null;
  const acked = await db().select({ versionId: versionAcknowledgements.versionId }).from(versionAcknowledgements).where(eq(versionAcknowledgements.assignmentId, a.id));
  const deltaPassed = await db()
    .select({ versionId: attempts.versionId })
    .from(attempts)
    .where(and(eq(attempts.assignmentId, a.id), eq(attempts.kind, "delta"), eq(attempts.passed, true)));
  const ack = new Set(acked.map((r) => r.versionId));
  const passedDelta = new Set(deltaPassed.map((r) => r.versionId));
  for (const v of later) {
    if (v.changeKind === "small" && !ack.has(v.id)) return { version: v, kind: "small" };
    if (v.changeKind === "large" && !passedDelta.has(v.id)) return { version: v, kind: "large" };
  }
  return null;
}

/** รับทราบเปลี่ยนเล็ก — เฉพาะเวอร์ชันที่ค้างอยู่ตอนนี้ (กดข้ามเวอร์ชันไม่ได้) */
export async function acknowledgeVersion(input: { personId: number; assignmentId: number; versionId: number; now?: Date }): Promise<Outcome> {
  const mine = await myAssignment(input.personId, input.assignmentId);
  if (!mine || mine.set.status !== "active") return { ok: false, error: "ไม่พบการมอบนี้" };
  const p = await pendingUpdate(mine.a);
  if (!p || p.kind !== "small" || p.version.id !== input.versionId) return { ok: false, error: "ไม่มีเวอร์ชันที่ต้องรับทราบ" };
  await db()
    .insert(versionAcknowledgements)
    .values({ assignmentId: mine.a.id, versionId: p.version.id, acknowledgedAt: input.now ?? new Date() })
    .onConflictDoNothing();
  return { ok: true };
}

// ── รอบเรียน ───────────────────────────────────────────────────────────────

/** รอบเรียนที่ยังเปิดอยู่ · นิ่งเกิน 2 นาที = ปิดเป็น `idle` แล้วคืน null */
export async function activeSession(personId: number, now: Date) {
  const [open] = await db()
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.personId, personId), isNull(studySessions.endedAt)));
  if (!open) return null;
  if (open.lastActiveAt.getTime() < now.getTime() - IDLE_END_MS) {
    await db()
      .update(studySessions)
      .set({ endedAt: now, endReason: "idle" })
      .where(and(eq(studySessions.id, open.id), isNull(studySessions.endedAt)));
    return null;
  }
  return open;
}

/** เริ่มรอบเรียนด้วยผลสแกนที่ผ่าน — รอบเก่าที่ค้างถูกปิดก่อน (login ใหม่ = รอบใหม่) */
export async function startStudySession(input: { personId: number; scanId: number; now?: Date }): Promise<Outcome<{ sessionId: number }>> {
  const now = input.now ?? new Date();
  const bad = await usableScan({ personId: input.personId, scanId: input.scanId, purpose: "study", now });
  if (bad) return { ok: false, error: bad };
  await db()
    .update(studySessions)
    .set({ endedAt: now, endReason: "expired" })
    .where(and(eq(studySessions.personId, input.personId), isNull(studySessions.endedAt)));
  const [row] = await db()
    .insert(studySessions)
    .values({ personId: input.personId, scanId: input.scanId, startedAt: now, lastActiveAt: now })
    .returning({ id: studySessions.id });
  return { ok: true, sessionId: row.id };
}

export async function endStudySession(personId: number, now: Date = new Date()): Promise<void> {
  await db()
    .update(studySessions)
    .set({ endedAt: now, endReason: "logout" })
    .where(and(eq(studySessions.personId, personId), isNull(studySessions.endedAt)));
}

// ── การอ่าน ────────────────────────────────────────────────────────────────

/**
 * heartbeat ระหว่างอ่าน — หน้าที่เห็น + เวลาที่แท็บอยู่หน้าและมีการขยับ (เบราว์เซอร์ส่งทุก ~15 วินาที)
 * ไม่มีรอบเรียนที่เปิดอยู่ = ไม่นับ และบอกให้สแกนใหม่
 */
export async function recordReading(input: {
  personId: number;
  assignmentId: number;
  documentId: number;
  pages: number[];
  activeSeconds: number;
  now?: Date;
}): Promise<Outcome<{ completed: boolean }>> {
  const now = input.now ?? new Date();
  const session = await activeSession(input.personId, now);
  if (!session) return { ok: false, error: "session_ended" };
  const mine = await myAssignment(input.personId, input.assignmentId);
  if (!mine || mine.set.status !== "active") return { ok: false, error: "ไม่พบการมอบนี้" };
  if (await openAttempt(mine.a.id)) return { ok: false, error: "กำลังสอบอยู่ — เปิดเอกสารไม่ได้" };
  const version = await approvedVersion(mine.set.id);
  const doc = version ? (await requiredDocuments(version.id)).find((d) => d.id === input.documentId) : undefined;
  if (!doc || doc.pageCount === null) return { ok: false, error: "ไม่พบเอกสารนี้" };

  const pages = [...new Set(input.pages)].filter((p) => Number.isInteger(p) && p >= 1 && p <= doc.pageCount!);
  const seconds = Math.max(0, Math.min(MAX_SECONDS_PER_BEAT, Math.floor(input.activeSeconds)));
  const round = mine.a.readRound;
  const [prev] = await db()
    .select()
    .from(readingProgress)
    .where(and(eq(readingProgress.assignmentId, mine.a.id), eq(readingProgress.documentId, doc.id), eq(readingProgress.readRound, round)));
  const seen = [...new Set([...(prev?.pagesSeen ?? []), ...pages])].sort((x, y) => x - y);
  const completed = seen.length >= doc.pageCount;
  const values = {
    pagesSeen: seen,
    activeSeconds: (prev?.activeSeconds ?? 0) + seconds,
    completedAt: prev?.completedAt ?? (completed ? now : null),
    updatedAt: now,
  };
  await atomic([
    prev
      ? db()
          .update(readingProgress)
          .set(values)
          .where(and(eq(readingProgress.assignmentId, mine.a.id), eq(readingProgress.documentId, doc.id), eq(readingProgress.readRound, round)))
      : db().insert(readingProgress).values({ assignmentId: mine.a.id, documentId: doc.id, readRound: round, ...values }),
    // มีการขยับจริงเท่านั้นที่ต่ออายุรอบเรียน — heartbeat ที่ไม่มีเวลาอ่าน (แท็บซ่อน/นิ่ง) ไม่นับ
    ...(seconds > 0 || pages.length > 0
      ? [db().update(studySessions).set({ lastActiveAt: now }).where(eq(studySessions.id, session.id))]
      : []),
  ]);
  if (completed && mine.a.relearnRequiredAt && (await readingComplete(mine.a, version!.id))) {
    await db().update(assignments).set({ relearnRequiredAt: null }).where(eq(assignments.id, mine.a.id));
  }
  return { ok: true, completed };
}

async function readingComplete(a: Pick<AssignmentRow, "id" | "readRound">, versionId: number): Promise<boolean> {
  const required = await requiredDocuments(versionId);
  if (!required.length) return false;
  const done = await db()
    .select({ documentId: readingProgress.documentId, completedAt: readingProgress.completedAt })
    .from(readingProgress)
    .where(and(eq(readingProgress.assignmentId, a.id), eq(readingProgress.readRound, a.readRound)));
  const finished = new Set(done.filter((d) => d.completedAt).map((d) => d.documentId));
  return required.every((d) => finished.has(d.id));
}

/**
 * ลิงก์เปิดเอกสารอายุสั้น — ต้องมีรอบเรียนที่เปิดอยู่ · ห้ามระหว่างสอบ (ล็อกเอกสาร · spec §10) · บันทึกทุกการเปิด (ADR-0010)
 */
/** เอกสารที่คนนี้เปิดได้ตอนนี้ — มีรอบเรียนเปิดอยู่ · ไม่ได้กำลังสอบ · อยู่ในเวอร์ชันที่อนุมัติล่าสุด */
async function openableDocument(input: { personId: number; assignmentId: number; documentId: number; now: Date }) {
  if (!(await activeSession(input.personId, input.now))) return { ok: false as const, error: "session_ended" };
  const mine = await myAssignment(input.personId, input.assignmentId);
  if (!mine || mine.set.status !== "active") return { ok: false as const, error: "ไม่พบการมอบนี้" };
  if (await openAttempt(mine.a.id)) return { ok: false as const, error: "กำลังสอบอยู่ — เปิดเอกสารไม่ได้" };
  const version = await approvedVersion(mine.set.id);
  const doc = version ? (await requiredDocuments(version.id)).find((d) => d.id === input.documentId) : undefined;
  if (!doc) return { ok: false as const, error: "ไม่พบเอกสารนี้" };
  return { ok: true as const, doc };
}

/**
 * ลิงก์เปิดเอกสาร — ต้องมีรอบเรียนที่เปิดอยู่ · ห้ามระหว่างสอบ (ล็อกเอกสาร · spec §10) · บันทึกทุกการเปิด (ADR-0010)
 * แคตตาล็อก = ลิงก์ R2 อายุสั้น · Pricelist = route ของเราเองที่ประทับลายน้ำ (`pricelistPdf`) ไม่ใช่ไฟล์ต้นฉบับ
 */
export async function documentLink(input: { personId: number; assignmentId: number; documentId: number; now?: Date }): Promise<Outcome<{ url: string }>> {
  const now = input.now ?? new Date();
  const found = await openableDocument({ ...input, now });
  if (!found.ok) return found;
  const { doc } = found;
  if (doc.kind === "pricelist") return { ok: true, url: `/learn/${input.assignmentId}/doc/${doc.id}` };
  const store = objectStore();
  if (!store) return { ok: false, error: "ยังไม่ได้ตั้งที่เก็บไฟล์ (R2) บนเซิร์ฟเวอร์นี้" };
  const url = await store.presignGet({ key: doc.objectKey, contentType: doc.mimeType, disposition: "inline" });
  await db().insert(documentViews).values({ documentId: doc.id, personId: input.personId, viewedAt: now });
  return { ok: true, url };
}

/** Pricelist ที่ประทับลายน้ำของคนเปิดแล้ว (spec §13) — สิทธิ์เดียวกับ `documentLink` · บันทึกการเปิด */
export async function pricelistPdf(input: {
  personId: number;
  email: string;
  assignmentId: number;
  documentId: number;
  now?: Date;
}): Promise<Outcome<{ bytes: Uint8Array }>> {
  const now = input.now ?? new Date();
  const found = await openableDocument({ ...input, now });
  if (!found.ok) return found;
  if (found.doc.kind !== "pricelist") return { ok: false, error: "ไม่พบเอกสารนี้" };
  const store = objectStore();
  if (!store) return { ok: false, error: "ยังไม่ได้ตั้งที่เก็บไฟล์ (R2) บนเซิร์ฟเวอร์นี้" };
  const raw = await store.get(found.doc.objectKey);
  if (!raw) return { ok: false, error: "อ่านไฟล์จากที่เก็บไม่ได้" };
  const bytes = await watermarkPdf(raw, [`WorkTrain · ${input.email}`, `ID ${input.personId} · ${formatBangkok(now)}`, "CONFIDENTIAL · Work Station"]);
  await db().insert(documentViews).values({ documentId: found.doc.id, personId: input.personId, viewedAt: now });
  return { ok: true, bytes };
}

// ── หน้าผู้เรียน ───────────────────────────────────────────────────────────

export type LearnerState = "passed" | "update_ack" | "update_exam" | "relearn" | "ready" | "reading" | "in_exam";

/** ชุดที่ได้รับมอบของฉัน — เฉพาะชุดที่ใช้อยู่ */
export async function myAssignments(personId: number) {
  const rows = await db()
    .select({ a: assignments, title: learningSets.title, passPercent: learningSets.passPercent })
    .from(assignments)
    .innerJoin(learningSets, eq(learningSets.id, assignments.setId))
    .where(and(eq(assignments.personId, personId), eq(learningSets.status, "active")))
    .orderBy(asc(assignments.dueAt));
  return rows;
}

/** ทุกอย่างที่หน้าเรียนของการมอบหนึ่งต้องใช้ */
export async function learnView(personId: number, assignmentId: number, now: Date = new Date()) {
  const mine = await myAssignment(personId, assignmentId);
  if (!mine || mine.set.status !== "active") return null;
  const version = await approvedVersion(mine.set.id);
  if (!version) return null;
  const docs = await requiredDocuments(version.id);
  const progress = await db()
    .select()
    .from(readingProgress)
    .where(and(eq(readingProgress.assignmentId, mine.a.id), eq(readingProgress.readRound, mine.a.readRound)));
  const past = await db()
    .select({ id: attempts.id, kind: attempts.kind, endedAt: attempts.endedAt, scorePercent: attempts.scorePercent, passed: attempts.passed, endReason: attempts.endReason })
    .from(attempts)
    .where(eq(attempts.assignmentId, mine.a.id))
    .orderBy(asc(attempts.startedAt));
  const open = await openAttempt(mine.a.id, now);
  const complete = await readingComplete(mine.a, version.id);
  const update = await pendingUpdate(mine.a);
  const state: LearnerState = open
    ? "in_exam"
    : mine.a.passedAt
      ? update
        ? update.kind === "small"
          ? "update_ack"
          : "update_exam"
        : "passed"
      : mine.a.relearnRequiredAt
        ? "relearn"
        : complete
          ? "ready"
          : "reading";
  return {
    assignment: mine.a,
    set: { id: mine.set.id, title: mine.set.title, passPercent: mine.set.passPercent, examMinutes: mine.set.examMinutes },
    versionLabel: version.label,
    documents: docs.map((d) => {
      const p = progress.find((x) => x.documentId === d.id);
      return { id: d.id, kind: d.kind, fileName: d.fileName, pageCount: d.pageCount!, pagesSeen: p?.pagesSeen ?? [], completed: Boolean(p?.completedAt) };
    }),
    attempts: past.filter((x) => x.endedAt),
    openAttemptId: open?.id ?? null,
    update: update ? { versionId: update.version.id, label: update.version.label, kind: update.kind, summary: update.version.changeSummary ?? "" } : null,
    state,
    session: await activeSession(personId, now),
  };
}

// ── การสอบ ─────────────────────────────────────────────────────────────────

/** ครั้งที่สอบที่ยังค้าง — เลยเวลาแล้วปิดเป็น `timeout` ให้ก่อนคืน */
async function openAttempt(assignmentId: number, now: Date = new Date()) {
  const [row] = await db()
    .select()
    .from(attempts)
    .where(and(eq(attempts.assignmentId, assignmentId), isNull(attempts.endedAt)));
  if (!row) return null;
  if (row.deadlineAt <= now) {
    await finalize(row, "timeout", now);
    return null;
  }
  return row;
}

export async function startAttempt(input: {
  personId: number;
  assignmentId: number;
  scanId: number;
  now?: Date;
  rng?: Rng;
}): Promise<Outcome<{ attemptId: number }>> {
  const now = input.now ?? new Date();
  const mine = await myAssignment(input.personId, input.assignmentId);
  if (!mine || mine.set.status !== "active") return { ok: false, error: "ไม่พบการมอบนี้" };
  if (await openAttempt(mine.a.id, now)) return { ok: false, error: "มีการสอบที่ยังค้างอยู่" };

  // ผ่านแล้ว = สอบได้อย่างเดียวคือส่วนที่เปลี่ยนของเวอร์ชันใหม่ที่เปลี่ยนใหญ่ (ADR-0008) — ไม่ต้องอ่านใหม่ทั้งเล่ม
  let version: VersionRow | null;
  let kind: FormKind = "full";
  if (mine.a.passedAt) {
    const update = await pendingUpdate(mine.a);
    if (!update || update.kind !== "large") return { ok: false, error: "สอบผ่านชุดนี้แล้ว" };
    version = update.version;
    kind = "delta";
  } else {
    if (mine.a.relearnRequiredAt) return { ok: false, error: "ไม่ผ่าน 2 ครั้งติด — กลับไปอ่านเอกสารให้ครบอีกรอบก่อนสอบ" };
    version = await approvedVersion(mine.set.id);
    if (!version) return { ok: false, error: "ชุดนี้ยังไม่มีข้อสอบ" };
    if (!(await readingComplete(mine.a, version.id))) return { ok: false, error: "ต้องอ่านเอกสารให้ครบทุกหน้าก่อนสอบ" };
  }
  const bad = await usableScan({ personId: input.personId, scanId: input.scanId, purpose: "exam", now });
  if (bad) return { ok: false, error: bad };

  const forms = await db()
    .select({ id: examForms.id })
    .from(examForms)
    .where(and(eq(examForms.versionId, version.id), eq(examForms.kind, kind)))
    .orderBy(asc(examForms.formNo));
  if (!forms.length) return { ok: false, error: "ชุดนี้ยังไม่มีข้อสอบ" };
  const used = await db()
    .select({ formId: attempts.formId })
    .from(attempts)
    .where(and(eq(attempts.assignmentId, mine.a.id), eq(attempts.kind, kind)))
    .orderBy(asc(attempts.startedAt));
  const rng = input.rng ?? secureRng;
  const formId = pickForm(forms.map((f) => f.id), used.map((u) => u.formId), rng);

  const qs = await db().select({ id: questions.id }).from(questions).where(eq(questions.formId, formId));
  const cs = await db()
    .select({ id: choices.id, questionId: choices.questionId })
    .from(choices)
    .where(inArray(choices.questionId, qs.map((q) => q.id)));
  const layout = buildLayout(
    qs.map((q) => ({ id: q.id, choiceIds: cs.filter((c) => c.questionId === q.id).map((c) => c.id) })),
    rng,
  );
  const [row] = await db()
    .insert(attempts)
    .values({
      assignmentId: mine.a.id,
      versionId: version.id,
      formId,
      kind,
      scanId: input.scanId,
      layout,
      startedAt: now,
      deadlineAt: new Date(now.getTime() + mine.set.examMinutes * 60 * 1000),
    })
    .returning({ id: attempts.id });
  // เริ่มสอบ = จบรอบเรียน (เอกสารถูกล็อกระหว่างสอบ)
  await endStudySession(input.personId, now);
  return { ok: true, attemptId: row.id };
}

async function myAttempt(personId: number, attemptId: number) {
  const [row] = await db()
    .select({ t: attempts, personId: assignments.personId })
    .from(attempts)
    .innerJoin(assignments, eq(assignments.id, attempts.assignmentId))
    .where(eq(attempts.id, attemptId));
  return row && row.personId === personId ? row.t : null;
}

type AttemptRow = typeof attempts.$inferSelect;

/** ปิดครั้งที่สอบ — คะแนน · ผ่านแล้วลงที่การมอบ · ไม่ผ่าน 2 ครั้งติดให้กลับไปอ่านใหม่ */
async function finalize(t: AttemptRow, reason: "submitted" | "timeout" | "left_page", now: Date): Promise<void> {
  const layout = t.layout as LayoutItem[];
  const answers = t.answers as Record<string, number>;
  const correctRows = await db()
    .select({ questionId: choices.questionId, id: choices.id })
    .from(choices)
    .where(and(inArray(choices.questionId, layout.map((l) => l.questionId)), eq(choices.isCorrect, true)));
  const { percent } = score(layout, answers, new Map(correctRows.map((c) => [c.questionId, c.id])));
  const [a] = await db()
    .select({ a: assignments, passPercent: learningSets.passPercent })
    .from(assignments)
    .innerJoin(learningSets, eq(learningSets.id, assignments.setId))
    .where(eq(assignments.id, t.assignmentId));
  const passed = percent >= a.passPercent;

  const closed = await db()
    .update(attempts)
    .set({ endedAt: now, endReason: reason, scorePercent: percent, passed })
    .where(and(eq(attempts.id, t.id), isNull(attempts.endedAt)))
    .returning({ id: attempts.id });
  if (!closed.length) return; // อีกคำขอหนึ่งปิดไปแล้ว

  if (passed) {
    if (!a.a.passedAt) await db().update(assignments).set({ passedAt: now }).where(eq(assignments.id, a.a.id));
    return;
  }
  const history = await db()
    .select({ passed: attempts.passed })
    .from(attempts)
    .where(and(eq(attempts.assignmentId, a.a.id), eq(attempts.kind, "full")))
    .orderBy(asc(attempts.startedAt));
  if (needsRelearn(history.flatMap((h) => (h.passed === null ? [] : [h.passed])))) {
    await db()
      .update(assignments)
      .set({ relearnRequiredAt: now, readRound: a.a.readRound + 1 })
      .where(eq(assignments.id, a.a.id));
  }
}

export interface AttemptView {
  attemptId: number;
  setTitle: string;
  assignmentId: number;
  ended: boolean;
  /** ระหว่างสอบ */
  index?: number;
  total: number;
  question?: { id: number; text: string; choices: { id: number; text: string }[] };
  secondsLeft?: number;
  leaveCount: number;
  /** หลังสอบ — แสดงข้อที่ผิด ไม่เฉลยคำตอบที่ถูก (ADR-0009) */
  result?: { percent: number; passed: boolean; reason: string; wrongQuestions: string[]; passPercent: number };
}

export async function attemptView(personId: number, attemptId: number, now: Date = new Date()): Promise<AttemptView | null> {
  let t = await myAttempt(personId, attemptId);
  if (!t) return null;
  if (!t.endedAt && t.deadlineAt <= now) {
    await finalize(t, "timeout", now);
    t = (await myAttempt(personId, attemptId))!;
  }
  const [meta] = await db()
    .select({ title: learningSets.title, passPercent: learningSets.passPercent })
    .from(assignments)
    .innerJoin(learningSets, eq(learningSets.id, assignments.setId))
    .where(eq(assignments.id, t.assignmentId));
  const layout = t.layout as LayoutItem[];
  const answers = t.answers as Record<string, number>;
  const base = { attemptId: t.id, setTitle: meta.title, assignmentId: t.assignmentId, total: layout.length, leaveCount: t.leaveCount };

  if (t.endedAt) {
    const correctRows = await db()
      .select({ questionId: choices.questionId, id: choices.id })
      .from(choices)
      .where(and(inArray(choices.questionId, layout.map((l) => l.questionId)), eq(choices.isCorrect, true)));
    const { wrong } = score(layout, answers, new Map(correctRows.map((c) => [c.questionId, c.id])));
    const texts = wrong.length ? await db().select({ id: questions.id, text: questions.text }).from(questions).where(inArray(questions.id, wrong)) : [];
    return {
      ...base,
      ended: true,
      result: {
        percent: t.scorePercent ?? 0,
        passed: Boolean(t.passed),
        reason: t.endReason ?? "submitted",
        wrongQuestions: wrong.map((id) => texts.find((x) => x.id === id)?.text ?? ""),
        passPercent: meta.passPercent,
      },
    };
  }

  const idx = currentIndex(layout, answers)!;
  const item = layout[idx];
  const [q] = await db().select({ id: questions.id, text: questions.text }).from(questions).where(eq(questions.id, item.questionId));
  const cs = await db().select({ id: choices.id, text: choices.text }).from(choices).where(inArray(choices.id, item.choiceIds));
  return {
    ...base,
    ended: false,
    index: idx,
    question: { id: q.id, text: q.text, choices: item.choiceIds.map((id) => cs.find((c) => c.id === id)!) },
    secondsLeft: Math.max(0, Math.ceil((t.deadlineAt.getTime() - now.getTime()) / 1000)),
  };
}

/** ตอบข้อปัจจุบัน — ต้องเป็นข้อที่กำลังแสดง (ย้อนกลับ/ข้ามไม่ได้) · ตอบครบ = ส่งเอง */
export async function answer(input: { personId: number; attemptId: number; questionId: number; choiceId: number; now?: Date }): Promise<Outcome> {
  const now = input.now ?? new Date();
  const t = await myAttempt(input.personId, input.attemptId);
  if (!t) return { ok: false, error: "ไม่พบการสอบนี้" };
  if (t.endedAt) return { ok: false, error: "การสอบนี้จบแล้ว" };
  if (t.deadlineAt <= now) {
    await finalize(t, "timeout", now);
    return { ok: false, error: "หมดเวลาสอบ" };
  }
  const layout = t.layout as LayoutItem[];
  const answers = { ...(t.answers as Record<string, number>) };
  const idx = currentIndex(layout, answers);
  if (idx === null || layout[idx].questionId !== input.questionId) return { ok: false, error: "ตอบได้เฉพาะข้อที่กำลังแสดง" };
  if (!layout[idx].choiceIds.includes(input.choiceId)) return { ok: false, error: "ตัวเลือกไม่ถูกต้อง" };
  answers[String(input.questionId)] = input.choiceId;
  await db().update(attempts).set({ answers }).where(and(eq(attempts.id, t.id), isNull(attempts.endedAt)));
  if (currentIndex(layout, answers) === null) await finalize({ ...t, answers }, "submitted", now);
  return { ok: true };
}

/** ออกจากหน้าสอบ (สลับแท็บ/ย่อจอ) — ครั้งที่ 1–4 เตือน · ครั้งที่ 5 ส่งเอง · บันทึกทุกครั้งให้ TG เห็น */
export async function recordLeave(input: { personId: number; attemptId: number; now?: Date }): Promise<Outcome<{ leaveCount: number; submitted: boolean }>> {
  const now = input.now ?? new Date();
  const t = await myAttempt(input.personId, input.attemptId);
  if (!t || t.endedAt) return { ok: false, error: "การสอบนี้จบแล้ว" };
  const leaveCount = t.leaveCount + 1;
  await db().update(attempts).set({ leaveCount }).where(and(eq(attempts.id, t.id), isNull(attempts.endedAt)));
  const submitted = leaveForcesSubmit(leaveCount);
  if (submitted) await finalize({ ...t, leaveCount }, "left_page", now);
  return { ok: true, leaveCount, submitted };
}
