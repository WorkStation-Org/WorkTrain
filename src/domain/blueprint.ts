import { LEVELS, TOPICS, type Level, type SetKind, type Topic } from "@/db/schema";

/**
 * สัดส่วนหัวข้อ × ระดับของข้อสอบ 10 ข้อ (spec §3) — ทั้ง 5 ชุดใช้สัดส่วนเดียวกัน (ADR-0003)
 *
 * แม่แบบ "สินค้าใหม่ (PD)": spec 3 · ราคา 3 · วัสดุ 2 · การจับคู่ 2 และทุกแม่แบบแบ่งระดับ จำ 4 · เข้าใจ 4 · สถานการณ์ 2
 * ผู้สร้างปรับได้ — แต่ต้องรวมได้ 10 ข้อเสมอ
 */
export interface BlueprintCell {
  topic: Topic;
  level: Level;
  count: number;
}
export type Blueprint = BlueprintCell[];

export const QUESTIONS_PER_FORM = 10;

export const TOPIC_LABELS: Record<Topic, string> = {
  spec: "Spec / ขนาด / รุ่น",
  price: "ราคา / เงื่อนไขการขาย",
  material: "วัสดุ / มาตรฐาน / จุดขาย",
  pairing: "การจับคู่สินค้า / สถานการณ์ขาย",
  general: "ทั่วไป",
};

export const LEVEL_LABELS: Record<Level, string> = {
  recall: "จำ",
  understand: "เข้าใจ",
  scenario: "สถานการณ์",
};

/**
 * แม่แบบ "สินค้าใหม่ (PD)" — กระจายระดับให้ได้ จำ 4 · เข้าใจ 4 · สถานการณ์ 2 ทั้งชุด
 * ข้อสถานการณ์อยู่ที่การจับคู่ (ลูกค้าต้องการแบบนี้ ควรเสนอรุ่นไหน) และราคา (งบเท่านี้ได้อะไร)
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

/** แม่แบบ "ทั่วไป" — AI กระจายให้ครอบคลุมทุกหัวข้อของเอกสารเอง */
export const GENERAL_BLUEPRINT: Blueprint = [
  { topic: "general", level: "recall", count: 4 },
  { topic: "general", level: "understand", count: 4 },
  { topic: "general", level: "scenario", count: 2 },
];

export function defaultBlueprint(kind: SetKind): Blueprint {
  return structuredClone(kind === "product" ? PRODUCT_BLUEPRINT : GENERAL_BLUEPRINT);
}

export type BlueprintCheck = { ok: true; blueprint: Blueprint } | { ok: false; error: string };

/** ตรวจสัดส่วนที่ผู้สร้างตั้ง — รวมเป็นแถวเดียวต่อคู่ (หัวข้อ, ระดับ) ตัดแถวที่เป็น 0 */
export function checkBlueprint(input: unknown): BlueprintCheck {
  if (!Array.isArray(input)) return { ok: false, error: "สัดส่วนข้อสอบต้องเป็นรายการ" };
  const merged = new Map<string, BlueprintCell>();
  for (const raw of input) {
    const c = raw as Partial<BlueprintCell>;
    if (!TOPICS.includes(c.topic as Topic)) return { ok: false, error: `ไม่รู้จักหัวข้อ ${String(c.topic)}` };
    if (!LEVELS.includes(c.level as Level)) return { ok: false, error: `ไม่รู้จักระดับ ${String(c.level)}` };
    if (!Number.isInteger(c.count) || (c.count as number) < 0) return { ok: false, error: "จำนวนข้อต้องเป็นจำนวนเต็มไม่ติดลบ" };
    const key = `${c.topic}:${c.level}`;
    const prev = merged.get(key);
    merged.set(key, { topic: c.topic as Topic, level: c.level as Level, count: (prev?.count ?? 0) + (c.count as number) });
  }
  const blueprint = [...merged.values()].filter((c) => c.count > 0);
  const total = blueprint.reduce((n, c) => n + c.count, 0);
  if (total !== QUESTIONS_PER_FORM) return { ok: false, error: `รวมต้องได้ ${QUESTIONS_PER_FORM} ข้อ (ตอนนี้ ${total})` };
  return { ok: true, blueprint };
}

/** แตกสัดส่วนเป็นช่องทีละข้อตามลำดับ — ใช้สั่ง AI และตรวจว่า AI ให้ครบทุกช่อง */
export function slots(blueprint: Blueprint): { topic: Topic; level: Level }[] {
  return blueprint.flatMap((c) => Array.from({ length: c.count }, () => ({ topic: c.topic, level: c.level })));
}
