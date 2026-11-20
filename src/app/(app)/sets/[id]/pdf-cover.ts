import { COVER_WIDTH, MAX_COVER_BYTES } from "@/domain/document";

/**
 * ปก PDF อัตโนมัติ (ADR-0026) — วาดหน้าแรกด้วย pdfjs ในเบราว์เซอร์ของผู้สร้างเป็น JPEG กว้าง ≤ 640 px · ≤ 512 KB
 * แล้วส่งเข้าทางเดียวกับปกวิดีโอ (`saveCover` · `ms` = 0)
 *
 * ★ วาดในเบราว์เซอร์ เพราะ function ของ Vercel ไม่มี canvas (เหตุผลเดียวกับปกวิดีโอ · ADR-0013)
 * ★ ไฟล์ในเครื่อง (ตอนอัป) ส่งเป็น bytes · ไฟล์ที่อยู่บน R2 แล้วส่ง URL อายุสั้นจาก `previewLink` — bucket ต้องรับ GET แบบ CORS อยู่แล้ว (ตัวดู PDF ใช้ทางเดียวกัน)
 * ★ เปิดไม่ได้ = null — อัปต่อได้ แค่ไม่มีปก
 */
export async function capturePdfCover(source: { data: Uint8Array } | { url: string }): Promise<Blob | null> {
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const task = pdfjs.getDocument("data" in source ? { data: source.data } : { url: source.url });
    const pdf = await task.promise;
    try {
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: COVER_WIDTH / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      // พื้นขาว — PDF ที่ไม่มีพื้นหลังจะกลายเป็นสีดำใน JPEG
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport }).promise;
      for (const quality of [0.82, 0.6, 0.4]) {
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
        if (blob && blob.size <= MAX_COVER_BYTES) return blob;
      }
      return null;
    } finally {
      await task.destroy();
    }
  } catch {
    return null;
  }
}
