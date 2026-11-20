import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import { PRODUCT_BLUEPRINT } from "@/domain/blueprint";
import { clearOrgCache } from "@/lib/workid";

/**
 * Dashboard + Leaderboard (spec §12) — การมองเห็นตามบทบาท · ตัวกรอง · Leaderboard จากฐานจริง · CSV
 */

vi.mock("@/db", async () => {
  const s = await import("@/db/schema");
  const { testDb: get } = await import("@/db/__tests__/pgdb");
  return { db: () => get(), schema: s };
});

const S = await import("@/lib/stats-service");

const ORG = [
  { personId: 1, email: "tg@ws.co", fullName: "ทีจี" },
  { personId: 10, email: "pd@ws.co", fullName: "พีดี", teamId: 9, teamName: "PD" },
  { personId: 20, email: "mgr@ws.co", fullName: "ผจก.", managedTeamIds: [3], teamId: 2, teamName: "บริหาร" },
  { personId: 31, email: "s1@ws.co", fullName: "เซล หนึ่ง", teamId: 3, teamName: "ขาย", managerPersonId: 20 },
  { personId: 32, email: "s2@ws.co", fullName: "เซล สอง", teamId: 3, teamName: "ขาย", managerPersonId: 20 },
  { personId: 40, email: "qc@ws.co", fullName: "คิวซี", teamId: 8, teamName: "QC" },
];
const NOV = "2026-11";
const at = (s: string) => new Date(`${s}+07:00`);

let versionId = 0;
let formId = 0;
let scanId = 0;

async function seed() {
  const [set] = await testDb()
    .insert(schema.learningSets)
    .values({ title: "F331", kindId: schema.SEEDED_KIND_IDS.product, authorPersonId: 10, authorName: "พีดี", approverPersonId: 20, blueprint: PRODUCT_BLUEPRINT, status: "active", approvedAt: at("2026-11-01T09:00:00") })
    .returning();
  const [v] = await testDb().insert(schema.setVersions).values({ setId: set.id, versionNo: 1, changeKind: "initial", createdByPersonId: 10 }).returning();
  const [f] = await testDb().insert(schema.examForms).values({ versionId: v.id, kind: "full", formNo: 1 }).returning();
  const [sc] = await testDb().insert(schema.faceScans).values({ personId: 31, purpose: "exam", result: "pass", deleteAfter: at("2027-02-01T00:00:00") }).returning();
  versionId = v.id;
  formId = f.id;
  scanId = sc.id;
  return set;
}

async function assign(setId: number, personId: number, passedAt: string | null = null) {
  const [a] = await testDb()
    .insert(schema.assignments)
    .values({ setId, personId, personName: ORG.find((p) => p.personId === personId)!.fullName, source: "audience", assignedAt: at("2026-11-02T09:00:00"), dueAt: at("2026-11-09T09:00:00"), passedAt: passedAt ? at(passedAt) : null })
    .returning();
  return a;
}

async function attempt(assignmentId: number, startedAt: string, score: number) {
  // ผลสแกนหนึ่งครั้งเริ่มสอบได้ครั้งเดียว (attempts_scan_uniq) — แต่ละครั้งที่สอบจึงต้องมีสแกนของตัวเอง
  const [sc] = await testDb()
    .insert(schema.faceScans)
    .values({ personId: 31, purpose: "exam", result: "pass", deleteAfter: at("2027-02-01T00:00:00") })
    .returning();
  const scanId = sc.id;
  await testDb()
    .insert(schema.attempts)
    .values({ assignmentId, versionId, formId, kind: "full", scanId, layout: [], startedAt: at(startedAt), deadlineAt: at(startedAt), endedAt: at(startedAt), endReason: "submitted", scorePercent: score, passed: score >= 80 });
}

beforeAll(setupTestDb);
beforeEach(async () => {
  await truncateAll();
  clearOrgCache();
  vi.stubEnv("WORKTRAIN_DEV_ORG", JSON.stringify(ORG));
});
afterEach(() => vi.unstubAllEnvs());

