import { describe, expect, it } from "vitest";
import { audienceOptions, resolveAudience, type OrgFacts } from "@/domain/audience";

const person = (personId: number, extra: Partial<OrgFacts & { title: string | null; teamName: string | null }> = {}) => ({
  personId,
  positionId: null,
  teamId: null,
  managedTeamIds: [],
  title: null,
  teamName: null,
  ...extra,
});

const ORG = [
  person(1, { positionId: 41, title: "Sales", teamId: 3, teamName: "ทีมขาย" }),
  person(2, { positionId: 41, title: "Sales", teamId: 4, teamName: "ทีมขายโครงการ" }),
  person(3, { positionId: 50, title: "Mgr", teamId: 3, managedTeamIds: [3, 4] }),
  person(4, { teamId: 9, teamName: "จัดส่งย่อย A", managedTeamIds: [] }),
  person(5, { managedTeamIds: [9] }),
];

describe("resolveAudience — โจทย์ข้อ 3 (ผู้รับหลายกลุ่ม)", () => {
  it("ตามตำแหน่ง (positionId) · ตามทีม · คนที่ดูแลทีม · รวมแบบ OR ไม่ซ้ำคน", () => {
    const got = resolveAudience(ORG, [
      { kind: "position", refId: 41 },
      { kind: "team", refId: 3 },
      { kind: "manages_team", refId: 9 },
    ]);
    expect(got.map((p) => p.personId)).toEqual([1, 2, 3, 5]);
  });

  it("กลุ่มเฉพาะกิจ และรายคน", () => {
    const groups = new Map([[7, new Set([4])]]);
    expect(resolveAudience(ORG, [{ kind: "adhoc_group", refId: 7 }, { kind: "person", refId: 2 }], groups).map((p) => p.personId)).toEqual([2, 4]);
  });

  it("ไม่มีเงื่อนไข = ไม่มีใคร (ไม่ใช่ทุกคน)", () => {
    expect(resolveAudience(ORG, [])).toEqual([]);
  });

  it("คนที่ยังไม่มี positionId ไม่ติดเงื่อนไขตำแหน่ง — ไม่เดาจากชื่อ (spec §6.1)", () => {
    const sameTitleNoId = [person(9, { title: "Sales" })];
    expect(resolveAudience(sameTitleNoId, [{ kind: "position", refId: 41 }])).toEqual([]);
  });
});

describe("audienceOptions", () => {
  it("รวมตำแหน่ง/ทีมที่มีคนจริง พร้อมจำนวน · นับคนที่ยังไม่มี positionId", () => {
    const o = audienceOptions(ORG);
    expect(o.positions).toEqual([
      { id: 50, label: "Mgr", count: 1 },
      { id: 41, label: "Sales", count: 2 },
    ]);
    expect(o.teams).toEqual([
      { id: 9, label: "จัดส่งย่อย A", count: 1 },
      { id: 3, label: "ทีมขาย", count: 2 },
      { id: 4, label: "ทีมขายโครงการ", count: 1 },
    ]);
    expect([...o.managersByTeam.entries()].sort()).toEqual([
      [3, 1],
      [4, 1],
      [9, 1],
    ]);
    expect(o.peopleWithoutPosition).toBe(2);
  });
});
