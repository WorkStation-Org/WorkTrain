import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import { defaultBlueprint } from "@/domain/blueprint";
import type { FaceVerifier } from "@/lib/identity-service";

/**
 * ผู้เรียน: ยินยอม → สแกน → อ่านครบทุกหน้า → สแกน → สอบทีละข้อ → ผล (spec §8–§10 · PGlite + migration จริง)
 */

vi.mock("@/db", async () => {
  const s = await import("@/db/schema");
  const { testDb: get } = await import("@/db/__tests__/pgdb");
  return { db: () => get(), schema: s };
});

const { giveConsent, hasConsent, recordScan } = await import("@/lib/identity-service");
const L = await import("@/lib/learn-service");

const ME = 31;
const T0 = new Date("2026-11-02T09:00:00+07:00");
const sec = (n: number) => new Date(T0.getTime() + n * 1000);
const pass: FaceVerifier = { verify: async () => ({ result: "pass" }) };
const fail: FaceVerifier = { verify: async () => ({ result: "no_match", similarity: 12.5 }) };

/** ชุดที่ใช้อยู่: เอกสาร 2 ไฟล์ (3 หน้า + 1 หน้า) · ข้อสอบ 5 ชุด ชุดละ 10 ข้อ · มอบให้ ME แล้ว */
async function seed(examMinutes = 15) {
  const db = testDb();
  const [set] = await db
    .insert(schema.learningSets)
    .values({
      title: "F331 Signature",
      kind: "product",
      status: "active",
      approvedAt: T0,
      authorPersonId: 10,
      authorName: "พีดี",
      blueprint: defaultBlueprint("general"),
      examMinutes,
    })
    .returning();
  const [v] = await db.insert(schema.setVersions).values({ setId: set.id, versionNo: 1, changeKind: "initial", createdByPersonId: 10, approvedAt: T0 }).returning();
  const docs = await db
    .insert(schema.documents)
    .values([
      { versionId: v.id, kind: "catalog", objectKey: "a", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1, pageCount: 3, sortOrder: 0 },
      { versionId: v.id, kind: "other", objectKey: "b", fileName: "b.pdf", mimeType: "application/pdf", sizeBytes: 1, pageCount: 1, sortOrder: 1 },
      { versionId: v.id, kind: "pricelist", objectKey: "c", fileName: "p.pdf", mimeType: "application/pdf", sizeBytes: 1, pageCount: 2, sortOrder: 2 },
    ])
    .returning();
  for (let f = 1; f <= 5; f++) {
    const [form] = await db.insert(schema.examForms).values({ versionId: v.id, kind: "full", formNo: f }).returning();
    for (let q = 0; q < 10; q++) {
      const [qq] = await db
        .insert(schema.questions)
        .values({ formId: form.id, sortOrder: q, topic: "general", level: "recall", text: `ชุด ${f} ข้อ ${q + 1}`, sourceRef: "a.pdf หน้า 1" })
        .returning();
      await db.insert(schema.choices).values([0, 1, 2, 3].map((i) => ({ questionId: qq.id, sortOrder: i, text: `ตัวเลือก ${i}`, isCorrect: i === 0 })));
    }
  }
  const [a] = await db
    .insert(schema.assignments)
    .values({ setId: set.id, personId: ME, personName: "เซล", source: "audience", assignedAt: T0, dueAt: new Date(T0.getTime() + 7 * 86400_000) })
    .returning();
  return { set, docs, a };
}

async function startSession(at: Date) {
  const scan = await recordScan({ personId: ME, purpose: "study", verifier: pass, now: at });
  if (!scan.ok) throw new Error(scan.error);
  const s = await L.startStudySession({ personId: ME, scanId: scan.scanId, now: at });
  if (!s.ok) throw new Error(s.error);
}

