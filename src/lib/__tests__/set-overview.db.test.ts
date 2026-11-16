import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import { GENERAL_BLUEPRINT } from "@/domain/blueprint";

/**
 * ภาพรวมชุดที่ปล่อยแล้ว (`/sets/released`) — เฉพาะชุดที่อนุมัติแล้ว · การมองเห็นตามบทบาท · ตัวเลขผู้ได้รับมอบ · เนื้อหา · เวอร์ชันใหม่
 */

vi.mock("@/db", async () => {
  const s = await import("@/db/schema");
  const { testDb: get } = await import("@/db/__tests__/pgdb");
  return { db: () => get(), schema: s };
});

const { releasedSets } = await import("@/lib/set-overview");

const T0 = new Date("2026-11-02T09:00:00+07:00");
const NOW = new Date("2026-11-12T09:00:00+07:00");
const days = (n: number) => new Date(T0.getTime() + n * 86400_000);

const AUTHOR = 10;
const APPROVER = 20;
const TG = { personId: 1, role: "admin" as const };

async function makeSet(values: Partial<typeof schema.learningSets.$inferInsert> & { title: string }) {
  const [set] = await testDb()
    .insert(schema.learningSets)
    .values({ kindId: schema.SEEDED_KIND_IDS.product, authorPersonId: AUTHOR, authorName: "พีดี", blueprint: GENERAL_BLUEPRINT, ...values })
    .returning();
  return set;
}

/** ชุดที่ใช้อยู่: V.1 อนุมัติแล้ว (วิดีโอมีปก + PDF 3 หน้า + Excel) · V.2 ส่งขออนุมัติอยู่ · มอบ 5 คนสถานะต่างกัน */
async function seed() {
  const db = testDb();
  const active = await makeSet({ title: "F331 Signature", status: "active", approvedAt: T0, approverPersonId: APPROVER, approverName: "ผจก." });
  const [v1] = await db.insert(schema.setVersions).values({ setId: active.id, versionNo: 1, label: "V.1", changeKind: "initial", createdByPersonId: AUTHOR, approvedAt: T0 }).returning();
  await db.insert(schema.setVersions).values({ setId: active.id, versionNo: 2, changeKind: "small", createdByPersonId: AUTHOR, submittedAt: days(5) });
  const [video, pdf] = await db
    .insert(schema.documents)
    .values([
      { versionId: v1.id, kind: "other", objectKey: "v", fileName: "แนะนำ", mimeType: "video/mp4", sizeBytes: 1, pageCount: 30, durationSeconds: 295, coverKey: "covers/abc123def456.jpg", coverMs: 4000, sortOrder: 0 },
      { versionId: v1.id, kind: "catalog", objectKey: "p", fileName: "แคตตาล็อก", mimeType: "application/pdf", sizeBytes: 1, pageCount: 3, sortOrder: 1 },
      { versionId: v1.id, kind: "other", objectKey: "x", fileName: "ราคา", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 1, pageCount: null, sortOrder: 2 },
    ])
    .returning();
  const [form] = await db.insert(schema.examForms).values({ versionId: v1.id, kind: "full", formNo: 1 }).returning();

  const assign = (personId: number, extra: Partial<typeof schema.assignments.$inferInsert> = {}) =>
    db
      .insert(schema.assignments)
      .values({ setId: active.id, personId, personName: `คน ${personId}`, source: "audience", assignedAt: T0, dueAt: days(14), ...extra })
      .returning()
      .then((r) => r[0]);
  await assign(31, { passedAt: days(3) });
  const reading = await assign(32);
  await assign(33);
  await assign(34, { dueAt: days(7) });
  const tried = await assign(35);
  await db.insert(schema.readingProgress).values({ assignmentId: reading.id, documentId: pdf.id, pagesSeen: [1] });
  await db.insert(schema.attempts).values({
    assignmentId: tried.id,
    versionId: v1.id,
    formId: form.id,
    kind: "full",
    layout: [],
    startedAt: days(4),
    deadlineAt: days(4),
    endedAt: days(4),
    endReason: "submitted",
    scorePercent: 50,
    passed: false,
  });

  const closed = await makeSet({ title: "Pricelist Q3", status: "closed", approvedAt: days(-30), closedAt: days(-1), authorPersonId: 11, authorName: "คนอื่น" });
  await db.insert(schema.setVersions).values({ setId: closed.id, versionNo: 1, changeKind: "initial", createdByPersonId: 11, approvedAt: days(-30) });
  await makeSet({ title: "ร่าง", status: "draft" });
  await makeSet({ title: "รออนุมัติ", status: "pending_approval", approverPersonId: APPROVER });
  return { active, closed, video };
}

beforeAll(setupTestDb);
beforeEach(truncateAll);

describe("ภาพรวมชุดที่ปล่อยแล้ว", () => {
  it("TG เห็นทุกชุดที่อนุมัติแล้ว (ใช้อยู่ก่อน แล้วปิดแล้ว) · ร่าง/รออนุมัติไม่ขึ้น", async () => {
    await seed();
    const rows = await releasedSets(TG, NOW);
    expect(rows.map((r) => [r.title, r.status])).toEqual([
      ["F331 Signature", "active"],
      ["Pricelist Q3", "closed"],
    ]);
  });

  it("ผู้สร้างเห็นชุดของตัวเอง · ผู้อนุมัติเห็นชุดที่ตัวเองอนุมัติ · คนอื่นไม่เห็น", async () => {
    await seed();
    expect((await releasedSets({ personId: AUTHOR, role: "author" }, NOW)).map((r) => r.title)).toEqual(["F331 Signature"]);
    expect((await releasedSets({ personId: APPROVER, role: "user" }, NOW)).map((r) => r.title)).toEqual(["F331 Signature"]);
    expect(await releasedSets({ personId: 99, role: "user" }, NOW)).toEqual([]);
  });

  it("นับผู้ได้รับมอบตามสถานะเดียวกับแท็บผู้เรียน · เนื้อหาของเวอร์ชันที่อนุมัติ (Excel ไม่นับ) · ปก · เวอร์ชันใหม่รออนุมัติ", async () => {
    const { video } = await seed();
    const [f331] = await releasedSets(TG, NOW);
    expect(f331).toMatchObject({
      learners: 5,
      counts: { passed: 1, started: 2, not_started: 1, overdue: 1 },
      versionLabel: "V.1",
      newVersion: "submitted",
      releasedAt: T0,
      videos: 1,
      videoSeconds: 295,
      pdfs: 1,
      pdfPages: 3,
      authorName: "พีดี",
    });
    expect(f331.coverUrl).toBe(`/api/covers/${video.id}?v=23def456`);
  });

  it("ชุดที่ปิดแล้วยังเห็นวันที่ปิด · ไม่มีป้ายเวอร์ชัน = เวอร์ชัน n · ไม่มีผู้ได้รับมอบ = 0", async () => {
    const { closed } = await seed();
    const rows = await releasedSets(TG, NOW);
    const q3 = rows.find((r) => r.setId === closed.id)!;
    expect(q3).toMatchObject({ status: "closed", closedAt: days(-1), versionLabel: "เวอร์ชัน 1", newVersion: null, learners: 0 });
  });
});
