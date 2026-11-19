import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkFlexMessage, flexTexts, flexUris } from "@/lib/flex";
import {
  dayZeroMessage,
  endedMessage,
  MAX_CARD_ITEMS,
  newVersionMessage,
  notPassedGroupMessage,
  notPassedMessage,
  notStartedMessage,
  overdueMessage,
  type LineMessage,
} from "@/lib/line-cards";

/** การ์ด LINE (ADR-0024) — ทุกใบต้องผ่านข้อจำกัดของ LINE เอง เพราะ GateWay ตอบ 202 ก่อนถึง LINE */

const BASE = "https://worktrain.test";
// พฤ. 19 พ.ย. 2569 09:00 เวลาไทย
const NOW = new Date("2026-11-19T09:00:00+07:00");
const due = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
const item = (id: number, title = `ชุด ${id}`, days = 7) => ({ assignmentId: id, title, dueAt: due(days) });
const person = (id: number, name: string, days = 2) => ({ ...item(id), person: name, dueAt: due(days) });

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE));
afterEach(() => vi.unstubAllEnvs());

const all: [string, () => LineMessage][] = [
  ["ชุดใหม่ 1", () => dayZeroMessage("assigned", [item(1, "F331 Signature")], NOW)],
  ["ชุดใหม่ หลายชุด", () => dayZeroMessage("assigned", [item(1), item(2)], NOW)],
  ["ได้รับมอบอีกครั้ง", () => dayZeroMessage("reassigned", [item(1)], NOW)],
  ["แจ้งซ้ำหลังเปิดใช้", () => dayZeroMessage("golive", [item(1), item(2)], NOW)],
  ["ไม่ต้องเรียนแล้ว", () => endedMessage(["F331 Signature"])],
  ["วันที่ 3", () => notStartedMessage([item(1)], NOW)],
  ["วันที่ 5 ตัวต่อตัว", () => notPassedMessage([person(1, "หนึ่ง")], NOW)],
  ["วันที่ 5 กลุ่ม", () => notPassedGroupMessage([person(1, "หนึ่ง"), person(2, "เซล สอง")], NOW)],
  ["เลยกำหนด", () => overdueMessage([person(1, "เซล หนึ่ง", -3)], NOW)],
  ["เวอร์ชันใหม่", () => newVersionMessage({ assignmentId: 9, title: "F331", label: "v2", what: "เปลี่ยนเล็ก: อ่านแล้วกดรับทราบ" })],
];

describe("การ์ดทุกแบบ", () => {
  it.each(all)("%s — ผ่าน checkFlexMessage · altText ไม่มีลิงก์ · มีปุ่มไป WorkTrain", (_name, build) => {
    const m = build();
    expect(m.flex).not.toBeNull();
    expect(checkFlexMessage(m.flex!)).toBeNull();
    expect(m.flex!.altText).not.toMatch(/https?:/);
    expect(m.flex!.altText).toBe(m.text.split("\n")[0]);
    expect(flexUris(m.flex!).length).toBeGreaterThan(0);
    expect(flexUris(m.flex!).every((u) => u.startsWith(`${BASE}/`))).toBe(true);
  });

  it("ชุดใหม่: ชื่อชุด · กำหนดส่งแบบอ่านทันที · แตะแล้วเปิดชุดนั้น", () => {
    const m = dayZeroMessage("assigned", [item(12, "F331 Signature")], NOW);
    expect(m.text).toBe(`📚 ชุดการเรียนรู้ใหม่: F331 Signature\nเรียนแล้วสอบให้ผ่าน 80% ภายใน 26/11/2026 09:00\n${BASE}/`);
    expect(flexTexts(m.flex!)).toEqual(expect.arrayContaining(["ชุดการเรียนรู้ใหม่", "F331 Signature", "กำหนดส่ง", "พฤ. 26 พ.ย. · อีก 7 วัน", "เริ่มเรียน"]));
    expect(flexUris(m.flex!)).toEqual([`${BASE}/learn/12`, `${BASE}/learn/12`]);
  });

  it("หลายชุด: ปุ่มเปิดรายการของฉัน · เกิน 8 ชุดสรุปเป็น 'และอีก n ชุด'", () => {
    const many = Array.from({ length: MAX_CARD_ITEMS + 3 }, (_, i) => item(i + 1));
    const m = dayZeroMessage("assigned", many, NOW);
    const texts = flexTexts(m.flex!);
    expect(texts).toContain(`ชุดการเรียนรู้ใหม่ ${many.length} ชุด`);
    expect(texts).toContain("และอีก 3 ชุด");
    expect(texts).not.toContain(`ชุด ${many.length}`);
    expect(flexUris(m.flex!).at(-1)).toBe(`${BASE}/learn`);
    expect(m.text).toContain(`- ชุด ${many.length} ·`);
  });

  it("กลุ่มประจำตัว: ไล่ชื่อคน ไม่มีลิงก์รายชุด (เปิดได้เฉพาะเจ้าของการมอบ)", () => {
    const m = notPassedGroupMessage([person(1, "หนึ่ง"), person(2, "เซล สอง")], NOW);
    expect(flexTexts(m.flex!)).toEqual(expect.arrayContaining(["ยังสอบไม่ผ่าน (2)", "หนึ่ง", "เซล สอง", "ชุด 1", "ชุด 2", "เสาร์. 21 พ.ย. · อีก 2 วัน".replace("เสาร์.", "ส.")]));
    expect(flexUris(m.flex!)).toEqual([`${BASE}/learn`]);
  });

  it("เลยกำหนด: นับวันที่เลยมา", () => {
    const m = overdueMessage([person(1, "เซล หนึ่ง", -3)], NOW);
    expect(flexTexts(m.flex!)).toContain("จ. 16 พ.ย. · เลยมา 3 วัน");
    expect(flexUris(m.flex!)).toEqual([`${BASE}/dashboard`]);
  });

  it("ลิงก์ไม่ใช่ https (เครื่อง dev) — การ์ดยังส่งได้ แต่ไม่มีปุ่ม/ลิงก์", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "http://localhost:3000");
    const m = dayZeroMessage("assigned", [item(1)], NOW);
    expect(checkFlexMessage(m.flex!)).toBeNull();
    expect(flexUris(m.flex!)).toEqual([]);
  });
});