async function readAll(aId: number, docs: { id: number; pageCount: number | null; kind: string }[], at: Date) {
  for (const d of docs.filter((x) => x.kind !== "pricelist")) {
    const pages = Array.from({ length: d.pageCount! }, (_, i) => i + 1);
    const r = await L.recordReading({ personId: ME, assignmentId: aId, documentId: d.id, pages, activeSeconds: 15, now: at });
    if (!r.ok) throw new Error(r.error);
  }
}

async function startExam(aId: number, at: Date) {
  const scan = await recordScan({ personId: ME, purpose: "exam", verifier: pass, now: at });
  if (!scan.ok) throw new Error(scan.error);
  return L.startAttempt({ personId: ME, assignmentId: aId, scanId: scan.scanId, now: at });
}

/** ตอบทุกข้อ — ถูก `rightCount` ข้อแรก ที่เหลือผิด */
async function answerAll(attemptId: number, rightCount: number, at: Date) {
  for (let i = 0; i < 10; i++) {
    const v = await L.attemptView(ME, attemptId, at);
    if (!v || v.ended) break;
    const correct = await testDb().select().from(schema.choices).where(eq(schema.choices.questionId, v.question!.id));
    const pick = correct.find((c) => (i < rightCount ? c.isCorrect : !c.isCorrect))!;
    const r = await L.answer({ personId: ME, attemptId, questionId: v.question!.id, choiceId: pick.id, now: at });
    if (!r.ok) throw new Error(r.error);
  }
  return L.attemptView(ME, attemptId, at);
}

beforeAll(setupTestDb);
beforeEach(truncateAll);

describe("ความยินยอมและการสแกน", () => {
  it("ยินยอมแล้ว hasConsent · ยินยอมซ้ำไม่ได้แถวที่สอง", async () => {
    expect(await hasConsent(ME)).toBe(false);
    await giveConsent(ME, T0);
    await giveConsent(ME, T0);
    expect(await hasConsent(ME)).toBe(true);
    expect(await testDb().select().from(schema.faceConsents)).toHaveLength(1);
  });

  it("ไม่มีตัวเทียบใบหน้า (production ก่อนมี AWS) → บอกตรง ๆ", async () => {
    expect(await recordScan({ personId: ME, purpose: "study", verifier: null })).toEqual({ ok: false, error: "ยังไม่ได้ตั้งระบบสแกนใบหน้าบนเซิร์ฟเวอร์นี้" });
  });

  it("สแกนไม่ผ่าน · ผิดจุดประสงค์ · หมดอายุ · ใช้ซ้ำ → เริ่มรอบเรียนไม่ได้", async () => {
    const bad = await recordScan({ personId: ME, purpose: "study", verifier: fail, now: T0 });
    expect(await L.startStudySession({ personId: ME, scanId: (bad as { scanId: number }).scanId, now: T0 })).toEqual({ ok: false, error: "สแกนใบหน้าไม่ผ่าน" });
    const exam = await recordScan({ personId: ME, purpose: "exam", verifier: pass, now: T0 });
    expect((await L.startStudySession({ personId: ME, scanId: (exam as { scanId: number }).scanId, now: T0 })).ok).toBe(false);
    const ok = await recordScan({ personId: ME, purpose: "study", verifier: pass, now: T0 });
    const id = (ok as { scanId: number }).scanId;
    expect((await L.startStudySession({ personId: ME, scanId: id, now: sec(6 * 60) })).ok).toBe(false);
    expect((await L.startStudySession({ personId: ME, scanId: id, now: sec(10) })).ok).toBe(true);
    expect(await L.startStudySession({ personId: ME, scanId: id, now: sec(20) })).toEqual({ ok: false, error: "ผลสแกนนี้ถูกใช้ไปแล้ว สแกนใหม่" });
  });

  it("สแกนของคนอื่นใช้ไม่ได้", async () => {
    const other = await recordScan({ personId: 99, purpose: "study", verifier: pass, now: T0 });
    expect((await L.startStudySession({ personId: ME, scanId: (other as { scanId: number }).scanId, now: T0 })).ok).toBe(false);
  });
});

