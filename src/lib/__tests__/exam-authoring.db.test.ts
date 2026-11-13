import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import { PRODUCT_BLUEPRINT, slots, type Blueprint } from "@/domain/blueprint";
import type { Actor } from "@/lib/auth";
import type { ExamModel, GeneratedQuestion } from "@/lib/exam-generator";
import { devStoreObjects } from "@/lib/object-store";
import { fakeMp4 } from "@/domain/__tests__/mp4-fixture";
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

const {
  createSet,
  updateSettings,
  requestUpload,
  confirmUpload,
  getSetDetail,
  listManagedSets,
  setVideoCover,
  coverImage,
  coverPath,
  authorVideoLink,
  removeDocument,
  updateDocument,
  moveDocument,
  setSpreadMode,
} = await import("@/lib/set-service");
const { generateExams, editQuestion, regenerateQuestion, setQuestionReviewed, reviewedQuestionIds } = await import("@/lib/exam-service");
const { submitForApproval, returnToAuthor, approve } = await import("@/lib/approval-service");

const pd: Actor = { personId: 10, email: "pd@ws.co", name: "พีดี ผู้สร้าง", role: "author" };
const pdMgr: Actor = { personId: 20, email: "mgr@ws.co", name: "ผจก. พีดี", role: "user" };
const sales: Actor = { personId: 30, email: "s@ws.co", name: "เซล", role: "user" };

const ORG = [
  { personId: 10, email: "pd@ws.co", fullName: "พีดี ผู้สร้าง", name: "พีดี ผู้สร้าง", managerPersonId: 20 },
  { personId: 20, email: "mgr@ws.co", fullName: "ผจก. พีดี", name: "ผจก. พีดี", managerPersonId: null },
  { personId: 30, email: "s@ws.co", fullName: "เซล", name: "เซล", managerPersonId: 20 },
];

/** PDF จริง 3 หน้า — confirmUpload นับหน้าจากไฟล์ */
const PDF = await (async () => {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage();
  return doc.save();
})();

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
    async summarizeChanges() {
      return { ok: true as const, value: "- ราคา F331 เปลี่ยนจาก 12,900 เป็น 13,500" };
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
  const created = await createSet({ actor: pd, title: "F331 Signature", kindId: schema.SEEDED_KIND_IDS.product });
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
    const r = await createSet({ actor: pd, title: "  F331 Signature  ", kindId: schema.SEEDED_KIND_IDS.product });
    expect(r.ok).toBe(true);
    const detail = await getSetDetail(pd, (r as { setId: number }).setId);
    expect(detail?.set).toMatchObject({ title: "F331 Signature", status: "draft", approverPersonId: 20, approverName: "ผจก. พีดี" });
    expect(detail?.blueprint).toEqual(PRODUCT_BLUEPRINT);
    expect(detail?.version).toMatchObject({ versionNo: 1, changeKind: "initial" });
  });

  it("ผู้เรียน (user) สร้างไม่ได้", async () => {
    expect(await createSet({ actor: sales, title: "x", kindId: schema.SEEDED_KIND_IDS.general })).toEqual({ ok: false, error: "บัญชีนี้สร้างชุดการเรียนรู้ไม่ได้" });
  });

  it("ตั้งผู้อนุมัติเป็นตัวเองไม่ได้ · สัดส่วนต้องรวม 10", async () => {
    const r = await createSet({ actor: pd, title: "x", kindId: schema.SEEDED_KIND_IDS.general });
    const setId = (r as { setId: number }).setId;
    expect((await updateSettings({ actor: pd, setId, settings: { approver: { personId: 10, name: "ตัวเอง" } } })).ok).toBe(false);
    expect(await updateSettings({ actor: pd, setId, settings: { blueprint: [{ topic: "general", level: "recall", count: 3 }] } })).toEqual({
      ok: false,
      error: "รวมต้องได้ 10 ข้อ (ตอนนี้ 3)",
    });
  });

  it("ผู้อนุมัติเห็นชุดในรายการ · คนอื่นไม่เห็นและเปิดรายละเอียดไม่ได้", async () => {
    const r = await createSet({ actor: pd, title: "x", kindId: schema.SEEDED_KIND_IDS.general });
    const setId = (r as { setId: number }).setId;
    expect((await listManagedSets(pdMgr)).map((s) => s.id)).toEqual([setId]);
    expect(await listManagedSets(sales)).toEqual([]);
    expect(await getSetDetail(sales, setId)).toBeNull();
  });
});