describe("Dashboard", () => {
  it("TG เห็นทุกคน · หัวหน้าเห็นทีมที่ดูแล · ผู้สร้างเห็นชุดตัวเอง · ผู้เรียนเห็นแค่ตัวเอง", async () => {
    const set = await seed();
    const a31 = await assign(set.id, 31, "2026-11-03T09:00:00");
    await assign(set.id, 32);
    await assign(set.id, 40);
    await attempt(a31.id, "2026-11-03T08:00:00", 90);

    const ids = async (personId: number, role: "admin" | "author" | "user") => (await S.dashboard({ personId, role }, { month: NOV }))!.rows.map((r) => r.personId);
    expect((await ids(1, "admin")).sort()).toEqual([31, 32, 40]);
    expect((await ids(20, "user")).sort()).toEqual([31, 32]);
    expect((await ids(10, "author")).sort()).toEqual([31, 32, 40]);
    expect(await ids(32, "user")).toEqual([32]);
  });

  it("สถานะ: ยังไม่เปิด / สอบแล้ว / ผ่าน · ตัวกรองทีม · สถิติรายคน", async () => {
    const set = await seed();
    const a31 = await assign(set.id, 31, "2026-11-03T09:00:00");
    const a32 = await assign(set.id, 32);
    await assign(set.id, 40);
    await attempt(a31.id, "2026-11-03T08:00:00", 90);
    await attempt(a32.id, "2026-11-03T08:00:00", 40);
    const d = (await S.dashboard({ personId: 1, role: "admin" }, { month: NOV, teamId: 3 }))!;
    // เรียงตามชื่อแบบไทย: "เซล สอง" ก่อน "เซล หนึ่ง"
    expect(d.rows.map((r) => [r.personId, r.progress, r.attempts])).toEqual([
      [32, "tried", 1],
      [31, "passed", 1],
    ]);
    expect(d.people.find((p) => p.personId === 31)).toMatchObject({ assigned: 1, passed: 1, firstScore: 90, speedHours: 24 });
    expect(d.teams.map((t) => t.name).sort()).toEqual(["QC", "ขาย"]);
  });

  it("ซ่อนคนลาออกและการมอบที่ตัดจบที่ยังไม่ผ่าน · ตัดจบที่ผ่านแล้วยังแสดง · showHidden แสดงกลับพร้อมบอกว่าอยู่ในผังไหม", async () => {
    const set = await seed();
    await assign(set.id, 31);
    const a32 = await assign(set.id, 32, "2026-11-03T09:00:00");
    const a40 = await assign(set.id, 40);
    // 32 ผ่านแล้วค่อยย้ายทีม (ตัดจบแต่ยังแสดง) · 40 ย้ายก่อนผ่าน (ซ่อน) · 31 ลาออก (หายจากผัง = ซ่อน)
    const { eq } = await import("drizzle-orm");
    const ended = { endedAt: at("2026-11-05T09:00:00"), endReason: "not_in_audience" as const };
    await testDb().update(schema.assignments).set(ended).where(eq(schema.assignments.id, a32.id));
    await testDb().update(schema.assignments).set(ended).where(eq(schema.assignments.id, a40.id));
    vi.stubEnv("WORKTRAIN_DEV_ORG", JSON.stringify(ORG.filter((p) => p.personId !== 31)));
    clearOrgCache();

    const tg = { personId: 1, role: "admin" as const };
    const d = (await S.dashboard(tg, { month: NOV }))!;
    expect(d.rows.map((r) => r.personId)).toEqual([32]);
    expect(d.hiddenPeople).toBe(2);
    expect(d.hiddenRows).toBe(2);
    const all = (await S.dashboard(tg, { month: NOV, showHidden: true }))!;
    expect(all.rows.map((r) => [r.personId, r.inOrg]).sort()).toEqual([
      [31, false],
      [32, true],
      [40, true],
    ]);
    expect(all.hiddenPeople).toBe(0);
  });

  it("เดือนผิดรูป = null", async () => {
    expect(await S.dashboard({ personId: 1, role: "admin" }, { month: "พ.ย." })).toBeNull();
  });
});

