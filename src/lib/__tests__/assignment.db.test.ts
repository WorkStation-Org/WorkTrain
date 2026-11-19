import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { flexTexts, type FlexMessage } from "@/lib/flex";
import { asc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import { PRODUCT_BLUEPRINT } from "@/domain/blueprint";
import type { Actor } from "@/lib/auth";
import { clearOrgCache } from "@/lib/workid";

/**
 * ผู้รับ → มอบ → เตือน (spec §5 · §6 · §11) — PGlite + migration จริง
 * ผังมาจาก `WORKTRAIN_DEV_ORG` · ทุกข้อความไปกลุ่ม Test (`TEST_LINE_GROUP_ID`) ผ่าน GateWay ปลอมที่ระดับ fetch
 */

/** ข้อความที่ส่งไป GateWay อ่านเป็นข้อความเดียว — การ์ด = altText + ทุกข้อความในการ์ด (ADR-0024) */
type PushedMessage = { type: "text"; text: string } | FlexMessage;
const readable = (ms: PushedMessage[]) => ms.map((m) => (m.type === "flex" ? [m.altText, ...flexTexts(m)].join("\n") : m.text)).join("\n");

vi.mock("@/db", async () => {
  const s = await import("@/db/schema");
  const { testDb: get } = await import("@/db/__tests__/pgdb");
  return { db: () => get(), schema: s };
});

const { setAudience, previewAudience, syncAssignments, runReminders, notifyApprovalEvent, retryApprovalNotices, resendTestPeriodAssignments } = await import(
  "@/lib/assignment-service"
);

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
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://worktrain.test");
  vi.stubEnv("GATEWAY_API_KEY", "k");
  vi.stubEnv("GATEWAY_LINE_CHANNEL_ID", "1");
  vi.stubEnv("TEST_LINE_GROUP_ID", TEST_GROUP);
  let n = 0;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { to: string; messages: PushedMessage[]; idempotencyKey: string };
    pushes.push({ to: body.to, text: readable(body.messages), key: body.idempotencyKey });
    return new Response(JSON.stringify({ status: "queued", jobId: `job-${++n}` }), { status: 202 });
  });
}

