import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import { slots, type Blueprint } from "@/domain/blueprint";
import type { Actor } from "@/lib/auth";
import type { ExamModel, GeneratedQuestion } from "@/lib/exam-generator";
import { devStoreObjects } from "@/lib/object-store";
import { clearOrgCache } from "@/lib/workid";

/**
 * เวอร์ชันใหม่ของเอกสาร (spec §7 · ADR-0008) — เริ่ม → อัป → ออกข้อสอบ → สรุป → ส่ง → เล็ก/ใหญ่ → อนุมัติ →
 * ผู้เรียนที่ผ่านแล้วรับทราบ / สอบส่วนที่เปลี่ยน · PGlite + migration จริง · AI ปลอมที่ขอบ `ExamModel`
 */

vi.mock("@/db", async () => {
  const s = await import("@/db/schema");
  const { testDb: get } = await import("@/db/__tests__/pgdb");
  return { db: () => get(), schema: s };
});

const { createSet, requestUpload, confirmUpload, removeDocument } = await import("@/lib/set-service");
const { generateExams, editQuestion } = await import("@/lib/exam-service");
const { submitForApproval, approve } = await import("@/lib/approval-service");
const V = await import("@/lib/version-service");
const L = await import("@/lib/learn-service");

const pd: Actor = { personId: 10, email: "pd@ws.co", name: "พีดี", role: "author" };
const mgr: Actor = { personId: 20, email: "mgr@ws.co", name: "ผจก.", role: "user" };
const other: Actor = { personId: 40, email: "o@ws.co", name: "คนอื่น", role: "author" };
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
  return doc.save();
})();

let n = 0;
function q(topic: GeneratedQuestion["topic"], level: GeneratedQuestion["level"]): GeneratedQuestion {
  n += 1;
  return { topic, level, text: `ข้อ ${n}`, choices: [`ก${n}`, `ข${n}`, `ค${n}`, `ง${n}`], correctIndex: 0, sourceRef: "หน้า 1" };
}

const model: ExamModel & { focus: (string | undefined)[] } = {
  focus: [],
  async generateForms(input: { blueprint: Blueprint; formCount: number; focus?: string }) {
    model.focus.push(input.focus);
    return { ok: true as const, value: Array.from({ length: input.formCount }, () => slots(input.blueprint).map((s) => q(s.topic, s.level))) };
  },
  async regenerateQuestion(input: { topic: GeneratedQuestion["topic"]; level: GeneratedQuestion["level"] }) {
    return { ok: true as const, value: q(input.topic, input.level) };
  },
  async summarizeChanges() {
    return { ok: true as const, value: "- ราคา F331 12,900 → 13,500" };
  },
};

async function upload(actor: Actor, setId: number) {
  const req = await requestUpload({ actor, setId, docKind: "catalog", fileName: "cat.pdf", mime: "application/pdf", size: PDF.byteLength });
  if (!req.ok) return req;
  const key = decodeURIComponent(new URL(req.uploadUrl, "http://x").pathname.replace("/api/dev-store/", ""));
  devStoreObjects().set(key, PDF);
  return confirmUpload({ actor, token: req.token });
}

const T_PASS = new Date("2026-11-03T09:00:00+07:00");
const T_V2 = new Date("2026-11-05T09:00:00+07:00");

/** ชุดที่ใช้อยู่ v1 · ME ผ่านแล้ว */
async function activeSetWithPassedLearner() {
  const c = await createSet({ actor: pd, title: "F331", kind: "general" });
  if (!c.ok) throw new Error(c.error);
  await upload(pd, c.setId);
  await generateExams({ actor: pd, setId: c.setId, model });
  await submitForApproval({ actor: pd, setId: c.setId });
  const ap = await approve({ actor: mgr, setId: c.setId, now: new Date("2026-11-01T09:00:00+07:00") });
  if (!ap.ok) throw new Error(ap.error);
  const [a] = await testDb()
    .insert(schema.assignments)
    .values({ setId: c.setId, personId: ME, personName: "เซล", source: "audience", assignedAt: new Date("2026-11-02T09:00:00+07:00"), dueAt: new Date("2026-11-09T09:00:00+07:00"), passedAt: T_PASS })
    .returning();
  return { setId: c.setId, assignmentId: a.id };
}

/** เวอร์ชันใหม่พร้อมส่ง */
async function draftV2(setId: number) {
  const s = await V.startVersion({ actor: pd, setId, label: "V.2" });
  if (!s.ok) throw new Error(s.error);
  await upload(pd, setId);
  const g = await generateExams({ actor: pd, setId, model });
  if (!g.ok) throw new Error(g.error);
  const sum = await V.summarizeVersion({ actor: pd, setId, model });
  if (!sum.ok) throw new Error(sum.error);
}

