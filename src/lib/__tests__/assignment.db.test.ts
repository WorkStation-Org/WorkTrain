import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import { defaultBlueprint } from "@/domain/blueprint";
import type { Actor } from "@/lib/auth";
import { clearOrgCache } from "@/lib/workid";

/**
 * ผู้รับ → มอบ → เตือน (spec §5 · §6 · §11) — PGlite + migration จริง
 * ผังมาจาก `WORKTRAIN_DEV_ORG` · ทุกข้อความไปกลุ่ม Test (`TEST_LINE_GROUP_ID`) ผ่าน GateWay ปลอมที่ระดับ fetch
 */

vi.mock("@/db", async () => {
  const s = await import("@/db/schema");
  const { testDb: get } = await import("@/db/__tests__/pgdb");
  return { db: () => get(), schema: s };
});

const { setAudience, previewAudience, syncAssignments, runReminders, notifyApprovalEvent } = await import("@/lib/assignment-service");

const TEST_GROUP = `C${"e".repeat(32)}`;
const TEAM_GROUP = `C${"a".repeat(32)}`;
const DAY = 24 * 60 * 60 * 1000;
// จันทร์ 2 พ.ย. 2569 09:00 เวลาไทย
const MON = new Date("2026-11-02T09:00:00+07:00");

const pd: Actor = { personId: 10, email: "pd@ws.co", name: "พีดี", role: "author" };

const ORG = [
  { personId: 10, email: "pd@ws.co", fullName: "พีดี", name: "พีดี", managerPersonId: 20 },
  { personId: 20, email: "mgr@ws.co", fullName: "ผจก.", name: "ผจก.", managerPersonId: null, managedTeamIds: [3] },
  { personId: 31, email: "s1@ws.co", fullName: "เซล หนึ่ง (หนึ่ง)", name: "เซล หนึ่ง", nickname: "หนึ่ง", positionId: 41, teamId: 3, managerPersonId: 20, lineGroupId: TEAM_GROUP },
  { personId: 32, email: "s2@ws.co", fullName: "เซล สอง", name: "เซล สอง", positionId: 41, teamId: 3, managerPersonId: 20 },
  { personId: 40, email: "qc@ws.co", fullName: "คิวซี", name: "คิวซี", positionId: 77, teamId: 8, managerPersonId: 20 },
];

let pushes: { to: string; text: string; key: string }[] = [];

function stubGateway() {
  vi.stubEnv("GATEWAY_BASE_URL", "https://gw.test");
  vi.stubEnv("GATEWAY_API_KEY", "k");
  vi.stubEnv("GATEWAY_LINE_CHANNEL_ID", "1");
  vi.stubEnv("TEST_LINE_GROUP_ID", TEST_GROUP);
  let n = 0;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { to: string; messages: { text: string }[]; idempotencyKey: string };
    pushes.push({ to: body.to, text: body.messages.map((m) => m.text).join("\n"), key: body.idempotencyKey });
    return new Response(JSON.stringify({ status: "queued", jobId: `job-${++n}` }), { status: 202 });
  });
}

async function activeSet(title = "F331 Signature", dueDays = 7) {
  const [set] = await testDb()
    .insert(schema.learningSets)
    .values({ title, kind: "product", authorPersonId: 10, authorName: "พีดี", blueprint: defaultBlueprint("product"), dueDays })
    .returning();
  return set;
}

async function activate(setId: number) {
  await testDb().update(schema.learningSets).set({ status: "active", approvedAt: new Date() }).where(eq(schema.learningSets.id, setId));
}

const assignmentRows = () => testDb().select().from(schema.assignments).orderBy(asc(schema.assignments.personId));

beforeAll(setupTestDb);
beforeEach(async () => {
  await truncateAll();
  clearOrgCache();
  pushes = [];
  vi.stubEnv("WORKTRAIN_DEV_ORG", JSON.stringify(ORG));
  stubGateway();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ผู้รับ", () => {
  it("ตั้งเงื่อนไขแล้วดูรายชื่อก่อนส่ง · ตำแหน่ง OR คนที่ดูแลทีม", async () => {
    const set = await activeSet();
    expect(
      await setAudience({
        actor: pd,
        setId: set.id,
        rules: [
          { kind: "position", refId: 41, label: "Sales" },
          { kind: "manages_team", refId: 3, label: "หัวหน้าทีมขาย" },
          { kind: "position", refId: 41, label: "ซ้ำ" },
        ],
      }),
    ).toEqual({ ok: true });
    const preview = await previewAudience(set.id);
    expect(preview.ok && preview.people.map((p) => p.personId)).toEqual([20, 31, 32]);
  });

  it("แก้ผู้รับได้เฉพาะตอนร่าง", async () => {
    const set = await activeSet();
    await activate(set.id);
    expect((await setAudience({ actor: pd, setId: set.id, rules: [] })).ok).toBe(false);
  });
});

