import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import { slots, type Blueprint } from "@/domain/blueprint";
import type { Actor } from "@/lib/auth";
import type { ExamModel, GeneratedQuestion } from "@/lib/exam-generator";
import { devStoreObjects } from "@/lib/object-store";
import { clearOrgCache } from "@/lib/workid";

/**
 * เอกสารประกอบ (ADR-0025) — เพิ่มเข้าชุดที่ใช้อยู่ได้ทันทีโดยไม่ต้องเริ่มเวอร์ชันใหม่ · ผู้เรียนเปิดได้ ไม่ต้องครบก่อนสอบ · AI ไม่ใช้ ·
 * ข้อสอบเดิมไม่เปลี่ยน · PGlite + migration จริง · AI ปลอมที่ขอบ `ExamModel`
 */

vi.mock("@/db", async () => {
  const s = await import("@/db/schema");
  const { testDb: get } = await import("@/db/__tests__/pgdb");
  return { db: () => get(), schema: s };
});

const S = await import("@/lib/set-service");
const { generateExams } = await import("@/lib/exam-service");
const { submitForApproval, approve } = await import("@/lib/approval-service");
const V = await import("@/lib/version-service");
const L = await import("@/lib/learn-service");

const pd: Actor = { personId: 10, email: "pd@ws.co", name: "พีดี", role: "author" };
const mgr: Actor = { personId: 20, email: "mgr@ws.co", name: "ผจก.", role: "user" };
const other: Actor = { personId: 40, email: "o@ws.co", name: "คนอื่น", role: "author" };
const tg: Actor = { personId: 1, email: "tg@ws.co", name: "ทีจี", role: "admin" };
const ME = 31;

const ORG = [
  { personId: 10, email: "pd@ws.co", fullName: "พีดี", managerPersonId: 20 },
  { personId: 20, email: "mgr@ws.co", fullName: "ผจก." },
  { personId: 31, email: "s@ws.co", fullName: "เซล" },
  { personId: 40, email: "o@ws.co", fullName: "คนอื่น" },
];

const PDF = await (async () => {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.addPage();
  return doc.save();
})();

let n = 0;
function q(topic: GeneratedQuestion["topic"], level: GeneratedQuestion["level"]): GeneratedQuestion {
  n += 1;
  return { topic, level, text: `ข้อ ${n}`, choices: [`ก${n}`, `ข${n}`, `ค${n}`, `ง${n}`], correctIndex: 0, sourceRef: "หน้า 1" };
}

const model: ExamModel & { calls: number } = {
  calls: 0,
  async generateForms(input: { blueprint: Blueprint; formCount: number }) {
    model.calls += 1;
    return { ok: true as const, value: Array.from({ length: input.formCount }, () => slots(input.blueprint).map((s) => q(s.topic, s.level))) };
  },
  async regenerateQuestion(input: { topic: GeneratedQuestion["topic"]; level: GeneratedQuestion["level"] }) {
    return { ok: true as const, value: q(input.topic, input.level) };
  },
  async summarizeChanges() {
    return { ok: true as const, value: "- เปลี่ยน" };
  },
};

async function upload(actor: Actor, setId: number, docKind: schema.DocumentKind, fileName = "cat.pdf", mime = "application/pdf", now?: Date) {
  const req = await S.requestUpload({ actor, setId, docKind, fileName, mime, size: PDF.byteLength });
  if (!req.ok) return req;
  const key = decodeURIComponent(new URL(req.uploadUrl, "http://x").pathname.replace("/api/dev-store/", ""));
  devStoreObjects().set(key, PDF);
  return S.confirmUpload({ actor, token: req.token, now });
}

const T_APPROVE = new Date("2026-11-01T09:00:00+07:00");
const T_ASSIGN = new Date("2026-11-02T09:00:00+07:00");
const T_ADD = new Date("2026-11-03T09:00:00+07:00");
const sec = (s: number) => new Date(T_ADD.getTime() + s * 1000);