async function examScan(at: Date) {
  const [row] = await testDb()
    .insert(schema.faceScans)
    .values({ personId: ME, purpose: "exam", result: "pass", deleteAfter: new Date(at.getTime() + 90 * 86400_000), createdAt: at })
    .returning({ id: schema.faceScans.id });
  return row.id;
}

beforeAll(setupTestDb);
beforeEach(async () => {
  await truncateAll();
  devStoreObjects().clear();
  clearOrgCache();
  model.focus = [];
  vi.stubEnv("SESSION_SECRET", "test-secret-test-secret-test-secret-0000");
  vi.stubEnv("WORKTRAIN_DEV_ORG", JSON.stringify(ORG));
});
afterEach(() => vi.unstubAllEnvs());

describe("เริ่มและส่งเวอร์ชันใหม่", () => {
  it("ผู้สร้างเริ่มได้ครั้งเดียว · คนอื่นเริ่มไม่ได้ · ชุดร่างเริ่มไม่ได้", async () => {
    const { setId } = await activeSetWithPassedLearner();
    expect((await V.startVersion({ actor: other, setId })).ok).toBe(false);
    expect((await V.startVersion({ actor: pd, setId, label: "V.2" })).ok).toBe(true);
    expect(await V.startVersion({ actor: pd, setId })).toEqual({ ok: false, error: "มีเวอร์ชันใหม่ที่ยังไม่อนุมัติอยู่แล้ว" });
    const draft = await createSet({ actor: pd, title: "ร่าง", kind: "general" });
    expect((await V.startVersion({ actor: pd, setId: (draft as { setId: number }).setId })).ok).toBe(false);
  });

  it("ผู้เรียนยังใช้เอกสารเวอร์ชันเดิมระหว่างทำเวอร์ชันใหม่ · ส่งแล้วแก้เอกสารไม่ได้", async () => {
    const { setId, assignmentId } = await activeSetWithPassedLearner();
    const v1Docs = (await L.learnView(ME, assignmentId))!.documents.map((d) => d.id);
    await draftV2(setId);
    expect((await L.learnView(ME, assignmentId))!.documents.map((d) => d.id)).toEqual(v1Docs);
    expect(await V.submitVersion({ actor: pd, setId })).toMatchObject({ ok: true });
    expect((await upload(pd, setId)).ok).toBe(false);
    const [doc] = await testDb().select().from(schema.documents).where(eq(schema.documents.id, v1Docs[0]));
    expect((await removeDocument({ actor: pd, documentId: doc.id })).ok).toBe(false);
  });

  it("ส่งไม่ได้ถ้ายังไม่มีสรุปสิ่งที่เปลี่ยน", async () => {
    const { setId } = await activeSetWithPassedLearner();
    await V.startVersion({ actor: pd, setId });
    await upload(pd, setId);
    await generateExams({ actor: pd, setId, model });
    expect(await V.submitVersion({ actor: pd, setId })).toEqual({ ok: false, error: "ให้ AI สรุปสิ่งที่เปลี่ยนก่อนส่ง" });
    expect(await V.editSummary({ actor: pd, setId, summary: "  - แก้คำผิดหน้า 3 " })).toEqual({ ok: true });
    expect((await V.submitVersion({ actor: pd, setId })).ok).toBe(true);
  });
});