describe("อัปโหลดเอกสาร", () => {
  it("อัปแล้วยืนยัน → มีแถวเอกสาร · ยืนยันซ้ำไม่ได้แถวที่สอง", async () => {
    const r = await createSet({ actor: pd, title: "x", kindId: schema.SEEDED_KIND_IDS.product });
    const setId = (r as { setId: number }).setId;
    const req = await requestUpload({ actor: pd, setId, docKind: "catalog", fileName: "a.pdf", mime: "application/pdf", size: PDF.byteLength });
    if (!req.ok) throw new Error(req.error);
    const key = decodeURIComponent(new URL(req.uploadUrl, "http://x").pathname.replace("/api/dev-store/", ""));
    expect(key).toMatch(new RegExp(`^sets/${setId}/v1/[0-9a-f]{24}\\.pdf$`));
    devStoreObjects().set(key, PDF);
    const a = await confirmUpload({ actor: pd, token: req.token });
    const b = await confirmUpload({ actor: pd, token: req.token });
    expect(a).toEqual(b);
    expect((await getSetDetail(pd, setId))?.documents.map((d) => d.pageCount)).toEqual([3]);
  });

  it("ขนาดไฟล์ที่มาถึงไม่ตรงกับที่ขอ → ปฏิเสธและลบไฟล์ทิ้ง", async () => {
    const r = await createSet({ actor: pd, title: "x", kindId: schema.SEEDED_KIND_IDS.product });
    const out = await uploadPdf(pd, (r as { setId: number }).setId, new Uint8Array(5));
    expect(out).toEqual({ ok: false, error: "ขนาดไฟล์ไม่ตรงกับที่แจ้งไว้" });
    expect(devStoreObjects().size).toBe(0);
  });

  it("ไฟล์ที่บอกว่าเป็น PDF แต่อ่านไม่ได้ → ปฏิเสธและลบทิ้ง", async () => {
    const r = await createSet({ actor: pd, title: "x", kindId: schema.SEEDED_KIND_IDS.product });
    const junk = new Uint8Array(PDF.byteLength).fill(65);
    expect(await uploadPdf(pd, (r as { setId: number }).setId, junk)).toEqual({ ok: false, error: "อ่านไฟล์ PDF ไม่ได้ — ไฟล์อาจเสียหรือมีรหัสผ่าน" });
    expect(devStoreObjects().size).toBe(0);
  });

  it("ไม่รับชนิดไฟล์อื่น · token ของคนอื่นใช้ไม่ได้", async () => {
    const r = await createSet({ actor: pd, title: "x", kindId: schema.SEEDED_KIND_IDS.product });
    const setId = (r as { setId: number }).setId;
    expect((await requestUpload({ actor: pd, setId, docKind: "other", fileName: "a.exe", mime: "application/x-msdownload", size: 10 })).ok).toBe(false);
    const req = await requestUpload({ actor: pd, setId, docKind: "catalog", fileName: "a.pdf", mime: "application/pdf", size: PDF.byteLength });
    if (!req.ok) throw new Error(req.error);
    expect(await confirmUpload({ actor: sales, token: req.token })).toEqual({ ok: false, error: "ใบอัปโหลดไม่ถูกต้อง" });
  });
});