/** ชุดที่ใช้อยู่ v1 (เอกสารหลัก PDF 2 หน้า · ข้อสอบ 5 ชุด) · มอบให้ ME แล้ว */
async function activeSet(passed = false) {
  const c = await S.createSet({ actor: pd, title: "F331", kindId: schema.SEEDED_KIND_IDS.general });
  if (!c.ok) throw new Error(c.error);
  const up = await upload(pd, c.setId, "catalog");
  if (!up.ok) throw new Error(up.error);
  const g = await generateExams({ actor: pd, setId: c.setId, model });
  if (!g.ok) throw new Error(g.error);
  const sub = await submitForApproval({ actor: pd, setId: c.setId });
  if (!sub.ok) throw new Error(sub.error);
  const ap = await approve({ actor: mgr, setId: c.setId, now: T_APPROVE });
  if (!ap.ok) throw new Error(ap.error);
  const [a] = await testDb()
    .insert(schema.assignments)
    .values({ setId: c.setId, personId: ME, personName: "เซล", source: "audience", assignedAt: T_ASSIGN, dueAt: new Date("2026-11-09T09:00:00+07:00"), passedAt: passed ? T_ADD : null })
    .returning();
  return { setId: c.setId, assignmentId: a.id, catalogId: up.documentId };
}

async function startSession(at: Date) {
  const [scan] = await testDb()
    .insert(schema.faceScans)
    .values({ personId: ME, purpose: "study", result: "pass", deleteAfter: new Date(at.getTime() + 90 * 86400_000), createdAt: at })
    .returning({ id: schema.faceScans.id });
  const s = await L.startStudySession({ personId: ME, scanId: scan.id, now: at });
  if (!s.ok) throw new Error(s.error);
}

async function docsOf(setId: number) {
  const rows = await testDb()
    .select({ doc: schema.documents })
    .from(schema.documents)
    .innerJoin(schema.setVersions, eq(schema.setVersions.id, schema.documents.versionId))
    .where(eq(schema.setVersions.setId, setId));
  return rows.map((r) => r.doc);
}

async function eventsOf(setId: number, action: schema.ApprovalAction) {
  return testDb()
    .select()
    .from(schema.approvalEvents)
    .where(and(eq(schema.approvalEvents.setId, setId), eq(schema.approvalEvents.action, action)));
}

beforeAll(setupTestDb);
beforeEach(async () => {
  await truncateAll();
  devStoreObjects().clear();
  clearOrgCache();
  model.calls = 0;
  vi.stubEnv("SESSION_SECRET", "test-secret-test-secret-test-secret-0000");
  vi.stubEnv("WORKTRAIN_DEV_ORG", JSON.stringify(ORG));
});
afterEach(() => vi.unstubAllEnvs());

describe("เพิ่มเอกสารประกอบเข้าชุดที่ใช้อยู่", () => {
  it("ผู้สร้างเพิ่มได้ทันที — เข้าเวอร์ชันที่ผู้เรียนเห็น · ไม่เริ่มเวอร์ชันใหม่ · ข้อสอบเดิมไม่เปลี่ยน · ลงประวัติ", async () => {
    const { setId } = await activeSet();
    const formsBefore = await testDb().select().from(schema.examForms);
    const calls = model.calls;

    const out = await upload(pd, setId, "reference", "คู่มือทบทวน.pdf", "application/pdf", T_ADD);
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const versions = await testDb().select().from(schema.setVersions).where(eq(schema.setVersions.setId, setId));
    expect(versions).toHaveLength(1);
    const ref = (await docsOf(setId)).find((d) => d.id === out.documentId)!;
    expect(ref).toMatchObject({ kind: "reference", fileName: "คู่มือทบทวน", pageCount: 2, versionId: versions[0].id });
    expect(await testDb().select().from(schema.examForms)).toEqual(formsBefore);
    expect(model.calls).toBe(calls);

    const events = await eventsOf(setId, "reference_added");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorPersonId: pd.personId, detail: { documentId: out.documentId, fileName: "คู่มือทบทวน" }, createdAt: T_ADD });
  });

  it("TG เพิ่มได้ · คนอื่นเพิ่มไม่ได้ · ชุดที่ใช้อยู่เพิ่มเนื้อหาที่ต้องเรียนไม่ได้ · Excel เป็นเอกสารประกอบไม่ได้", async () => {
    const { setId } = await activeSet();
    expect((await upload(tg, setId, "reference", "tg.pdf")).ok).toBe(true);
    expect((await upload(other, setId, "reference", "x.pdf")).ok).toBe(false);
    expect(await upload(pd, setId, "catalog", "new.pdf")).toEqual({ ok: false, error: "ชุดที่ใช้อยู่เพิ่มได้เฉพาะเอกสารประกอบ — เนื้อหาที่ต้องเรียนให้เริ่มเวอร์ชันใหม่" });
    const xlsx = await S.requestUpload({ actor: pd, setId, docKind: "reference", fileName: "a.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 10 });
    expect(xlsx).toEqual({ ok: false, error: "เอกสารประกอบต้องเป็น PDF หรือวิดีโอ MP4" });
  });

  it("มีเวอร์ชันใหม่ค้างอยู่ = เอกสารประกอบเข้าเวอร์ชันใหม่ทางปกติ (ผู้เรียนเห็นเมื่ออนุมัติ) · ไม่ลงประวัติ", async () => {
    const { setId, assignmentId } = await activeSet();
    const s = await V.startVersion({ actor: pd, setId, label: "V.2" });
    if (!s.ok) throw new Error(s.error);
    const out = await upload(pd, setId, "reference", "ref.pdf");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const ref = (await docsOf(setId)).find((d) => d.id === out.documentId)!;
    expect(ref.versionId).toBe(s.versionId);
    expect(await eventsOf(setId, "reference_added")).toHaveLength(0);
    expect((await L.learnView(ME, assignmentId, T_ADD))!.documents.map((d) => d.id)).not.toContain(out.documentId);
  });

  it("ชุดที่ปิดแล้วเพิ่มไม่ได้", async () => {
    const { setId } = await activeSet();
    await testDb().update(schema.learningSets).set({ status: "closed" }).where(eq(schema.learningSets.id, setId));
    expect((await upload(pd, setId, "reference", "ref.pdf")).ok).toBe(false);
  });
});

