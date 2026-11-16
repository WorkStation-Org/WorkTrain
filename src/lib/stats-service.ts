import { and, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { assignments, attempts, learningSets, readingProgress } from "@/db/schema";
import { hiddenFromLists } from "@/domain/assignment-end";
import { leaderboard, personMonthStats, type LeaderRow, type PersonMonthStats, type StatAttempt } from "@/domain/stats";
import type { Actor } from "@/lib/auth";
import { personLabelsFrom, type PersonLabel } from "@/lib/person-name";
import { bangkokMonthRange } from "@/lib/time";
import { fetchOrg, fetchRolePeople, type OrgPerson } from "@/lib/workid";

/**
 * Dashboard + Leaderboard (spec §12)
 *
 * การมองเห็น: TG ทุกคน · หัวหน้าเห็นคนในทีมที่ดูแล (`managedTeamIds`) · ผู้สร้างเห็นชุดของตัวเอง · ทุกคนเห็นของตัวเอง
 * ★ Leaderboard ทุกคนเห็น — มีแค่ชื่อ ชื่อเล่น ทีม คะแนนครั้งแรก ความไว ไม่มีรายละเอียดอื่นของคน
 * ★ ถามผังไม่ได้ = หัวหน้าเห็นแค่ของตัวเอง (ไม่เดาว่าใครอยู่ทีมไหน) และหน้าจอบอกตรง ๆ
 * ★ คนลาออก · การมอบที่ตัดจบแล้วยังไม่ผ่าน ซ่อนทุกส่วนทุกเดือน (`hiddenFromLists`) — `showHidden` แสดงกลับ · CSV ส่งทุกคน
 */

export type SetProgress = "not_opened" | "opened" | "tried" | "passed";

export const PROGRESS_LABEL: Record<SetProgress, string> = {
  not_opened: "ยังไม่เปิด",
  opened: "เปิดแล้ว",
  tried: "สอบแล้ว ยังไม่ผ่าน",
  passed: "ผ่าน",
};

export interface DashboardFilter {
  month: string;
  teamId?: number;
  managerPersonId?: number;
  setId?: number;
  /** แสดงคนที่ซ่อน (ลาออก · ตัดจบที่ยังไม่ผ่าน) ด้วย — ปุ่ม "แสดง" บนหน้า และ CSV */
  showHidden?: boolean;
}

export interface StatusRow {
  assignmentId: number;
  setId: number;
  setTitle: string;
  personId: number;
  personName: string;
  /** ชื่อ · ชื่อเล่น · ทีม จากผังปัจจุบัน (หน้าจอ) — `personName` คือชื่อ ณ วันที่มอบ (CSV คอลัมน์เดิม) */
  label: PersonLabel;
  teamName: string | null;
  assignedAt: Date;
  dueAt: Date;
  passedAt: Date | null;
  progress: SetProgress;
  attempts: number;
  /** ยังอยู่ในผัง WorkID · null = ถามผังไม่ได้ */
  inOrg: boolean | null;
  endedAt: Date | null;
}

/** ชื่อ · ชื่อเล่น · ทีม จากผังปัจจุบัน ต่อท้ายแถวของคน — ไม่เก็บลงฐาน (ADR-0002) · ไม่พบในผัง = ชื่อในแถว */
export type WithOrgLabel<T> = T & { label: PersonLabel };

export interface Dashboard {
  scope: "all" | "limited";
  orgOk: boolean;
  people: (WithOrgLabel<PersonMonthStats> & { inOrg: boolean | null })[];
  rows: StatusRow[];
  /** จำนวนคนที่ซ่อนไว้ทั้งคน (ลาออก · ทุกการมอบตัดจบที่ยังไม่ผ่าน) — สถิติรายคน · 0 เมื่อ `showHidden` */
  hiddenPeople: number;
  /** จำนวนการมอบที่ซ่อนไว้ — ตารางสถานะรายชุด (คนเดียวอาจซ่อนบางชุด) · 0 เมื่อ `showHidden` */
  hiddenRows: number;
  teams: { id: number; name: string }[];
  managers: { personId: number; name: string }[];
  sets: { id: number; title: string }[];
}

/** ใครที่ actor มองเห็นในการมอบหนึ่ง */
function visibleTo(actor: Pick<Actor, "personId" | "role">, me: OrgPerson | undefined, teamOf: Map<number, number | null>) {
  const managed = new Set(me?.managedTeamIds ?? []);
  return (a: { personId: number }, set: { authorPersonId: number }) => {
    if (actor.role === "admin") return true;
    if (a.personId === actor.personId) return true;
    if (set.authorPersonId === actor.personId) return true;
    const team = teamOf.get(a.personId);
    return team !== undefined && team !== null && managed.has(team);
  };
}

/**
 * ข้อมูลของหน้า Dashboard — แถวสถานะคือการมอบที่ได้รับในเดือนนั้น หรือยังไม่ผ่านอยู่ หรือผ่านในเดือนนั้น
 * สถิติรายคนคำนวณจากการมอบที่มองเห็นทั้งหมด (ไม่ถูกตัวกรองทีม/ชุดตัด เฉพาะคนที่ผ่านตัวกรอง)
 */
export async function dashboard(actor: Pick<Actor, "personId" | "role">, filter: DashboardFilter, now: Date = new Date()): Promise<Dashboard | null> {
  const month = bangkokMonthRange(filter.month);
  if (!month) return null;
  const org = await fetchOrg(now.getTime());
  const people = org.ok ? org.people : [];
  const teamOf = new Map(people.map((p) => [p.personId, p.teamId]));
  const managerOf = new Map(people.map((p) => [p.personId, p.managerPersonId]));
  const teamName = new Map(people.filter((p) => p.teamId !== null).map((p) => [p.teamId!, p.teamName ?? `ทีม #${p.teamId}`]));
  const me = people.find((p) => p.personId === actor.personId);
  const sees = visibleTo(actor, me, teamOf);
  const labelOf = personLabelsFrom(people);
  const inOrg = org.ok ? new Set(people.map((p) => p.personId)) : null;

  const rowsDb = await db()
    .select({ a: assignments, title: learningSets.title, authorPersonId: learningSets.authorPersonId })
    .from(assignments)
    .innerJoin(learningSets, eq(learningSets.id, assignments.setId))
    .where(
      or(
        and(gte(assignments.assignedAt, month.start), lt(assignments.assignedAt, month.end)),
        and(gte(assignments.passedAt, month.start), lt(assignments.passedAt, month.end)),
        and(lt(assignments.assignedAt, month.end), eq(learningSets.status, "active"), isNull(assignments.passedAt)),
      ),
    );
  const visible = rowsDb.filter((r) => sees(r.a, r));
  const matching = visible.filter(
    (r) =>
      (!filter.setId || r.a.setId === filter.setId) &&
      (!filter.teamId || teamOf.get(r.a.personId) === filter.teamId) &&
      (!filter.managerPersonId || managerOf.get(r.a.personId) === filter.managerPersonId),
  );
  const filtered = filter.showHidden ? matching : matching.filter((r) => !hiddenFromLists(r.a, inOrg));
  const shownPeople = new Set(filtered.map((r) => r.a.personId));
  const hiddenPeople = new Set(matching.filter((r) => !shownPeople.has(r.a.personId)).map((r) => r.a.personId)).size;

  const ids = filtered.map((r) => r.a.id);
  const tried = ids.length
    ? await db()
        .select({ assignmentId: attempts.assignmentId, kind: attempts.kind, startedAt: attempts.startedAt, endedAt: attempts.endedAt, scorePercent: attempts.scorePercent, leaveCount: attempts.leaveCount })
        .from(attempts)
        .where(inArray(attempts.assignmentId, ids))
    : [];
  const opened = ids.length ? await db().selectDistinct({ id: readingProgress.assignmentId }).from(readingProgress).where(inArray(readingProgress.assignmentId, ids)) : [];
  const openedSet = new Set(opened.map((o) => o.id));
  const attemptCount = new Map<number, number>();
  for (const t of tried) attemptCount.set(t.assignmentId, (attemptCount.get(t.assignmentId) ?? 0) + 1);

  const rows: StatusRow[] = filtered
    .map((r) => {
      const n = attemptCount.get(r.a.id) ?? 0;
      const progress: SetProgress = r.a.passedAt ? "passed" : n > 0 ? "tried" : openedSet.has(r.a.id) ? "opened" : "not_opened";
      const t = teamOf.get(r.a.personId);
      return {
        assignmentId: r.a.id,
        setId: r.a.setId,
        setTitle: r.title,
        personId: r.a.personId,
        personName: r.a.personName,
        label: labelOf(r.a.personId, r.a.personName),
        teamName: t ? (teamName.get(t) ?? null) : null,
        assignedAt: r.a.assignedAt,
        dueAt: r.a.dueAt,
        passedAt: r.a.passedAt,
        progress,
        attempts: n,
        inOrg: inOrg ? inOrg.has(r.a.personId) : null,
        endedAt: r.a.endedAt,
      };
    })
    .sort((a, b) => a.setTitle.localeCompare(b.setTitle, "th") || a.personName.localeCompare(b.personName, "th"));

  const stats = personMonthStats(
    filtered.map((r) => r.a),
    tried as StatAttempt[],
    month,
  ).map((s) => ({ ...s, label: labelOf(s.personId, s.personName), inOrg: inOrg ? inOrg.has(s.personId) : null }));

  const setsSeen = new Map(visible.map((r) => [r.a.setId, r.title]));
  const visiblePeople = new Set(visible.map((r) => r.a.personId));
  const managers = new Map<number, string>();
  for (const pid of visiblePeople) {
    const m = managerOf.get(pid);
    if (m) managers.set(m, people.find((p) => p.personId === m)?.name ?? `personId ${m}`);
  }
  const teams = new Map<number, string>();
  for (const pid of visiblePeople) {
    const t = teamOf.get(pid);
    if (t) teams.set(t, teamName.get(t) ?? `ทีม #${t}`);
  }
  const byName = <T extends { name?: string; title?: string }>(a: T, b: T) => (a.name ?? a.title ?? "").localeCompare(b.name ?? b.title ?? "", "th");
  return {
    scope: actor.role === "admin" ? "all" : "limited",
    orgOk: org.ok,
    people: stats,
    rows,
    hiddenPeople,
    hiddenRows: matching.length - filtered.length,
    teams: [...teams.entries()].map(([id, name]) => ({ id, name })).sort(byName),
    managers: [...managers.entries()].map(([personId, name]) => ({ personId, name })).sort(byName),
    sets: [...setsSeen.entries()].map(([id, title]) => ({ id, title })).sort(byName),
  };
}

export interface LeaderboardView {
  rows: WithOrgLabel<LeaderRow>[];
  /** ตัด TG ไม่ได้เพราะถาม WorkID ไม่ได้ — หน้าจอต้องบอก */
  tgExcluded: boolean;
  /** คนที่ไม่ติดอันดับเพราะซ่อน (ลาออก · ทุกการมอบที่สอบเป็นการมอบที่ตัดจบแล้วยังไม่ผ่าน) — 0 เมื่อ `showHidden` */
  hiddenPeople: number;
}

/** Leaderboard Top 10 ของเดือน (spec §12 · ADR-0009) — ทุกคนเห็น */
export async function monthLeaderboard(ym: string, opts: { showHidden?: boolean } = {}): Promise<LeaderboardView | null> {
  const month = bangkokMonthRange(ym);
  if (!month) return null;
  const tried = await db()
    .select({ assignmentId: attempts.assignmentId, kind: attempts.kind, startedAt: attempts.startedAt, endedAt: attempts.endedAt, scorePercent: attempts.scorePercent, leaveCount: attempts.leaveCount })
    .from(attempts)
    .where(lt(attempts.startedAt, month.end));
  if (!tried.length) return { rows: [], tgExcluded: true, hiddenPeople: 0 };
  const ids = [...new Set(tried.map((t) => t.assignmentId))];
  const all = await db().select().from(assignments).where(inArray(assignments.id, ids));
  const org = await fetchOrg();
  const inOrg = org.ok ? new Set(org.people.map((p) => p.personId)) : null;
  const as = opts.showHidden ? all : all.filter((a) => !hiddenFromLists(a, inOrg));
  const ranked = new Set(as.map((a) => a.personId));
  const hiddenPeople = new Set(all.filter((a) => !ranked.has(a.personId)).map((a) => a.personId)).size;
  const setIds = [...new Set(as.map((a) => a.setId))];
  const sets = await db()
    .select({ id: learningSets.id, authorPersonId: learningSets.authorPersonId, approverPersonId: learningSets.approverPersonId })
    .from(learningSets)
    .where(inArray(learningSets.id, setIds));
  const tg = await fetchRolePeople("admin");
  const labelOf = personLabelsFrom(org.ok ? org.people : []);
  const rows = leaderboard(as, tried as StatAttempt[], sets, month, new Set(tg.ok ? tg.personIds : [])).map((r) => ({ ...r, label: labelOf(r.personId, r.personName) }));
  return { rows, tgExcluded: tg.ok, hiddenPeople };
}

// ── Export ─────────────────────────────────────────────────────────────────

/** ค่าในไฟล์ CSV — ครอบด้วย `"` เมื่อมีจุลภาค/ขึ้นบรรทัด · กันสูตร Excel (ขึ้นต้น = + - @ tab CR) */
export function csvCell(v: string | number | null): string {
  if (v === null) return "";
  let s = String(v);
  // รวม tab และ CR ด้วย (OWASP) — บางโปรแกรมตัดช่องว่างหน้าแล้วตีความ `\t=...` เป็นสูตร
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  // BOM ให้ Excel อ่านภาษาไทยเป็น UTF-8
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
