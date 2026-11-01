import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import { defaultBlueprint } from "@/domain/blueprint";
import { consumerEntry, findConsumer, newConsumerKey, parseConsumers, requireConsumer } from "@/lib/api-consumers";
import type { Actor } from "@/lib/auth";
import { clearOrgCache } from "@/lib/workid";

/**
 * เส้นทาง Onboarding + API ให้ WorkHR (spec §6) — PGlite + migration จริง · ผังจาก `WORKTRAIN_DEV_ORG`
 */

vi.mock("@/db", async () => {
  const s = await import("@/db/schema");
  const { testDb: get } = await import("@/db/__tests__/pgdb");
  return { db: () => get(), schema: s };
});

const O = await import("@/lib/onboarding-service");
const { GET } = await import("@/app/api/v1/people/[email]/training-status/route");

const tg: Actor = { personId: 1, email: "tg@ws.co", name: "ทีจี", role: "admin" };
const pd: Actor = { personId: 10, email: "pd@ws.co", name: "พีดี", role: "author" };

const ORG = [
  { personId: 1, email: "tg@ws.co", fullName: "ทีจี" },
  { personId: 31, email: "New.Sales@ws.co", fullName: "เซล ใหม่", positionId: 41, title: "Sales Spec", lineGroupId: `C${"a".repeat(32)}` },
  { personId: 32, email: "s2@ws.co", fullName: "เซล สอง", positionId: 41, title: "Sales Spec" },
  { personId: 33, email: "s3@ws.co", fullName: "เซล สาม", positionId: 41, title: "Sales" },
  { personId: 40, email: "qc@ws.co", fullName: "คิวซี", positionId: 77, title: "QC" },
];

async function newSet(title: string, status: schema.SetStatus = "active") {
  const [s] = await testDb()
    .insert(schema.learningSets)
    .values({ title, kind: "general", authorPersonId: 10, authorName: "พีดี", blueprint: defaultBlueprint("general"), status, approvedAt: status === "active" ? new Date() : null })
    .returning();
  return s;
}

async function assign(setId: number, personId: number, passedAt: Date | null = null) {
  await testDb()
    .insert(schema.assignments)
    .values({ setId, personId, personName: "x", source: "onboarding", assignedAt: new Date("2026-11-02T09:00:00+07:00"), dueAt: new Date("2026-11-09T09:00:00+07:00"), passedAt });
}

const KEY = newConsumerKey();

function req(email: string, key: string | null = KEY) {
  return new Request(`https://wt.test/api/v1/people/${encodeURIComponent(email)}/training-status`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
}
const call = (email: string, key?: string | null) => GET(req(email, key), { params: Promise.resolve({ email: encodeURIComponent(email) }) });

beforeAll(setupTestDb);
beforeEach(async () => {
  await truncateAll();
  clearOrgCache();
  vi.stubEnv("WORKTRAIN_DEV_ORG", JSON.stringify(ORG));
  vi.stubEnv("WORKTRAIN_API_CONSUMERS", consumerEntry("workhr", ["read"], KEY));
});
afterEach(() => vi.unstubAllEnvs());

describe("API consumer", () => {
  it("รูป env ผิดถูกข้าม ตัวอื่นยังใช้ได้ · key ผิด = ไม่พบ", () => {
    const { consumers, invalid } = parseConsumers(`${consumerEntry("workhr", ["read"], KEY)},bad:read:zz,Upper:read:${"a".repeat(64)}`);
    expect(consumers.map((c) => c.name)).toEqual(["workhr"]);
    expect(invalid).toEqual(["bad", "#3"]);
    expect(findConsumer(`Bearer ${KEY}`, consumers)?.name).toBe("workhr");
    expect(findConsumer(`Bearer ${newConsumerKey()}`, consumers)).toBeNull();
    expect(findConsumer(`Bearer whr_${"a".repeat(30)}`, consumers)).toBeNull();
  });

  it("ไม่มี key = 401", async () => {
    const r = requireConsumer(req("s2@ws.co", null), "read");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.res.status).toBe(401);
  });
});

