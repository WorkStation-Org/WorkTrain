import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";

/**
 * ลายน้ำของ Pricelist (spec §13 · ADR-0010) — ประทับลงในไฟล์ฝั่งเซิร์ฟเวอร์ทุกหน้า ก่อนส่งให้เบราว์เซอร์
 * เบราว์เซอร์จึงไม่เคยได้ไฟล์ต้นฉบับ · ถ่ายหน้าจอหรือบันทึกไฟล์ไปก็ติดตัวตนของคนเปิดไปด้วย
 *
 * ★ ฟอนต์มาตรฐานของ PDF ไม่มีอักษรไทย — ในไฟล์ใช้อีเมล + รหัส + เวลา (ASCII) ซึ่งระบุตัวคนได้ครบ
 *   ชื่อภาษาไทยซ้อนบนหน้าจออีกชั้นที่ตัวอ่าน (reader.tsx)
 */

/** เหลือแค่อักษรที่ฟอนต์ Helvetica วาดได้ — ตัวอื่นเป็น `?` ไม่ใช่ทำให้ทั้งไฟล์ล้ม */
export function asciiOnly(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "?");
}

export async function watermarkPdf(bytes: Uint8Array, lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const text = lines.map(asciiOnly);
  const color = rgb(0.75, 0.1, 0.1);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(10, Math.min(width, height) / 30);
    // แนวทแยงซ้ำทั่วหน้า — ตัดมุมไหนออกก็ยังเหลือ
    const stepY = size * 9;
    const stepX = size * 22;
    for (let y = -height; y < height * 2; y += stepY) {
      for (let x = -width; x < width * 2; x += stepX) {
        text.forEach((t, i) => {
          page.drawText(t, { x, y: y - i * size * 1.3, size, font, color, opacity: 0.13, rotate: degrees(30) });
        });
      }
    }
    // บรรทัดล่างแนวนอนอ่านง่าย
    page.drawText(text.join("  ·  "), { x: 12, y: 10, size: Math.max(7, size * 0.6), font, color, opacity: 0.6 });
  }
  return doc.save();
}