describe("ผู้เรียนกับเอกสารประกอบ", () => {
  it("เห็นต่อท้ายเป็นเอกสารประกอบ · ไม่ต้องอ่านครบก็สอบได้ · ส่งความคืบหน้าไม่ได้ · เปิดได้", async () => {
    const { setId, assignmentId, catalogId } = await activeSet();
    const ref = await upload(pd, setId, "reference", "ref.pdf", "application/pdf", T_ADD);
    if (!ref.ok) throw new Error(ref.error);

    await startSession(sec(1));
    const view = (await L.learnView(ME, assignmentId, sec(2)))!;
    expect(view.documents.map((d) => [d.id, d.reference])).toEqual([
      [catalogId, false],
      [ref.documentId, true],
    ]);

    expect(await L.recordReading({ personId: ME, assignmentId, documentId: ref.documentId, pages: [1], activeSeconds: 5, now: sec(3) })).toEqual({
      ok: false,
      error: "ไม่พบเอกสารนี้",
    });
    const read = await L.recordReading({ personId: ME, assignmentId, documentId: catalogId, pages: [1, 2], activeSeconds: 15, now: sec(4) });
    expect(read).toMatchObject({ ok: true, completed: true });
    expect((await L.learnView(ME, assignmentId, sec(5)))!.state).toBe("ready");
    expect((await L.myLearningList(ME, sec(5)))[0]).toMatchObject({ docsTotal: 1, docsDone: 1, status: "ready" });

    const link = await L.documentLink({ personId: ME, assignmentId, documentId: ref.documentId, now: sec(6) });
    expect(link.ok).toBe(true);
  });

  it("คนที่ผ่านแล้วเปิดทบทวนได้โดยไม่ต้องสแกน · ไม่มีอะไรต้องทำเพิ่ม", async () => {
    const { setId, assignmentId } = await activeSet(true);
    const ref = await upload(pd, setId, "reference", "ref.pdf");
    if (!ref.ok) throw new Error(ref.error);
    const view = (await L.learnView(ME, assignmentId, sec(1)))!;
    expect(view.state).toBe("passed");
    expect(view.review).toBe(true);
    expect((await L.documentLink({ personId: ME, assignmentId, documentId: ref.documentId, now: sec(2) })).ok).toBe(true);
  });
});