describe("การมอบ", () => {
  it("อนุมัติแล้ว sync → มอบคนที่ตรงเงื่อนไข · กำหนดส่ง = วันมอบ + dueDays · แจ้งวันที่ 0 ทุกคน", async () => {
    const set = await activeSet("F331 Signature", 7);
    await setAudience({ actor: pd, setId: set.id, rules: [{ kind: "position", refId: 41, label: "Sales" }] });
    await activate(set.id);
    const out = await syncAssignments({ now: MON, setId: set.id });
    expect(out).toMatchObject({ ok: true, assigned: 2, notified: { sent: 2 } });
    const rows = await assignmentRows();
    expect(rows.map((r) => [r.personId, r.source, r.dueAt.getTime() - MON.getTime()])).toEqual([
      [31, "audience", 7 * DAY],
      [32, "audience", 7 * DAY],
    ]);
    expect(pushes.every((p) => p.to === TEST_GROUP)).toBe(true);
    expect(pushes[0].text).toContain("F331 Signature");
  });

  it("sync ซ้ำไม่มอบซ้ำและไม่แจ้งซ้ำ · คนที่เพิ่งเข้าตำแหน่งได้รับมอบรอบถัดไป กำหนดส่งนับจากวันของเขา", async () => {
    const set = await activeSet();
    await setAudience({ actor: pd, setId: set.id, rules: [{ kind: "position", refId: 41, label: "Sales" }] });
    await activate(set.id);
    await syncAssignments({ now: MON });
    expect(await syncAssignments({ now: MON })).toMatchObject({ assigned: 0 });

    const later = new Date(MON.getTime() + 2 * DAY);
    vi.stubEnv("WORKTRAIN_DEV_ORG", JSON.stringify([...ORG, { personId: 33, email: "s3@ws.co", fullName: "ใหม่", name: "ใหม่", positionId: 41 }]));
    clearOrgCache();
    expect(await syncAssignments({ now: later })).toMatchObject({ assigned: 1 });
    const fresh = (await assignmentRows()).find((r) => r.personId === 33)!;
    expect(fresh.dueAt.getTime() - later.getTime()).toBe(7 * DAY);
    expect(pushes).toHaveLength(3);
  });

  it("เส้นทาง Onboarding: ผูกด้วย positionId → มอบอัตโนมัติ source = onboarding (ADR-0005)", async () => {
    const set = await activeSet();
    await activate(set.id);
    await testDb().insert(schema.onboardingPaths).values({ positionId: 77, positionLabel: "QC", setId: set.id, createdByPersonId: 1 });
    await syncAssignments({ now: MON });
    expect((await assignmentRows()).map((r) => [r.personId, r.source])).toEqual([[40, "onboarding"]]);
  });

  it("ชุดร่างไม่ถูกมอบ · ถามผังไม่ได้ = ไม่มอบอะไร", async () => {
    const set = await activeSet();
    await setAudience({ actor: pd, setId: set.id, rules: [{ kind: "position", refId: 41, label: "Sales" }] });
    expect(await syncAssignments({ now: MON })).toMatchObject({ ok: true, assigned: 0 });
    await activate(set.id);
    vi.stubEnv("WORKTRAIN_DEV_ORG", "");
    vi.stubEnv("WORKID_BASE_URL", "");
    clearOrgCache();
    expect(await syncAssignments({ now: MON })).toMatchObject({ ok: false, assigned: 0 });
    expect(await assignmentRows()).toEqual([]);
  });
});

