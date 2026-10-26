import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearOrgCache, fetchOrg } from "@/lib/workid";

/**
 * `GET /api/v1/org` — ชื่อฟิลด์ตรงกับ `listOrg()` ใน `WorkID/src/lib/directory.ts` (ข้อ 14: เปิดดูของจริงแล้ว)
 * WorkTrain ใช้ `positionId` (ตำแหน่ง) · `teamId`/`managedTeamIds` (ทีม) · `managerPersonId` (หัวหน้า) · `lineGroupId` (กลุ่มประจำตัว)
 */

const GROUP = `C${"a".repeat(32)}`;

beforeEach(() => clearOrgCache());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function configured(people: unknown[]) {
  vi.stubEnv("WORKID_BASE_URL", "https://workid.workstationoffice.com");
  vi.stubEnv("WORKID_API_KEY", "k");
  vi.stubEnv("WORKID_APP_KEY", "worktrain");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ people }), { status: 200 })));
}

describe("fetchOrg — หัวหน้าและไลน์ทีม", () => {
  it("อ่าน managerPersonId และ lineGroupId · ค่าผิดรูปแบบนับเป็นไม่ได้ตั้ง (ไม่ส่งไปที่ที่ไม่รู้ว่าคือที่ไหน)", async () => {
    configured([
      { personId: 1, email: "a@x.co", fullName: "ก", title: "Sales Spec", managerPersonId: 9, lineGroupId: GROUP },
      { personId: 2, email: "b@x.co", fullName: "ข", title: null, managerPersonId: null, lineGroupId: "Cbad" },
      { personId: 3, email: "c@x.co", fullName: "ค", managerPersonId: "9" },
    ]);
    const org = await fetchOrg();
    expect(org.ok).toBe(true);
    if (!org.ok) return;
    expect(org.people.map((p) => [p.personId, p.managerPersonId, p.lineGroupId])).toEqual([
      [1, 9, GROUP],
      [2, null, null],
      [3, null, null],
    ]);
  });
});

describe("fetchOrg — รหัสตำแหน่ง ทีม และทีมที่ดูแล (spec §6.1 · §12)", () => {
  it("อ่าน positionId · teamId · managedTeamIds · ค่าที่ไม่ใช่จำนวนเต็มบวกนับเป็นไม่มี", async () => {
    configured([
      { personId: 1, email: "a@x.co", fullName: "ก", title: "Sales Spec", positionId: 41, teamId: 3, managedTeamIds: [3, 7] },
      { personId: 2, email: "b@x.co", fullName: "ข", positionId: "41", teamId: 0, managedTeamIds: [1.5, -2, "4", 8] },
    ]);
    const org = await fetchOrg();
    expect(org.ok && org.people.map((p) => [p.positionId, p.teamId, p.managedTeamIds])).toEqual([
      [41, 3, [3, 7]],
      [null, null, [8]],
    ]);
  });

  it("WorkID รุ่นก่อนที่ยังไม่ส่ง positionId → null ไม่ใช่เดาจาก title", async () => {
    configured([{ personId: 1, email: "a@x.co", fullName: "ก", title: "Sales Spec" }]);
    const org = await fetchOrg();
    expect(org.ok && org.people[0]).toMatchObject({ title: "Sales Spec", positionId: null, teamId: null, managedTeamIds: [] });
  });
});

describe("fetchOrg — ชื่อสามฟิลด์ของ WorkID (ADR-0002 ของ WorkID)", () => {
  it("อ่าน name + nickname · WorkID รุ่นเก่าที่ไม่มีสองฟิลด์นี้ → name = fullName · nickname = null", async () => {
    configured([
      { personId: 1, email: "a@x.co", fullName: "สมใจ ใจดี (ใจ)", name: "สมใจ ใจดี", nickname: "ใจ" },
      { personId: 2, email: "b@x.co", fullName: "สมชาย ใจดี", name: "สมชาย ใจดี", nickname: null },
      { personId: 3, email: "c@x.co", fullName: "สมศรี ใจดี (ศรี)" },
    ]);
    const org = await fetchOrg();
    expect(org.ok && org.people.map((p) => [p.name, p.nickname])).toEqual([
      ["สมใจ ใจดี", "ใจ"],
      ["สมชาย ใจดี", null],
      // ไม่แกะวงเล็บเอง — รอ WorkID ส่งฟิลด์มา
      ["สมศรี ใจดี (ศรี)", null],
    ]);
  });
});

describe("WORKTRAIN_DEV_ORG — ผังจำลองบนเครื่อง dev", () => {
  const dev = JSON.stringify([{ personId: 5, email: "d@x.co", fullName: "ง", title: "Sales Spec", managerPersonId: 6 }]);

  it("บนเครื่อง dev ใช้ผังจำลองโดยไม่ถาม WorkID", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("WORKTRAIN_DEV_ORG", dev);
    const org = await fetchOrg();
    expect(org).toEqual({
      ok: true,
      people: [{ personId: 5, email: "d@x.co", fullName: "ง", name: "ง", nickname: null, title: "Sales Spec", positionId: null, teamId: null, teamName: null, managedTeamIds: [], lineGroupId: null, managerPersonId: 6 }],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("★ บน Vercel ผังจำลองตาย — ถาม WorkID จริงเสมอ (ข้อ 16: ต้องตายเพราะที่ที่มันรัน ไม่ใช่เพราะจำได้ว่าอย่าตั้ง)", async () => {
    configured([{ personId: 1, email: "a@x.co", fullName: "ก" }]);
    vi.stubEnv("WORKTRAIN_DEV_ORG", dev);
    vi.stubEnv("VERCEL", "1");
    const org = await fetchOrg();
    expect(org.ok && org.people.map((p) => p.personId)).toEqual([1]);
  });

  it("ตั้งผิดรูปแบบ → ดัง ไม่ใช่กลายเป็นผังว่างเงียบ ๆ (ข้อ 14)", async () => {
    vi.stubEnv("WORKTRAIN_DEV_ORG", "{not json");
    await expect(fetchOrg()).rejects.toThrow(/WORKTRAIN_DEV_ORG/);
    vi.stubEnv("WORKTRAIN_DEV_ORG", JSON.stringify([{ personId: 1 }]));
    await expect(fetchOrg()).rejects.toThrow(/WORKTRAIN_DEV_ORG/);
  });
});