async function activeSet(title = "F331 Signature", dueDays = 7) {
  const [set] = await testDb()
    .insert(schema.learningSets)
    .values({ title, kindId: schema.SEEDED_KIND_IDS.product, authorPersonId: 10, authorName: "พีดี", blueprint: PRODUCT_BLUEPRINT, dueDays })
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
    ).toEqual({ ok: true, assigned: 0, ended: 0, reopened: 0, eventId: null });
    const preview = await previewAudience(set.id);
    expect(preview.ok && preview.people.map((p) => p.personId)).toEqual([20, 31, 32]);
  });

  it("ชุดที่ใช้อยู่: ผู้สร้างเพิ่มผู้รับได้ · คนใหม่ได้รับมอบทันทีพร้อมแจ้ง · คนที่หลุดเงื่อนไขถูกตัดจบพร้อมแจ้ง · ลงประวัติ", async () => {
    const set = await activeSet();
    await setAudience({ actor: pd, setId: set.id, rules: [{ kind: "position", refId: 41, label: "Sales" }] });
    await activate(set.id);
    await syncAssignments({ setId: set.id, now: MON });
    expect((await assignmentRows()).map((a) => a.personId)).toEqual([31, 32]);
    pushes = [];

    // เปลี่ยนเป็น: ทีม 8 (คิวซี) + รายคน 32 — เซลหนึ่ง (31) หลุดเงื่อนไข
    const out = await setAudience({
      actor: pd,
      setId: set.id,
      rules: [
        { kind: "team", refId: 8, label: "ทีม QC" },
        { kind: "person", refId: 32, label: "เซล สอง" },
      ],
      now: MON,
    });
    expect(out).toMatchObject({ ok: true, assigned: 1, ended: 1, reopened: 0, eventId: expect.any(Number) });
    // ไม่ลบแถว — เซลหนึ่ง (31) ถูกตัดจบเพราะยังอยู่ในผังแต่ไม่ตรงเงื่อนไข
    expect((await assignmentRows()).map((a) => [a.personId, a.endReason])).toEqual([
      [31, "not_in_audience"],
      [32, null],
      [40, null],
    ]);
    expect(pushes.some((p) => p.text.includes("📚 ชุดการเรียนรู้ใหม่: F331 Signature"))).toBe(true);
    expect(pushes.some((p) => p.text.includes("เซล หนึ่ง") && p.text.includes("📕 ชุดการเรียนรู้ F331 Signature ไม่ต้องเรียนแล้ว"))).toBe(true);
    const [ev] = await testDb().select().from(schema.approvalEvents).where(eq(schema.approvalEvents.action, "audience_changed"));
    expect(ev).toMatchObject({ actorPersonId: 10, comment: "ทีม QC · เซล สอง" });
  });

  it("แก้ผู้รับไม่ได้: คนที่ไม่ใช่ผู้สร้าง/TG · ชุดที่รออนุมัติหรือปิดแล้ว", async () => {
    const set = await activeSet();
    const other: Actor = { personId: 31, email: "s1@ws.co", name: "เซล", role: "author" };
    expect((await setAudience({ actor: other, setId: set.id, rules: [] })).ok).toBe(false);
    await testDb().update(schema.learningSets).set({ status: "pending_approval" }).where(eq(schema.learningSets.id, set.id));
    expect((await setAudience({ actor: pd, setId: set.id, rules: [] })).ok).toBe(false);
    await testDb().update(schema.learningSets).set({ status: "closed", approvedAt: new Date(), closedAt: new Date() }).where(eq(schema.learningSets.id, set.id));
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

  it("แจ้งวันที่ 0 ล้ม (GateWay ล่ม) → sync รอบถัดไปส่งใหม่ให้ · ส่งได้แล้วไม่ส่งซ้ำ", async () => {
    const set = await activeSet();
    await setAudience({ actor: pd, setId: set.id, rules: [{ kind: "position", refId: 41, label: "Sales" }] });
    await activate(set.id);
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    expect(await syncAssignments({ now: MON })).toMatchObject({ assigned: 2, notified: { sent: 0, failed: 2 } });
    stubGateway();
    const next = new Date(MON.getTime() + DAY);
    expect(await syncAssignments({ now: next })).toMatchObject({ assigned: 0, notified: { sent: 2 } });
    expect(await syncAssignments({ now: next })).toMatchObject({ assigned: 0, notified: { sent: 0 } });
    expect(pushes.filter((p) => p.text.includes("ชุดการเรียนรู้ใหม่"))).toHaveLength(2);
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
    expect((await runReminders({ now: MON })).day3).toMatchObject({ sent: 0, duplicate: 0 });
    expect(pushes).toHaveLength(2);
  });

  it("นับวันตามปฏิทินไทย — มอบบ่ายศุกร์ เตือนวันที่ 3 เช้าจันทร์ ไม่ใช่อังคาร", async () => {
    const set = await activeSet("ชุด", 7);
    await setAudience({ actor: pd, setId: set.id, rules: [{ kind: "position", refId: 41, label: "Sales" }] });
    await activate(set.id);
    await syncAssignments({ now: new Date("2026-10-30T14:00:00+07:00") });
    pushes = [];
    expect((await runReminders({ now: new Date("2026-11-01T09:00:00+07:00") })).day3).toMatchObject({ sent: 0 });
    expect((await runReminders({ now: MON })).day3).toMatchObject({ sent: 2 });
  });

  it("กำหนดส่งสั้น (5 วัน) → เตือนกลุ่มก่อนครบกำหนด 1 วัน ไม่ใช่ไม่เตือนเลย", async () => {
    await assignedDaysAgo(3, 5);
    expect((await runReminders({ now: MON })).day5).toMatchObject({ sent: 0 });
    expect((await runReminders({ now: new Date(MON.getTime() + DAY) })).day5).toMatchObject({ sent: 2 });
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
      const body = JSON.parse(String(init?.body)) as { to: string; messages: PushedMessage[]; idempotencyKey: string };
      pushes.push({ to: body.to, text: readable(body.messages), key: body.idempotencyKey });
      return new Response(JSON.stringify({ status: "queued", jobId: "j" }), { status: 202 });
    });
    const out = await runReminders({ now: MON });
    expect(pushes.map((p) => p.to)).toContain(TEAM_GROUP);
    // การ์ดไล่ชื่อคน (ชื่อเล่น) ตามด้วยชุด
    expect(pushes.find((p) => p.to === TEAM_GROUP)?.text).toMatch(/ยังสอบไม่ผ่าน \(1\)[\s\S]*\nหนึ่ง\nชุด\n/);
    // คนที่ไม่มีกลุ่ม → ส่งตัวต่อตัว แต่ WorkID ตอบไม่ได้ = failed (ลองใหม่รอบถัดไป) ไม่ใช่ "ส่งแล้ว"
    expect(out.day5).toMatchObject({ sent: 1, failed: 1 });
  });

  it("วันที่ 5 คนในกลุ่ม LINE เดียวกันรวมเป็นข้อความเดียว · รันซ้ำวันถัดไปไม่เตือนซ้ำ", async () => {
    // สองคนใช้กลุ่มประจำตัวเดียวกัน (หัวหน้าคนเดียว)
    vi.stubEnv("WORKTRAIN_DEV_ORG", JSON.stringify(ORG.map((p) => (p.personId === 32 ? { ...p, lineGroupId: TEAM_GROUP } : p))));
    clearOrgCache();
    await assignedDaysAgo(5);
    vi.stubEnv("TEST_LINE_GROUP_ID", "");
    const out = await runReminders({ now: MON });
    expect(out.day5).toMatchObject({ sent: 2 });
    const toGroup = pushes.filter((p) => p.to === TEAM_GROUP);
    expect(toGroup).toHaveLength(1);
    expect(toGroup[0].text).toContain("ยังสอบไม่ผ่าน (2)");
    expect(toGroup[0].text).toContain("หนึ่ง");
    expect(toGroup[0].text).toContain("เซล สอง");
    // แต่ละการมอบลงว่าเตือนแล้วด้วย jobId ของข้อความรวม
    const rows = await testDb().select().from(schema.notifications).where(eq(schema.notifications.kind, "remind_day5"));
    expect(rows.filter((r) => r.dedupeKey.startsWith("remind-day5:")).map((r) => [r.status, r.jobIds.length > 0])).toEqual([
      ["sent", true],
      ["sent", true],
    ]);
    pushes = [];
    expect((await runReminders({ now: new Date(MON.getTime() + DAY) })).day5).toMatchObject({ sent: 0 });
    expect(pushes.filter((p) => p.to === TEAM_GROUP)).toHaveLength(0);
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

  it("ถามผังไม่ได้ตอนส่ง → บันทึก failed (ไม่ใช่ skipped) แล้ว cron เช้าส่งซ้ำให้", async () => {
    const set = await activeSet();
    await testDb().update(schema.learningSets).set({ approverPersonId: 20, approverName: "ผจก." }).where(eq(schema.learningSets.id, set.id));
    const [sub] = await testDb()
      .insert(schema.approvalEvents)
      .values({ setId: set.id, action: "submitted", actorPersonId: 10, actorName: "พีดี" })
      .returning();
    vi.stubEnv("TEST_LINE_GROUP_ID", "");
    vi.stubEnv("WORKTRAIN_DEV_ORG", "");
    vi.stubEnv("WORKID_BASE_URL", "");
    clearOrgCache();
    expect(await notifyApprovalEvent(sub.id)).toBe("failed");

    stubGateway();
    vi.stubEnv("WORKTRAIN_DEV_ORG", JSON.stringify(ORG));
    clearOrgCache();
    expect(await retryApprovalNotices()).toMatchObject({ sent: 1 });
    expect(pushes.at(-1)?.text).toContain("ส่งข้อสอบให้ตรวจ");
    expect(await retryApprovalNotices()).toMatchObject({ sent: 0 });
  });
});

