import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import { devStoreObjects } from "@/lib/object-store";
import { GENERAL_BLUEPRINT } from "@/domain/blueprint";

/**
 * TG เปลี่ยนชื่อชุด · ย้าย/คัดลอกคลิปไปชุดอื่น (ADR-0022) — PGlite + migration จริง · ที่เก็บไฟล์จำลองในหน่วยความจำ
 */

vi.mock("@/db", async () => {
  const s = await import("@/db/schema");
  const { testDb: get } = await import("@/db/__tests__/pgdb");
  return { db: () => get(), schema: s };
});

const S = await import("@/lib/set-service");
const C = await import("@/lib/clip-transfer");
const L = await import("@/lib/learn-service");

const TG = { personId: 1, email: "tg@x", name: "ทีจี", role: "admin" as const };
const AUTHOR = { personId: 10, email: "pd@x", name: "พีดี", role: "author" as const };
const T0 = new Date("2026-11-18T09:00:00+07:00");
const sec = (n: number) => new Date(T0.getTime() + n * 1000);
const VIDEO = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

let keySeq = 0;

/** ชุดหนึ่งชุด + เวอร์ชันแรก · `active` = อนุมัติแล้ว · `clips` = จำนวนคลิป (ใส่ไฟล์ลงที่เก็บจำลองด้วย) · PDF ตามมาอีกหนึ่งไฟล์ */
async function makeSet(title: string, status: schema.SetStatus, clips = 1) {
  const db = testDb();
  const approved = status === "active" || status === "closed";
  const [set] = await db
    .insert(schema.learningSets)
    .values({ title, kindId: schema.SEEDED_KIND_IDS.general, status, approvedAt: approved ? T0 : null, authorPersonId: AUTHOR.personId, authorName: AUTHOR.name, blueprint: GENERAL_BLUEPRINT })
    .returning();
  const [v] = await db
    .insert(schema.setVersions)
    .values({ setId: set.id, versionNo: 1, changeKind: "initial", createdByPersonId: AUTHOR.personId, approvedAt: approved ? T0 : null })
    .returning();
  const docs = [];
  for (let i = 0; i < clips; i++) {
    const key = `sets/${set.id}/v1/clip${String(++keySeq).padStart(16, "0")}.mp4`;
    const cover = key.replace(/\.mp4$/, `-cover-${"c".repeat(16)}.jpg`);
    devStoreObjects().set(key, VIDEO);
    devStoreObjects().set(cover, JPEG);
    const [d] = await db
      .insert(schema.documents)
      .values({
        versionId: v.id,
        kind: "catalog",
        objectKey: key,
        fileName: `EP${i + 1} ${title}`,
        mimeType: "video/mp4",
        sizeBytes: VIDEO.byteLength + i,
        pageCount: 7,
        durationSeconds: 65,
        coverKey: cover,
        coverMs: 4000,
        sortOrder: i,
      })
      .returning();
    docs.push(d);
  }
  const [pdf] = await db
    .insert(schema.documents)
    .values({ versionId: v.id, kind: "catalog", objectKey: `sets/${set.id}/v1/pdf${String(++keySeq).padStart(16, "0")}.pdf`, fileName: "คู่มือ", mimeType: "application/pdf", sizeBytes: 1, pageCount: 2, sortOrder: clips })
    .returning();
  return { set, v, clips: docs, pdf };
}

async function assign(setId: number, personId: number, passed = false) {
  const [a] = await testDb()
    .insert(schema.assignments)
    .values({ setId, personId, personName: `คน ${personId}`, source: "audience", assignedAt: T0, dueAt: sec(7 * 86400), passedAt: passed ? T0 : null })
    .returning();
  return a;
}

/** อ่าน/ดูครบทุกรายการที่ผู้เรียนเห็นตอนนี้ */
async function finishReading(a: { id: number }, docs: { id: number; pageCount: number | null }[]) {
  for (const d of docs) {
    await testDb()
      .insert(schema.readingProgress)
      .values({ assignmentId: a.id, documentId: d.id, pagesSeen: Array.from({ length: d.pageCount! }, (_, i) => i + 1), completedAt: T0 });
  }
}

