import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import { devStoreObjects } from "@/lib/object-store";
import { GENERAL_BLUEPRINT } from "@/domain/blueprint";

/**
 * ผู้เรียน: ยินยอม → สแกน → อ่านครบทุกหน้า → สแกน → สอบทีละข้อ → ผล (spec §8–§10 · PGlite + migration จริง)
 */

vi.mock("@/db", async () => {
  const s = await import("@/db/schema");
  const { testDb: get } = await import("@/db/__tests__/pgdb");
  return { db: () => get(), schema: s };
});

const { consentRequired, giveConsent, hasConsent, scanMode } = await import("@/lib/identity-service");
const L = await import("@/lib/learn-service");

const ME = 31;
const T0 = new Date("2026-11-02T09:00:00+07:00");
const sec = (n: number) => new Date(T0.getTime() + n * 1000);
/** ผลสแกนลงฐานตรง ๆ — การสแกนจริง (Rekognition) เทสต์แยกใน identity.db.test.ts */
async function recordScan(input: { personId: number; purpose: "study" | "exam"; pass: boolean; now: Date }) {
  const [row] = await testDb()
    .insert(schema.faceScans)
    .values({
      personId: input.personId,
      purpose: input.purpose,
      result: input.pass ? "pass" : "no_match",
      deleteAfter: new Date(input.now.getTime() + 90 * 86400_000),
      createdAt: input.now,
    })
    .returning({ id: schema.faceScans.id });
  return { ok: true, scanId: row.id, error: "" } as { ok: boolean; scanId: number; error: string };
}

