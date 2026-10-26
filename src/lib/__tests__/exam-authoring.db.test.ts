import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import { PRODUCT_BLUEPRINT, slots, type Blueprint } from "@/domain/blueprint";
import type { Actor } from "@/lib/auth";
import type { ExamModel, GeneratedQuestion } from "@/lib/exam-generator";
import { devStoreObjects } from "@/lib/object-store";
import { clearOrgCache } from "@/lib/workid";

/**
 * ผู้สร้างทำชุด → อัปเอกสาร → AI ออก 5 ชุด → ส่ง → ผู้อนุมัติแก้/ตีกลับ/อนุมัติ (spec §2–§4 · PGlite + migration จริง)
 * AI เป็นตัวปลอมที่ขอบ `ExamModel` · ที่เก็บไฟล์เป็นที่เก็บจำลองในหน่วยความจำ (`localDevStore`)
 */

vi.mock("@/db", async () => {
  const s = await import("@/db/schema");
  const { testDb: get } = await import("@/db/__tests__/pgdb");
  return { db: () => get(), schema: s };
});

const { createSet, updateSettings, requestUpload, confirmUpload, getSetDetail, listManagedSets } = await import("@/lib/set-service");
const { generateExams, editQuestion, regenerateQuestion } = await import("@/lib/exam-service");
const { submitForApproval, returnToAuthor, approve } = await import("@/lib/approval-service");

const pd: Actor = { personId: 10, email: "pd@ws.co", name: "พีดี ผู้สร้าง", role: "author" };
const pdMgr: Actor = { personId: 20, email: "mgr@ws.co", name: "ผจก. พีดี", role: "user" };
const sales: Actor = { personId: 30, email: "s@ws.co", name: "เซล", role: "user" };

const ORG = [
  { personId: 10, email: "pd@ws.co", fullName: "พีดี ผู้สร้าง", name: "พีดี ผู้สร้าง", managerPersonId: 20 },
  { personId: 20, email: "mgr@ws.co", fullName: "ผจก. พีดี", name: "ผจก. พีดี", managerPersonId: null },
  { personId: 30, email: "s@ws.co", fullName: "เซล", name: "เซล", managerPersonId: 20 },
];

const PDF = new TextEncoder().encode("%PDF-1.7 fake catalog");

let counter = 0;
function question(topic: GeneratedQuestion["topic"], level: GeneratedQuestion["level"]): GeneratedQuestion {
  counter += 1;
  return {
    topic,
    level,
    text: `คำถามที่ ${counter}`,
    choices: [`ก${counter}`, `ข${counter}`, `ค${counter}`, `ง${counter}`],
    correctIndex: counter % 4,
    sourceRef: "catalog.pdf หน้า 5",
  };
}

function fakeModel(overrides: Partial<ExamModel> = {}): ExamModel & { calls: number } {
  const m = {
    calls: 0,
    async generateForms(input: { blueprint: Blueprint; formCount: number }) {
      m.calls += 1;
      return {
        ok: true as const,
        value: Array.from({ length: input.formCount }, () => slots(input.blueprint).map((s) => question(s.topic, s.level))),
      };
    },
    async regenerateQuestion(input: { topic: GeneratedQuestion["topic"]; level: GeneratedQuestion["level"] }) {
      return { ok: true as const, value: question(input.topic, input.level) };
    },
    ...overrides,
  };
  return m;
}

async function uploadPdf(actor: Actor, setId: number, bytes = PDF) {
  const req = await requestUpload({ actor, setId, docKind: "catalog", fileName: "Signature V.1.pdf", mime: "application/pdf", size: PDF.byteLength });
  if (!req.ok) throw new Error(req.error);
  const key = decodeURIComponent(new URL(req.uploadUrl, "http://x").pathname.replace("/api/dev-store/", ""));
  devStoreObjects().set(key, bytes);
  return confirmUpload({ actor, token: req.token });
}

async function readySet() {
  const created = await createSet({ actor: pd, title: "F331 Signature", kind: "product" });
  if (!created.ok) throw new Error(created.error);
  const up = await uploadPdf(pd, created.setId);
  if (!up.ok) throw new Error(up.error);
  const gen = await generateExams({ actor: pd, setId: created.setId, model: fakeModel() });
  if (!gen.ok) throw new Error(gen.error);
  return created.setId;
}

