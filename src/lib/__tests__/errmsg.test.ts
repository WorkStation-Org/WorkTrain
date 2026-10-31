import { describe, expect, it } from "vitest";
import { causeChain, errorSummary, trimQueryNoise } from "@/lib/errmsg";

describe("errorSummary (กติกาเครือข้อ 23)", () => {
  it("เอาเหตุผลชั้นในสุดขึ้นก่อน ไม่ใช่คำสั่งที่ล้ม", () => {
    // รูปร่างจริงของ Drizzle + Neon: message ชั้นนอกคือ SQL ส่วนเหตุผลอยู่ใน cause
    const inner = Object.assign(new Error("insert or update violates foreign key"), {
      code: "23503",
      constraint: "tickets_category_id_fkey",
      detail: "Key (category_id)=(42) is not present in table \"categories\".",
    });
    const outer = new Error(
      'Failed query: insert into "tickets" (...) values ($1, $2)\n  params: abc,def',
      { cause: inner },
    );

    const summary = errorSummary(outer);
    expect(summary).toContain("foreign key");
    expect(summary).toContain("[23503]");
    expect(summary).toContain("tickets_category_id_fkey");
    expect(summary).toContain("category_id)=(42)");
    // params ต้องถูกตัด — ยาวจนกินที่ และมีข้อมูลผู้ใช้ปนอยู่
    expect(summary).not.toContain("params:");
  });

  it("ตอบเกณฑ์: อ่านแล้วรู้ว่าต้องไปแก้อะไร", () => {
    const summary = errorSummary(new Error("DATABASE_URL is not set"));
    expect(summary).toBe("DATABASE_URL is not set");
  });

  it("ไม่วนไม่รู้จบเมื่อ cause ชี้กลับมาหาตัวเอง", () => {
    const a = new Error("a");
    (a as { cause?: unknown }).cause = a;
    expect(() => errorSummary(a)).not.toThrow();
    expect(causeChain(a).length).toBe(1);
  });

  it("trimQueryNoise ตัดตั้งแต่ params เป็นต้นไป", () => {
    expect(trimQueryNoise("Failed query: select 1\n  params: secret")).toBe(
      "Failed query: select 1",
    );
  });
});
