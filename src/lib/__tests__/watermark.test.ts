import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { asciiOnly, watermarkPdf } from "@/lib/watermark";

describe("ลายน้ำ Pricelist (ADR-0010)", () => {
  it("อักษรที่ฟอนต์มาตรฐานวาดไม่ได้กลายเป็น ? ไม่ใช่ทำให้ล้ม", () => {
    expect(asciiOnly("สมชาย a@b.co")).toBe("????? a@b.co");
  });

  it("ประทับทุกหน้า · จำนวนหน้าเท่าเดิม", async () => {
    const src = await PDFDocument.create();
    src.addPage([600, 800]);
    src.addPage([800, 600]);
    const out = await watermarkPdf(await src.save(), ["WorkTrain · s@ws.co", "ID 31 · 01/11/2026 10:00"]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(out.length).toBeGreaterThan((await src.save()).length);
  });
});
