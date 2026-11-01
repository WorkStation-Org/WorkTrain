/**
 * เวลาไทย — **ไฟล์เดียวในระบบที่ได้รับอนุญาตให้แปลงวันที่**
 *
 * ★ กติกาเครือข้อ 15 (WS-Strategy/MASTER-ARCHITECTURE.md §2):
 *   runtime เป็น UTC เสมอและตั้งทับไม่ได้ — **Vercel สงวนชื่อ env `TZ`**
 *   ทุกจุดที่คิดวันที่ต้องระบุ `Asia/Bangkok` เอง
 *
 *   ของจริง 11 ส.ค. 2026 ใน WorkDoc: ใช้ `toISOString()` ลงวันที่บนเอกสารที่พิมพ์ออกกระดาษ
 *   → ช่วง **00:00–07:00 ไทย UTC ยังเป็นเมื่อวาน** เอกสารจึงลงวันที่ย้อนหลัง 1 วัน
 *   **และทีมบัญชีทำงานตอนเช้าพอดี** · เทสต์เดิมพิสูจน์ว่าฟังก์ชันเวลาไทยถูก
 *   แต่ไม่ได้ห้ามใครเลี่ยงไปเรียก UTC ตรง ๆ
 *
 *   → `__tests__/no-utc-dates.test.ts` จึงล้มทันทีถ้ามีไฟล์อื่นใน `src/` เรียก `toISOString()`
 *     แก้ที่นี่ที่เดียว อย่าเขียนตัวแปลงซ้ำที่อื่น
 */

export const BANGKOK = "Asia/Bangkok";

/** `YYYY-MM-DD` ตามปฏิทินไทย — en-CA ให้รูปแบบนี้มาตรง ๆ ไม่ต้องประกอบเอง */
export function bangkokDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BANGKOK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export interface BangkokParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function bangkokParts(d: Date = new Date()): BangkokParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BANGKOK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // en-GB คืนเที่ยงคืนเป็น "24" ในบางรุ่นของ ICU — normalize ให้เป็น 0
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