describe("อัปโหลดวิดีโอ (ADR-0013)", () => {
  async function uploadVideo(setId: number, bytes: Uint8Array, docKind: "catalog" | "other" | "pricelist" = "other") {
    const req = await requestUpload({ actor: pd, setId, docKind, fileName: "แนะนำสินค้า.mp4", mime: "video/mp4", size: bytes.byteLength });
    if (!req.ok) return req;
    const key = decodeURIComponent(new URL(req.uploadUrl, "http://x").pathname.replace("/api/dev-store/", ""));
    devStoreObjects().set(key, bytes);
    return confirmUpload({ actor: pd, token: req.token });
  }
  const newSet = async () => ((await createSet({ actor: pd, title: "x", kindId: schema.SEEDED_KIND_IDS.product })) as { setId: number }).setId;

  it("MP4 → ความยาวจากหัวไฟล์ · จำนวนช่วงละ 10 วินาที · key นามสกุล .mp4", async () => {
    const setId = await newSet();
    const out = await uploadVideo(setId, fakeMp4({ seconds: 125.4, moovAtEnd: true }));
    expect(out.ok).toBe(true);
    const [doc] = (await getSetDetail(pd, setId))!.documents;
    expect(doc).toMatchObject({ mimeType: "video/mp4", durationSeconds: 125, pageCount: 13 });
    expect(doc.objectKey).toMatch(/\.mp4$/);
  });

  it("วิดีโอรับได้ถึง 2 GB แต่ PDF ยังจำกัด 30 MB", async () => {
    const setId = await newSet();
    const ask = (mime: string, size: number) => requestUpload({ actor: pd, setId, docKind: "other", fileName: "f", mime, size });
    expect((await ask("video/mp4", 2_000_000_000)).ok).toBe(true);
    expect(await ask("video/mp4", 2_000_000_001)).toEqual({ ok: false, error: "วิดีโอต้องไม่เกิน 2 GB" });
    expect(await ask("application/pdf", 31 * 1024 * 1024)).toEqual({ ok: false, error: "ไฟล์ต้องไม่เกิน 30 MB" });
    expect((await ask("video/quicktime", 1000)).ok).toBe(false);
  });

  it("Pricelist ไม่รับวิดีโอ", async () => {
    const setId = await newSet();
    expect(await uploadVideo(setId, fakeMp4({ seconds: 10 }), "pricelist")).toEqual({
      ok: false,
      error: "Pricelist ต้องเป็น PDF หรือ Excel — วิดีโอแนบเป็นเอกสารหลักหรืออื่น ๆ",
    });
  });

  it("ไฟล์ที่บอกว่าเป็น MP4 แต่อ่านความยาวไม่ได้ → ปฏิเสธและลบทิ้ง", async () => {
    const setId = await newSet();
    const out = await uploadVideo(setId, new Uint8Array(500).fill(7));
    expect(out).toMatchObject({ ok: false });
    expect((out as { error: string }).error).toContain("อ่านไฟล์วิดีโอไม่ได้");
    expect(devStoreObjects().size).toBe(0);
  });

  it("ชุดที่มีแต่วิดีโอ → AI ออกข้อสอบไม่ได้ ต้องมี PDF", async () => {
    const setId = await newSet();
    await uploadVideo(setId, fakeMp4({ seconds: 30 }));
    const out = await generateExams({ actor: pd, setId, model: fakeModel() });
    expect(out).toEqual({ ok: false, error: "ต้องมีเอกสาร PDF อย่างน้อย 1 ไฟล์ก่อนออกข้อสอบ" });
  });

  describe("ปกวิดีโอ", () => {
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(1)]);
    const admin: Actor = { personId: 99, email: "tg@ws.co", name: "TG", role: "admin" };
    async function videoDoc() {
      const setId = await newSet();
      await uploadVideo(setId, fakeMp4({ seconds: 60 }));
      const [doc] = (await getSetDetail(pd, setId))!.documents;
      return { setId, doc };
    }
    const coverKeys = () => [...devStoreObjects().keys()].filter((k) => k.includes("-cover-"));

    it("ผู้สร้างตั้งปกจากเฟรมได้ · เปลี่ยนปก = ปกเก่าถูกลบ · ที่อยู่ภาพเปลี่ยนตาม", async () => {
      const { setId, doc } = await videoDoc();
      expect(coverPath(doc)).toBeNull();
      expect(await setVideoCover({ actor: pd, documentId: doc.id, bytes: JPEG, ms: 12_500 })).toEqual({ ok: true });
      const first = (await getSetDetail(pd, setId))!.documents[0];
      expect(first).toMatchObject({ coverMs: 12_500 });
      expect(first.coverKey).toMatch(new RegExp(`^${doc.objectKey.replace(/\.mp4$/, "")}-cover-[0-9a-f]{24}\\.jpg$`));
      expect(coverKeys()).toEqual([first.coverKey]);

      expect((await setVideoCover({ actor: admin, documentId: doc.id, bytes: JPEG, ms: 30_000 })).ok).toBe(true);
      const second = (await getSetDetail(pd, setId))!.documents[0];
      expect(coverKeys()).toEqual([second.coverKey]);
      expect(coverPath(second)).not.toEqual(coverPath(first));
    });

    it("คนอื่นตั้งปกไม่ได้ · ต้องเป็น JPEG จริง · ไม่ใหญ่เกิน · เฟรมต้องอยู่ในคลิป · ตั้งปกให้ PDF ไม่ได้", async () => {
      const { doc } = await videoDoc();
      expect((await setVideoCover({ actor: sales, documentId: doc.id, bytes: JPEG, ms: 0 })).ok).toBe(false);
      expect((await setVideoCover({ actor: pd, documentId: doc.id, bytes: new TextEncoder().encode("<svg/>"), ms: 0 })).ok).toBe(false);
      expect((await setVideoCover({ actor: pd, documentId: doc.id, bytes: new Uint8Array(600 * 1024).fill(0xff), ms: 0 })).ok).toBe(false);
      expect(await setVideoCover({ actor: pd, documentId: doc.id, bytes: JPEG, ms: 5 * 60_000 })).toEqual({ ok: false, error: "ตำแหน่งเฟรมอยู่นอกความยาวคลิป" });
      const pdfSet = await newSet();
      await uploadPdf(pd, pdfSet);
      const [pdf] = (await getSetDetail(pd, pdfSet))!.documents;
      expect(await setVideoCover({ actor: pd, documentId: pdf.id, bytes: JPEG, ms: 0 })).toEqual({ ok: false, error: "ตั้งปกได้เฉพาะวิดีโอ" });
      expect(coverKeys()).toEqual([]);
    });

    it("ภาพปก: คนทำงานกับชุดและผู้เรียนที่ได้รับมอบเห็น · คนอื่นไม่เห็น · ลบวิดีโอ = ลบปก", async () => {
      const { setId, doc } = await videoDoc();
      await setVideoCover({ actor: pd, documentId: doc.id, bytes: JPEG, ms: 1000 });
      expect(await coverImage({ actor: pd, documentId: doc.id })).toEqual(JPEG);
      expect(await coverImage({ actor: sales, documentId: doc.id })).toBeNull();
      await testDb()
        .insert(schema.assignments)
        .values({ setId, personId: sales.personId, personName: sales.name, source: "audience", assignedAt: new Date(), dueAt: new Date(Date.now() + 86400_000) });
      expect(await coverImage({ actor: sales, documentId: doc.id })).toEqual(JPEG);

      expect((await authorVideoLink({ actor: pd, documentId: doc.id })).ok).toBe(true);
      expect((await authorVideoLink({ actor: sales, documentId: doc.id })).ok).toBe(false);

      expect((await removeDocument({ actor: pd, documentId: doc.id })).ok).toBe(true);
      expect(coverKeys()).toEqual([]);
    });
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
    const r = await createSet({ actor: pd, title: "x", kindId: schema.SEEDED_KIND_IDS.product });
    const model = fakeModel();
    expect(await generateExams({ actor: pd, setId: (r as { setId: number }).setId, model })).toEqual({
      ok: false,
      error: "ต้องมีเอกสาร PDF อย่างน้อย 1 ไฟล์ก่อนออกข้อสอบ",
    });
    expect(model.calls).toBe(0);
  });

  it("ไม่ได้ตั้ง API key → บอกตรง ๆ", async () => {
    const r = await createSet({ actor: pd, title: "x", kindId: schema.SEEDED_KIND_IDS.product });
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
    const [gen, ev] = await events(setId);
    expect(gen).toMatchObject({ action: "exams_generated", detail: { kind: "full" } });
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
    expect(await submitForApproval({ actor: pd, setId })).toMatchObject({ ok: true });
    const q = (await getSetDetail(pdMgr, setId))!.forms[1].questions[0];
    const edit = { text: "แก้โดยผู้อนุมัติ", sourceRef: "หน้า 6", choices: ["1", "2", "3", "4"], correctIndex: 2 };
    expect((await editQuestion({ actor: pd, questionId: q.id, edit })).ok).toBe(false);
    expect((await editQuestion({ actor: pdMgr, questionId: q.id, edit })).ok).toBe(true);
    expect((await approve({ actor: sales, setId })).ok).toBe(false);
    expect(await approve({ actor: pdMgr, setId })).toMatchObject({ ok: true });
    const d = await getSetDetail(pdMgr, setId);
    expect(d?.set.status).toBe("active");
    expect(d?.version?.approvedAt).not.toBeNull();
    expect((await events(setId)).map((e) => e.action)).toEqual(["exams_generated", "submitted", "question_edited", "approved"]);
  });

  it("ตีกลับต้องมีความเห็น → กลับเป็นร่าง ผู้สร้างแก้ต่อได้", async () => {
    const setId = await readySet();
    await submitForApproval({ actor: pd, setId });
    expect((await returnToAuthor({ actor: pdMgr, setId, comment: "  " })).ok).toBe(false);
    expect(await returnToAuthor({ actor: pdMgr, setId, comment: "ราคา STELVIO ใน Pricelist ผิด" })).toMatchObject({ ok: true });
    expect((await getSetDetail(pd, setId))?.set.status).toBe("draft");
    const last = (await events(setId)).at(-1);
    expect(last).toMatchObject({ action: "returned", comment: "ราคา STELVIO ใน Pricelist ผิด" });
  });

  it("ส่งไม่ได้ถ้ายังไม่มีข้อสอบครบ หรือยังไม่มีผู้อนุมัติ", async () => {
    const r = await createSet({ actor: pd, title: "x", kindId: schema.SEEDED_KIND_IDS.product });
    const setId = (r as { setId: number }).setId;
    expect((await submitForApproval({ actor: pd, setId })).ok).toBe(false);
    await updateSettings({ actor: pd, setId, settings: { approver: null } });
    await uploadPdf(pd, setId);
    await generateExams({ actor: pd, setId, model: fakeModel() });
    expect(await submitForApproval({ actor: pd, setId })).toEqual({ ok: false, error: "ยังไม่ได้เลือกผู้อนุมัติ" });
  });

  it("TG ที่เป็นผู้อนุมัติกดส่งชุดของคนอื่นเองไม่ได้ (ต้องมีคนที่สองดูเสมอ)", async () => {
    const setId = await readySet();
    const tgApprover: Actor = { ...pdMgr, role: "admin" };
    expect(await submitForApproval({ actor: tgApprover, setId })).toEqual({ ok: false, error: "ผู้ส่งต้องไม่ใช่ผู้อนุมัติ — ให้ผู้สร้างกดส่ง หรือเปลี่ยนผู้อนุมัติ" });
    expect((await getSetDetail(pd, setId))?.set.status).toBe("draft");
    expect((await submitForApproval({ actor: pd, setId })).ok).toBe(true);
  });
});

