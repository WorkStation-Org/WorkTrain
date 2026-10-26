// ★ คัดลอกมาจาก WorkCDP/src/lib/errmsg.ts (ต้นฉบับ · WorkCDP#32) — ไม่มี monorepo ในเครือ
//   แก้ที่นี่แล้วดูด้วยว่าต้นฉบับต้องแก้ตามไหม · กติกาเครือข้อ 23
/**
 * สรุป error ให้ "อ่านแล้วรู้ว่าต้องไปแก้อะไร" — ตรรกะล้วน เทสต์ได้ตรง ๆ
 *
 * ★ ทำไมต้องมี: `err.message` เฉย ๆ ทิ้งเหตุผลทิ้งไปทั้งหมด
 *
 *   Drizzle ห่อ error ของ driver ไว้ แล้วตั้ง message ของตัวเองเป็น
 *     "Failed query: insert into ... values ($1, $2)\nparams: ..."
 *   ส่วน **เหตุผลจริง** อยู่ใน `err.cause` (NeonDbError ที่มี code / constraint / detail)
 *
 *   ของจริง 13 ส.ค. 2026: identity-resolve รายงานเข้า heartbeat ว่า
 *     "Failed query: insert into "person_org_relationship" (...) params: ..."
 *   ซึ่งบอกแค่ว่า "คำสั่งนี้ล้ม" ไม่บอกว่าล้มเพราะอะไร · กว่าจะรู้ว่าเป็น foreign key
 *   ของ organization ต้องเข้าไปขุดฐานข้อมูล production เทียบทีละ id
 *   รายงานที่ไม่มีสาเหตุ = คนอ่านต้องไปสืบเอง ซึ่งแปลว่าส่วนใหญ่จะไม่มีใครสืบ
 *
 * ★ เอาสาเหตุขึ้นก่อน ที่มาไว้ทีหลัง — คนอ่านแจ้งเตือนอ่านบรรทัดแรกเป็นหลัก
 */

/** ลึกกว่านี้ไม่ได้ช่วยให้เข้าใจอะไรเพิ่ม แถมยาวจนกินที่ข้อความแจ้งเตือน */
const MAX_DEPTH = 5;

/** ฟิลด์ของ Postgres ที่บอกได้ว่าผิดตรงไหน — detail มักมีค่าที่ทำให้พังอยู่ในนั้นเลย */
const PG_FIELDS = ["detail", "constraint", "table", "column"] as const;

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * ไล่สาย cause จากนอกเข้าใน · กัน cause ที่ชี้วนกลับมาหาตัวเอง (จะวนไม่รู้จบ)
 */
export function causeChain(err: unknown, maxDepth = MAX_DEPTH): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  let cur = err;
  while (cur != null && out.length < maxDepth) {
    if (typeof cur === "object" && seen.has(cur)) break;
    if (typeof cur === "object") seen.add(cur);
    out.push(cur);
    cur = (cur as { cause?: unknown })?.cause;
  }
  return out;
}

/** ข้อความของ error หนึ่งชั้น — รองรับของที่ไม่ใช่ Error ด้วย (คนโยน string ก็มี) */
export function messageOf(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err.trim();
  if (err instanceof Error) return clean(err.message);
  if (typeof err === "object") {
    const m = clean((err as { message?: unknown }).message);
    if (m) return m;
    try {
      return JSON.stringify(err).slice(0, 200);
    } catch {
      return "";
    }
  }
  return String(err);
}

/** ฟิลด์เฉพาะของ Postgres ถ้ามี — `[23503] constraint=... · Key (x)=(y) is not present ...` */
export function pgFields(err: unknown): string {
  if (err == null || typeof err !== "object") return "";
  const e = err as Record<string, unknown>;
  const bits: string[] = [];
  const code = clean(e.code);
  if (code) bits.push(`[${code}]`);
  for (const f of PG_FIELDS) {
    const v = clean(e[f]);
    if (v) bits.push(`${f}=${v}`);
  }
  return bits.join(" ");
}

/**
 * ตัดส่วนที่ไม่ช่วยอะไรออกจากข้อความของ Drizzle
 * — `params:` เป็นค่าดิบยาว ๆ ที่ทำให้บรรทัดล้น และอาจมีข้อมูลลูกค้าติดมาด้วย
 */
export function trimQueryNoise(message: string): string {
  return message.split(/\n\s*params:/i)[0]!.replace(/\s+/g, " ").trim();
}

/**
 * @param maxLen  ยาวสุดที่ยอมให้ — ข้อความแจ้งเตือนไป LINE ยาวเกินก็ไม่มีใครอ่าน
 */
export function errorSummary(err: unknown, maxLen = 400): string {
  const chain = causeChain(err);
  if (chain.length === 0) return "unknown";

  // สาเหตุ = ชั้นในสุดที่พอมีข้อความ · ที่มา = ชั้นนอกสุด (มักเป็นคำสั่งที่ล้ม)
  const inner = [...chain].reverse().find((e) => messageOf(e) !== "") ?? chain[0];
  const reason = trimQueryNoise(messageOf(inner)) || "unknown";
  const fields = pgFields(inner);

  const parts = [reason];
  if (fields) parts.push(fields);

  const outerMsg = trimQueryNoise(messageOf(chain[0]));
  // ชั้นนอกซ้ำกับสาเหตุก็ไม่ต้องพูดสองรอบ
  if (outerMsg && outerMsg !== reason && !reason.includes(outerMsg)) {
    parts.push(`ตอนทำ: ${outerMsg}`);
  }

  const text = parts.join(" · ");
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}
