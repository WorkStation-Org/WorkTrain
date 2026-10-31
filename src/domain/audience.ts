import type { AudienceKind } from "@/db/schema";

/**
 * ผู้รับของชุดการเรียนรู้ (spec §5) — เงื่อนไข → รายชื่อคน · กติกาล้วน ไม่แตะฐานหรือ WorkID
 *
 * ★ เก็บเงื่อนไข ไม่ใช่รายชื่อ — คนที่เข้าตำแหน่ง/ทีมทีหลังได้รับมอบด้วย (รอบ sync ถัดไป)
 * ★ ตำแหน่งเทียบด้วย `positionId` ของ WorkHR เท่านั้น ไม่เทียบชื่อ (spec §6.1) — คนที่ยังไม่มี positionId จึงไม่ติดเงื่อนไขตำแหน่ง
 */

export interface AudienceRule {
  kind: AudienceKind;
  refId: number;
}

/** สิ่งที่ต้องรู้ของคนหนึ่งคนจากผัง (`OrgPerson` ส่งเข้ามาได้ตรง ๆ) */
export interface OrgFacts {
  personId: number;
  positionId: number | null;
  teamId: number | null;
  managedTeamIds: number[];
}

export function matchesRule(person: OrgFacts, rule: AudienceRule, adhocMembers: ReadonlyMap<number, ReadonlySet<number>>): boolean {
  switch (rule.kind) {
    case "position":
      return person.positionId === rule.refId;
    case "team":
      return person.teamId === rule.refId;
    case "manages_team":
      return person.managedTeamIds.includes(rule.refId);
    case "adhoc_group":
      return adhocMembers.get(rule.refId)?.has(person.personId) ?? false;
    case "person":
      return person.personId === rule.refId;
  }
}

/**
 * คนในผังที่ตรงเงื่อนไขอย่างน้อยหนึ่งข้อ (OR) — ผังของ WorkID มีแต่คนที่ยัง active อยู่แล้ว
 * ผู้สร้างกับผู้อนุมัติไม่ถูกตัดออก: เรียนได้ แต่ไม่นับใน Leaderboard (ADR-0009)
 */
export function resolveAudience<P extends OrgFacts>(
  people: readonly P[],
  rules: readonly AudienceRule[],
  adhocMembers: ReadonlyMap<number, ReadonlySet<number>> = new Map(),
): P[] {
  if (rules.length === 0) return [];
  return people.filter((p) => rules.some((r) => matchesRule(p, r, adhocMembers)));
}

/** ตัวเลือกของหน้าเลือกผู้รับ — ตำแหน่ง/ทีมที่มีคนอยู่จริงในผังตอนนี้ */
export function audienceOptions(people: readonly (OrgFacts & { title: string | null; teamName: string | null })[]) {
  const positions = new Map<number, { label: string; count: number }>();
  const teams = new Map<number, { label: string; count: number }>();
  const managers = new Map<number, number>();
  for (const p of people) {
    if (p.positionId !== null) {
      const cur = positions.get(p.positionId);
      positions.set(p.positionId, { label: cur?.label ?? p.title ?? `ตำแหน่ง #${p.positionId}`, count: (cur?.count ?? 0) + 1 });
    }
    for (const t of p.managedTeamIds) managers.set(t, (managers.get(t) ?? 0) + 1);
    if (p.teamId !== null) {
      const cur = teams.get(p.teamId);
      teams.set(p.teamId, { label: cur?.label ?? p.teamName ?? `ทีม #${p.teamId}`, count: (cur?.count ?? 0) + 1 });
    }
  }
  const sorted = (m: Map<number, { label: string; count: number }>) =>
    [...m.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.label.localeCompare(b.label, "th"));
  return {
    positions: sorted(positions),
    teams: sorted(teams),
    /** จำนวนหัวหน้าที่ดูแลแต่ละทีม — ตัวเลือก "หัวหน้าที่ดูแลทีม" แสดงเฉพาะทีมที่มีหัวหน้า */
    managersByTeam: managers,
    peopleWithoutPosition: people.filter((p) => p.positionId === null).length,
  };
}
