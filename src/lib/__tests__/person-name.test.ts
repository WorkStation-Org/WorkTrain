import { describe, expect, it } from "vitest";
import { callName, callNamesFrom, firstWord, personLabelsFrom, withNickname } from "@/lib/person-name";

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

describe("personLabelsFrom — ชื่อบนหน้ารายชื่อ: ชื่อ-สกุล + ชื่อเล่น + ทีมจากผังปัจจุบัน", () => {
  const labels = personLabelsFrom([
    { personId: 1, name: "ปุญชรัสมิ์ สิงห์รักษ์พล", nickname: " ปุญ ", teamName: "Sales A" },
    { personId: 2, name: "สมชาย ใจดี", nickname: null, teamName: null },
  ]);

  it("เจอในผัง → ชื่อ ชื่อเล่น ทีม ปัจจุบัน (ไม่ใช่ชื่อในแถว)", () => {
    expect(labels(1, "ชื่อเก่า")).toEqual({ name: "ปุญชรัสมิ์ สิงห์รักษ์พล", nickname: "ปุญ", team: "Sales A" });
    expect(labels(2, "อะไรก็ได้")).toEqual({ name: "สมชาย ใจดี", nickname: null, team: null });
  });

  it("ไม่พบในผัง → ชื่อในแถว ไม่มีชื่อเล่น/ทีม", () => {
    expect(labels(9, "คนที่ออกไปแล้ว")).toEqual({ name: "คนที่ออกไปแล้ว", nickname: null, team: null });
  });

  it("withNickname — มีชื่อเล่นใส่วงเล็บ · ไม่มีก็ชื่อล้วน", () => {
    expect(withNickname({ name: "สมใจ ใจดี", nickname: "ใจ" })).toBe("สมใจ ใจดี (ใจ)");
    expect(withNickname({ name: "สมชาย ใจดี", nickname: null })).toBe("สมชาย ใจดี");
  });
});