/** ชุดที่ใช้อยู่: เอกสาร 2 ไฟล์ (3 หน้า + 1 หน้า) · ข้อสอบ 5 ชุด ชุดละ 10 ข้อ · มอบให้ ME แล้ว */
async function seed(examMinutes = 15) {
  const db = testDb();
  const [set] = await db
    .insert(schema.learningSets)
    .values({
      title: "F331 Signature",
      kindId: schema.SEEDED_KIND_IDS.product,
      status: "active",
      approvedAt: T0,
      authorPersonId: 10,
      authorName: "พีดี",
      blueprint: GENERAL_BLUEPRINT,
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
  const scan = await recordScan({ personId: ME, purpose: "study", pass: true, now: at });
  if (!scan.ok) throw new Error(scan.error);
  const s = await L.startStudySession({ personId: ME, scanId: scan.scanId, now: at });
  if (!s.ok) throw new Error(s.error);
}

async function readAll(aId: number, docs: { id: number; pageCount: number | null; kind: string }[], at: Date) {
  for (const d of docs) {
    const pages = Array.from({ length: d.pageCount! }, (_, i) => i + 1);
    const r = await L.recordReading({ personId: ME, assignmentId: aId, documentId: d.id, pages, activeSeconds: 15, now: at });
    if (!r.ok) throw new Error(r.error);
  }
}

async function startExam(aId: number, at: Date) {
  const scan = await recordScan({ personId: ME, purpose: "exam", pass: true, now: at });
  if (!scan.ok) throw new Error(scan.error);
  return L.startAttempt({ personId: ME, assignmentId: aId, scanId: scan.scanId, now: at });
}

/** ตำแหน่งที่ตัวเลือกนี้แสดงอยู่ในครั้งที่สอบนี้ (ผู้เรียนตอบด้วยตำแหน่ง ไม่ใช่ id) */
async function shownAt(attemptId: number, questionId: number, choiceId: number): Promise<number> {
  const [t] = await testDb().select().from(schema.attempts).where(eq(schema.attempts.id, attemptId));
  return (t.layout as { questionId: number; choiceIds: number[] }[]).find((l) => l.questionId === questionId)!.choiceIds.indexOf(choiceId);
}

/** ตอบทุกข้อ — ถูก `rightCount` ข้อแรก ที่เหลือผิด */
async function answerAll(attemptId: number, rightCount: number, at: Date) {
  for (let i = 0; i < 10; i++) {
    const v = await L.attemptView(ME, attemptId, at);
    if (!v || v.ended) break;
    const correct = await testDb().select().from(schema.choices).where(eq(schema.choices.questionId, v.question!.id));
    const pick = correct.find((c) => (i < rightCount ? c.isCorrect : !c.isCorrect))!;
    const r = await L.answer({ personId: ME, attemptId, questionId: v.question!.id, choiceIndex: await shownAt(attemptId, v.question!.id, pick.id), now: at });
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

  it("สแกนไม่ผ่าน · ผิดจุดประสงค์ · หมดอายุ · ใช้ซ้ำ → เริ่มรอบเรียนไม่ได้", async () => {
    const bad = await recordScan({ personId: ME, purpose: "study", pass: false, now: T0 });
    expect(await L.startStudySession({ personId: ME, scanId: (bad as { scanId: number }).scanId, now: T0 })).toEqual({ ok: false, error: "สแกนใบหน้าไม่ผ่าน" });
    const exam = await recordScan({ personId: ME, purpose: "exam", pass: true, now: T0 });
    expect((await L.startStudySession({ personId: ME, scanId: (exam as { scanId: number }).scanId, now: T0 })).ok).toBe(false);
    const ok = await recordScan({ personId: ME, purpose: "study", pass: true, now: T0 });
    const id = (ok as { scanId: number }).scanId;
    expect((await L.startStudySession({ personId: ME, scanId: id, now: sec(6 * 60) })).ok).toBe(false);
    expect((await L.startStudySession({ personId: ME, scanId: id, now: sec(10) })).ok).toBe(true);
    expect(await L.startStudySession({ personId: ME, scanId: id, now: sec(20) })).toEqual({ ok: false, error: "ผลสแกนนี้ถูกใช้ไปแล้ว สแกนใหม่" });
  });

  it("สแกนของคนอื่นใช้ไม่ได้", async () => {
    const other = await recordScan({ personId: 99, purpose: "study", pass: true, now: T0 });
    expect((await L.startStudySession({ personId: ME, scanId: (other as { scanId: number }).scanId, now: T0 })).ok).toBe(false);
  });
});

describe("พักการสแกนใบหน้า (ADR-0019)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ไม่ได้พัก → เริ่มรอบเรียน/สอบโดยไม่มีผลสแกนไม่ได้ · ยังต้องยินยอม", async () => {
    const { a, docs } = await seed();
    expect(await L.startStudySession({ personId: ME, scanId: null, now: T0 })).toEqual({ ok: false, error: "ต้องสแกนใบหน้าก่อน" });
    await startSession(T0);
    await readAll(a.id, docs, sec(5));
    expect(await L.startAttempt({ personId: ME, assignmentId: a.id, scanId: null, now: sec(10) })).toEqual({ ok: false, error: "ต้องสแกนใบหน้าก่อน" });
    expect(await consentRequired(ME)).toBe(true);
    expect(scanMode()).not.toBe("paused");
  });

  it("พักอยู่ → ไม่ต้องยินยอม · เรียนหลายรอบและสอบได้โดยไม่สแกน (scan_id ว่าง) · ผลสแกนที่ส่งมายังถูกตรวจ", async () => {
    vi.stubEnv("FACE_SCAN_PAUSED", "1");
    expect(scanMode()).toBe("paused");
    expect(await consentRequired(ME)).toBe(false);
    const { a, docs } = await seed();
    // สองรอบที่ไม่มีผลสแกน — unique index ของ scan_id ไม่กันค่าว่าง
    expect((await L.startStudySession({ personId: ME, scanId: null, now: T0 })).ok).toBe(true);
    expect((await L.startStudySession({ personId: ME, scanId: null, now: sec(1) })).ok).toBe(true);
    const sessions = await testDb().select().from(schema.studySessions);
    expect(sessions.map((r) => r.scanId)).toEqual([null, null]);

    const bad = await recordScan({ personId: ME, purpose: "study", pass: false, now: sec(2) });
    expect(await L.startStudySession({ personId: ME, scanId: bad.scanId, now: sec(2) })).toEqual({ ok: false, error: "สแกนใบหน้าไม่ผ่าน" });

    await readAll(a.id, docs, sec(5));
    const started = await L.startAttempt({ personId: ME, assignmentId: a.id, scanId: null, now: sec(10) });
    expect(started.ok).toBe(true);
    const result = await answerAll((started as { attemptId: number }).attemptId, 10, sec(20));
    expect(result?.result).toMatchObject({ percent: 100, passed: true });
    const [t] = await testDb().select().from(schema.attempts);
    expect(t.scanId).toBeNull();
  });

  it("ลบ env = กลับมาบังคับยินยอมและสแกนทันที", async () => {
    vi.stubEnv("FACE_SCAN_PAUSED", "1");
    expect(await consentRequired(ME)).toBe(false);
    vi.unstubAllEnvs();
    expect(await consentRequired(ME)).toBe(true);
    expect(await L.startStudySession({ personId: ME, scanId: null, now: T0 })).toEqual({ ok: false, error: "ต้องสแกนใบหน้าก่อน" });
  });
});

