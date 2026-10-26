import { describe, expect, it } from "vitest";
import {
  ageInDays,
  bangkokDate,
  bangkokDayEnd,
  bangkokDayStart,
  bangkokParts,
  formatBangkok,
  addWorkingDays,
  isBangkokWeekend,
  isValidYmd,
} from "@/lib/time";

describe("bangkokDate", () => {
  // ★ เคสที่ทำให้กฎข้อ 15 เกิดขึ้น: 00:00–07:00 ไทย UTC ยังเป็นเมื่อวาน
  it("ยังเป็นวันเดิมของไทยตอนตี 5 แม้ UTC จะข้ามวันไปแล้ว", () => {
    // 2026-09-08T22:00:00Z = 09/09/2026 05:00 น. เวลาไทย
    expect(bangkokDate(new Date("2026-09-08T22:00:00Z"))).toBe("2026-09-09");
    // ถ้าใครเผลอใช้ toISOString() จะได้ "2026-09-08" ซึ่งผิดไป 1 วัน
    expect(new Date("2026-09-08T22:00:00Z").toISOString().slice(0, 10)).toBe("2026-09-08");
  });

  it("เที่ยงคืนตรงของไทยเป็นวันใหม่", () => {
    // 2026-09-08T17:00:00Z = 09/09/2026 00:00 น.
    expect(bangkokDate(new Date("2026-09-08T17:00:00Z"))).toBe("2026-09-09");
    // ก่อนหน้านั้นหนึ่งนาทีคือ 23:59 ของวันที่ 8
    expect(bangkokDate(new Date("2026-09-08T16:59:00Z"))).toBe("2026-09-08");
  });
});

describe("bangkokParts", () => {
  it("แตกชั่วโมง/นาทีเป็นเวลาไทย", () => {
    expect(bangkokParts(new Date("2026-09-08T07:36:00Z"))).toEqual({
      year: 2026,
      month: 9,
      day: 8,
      hour: 14,
      minute: 36,
    });
  });

  it("เที่ยงคืนคืนชั่วโมงเป็น 0 ไม่ใช่ 24", () => {
    expect(bangkokParts(new Date("2026-09-08T17:00:00Z")).hour).toBe(0);
  });
});

describe("formatBangkok", () => {
  it("รูปแบบที่คนไทยอ่านออก", () => {
    expect(formatBangkok(new Date("2026-09-08T07:36:00Z"))).toBe("08/09/2026 14:36");
  });
});

describe("ageInDays", () => {
  it("นับตามปฏิทินไทย ไม่ใช่ 24 ชั่วโมง", () => {
    // 23:00 ไทยวันที่ 24 → 01:00 ไทยวันที่ 25 = 1 วัน แม้ห่างกันแค่ 2 ชั่วโมง
    expect(ageInDays(new Date("2026-09-24T16:00:00Z"), new Date("2026-09-24T18:00:00Z"))).toBe(1);
  });
});

describe("วันทำการ", () => {
  it("บ่ายวันศุกร์ + 1 วันทำการ = บ่ายวันจันทร์ ไม่ใช่วันเสาร์", () => {
    const fri = new Date("2026-09-25T07:00:00Z"); // ศุกร์ 14:00 ไทย
    expect(bangkokDate(addWorkingDays(fri, 1))).toBe("2026-09-28");
  });

  it("วันพุธ + 1 = วันพฤหัส", () => {
    expect(bangkokDate(addWorkingDays(new Date("2026-09-23T03:00:00Z"), 1))).toBe("2026-09-24");
  });

  it("เสาร์อาทิตย์ตามปฏิทินไทย — คืนวันศุกร์ 23:30 ไทย (UTC ยังเป็นศุกร์) ไม่ใช่วันหยุด", () => {
    expect(isBangkokWeekend(new Date("2026-09-25T16:30:00Z"))).toBe(false);
    expect(isBangkokWeekend(new Date("2026-09-25T17:30:00Z"))).toBe(true); // เสาร์ 00:30 ไทย
  });
});

describe("isValidYmd", () => {
  it("รับเฉพาะวันที่ที่มีจริง", () => {
    expect(isValidYmd("2026-02-28")).toBe(true);
    expect(isValidYmd("2026-02-30")).toBe(false);
    expect(isValidYmd("26-02-01")).toBe(false);
  });
});

describe("ขอบช่วงวันที่ของตัวกรอง", () => {
  /**
   * ★ ข้อ 15 ในรูปของตัวกรองรายวัน — ถ้าใช้เที่ยงคืน **UTC** เป็นขอบ เคสที่แจ้งช่วง
   *   00:00–07:00 เวลาไทยจะตกไปอยู่ "เมื่อวาน" แล้ว **หายจากผลกรองทุกเช้า**
   *   โดยหน้าจอดูปกติทุกอย่าง ไม่มี error ให้ใครเห็น
   */
  it("เที่ยงคืนของไทย = 17:00 UTC ของวันก่อนหน้า ไม่ใช่เที่ยงคืน UTC", () => {
    const start = bangkokDayStart("2026-09-14");
    expect(start?.getTime()).toBe(Date.parse("2026-09-13T17:00:00Z"));
    // ท่าที่ผิดซึ่งเคสนี้มีไว้กัน
    expect(Date.parse("2026-09-14")).not.toBe(start?.getTime());
  });

  it("ขอบบนคือเที่ยงคืนของวันถัดไป — เทียบแบบ `<` จึงรวมทั้งวันที่เลือก", () => {
    const start = bangkokDayStart("2026-09-14");
    const end = bangkokDayEnd("2026-09-14");
    expect((end?.getTime() ?? 0) - (start?.getTime() ?? 0)).toBe(86_400_000);

    // เคสที่แจ้ง 06:00 น. เวลาไทยของวันที่ 14 ต้องอยู่ในช่วง "14 ถึง 14"
    const morning = Date.parse("2026-09-13T23:00:00Z");
    expect(morning).toBeGreaterThanOrEqual(start?.getTime() ?? 0);
    expect(morning).toBeLessThan(end?.getTime() ?? 0);

    // และเคสของ 23:30 น. วันที่ 14 ก็ต้องยังอยู่ในช่วง
    const lateNight = Date.parse("2026-09-14T16:30:00Z");
    expect(lateNight).toBeLessThan(end?.getTime() ?? 0);
  });

  it("รูปแบบไม่ใช่ YYYY-MM-DD → null (ไม่เดา)", () => {
    // ค่าที่เดาผิดจะกลายเป็นตัวกรองที่ตัดข้อมูลทิ้งเงียบ ๆ
    expect(bangkokDayStart("14/09/2026")).toBeNull();
    expect(bangkokDayStart("")).toBeNull();
    expect(bangkokDayEnd("2026-9-1")).toBeNull();
    expect(bangkokDayStart("2026-13-45")).toBeNull();
  });
});
