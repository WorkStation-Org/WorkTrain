import { describe, expect, it } from "vitest";
import { formatSpeed, leaderboard, personMonthStats, type StatAssignment, type StatAttempt } from "@/domain/stats";
import { bangkokMonthRange } from "@/lib/time";

const NOV = bangkokMonthRange("2026-11")!;
const d = (s: string) => new Date(`${s}+07:00`);

function asg(id: number, personId: number, setId: number, assignedAt: string, passedAt: string | null = null, personName = `คน ${personId}`): StatAssignment {
  return { id, setId, personId, personName, assignedAt: d(assignedAt), passedAt: passedAt ? d(passedAt) : null };
}
function att(assignmentId: number, startedAt: string, scorePercent: number, extra: Partial<StatAttempt> = {}): StatAttempt {
  return { assignmentId, kind: "full", startedAt: d(startedAt), endedAt: d(startedAt), scorePercent, leaveCount: 0, ...extra };
}

describe("bangkokMonthRange", () => {
  it("ขอบเดือนตามเวลาไทย · ธ.ค. ข้ามปี · รูปผิด = null", () => {
    expect(NOV.start.getTime()).toBe(d("2026-11-01T00:00:00").getTime());
    expect(NOV.end.getTime()).toBe(d("2026-12-01T00:00:00").getTime());
    expect(bangkokMonthRange("2026-12")!.end.getTime()).toBe(d("2027-01-01T00:00:00").getTime());
    expect(bangkokMonthRange("2026-13")).toBeNull();
  });
});

describe("personMonthStats", () => {
  it("คะแนนครั้งแรก = ครั้งแรกของชุดเต็ม · เฉลี่ยทุกครั้ง · ความไว · ออกจากหน้าสอบ", () => {
    const as = [asg(1, 31, 100, "2026-11-02T09:00:00", "2026-11-03T09:00:00"), asg(2, 31, 101, "2026-10-28T09:00:00")];
    const ts = [
      att(1, "2026-11-02T10:00:00", 70, { leaveCount: 2 }),
      att(1, "2026-11-03T09:00:00", 90),
      att(2, "2026-11-05T09:00:00", 50, { kind: "delta" }),
      att(2, "2026-11-06T09:00:00", 60),
    ];
    expect(personMonthStats(as, ts, NOV)).toEqual([
      { personId: 31, personName: "คน 31", assigned: 1, passed: 1, firstScore: 65, avgScore: 73.3, attempts: 4, speedHours: 24, leaves: 2 },
    ]);
  });

  it("ครั้งแรกที่สอบเดือนก่อน ไม่นับเป็นคะแนนครั้งแรกของเดือนนี้", () => {
    const as = [asg(1, 31, 100, "2026-10-20T09:00:00")];
    const ts = [att(1, "2026-10-30T10:00:00", 40), att(1, "2026-11-02T10:00:00", 90)];
    expect(personMonthStats(as, ts, NOV)[0]).toMatchObject({ firstScore: null, avgScore: 90, attempts: 1 });
  });
});

describe("leaderboard", () => {
  const sets = [
    { id: 100, authorPersonId: 10, approverPersonId: 20 },
    { id: 101, authorPersonId: 31, approverPersonId: 20 },
  ];

  it("คะแนนครั้งแรกก่อน · เท่ากันใช้ความไว · ไม่นับชุดที่ตัวเองสร้าง/อนุมัติ · TG ไม่ติด", () => {
    const as = [
      asg(1, 31, 100, "2026-11-02T09:00:00", "2026-11-02T12:00:00"),
      asg(2, 32, 100, "2026-11-02T09:00:00", "2026-11-04T09:00:00"),
      asg(3, 33, 100, "2026-11-02T09:00:00"),
      asg(4, 31, 101, "2026-11-02T09:00:00"),
      asg(5, 20, 100, "2026-11-02T09:00:00"),
      asg(6, 1, 100, "2026-11-02T09:00:00"),
    ];
    const ts = [
      att(1, "2026-11-02T10:00:00", 90),
      att(2, "2026-11-03T10:00:00", 90),
      att(3, "2026-11-03T10:00:00", 100),
      att(4, "2026-11-03T10:00:00", 10),
      att(5, "2026-11-03T10:00:00", 100),
      att(6, "2026-11-03T10:00:00", 100),
    ];
    const rows = leaderboard(as, ts, sets, NOV, new Set([1]));
    expect(rows.map((r) => [r.rank, r.personId, r.firstScore])).toEqual([
      [1, 33, 100],
      [2, 31, 90],
      [3, 32, 90],
    ]);
  });

  it("เท่ากันทุกอย่าง = อันดับเดียวกัน · ตัดที่ 10", () => {
    const as = Array.from({ length: 12 }, (_, i) => asg(i + 1, 50 + i, 100, "2026-11-02T09:00:00"));
    const ts = as.map((a) => att(a.id, "2026-11-03T10:00:00", a.id === 1 ? 100 : 80));
    const rows = leaderboard(as, ts, sets, NOV, new Set());
    expect(rows[0]).toMatchObject({ rank: 1, personId: 50 });
    expect(rows.slice(1).every((r) => r.rank === 2)).toBe(true);
    expect(rows).toHaveLength(12);
    expect(leaderboard(as, ts, sets, NOV, new Set(), 1)).toHaveLength(1);
  });
});

describe("formatSpeed", () => {
  it("นาที · ชั่วโมง · วัน", () => {
    expect(formatSpeed(null)).toBe("—");
    expect(formatSpeed(0.5)).toBe("30 นาที");
    expect(formatSpeed(5)).toBe("5 ชม.");
    expect(formatSpeed(50)).toBe("2 วัน 2 ชม.");
  });
});