describe("จัดการเอกสารประกอบในชุดที่ใช้อยู่", () => {
  it("เปลี่ยนชื่อได้ · เปลี่ยนเป็นเนื้อหาที่ต้องเรียนไม่ได้ · เอกสารอื่นในชุดยังแก้ไม่ได้", async () => {
    const { setId, catalogId } = await activeSet();
    const ref = await upload(pd, setId, "reference", "ref.pdf");
    if (!ref.ok) throw new Error(ref.error);
    expect(await S.updateDocument({ actor: pd, documentId: ref.documentId, fileName: "สรุปราคา", kind: "reference", examWeight: 1 })).toEqual({ ok: true });
    expect((await docsOf(setId)).find((d) => d.id === ref.documentId)!.fileName).toBe("สรุปราคา");
    expect((await S.updateDocument({ actor: pd, documentId: ref.documentId, kind: "catalog" })).ok).toBe(false);
    expect((await S.updateDocument({ actor: pd, documentId: catalogId, fileName: "ใหม่" })).ok).toBe(false);
    expect((await S.updateDocument({ actor: other, documentId: ref.documentId, fileName: "x" })).ok).toBe(false);
  });

  it("ลบได้ถ้ายังไม่มีใครเปิด (ลงประวัติ · ลบไฟล์) · มีคนเปิดแล้วลบไม่ได้ ให้ซ่อนแทน · เอกสารหลักยังลบไม่ได้", async () => {
    const { setId, assignmentId, catalogId } = await activeSet(true);
    const a = await upload(pd, setId, "reference", "a.pdf");
    const b = await upload(pd, setId, "reference", "b.pdf");
    if (!a.ok || !b.ok) throw new Error("upload");
    const keyA = (await docsOf(setId)).find((d) => d.id === a.documentId)!.objectKey;

    expect(await S.removeDocument({ actor: pd, documentId: a.documentId, now: sec(1) })).toEqual({ ok: true });
    expect((await docsOf(setId)).map((d) => d.id)).not.toContain(a.documentId);
    expect(devStoreObjects().has(keyA)).toBe(false);
    expect(await eventsOf(setId, "reference_removed")).toMatchObject([{ detail: { documentId: a.documentId, fileName: "a" } }]);

    await L.documentLink({ personId: ME, assignmentId, documentId: b.documentId, now: sec(2) });
    expect(await S.removeDocument({ actor: pd, documentId: b.documentId })).toEqual({ ok: false, error: "มีผู้เรียนเปิดเอกสารนี้แล้ว — ลบไม่ได้ ใช้สวิตช์ซ่อนแทน" });
    expect(await S.setDocumentHidden({ actor: pd, documentId: b.documentId, hidden: true })).toEqual({ ok: true });

    expect((await S.removeDocument({ actor: pd, documentId: catalogId })).ok).toBe(false);
  });

  it("ซ่อนเนื้อหาที่ต้องเรียนชิ้นสุดท้ายไม่ได้ แม้มีเอกสารประกอบเหลืออยู่", async () => {
    const { setId, catalogId } = await activeSet();
    await upload(pd, setId, "reference", "ref.pdf");
    expect(await S.setDocumentHidden({ actor: pd, documentId: catalogId, hidden: true })).toEqual({ ok: false, error: "ต้องเหลือคลิปหรือเอกสารให้ผู้เรียนอย่างน้อย 1 รายการ" });
  });
});

describe("เอกสารประกอบในชุดร่าง", () => {
  it("ตั้งเป็นเอกสารประกอบได้ · AI ไม่ใช้ · ส่งขออนุมัติไม่ได้ถ้าไม่มีเนื้อหาที่ต้องเรียน", async () => {
    const c = await S.createSet({ actor: pd, title: "ร่าง", kindId: schema.SEEDED_KIND_IDS.general });
    if (!c.ok) throw new Error(c.error);
    const up = await upload(pd, c.setId, "catalog");
    if (!up.ok) throw new Error(up.error);
    expect((await generateExams({ actor: pd, setId: c.setId, model })).ok).toBe(true);

    expect(await S.updateDocument({ actor: pd, documentId: up.documentId, kind: "reference" })).toEqual({ ok: true });
    expect(await generateExams({ actor: pd, setId: c.setId, model })).toEqual({
      ok: false,
      error: "PDF ทุกไฟล์เป็นเอกสารประกอบ — AI ไม่ใช้ออกข้อสอบ ตั้งอย่างน้อย 1 ไฟล์เป็นเอกสารหลักหรืออื่น ๆ",
    });
    expect(await submitForApproval({ actor: pd, setId: c.setId })).toEqual({
      ok: false,
      error: "ต้องมีคลิปหรือเอกสารที่ผู้เรียนต้องดู/อ่านอย่างน้อย 1 รายการ — เอกสารประกอบไม่นับ",
    });
  });
});