describe("ตัดจบ · เปิดใหม่ · ด่านกันผังเพี้ยน · รวมข้อความต่อคน (16 พ.ย. 2569)", () => {
  async function salesSet(title = "F331 Signature") {
    const set = await activeSet(title);
    await setAudience({ actor: pd, setId: set.id, rules: [{ kind: "position", refId: 41, label: "Sales" }] });
    await activate(set.id);
    return set;
  }
  function withOrg(people: readonly Record<string, unknown>[]) {
    vi.stubEnv("WORKTRAIN_DEV_ORG", JSON.stringify(people));
    clearOrgCache();
  }
  const day = (n: number) => new Date(MON.getTime() + n * DAY);
  const byPerson = async (personId: number) => (await assignmentRows()).find((r) => r.personId === personId)!;

  it("ลาออก (หายจากผัง) → ตัดจบ left_org ไม่แจ้งใคร · กลับมาทำงาน → เปิดการมอบเดิม นับวันใหม่ แจ้ง 'ได้รับมอบอีกครั้ง'", async () => {
    await salesSet();
    await syncAssignments({ now: MON });
    pushes = [];
    withOrg(ORG.filter((p) => p.personId !== 32));
    expect(await syncAssignments({ now: day(1), guard: false })).toMatchObject({ ended: 1, notified: { sent: 0 } });
    expect(await byPerson(32)).toMatchObject({ endReason: "left_org", assignRound: 1 });
    expect(pushes).toHaveLength(0);

    withOrg(ORG);
    expect(await syncAssignments({ now: day(10), guard: false })).toMatchObject({ reopened: 1, notified: { sent: 1 } });
    const back = await byPerson(32);
    expect(back).toMatchObject({ endedAt: null, endReason: null, assignRound: 2 });
    expect(back.assignedAt.getTime()).toBe(day(10).getTime());
    expect(back.dueAt.getTime() - day(10).getTime()).toBe(7 * DAY);
    expect(pushes[0].text).toContain("🔁 ได้รับมอบอีกครั้ง: F331 Signature");
    // เปิดใหม่แล้วเตือนวันที่ 3 ของรอบใหม่ได้ (คีย์แยกตามรอบ) · เซลหนึ่งเลยกำหนดไปแล้วจึงไม่อยู่ในวันที่ 3
    pushes = [];
    expect((await runReminders({ now: day(13) })).day3).toMatchObject({ sent: 1 });
    expect(pushes[0].text).toContain("เซล สอง");
  });

  it("ย้ายตำแหน่ง → ตัดจบ not_in_audience + แจ้ง 'ไม่ต้องเรียนแล้ว' · ผ่านแล้วค่อยย้าย = ตัดจบแต่ยังผ่าน ไม่แจ้ง · ไม่เตือนการมอบที่ตัดจบ", async () => {
    await salesSet();
    await syncAssignments({ now: MON });
    const s1 = await byPerson(31);
    await testDb().update(schema.assignments).set({ passedAt: MON }).where(eq(schema.assignments.id, s1.id));
    pushes = [];
    withOrg(ORG.map((p) => (p.personId === 31 || p.personId === 32 ? { ...p, positionId: 77 } : p)));
    expect(await syncAssignments({ now: day(1), guard: false })).toMatchObject({ ended: 2, notified: { sent: 1 } });
    expect(await byPerson(31)).toMatchObject({ endReason: "not_in_audience", passedAt: MON });
    expect(await byPerson(32)).toMatchObject({ endReason: "not_in_audience", passedAt: null });
    expect(pushes).toHaveLength(1);
    expect(pushes[0].text).toContain("เซล สอง");
    expect(pushes[0].text).toContain("📕 ชุดการเรียนรู้ F331 Signature ไม่ต้องเรียนแล้ว");
    pushes = [];
    expect(await runReminders({ now: day(5) })).toMatchObject({ day3: { sent: 0 }, day5: { sent: 0 } });
  });

  it("ฝั่งผู้เรียน: ตัดจบที่ยังไม่ผ่าน = ชุดหายจากรายการ · ผ่านแล้วถูกตัดจบยังอยู่ในรายการ", async () => {
    const L = await import("@/lib/learn-service");
    await salesSet();
    await syncAssignments({ now: MON });
    withOrg(ORG.map((p) => (p.personId === 32 ? { ...p, positionId: 77 } : p)));
    await syncAssignments({ now: day(1), guard: false });
    expect(await L.myAssignments(32)).toEqual([]);
    expect(await L.myAssignments(31)).toHaveLength(1);
    const s2 = await byPerson(32);
    await testDb().update(schema.assignments).set({ passedAt: MON }).where(eq(schema.assignments.id, s2.id));
    expect(await L.myAssignments(32)).toHaveLength(1);
  });

  it("ด่าน: รอบอัตโนมัติจะตัดจบเกิน 10% → หยุดไว้ แจ้ง TG ครั้งเดียว · วันถัดไปผังยังเหมือนเดิม → ตัดจบ", async () => {
    vi.stubEnv("WORKTRAIN_DEV_ADMINS", "20");
    await salesSet();
    await syncAssignments({ now: MON });
    pushes = [];
    withOrg(ORG.filter((p) => p.personId !== 32));
    expect(await syncAssignments({ now: day(1) })).toMatchObject({ ended: 0, heldEnds: 1 });
    expect((await assignmentRows()).every((r) => r.endedAt === null)).toBe(true);
    expect(pushes.filter((p) => p.text.includes("หยุดไว้ก่อน"))).toHaveLength(1);
    // วันเดียวกันรันซ้ำ — ยังหยุด และไม่แจ้ง TG ซ้ำ
    expect(await syncAssignments({ now: day(1) })).toMatchObject({ ended: 0, heldEnds: 1 });
    expect(pushes.filter((p) => p.text.includes("หยุดไว้ก่อน"))).toHaveLength(1);
    // วันถัดไปผังยังบอกเหมือนเดิม = ไม่ใช่ผังเพี้ยนชั่วคราว
    expect(await syncAssignments({ now: day(2) })).toMatchObject({ ended: 1 });
    expect(await byPerson(32)).toMatchObject({ endReason: "left_org" });
  });

  it("คนเดียวได้หลายชุดในรอบเดียว → ข้อความเดียว · รอบถัดไปไม่ส่งซ้ำแยกทีละชุด", async () => {
    await salesSet("ชุด ก");
    await salesSet("ชุด ข");
    pushes = [];
    expect(await syncAssignments({ now: MON })).toMatchObject({ assigned: 4, notified: { sent: 4 } });
    expect(pushes).toHaveLength(2);
    expect(pushes[0].text).toContain("📚 ชุดการเรียนรู้ใหม่ 2 ชุด");
    // การ์ดใบเดียว ไล่ชื่อชุด · สำเนาข้อความล้วนที่เก็บไว้ยังไล่ครบ
    expect(pushes[0].text).toMatch(/\nชุด ก\nกำหนดส่ง\n[\s\S]*\nชุด ข\nกำหนดส่ง\n/);
    const [stored] = await testDb().select().from(schema.notifications).where(eq(schema.notifications.kind, "assigned")).orderBy(asc(schema.notifications.id));
    expect(stored.text).toContain("- ชุด ก · ภายใน");
    expect(stored.text).toContain("- ชุด ข · ภายใน");
    pushes = [];
    expect(await syncAssignments({ now: day(1) })).toMatchObject({ notified: { sent: 0 } });
    expect(pushes).toHaveLength(0);
  });

  it("เตือนวันที่ 3 หลายชุดของคนเดียวกัน → ข้อความเดียว", async () => {
    await salesSet("ชุด ก");
    await salesSet("ชุด ข");
    await syncAssignments({ now: day(-3) });
    pushes = [];
    expect((await runReminders({ now: MON })).day3).toMatchObject({ sent: 4 });
    expect(pushes).toHaveLength(2);
    expect(pushes[0].text).toContain("⏰ ยังไม่ได้เริ่มเรียน 2 ชุด");
    pushes = [];
    expect((await runReminders({ now: day(1) })).day3).toMatchObject({ sent: 0 });
  });
});