describe("การอ่าน (spec §9)", () => {
  it("ต้องมีรอบเรียน · นิ่งเกิน 2 นาที = จบรอบ ต้องสแกนใหม่ · ความคืบหน้ายังอยู่", async () => {
    const { a, docs } = await seed();
    expect(await L.recordReading({ personId: ME, assignmentId: a.id, documentId: docs[0].id, pages: [1], activeSeconds: 10, now: T0 })).toEqual({
      ok: false,
      error: "session_ended",
    });
    await startSession(T0);
    await L.recordReading({ personId: ME, assignmentId: a.id, documentId: docs[0].id, pages: [1, 2], activeSeconds: 10, now: sec(10) });
    expect((await L.recordReading({ personId: ME, assignmentId: a.id, documentId: docs[0].id, pages: [3], activeSeconds: 10, now: sec(10 + 121) })).ok).toBe(false);
    const [s] = await testDb().select().from(schema.studySessions);
    expect(s.endReason).toBe("idle");
    await startSession(sec(200));
    const r = await L.recordReading({ personId: ME, assignmentId: a.id, documentId: docs[0].id, pages: [3], activeSeconds: 10, now: sec(205) });
    expect(r).toEqual({ ok: true, completed: true });
  });

  it("หน้านอกช่วงไม่นับ · เวลาอ่านต่อครั้งถูกจำกัด 30 วินาที", async () => {
    const { a, docs } = await seed();
    await startSession(T0);
    await L.recordReading({ personId: ME, assignmentId: a.id, documentId: docs[0].id, pages: [0, 2, 9, 2.5], activeSeconds: 999, now: sec(5) });
    const [p] = await testDb().select().from(schema.readingProgress);
    expect(p).toMatchObject({ pagesSeen: [2], activeSeconds: 30, completedAt: null });
  });

  it("Pricelist ยังไม่อยู่ในเอกสารที่ต้องอ่าน (ADR-0010 ยังไม่ได้ทำ)", async () => {
    const { a, docs } = await seed();
    const view = await L.learnView(ME, a.id, T0);
    expect(view?.documents.map((d) => d.fileName)).toEqual(["a.pdf", "b.pdf"]);
    await startSession(T0);
    expect((await L.recordReading({ personId: ME, assignmentId: a.id, documentId: docs[2].id, pages: [1], activeSeconds: 5, now: sec(1) })).ok).toBe(false);
  });

  it("การมอบของคนอื่นอ่านไม่ได้", async () => {
    const { a, docs } = await seed();
    await testDb().update(schema.assignments).set({ personId: 77 }).where(eq(schema.assignments.id, a.id));
    await startSession(T0);
    expect((await L.recordReading({ personId: ME, assignmentId: a.id, documentId: docs[0].id, pages: [1], activeSeconds: 5, now: sec(1) })).ok).toBe(false);
  });
});

