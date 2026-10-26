import { describe, expect, it } from "vitest";
import { callName, callNamesFrom, firstWord } from "@/lib/person-name";

describe("callName — ชื่อที่ใช้เรียก: ชื่อเล่น ไม่มีก็คำแรกของชื่อ", () => {
  it("มีชื่อเล่น → ชื่อเล่น", () => {
    expect(callName({ name: "เบญจพร สุทธิ", nickname: "น้ำผึ้ง" })).toBe("น้ำผึ้ง");
    expect(callName({ name: "Siripong Tianpajeekul", nickname: " Bank " })).toBe("Bank");
  });

  it("ไม่มีชื่อเล่น / ว่าง → คำแรกของชื่อ", () => {
    expect(callName({ name: "สมชาย ใจดี", nickname: null })).toBe("สมชาย");
    expect(callName({ name: "  สมชาย   ใจดี ", nickname: "  " })).toBe("สมชาย");
    expect(callName({ name: "สมชาย" })).toBe("สมชาย");
  });

  it("firstWord ไม่แกะวงเล็บ — แค่คำแรก", () => {
    expect(firstWord("เบญจพร สุทธิ (น้ำผึ้ง)")).toBe("เบญจพร");
  });
});

describe("callNamesFrom — หาตาม personId จากผัง · ไม่เจอ = คำแรกของชื่อในแถว", () => {
  const names = callNamesFrom([
    { personId: 1, name: "สมใจ ใจดี", nickname: "ใจ" },
    { personId: 2, name: "สมชาย ใจดี", nickname: null },
  ]);

  it("เจอในผัง → ชื่อเล่นปัจจุบัน ไม่ใช่ชื่อที่เก็บไว้", () => {
    expect(names(1, "สมใจ ใจดี (เก่า)")).toBe("ใจ");
    expect(names(2, "อะไรก็ได้")).toBe("สมชาย");
  });

  it("ไม่เจอ / ไม่มี personId → คำแรกของ snapshot", () => {
    expect(names(99, "เบญจพร สุทธิ (น้ำผึ้ง)")).toBe("เบญจพร");
    expect(names(null, "หัวหน้า ก")).toBe("หัวหน้า");
  });
});
