import ExcelJS from "exceljs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import { fakeMp4 } from "@/domain/__tests__/mp4-fixture";
import type { Actor } from "@/lib/auth";
import { devStoreObjects } from "@/lib/object-store";
import { clearOrgCache } from "@/lib/workid";

/**
 * Template / Import ข้อสอบ (ADR-0015) — ชุดที่มีแต่วิดีโอทำข้อสอบได้โดยไม่มี AI ·
 * แทนทั้งหมดเมื่อผ่านทุกข้อ · ไม่ผ่านไม่แตะของเดิม · ลงประวัติ · สิทธิ์ตามคนที่ออกข้อสอบส่วนนั้น
 */

vi.mock("@/db", async () => {
  const s = await import("@/db/schema");
  const { testDb: get } = await import("@/db/__tests__/pgdb");
  return { db: () => get(), schema: s };
});

const { createSet, requestUpload, confirmUpload, getSetDetail } = await import("@/lib/set-service");
const { examTemplate, importExams, setQuestionReviewed, reviewedQuestionIds, generateExams } = await import("@/lib/exam-service");
const { submitForApproval, approve } = await import("@/lib/approval-service");
const V = await import("@/lib/version-service");

const pd: Actor = { personId: 10, email: "pd@ws.co", name: "พีดี", role: "author" };
const mgr: Actor = { personId: 20, email: "mgr@ws.co", name: "ผจก.", role: "user" };
const other: Actor = { personId: 40, email: "o@ws.co", name: "คนอื่น", role: "author" };

const ORG = [
  { personId: 10, email: "pd@ws.co", fullName: "พีดี", managerPersonId: 20 },
  { personId: 20, email: "mgr@ws.co", fullName: "ผจก." },
  { personId: 40, email: "o@ws.co", fullName: "คนอื่น" },
];

const VIDEO = "แนะนำสินค้า.mp4";

async function uploadVideo(setId: number) {
  const bytes = fakeMp4({ seconds: 60 });
  const req = await requestUpload({ actor: pd, setId, docKind: "other", fileName: VIDEO, mime: "video/mp4", size: bytes.byteLength });
  if (!req.ok) throw new Error(req.error);
  const key = decodeURIComponent(new URL(req.uploadUrl, "http://x").pathname.replace("/api/dev-store/", ""));
  devStoreObjects().set(key, bytes);
  const out = await confirmUpload({ actor: pd, token: req.token });
  if (!out.ok) throw new Error(out.error);
}