describe("ผู้อนุมัติเพิ่มผู้รับ · TG อนุมัติแทน (ADR-0018)", () => {
  const mgr: Actor = { personId: 20, email: "mgr@ws.co", name: "ผจก.", role: "user" };
  async function withApprover(status: "pending_approval" | "active") {
    const set = await activeSet();
    await setAudience({ actor: pd, setId: set.id, rules: [{ kind: "position", refId: 41, label: "Sales" }] });
    await testDb()
      .update(schema.learningSets)
      .set({ status, approverPersonId: 20, approverName: "ผจก.", ...(status === "active" ? { approvedAt: MON } : {}) })
      .where(eq(schema.learningSets.id, set.id));
    return set;
  }
  const rulesOf = async (setId: number) =>
    (await testDb().select().from(schema.audienceRules).where(eq(schema.audienceRules.setId, setId))).map((r) => [r.label, r.addedByPersonId]).sort();

  it("รออนุมัติ: ผู้อนุมัติเพิ่มได้ · ลงประวัติ · แจ้งผู้สร้าง · เอาของผู้สร้างออกไม่ได้ · ลบของตัวเองได้", async () => {
    const set = await withApprover("pending_approval");
    const rules = [
      { kind: "position", refId: 41, label: "Sales" },
      { kind: "team", refId: 8, label: "ทีม QC" },
    ];
    const out = await setAudience({ actor: mgr, setId: set.id, rules });
    if (!out.ok) throw new Error(out.error);
    expect(out).toMatchObject({ assigned: 0, eventId: expect.any(Number) });
    expect(await rulesOf(set.id)).toEqual([
      ["Sales", null],
      ["ทีม QC", 20],
    ]);
    const [ev] = await testDb().select().from(schema.approvalEvents).where(eq(schema.approvalEvents.id, out.eventId!));
    expect(ev).toMatchObject({ action: "audience_changed", actorPersonId: 20, comment: "เพิ่ม ทีม QC (+1 คน)", detail: { by: "approver", added: ["ทีม QC"], gained: 1 } });

    pushes = [];
    expect(await notifyApprovalEvent(out.eventId!)).toBe("sent");
    expect(pushes[0].text).toContain("ถึง พีดี");
    expect(pushes[0].text).toContain("➕ ผจก. (ผู้อนุมัติ) เพิ่มผู้รับในชุด F331 Signature: ทีม QC (+1 คน)");

    expect(await setAudience({ actor: mgr, setId: set.id, rules: [rules[1]] })).toEqual({ ok: false, error: "ผู้อนุมัติเอาเงื่อนไขที่ผู้สร้างตั้งไว้ออกไม่ได้: Sales" });
    expect((await setAudience({ actor: mgr, setId: set.id, rules: [rules[0]] })).ok).toBe(true);
    expect(await rulesOf(set.id)).toEqual([["Sales", null]]);
  });

  it("ชุดที่ใช้อยู่: ผู้อนุมัติเพิ่มแล้วมอบทันที · ผู้สร้างแก้ต่อแล้วเงื่อนไขของผู้อนุมัติยังจำว่าใครเพิ่ม · คนอื่นแก้ไม่ได้", async () => {
    const set = await withApprover("active");
    const out = await setAudience({
      actor: mgr,
      setId: set.id,
      rules: [
        { kind: "position", refId: 41, label: "Sales" },
        { kind: "team", refId: 8, label: "ทีม QC" },
      ],
      now: MON,
    });
    expect(out).toMatchObject({ ok: true, assigned: 3 });
    expect((await assignmentRows()).map((a) => a.personId)).toEqual([31, 32, 40]);
    await setAudience({
      actor: pd,
      setId: set.id,
      rules: [
        { kind: "position", refId: 41, label: "Sales" },
        { kind: "team", refId: 8, label: "ทีม QC" },
        { kind: "person", refId: 20, label: "ผจก." },
      ],
      now: MON,
    });
    expect(await rulesOf(set.id)).toEqual([
      ["Sales", null],
      ["ทีม QC", 20],
      ["ผจก.", null],
    ]);
    const qc: Actor = { personId: 40, email: "qc@ws.co", name: "คิวซี", role: "user" };
    expect((await setAudience({ actor: qc, setId: set.id, rules: [] })).ok).toBe(false);
  });

  it("TG อนุมัติแทน → ผู้สร้างได้ '(TG) อนุมัติแทน …' · ผู้อนุมัติตัวจริงได้ 'อนุมัติแทนคุณแล้ว' · ไม่แจ้งคนที่กดเอง", async () => {
    const set = await withApprover("active");
    const [ev] = await testDb()
      .insert(schema.approvalEvents)
      .values({ setId: set.id, action: "approved", actorPersonId: 99, actorName: "ทีจี", detail: { onBehalfOf: { personId: 20, name: "ผจก." } } })
      .returning();
    pushes = [];
    expect(await notifyApprovalEvent(ev.id)).toBe("sent");
    expect(pushes.map((p) => p.text)).toEqual([
      expect.stringContaining("✅ ทีจี (TG) อนุมัติแทน ผจก.: F331 Signature"),
      expect.stringContaining("ℹ️ ทีจี (TG) อนุมัติแทนคุณแล้ว: F331 Signature"),
    ]);
    // TG อนุมัติชุดที่ตัวเองสร้าง — ไม่ส่งหาตัวเอง
    const [own] = await testDb()
      .insert(schema.approvalEvents)
      .values({ setId: set.id, action: "approved", actorPersonId: 10, actorName: "พีดี", detail: { onBehalfOf: { personId: 20, name: "ผจก." }, ownSet: true } })
      .returning();
    pushes = [];
    expect(await notifyApprovalEvent(own.id)).toBeNull();
    expect(pushes.map((p) => p.text)).toEqual([expect.stringContaining("ℹ️ พีดี (TG) อนุมัติแทนคุณแล้ว")]);
  });
});

