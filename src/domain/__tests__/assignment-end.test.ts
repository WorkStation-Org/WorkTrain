import { describe, expect, it } from "vitest";
import { endGuardTripped, hiddenFromLists, hiddenReason, planEnds } from "@/domain/assignment-end";

const T = new Date("2026-11-16T09:00:00+07:00");
const row = (id: number, personId: number, o: { passed?: boolean; ended?: boolean; setId?: number } = {}) => ({
  id,
  setId: o.setId ?? 1,
  personId,
  passedAt: o.passed ? T : null,
  endedAt: o.ended ? T : null,
});

describe("planEnds — ตัดจบคนที่ไม่ตรงเงื่อนไข · เปิดใหม่คนที่กลับมาตรง", () => {
  const eligible = new Map([[1, new Set([31, 33])]]);
  const inOrg = new Set([31, 32, 33]);

  it("ไม่ตรงแล้ว: ยังอยู่ในผัง = not_in_audience · หายจากผัง = left_org · ผ่านแล้วก็ตัดจบ", () => {
    const plan = planEnds([row(1, 31), row(2, 32), row(3, 40), row(4, 32, { passed: true, setId: 1 })], eligible, inOrg);
    expect(plan.end).toEqual([
      { id: 2, reason: "not_in_audience" },
      { id: 3, reason: "left_org" },
      { id: 4, reason: "not_in_audience" },
    ]);
    expect(plan.reopen).toEqual([]);
  });

  it("ตัดจบแล้วกลับมาตรง = เปิดใหม่ (บอกว่าผ่านแล้วหรือยัง) · ตัดจบแล้วยังไม่ตรง = ไม่แตะ", () => {
    const plan = planEnds([row(1, 31, { ended: true }), row(2, 33, { ended: true, passed: true }), row(3, 32, { ended: true })], eligible, inOrg);
    expect(plan.reopen).toEqual([
      { id: 1, passed: false },
      { id: 2, passed: true },
    ]);
    expect(plan.end).toEqual([]);
  });

  it("ชุดที่ไม่มีใครตรงเลย = ตัดจบทุกการมอบที่ยังเปิด", () => {
    expect(planEnds([row(1, 31, { setId: 9 })], eligible, inOrg).end).toEqual([{ id: 1, reason: "not_in_audience" }]);
  });
});

describe("endGuardTripped — เกิน 20 การมอบ หรือเกิน 10% ของที่ยังเปิดอยู่", () => {
  it("ตัวเลขใดถึงก่อน", () => {
    expect(endGuardTripped(5, 100)).toBe(false);
    expect(endGuardTripped(10, 100)).toBe(false);
    expect(endGuardTripped(11, 100)).toBe(true);
    expect(endGuardTripped(20, 1000)).toBe(false);
    expect(endGuardTripped(21, 1000)).toBe(true);
  });
});

describe("hiddenFromLists — ซ่อนไปรวมในบรรทัด 'ซ่อน n คน · แสดง'", () => {
  const inOrg = new Set([31]);

  it("ลาออกซ่อนเสมอ (แม้ผ่านแล้ว) · ตัดจบที่ยังไม่ผ่านซ่อน · ตัดจบที่ผ่านแล้วยังแสดง", () => {
    expect(hiddenFromLists(row(1, 40, { passed: true }), inOrg)).toBe(true);
    expect(hiddenFromLists(row(1, 31, { ended: true }), inOrg)).toBe(true);
    expect(hiddenFromLists(row(1, 31, { ended: true, passed: true }), inOrg)).toBe(false);
    expect(hiddenFromLists(row(1, 31), inOrg)).toBe(false);
  });

  it("ถามผังไม่ได้ (null) — ไม่ซ่อนเพราะไม่อยู่ในผัง · ตัดจบที่บันทึกไว้ยังซ่อน", () => {
    expect(hiddenFromLists(row(1, 40), null)).toBe(false);
    expect(hiddenFromLists(row(1, 40, { ended: true }), null)).toBe(true);
  });

  it("hiddenReason บอกเหตุสั้น ๆ", () => {
    expect(hiddenReason({ personId: 40, endedAt: null, endReason: null }, inOrg)).toBe("ไม่อยู่ในผังแล้ว");
    expect(hiddenReason({ personId: 31, endedAt: T, endReason: "not_in_audience" }, inOrg)).toBe("ไม่ตรงเงื่อนไขผู้รับแล้ว");
    expect(hiddenReason({ personId: 31, endedAt: T, endReason: "left_org" }, null)).toBe("ไม่อยู่ในผังแล้ว");
  });
});