describe("ผูกเส้นทาง", () => {
  it("ตำแหน่งจากผัง: ชื่อที่พบบ่อยที่สุด · ไม่มี positionId ไม่ขึ้น", () => {
    clearOrgCache();
    expect(O.positionsFromOrg(ORG.map((p) => ({ positionId: p.positionId ?? null, title: p.title ?? null })))).toEqual([
      { positionId: 77, label: "QC", people: 1 },
      { positionId: 41, label: "Sales Spec", people: 3 },
    ]);
  });

  it("เฉพาะ TG · ชุดปิดผูกไม่ได้ · ผูกซ้ำไม่ซ้ำแถว · ถอดได้", async () => {
    const s = await newSet("พื้นฐานบริษัท");
    const closed = await newSet("เก่า", "closed");
    expect(await O.addPath({ actor: pd, positionId: 41, positionLabel: "Sales", setId: s.id })).toEqual({ ok: false, error: "เฉพาะ TG" });
    expect((await O.addPath({ actor: tg, positionId: 41, positionLabel: "Sales", setId: closed.id })).ok).toBe(false);
    expect(await O.addPath({ actor: tg, positionId: 41, positionLabel: "Sales", setId: s.id })).toEqual({ ok: true });
    expect(await O.addPath({ actor: tg, positionId: 41, positionLabel: "Sales", setId: s.id })).toEqual({ ok: true });
    expect(await O.listPaths()).toHaveLength(1);
    await O.removePath({ actor: tg, positionId: 41, setId: s.id });
    expect(await O.listPaths()).toEqual([]);
  });
});

describe("GET /api/v1/people/{email}/training-status", () => {
  it("ชุดในเส้นทาง · ยังไม่ได้รับมอบ = assignedAt null · complete เมื่อผ่านครบ · อีเมลไม่สนตัวพิมพ์", async () => {
    const a = await newSet("ก พื้นฐาน");
    const b = await newSet("ข สินค้า");
    const draft = await newSet("ค ร่าง", "draft");
    for (const s of [a, b, draft]) await O.addPath({ actor: tg, positionId: 41, positionLabel: "Sales", setId: s.id });
    await assign(a.id, 31, new Date("2026-11-04T10:00:00+07:00"));

    let res = await call("new.sales@WS.co");
    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body).toMatchObject({ email: "New.Sales@ws.co", personId: 31, positionId: 41, complete: false });
    expect(body.sets.map((s: { title: string; passed: boolean; assignedAt: string | null }) => [s.title, s.passed, s.assignedAt !== null])).toEqual([
      ["ก พื้นฐาน", true, true],
      ["ข สินค้า", false, false],
    ]);
    expect(JSON.stringify(body)).not.toContain("lineGroupId");

    await assign(b.id, 31, new Date("2026-11-05T10:00:00+07:00"));
    body = await (await call("new.sales@ws.co")).json();
    expect(body.complete).toBe(true);

    res = await call("qc@ws.co");
    expect((await res.json()).complete).toBeNull();
  });

  it("ไม่อยู่ในผัง = 404 · ไม่มี key = 401 · ผังล่ม = 503", async () => {
    expect((await call("ghost@ws.co")).status).toBe(404);
    expect((await call("s2@ws.co", null)).status).toBe(401);
    vi.stubEnv("WORKTRAIN_DEV_ORG", "");
    vi.stubEnv("WORKID_BASE_URL", "");
    clearOrgCache();
    const res = await call("s2@ws.co");
    expect(res.status).toBe(503);
  });

  it("ถอดชุดแล้วไม่อยู่ในสถานะ แต่การมอบเดิมยังอยู่", async () => {
    const a = await newSet("ก พื้นฐาน");
    await O.addPath({ actor: tg, positionId: 41, positionLabel: "Sales", setId: a.id });
    await assign(a.id, 32);
    await O.removePath({ actor: tg, positionId: 41, setId: a.id });
    expect((await (await call("s2@ws.co")).json()).sets).toEqual([]);
    expect(await testDb().select().from(schema.assignments).where(eq(schema.assignments.personId, 32))).toHaveLength(1);
  });
});
