import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ★ กติกาเครือข้อ 15 สั่งไว้ตรง ๆ ว่าต้องมีเทสต์ตัวนี้:
 *   "เขียนกฎให้เทสต์บังคับ: ห้ามไฟล์ไหนใน src/ เรียก toISOString()
 *    นอกจากไฟล์ helper เวลาไทยไฟล์เดียว"
 *
 * ที่มา (WorkDoc 11 ส.ค. 2026): มีฟังก์ชันเวลาไทยพร้อมเทสต์อยู่แล้ว แต่ไม่มีอะไรห้าม
 * ใครเลี่ยงไปเรียก UTC ตรง ๆ → เอกสารที่พิมพ์ออกกระดาษลงวันที่ย้อนหลัง 1 วัน
 * ทุกเช้าตอน 00:00–07:00 **และทีมบัญชีทำงานตอนเช้าพอดี**
 * เทสต์ที่พิสูจน์ว่า helper ถูก ไม่ได้พิสูจน์ว่าไม่มีใครเลี่ยงมัน
 *
 * รวม `toLocale*` เข้ามาด้วยเพราะเป็นกับดักตระกูลเดียวกัน — บน Vercel มันอ่าน
 * locale/timezone ของ **เครื่อง** ซึ่งเป็น UTC เสมอและตั้งทับไม่ได้
 */
const SRC = join(process.cwd(), "src");

/** ไฟล์เดียวที่ได้รับอนุญาต — จุดรวมของการแปลงเวลาทั้งระบบ */
const ALLOWED = new Set([join("src", "lib", "time.ts")]);

const BANNED = [
  { pattern: /\.toISOString\s*\(/, name: "toISOString()" },
  { pattern: /\.toLocaleDateString\s*\(/, name: "toLocaleDateString()" },
  { pattern: /\.toLocaleTimeString\s*\(/, name: "toLocaleTimeString()" },
  { pattern: /\.toLocaleString\s*\(/, name: "toLocaleString()" },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // เทสต์ไม่ได้ deploy จึงไม่ทำให้ผู้ใช้เห็นวันที่ผิด — และบางตัวต้องเรียก
      // UTC ตรง ๆ เพื่อ *สาธิต* ว่าถ้าใช้มันแล้วจะผิดยังไง
      return entry === "__tests__" ? [] : walk(full);
    }
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("ห้ามคิดวันที่ด้วยเขตเวลาของเครื่อง (กติกาเครือข้อ 15)", () => {
  it("ไม่มีไฟล์ไหนใน src/ เรียก toISOString / toLocale* นอกจาก src/lib/time.ts", () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const rel = join("src", relative(SRC, file));
      if (ALLOWED.has(rel)) continue;
      const source = readFileSync(file, "utf8");
      for (const { pattern, name } of BANNED) {
        if (pattern.test(source)) {
          offenders.push(`${rel.split(sep).join("/")} → ${name}`);
        }
      }
    }

    expect(
      offenders,
      `ใช้ helper จาก @/lib/time แทน (bangkokDate · formatBangkok · ageInDays)\n` +
        `runtime เป็น UTC เสมอ — 00:00–07:00 เวลาไทย UTC ยังเป็นเมื่อวาน\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("ตัวเทสต์เองจับได้จริง (ไม่ใช่ regex ที่ไม่เคย match อะไรเลย)", () => {
    // ข้อ 21: กลไกกันที่ไม่เคยเข้าเงื่อนไข = ยังไม่ได้กันอะไร
    const sample = "const d = new Date().toISOString();";
    expect(BANNED.some(({ pattern }) => pattern.test(sample))).toBe(true);
  });
});
