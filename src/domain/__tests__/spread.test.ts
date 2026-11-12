import { describe, expect, it } from "vitest";
import { coverage, sourceDocIndex, spreadPlan } from "@/domain/spread";

/** เฉลี่ยข้อสอบตามไฟล์ — 5 ชุด × 10 ข้อ */

const sumRow = (r: number[]) => r.reduce((a, b) => a + b, 0);
const totals = (plan: number[][]) => plan[0].map((_, i) => plan.reduce((n, f) => n + f[i], 0));

describe("spreadPlan", () => {
  it("10 ไฟล์ → ไฟล์ละ 1 ข้อทุกชุด", () => {
    const plan = spreadPlan(new Array(10).fill(1), 10, 5);
    expect(plan).toHaveLength(5);
    for (const f of plan) expect(f).toEqual(new Array(10).fill(1));
  });

  it("5 ไฟล์ → ไฟล์ละ 2 ข้อทุกชุด", () => {
    for (const f of spreadPlan([1, 1, 1, 1, 1], 10, 5)) expect(f).toEqual([2, 2, 2, 2, 2]);
  });

  it("4 ไฟล์ → ทุกชุด 10 ข้อพอดี · ไฟล์ละ 12–13 ข้อรวม · ต่อชุดต่างกันไม่เกิน 1", () => {
    const plan = spreadPlan([1, 1, 1, 1], 10, 5);
    for (const f of plan) expect(sumRow(f)).toBe(10);
    expect(totals(plan).sort()).toEqual([12, 12, 13, 13]);
    for (let i = 0; i < 4; i++) {
      const per = plan.map((f) => f[i]);
      expect(Math.max(...per) - Math.min(...per)).toBeLessThanOrEqual(1);
    }
  });

  it("น้ำหนัก: 2 ได้สองเท่าของ 1 · 0 ไม่ได้เลย · ทั้งหมด 0 = เท่ากัน", () => {
    expect(totals(spreadPlan([2, 1, 1, 0], 10, 5))).toEqual([25, 13, 12, 0]);
    expect(totals(spreadPlan([0, 0], 10, 5))).toEqual([25, 25]);
  });

  it("ไฟล์มากกว่า 10 → บางชุดไม่ได้บางไฟล์ แต่รวมเท่ากันและทุกชุดได้ 10 ข้อ", () => {
    const plan = spreadPlan(new Array(25).fill(1), 10, 5);
    for (const f of plan) expect(sumRow(f)).toBe(10);
    expect(new Set(totals(plan))).toEqual(new Set([2]));
  });

  it("ไม่มีไฟล์ → ชุดว่าง", () => {
    expect(spreadPlan([], 10, 5)).toEqual([[], [], [], [], []]);
  });
});

describe("coverage", () => {
  const files = ["Signature V.3.pdf", "Signature.pdf", "Pricelist Q4.pdf"];

  it("จับไฟล์จากที่มา — มี/ไม่มีนามสกุล · ชื่อยาวสุดชนะ · ไม่รู้ = -1", () => {
    expect(sourceDocIndex("Signature V.3.pdf หน้า 5", files)).toBe(0);
    expect(sourceDocIndex("signature หน้า 2", files)).toBe(1);
    expect(sourceDocIndex("Pricelist Q4 แถว 12", files)).toBe(2);
    expect(sourceDocIndex("คู่มือ หน้า 1", files)).toBe(-1);
  });

  it("นับต่อชุดต่อไฟล์ + ข้อที่ไม่รู้ที่มา", () => {
    const out = coverage(
      [
        [{ sourceRef: "Signature V.3.pdf หน้า 1" }, { sourceRef: "Pricelist Q4.pdf แถว 2" }],
        [{ sourceRef: "อื่น ๆ" }],
      ],
      files,
    );
    expect(out.counts).toEqual([
      [1, 0, 1],
      [0, 0, 0],
    ]);
    expect(out.unknown).toEqual([0, 1]);
  });
});