/** `08/09/2026 14:36` — ใช้บนหน้าจอและในข้อความ LINE */
export function formatBangkok(d: Date): string {
  const p = bangkokParts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * `"2026-09-14"` (วันตามปฏิทินไทย) → **ช่วงเวลาจริงของเที่ยงคืนวันนั้นที่กรุงเทพฯ**
 *
 * ใช้ทำขอบของตัวกรองช่วงวันที่: ผู้ใช้พิมพ์ "14 ก.ย." แล้วหมายถึง 14 ก.ย. **เวลาไทย**
 * ไม่ใช่ UTC · ถ้าเทียบด้วย `new Date("2026-09-14")` เฉย ๆ (ซึ่งคือเที่ยงคืน UTC)
 * เคสที่แจ้ง 06:00 น. เวลาไทยของวันที่ 14 จะถูกนับเป็นวันที่ 13 — **หายไปจากผลกรอง
 * ทุกเช้า** ซึ่งเป็นอาการเดียวกับข้อ 15 ทุกประการ
 *
 * ★ ต่อ `+07:00` ตรง ๆ ได้เพราะประเทศไทย**ไม่มี DST และไม่เคยเปลี่ยน offset**
 *   (ถ้าวันหนึ่งมีเขตเวลาที่ขยับ ต้องเลิกใช้ท่านี้ ไม่ใช่แก้ตัวเลข)
 *
 * คืน `null` เมื่อรูปแบบไม่ใช่ `YYYY-MM-DD` — **ไม่เดา** เพราะค่าที่เดาผิดจะกลายเป็น
 * ตัวกรองที่ตัดข้อมูลทิ้งเงียบ ๆ โดยที่หน้าจอดูปกติทุกอย่าง
 */
export function bangkokDayStart(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd.trim())) return null;
  const d = new Date(`${ymd.trim()}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** เที่ยงคืนของ **วันถัดไป** — ใช้เป็นขอบบนแบบ `<` เพื่อให้รวมทั้งวันที่ผู้ใช้เลือก */
export function bangkokDayEnd(ymd: string): Date | null {
  const start = bangkokDayStart(ymd);
  return start ? new Date(start.getTime() + 86_400_000) : null;
}

/**
 * อายุเคสเป็นวัน นับตามปฏิทินไทย (ไม่ใช่ 24 ชม.)
 *
 * เคสที่เปิด 23:00 แล้วดูตอน 01:00 อีกวัน = 1 วัน ไม่ใช่ 0 — ตรงกับที่คนพูดกันว่า
 * "ค้างมาตั้งแต่เมื่อวาน" · ใช้กับการ์ด aging บน dashboard
 */
export function ageInDays(from: Date, now: Date = new Date()): number {
  const a = Date.parse(`${bangkokDate(from)}T00:00:00Z`);
  const b = Date.parse(`${bangkokDate(now)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * วันทำการ = จันทร์–ศุกร์ ตามปฏิทินไทย · **ยังไม่รู้จักวันหยุดนักขัตฤกษ์**
 *
 * ใช้กับกติกา "ต้องกดรับเรื่องภายในหนึ่งวันทำการ" (CONTEXT.md §รับเรื่อง) — คำสั่งที่ออกบ่ายวันศุกร์
 * ครบกำหนดบ่ายวันจันทร์ ไม่ใช่เช้าวันเสาร์ที่ไม่มีใครทำงาน
 *
 * ★ วันหยุดนักขัตฤกษ์ยังไม่นับ — ยังไม่มีปฏิทินวันหยุดของบริษัทที่ระบบอ่านได้
 *   ผลคือคำเตือนอาจมาเร็วไปหนึ่งวันในช่วงวันหยุดยาว ซึ่งรับได้สำหรับคำเตือน
 *   (ไม่ได้ตัดสิทธิ์ใคร) · ถ้าจะเพิ่ม ให้เพิ่มที่นี่ที่เดียว
 */
export function isBangkokWeekend(d: Date): boolean {
  const ymd = bangkokDate(d);
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** บวก `n` วันทำการ โดยคงเวลาของวันไว้ (บ่ายศุกร์ + 1 = บ่ายจันทร์) */
export function addWorkingDays(from: Date, n: number): Date {
  let d = new Date(from.getTime());
  let left = n;
  while (left > 0) {
    d = new Date(d.getTime() + 86_400_000);
    if (!isBangkokWeekend(d)) left--;
  }
  return d;
}

/** `YYYY-MM-DD` ของวันที่ ถูกต้องตามปฏิทินจริงไหม (กัน 2026-02-30) */
export function isValidYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.getUTCDate() === Number(ymd.slice(8, 10));
}

/** `2026-09-25` → `25/09/2026` สำหรับหน้าจอ */
export function formatYmd(ymd: string): string {
  return isValidYmd(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : ymd;
}

/**
 * `YYYY-MM-DD` บวก/ลบ `n` วันตามปฏิทิน — คิดบนวันล้วน ไม่ผ่านเขตเวลา (ปฏิทินไทยไม่มี DST)
 *
 * ใช้กับวันทำงาน · วันไม่เข้างาน · "เมื่อวาน" ของรายชื่อคนขาด — **อย่าลบ 86_400_000 จาก `Date` แล้วแปลงเอง**
 * ในไฟล์อื่น (ข้อ 15) ให้เรียกตัวนี้แทน
 */
export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** นาทีที่ผ่านไปของวันตามเวลาไทย (0–1439) — เทียบกับเวลาเตือน `HH:MM` */
export function bangkokMinuteOfDay(d: Date = new Date()): number {
  const p = bangkokParts(d);
  return p.hour * 60 + p.minute;
}

/** `"08:30"` → 510 · รูปแบบผิด = null */
export function hhmmToMinutes(hhmm: string): number | null {
  const m = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** `YYYY-MM` ตามปฏิทินไทย — เดือนของสถิติ (spec §12) */
export function bangkokMonth(d: Date = new Date()): string {
  return bangkokDate(d).slice(0, 7);
}

/**
 * ช่วงของเดือนไทย `YYYY-MM` → `[ต้นเดือน, ต้นเดือนถัดไป)` ใช้ขอบบนแบบ `<`
 * รูปแบบผิด = `null` (ไม่เดา — เหตุผลเดียวกับ `bangkokDayStart`)
 */
export function bangkokMonthRange(ym: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  const start = bangkokDayStart(`${m[1]}-${m[2]}-01`);
  const end = bangkokDayStart(`${next}-01`);
  return start && end ? { start, end } : null;
}

/** `2026-11` → `พ.ย. 2569` */
export function formatMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const names = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${names[(m ?? 1) - 1]} ${(y ?? 0) + 543}`;
}