async function events(setId: number) {
  return testDb().select().from(schema.approvalEvents).where(eq(schema.approvalEvents.setId, setId)).orderBy(asc(schema.approvalEvents.id));
}

beforeAll(setupTestDb);
beforeEach(async () => {
  await truncateAll();
  devStoreObjects().clear();
  clearOrgCache();
  vi.stubEnv("SESSION_SECRET", "test-secret-test-secret-test-secret-0000");
  vi.stubEnv("WORKTRAIN_DEV_ORG", JSON.stringify(ORG));
});
afterEach(() => vi.unstubAllEnvs());

describe("สร้างชุดการเรียนรู้", () => {
  it("ผู้อนุมัติค่าเริ่มต้น = หัวหน้าตามผังของผู้สร้าง (ADR-0004) · ชุดสินค้าได้แม่แบบ PD · มีเวอร์ชัน 1", async () => {
    const r = await createSet({ actor: pd, title: "  F331 Signature  ", kind: "product" });
    expect(r.ok).toBe(true);
    const detail = await getSetDetail(pd, (r as { setId: number }).setId);
    expect(detail?.set).toMatchObject({ title: "F331 Signature", status: "draft", approverPersonId: 20, approverName: "ผจก. พีดี" });
    expect(detail?.blueprint).toEqual(PRODUCT_BLUEPRINT);
    expect(detail?.version).toMatchObject({ versionNo: 1, changeKind: "initial" });
  });

  it("ผู้เรียน (user) สร้างไม่ได้", async () => {
    expect(await createSet({ actor: sales, title: "x", kind: "general" })).toEqual({ ok: false, error: "บัญชีนี้สร้างชุดการเรียนรู้ไม่ได้" });
  });

  it("ตั้งผู้อนุมัติเป็นตัวเองไม่ได้ · สัดส่วนต้องรวม 10", async () => {
    const r = await createSet({ actor: pd, title: "x", kind: "general" });
    const setId = (r as { setId: number }).setId;
    expect((await updateSettings({ actor: pd, setId, settings: { approver: { personId: 10, name: "ตัวเอง" } } })).ok).toBe(false);
    expect(await updateSettings({ actor: pd, setId, settings: { blueprint: [{ topic: "general", level: "recall", count: 3 }] } })).toEqual({
      ok: false,
      error: "รวมต้องได้ 10 ข้อ (ตอนนี้ 3)",
    });
  });

  it("ผู้อนุมัติเห็นชุดในรายการ · คนอื่นไม่เห็นและเปิดรายละเอียดไม่ได้", async () => {
    const r = await createSet({ actor: pd, title: "x", kind: "general" });
    const setId = (r as { setId: number }).setId;
    expect((await listManagedSets(pdMgr)).map((s) => s.id)).toEqual([setId]);
    expect(await listManagedSets(sales)).toEqual([]);
    expect(await getSetDetail(sales, setId)).toBeNull();
  });
});

