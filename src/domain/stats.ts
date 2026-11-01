/**
 * สถิติรายคนต่อเดือน + Leaderboard (spec §12 · ADR-0007 · ADR-0009) — ฟังก์ชันล้วน ไม่แตะฐาน
 *
 * ★ คะแนนครั้งแรก = ครั้งที่สอบชุดเต็ม (`full`) ครั้งแรกของการมอบนั้น · นับเข้าเดือนที่เริ่มสอบครั้งนั้น
 * ★ ความไว = เวลาตั้งแต่ได้รับมอบจนสอบผ่าน · นับเข้าเดือนที่ผ่าน
 * ★ Leaderboard ไม่นับชุดที่ตัวเองสร้างหรืออนุมัติ (รู้เฉลยอยู่แล้ว) · TG ไม่ติดอันดับ
 */

export interface StatAssignment {
  id: number;
  setId: number;
  personId: number;
  personName: string;
  assignedAt: Date;
  passedAt: Date | null;
}

export interface StatAttempt {
  assignmentId: number;
  kind: "full" | "delta";
  startedAt: Date;
  endedAt: Date | null;
  scorePercent: number | null;
  leaveCount: number;
}

export interface StatSet {
  id: number;
  authorPersonId: number;
  approverPersonId: number | null;
}

export interface PersonMonthStats {
  personId: number;
  personName: string;
  /** ได้รับมอบในเดือนนี้ */
  assigned: number;
  /** สอบผ่านในเดือนนี้ */
  passed: number;
  /** เฉลี่ยคะแนนครั้งแรกของการมอบที่สอบครั้งแรกในเดือนนี้ · null = ไม่มี */
  firstScore: number | null;
  /** เฉลี่ยทุกครั้งที่สอบชุดเต็มที่จบแล้วในเดือนนี้ */
  avgScore: number | null;
  attempts: number;
  /** ชั่วโมงเฉลี่ยตั้งแต่ได้รับมอบจนผ่าน ของการมอบที่ผ่านในเดือนนี้ · null = ไม่มี */
  speedHours: number | null;
  leaves: number;
}

const HOUR_MS = 60 * 60 * 1000;

const inRange = (d: Date | null, r: { start: Date; end: Date }) => d !== null && d >= r.start && d < r.end;
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/** ครั้งที่สอบชุดเต็มครั้งแรกของแต่ละการมอบ */
export function firstFullAttempts(attempts: readonly StatAttempt[]): Map<number, StatAttempt> {
  const first = new Map<number, StatAttempt>();
  for (const a of attempts) {
    if (a.kind !== "full") continue;
    const cur = first.get(a.assignmentId);
    if (!cur || a.startedAt < cur.startedAt) first.set(a.assignmentId, a);
  }
  return first;
}

/** สถิติรายคนของเดือน — เรียงตามชื่อ · คนที่ไม่มีอะไรในเดือนนั้นไม่ขึ้น */
export function personMonthStats(
  assignments: readonly StatAssignment[],
  attempts: readonly StatAttempt[],
  month: { start: Date; end: Date },
): PersonMonthStats[] {
  const byId = new Map(assignments.map((a) => [a.id, a]));
  const first = firstFullAttempts(attempts);
  const acc = new Map<number, { name: string; assigned: number; passed: number; first: number[]; all: number[]; attempts: number; speed: number[]; leaves: number }>();
  const get = (a: StatAssignment) => {
    let v = acc.get(a.personId);
    if (!v) acc.set(a.personId, (v = { name: a.personName, assigned: 0, passed: 0, first: [], all: [], attempts: 0, speed: [], leaves: 0 }));
    return v;
  };
  for (const a of assignments) {
    if (inRange(a.assignedAt, month)) get(a).assigned += 1;
    if (a.passedAt && inRange(a.passedAt, month)) {
      const v = get(a);
      v.passed += 1;
      v.speed.push((a.passedAt.getTime() - a.assignedAt.getTime()) / HOUR_MS);
    }
  }
  for (const t of attempts) {
    const a = byId.get(t.assignmentId);
    if (!a || !inRange(t.startedAt, month)) continue;
    const v = get(a);
    v.attempts += 1;
    v.leaves += t.leaveCount;
    if (t.kind === "full" && t.endedAt && t.scorePercent !== null) {
      v.all.push(t.scorePercent);
      if (first.get(a.id) === t) v.first.push(t.scorePercent);
    }
  }
  return [...acc.entries()]
    .map(([personId, v]) => ({
      personId,
      personName: v.name,
      assigned: v.assigned,
      passed: v.passed,
      firstScore: mean(v.first),
      avgScore: mean(v.all),
      attempts: v.attempts,
      speedHours: mean(v.speed),
      leaves: v.leaves,
    }))
    .sort((a, b) => a.personName.localeCompare(b.personName, "th") || a.personId - b.personId);
}