describe("เตือนแบบไล่ระดับ (spec §11)", () => {
  async function assignedDaysAgo(days: number, dueDays = 7) {
    const set = await activeSet("ชุด", dueDays);
    await setAudience({ actor: pd, setId: set.id, rules: [{ kind: "position", refId: 41, label: "Sales" }] });
    await activate(set.id);
    await syncAssignments({ now: new Date(MON.getTime() - days * DAY) });
    pushes = [];
    return set;
  }

  it("วันที่ 3 ยังไม่เริ่ม → เตือนตัวต่อตัว · รันซ้ำวันเดียวกันไม่เตือนซ้ำ", async () => {
    await assignedDaysAgo(3);
    expect((await runReminders({ now: MON })).day3).toMatchObject({ sent: 2 });
    expect((await runReminders({ now: MON })).day3).toMatchObject({ sent: 0, duplicate: 2 });
  });

  it("วันที่ 3 แต่เริ่มอ่านแล้ว → ไม่เตือน", async () => {
    await assignedDaysAgo(3);
    const [a] = await assignmentRows();
    const [v] = await testDb().insert(schema.setVersions).values({ setId: a.setId, versionNo: 1, changeKind: "initial", createdByPersonId: 10 }).returning();
    const [d] = await testDb()
      .insert(schema.documents)
      .values({ versionId: v.id, kind: "catalog", objectKey: "k", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1 })
      .returning();
    await testDb().insert(schema.readingProgress).values({ assignmentId: a.id, documentId: d.id });
    expect((await runReminders({ now: MON })).day3).toMatchObject({ sent: 1 });
  });

  it("วันที่ 5 ยังไม่ผ่าน → ส่งเข้ากลุ่มประจำตัว (มีหัวหน้า) · ไม่มีกลุ่ม = ตัวต่อตัว", async () => {
    await assignedDaysAgo(5);
    vi.stubEnv("TEST_LINE_GROUP_ID", "");
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/v1/people/")) return new Response("{}", { status: 503 });
      const body = JSON.parse(String(init?.body)) as { to: string; messages: { text: string }[]; idempotencyKey: string };
      pushes.push({ to: body.to, text: body.messages[0].text, key: body.idempotencyKey });
      return new Response(JSON.stringify({ status: "queued", jobId: "j" }), { status: 202 });
    });
    const out = await runReminders({ now: MON });
    expect(pushes.map((p) => p.to)).toContain(TEAM_GROUP);
    expect(pushes.find((p) => p.to === TEAM_GROUP)?.text).toContain("หนึ่ง ยังสอบไม่ผ่าน");
    // คนที่ไม่มีกลุ่ม → ส่งตัวต่อตัว แต่ WorkID ตอบไม่ได้ = failed (ลองใหม่รอบถัดไป) ไม่ใช่ "ส่งแล้ว"
    expect(out.day5).toMatchObject({ sent: 1, failed: 1 });
  });

  it("เลยกำหนดส่ง → สรุปให้หัวหน้าเฉพาะวันจันทร์", async () => {
    await assignedDaysAgo(8);
    const out = await runReminders({ now: MON });
    expect(out.overdue).toMatchObject({ sent: 1 });
    expect(pushes.find((p) => p.text.includes("เลยกำหนดส่ง"))?.text).toContain("เซล หนึ่ง");
    const tue = new Date(MON.getTime() + DAY);
    expect((await runReminders({ now: tue })).overdue).toMatchObject({ sent: 0 });
  });

  it("สอบผ่านแล้วไม่เตือน · คนที่หายจากผัง (พ้นสภาพ) ไม่เตือน", async () => {
    await assignedDaysAgo(5);
    const rows = await assignmentRows();
    await testDb().update(schema.assignments).set({ passedAt: MON }).where(eq(schema.assignments.id, rows[0].id));
    vi.stubEnv("WORKTRAIN_DEV_ORG", JSON.stringify(ORG.filter((p) => p.personId !== 32)));
    clearOrgCache();
    const out = await runReminders({ now: MON });
    expect(out.day5).toMatchObject({ sent: 0 });
    expect(out.day3).toMatchObject({ sent: 0 });
  });
});

describe("แจ้งเรื่องการอนุมัติ", () => {
  it("ส่ง → ผู้อนุมัติ · ตีกลับ → ผู้สร้าง พร้อมความเห็น · แจ้งซ้ำไม่ได้", async () => {
    const set = await activeSet();
    await testDb().update(schema.learningSets).set({ approverPersonId: 20, approverName: "ผจก." }).where(eq(schema.learningSets.id, set.id));
    const [sub] = await testDb()
      .insert(schema.approvalEvents)
      .values({ setId: set.id, action: "submitted", actorPersonId: 10, actorName: "พีดี" })
      .returning();
    const [ret] = await testDb()
      .insert(schema.approvalEvents)
      .values({ setId: set.id, action: "returned", actorPersonId: 20, actorName: "ผจก.", comment: "ราคาผิด" })
      .returning();
    expect(await notifyApprovalEvent(sub.id)).toBe("sent");
    expect(await notifyApprovalEvent(ret.id)).toBe("sent");
    expect(await notifyApprovalEvent(ret.id)).toBe("duplicate");
    expect(pushes[0].text).toContain("ถึง ผจก.");
    expect(pushes[1].text).toContain("ถึง พีดี");
    expect(pushes[1].text).toContain("ราคาผิด");
  });
});