describe("อัปโหลดเอกสาร", () => {
  it("อัปแล้วยืนยัน → มีแถวเอกสาร · ยืนยันซ้ำไม่ได้แถวที่สอง", async () => {
    const r = await createSet({ actor: pd, title: "x", kind: "product" });
    const setId = (r as { setId: number }).setId;
    const req = await requestUpload({ actor: pd, setId, docKind: "catalog", fileName: "a.pdf", mime: "application/pdf", size: PDF.byteLength });
    if (!req.ok) throw new Error(req.error);
    const key = decodeURIComponent(new URL(req.uploadUrl, "http://x").pathname.replace("/api/dev-store/", ""));
    expect(key).toMatch(new RegExp(`^sets/${setId}/v1/[0-9a-f]{24}\\.pdf$`));
    devStoreObjects().set(key, PDF);
    const a = await confirmUpload({ actor: pd, token: req.token });
    const b = await confirmUpload({ actor: pd, token: req.token });
    expect(a).toEqual(b);
    expect((await getSetDetail(pd, setId))?.documents).toHaveLength(1);
  });

  it("ขนาดไฟล์ที่มาถึงไม่ตรงกับที่ขอ → ปฏิเสธและลบไฟล์ทิ้ง", async () => {
    const r = await createSet({ actor: pd, title: "x", kind: "product" });
    const out = await uploadPdf(pd, (r as { setId: number }).setId, new Uint8Array(5));
    expect(out).toEqual({ ok: false, error: "ขนาดไฟล์ไม่ตรงกับที่แจ้งไว้" });
    expect(devStoreObjects().size).toBe(0);
  });

  it("ไม่รับชนิดไฟล์อื่น · token ของคนอื่นใช้ไม่ได้", async () => {
    const r = await createSet({ actor: pd, title: "x", kind: "product" });
    const setId = (r as { setId: number }).setId;
    expect((await requestUpload({ actor: pd, setId, docKind: "other", fileName: "a.exe", mime: "application/x-msdownload", size: 10 })).ok).toBe(false);
    const req = await requestUpload({ actor: pd, setId, docKind: "catalog", fileName: "a.pdf", mime: "application/pdf", size: PDF.byteLength });
    if (!req.ok) throw new Error(req.error);
    expect(await confirmUpload({ actor: sales, token: req.token })).toEqual({ ok: false, error: "ใบอัปโหลดไม่ถูกต้อง" });
  });
});

describe("AI ออกข้อสอบ", () => {
  it("ได้ 5 ชุด ชุดละ 10 ข้อ ทุกข้อ 4 ตัวเลือกถูกข้อเดียว", async () => {
    const setId = await readySet();
    const d = await getSetDetail(pd, setId);
    expect(d?.forms.map((f) => [f.kind, f.formNo, f.questions.length])).toEqual([1, 2, 3, 4, 5].map((n) => ["full", n, 10]));
    for (const q of d!.forms.flatMap((f) => f.questions)) {
      expect(q.choices).toHaveLength(4);
      expect(q.choices.filter((c) => c.isCorrect)).toHaveLength(1);
    }
  });

  it("AI ให้ไม่ครบตามสัดส่วน → ปฏิเสธ และข้อสอบเดิมยังอยู่", async () => {
    const setId = await readySet();
    const before = (await getSetDetail(pd, setId))!.forms.flatMap((f) => f.questions.map((q) => q.text));
    const broken = fakeModel({
      async generateForms(input) {
        return { ok: true, value: Array.from({ length: input.formCount }, () => [question("spec", "recall")]) };
      },
    });
    const out = await generateExams({ actor: pd, setId, model: broken });
    expect(out.ok).toBe(false);
    expect((await getSetDetail(pd, setId))!.forms.flatMap((f) => f.questions.map((q) => q.text))).toEqual(before);
  });

  it("ไม่มีเอกสาร PDF → บอกตรง ๆ ไม่เรียก AI", async () => {
    const r = await createSet({ actor: pd, title: "x", kind: "product" });
    const model = fakeModel();
    expect(await generateExams({ actor: pd, setId: (r as { setId: number }).setId, model })).toEqual({
      ok: false,
      error: "ต้องมีเอกสาร PDF อย่างน้อย 1 ไฟล์ก่อนออกข้อสอบ",
    });
    expect(model.calls).toBe(0);
  });

  it("ไม่ได้ตั้ง API key → บอกตรง ๆ", async () => {
    const r = await createSet({ actor: pd, title: "x", kind: "product" });
    expect((await generateExams({ actor: pd, setId: (r as { setId: number }).setId, model: null })).ok).toBe(false);
  });
});