export interface LeaderRow {
  rank: number;
  personId: number;
  personName: string;
  firstScore: number;
  speedHours: number | null;
  sets: number;
}

export const LEADERBOARD_SIZE = 10;

/**
 * Top 10 ของเดือน — คะแนนครั้งแรกเฉลี่ยมากก่อน · เท่ากันใช้ความไว (น้อยก่อน · ไม่มี = ท้าย) · เท่ากันอีกได้อันดับเดียวกัน
 * ตัดก่อนคำนวณ: ชุดที่คนนั้นสร้างหรืออนุมัติ · คนใน `excludePersonIds` (TG)
 */
export function leaderboard(
  assignments: readonly StatAssignment[],
  attempts: readonly StatAttempt[],
  sets: readonly StatSet[],
  month: { start: Date; end: Date },
  excludePersonIds: ReadonlySet<number>,
  size = LEADERBOARD_SIZE,
): LeaderRow[] {
  const setOf = new Map(sets.map((s) => [s.id, s]));
  const eligible = assignments.filter((a) => {
    if (excludePersonIds.has(a.personId)) return false;
    const s = setOf.get(a.setId);
    return !s || (s.authorPersonId !== a.personId && s.approverPersonId !== a.personId);
  });
  const ids = new Set(eligible.map((a) => a.id));
  const stats = personMonthStats(
    eligible,
    attempts.filter((t) => ids.has(t.assignmentId)),
    month,
  );
  const first = firstFullAttempts(attempts.filter((t) => ids.has(t.assignmentId)));
  const setCount = new Map<number, number>();
  for (const a of eligible) {
    const f = first.get(a.id);
    if (f && f.endedAt && f.scorePercent !== null && inRange(f.startedAt, month)) setCount.set(a.personId, (setCount.get(a.personId) ?? 0) + 1);
  }
  const ranked = stats
    .filter((s): s is PersonMonthStats & { firstScore: number } => s.firstScore !== null)
    .sort(
      (a, b) =>
        b.firstScore - a.firstScore ||
        (a.speedHours ?? Infinity) - (b.speedHours ?? Infinity) ||
        a.personName.localeCompare(b.personName, "th"),
    );
  const rows: LeaderRow[] = [];
  ranked.forEach((s, i) => {
    const prev = ranked[i - 1];
    const tie = prev && prev.firstScore === s.firstScore && (prev.speedHours ?? Infinity) === (s.speedHours ?? Infinity);
    rows.push({
      rank: tie ? rows[i - 1]!.rank : i + 1,
      personId: s.personId,
      personName: s.personName,
      firstScore: s.firstScore,
      speedHours: s.speedHours,
      sets: setCount.get(s.personId) ?? 0,
    });
  });
  return rows.filter((r) => r.rank <= size);
}

/** ชั่วโมง → "2 วัน 3 ชม." · "45 นาที" */
export function formatSpeed(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} นาที`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return d ? `${d} วัน${h ? ` ${h} ชม.` : ""}` : `${h} ชม.`;
}