describe("การสอบ (spec §10)", () => {
  it("ยังอ่านไม่ครบ → สอบไม่ได้", async () => {
    const { a } = await seed();
    expect(await startExam(a.id, T0)).toEqual({ ok: false, error: "ต้องอ่านเอกสารให้ครบทุกหน้าก่อนสอบ" });
  });

  it("อ่านครบ → สแกน → สอบทีละข้อ ย้อนไม่ได้ · ถูก 8/10 = 80% ผ่าน → การมอบผ่าน · ไม่เฉลย", async () => {
    const { a, docs } = await seed();
    await startSession(T0);
    await readAll(a.id, docs, sec(5));
    const started = await startExam(a.id, sec(10));
    expect(started.ok).toBe(true);
    const attemptId = (started as { attemptId: number }).attemptId;

    // เริ่มสอบ = เอกสารถูกล็อก และรอบเรียนจบ
    expect((await L.documentLink({ personId: ME, assignmentId: a.id, documentId: docs[0].id, now: sec(11) })).ok).toBe(false);

    const first = await L.attemptView(ME, attemptId, sec(11));
    expect(first).toMatchObject({ ended: false, index: 0, total: 10, secondsLeft: 15 * 60 - 1 });
    expect(JSON.stringify(first)).not.toContain("isCorrect");

    const result = await answerAll(attemptId, 8, sec(20));
    expect(result?.result).toMatchObject({ percent: 80, passed: true, reason: "submitted" });
    expect(result?.result?.wrongQuestions).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("isCorrect");
    const [row] = await testDb().select().from(schema.assignments);
    expect(row.passedAt).not.toBeNull();
    expect((await L.learnView(ME, a.id, sec(30)))?.state).toBe("passed");
  });

  it("ตอบข้อที่ไม่ได้แสดงอยู่ไม่ได้ (ข้าม/ย้อน)", async () => {
    const { a, docs } = await seed();
    await startSession(T0);
    await readAll(a.id, docs, sec(5));
    const { attemptId } = (await startExam(a.id, sec(10))) as { attemptId: number };
    const v = (await L.attemptView(ME, attemptId, sec(11)))!;
    const [t] = await testDb().select().from(schema.attempts);
    const other = (t.layout as { questionId: number; choiceIds: number[] }[]).find((l) => l.questionId !== v.question!.id)!;
    expect(await L.answer({ personId: ME, attemptId, questionId: other.questionId, choiceId: other.choiceIds[0], now: sec(12) })).toEqual({
      ok: false,
      error: "ตอบได้เฉพาะข้อที่กำลังแสดง",
    });
  });

  it("หมดเวลา = ส่งเอง ข้อที่ไม่ตอบนับผิด", async () => {
    const { a, docs } = await seed(1);
    await startSession(T0);
    await readAll(a.id, docs, sec(5));
    const { attemptId } = (await startExam(a.id, sec(10))) as { attemptId: number };
    const v = await L.attemptView(ME, attemptId, sec(10 + 61));
    expect(v?.result).toMatchObject({ percent: 0, passed: false, reason: "timeout" });
  });

  it("ออกจากหน้าสอบครั้งที่ 1–4 เตือน · ครั้งที่ 5 ส่งเอง", async () => {
    const { a, docs } = await seed();
    await startSession(T0);
    await readAll(a.id, docs, sec(5));
    const { attemptId } = (await startExam(a.id, sec(10))) as { attemptId: number };
    for (let i = 1; i <= 4; i++) expect(await L.recordLeave({ personId: ME, attemptId, now: sec(10 + i) })).toEqual({ ok: true, leaveCount: i, submitted: false });
    expect(await L.recordLeave({ personId: ME, attemptId, now: sec(15) })).toEqual({ ok: true, leaveCount: 5, submitted: true });
    expect((await L.attemptView(ME, attemptId, sec(16)))?.result?.reason).toBe("left_page");
  });

  it("ไม่ผ่าน 2 ครั้งติด → ต้องอ่านใหม่ · ได้ชุดไม่ซ้ำ · อ่านครบอีกรอบแล้วสอบได้", async () => {
    const { a, docs } = await seed();
    await startSession(T0);
    await readAll(a.id, docs, sec(5));
    const one = (await startExam(a.id, sec(10))) as { attemptId: number };
    await answerAll(one.attemptId, 3, sec(20));
    const two = (await startExam(a.id, sec(30))) as { attemptId: number };
    await answerAll(two.attemptId, 3, sec(40));
    const forms = await testDb().select({ f: schema.attempts.formId }).from(schema.attempts).orderBy(asc(schema.attempts.id));
    expect(forms[0].f).not.toBe(forms[1].f);

    expect((await L.learnView(ME, a.id, sec(50)))?.state).toBe("relearn");
    expect(await startExam(a.id, sec(50))).toEqual({ ok: false, error: "ไม่ผ่าน 2 ครั้งติด — กลับไปอ่านเอกสารให้ครบอีกรอบก่อนสอบ" });

    await startSession(sec(60));
    await readAll(a.id, docs, sec(65));
    expect((await L.learnView(ME, a.id, sec(70)))?.state).toBe("ready");
    expect((await startExam(a.id, sec(70))).ok).toBe(true);
  });
});