describe("จัดเอกสาร · เฉลี่ยข้อสอบ · ตรวจแล้ว (หน้ารวมแบบแถบขั้นตอน)", () => {
  async function twoPdfSet() {
    const created = await createSet({ actor: pd, title: "Onboarding", kindId: schema.SEEDED_KIND_IDS.general });
    if (!created.ok) throw new Error(created.error);
    await uploadPdf(pd, created.setId);
    await uploadPdf(pd, created.setId);
    const docs = (await getSetDetail(pd, created.setId))!.documents;
    await updateDocument({ actor: pd, documentId: docs[0].id, fileName: "สวัสดิการ.pdf" });
    await updateDocument({ actor: pd, documentId: docs[1].id, fileName: "ระเบียบ.pdf" });
    return created.setId;
  }

  it("แก้ชื่อที่ผู้เรียนเห็น · ใช้ทำอะไร · น้ำหนัก · เลื่อนลำดับ — เฉพาะชุดร่างของตัวเอง", async () => {
    const setId = await twoPdfSet();
    const [a, b] = (await getSetDetail(pd, setId))!.documents;
    expect(await updateDocument({ actor: pd, documentId: a.id, kind: "other", examWeight: 3 })).toEqual({ ok: true });
    // ชนิด "ทั่วไป" ไม่เปิด Pricelist · น้ำหนักเกิน 5 · ชื่อว่าง · คนอื่นแก้ไม่ได้
    expect((await updateDocument({ actor: pd, documentId: a.id, kind: "pricelist" })).ok).toBe(false);
    expect((await updateDocument({ actor: pd, documentId: a.id, examWeight: 6 })).ok).toBe(false);
    expect((await updateDocument({ actor: pd, documentId: a.id, fileName: "  " })).ok).toBe(false);
    expect((await updateDocument({ actor: sales, documentId: a.id, fileName: "x" })).ok).toBe(false);

    expect(await moveDocument({ actor: pd, documentId: b.id, direction: -1 })).toEqual({ ok: true });
    const after = (await getSetDetail(pd, setId))!.documents;
    expect(after.map((d) => [d.fileName, d.kind, d.examWeight])).toEqual([
      ["ระเบียบ.pdf", "catalog", 1],
      ["สวัสดิการ.pdf", "other", 3],
    ]);
  });

  it("AI ได้แผนเฉลี่ยตามไฟล์ (ค่าตั้งต้น) · ตามหัวข้อ = ไม่ส่งแผน · กำหนดเอง = ตามน้ำหนัก", async () => {
    const setId = await twoPdfSet();
    const plans: (number[][] | undefined)[] = [];
    const model = fakeModel();
    const spy: ExamModel = { ...model, generateForms: (input) => (plans.push(input.plan), model.generateForms(input)) };

    expect((await generateExams({ actor: pd, setId, model: spy })).ok).toBe(true);
    expect(plans[0]).toEqual([
      [5, 5],
      [5, 5],
      [5, 5],
      [5, 5],
      [5, 5],
    ]);

    expect(await setSpreadMode({ actor: pd, setId, mode: "topic" })).toEqual({ ok: true });
    await generateExams({ actor: pd, setId, model: spy });
    expect(plans[1]).toBeUndefined();

    const [first] = (await getSetDetail(pd, setId))!.documents;
    await updateDocument({ actor: pd, documentId: first.id, examWeight: 0 });
    await setSpreadMode({ actor: pd, setId, mode: "custom" });
    await generateExams({ actor: pd, setId, model: spy });
    expect(plans[2]?.every((row) => row[0] === 0 && row[1] === 10)).toBe(true);

    expect((await setSpreadMode({ actor: pd, setId, mode: "random" })).ok).toBe(false);
    expect((await setSpreadMode({ actor: sales, setId, mode: "file" })).ok).toBe(false);
  });

  it("ตรวจแล้ว: กดเอง · แก้ข้อ = ตรวจแล้ว · ให้ AI ออกใหม่ = ล้าง · คนนอกชุดกดไม่ได้", async () => {
    const setId = await readySet();
    const detail = (await getSetDetail(pd, setId))!;
    const [q1, q2] = detail.forms[0].questions;
    const versionId = detail.version!.id;

    expect(await setQuestionReviewed({ actor: pd, questionId: q1.id, reviewed: true })).toEqual({ ok: true });
    expect([...(await reviewedQuestionIds(versionId, pd.personId))]).toEqual([q1.id]);
    expect((await setQuestionReviewed({ actor: sales, questionId: q1.id, reviewed: true })).ok).toBe(false);

    const edit = { text: "คำถามที่แก้แล้ว", sourceRef: "a.pdf หน้า 1", choices: ["ก", "ข", "ค", "ง"], correctIndex: 2 };
    expect((await editQuestion({ actor: pd, questionId: q2.id, edit })).ok).toBe(true);
    expect([...(await reviewedQuestionIds(versionId, pd.personId))].sort()).toEqual([q1.id, q2.id].sort());

    expect((await regenerateQuestion({ actor: pd, questionId: q1.id, model: fakeModel() })).ok).toBe(true);
    expect([...(await reviewedQuestionIds(versionId, pd.personId))]).toEqual([q2.id]);

    await setQuestionReviewed({ actor: pd, questionId: q2.id, reviewed: false });
    expect((await reviewedQuestionIds(versionId, pd.personId)).size).toBe(0);
  });
});