const eventsOf = (setId: number) => testDb().select().from(schema.approvalEvents).where(eq(schema.approvalEvents.setId, setId)).orderBy(asc(schema.approvalEvents.id));
const docsOf = (versionId: number) => testDb().select().from(schema.documents).where(eq(schema.documents.versionId, versionId)).orderBy(asc(schema.documents.sortOrder));

beforeAll(setupTestDb);
beforeEach(async () => {
  await truncateAll();
  devStoreObjects().clear();
});

describe("เปลี่ยนชื่อชุด", () => {
  it("TG เปลี่ยนชื่อชุดที่ใช้อยู่ได้ · ลงประวัติ from/to · ผู้เรียนเห็นชื่อใหม่ทันที", async () => {
    const { set } = await makeSet("ชื่อเดิม", "active");
    await assign(set.id, 31);
    expect(await S.renameSet({ actor: TG, setId: set.id, title: "  ชื่อใหม่  ", now: sec(1) })).toEqual({ ok: true });

    const [row] = await testDb().select().from(schema.learningSets).where(eq(schema.learningSets.id, set.id));
    expect(row.title).toBe("ชื่อใหม่");
    expect(await eventsOf(set.id)).toEqual([expect.objectContaining({ action: "renamed", actorPersonId: TG.personId, detail: { from: "ชื่อเดิม", to: "ชื่อใหม่" } })]);
    expect((await L.myLearningList(31, sec(2)))[0].title).toBe("ชื่อใหม่");
  });

  it("ชื่อเดิม = ไม่ลงประวัติ · ว่าง/ยาวเกิน ไม่ได้ · ผู้สร้างที่ไม่ใช่ TG ไม่ได้ · ร่างที่ลบแล้วไม่ได้ · ชุดที่ปิดแล้วได้", async () => {
    const { set } = await makeSet("ชุด", "active");
    expect(await S.renameSet({ actor: TG, setId: set.id, title: "ชุด" })).toEqual({ ok: true });
    expect(await eventsOf(set.id)).toHaveLength(0);
    expect((await S.renameSet({ actor: TG, setId: set.id, title: "   " })).ok).toBe(false);
    expect((await S.renameSet({ actor: TG, setId: set.id, title: "ก".repeat(201) })).ok).toBe(false);
    expect(await S.renameSet({ actor: AUTHOR, setId: set.id, title: "ของผู้สร้าง" })).toEqual({ ok: false, error: "เปลี่ยนชื่อชุดได้เฉพาะ TG" });

    const { set: gone } = await makeSet("ร่างที่ลบ", "deleted");
    expect((await S.renameSet({ actor: TG, setId: gone.id, title: "ใหม่" })).ok).toBe(false);
    const { set: closed } = await makeSet("ปิดแล้ว", "closed");
    expect(await S.renameSet({ actor: TG, setId: closed.id, title: "ปิดแล้ว (เก่า)" })).toEqual({ ok: true });
  });

  it("แก้ชื่อในฟอร์มตั้งค่าของร่างก็ลงประวัติ · แก้อย่างอื่นไม่ลง", async () => {
    const { set } = await makeSet("ร่าง", "draft");
    expect(await S.updateSettings({ actor: AUTHOR, setId: set.id, settings: { title: "ร่าง", dueDays: 5 } })).toEqual({ ok: true });
    expect(await eventsOf(set.id)).toHaveLength(0);
    expect(await S.updateSettings({ actor: AUTHOR, setId: set.id, settings: { title: "ร่าง v2" } })).toEqual({ ok: true });
    expect(await eventsOf(set.id)).toEqual([expect.objectContaining({ action: "renamed", actorPersonId: AUTHOR.personId, detail: { from: "ร่าง", to: "ร่าง v2" } })]);
  });
});

