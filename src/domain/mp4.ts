/**
 * ความยาววิดีโอจากหัวไฟล์ MP4 (ADR-0013) — อ่านทีละช่วงสั้น ๆ ไม่โหลดทั้งไฟล์ 2 GB เข้าหน่วยความจำ
 *
 * โครง MP4 (ISO BMFF): กล่องเรียงกัน `[size u32][type 4 ตัว]` · size = 1 → ขนาดจริงเป็น u64 ต่อท้าย · size = 0 → ยาวถึงท้ายไฟล์
 * กล่องแรกต้องเป็น `ftyp` · ความยาวอยู่ใน `moov` → `mvhd` (timescale + duration) · `moov` อาจอยู่ท้ายไฟล์หลัง `mdat`
 *
 * ★ เซิร์ฟเวอร์ตัดสินความยาวจากไฟล์จริง (เหมือนนับหน้า PDF) — ไม่เชื่อค่าที่เบราว์เซอร์บอก
 * ★ MP4 แบบ fragmented (duration ใน mvhd = 0) ไม่รับ — ความยาวกระจายอยู่ใน moof ทั้งไฟล์
 */

/** อ่าน `length` byte เริ่มที่ `start` — ได้น้อยกว่าที่ขอเมื่อชนท้ายไฟล์ · `null` = ไม่มีไฟล์ */
export type RangeReader = (start: number, length: number) => Promise<Uint8Array | null>;

interface Box {
  type: string;
  start: number;
  headerSize: number;
  size: number;
}

/** กล่องสูงสุดที่ไล่ดูต่อชั้น — ไฟล์ปกติมีไม่กี่กล่อง · กันไฟล์ประสงค์ร้ายที่มีกล่องเล็ก ๆ เป็นล้าน */
const MAX_BOXES_PER_LEVEL = 64;

function u32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
}

function u64(b: Uint8Array, at: number): number {
  return u32(b, at) * 2 ** 32 + u32(b, at + 4);
}

function typeOf(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
}

async function readBox(read: RangeReader, at: number, end: number): Promise<Box | null> {
  if (end - at < 8) return null;
  const h = await read(at, 16);
  if (!h || h.length < 8) return null;
  let size = u32(h, 0);
  let headerSize = 8;
  if (size === 1) {
    if (h.length < 16) return null;
    size = u64(h, 8);
    headerSize = 16;
  } else if (size === 0) {
    size = end - at;
  }
  if (size < headerSize || at + size > end) return null;
  return { type: typeOf(h, 4), start: at, headerSize, size };
}

/** กล่องลูกชนิด `type` ในช่วง `[from, to)` */
async function findBox(read: RangeReader, from: number, to: number, type: string): Promise<Box | null> {
  let at = from;
  for (let i = 0; i < MAX_BOXES_PER_LEVEL && at < to; i++) {
    const box = await readBox(read, at, to);
    if (!box) return null;
    if (box.type === type) return box;
    at += box.size;
  }
  return null;
}

/** ความยาวเป็นวินาที · `null` = ไม่ใช่ MP4 · ไฟล์เสีย · หรือหาความยาวไม่ได้ */
export async function mp4DurationSeconds(read: RangeReader, fileSize: number): Promise<number | null> {
  try {
    const first = await readBox(read, 0, fileSize);
    if (!first || first.type !== "ftyp") return null;
    const moov = await findBox(read, 0, fileSize, "moov");
    if (!moov) return null;
    const mvhd = await findBox(read, moov.start + moov.headerSize, moov.start + moov.size, "mvhd");
    if (!mvhd) return null;
    const body = await read(mvhd.start + mvhd.headerSize, 32);
    if (!body || body.length < 20) return null;
    const version = body[0];
    let timescale: number;
    let duration: number;
    if (version === 1) {
      if (body.length < 32) return null;
      timescale = u32(body, 20);
      duration = u64(body, 24);
    } else if (version === 0) {
      timescale = u32(body, 12);
      duration = u32(body, 16);
    } else {
      return null;
    }
    // 0xFFFFFFFF = "ไม่รู้ความยาว" ตามมาตรฐาน
    if (!timescale || !duration || (version === 0 && duration === 0xffffffff)) return null;
    const seconds = duration / timescale;
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}