describe("เลิกช่วงทดสอบ → แจ้งการมอบที่ค้างถึงตัวจริงครั้งเดียว (ADR-0024)", () => {
  const lineIdOf = (personId: number) => `U${String(personId).padStart(32, "0")}`;
  /** ส่งจริง: WorkID ให้ LINE ของแต่ละคน · GateWay บอกว่าเป็นเพื่อน · push บันทึกไว้ */
  function goLive() {
    vi.stubEnv("TEST_LINE_GROUP_ID", "");
    vi.stubEnv("WORKID_BASE_URL", "https://workid.test");
    vi.stubEnv("WORKID_API_KEY", "k");
    let n = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const u = String(url);
      const person = /\/api\/v1\/people\/([^/?]+)/.exec(u);
      if (person) {
        const p = ORG.find((x) => x.email === decodeURIComponent(person[1]))!;
        return Response.json({ id: p.personId, email: p.email, fullName: p.fullName, active: true, lines: [{ lineUserId: lineIdOf(p.personId), verified: true }] });
      }
      if (u.includes("/profile/")) return Response.json({ status: "ok" });
      const body = JSON.parse(String(init?.body)) as { to: string; messages: PushedMessage[]; idempotencyKey: string };
      pushes.push({ to: body.to, text: readable(body.messages), key: body.idempotencyKey });
      return new Response(JSON.stringify({ status: "queued", jobId: `live-${++n}` }), { status: 202 });
    });
  }

  async function salesSet(title: string) {
    const set = await activeSet(title);
    await setAudience({ actor: pd, setId: set.id, rules: [{ kind: "position", refId: 41, label: "Sales" }] });
    await activate(set.id);
    return set;
  }

  it("ช่วงทดสอบไม่ทำอะไร · เลิกแล้วส่งถึงตัวจริง รวมต่อคน · รอบถัดไปไม่ส่งซ้ำ · ผ่านแล้ว/ตัดจบ/มอบตอนส่งจริง ไม่ได้", async () => {
    await salesSet("ชุด ก");
    await salesSet("ชุด ข");
    await syncAssignments({ now: MON });
    expect(pushes.every((p) => p.to === TEST_GROUP)).toBe(true);
    // ยังอยู่ช่วงทดสอบ — ส่งซ้ำก็แค่เข้ากลุ่ม Test อีก จึงไม่ทำ
    pushes = [];
    expect(await resendTestPeriodAssignments({ now: MON })).toMatchObject({ sent: 0 });
    expect(pushes).toHaveLength(0);

    // เซลสอง (32) สอบผ่านชุดหนึ่งไปแล้ว — เหลือชุดเดียวที่ต้องแจ้ง
    const rows = await assignmentRows();
    const passed = rows.find((a) => a.personId === 32)!;
    await testDb().update(schema.assignments).set({ passedAt: MON }).where(eq(schema.assignments.id, passed.id));

    goLive();
    const out = await resendTestPeriodAssignments({ now: new Date(MON.getTime() + DAY) });
    expect(out).toMatchObject({ sent: 3, failed: 0 });
    expect(pushes.map((p) => p.to).sort()).toEqual([lineIdOf(31), lineIdOf(32)]);
    const toOne = pushes.find((p) => p.to === lineIdOf(31))!;
    expect(toOne.text).toContain("📚 ชุดการเรียนรู้ที่ต้องเรียน 2 ชุด");
    expect(toOne.text).toContain("WorkTrain เริ่มแจ้งทาง LINE แล้ว");
    expect(toOne.text).not.toContain("[ทดสอบ");
    expect(pushes.find((p) => p.to === lineIdOf(32))!.text).toContain("📚 ชุดการเรียนรู้ที่ต้องเรียน: ");
    // บันทึกเป็นส่งจริง (ไม่มีกลุ่ม Test) — แถววันที่ 0 เดิมไม่ถูกแตะ
    const golive = await testDb().select().from(schema.notifications);
    expect(golive.filter((n) => n.dedupeKey.startsWith("golive:") && n.status === "sent")).toHaveLength(3);
    expect(golive.filter((n) => n.dedupeKey.startsWith("golive:")).every((n) => n.lineGroupId === null)).toBe(true);

    // รอบถัดไป: ไม่ส่งซ้ำ · การมอบใหม่ตอนส่งจริงได้ข้อความ "ชุดใหม่" ตามปกติ ไม่ใช่ข้อความแจ้งซ้ำ
    pushes = [];
    await salesSet("ชุด ค");
    await syncAssignments({ now: new Date(MON.getTime() + 2 * DAY) });
    expect(pushes.every((p) => p.text.includes("📚 ชุดการเรียนรู้ใหม่: ชุด ค"))).toBe(true);
    pushes = [];
    expect(await resendTestPeriodAssignments({ now: new Date(MON.getTime() + 2 * DAY) })).toMatchObject({ sent: 0 });
    expect(pushes).toHaveLength(0);
  });

  it("เลยกำหนดแล้วไม่แจ้งซ้ำ (หัวหน้าได้สรุปเลยกำหนดอยู่แล้ว)", async () => {
    await salesSet("ชุด ก");
    await syncAssignments({ now: MON });
    goLive();
    pushes = [];
    expect(await resendTestPeriodAssignments({ now: new Date(MON.getTime() + 8 * DAY) })).toMatchObject({ sent: 0 });
    expect(pushes).toHaveLength(0);
  });
});
