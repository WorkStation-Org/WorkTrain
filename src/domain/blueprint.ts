import { LEVELS, type Level, type Topic } from "@/db/schema";

/**
 * สัดส่วนหัวข้อ × ระดับของข้อสอบ 10 ข้อ (spec §3) — ทั้ง 5 ชุดใช้สัดส่วนเดียวกัน (ADR-0003)
 *
 * แม่แบบเป็นของชนิดของชุด (`set_kinds` · ADR-0011) — TG ตั้งชื่อหัวข้อเองได้ · ชุดคัดลอกไปตอนสร้าง แล้วผู้สร้างปรับของชุดตัวเองได้
 * ต้องรวมได้ 10 ข้อเสมอ
 */
export interface BlueprintCell {
  topic: Topic;
  level: Level;
  count: number;
}
export type Blueprint = BlueprintCell[];

export const QUESTIONS_PER_FORM = 10;

/** ชื่อของรหัสหัวข้อเดิม (ก่อนมีทะเบียนชนิด) — หัวข้อใหม่เป็นข้อความที่ TG ตั้งอยู่แล้ว */
const LEGACY_TOPIC_LABELS: Record<string, string> = {
  spec: "Spec / ขนาด / รุ่น",
  price: "ราคา / เงื่อนไขการขาย",
  material: "วัสดุ / มาตรฐาน / จุดขาย",
  pairing: "การจับคู่สินค้า / สถานการณ์ขาย",
  general: "ทั่วไป",
};

/** ชื่อหัวข้อที่แสดงบนจอและส่งให้ AI */
export function topicLabel(topic: Topic): string {
  return LEGACY_TOPIC_LABELS[topic] ?? topic;
}

export const TOPIC_MAX = 60;

export const LEVEL_LABELS: Record<Level, string> = {
  recall: "จำ",
  understand: "เข้าใจ",
  scenario: "สถานการณ์",
};

/**
 * แม่แบบตั้งต้นของชนิด "สินค้าใหม่ (PD)" (migration 0007 ใส่ลงฐาน — เทสต์เทียบให้ตรงกัน)
 * กระจายระดับให้ได้ จำ 4 · เข้าใจ 4 · สถานการณ์ 2 ทั้งชุด
 */
export const PRODUCT_BLUEPRINT: Blueprint = [
  { topic: "spec", level: "recall", count: 2 },
  { topic: "spec", level: "understand", count: 1 },
  { topic: "price", level: "recall", count: 1 },
  { topic: "price", level: "understand", count: 1 },
  { topic: "price", level: "scenario", count: 1 },
  { topic: "material", level: "recall", count: 1 },
  { topic: "material", level: "understand", count: 1 },
  { topic: "pairing", level: "understand", count: 1 },
  { topic: "pairing", level: "scenario", count: 1 },
];

/** แม่แบบตั้งต้นของชนิด "ทั่วไป" — AI กระจายให้ครอบคลุมทุกหัวข้อของเอกสารเอง */
export const GENERAL_BLUEPRINT: Blueprint = [
  { topic: "general", level: "recall", count: 4 },
  { topic: "general", level: "understand", count: 4 },
  { topic: "general", level: "scenario", count: 2 },
];

export type BlueprintCheck = { ok: true; blueprint: Blueprint } | { ok: false; error: string };

/** ตรวจสัดส่วนที่ผู้สร้างตั้ง — รวมเป็นแถวเดียวต่อคู่ (หัวข้อ, ระดับ) ตัดแถวที่เป็น 0 */
export function checkBlueprint(input: unknown): BlueprintCheck {
  if (!Array.isArray(input)) return { ok: false, error: "สัดส่วนข้อสอบต้องเป็นรายการ" };
  const merged = new Map<string, BlueprintCell>();
  for (const raw of input) {
    const c = raw as Partial<BlueprintCell>;
    if (!LEVELS.includes(c.level as Level)) return { ok: false, error: `ไม่รู้จักระดับ ${String(c.level)}` };
    if (!Number.isInteger(c.count) || (c.count as number) < 0) return { ok: false, error: "จำนวนข้อต้องเป็นจำนวนเต็มไม่ติดลบ" };
    // ช่องที่เป็น 0 ไม่นับ — แถวว่างที่ยังไม่ได้กรอกในตารางของ TG ไม่ต้องตั้งชื่อ
    if (c.count === 0) continue;
    const topic = typeof c.topic === "string" ? c.topic.trim().replace(/\s+/g, " ") : "";
    if (!topic) return { ok: false, error: "ตั้งชื่อหัวข้อให้ครบทุกแถว" };
    if (topic.length > TOPIC_MAX) return { ok: false, error: `ชื่อหัวข้อยาวได้ไม่เกิน ${TOPIC_MAX} ตัวอักษร` };
    const key = `${topic}:${c.level}`;
    const prev = merged.get(key);
    merged.set(key, { topic, level: c.level as Level, count: (prev?.count ?? 0) + (c.count as number) });
  }
  const blueprint = [...merged.values()];
  const total = blueprint.reduce((n, c) => n + c.count, 0);
  if (total !== QUESTIONS_PER_FORM) return { ok: false, error: `รวมต้องได้ ${QUESTIONS_PER_FORM} ข้อ (ตอนนี้ ${total})` };
  return { ok: true, blueprint };
}

/** แตกสัดส่วนเป็นช่องทีละข้อตามลำดับ — ใช้สั่ง AI และตรวจว่า AI ให้ครบทุกช่อง */
export function slots(blueprint: Blueprint): { topic: Topic; level: Level }[] {
  return blueprint.flatMap((c) => Array.from({ length: c.count }, () => ({ topic: c.topic, level: c.level })));
}

/**
 * ข้อสอบเฉพาะส่วนที่เปลี่ยน ของเวอร์ชันแบบเรียนรู้และทดสอบ (ADR-0008 · spec §7 "~5 ข้อ") — ไม่แยกหัวข้อ เพราะส่วนที่เปลี่ยนอาจเป็นหัวข้อเดียว
 * ผู้เรียนที่ผ่านแล้วสอบชุดนี้แทนชุดเต็ม
 */
export const DELTA_BLUEPRINT: Blueprint = [
  { topic: "general", level: "recall", count: 2 },
  { topic: "general", level: "understand", count: 2 },
  { topic: "general", level: "scenario", count: 1 },
];

/** หัวข้อในแม่แบบตามลำดับที่ปรากฏ ไม่ซ้ำ */
export function topicsOf(blueprint: Blueprint): Topic[] {
  return [...new Set(blueprint.map((c) => c.topic))];
}
