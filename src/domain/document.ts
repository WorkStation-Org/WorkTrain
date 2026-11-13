import type { DocumentKind } from "@/db/schema";

/**
 * กติกาของเอกสารต้นทาง — ชนิดไฟล์ที่รับ · ขนาด · key ใน R2
 *
 * รุ่นที่ 1 รับ PDF (แคตตาล็อกเป็น PDF ภาพทั้งเล่ม — ตรวจจาก Signature V.1 · Progetto V.3) และ Excel (Pricelist)
 * และวิดีโอ MP4 (ADR-0013 · ดูได้อย่างเดียว · AI ไม่ดูวิดีโอ — ข้อสอบออกจาก PDF ในชุดเดียวกัน)
 * ★ Claude อ่าน PDF ได้ตรง · Excel ต้องแปลงเป็นข้อความก่อนส่ง — รอตัวอย่าง Pricelist (spec §14)
 */
export const DOCUMENT_MIMES = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "video/mp4": "mp4",
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

/**
 * วิดีโอไฟล์ละไม่เกิน 2 GB (ADR-0013) — 2,000,000,000 byte ไม่ใช่ 2 GiB เพราะ `documents.size_bytes` เป็น int4
 * (สูงสุด 2,147,483,647) · R2 รับ PUT ก้อนเดียวได้ถึง 5 GB จึงไม่ต้องแบ่งอัป
 */
export const MAX_VIDEO_BYTES = 2_000_000_000;

/** วิดีโอยาวเกินนี้ถือว่าไฟล์ผิด — กันค่าความยาวเพี้ยนจากหัวไฟล์ทำให้จำนวนช่วงล้น smallint */
export const MAX_VIDEO_SECONDS = 10 * 60 * 60;

export function isVideoMime(mime: string | null | undefined): boolean {
  return mime === "video/mp4";
}

/** ขนาดสูงสุดของไฟล์ชนิดนี้ */
export function maxBytesFor(mime: DocumentMime): number {
  return isVideoMime(mime) ? MAX_VIDEO_BYTES : MAX_DOCUMENT_BYTES;
}

/** ขนาดไฟล์สำหรับข้อความบนจอ — `2 GB` · `30 MB` */
export function formatBytesLimit(bytes: number): string {
  return bytes >= 1_000_000_000 ? `${bytes / 1_000_000_000} GB` : `${bytes / 1024 / 1024} MB`;
}

/**
 * วิดีโอแบ่งเป็นช่วงละ 10 วินาที — ช่วงหนึ่งนับเหมือน PDF หนึ่งหน้า (`page_count` = จำนวนช่วง · `pages_seen` = ช่วงที่เล่นผ่านแล้ว)
 * จึงใช้ความคืบหน้า · "อ่านครบ" · รอบเรียน · อ่านใหม่หลังสอบตก ร่วมกับ PDF ได้ทั้งหมด
 */
export const VIDEO_SEGMENT_SECONDS = 10;

export function videoSegmentCount(durationSeconds: number): number {
  return Math.max(1, Math.ceil(durationSeconds / VIDEO_SEGMENT_SECONDS));
}

/** ช่วงที่ต้องเล่นผ่านกี่วินาทีจึงนับ — 80% ของความยาวช่วงนั้น (ช่วงสุดท้ายอาจสั้นกว่า 10 วินาที) */
export function segmentWatchTarget(segment: number, durationSeconds: number): number {
  const start = (segment - 1) * VIDEO_SEGMENT_SECONDS;
  const length = Math.max(0, Math.min(VIDEO_SEGMENT_SECONDS, durationSeconds - start));
  return length * 0.8;
}

/** ความเร็วเล่นสูงสุดที่ตัวเล่นยอม — เร็วกว่านี้ถูกดึงกลับ */
export const MAX_VIDEO_PLAYBACK_RATE = 2;

/**
 * ช่วงใหม่ที่รับได้ในหนึ่ง heartbeat — เล่นเร็วสุด 2 เท่าใน `activeSeconds` วินาทีเล่นผ่านได้ไม่เกินนี้ (+1 ช่วงที่ค้างจากรอบก่อน)
 * ★ เซิร์ฟเวอร์ตัดสิน: เบราว์เซอร์ที่ส่งช่วงมาทั้งเรื่องในครั้งเดียวไม่ได้ดูครบ
 */
export function maxNewSegments(activeSeconds: number): number {
  return Math.ceil((Math.max(0, activeSeconds) * MAX_VIDEO_PLAYBACK_RATE) / VIDEO_SEGMENT_SECONDS) + 1;
}

/**
 * ปกวิดีโอ (ADR-0013) — เบราว์เซอร์ของผู้สร้างจับเฟรมจากคลิปเป็น JPEG กว้างไม่เกิน 640 px แล้วส่งผ่าน server action
 * ไฟล์จริงราว 30–80 KB · จำกัด 512 KB ให้ต่ำกว่าเพดาน body ของ server action (1 MB)
 */
/** ไฟล์ Template ข้อสอบที่ Import (ADR-0015) — server action รับได้ไม่เกิน 1 MB (ค่าตั้งต้นของ Next) · 50 ข้อจริงไม่ถึง 100 KB */
export const MAX_EXAM_SHEET_BYTES = 900 * 1024;

export const MAX_COVER_BYTES = 512 * 1024;
export const COVER_WIDTH = 640;

/** JPEG ขึ้นต้นด้วย FF D8 FF เสมอ — ไม่เชื่อ Content-Type ที่เบราว์เซอร์บอก */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** key ของปก — อยู่ข้างไฟล์วิดีโอ · สุ่มใหม่ทุกครั้งที่เปลี่ยนปก (ปกเก่าถูกลบ · cache ของปกเก่าไม่ค้าง) */
export function coverKey(videoKey: string, random: string): string {
  if (!/^[a-z0-9]{16,}$/.test(random)) throw new Error("random ต้องเป็นตัวพิมพ์เล็ก/ตัวเลขอย่างน้อย 16 ตัว");
  return `${videoKey.replace(/\.mp4$/, "")}-cover-${random}.jpg`;
}

/** `12:05` · `1:02:05` */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** ชนิดเอกสารที่ AI อ่านได้ในรุ่นนี้ — Excel ยังไม่ได้ (รอตัวอย่าง Pricelist) */
export function aiReadable(mime: string): boolean {
  return mime === "application/pdf";
}

/**
 * ชื่อชนิดเอกสารบนจอ — ค่าในฐานยังเป็น `catalog` (มาจากชุดสินค้า) แต่ WorkTrain ใช้กับการเรียนรู้ทุกเรื่อง
 * จึงเรียกกลาง ๆ ว่า "เอกสารหลัก" (คู่มือ · ขั้นตอน · แคตตาล็อก ฯลฯ)
 */
export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  catalog: "เอกสารหลัก",
  pricelist: "Pricelist",
  other: "อื่น ๆ",
};

/** Pricelist ต้องเป็นเอกสาร (ประทับลายน้ำทุกหน้า · ADR-0010) — ไม่รับวิดีโอ */
export function kindAllowsMime(kind: DocumentKind, mime: DocumentMime): boolean {
  return !(kind === "pricelist" && isVideoMime(mime));
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