describe("หน้ารายการชุดที่ต้องเรียน", () => {
  it("เนื้อหา (คลิป/PDF) · ความคืบหน้า · ทำต่อจากที่ค้างไว้ · สถานะ · เลยกำหนด", async () => {
    const { a, docs } = await seed();
    // PDF 3 + 1 + 2 หน้า และวิดีโอ 95 วินาที (10 ช่วง) ที่มีปก
    const [video] = await testDb()
      .insert(schema.documents)
      .values({ versionId: docs[0].versionId, kind: "other", objectKey: "v", fileName: "intro.mp4", mimeType: "video/mp4", sizeBytes: 1, pageCount: 10, durationSeconds: 95, coverKey: "v-cover-abcdef1234567890.jpg", coverMs: 0, sortOrder: 3 })
      .returning();

    const [fresh] = await L.myLearningList(ME, T0);
    expect(fresh).toMatchObject({ status: "todo", late: false, videos: 1, videoSeconds: 95, pdfs: 3, pdfPages: 6, unitsSeen: 0, unitsTotal: 16, docsDone: 0, docsTotal: 4, resume: null });
    expect(fresh.coverUrl).toBe(`/api/covers/${video.id}?v=34567890`);

    await startSession(T0);
    await L.recordReading({ personId: ME, assignmentId: a.id, documentId: docs[0].id, pages: [1, 2, 3], activeSeconds: 10, now: sec(5) });
    await L.recordReading({ personId: ME, assignmentId: a.id, documentId: video.id, pages: [1, 2], activeSeconds: 10, now: sec(20) });
    const [reading] = await L.myLearningList(ME, sec(30));
    expect(reading).toMatchObject({ status: "reading", unitsSeen: 5, docsDone: 1 });
    // เนื้อหาที่ขยับล่าสุดแต่ยังไม่ครบ = วิดีโอ (PDF ไฟล์แรกครบแล้ว)
    expect(reading.resume).toMatchObject({ fileName: "intro.mp4", isVideo: true, seen: 2, total: 10 });

    await readAll(a.id, docs, sec(40));
    // วิดีโอส่งได้ทีละไม่เกินที่เล่นทัน (ADR-0013) — ดูต่อสองรอบ heartbeat
    for (const at of [41, 42]) {
      await L.recordReading({ personId: ME, assignmentId: a.id, documentId: video.id, pages: Array.from({ length: 10 }, (_, i) => i + 1), activeSeconds: 30, now: sec(at) });
    }
    expect((await L.myLearningList(ME, sec(50)))[0]).toMatchObject({ status: "ready", docsDone: 4, unitsSeen: 16, resume: null });

    const late = await L.myLearningList(ME, new Date(a.dueAt.getTime() + 1000));
    expect(late[0]).toMatchObject({ status: "ready", late: true });
    expect(await L.myLearningList(77, T0)).toEqual([]);
  });
});

