import type { DocumentKind } from "@/db/schema";

/**
 * กติกาของเอกสารต้นทาง — ชนิดไฟล์ที่รับ · ขนาด · key ใน R2
 *
 * รุ่นที่ 1 รับ PDF (แคตตาล็อกเป็น PDF ภาพทั้งเล่ม — ตรวจจาก Signature V.1 · Progetto V.3) และ Excel (Pricelist)
 * ★ Claude อ่าน PDF ได้ตรง · Excel ต้องแปลงเป็นข้อความก่อนส่ง — รอตัวอย่าง Pricelist (spec §14)
 */
export const DOCUMENT_MIMES = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
} as const;
export type DocumentMime = keyof typeof DOCUMENT_MIMES;

export function isDocumentMime(mime: string | null | undefined): mime is DocumentMime {
  return typeof mime === "string" && Object.hasOwn(DOCUMENT_MIMES, mime);
}

/**
 * ไฟล์ละไม่เกิน 30 MB — แคตตาล็อกจริงใหญ่สุด 20 MB (Progetto V.3)
 * และคำขอหนึ่งครั้งของ Claude รับรวมได้ 32 MB · ใหญ่กว่านี้ต้องแยกส่งทีละไฟล์อยู่แล้ว
 */
export const MAX_DOCUMENT_BYTES = 30 * 1024 * 1024;

/** ชนิดเอกสารที่ AI อ่านได้ในรุ่นนี้ — Excel ยังไม่ได้ (รอตัวอย่าง Pricelist) */
export function aiReadable(mime: string): boolean {
  return mime === "application/pdf";
}

/** Pricelist ดาวน์โหลดไม่ได้ (ADR-0010) */
export function downloadable(kind: DocumentKind): boolean {
  return kind !== "pricelist";
}

/**
 * key ใน R2 — `sets/<setId>/v<versionNo>/<สุ่ม>.<นามสกุล>` · ไม่ใช้ชื่อไฟล์ของผู้ใช้ใน key
 * (ชื่อไทย / ช่องว่าง / `../` ไม่มีทางหลุดเข้า path) — ชื่อเดิมเก็บใน `documents.file_name`
 */
export function documentKey(setId: number, versionNo: number, mime: DocumentMime, random: string): string {
  if (!/^[a-z0-9]{16,}$/.test(random)) throw new Error("random ต้องเป็นตัวพิมพ์เล็ก/ตัวเลขอย่างน้อย 16 ตัว");
  return `sets/${setId}/v${versionNo}/${random}.${DOCUMENT_MIMES[mime]}`;
}