describe("ย้าย/คัดลอกคลิปไปชุดอื่น", () => {
  it("คัดลอกจากร่างไปร่าง — ไฟล์และปกเป็นของชุดปลายทาง · ชื่อ ความยาว ช่วง ปก ไปด้วย · ต่อท้าย · ลงประวัติทั้งสองชุด", async () => {
    const A = await makeSet("ชุด A", "draft", 2);
    const B = await makeSet("ชุด B", "draft", 1);
    const out = await C.transferClip({ actor: TG, documentId: A.clips[1].id, targetSetId: B.set.id, mode: "copy", now: sec(1) });
    expect(out).toMatchObject({ ok: true, targetSetId: B.set.id, landing: "draft", source: "kept" });
    if (!out.ok) return;

    const copy = (await docsOf(B.v.id)).at(-1)!;
    expect(copy).toMatchObject({ id: out.documentId, fileName: "EP2 ชุด A", mimeType: "video/mp4", sizeBytes: A.clips[1].sizeBytes, pageCount: 7, durationSeconds: 65, coverMs: 4000, kind: "catalog", hidden: false, sortOrder: 2 });
    expect(copy.objectKey).toMatch(new RegExp(`^sets/${B.set.id}/v1/[a-z0-9]{24}\\.mp4$`));
    expect(copy.coverKey).toMatch(new RegExp(`^sets/${B.set.id}/v1/[a-z0-9]{24}-cover-[a-z0-9]{24}\\.jpg$`));
    expect(devStoreObjects().get(copy.objectKey)).toEqual(VIDEO);
    expect(devStoreObjects().get(copy.coverKey!)).toEqual(JPEG);
    // ชุดเดิมไม่เปลี่ยน
    expect(await docsOf(A.v.id)).toHaveLength(3);
    expect(devStoreObjects().has(A.clips[1].objectKey)).toBe(true);

    expect(await eventsOf(B.set.id)).toEqual([
      expect.objectContaining({ action: "clip_received", versionId: B.v.id, detail: { mode: "copy", documentId: copy.id, fileName: "EP2 ชุด A", otherSet: { id: A.set.id, title: "ชุด A" }, landing: "draft" } }),
    ]);
    expect(await eventsOf(A.set.id)).toEqual([
      expect.objectContaining({ action: "clip_sent", versionId: A.v.id, detail: { mode: "copy", documentId: A.clips[1].id, fileName: "EP2 ชุด A", otherSet: { id: B.set.id, title: "ชุด B" }, landing: "draft" } }),
    ]);

    // คัดลอกซ้ำเข้าชุดเดิม = ไม่ได้ (กดซ้ำ/คลิปซ้ำ)
    expect(await C.transferClip({ actor: TG, documentId: A.clips[1].id, targetSetId: B.set.id, mode: "copy" })).toEqual({ ok: false, error: 'ชุด "ชุด B" มีคลิป "EP2 ชุด A" อยู่แล้ว' });
  });

  it("ย้ายจากร่าง (ยังไม่มีใครเรียน) — ลบแถวและไฟล์ในชุดเดิม", async () => {
    const A = await makeSet("ชุด A", "draft", 2);
    const B = await makeSet("ชุด B", "draft", 0);
    const out = await C.transferClip({ actor: TG, documentId: A.clips[0].id, targetSetId: B.set.id, mode: "move", now: sec(1) });
    expect(out).toMatchObject({ ok: true, source: "removed" });
    expect((await docsOf(A.v.id)).map((d) => d.id)).not.toContain(A.clips[0].id);
    expect(devStoreObjects().has(A.clips[0].objectKey)).toBe(false);
    expect(devStoreObjects().has(A.clips[0].coverKey!)).toBe(false);
    const moved = await docsOf(B.v.id);
    expect(moved.map((d) => d.fileName)).toEqual(["คู่มือ", "EP1 ชุด A"]);
    expect((await eventsOf(A.set.id))[0].detail).toMatchObject({ mode: "move", source: "removed" });
  });

  it("ย้ายจากชุดที่ใช้อยู่เข้าชุดที่ใช้อยู่ — ชุดเดิมซ่อน (ความคืบหน้ายังอยู่) · ปลายทาง: คนที่ยังไม่ผ่านต้องดูเพิ่ม คนที่ผ่านแล้วไม่ต้องทำอะไร", async () => {
    const A = await makeSet("ชุด A", "active", 2);
    const B = await makeSet("ชุด B", "active", 1);
    const learnerA = await assign(A.set.id, 31);
    await finishReading(learnerA, [A.clips[1], A.pdf]);
    expect((await L.learnView(31, learnerA.id, sec(1)))!.state).toBe("reading");

    const ready = await assign(B.set.id, 32);
    await finishReading(ready, [...B.clips, B.pdf]);
    const passed = await assign(B.set.id, 33, true);
    expect((await L.learnView(32, ready.id, sec(1)))!.state).toBe("ready");
    expect((await C.clipTargets(TG, A.set.id)).find((t) => t.setId === B.set.id)).toEqual({ setId: B.set.id, title: "ชุด B", status: "active", landing: "live", learnersToWatch: 1 });

    const out = await C.transferClip({ actor: TG, documentId: A.clips[0].id, targetSetId: B.set.id, mode: "move", now: sec(2) });
    expect(out).toMatchObject({ ok: true, landing: "live", source: "hidden" });

    // ชุดเดิม: คลิปซ่อน ไฟล์อยู่ · คนที่ดูอย่างอื่นครบแล้วสอบได้ทันที
    const [hidden] = await testDb().select().from(schema.documents).where(eq(schema.documents.id, A.clips[0].id));
    expect(hidden.hidden).toBe(true);
    expect(devStoreObjects().has(A.clips[0].objectKey)).toBe(true);
    expect((await L.learnView(31, learnerA.id, sec(3)))!.state).toBe("ready");

    // ปลายทาง: คลิปขึ้นเป็นตอนสุดท้าย · คนที่รอสอบต้องดูเพิ่ม · คนที่ผ่านแล้วยังผ่าน
    const view = (await L.learnView(32, ready.id, sec(3)))!;
    expect(view.documents.map((d) => d.fileName)).toEqual(["EP1 ชุด B", "คู่มือ", "EP1 ชุด A"]);
    expect(view.state).toBe("reading");
    expect((await L.learnView(33, passed.id, sec(3)))!.state).toBe("passed");
    expect((await eventsOf(A.set.id))[0].detail).toMatchObject({ mode: "move", source: "hidden", landing: "live" });
  });

  it("ชุดที่ใช้อยู่ที่กำลังทำเวอร์ชันใหม่ — คลิปเข้าเวอร์ชันใหม่ ผู้เรียนยังไม่เห็น · ส่งเวอร์ชันใหม่แล้ว = รับไม่ได้", async () => {
    const A = await makeSet("ชุด A", "draft", 1);
    const B = await makeSet("ชุด B", "active", 1);
    const [v2] = await testDb().insert(schema.setVersions).values({ setId: B.set.id, versionNo: 2, createdByPersonId: AUTHOR.personId }).returning();
    expect((await C.clipTargets(TG, A.set.id)).find((t) => t.setId === B.set.id)?.landing).toBe("new_version");

    const out = await C.transferClip({ actor: TG, documentId: A.clips[0].id, targetSetId: B.set.id, mode: "copy" });
    expect(out).toMatchObject({ ok: true, landing: "new_version" });
    const [copy] = await docsOf(v2.id);
    expect(copy.objectKey).toMatch(new RegExp(`^sets/${B.set.id}/v2/`));
    expect(await docsOf(B.v.id)).toHaveLength(2);

    await testDb().update(schema.setVersions).set({ submittedAt: T0 }).where(eq(schema.setVersions.id, v2.id));
    expect((await C.clipTargets(TG, A.set.id)).some((t) => t.setId === B.set.id)).toBe(false);
  });

  it("ปฏิเสธ: ไม่ใช่ TG · ไม่ใช่วิดีโอ · ชุดเดียวกัน · ปลายทางรออนุมัติ/ปิด · ย้ายออกจากชุดที่ปิด · ย้ายแล้วชุดเดิมไม่เหลือเนื้อหา", async () => {
    const A = await makeSet("ชุด A", "active", 1);
    const B = await makeSet("ชุด B", "draft", 0);
    const pending = await makeSet("รออนุมัติ", "pending_approval", 0);
    const closed = await makeSet("ปิดแล้ว", "closed", 1);
    const clip = A.clips[0].id;

    expect(await C.transferClip({ actor: { ...AUTHOR, role: "author" }, documentId: clip, targetSetId: B.set.id, mode: "copy" })).toEqual({ ok: false, error: "ย้าย/คัดลอกคลิปได้เฉพาะ TG" });
    expect(await C.transferClip({ actor: TG, documentId: A.pdf.id, targetSetId: B.set.id, mode: "copy" })).toEqual({ ok: false, error: "ย้าย/คัดลอกได้เฉพาะคลิปวิดีโอ" });
    expect(await C.transferClip({ actor: TG, documentId: clip, targetSetId: A.set.id, mode: "copy" })).toEqual({ ok: false, error: "เลือกชุดปลายทาง" });
    expect((await C.transferClip({ actor: TG, documentId: clip, targetSetId: pending.set.id, mode: "copy" })).ok).toBe(false);
    expect((await C.transferClip({ actor: TG, documentId: clip, targetSetId: closed.set.id, mode: "copy" })).ok).toBe(false);
    expect(await C.transferClip({ actor: TG, documentId: closed.clips[0].id, targetSetId: B.set.id, mode: "move" })).toEqual({ ok: false, error: "ชุดนี้ปิดแล้ว — คัดลอกได้อย่างเดียว" });
    // คัดลอกจากชุดที่ปิดแล้วได้
    expect((await C.transferClip({ actor: TG, documentId: closed.clips[0].id, targetSetId: B.set.id, mode: "copy" })).ok).toBe(true);

    // ชุดที่ใช้อยู่ที่เหลือคลิปนี้รายการเดียว — ย้ายไม่ได้ (ซ่อนแล้วไม่มีอะไรให้เรียน) · คัดลอกได้
    await S.setDocumentHidden({ actor: TG, documentId: A.pdf.id, hidden: true });
    expect(await C.transferClip({ actor: TG, documentId: clip, targetSetId: B.set.id, mode: "move" })).toEqual({
      ok: false,
      error: "ชุดนี้ต้องเหลือคลิปหรือเอกสารให้ผู้เรียนอย่างน้อย 1 รายการ — คัดลอกแทนการย้าย",
    });
    // ชุด B: PDF เดิม + คลิปที่คัดลอกจากชุดที่ปิด — การย้ายที่ถูกปฏิเสธไม่ทิ้งแถวหรือไฟล์ไว้
    expect(await docsOf(B.v.id)).toHaveLength(2);
    expect(devStoreObjects().size).toBe(2 * 2 + 2); // A + ปิดแล้ว (คลิป+ปก) + คลิปที่คัดลอกจากชุดที่ปิด (คลิป+ปก)
  });

  it("clipTargets — เฉพาะ TG · ไม่มีชุดต้นทาง ชุดรออนุมัติ ปิด ลบ", async () => {
    const A = await makeSet("ชุด A", "active", 1);
    await makeSet("ร่าง", "draft", 0);
    await makeSet("รออนุมัติ", "pending_approval", 0);
    await makeSet("ปิดแล้ว", "closed", 0);
    await makeSet("ลบแล้ว", "deleted", 0);
    expect(await C.clipTargets(AUTHOR, A.set.id)).toEqual([]);
    expect((await C.clipTargets(TG, A.set.id)).map((t) => [t.title, t.landing])).toEqual([["ร่าง", "draft"]]);
  });
});