describe("ซ่อนคลิป/เอกสารจากชุด", () => {
  const AUTHOR = { personId: 10, email: "pd@x", name: "พีดี", role: "author" as const };

  it("ซ่อนแล้วผู้เรียนไม่เห็น ไม่นับ เปิดไม่ได้ · ที่เหลือครบ = สอบได้ · ลงประวัติ · แสดงกลับได้", async () => {
    const S = await import("@/lib/set-service");
    const { set, a, docs } = await seed();
    await startSession(T0);
    await readAll(a.id, docs.slice(0, 2), sec(5));
    expect((await L.learnView(ME, a.id, sec(6)))!.state).not.toBe("ready");

    expect(await S.setDocumentHidden({ actor: AUTHOR, documentId: docs[2].id, hidden: true, now: sec(7) })).toEqual({ ok: true });
    const view = (await L.learnView(ME, a.id, sec(8)))!;
    expect(view.documents.map((d) => d.id)).toEqual([docs[0].id, docs[1].id]);
    expect(view.state).toBe("ready");
    expect((await L.myLearningList(ME, sec(8)))[0]).toMatchObject({ docsTotal: 2, docsDone: 2, status: "ready" });
    // ไฟล์ที่ซ่อนส่งความคืบหน้า/ขอลิงก์ไม่ได้
    expect(await L.recordReading({ personId: ME, assignmentId: a.id, documentId: docs[2].id, pages: [1], activeSeconds: 5, now: sec(9) })).toEqual({ ok: false, error: "ไม่พบเอกสารนี้" });

    const events = await testDb().select().from(schema.approvalEvents).where(eq(schema.approvalEvents.setId, set.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "document_visibility", actorPersonId: 10, detail: { documentId: docs[2].id, fileName: "p.pdf", hidden: true } });

    expect(await S.setDocumentHidden({ actor: AUTHOR, documentId: docs[2].id, hidden: false, now: sec(10) })).toEqual({ ok: true });
    expect((await L.learnView(ME, a.id, sec(11)))!.documents).toHaveLength(3);
  });

  it("ต้องเหลืออย่างน้อย 1 รายการ · คนอื่นที่ไม่ใช่ผู้สร้าง/TG ซ่อนไม่ได้ · ชุดที่ปิดแล้วซ่อนไม่ได้", async () => {
    const S = await import("@/lib/set-service");
    const { set, docs } = await seed();
    await S.setDocumentHidden({ actor: AUTHOR, documentId: docs[0].id, hidden: true });
    await S.setDocumentHidden({ actor: AUTHOR, documentId: docs[1].id, hidden: true });
    expect(await S.setDocumentHidden({ actor: AUTHOR, documentId: docs[2].id, hidden: true })).toEqual({ ok: false, error: "ต้องเหลือคลิปหรือเอกสารให้ผู้เรียนอย่างน้อย 1 รายการ" });

    const stranger = { personId: 99, email: "s@x", name: "คนอื่น", role: "author" as const };
    expect((await S.setDocumentHidden({ actor: stranger, documentId: docs[0].id, hidden: false })).ok).toBe(false);
    const tg = { personId: 1, email: "tg@x", name: "ทีจี", role: "admin" as const };
    expect(await S.setDocumentHidden({ actor: tg, documentId: docs[0].id, hidden: false })).toEqual({ ok: true });

    await testDb().update(schema.learningSets).set({ status: "closed" }).where(eq(schema.learningSets.id, set.id));
    expect(await S.setDocumentHidden({ actor: AUTHOR, documentId: docs[0].id, hidden: true })).toEqual({ ok: false, error: "ชุดนี้ปิดแล้ว — ซ่อน/แสดงไม่ได้" });
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
    expect(r).toEqual({ ok: true, completed: true, seen: [1, 2, 3] });
  });

  it("ช่วงวิดีโอที่เกินเพดานต่อครั้งไม่อยู่ใน seen — ส่งซ้ำแล้วทยอยนับจนครบ (จอไม่ขึ้นครบทั้งที่ฐานไม่ครบ)", async () => {
    const { a, docs } = await seed();
    const [video] = await testDb()
      .insert(schema.documents)
      .values({ versionId: docs[0].versionId, kind: "other", objectKey: "v", fileName: "v.mp4", mimeType: "video/mp4", sizeBytes: 1, pageCount: 4, durationSeconds: 40, sortOrder: 3 })
      .returning();
    await startSession(T0);
    const all = [1, 2, 3, 4];
    const first = await L.recordReading({ personId: ME, assignmentId: a.id, documentId: video.id, pages: all, activeSeconds: 0, now: sec(5) });
    expect(first).toEqual({ ok: true, completed: false, seen: [1] });
    // เบราว์เซอร์ส่งช่วงที่ยังไม่อยู่ใน seen ซ้ำ — แม้ไม่มีเวลาดูเพิ่ม ก็ได้ทีละ 1 ช่วง
    let seen = (first as { seen: number[] }).seen;
    let completed = false;
    for (let i = 1; i <= 3; i++) {
      const out = await L.recordReading({ personId: ME, assignmentId: a.id, documentId: video.id, pages: all.filter((p) => !seen.includes(p)), activeSeconds: 0, now: sec(5 + i * 15) });
      seen = (out as { seen: number[] }).seen;
      completed = (out as { completed: boolean }).completed;
    }
    expect(seen).toEqual(all);
    expect(completed).toBe(true);
  });

  it("หน้านอกช่วงไม่นับ · เวลาอ่านต่อครั้งถูกจำกัด 30 วินาที", async () => {
    const { a, docs } = await seed();
    await startSession(T0);
    await L.recordReading({ personId: ME, assignmentId: a.id, documentId: docs[0].id, pages: [0, 2, 9, 2.5], activeSeconds: 999, now: sec(5) });
    const [p] = await testDb().select().from(schema.readingProgress);
    expect(p).toMatchObject({ pagesSeen: [2], activeSeconds: 30, completedAt: null });
  });

  it("Pricelist ต้องอ่านด้วย · เปิดผ่าน route ที่ประทับลายน้ำ ไม่ใช่ลิงก์ไฟล์ต้นฉบับ · บันทึกการเปิด (ADR-0010)", async () => {
    const { a, docs } = await seed();
    const view = await L.learnView(ME, a.id, T0);
    expect(view?.documents.map((d) => [d.fileName, d.kind])).toEqual([
      ["a.pdf", "catalog"],
      ["b.pdf", "other"],
      ["p.pdf", "pricelist"],
    ]);
    const { PDFDocument } = await import("pdf-lib");
    const src = await PDFDocument.create();
    src.addPage();
    src.addPage();
    devStoreObjects().set("c", await src.save());

    expect((await L.pricelistPdf({ personId: ME, email: "s@ws.co", assignmentId: a.id, documentId: docs[2].id, now: sec(1) })).ok).toBe(false);
    await startSession(T0);
    expect(await L.documentLink({ personId: ME, assignmentId: a.id, documentId: docs[2].id, now: sec(1) })).toEqual({ ok: true, url: `/learn/${a.id}/doc/${docs[2].id}` });
    const out = await L.pricelistPdf({ personId: ME, email: "s@ws.co", assignmentId: a.id, documentId: docs[2].id, now: sec(1) });
    expect(out.ok).toBe(true);
    const stamped = await PDFDocument.load((out as { bytes: Uint8Array }).bytes);
    expect(stamped.getPageCount()).toBe(2);
    expect(Buffer.from((out as { bytes: Uint8Array }).bytes).length).toBeGreaterThan(Buffer.from(devStoreObjects().get("c")!).length);
    // แคตตาล็อกเปิดผ่านช่องนี้ไม่ได้
    expect((await L.pricelistPdf({ personId: ME, email: "s@ws.co", assignmentId: a.id, documentId: docs[0].id, now: sec(1) })).ok).toBe(false);
    const views = await testDb().select().from(schema.documentViews).where(eq(schema.documentViews.documentId, docs[2].id));
    expect(views).toHaveLength(1);
  });

  it("วิดีโอ: ช่วงต่อครั้งไม่เกินที่เล่นทันที่ 2 เท่า · ส่งทั้งเรื่องทีเดียวไม่ครบ · ลิงก์อายุ 10 นาที (ADR-0013)", async () => {
    const { a, docs } = await seed();
    // วิดีโอ 95 วินาที = 10 ช่วง
    const [video] = await testDb()
      .insert(schema.documents)
      .values({ versionId: docs[0].versionId, kind: "other", objectKey: "v", fileName: "intro.mp4", mimeType: "video/mp4", sizeBytes: 1, pageCount: 10, durationSeconds: 95, sortOrder: 3 })
      .returning();
    const all = Array.from({ length: 10 }, (_, i) => i + 1);
    await startSession(T0);

    // 15 วินาทีที่ 2 เท่าเล่นได้ 30 วินาที = 3 ช่วง (+1 ช่วงที่ค้าง) — ที่เหลือไม่นับ
    expect(await L.recordReading({ personId: ME, assignmentId: a.id, documentId: video.id, pages: all, activeSeconds: 15, now: sec(15) })).toMatchObject({ ok: true, completed: false, seen: [1, 2, 3, 4] });
    const progress = async () => (await testDb().select().from(schema.readingProgress).where(eq(schema.readingProgress.documentId, video.id)))[0];
    expect((await progress()).pagesSeen).toEqual([1, 2, 3, 4]);
    // ไม่มีเวลาดู = ได้แค่ 1 ช่วง
    await L.recordReading({ personId: ME, assignmentId: a.id, documentId: video.id, pages: all, activeSeconds: 0, now: sec(16) });
    expect((await progress()).pagesSeen).toEqual([1, 2, 3, 4, 5]);
    // ดูต่อจนครบ
    await L.recordReading({ personId: ME, assignmentId: a.id, documentId: video.id, pages: all, activeSeconds: 30, now: sec(46) });
    expect(await progress()).toMatchObject({ pagesSeen: all });
    expect((await progress()).completedAt).not.toBeNull();

    const view = await L.learnView(ME, a.id, sec(47));
    expect(view?.documents.find((d) => d.id === video.id)).toMatchObject({ mimeType: "video/mp4", durationSeconds: 95, pageCount: 10, completed: true });

    const link = await L.documentLink({ personId: ME, assignmentId: a.id, documentId: video.id, now: sec(47) });
    expect(link.ok).toBe(true);
    // ที่เก็บจำลองไม่มีอายุลิงก์ — ตรวจว่าเป็นลิงก์ไฟล์จริง (ไม่ใช่ route ลายน้ำ) และบันทึกการเปิด
    expect((link as { url: string }).url).toContain("/api/dev-store/v");
    expect(await testDb().select().from(schema.documentViews).where(eq(schema.documentViews.documentId, video.id))).toHaveLength(1);
  });

  describe("ดูได้ทีละคลิป (ADR-0020)", () => {
    async function twoVideos() {
      const s = await seed();
      const rows = await testDb()
        .insert(schema.documents)
        .values(
          ["v1", "v2"].map((k, i) => ({
            versionId: s.docs[0].versionId,
            kind: "other" as const,
            objectKey: k,
            fileName: `${k}.mp4`,
            mimeType: "video/mp4",
            sizeBytes: 1,
            pageCount: 30,
            durationSeconds: 300,
            sortOrder: 3 + i,
          })),
        )
        .returning();
      return { ...s, v1: rows[0], v2: rows[1] };
    }
    const beat = (aId: number, documentId: number, pages: number[], at: Date, extra: { activeSeconds?: number; release?: boolean } = {}) =>
      L.recordReading({ personId: ME, assignmentId: aId, documentId, pages, activeSeconds: extra.activeSeconds ?? 15, release: extra.release, now: at });
    const seenOf = async (documentId: number) =>
      (await testDb().select().from(schema.readingProgress).where(eq(schema.readingProgress.documentId, documentId)))[0]?.pagesSeen ?? [];

    it("อีกแท็บเล่นอีกคลิปพร้อมกัน = ไม่นับเลย · ปิดคลิปแรก (release) หรือเงียบเกิน 30 วินาที = คลิปใหม่นับได้", async () => {
      const { a, v1, v2 } = await twoVideos();
      await startSession(T0);
      expect(await beat(a.id, v1.id, [1, 2, 3], sec(15))).toMatchObject({ ok: true, seen: [1, 2, 3] });
      // แท็บที่สองเล่น EP.2 ระหว่างที่ EP.1 ยังนับอยู่
      expect(await beat(a.id, v2.id, [1, 2, 3], sec(20))).toEqual({ ok: false, error: "video_elsewhere" });
      expect(await seenOf(v2.id)).toEqual([]);
      // EP.1 ยังนับต่อได้
      expect(await beat(a.id, v1.id, [4, 5, 6], sec(30))).toMatchObject({ ok: true, seen: [1, 2, 3, 4, 5, 6] });
      expect(await beat(a.id, v2.id, [1], sec(55))).toEqual({ ok: false, error: "video_elsewhere" });
      // เงียบเกิน 30 วินาที = EP.2 นับแทนได้ · แล้ว EP.1 กลับมาไม่ได้จนกว่า EP.2 จะเงียบ/ปล่อย
      expect(await beat(a.id, v2.id, [1, 2], sec(61))).toMatchObject({ ok: true, seen: [1, 2] });
      expect(await beat(a.id, v1.id, [7], sec(70))).toEqual({ ok: false, error: "video_elsewhere" });
      // ปิด EP.2 (เปลี่ยนคลิปในแท็บเดียวกัน) = ปล่อยทันที
      expect(await beat(a.id, v2.id, [], sec(71), { activeSeconds: 0, release: true })).toMatchObject({ ok: true });
      expect(await beat(a.id, v1.id, [7], sec(72))).toMatchObject({ ok: true, seen: [1, 2, 3, 4, 5, 6, 7] });
    });

    it("PDF ไม่ติดการจองคลิป", async () => {
      const { a, docs, v1 } = await twoVideos();
      await startSession(T0);
      await beat(a.id, v1.id, [1], sec(15));
      expect(await beat(a.id, docs[0].id, [1, 2, 3], sec(16))).toMatchObject({ ok: true, completed: true });
    });

    it("คลิปเดียวกันเปิดหลายแท็บ ส่งถี่ ๆ = งบรวมทั้งรอบเรียนไม่เกินดูทีละคลิปที่ 2 เท่า", async () => {
      const { a, v1 } = await twoVideos();
      const all = Array.from({ length: 30 }, (_, i) => i + 1);
      await startSession(T0);
      // 4 แท็บ ทุกแท็บส่งทุก 15 วินาที เป็นเวลา 60 วินาที — แท็บละเพดานต่อครั้ง 4 ช่วง = 64 ช่วงถ้าไม่มีงบรวม
      for (let t = 15; t <= 60; t += 15) for (let tab = 0; tab < 4; tab++) await beat(a.id, v1.id, all, sec(t + tab * 0.1));
      // 60 วินาทีที่ 2 เท่า = 12 ช่วง + งบตั้งต้น 12 ช่วง
      expect((await seenOf(v1.id)).length).toBeLessThanOrEqual(24);
      expect((await seenOf(v1.id)).length).toBeGreaterThanOrEqual(12);
    });
  });

  describe("ทบทวนหลังสอบผ่าน", () => {
    async function passed() {
      const s = await seed();
      await testDb().update(schema.assignments).set({ passedAt: T0 }).where(eq(schema.assignments.id, s.a.id));
      return s;
    }

    it("ผ่านแล้ว = เปิดคลิป/เอกสารได้ไม่ต้องมีรอบเรียน · ลงบันทึกการเปิด · หน้าเรียนเป็นโหมดทบทวน", async () => {
      const { a, docs } = await passed();
      expect(await L.documentLink({ personId: ME, assignmentId: a.id, documentId: docs[0].id, now: sec(1) })).toMatchObject({ ok: true });
      expect(await L.documentLink({ personId: ME, assignmentId: a.id, documentId: docs[2].id, now: sec(1) })).toEqual({ ok: true, url: `/learn/${a.id}/doc/${docs[2].id}` });
      expect(await testDb().select().from(schema.documentViews)).toHaveLength(1);
      expect(await L.learnView(ME, a.id, sec(2))).toMatchObject({ state: "passed", review: true });
      // ทบทวนไม่นับความคืบหน้า — ยังต้องมีรอบเรียนถึงจะบันทึก
      expect(await L.recordReading({ personId: ME, assignmentId: a.id, documentId: docs[0].id, pages: [1], activeSeconds: 5, now: sec(3) })).toEqual({
        ok: false,
        error: "session_ended",
      });
    });

    it("ยังไม่ผ่าน = ต้องมีรอบเรียน · ผ่านแล้วแต่ถูกตัดจบ = ไม่ทบทวน", async () => {
      const { a, docs } = await seed();
      expect(await L.documentLink({ personId: ME, assignmentId: a.id, documentId: docs[0].id, now: sec(1) })).toEqual({ ok: false, error: "session_ended" });
      expect((await L.learnView(ME, a.id, sec(1)))?.review).toBe(false);
      await testDb().update(schema.assignments).set({ passedAt: T0, endedAt: T0, endReason: "not_in_audience" }).where(eq(schema.assignments.id, a.id));
      expect((await L.documentLink({ personId: ME, assignmentId: a.id, documentId: docs[0].id, now: sec(1) })).ok).toBe(false);
      expect((await L.learnView(ME, a.id, sec(1)))?.review).toBe(false);
    });
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
    expect(await startExam(a.id, T0)).toEqual({ ok: false, error: "ต้องอ่านเอกสารให้ครบทุกหน้าและดูวิดีโอครบทุกช่วงก่อนสอบ" });
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
    expect(await L.answer({ personId: ME, attemptId, questionId: other.questionId, choiceIndex: 0, now: sec(12) })).toEqual({
      ok: false,
      error: "ตอบได้เฉพาะข้อที่กำลังแสดง",
    });
  });

  it("ตัวเลือกส่งไปหน้าจอแค่ข้อความ (ไม่มี id) · ตอบด้วยตำแหน่ง · ตำแหน่งนอกช่วง = ไม่รับ", async () => {
    const { a, docs } = await seed();
    await startSession(T0);
    await readAll(a.id, docs, sec(5));
    const { attemptId } = (await startExam(a.id, sec(10))) as { attemptId: number };
    const v = (await L.attemptView(ME, attemptId, sec(11)))!;
    expect(v.question!.choices.map((c) => Object.keys(c))).toEqual([["text"], ["text"], ["text"], ["text"]]);
    for (const bad of [4, -1, 1.5]) {
      expect(await L.answer({ personId: ME, attemptId, questionId: v.question!.id, choiceIndex: bad, now: sec(12) })).toEqual({ ok: false, error: "ตัวเลือกไม่ถูกต้อง" });
    }
  });

  it("กดตอบข้อเดียวกันพร้อมกันสองครั้ง → ลงครั้งเดียว ไม่ทับกัน · ออกจากหน้าสอบพร้อมกันนับครบ", async () => {
    const { a, docs } = await seed();
    await startSession(T0);
    await readAll(a.id, docs, sec(5));
    const { attemptId } = (await startExam(a.id, sec(10))) as { attemptId: number };
    const v = (await L.attemptView(ME, attemptId, sec(11)))!;
    const outs = await Promise.all([0, 1].map((i) => L.answer({ personId: ME, attemptId, questionId: v.question!.id, choiceIndex: i, now: sec(12) })));
    expect(outs.filter((o) => o.ok)).toHaveLength(1);
    const [t] = await testDb().select().from(schema.attempts).where(eq(schema.attempts.id, attemptId));
    expect(Object.keys(t.answers as object)).toEqual([String(v.question!.id)]);

    await Promise.all([1, 2].map((i) => L.recordLeave({ personId: ME, attemptId, now: sec(12 + i) })));
    const [after] = await testDb().select().from(schema.attempts).where(eq(schema.attempts.id, attemptId));
    expect(after.leaveCount).toBe(2);
  });

  it("id ใน URL ที่ไม่ใช่ตัวเลข = ไม่พบ (ไม่ใช่ 500) · เริ่มสอบซ้ำพร้อมกันด้วยสแกนเดียว = ได้ครั้งเดียว อีกครั้งได้ข้อความ", async () => {
    expect(await L.attemptView(ME, Number("abc"))).toBeNull();
    expect(await L.attemptView(ME, Number("12abc"))).toBeNull();
    const { a, docs } = await seed();
    await startSession(T0);
    await readAll(a.id, docs, sec(5));
    const scan = await recordScan({ personId: ME, purpose: "exam", pass: true, now: sec(10) });
    if (!scan.ok) throw new Error(scan.error);
    const outs = await Promise.all([0, 1].map(() => L.startAttempt({ personId: ME, assignmentId: a.id, scanId: scan.scanId, now: sec(10) })));
    expect(outs.filter((o) => o.ok)).toHaveLength(1);
    expect(outs.find((o) => !o.ok)).toMatchObject({ ok: false });
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

  it("อ่านใหม่แล้วเริ่มนับใหม่ — ไม่ผ่านครั้งเดียวหลังอ่านใหม่ยังสอบต่อได้ · ไม่ผ่านอีก 2 ครั้งติดจึงอ่านใหม่อีกรอบ", async () => {
    const { a, docs } = await seed();
    await startSession(T0);
    await readAll(a.id, docs, sec(5));
    for (const t of [10, 30]) await answerAll(((await startExam(a.id, sec(t))) as { attemptId: number }).attemptId, 3, sec(t + 10));
    await startSession(sec(60));
    await readAll(a.id, docs, sec(65));

    await answerAll(((await startExam(a.id, sec(70))) as { attemptId: number }).attemptId, 3, sec(80));
    expect((await L.learnView(ME, a.id, sec(90)))?.state).toBe("ready");
    await answerAll(((await startExam(a.id, sec(90))) as { attemptId: number }).attemptId, 3, sec(100));
    expect((await L.learnView(ME, a.id, sec(110)))?.state).toBe("relearn");
  });
});
