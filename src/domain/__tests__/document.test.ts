import { describe, expect, it } from "vitest";
import { displayFileName } from "@/domain/document";

describe("displayFileName — ชื่อที่ผู้เรียนเห็นไม่ติดนามสกุลไฟล์", () => {
  it("ตัดนามสกุลของชนิดที่ระบบรับ ไม่สนตัวพิมพ์", () => {
    expect(displayFileName("EP1 7 ขั้นการขาย หาลีด เตรียมตัว.mp4")).toBe("EP1 7 ขั้นการขาย หาลีด เตรียมตัว");
    expect(displayFileName("Signature V.3.PDF")).toBe("Signature V.3");
    expect(displayFileName(" Pricelist Q4.xlsx ")).toBe("Pricelist Q4");
  });

  it("ไม่แตะจุดที่ไม่ใช่นามสกุลที่ระบบรับ", () => {
    expect(displayFileName("ราคา v1.2")).toBe("ราคา v1.2");
    expect(displayFileName("คลิป.mov")).toBe("คลิป.mov");
    expect(displayFileName("ชื่อที่แก้เองแล้ว")).toBe("ชื่อที่แก้เองแล้ว");
  });

  it("ตัดแล้วว่าง = ชื่อเดิม", () => {
    expect(displayFileName(".pdf")).toBe(".pdf");
  });
});