describe("ใครเรียนอะไรไปแล้ว (learningRecord)", () => {
  it("ทุกการมอบตั้งแต่เริ่ม ไม่ดูเดือน · เรียงตามคนแล้วชุด · การมองเห็น ตัวกรอง และการซ่อนเดียวกับ Dashboard", async () => {
    const set = await seed();
    // ชุดที่ผ่านไปตั้งแต่ ก.ย. — ไม่อยู่ใน Dashboard เดือน พ.ย. แต่ต้องนับว่าเรียนแล้ว
    const [old] = await testDb()
      .insert(schema.learningSets)
      .values({ title: "A100", kindId: schema.SEEDED_KIND_IDS.product, authorPersonId: 10, authorName: "พีดี", blueprint: PRODUCT_BLUEPRINT, status: "active", approvedAt: at("2026-09-01T09:00:00") })
      .returning();
    await testDb()
      .insert(schema.assignments)
      .values({ setId: old.id, personId: 31, personName: "เซล หนึ่ง", source: "audience", assignedAt: at("2026-09-02T09:00:00"), dueAt: at("2026-09-09T09:00:00"), passedAt: at("2026-09-04T09:00:00") });
    await assign(set.id, 31);
    await assign(set.id, 32);
    const a40 = await assign(set.id, 40);
    const { eq } = await import("drizzle-orm");
    await testDb().update(schema.assignments).set({ endedAt: at("2026-11-05T09:00:00"), endReason: "not_in_audience" }).where(eq(schema.assignments.id, a40.id));

    const tg = { personId: 1, role: "admin" as const };
    expect((await S.dashboard(tg, { month: NOV }))!.rows.some((r) => r.setId === old.id)).toBe(false);

    const rec = await S.learningRecord(tg, {});
    // "เซล สอง" ก่อน "เซล หนึ่ง" · ในคนเดียวกันเรียงตามชื่อชุด
    expect(rec.rows.map((r) => [r.personId, r.setTitle, r.progress])).toEqual([
      [32, "F331", "not_opened"],
      [31, "A100", "passed"],
      [31, "F331", "not_opened"],
    ]);
    expect(rec.hiddenRows).toBe(1);
    expect((await S.learningRecord(tg, { showHidden: true })).rows.map((r) => r.personId)).toContain(40);
    expect((await S.learningRecord(tg, { setId: old.id })).rows.map((r) => r.personId)).toEqual([31]);
    // ผู้เรียนเห็นแค่ของตัวเอง · หัวหน้าเห็นทีมที่ดูแล
    expect((await S.learningRecord({ personId: 32, role: "user" }, {})).rows.map((r) => r.personId)).toEqual([32]);
    expect(new Set((await S.learningRecord({ personId: 20, role: "user" }, {})).rows.map((r) => r.personId))).toEqual(new Set([31, 32]));
  });
});

describe("Leaderboard", () => {
  it("ไม่นับชุดที่ตัวเองอนุมัติ · เครื่อง dev ไม่มี TG ให้ตัด", async () => {
    const set = await seed();
    const a31 = await assign(set.id, 31);
    const a20 = await assign(set.id, 20);
    await attempt(a31.id, "2026-11-03T08:00:00", 80);
    await attempt(a20.id, "2026-11-03T08:00:00", 100);
    const b = (await S.monthLeaderboard(NOV))!;
    expect(b.tgExcluded).toBe(true);
    expect(b.rows.map((r) => [r.rank, r.personId, r.firstScore])).toEqual([[1, 31, 80]]);
    expect((await S.monthLeaderboard("2026-10"))!.rows).toEqual([]);
  });
});

describe("CSV", () => {
  it("BOM · ครอบค่าที่มีจุลภาค · กันสูตร Excel", () => {
    expect(S.toCsv(["a", "b"], [["x,y", "=SUM(A1)"], [null, 5]])).toBe('﻿a,b\r\n"x,y",\'=SUM(A1)\r\n,5\r\n');
    // tab นำหน้า (OWASP) — บางโปรแกรมตัดช่องว่างแล้วตีความเป็นสูตร
    expect(S.toCsv(["a"], [["\t=HYPERLINK(1)"]])).toBe("﻿a\r\n'\t=HYPERLINK(1)\r\n");
  });
});
