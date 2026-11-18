import { describe, expect, it } from "vitest";
import { displayFileName, videoCredit } from "@/domain/document";

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

describe("videoCredit — งบช่วงวิดีโอของรอบเรียน (ADR-0020)", () => {
  const t = (s: number) => new Date(Date.UTC(2026, 10, 18, 2, 0, s));
  it("เริ่มด้วยงบเต็ม 12 ช่วง · ใช้แล้วเติมช่วงละ 5 วินาทีจริง · สะสมไม่เกิน 60 วินาที", () => {
    const first = videoCredit(null, t(0), 99);
    expect(first.granted).toBe(12);
    expect(videoCredit(first.creditUntil, t(0), 5).granted).toBe(0);
    expect(videoCredit(first.creditUntil, t(15), 5).granted).toBe(3);
    // ไม่ได้ใช้นาน ๆ ก็ได้แค่ 12
    expect(videoCredit(first.creditUntil, t(600), 99).granted).toBe(12);
  });
  it("ขอน้อยกว่างบ = ได้เท่าที่ขอ เหลือไว้ใช้ต่อ", () => {
    const a = videoCredit(null, t(0), 2);
    expect(a.granted).toBe(2);
    expect(videoCredit(a.creditUntil, t(0), 99).granted).toBe(10);
  });
});