describe("แก้ข้อสอบ", () => {
  it("ผู้สร้างแก้ตอนร่างได้ · ลงประวัติก่อน/หลัง", async () => {
    const setId = await readySet();
    const q = (await getSetDetail(pd, setId))!.forms[0].questions[0];
    const out = await editQuestion({
      actor: pd,
      questionId: q.id,
      edit: { text: "STELVIO มีสีอะไรบ้าง", sourceRef: "หน้า 5", choices: ["Black Oak / Anthracite", "ขาว", "ดำ", "เทา"], correctIndex: 0 },
    });
    expect(out.ok).toBe(true);
    const after = (await getSetDetail(pd, setId))!.forms[0].questions[0];
    expect(after).toMatchObject({ id: q.id, text: "STELVIO มีสีอะไรบ้าง" });
    expect(after.choices.find((c) => c.isCorrect)?.text).toBe("Black Oak / Anthracite");
    const [ev] = await events(setId);
    expect(ev).toMatchObject({ action: "question_edited", actorPersonId: 10 });
    expect((ev.detail as { before: { text: string } }).before.text).toBe(q.text);
  });

  it("ตัวเลือกซ้ำ → ปฏิเสธ", async () => {
    const setId = await readySet();
    const q = (await getSetDetail(pd, setId))!.forms[0].questions[0];
    const out = await editQuestion({ actor: pd, questionId: q.id, edit: { text: "x", sourceRef: "y", choices: ["a", "a", "b", "c"], correctIndex: 0 } });
    expect(out).toEqual({ ok: false, error: "ตัวเลือกซ้ำกัน" });
  });

  it("ออกใหม่ทีละข้อ — หัวข้อและระดับเดิม · id เดิม", async () => {
    const setId = await readySet();
    const q = (await getSetDetail(pd, setId))!.forms[0].questions[3];
    expect((await regenerateQuestion({ actor: pd, questionId: q.id, model: fakeModel() })).ok).toBe(true);
    const after = (await getSetDetail(pd, setId))!.forms[0].questions[3];
    expect(after).toMatchObject({ id: q.id, topic: q.topic, level: q.level });
    expect(after.text).not.toBe(q.text);
  });
});

describe("การอนุมัติ", () => {
  it("ส่ง → ผู้อนุมัติแก้ได้ ผู้สร้างแก้ไม่ได้ → อนุมัติ → ใช้อยู่", async () => {
    const setId = await readySet();
    expect(await submitForApproval({ actor: pd, setId })).toEqual({ ok: true });
    const q = (await getSetDetail(pdMgr, setId))!.forms[1].questions[0];
    const edit = { text: "แก้โดยผู้อนุมัติ", sourceRef: "หน้า 6", choices: ["1", "2", "3", "4"], correctIndex: 2 };
    expect((await editQuestion({ actor: pd, questionId: q.id, edit })).ok).toBe(false);
    expect((await editQuestion({ actor: pdMgr, questionId: q.id, edit })).ok).toBe(true);
    expect((await approve({ actor: sales, setId })).ok).toBe(false);
    expect(await approve({ actor: pdMgr, setId })).toEqual({ ok: true });
    const d = await getSetDetail(pdMgr, setId);
    expect(d?.set.status).toBe("active");
    expect(d?.version?.approvedAt).not.toBeNull();
    expect((await events(setId)).map((e) => e.action)).toEqual(["submitted", "question_edited", "approved"]);
  });

  it("ตีกลับต้องมีความเห็น → กลับเป็นร่าง ผู้สร้างแก้ต่อได้", async () => {
    const setId = await readySet();
    await submitForApproval({ actor: pd, setId });
    expect((await returnToAuthor({ actor: pdMgr, setId, comment: "  " })).ok).toBe(false);
    expect(await returnToAuthor({ actor: pdMgr, setId, comment: "ราคา STELVIO ใน Pricelist ผิด" })).toEqual({ ok: true });
    expect((await getSetDetail(pd, setId))?.set.status).toBe("draft");
    const last = (await events(setId)).at(-1);
    expect(last).toMatchObject({ action: "returned", comment: "ราคา STELVIO ใน Pricelist ผิด" });
  });

  it("ส่งไม่ได้ถ้ายังไม่มีข้อสอบครบ หรือยังไม่มีผู้อนุมัติ", async () => {
    const r = await createSet({ actor: pd, title: "x", kind: "product" });
    const setId = (r as { setId: number }).setId;
    expect((await submitForApproval({ actor: pd, setId })).ok).toBe(false);
    await updateSettings({ actor: pd, setId, settings: { approver: null } });
    await uploadPdf(pd, setId);
    await generateExams({ actor: pd, setId, model: fakeModel() });
    expect(await submitForApproval({ actor: pd, setId })).toEqual({ ok: false, error: "ยังไม่ได้เลือกผู้อนุมัติ" });
  });
});
