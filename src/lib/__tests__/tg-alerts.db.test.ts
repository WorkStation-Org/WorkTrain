import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { setupTestDb, testDb, truncateAll } from "@/db/__tests__/pgdb";
import { clearOrgCache } from "@/lib/workid";

/**
 * แจ้ง TG ทาง LINE เมื่อมีงานในคิวใบหน้า (spec §11) — ผังและ TG มาจาก env dev · GateWay ปลอมที่ระดับ fetch
 */

vi.mock("@/db", async () => {
  const s = await import("@/db/schema");
  const { testDb: get } = await import("@/db/__tests__/pgdb");
  return { db: () => get(), schema: s };
});

const { alertTgOfFaceQueue } = await import("@/lib/tg-alerts");

const TEST_GROUP = `C${"e".repeat(32)}`;
const LEARNER = 31;
const TG_A = 1;
const TG_B = 2;
const ORG = [
  { personId: TG_A, email: "tg1@ws.co", fullName: "ทีจี หนึ่ง", name: "ทีจี หนึ่ง" },
  { personId: TG_B, email: "tg2@ws.co", fullName: "ทีจี สอง", name: "ทีจี สอง" },
  { personId: LEARNER, email: "s1@ws.co", fullName: "เซล หนึ่ง", name: "เซล หนึ่ง", nickname: "หนึ่ง" },
];

let pushes: string[] = [];

async function failedScans(personId: number, n: number) {
  for (let i = 0; i < n; i++) {
    await testDb()
      .insert(schema.faceScans)
      .values({ personId, purpose: "exam", result: "no_match", deleteAfter: new Date("2027-03-01"), createdAt: new Date(Date.UTC(2026, 10, 2, 2, i)) });
  }
}

beforeAll(setupTestDb);
beforeEach(async () => {
  await truncateAll();
  clearOrgCache();
  pushes = [];
  vi.stubEnv("WORKTRAIN_DEV_ORG", JSON.stringify(ORG));
  vi.stubEnv("WORKTRAIN_DEV_ADMINS", `${TG_A},${TG_B}`);
  vi.stubEnv("GATEWAY_BASE_URL", "https://gw.test");
  vi.stubEnv("GATEWAY_API_KEY", "k");
  vi.stubEnv("GATEWAY_LINE_CHANNEL_ID", "1");
  vi.stubEnv("TEST_LINE_GROUP_ID", TEST_GROUP);
  let n = 0;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: { text: string }[] };
    pushes.push(body.messages.map((m) => m.text).join("\n"));
    return new Response(JSON.stringify({ status: "queued", jobId: `job-${++n}` }), { status: 202 });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("แจ้ง TG เรื่องคิวใบหน้า", () => {
  it("สแกนไม่ผ่าน 2 ครั้ง = ยังไม่แจ้ง · 3 ครั้ง = แจ้ง TG ทุกคน · เรียกซ้ำ (สแกนไม่ผ่านเพิ่ม) ไม่แจ้งซ้ำ", async () => {
    await failedScans(LEARNER, 2);
    expect(await alertTgOfFaceQueue()).toMatchObject({ sent: 0 });
    await failedScans(LEARNER, 1);
    expect(await alertTgOfFaceQueue()).toMatchObject({ sent: 2 });
    expect(pushes.filter((t) => t.includes("สแกนใบหน้าไม่ผ่าน 3 ครั้งติด"))).toHaveLength(2);
    expect(pushes[0]).toContain("เซล หนึ่ง (หนึ่ง)");
    await failedScans(LEARNER, 1);
    expect(await alertTgOfFaceQueue()).toMatchObject({ sent: 0, duplicate: 2 });
  });

  it("ขอลงทะเบียนใหม่ → แจ้ง TG · ไม่แจ้ง TG เรื่องของตัวเอง", async () => {
    await testDb().insert(schema.faceEnrollments).values({ personId: TG_A, objectKey: "faces/enroll/1/x.jpg", status: "pending" });
    expect(await alertTgOfFaceQueue()).toMatchObject({ sent: 1 });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toContain("ถึง ทีจี สอง");
    expect(pushes[0]).toContain("ทีจี หนึ่ง ขอลงทะเบียนใบหน้าใหม่");
  });
});