describe("เปลี่ยนเล็ก", () => {
  it("ต้องเลือกเล็ก/ใหญ่ก่อนอนุมัติ · ผ่านแล้วกดรับทราบ · ข้อสอบของเวอร์ชันที่อนุมัติแล้วแก้ไม่ได้", async () => {
    const { setId, assignmentId } = await activeSetWithPassedLearner();
    await draftV2(setId);
    await V.submitVersion({ actor: pd, setId });
    expect(await V.approveVersion({ actor: mgr, setId })).toEqual({ ok: false, error: "เลือกก่อนว่าเปลี่ยนเล็กหรือเปลี่ยนใหญ่" });
    expect((await V.setChangeKind({ actor: pd, setId, kind: "small" })).ok).toBe(false);
    await V.setChangeKind({ actor: mgr, setId, kind: "small" });
    const ap = await V.approveVersion({ actor: mgr, setId, now: T_V2 });
    expect(ap.ok).toBe(true);

    const view = (await L.learnView(ME, assignmentId))!;
    expect(view.state).toBe("update_ack");
    expect(view.update).toMatchObject({ kind: "small", label: "V.2", summary: "- ราคา F331 12,900 → 13,500" });
    expect((await L.startAttempt({ personId: ME, assignmentId, scanId: await examScan(new Date()) })).ok).toBe(false);
    expect(await L.acknowledgeVersion({ personId: ME, assignmentId, versionId: view.update!.versionId })).toEqual({ ok: true });
    expect((await L.learnView(ME, assignmentId))!.state).toBe("passed");

    const [anyQ] = await testDb().select().from(schema.questions).limit(1);
    expect((await editQuestion({ actor: mgr, questionId: anyQ.id, edit: { text: "x", sourceRef: "y", choices: ["1", "2", "3", "4"], correctIndex: 0 } })).ok).toBe(false);
  });

  it("ผ่านหลังเวอร์ชันใหม่อนุมัติ = ไม่มีอะไรค้าง", async () => {
    const { setId } = await activeSetWithPassedLearner();
    await draftV2(setId);
    await V.submitVersion({ actor: pd, setId });
    await V.setChangeKind({ actor: mgr, setId, kind: "small" });
    await V.approveVersion({ actor: mgr, setId, now: new Date("2026-11-02T09:00:00+07:00") });
    const [late] = await testDb()
      .insert(schema.assignments)
      .values({ setId, personId: 32, personName: "ใหม่", source: "audience", assignedAt: new Date("2026-11-02T09:00:00+07:00"), dueAt: new Date("2026-11-09T09:00:00+07:00"), passedAt: new Date("2026-11-04T09:00:00+07:00") })
      .returning();
    expect(await L.pendingUpdate(late)).toBeNull();
  });
});

describe("เปลี่ยนใหญ่", () => {
  it("ต้องออกข้อสอบส่วนที่เปลี่ยนก่อนอนุมัติ · ผู้เรียนที่ผ่านแล้วสอบ 5 ข้อ · ผ่าน = ไม่ค้าง", async () => {
    const { setId, assignmentId } = await activeSetWithPassedLearner();
    await draftV2(setId);
    await V.submitVersion({ actor: pd, setId });
    await V.setChangeKind({ actor: mgr, setId, kind: "large" });
    expect(await V.approveVersion({ actor: mgr, setId })).toEqual({ ok: false, error: "ต้องมีข้อสอบส่วนที่เปลี่ยน 5 ชุด (มี 0)" });
    expect((await V.generateDeltaExams({ actor: mgr, setId, model })).ok).toBe(true);
    expect(model.focus.at(-1)).toBe("- ราคา F331 12,900 → 13,500");
    expect((await V.approveVersion({ actor: mgr, setId, now: T_V2 })).ok).toBe(true);

    expect((await L.learnView(ME, assignmentId))!.state).toBe("update_exam");
    const at = new Date();
    const started = await L.startAttempt({ personId: ME, assignmentId, scanId: await examScan(at), now: at });
    expect(started.ok).toBe(true);
    const attemptId = (started as { attemptId: number }).attemptId;
    const [t] = await testDb().select().from(schema.attempts).where(eq(schema.attempts.id, attemptId));
    expect(t.kind).toBe("delta");
    for (let i = 0; i < 5; i++) {
      const v = (await L.attemptView(ME, attemptId, at))!;
      if (v.ended) break;
      const cs = await testDb().select().from(schema.choices).where(eq(schema.choices.questionId, v.question!.id));
      await L.answer({ personId: ME, attemptId, questionId: v.question!.id, choiceId: cs.find((c) => c.isCorrect)!.id, now: at });
    }
    const done = (await L.attemptView(ME, attemptId, at))!;
    expect(done.result).toMatchObject({ percent: 100, passed: true });
    expect((await L.learnView(ME, assignmentId))!.state).toBe("passed");
    const [a] = await testDb().select().from(schema.assignments).where(eq(schema.assignments.id, assignmentId));
    expect(a.passedAt).toEqual(T_PASS);
  });

  it("เปลี่ยนเป็นเล็กแล้วข้อสอบส่วนที่เปลี่ยนถูกลบ · ตีกลับแล้วผู้สร้างแก้ได้อีก", async () => {
    const { setId } = await activeSetWithPassedLearner();
    await draftV2(setId);
    await V.submitVersion({ actor: pd, setId });
    await V.setChangeKind({ actor: mgr, setId, kind: "large" });
    await V.generateDeltaExams({ actor: mgr, setId, model });
    await V.setChangeKind({ actor: mgr, setId, kind: "small" });
    expect(await testDb().select().from(schema.examForms).where(eq(schema.examForms.kind, "delta"))).toEqual([]);
    expect((await V.returnVersion({ actor: mgr, setId, comment: "ราคาผิด" })).ok).toBe(true);
    expect((await upload(pd, setId)).ok).toBe(true);
  });
});