/** กรอก Template ทุกแถว — `tag` ทำให้คำถามแต่ละรอบไม่ซ้ำกัน · `edit` แก้แถวก่อนบันทึก */
async function fill(bytes: Uint8Array, tag: string, edit?: (ws: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("ข้อสอบ")!;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const n = `${tag}-${r}`;
    row.getCell(5).value = `คำถาม ${n}`;
    ["ก", "ข", "ค", "ง"].forEach((c, i) => (row.getCell(6 + i).value = `${c} ${n}`));
    row.getCell(10).value = 2;
    row.getCell(11).value = VIDEO;
    row.getCell(12).value = "นาที 0:30";
  }
  edit?.(ws);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

async function template(actor: Actor, setId: number, kind: schema.FormKind = "full") {
  const t = await examTemplate({ actor, setId, kind });
  if (!t.ok) throw new Error(t.error);
  return t.bytes;
}

async function videoOnlySet() {
  const c = await createSet({ actor: pd, title: "เก้าอี้ใหม่", kindId: schema.SEEDED_KIND_IDS.general });
  if (!c.ok) throw new Error(c.error);
  await uploadVideo(c.setId);
  return c.setId;
}

async function eventsOf(setId: number) {
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

describe("Import ข้อสอบชุดเต็ม", () => {
  it("ชุดที่มีแต่วิดีโอ: AI ออกไม่ได้ แต่ Import ได้ · ลงประวัติพร้อมชื่อไฟล์ · ส่งขออนุมัติได้", async () => {
    const setId = await videoOnlySet();
    expect((await generateExams({ actor: pd, setId, model: null })).ok).toBe(false);

    const out = await importExams({ actor: pd, setId, kind: "full", fileName: "ข้อสอบ.xlsx", bytes: await fill(await template(pd, setId), "a") });
    expect(out).toEqual({ ok: true, count: 50 });
    const detail = (await getSetDetail(pd, setId))!;
    expect(detail.forms.filter((f) => f.kind === "full")).toHaveLength(5);
    expect(detail.forms[0].questions[0]).toMatchObject({ sourceRef: `${VIDEO} นาที 0:30` });
    expect(detail.forms[0].questions[0].choices.map((c) => c.isCorrect)).toEqual([false, true, false, false]);
    expect((await eventsOf(setId)).map((e) => [e.action, e.detail])).toEqual([["exams_imported", { kind: "full", fileName: "ข้อสอบ.xlsx" }]]);
    expect((await submitForApproval({ actor: pd, setId })).ok).toBe(true);
  });

  it("ไม่ผ่าน → บอกทุกจุดพร้อมเลขแถว และข้อสอบเดิมยังอยู่ครบ", async () => {
    const setId = await videoOnlySet();
    await importExams({ actor: pd, setId, kind: "full", fileName: "a.xlsx", bytes: await fill(await template(pd, setId), "a") });
    const before = (await getSetDetail(pd, setId))!.forms.flatMap((f) => f.questions.map((q) => q.id));

    const bad = await fill(await template(pd, setId), "b", (ws) => {
      ws.getCell("E3").value = null;
      ws.getCell("K7").value = "ไฟล์ที่ไม่มี.pdf";
    });
    const out = await importExams({ actor: pd, setId, kind: "full", fileName: "b.xlsx", bytes: bad });
    expect(out).toEqual({
      ok: false,
      error: "ไฟล์ยังไม่ผ่าน 2 จุด — แก้แล้ว Import ใหม่ (ข้อสอบเดิมยังอยู่)",
      rows: [
        { row: 3, message: "ยังไม่ได้กรอกคำถาม" },
        { row: 7, message: 'ไม่มีไฟล์ "ไฟล์ที่ไม่มี.pdf" ในเอกสารของชุดนี้' },
      ],
    });
    expect((await getSetDetail(pd, setId))!.forms.flatMap((f) => f.questions.map((q) => q.id))).toEqual(before);
  });

  it("Template มีข้อสอบเดิมเติมมาด้วย · Import กลับ = แทนทั้งหมด และ \"ตรวจแล้ว\" หาย", async () => {
    const setId = await videoOnlySet();
    await importExams({ actor: pd, setId, kind: "full", fileName: "a.xlsx", bytes: await fill(await template(pd, setId), "a") });
    const first = (await getSetDetail(pd, setId))!.forms[0].questions[0];
    await setQuestionReviewed({ actor: pd, questionId: first.id, reviewed: true });

    const again = await template(pd, setId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(again as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("ข้อสอบ")!;
    const texts = Array.from({ length: 50 }, (_, i) => ws.getRow(i + 2).getCell(5).text);
    expect(texts).toContain(first.text);
    expect(ws.getRow(2).getCell(11).text).toBe(VIDEO);
    expect(ws.getRow(2).getCell(12).text).toBe("นาที 0:30");

    // ไฟล์ที่โหลดมาแก้ข้อเดียวแล้ว import กลับได้เลย
    ws.getCell("E2").value = "คำถามที่แก้ใน Excel";
    const out = await importExams({ actor: pd, setId, kind: "full", fileName: "a2.xlsx", bytes: new Uint8Array(await wb.xlsx.writeBuffer()) });
    expect(out.ok).toBe(true);
    const version = (await getSetDetail(pd, setId))!.version!;
    expect((await reviewedQuestionIds(version.id, pd.personId)).size).toBe(0);
    expect((await getSetDetail(pd, setId))!.forms.flatMap((f) => f.questions.map((q) => q.text))).toContain("คำถามที่แก้ใน Excel");
  });

  it("ไฟล์ข้อสอบส่วนที่เปลี่ยนใช้กับชุดเต็มไม่ได้ · ไม่ใช่ xlsx ก็ไม่ได้", async () => {
    const setId = await videoOnlySet();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await template(pd, setId)) as unknown as ArrayBuffer);
    wb.getWorksheet("_meta")!.getCell("B1").value = "delta";
    expect(await importExams({ actor: pd, setId, kind: "full", fileName: "x.xlsx", bytes: new Uint8Array(await wb.xlsx.writeBuffer()) })).toEqual({
      ok: false,
      error: "ไฟล์นี้เป็น Template ของข้อสอบส่วนที่เปลี่ยน ไม่ใช่ข้อสอบชุดเต็ม",
    });
    expect((await importExams({ actor: pd, setId, kind: "full", fileName: "x.csv", bytes: new TextEncoder().encode("a,b") })).ok).toBe(false);
  });

  it("สิทธิ์: คนอื่นไม่ได้ · ยังไม่มีเอกสารไม่ได้ · ส่งแล้วผู้อนุมัติ import ชุดเต็มไม่ได้", async () => {
    const empty = await createSet({ actor: pd, title: "ว่าง", kindId: schema.SEEDED_KIND_IDS.general });
    expect(await examTemplate({ actor: pd, setId: (empty as { setId: number }).setId, kind: "full" })).toEqual({ ok: false, error: "ชุดนี้ยังไม่มีเอกสาร" });

    const setId = await videoOnlySet();
    expect((await examTemplate({ actor: other, setId, kind: "full" })).ok).toBe(false);
    const bytes = await fill(await template(pd, setId), "a");
    await importExams({ actor: pd, setId, kind: "full", fileName: "a.xlsx", bytes });
    await submitForApproval({ actor: pd, setId });
    expect(await importExams({ actor: mgr, setId, kind: "full", fileName: "a.xlsx", bytes })).toEqual({
      ok: false,
      error: "Import ข้อสอบได้เฉพาะชุดร่างหรือเวอร์ชันใหม่ที่ยังไม่ส่งของตัวเอง",
    });
    expect((await importExams({ actor: pd, setId, kind: "full", fileName: "a.xlsx", bytes })).ok).toBe(false);
  });
});

describe("Import ข้อสอบส่วนที่เปลี่ยน (เรียนรู้และทดสอบ)", () => {
  it("ผู้อนุมัติ import 5 ชุด × 5 ข้อหลังเลือก \"เรียนรู้และทดสอบ\" แล้วอนุมัติได้ — ชุดที่มีแต่วิดีโอไม่ติดทางตัน", async () => {
    const setId = await videoOnlySet();
    await importExams({ actor: pd, setId, kind: "full", fileName: "v1.xlsx", bytes: await fill(await template(pd, setId), "v1") });
    await submitForApproval({ actor: pd, setId });
    expect((await approve({ actor: mgr, setId })).ok).toBe(true);

    expect((await V.startVersion({ actor: pd, setId, label: "V.2" })).ok).toBe(true);
    await uploadVideo(setId);
    expect((await importExams({ actor: pd, setId, kind: "full", fileName: "v2.xlsx", bytes: await fill(await template(pd, setId), "v2") })).ok).toBe(true);
    await V.editSummary({ actor: pd, setId, summary: "- เพิ่มรุ่นใหม่" });
    expect((await V.submitVersion({ actor: pd, setId })).ok).toBe(true);

    // ยังไม่เลือก "เรียนรู้และทดสอบ" · ผู้สร้างไม่ใช่คนออกข้อสอบส่วนนี้
    expect(await examTemplate({ actor: mgr, setId, kind: "delta" })).toEqual({ ok: false, error: 'เลือก "เรียนรู้และทดสอบ" ก่อน' });
    await V.setChangeKind({ actor: mgr, setId, kind: "large" });
    expect((await examTemplate({ actor: pd, setId, kind: "delta" })).ok).toBe(false);

    const delta = await template(mgr, setId, "delta");
    expect((await importExams({ actor: mgr, setId, kind: "full", fileName: "d.xlsx", bytes: await fill(delta, "d") })).ok).toBe(false);
    expect(await importExams({ actor: mgr, setId, kind: "delta", fileName: "d.xlsx", bytes: await fill(delta, "d") })).toEqual({ ok: true, count: 25 });
    expect((await V.approveVersion({ actor: mgr, setId })).ok).toBe(true);
    expect((await eventsOf(setId)).filter((e) => e.action === "exams_imported").map((e) => e.detail)).toEqual([
      { kind: "full", fileName: "v1.xlsx" },
      { kind: "full", fileName: "v2.xlsx" },
      { kind: "delta", fileName: "d.xlsx" },
    ]);
  });
});
