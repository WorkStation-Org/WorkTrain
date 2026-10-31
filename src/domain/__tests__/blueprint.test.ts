import { describe, expect, it } from "vitest";
import {
  GENERAL_BLUEPRINT,
  PRODUCT_BLUEPRINT,
  QUESTIONS_PER_FORM,
  checkBlueprint,
  defaultBlueprint,
  slots,
  type Blueprint,
} from "@/domain/blueprint";

function byLevel(b: Blueprint) {
  const out: Record<string, number> = {};
  for (const c of b) out[c.level] = (out[c.level] ?? 0) + c.count;
  return out;
}

function byTopic(b: Blueprint) {
  const out: Record<string, number> = {};
  for (const c of b) out[c.topic] = (out[c.topic] ?? 0) + c.count;
  return out;
}

describe("แม่แบบตาม spec §3", () => {
  it("สินค้าใหม่ (PD): spec 3 · ราคา 3 · วัสดุ 2 · จับคู่ 2 · ระดับ จำ 4 · เข้าใจ 4 · สถานการณ์ 2", () => {
    expect(byTopic(PRODUCT_BLUEPRINT)).toEqual({ spec: 3, price: 3, material: 2, pairing: 2 });
    expect(byLevel(PRODUCT_BLUEPRINT)).toEqual({ recall: 4, understand: 4, scenario: 2 });
  });

  it("ทั่วไป: ระดับ จำ 4 · เข้าใจ 4 · สถานการณ์ 2", () => {
    expect(byLevel(GENERAL_BLUEPRINT)).toEqual({ recall: 4, understand: 4, scenario: 2 });
  });

  it("ทุกแม่แบบผ่านการตรวจของตัวเอง และได้ 10 ช่อง", () => {
    for (const b of [PRODUCT_BLUEPRINT, GENERAL_BLUEPRINT]) {
      expect(checkBlueprint(b).ok).toBe(true);
      expect(slots(b)).toHaveLength(QUESTIONS_PER_FORM);
    }
  });

  it("defaultBlueprint คืนสำเนา — แก้แล้วแม่แบบไม่เปลี่ยน", () => {
    const b = defaultBlueprint("product");
    b[0].count = 99;
    expect(PRODUCT_BLUEPRINT[0].count).toBe(2);
  });
});

describe("checkBlueprint", () => {
  it("รวมแถวซ้ำ และตัดแถวที่เป็น 0", () => {
    const r = checkBlueprint([
      { topic: "general", level: "recall", count: 3 },
      { topic: "general", level: "recall", count: 3 },
      { topic: "general", level: "scenario", count: 4 },
      { topic: "spec", level: "recall", count: 0 },
    ]);
    expect(r).toEqual({
      ok: true,
      blueprint: [
        { topic: "general", level: "recall", count: 6 },
        { topic: "general", level: "scenario", count: 4 },
      ],
    });
  });

  it("รวมไม่ได้ 10 → บอกจำนวนที่ได้", () => {
    expect(checkBlueprint([{ topic: "general", level: "recall", count: 9 }])).toEqual({ ok: false, error: "รวมต้องได้ 10 ข้อ (ตอนนี้ 9)" });
  });

  it("หัวข้อ/ระดับ/จำนวนผิด → ปฏิเสธ", () => {
    expect(checkBlueprint([{ topic: "x", level: "recall", count: 10 }]).ok).toBe(false);
    expect(checkBlueprint([{ topic: "spec", level: "hard", count: 10 }]).ok).toBe(false);
    expect(checkBlueprint([{ topic: "spec", level: "recall", count: 2.5 }]).ok).toBe(false);
    expect(checkBlueprint("10").ok).toBe(false);
  });
});
