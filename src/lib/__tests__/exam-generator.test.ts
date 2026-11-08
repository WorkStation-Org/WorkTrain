import { describe, expect, it } from "vitest";
import { GENERAL_BLUEPRINT, slots } from "@/domain/blueprint";
import { checkForms, checkQuestion, claudeExamModel, topicCodes, type GeneratedQuestion } from "@/lib/exam-generator";

/** ผลของ AI ไม่ถูกเชื่อตรง ๆ — ตรวจรูปก่อนลงฐานทุกครั้ง */

const ok: GeneratedQuestion = {
  topic: "general",
  level: "recall",
  text: "คำถาม",
  choices: ["ก", "ข", "ค", "ง"],
  correctIndex: 1,
  sourceRef: "a.pdf หน้า 1",
};

function forms(n: number) {
  let i = 0;
  return Array.from({ length: n }, () => slots(GENERAL_BLUEPRINT).map((s) => ({ ...ok, ...s, text: `ข้อ ${++i}` })));
}

describe("checkQuestion", () => {
  it("ข้อที่ถูกรูป → null", () => expect(checkQuestion(ok)).toBeNull());
  it("ตัวเลือกไม่ครบ 4 / ซ้ำ / ว่าง / เฉลยนอกช่วง / ไม่มีที่มา → บอกเหตุ", () => {
    expect(checkQuestion({ ...ok, choices: ["ก", "ข", "ค"] })).toMatch(/4 ตัวเลือก/);
    expect(checkQuestion({ ...ok, choices: ["ก", "ก", "ค", "ง"] })).toMatch(/ซ้ำ/);
    expect(checkQuestion({ ...ok, choices: ["ก", "", "ค", "ง"] })).toMatch(/ว่าง/);
    expect(checkQuestion({ ...ok, correctIndex: 4 })).toMatch(/เฉลย/);
    expect(checkQuestion({ ...ok, sourceRef: "" })).toMatch(/ที่มา/);
  });
});

describe("checkForms", () => {
  it("5 ชุดครบสัดส่วน คำถามไม่ซ้ำ → null", () => expect(checkForms(forms(5), GENERAL_BLUEPRINT, 5)).toBeNull());

  it("จำนวนชุดไม่ครบ", () => expect(checkForms(forms(4), GENERAL_BLUEPRINT, 5)).toMatch(/ต้องได้ 5 ชุด/));

  it("หัวข้อ/ระดับไม่ตรง blueprint (ลำดับไม่สำคัญ)", () => {
    const f = forms(5);
    f[2][0] = { ...f[2][0], level: "scenario" };
    expect(checkForms(f, GENERAL_BLUEPRINT, 5)).toMatch(/ชุดที่ 3/);
    const shuffled = forms(5).map((q) => [...q].reverse());
    expect(checkForms(shuffled, GENERAL_BLUEPRINT, 5)).toBeNull();
  });

  it("คำถามซ้ำข้ามชุด (ไม่สนช่องว่าง/ตัวพิมพ์)", () => {
    const f = forms(5);
    f[4][9] = { ...f[4][9], text: `  ${f[0][0].text.toUpperCase()} ` };
    expect(checkForms(f, GENERAL_BLUEPRINT, 5)).toMatch(/ซ้ำกับชุดอื่น/);
  });
});

describe("claudeExamModel", () => {
  it("ไม่มี ANTHROPIC_API_KEY และไม่ได้ส่ง client → null (หน้าจอบอกว่ายังไม่ได้ตั้ง)", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(claudeExamModel()).toBeNull();
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe("topicCodes — หัวข้อที่ TG ตั้งส่งให้ AI เป็นรหัสสั้น (ADR-0011)", () => {
  const t = topicCodes(["กฎความปลอดภัย", "อุปกรณ์ป้องกัน"]);

  it("รหัสตามลำดับ และแปลงกลับได้ (ตัดช่องว่างที่ AI เติม)", () => {
    expect(t.code("อุปกรณ์ป้องกัน")).toBe("T2");
    expect(t.decode(" T1 ")).toBe("กฎความปลอดภัย");
  });

  it("รหัสที่ไม่รู้จักคืนค่าเดิม → checkForms ปฏิเสธเพราะไม่ตรงช่อง", () => {
    expect(t.decode("T9")).toBe("T9");
    const blueprint = [{ topic: "กฎความปลอดภัย", level: "recall" as const, count: 10 }];
    const bad = Array.from({ length: 5 }, (_, f) =>
      Array.from({ length: 10 }, (_, i) => ({ ...ok, topic: t.decode(i === 0 ? "T9" : "T1"), text: `ชุด ${f} ข้อ ${i}` })),
    );
    expect(checkForms(bad, blueprint, 5)).toMatch(/ไม่ตรงกับสัดส่วน/);
  });
});
