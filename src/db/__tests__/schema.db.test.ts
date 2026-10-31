import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb, testDb, truncateAll } from "./pgdb";
import { errorSummary } from "@/lib/errmsg";
import {
  approvalEvents,
  assignments,
  attempts,
  examForms,
  faceConsents,
  faceScans,
  learningSets,
  notifications,
  setVersions,
} from "@/db/schema";

/**
 * กติกาที่ฐานบังคับเอง (migration 0000 · 0001) — โค้ดลืมเช็คได้ ฐานลืมไม่ได้
 */

/** drizzle ห่อ error ของ Postgres ไว้ใน `cause` — เทียบกับข้อความทั้งสาย ไม่ใช่แค่ชั้นนอก */
async function rejectsWith(p: PromiseLike<unknown>, pattern: RegExp): Promise<void> {
  let err: unknown = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, "ต้องถูกปฏิเสธ").not.toBeNull();
  expect(errorSummary(err, 2000)).toMatch(pattern);
}

const BLUEPRINT = [{ topic: "spec", level: "recall", count: 10 }];
const DAY = 24 * 60 * 60 * 1000;

beforeAll(setupTestDb);
beforeEach(truncateAll);

async function seedSet() {
  const db = testDb();
  const [set] = await db
    .insert(learningSets)
    .values({ title: "F331 Signature", kind: "product", authorPersonId: 1, authorName: "PD", blueprint: BLUEPRINT })
    .returning();
  const [version] = await db
    .insert(setVersions)
    .values({ setId: set.id, versionNo: 1, changeKind: "initial", createdByPersonId: 1 })
    .returning();
  const [form] = await db.insert(examForms).values({ versionId: version.id, kind: "full", formNo: 1 }).returning();
  const now = new Date();
  const [assignment] = await db
    .insert(assignments)
    .values({ setId: set.id, personId: 7, personName: "สมชาย", source: "audience", assignedAt: now, dueAt: new Date(now.getTime() + 7 * DAY) })
    .returning();
  const [scan] = await db
    .insert(faceScans)
    .values({ personId: 7, purpose: "exam", result: "pass", deleteAfter: new Date(now.getTime() + 90 * DAY) })
    .returning();
  return { set, version, form, assignment, scan };
}

describe("ชุดการเรียนรู้", () => {
  it("เปิดใช้ (active) โดยไม่มีวันอนุมัติไม่ได้", async () => {
    const { set } = await seedSet();
    await rejectsWith(
      testDb().execute(sql`update learning_sets set status = 'active' where id = ${set.id}`),
      /learning_sets_active_has_approval/,
    );
  });

  it("เวอร์ชันแรกต้องเป็น initial · เวอร์ชันถัดไปเป็น initial ไม่ได้", async () => {
    const { set } = await seedSet();
    await rejectsWith(
      testDb().insert(setVersions).values({ setId: set.id, versionNo: 2, changeKind: "initial", createdByPersonId: 1 }),
      /set_versions_first_is_initial/,
    );
    await testDb().insert(setVersions).values({ setId: set.id, versionNo: 2, changeKind: "small", createdByPersonId: 1 });
  });

  it("ชุดข้อสอบต่อเวอร์ชันมีได้ 5 ชุด (ADR-0003)", async () => {
    const { version } = await seedSet();
    await rejectsWith(testDb().insert(examForms).values({ versionId: version.id, kind: "full", formNo: 6 }), /exam_forms_form_no/);
  });
});

describe("ประวัติมีแต่ insert", () => {
  it("แก้หรือลบ approval_events ไม่ได้", async () => {
    const { set } = await seedSet();
    await testDb().insert(approvalEvents).values({ setId: set.id, action: "submitted", actorPersonId: 1, actorName: "PD" });
    await rejectsWith(testDb().execute(sql`update approval_events set comment = 'x'`), /มีแต่ insert/);
    await rejectsWith(testDb().execute(sql`delete from approval_events`), /มีแต่ insert/);
  });

  it("ตีกลับต้องมีความเห็น", async () => {
    const { set } = await seedSet();
    await rejectsWith(
      testDb().insert(approvalEvents).values({ setId: set.id, action: "returned", actorPersonId: 2, actorName: "PD Mgr", comment: "  " }),
      /approval_events_return_has_comment/,
    );
  });
});

describe("ครั้งที่สอบ", () => {
  it("สอบค้างได้ครั้งเดียวต่อการมอบ", async () => {
    const { version, form, assignment, scan } = await seedSet();
    const row = {
      assignmentId: assignment.id,
      versionId: version.id,
      formId: form.id,
      kind: "full" as const,
      scanId: scan.id,
      layout: [],
      deadlineAt: new Date(Date.now() + 15 * 60 * 1000),
    };
    await testDb().insert(attempts).values(row);
    await rejectsWith(testDb().insert(attempts).values(row), /attempts_open_uniq/);
  });

  it("ออกจากหน้าสอบเกิน 5 ครั้งไม่ได้ · จบแล้วต้องมีคะแนนและผล", async () => {
    const { version, form, assignment, scan } = await seedSet();
    const [a] = await testDb()
      .insert(attempts)
      .values({
        assignmentId: assignment.id,
        versionId: version.id,
        formId: form.id,
        kind: "full",
        scanId: scan.id,
        layout: [],
        deadlineAt: new Date(Date.now() + 60_000),
      })
      .returning();
    await rejectsWith(testDb().execute(sql`update attempts set leave_count = 6 where id = ${a.id}`), /attempts_leave_count/);
    await rejectsWith(
      testDb().execute(sql`update attempts set ended_at = now(), end_reason = 'submitted' where id = ${a.id}`),
      /attempts_end_fields/,
    );
  });
});

describe("ความยินยอมและการแจ้งเตือน", () => {
  it("ความยินยอมที่ยังมีผลได้แถวเดียวต่อคน", async () => {
    await testDb().insert(faceConsents).values({ personId: 7, consentVersion: "v1" });
    await rejectsWith(testDb().insert(faceConsents).values({ personId: 7, consentVersion: "v1" }), /face_consents_active_uniq/);
  });

  it("สถานะ sent ต้องมี jobId (กติกาเครือข้อ 12)", async () => {
    await rejectsWith(
      testDb().insert(notifications).values({ dedupeKey: "k", kind: "assigned", personId: 7, status: "sent" }),
      /notifications_sent_has_job/,
    );
  });
});
