import { describe, expect, it } from "vitest";
import { buildLayout, currentIndex, leaveForcesSubmit, needsRelearn, pickForm, score, shuffle } from "@/domain/exam";

/** rng ที่คาดเดาได้ — วนตามลำดับที่ให้ */
function seq(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("pickForm — ไม่ซ้ำจนกว่าจะครบ 5 ชุด (ADR-0003)", () => {
  const forms = [1, 2, 3, 4, 5];

  it("ครั้งแรกเลือกจากทุกชุด", () => {
    expect(pickForm(forms, [], seq(0))).toBe(1);
    expect(pickForm(forms, [], seq(0.99))).toBe(5);
  });

  it("ไม่ได้ชุดที่เคยได้ในรอบนี้", () => {
    for (const r of [0, 0.3, 0.6, 0.99]) expect([1, 2, 4]).not.toContain(pickForm(forms, [1, 2, 4], seq(r)));
  });

  it("ครบ 5 แล้ววนใหม่ได้ทุกชุด · รอบสองก็ไม่ซ้ำในรอบ", () => {
    expect(pickForm(forms, [1, 2, 3, 4, 5], seq(0))).toBe(1);
    expect(pickForm(forms, [1, 2, 3, 4, 5, 3], seq(0.5))).not.toBe(3);
  });
});

describe("buildLayout", () => {
  it("สลับข้อและตัวเลือก แต่ครบทุกข้อทุกตัวเลือก", () => {
    const qs = [1, 2, 3].map((id) => ({ id, choiceIds: [id * 10, id * 10 + 1, id * 10 + 2, id * 10 + 3] }));
    const layout = buildLayout(qs, seq(0.1, 0.7, 0.4, 0.9, 0.2));
    expect(layout.map((l) => l.questionId).sort()).toEqual([1, 2, 3]);
    for (const l of layout) expect([...l.choiceIds].sort()).toEqual(qs.find((q) => q.id === l.questionId)!.choiceIds);
  });

  it("shuffle ไม่แก้ของเดิม", () => {
    const a = [1, 2, 3];
    shuffle(a, seq(0));
    expect(a).toEqual([1, 2, 3]);
  });
});

describe("ตอบทีละข้อ · คะแนน", () => {
  const layout = [
    { questionId: 7, choiceIds: [70, 71] },
    { questionId: 8, choiceIds: [80, 81] },
    { questionId: 9, choiceIds: [90, 91] },
  ];
  const correct = new Map([
    [7, 71],
    [8, 80],
    [9, 90],
  ]);

  it("ข้อปัจจุบัน = ข้อแรกที่ยังไม่ตอบ · ครบแล้ว = null", () => {
    expect(currentIndex(layout, {})).toBe(0);
    expect(currentIndex(layout, { "7": 70 })).toBe(1);
    expect(currentIndex(layout, { "7": 70, "8": 80, "9": 91 })).toBeNull();
  });

  it("ปัดลง · ข้อที่ไม่ตอบนับผิด · คืนข้อที่ผิด", () => {
    expect(score(layout, { "7": 71, "8": 80 }, correct)).toEqual({ percent: 66, wrong: [9] });
    expect(score(layout, { "7": 71, "8": 80, "9": 90 }, correct)).toEqual({ percent: 100, wrong: [] });
  });
});

describe("กติกาอื่น (spec §10)", () => {
  it("ออกจากหน้าสอบครั้งที่ 1–4 เตือน · ครั้งที่ 5 ส่งเอง", () => {
    expect([1, 2, 3, 4, 5].map(leaveForcesSubmit)).toEqual([false, false, false, false, true]);
  });

  it("ไม่ผ่าน 2 ครั้งติด = ต้องอ่านใหม่ · ผ่านคั่นกลางนับใหม่", () => {
    expect(needsRelearn([false])).toBe(false);
    expect(needsRelearn([false, false])).toBe(true);
    expect(needsRelearn([false, true, false])).toBe(false);
    expect(needsRelearn([true, false, false])).toBe(true);
  });
});
