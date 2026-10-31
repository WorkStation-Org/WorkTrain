import { MAX_LEAVES_BEFORE_SUBMIT } from "@/db/schema";

/**
 * กติกาการสอบ (spec §10) — กติกาล้วน ไม่แตะฐาน · การสุ่มรับ `rng` จากข้างนอกเพื่อให้เทสต์ได้
 */

export type Rng = () => number;

/** ไม่ผ่าน 2 ครั้งติด = ต้องกลับไปอ่านใหม่ก่อนสอบ (forced re-learn) */
export const FAILS_BEFORE_RELEARN = 2;

/**
 * เลือกชุดข้อสอบ — ไม่ซ้ำกับที่เคยได้จนกว่าจะครบทุกชุด แล้วค่อยวนใหม่ (ADR-0003)
 * `used` = formId ของครั้งก่อน ๆ เรียงตามเวลา
 */
export function pickForm(formIds: readonly number[], used: readonly number[], rng: Rng): number {
  if (formIds.length === 0) throw new Error("ไม่มีชุดข้อสอบให้เลือก");
  // นับเฉพาะรอบปัจจุบัน: ครบทุกชุดเมื่อไรเริ่มนับใหม่
  const round = used.length % formIds.length;
  const recent = new Set(used.slice(used.length - round));
  const fresh = formIds.filter((id) => !recent.has(id));
  const pool = fresh.length ? fresh : formIds;
  return pool[Math.floor(rng() * pool.length)];
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface LayoutItem {
  questionId: number;
  choiceIds: number[];
}

/** สลับลำดับข้อและตัวเลือกทุกครั้ง — กันการจำตำแหน่งคำตอบ (spec §10) */
export function buildLayout(questions: readonly { id: number; choiceIds: readonly number[] }[], rng: Rng): LayoutItem[] {
  return shuffle(questions, rng).map((q) => ({ questionId: q.id, choiceIds: shuffle(q.choiceIds, rng) }));
}

/** ข้อถัดไปที่ต้องตอบ — แสดงทีละข้อ ย้อนกลับไม่ได้ · null = ตอบครบแล้ว */
export function currentIndex(layout: readonly LayoutItem[], answers: Readonly<Record<string, number>>): number | null {
  const i = layout.findIndex((item) => answers[String(item.questionId)] === undefined);
  return i === -1 ? null : i;
}

/** คะแนนเป็นร้อยละ ปัดลง · ข้อที่ไม่ตอบ = ผิด */
export function score(
  layout: readonly LayoutItem[],
  answers: Readonly<Record<string, number>>,
  correct: ReadonlyMap<number, number>,
): { percent: number; wrong: number[] } {
  const wrong = layout.filter((item) => answers[String(item.questionId)] !== correct.get(item.questionId)).map((i) => i.questionId);
  const right = layout.length - wrong.length;
  return { percent: layout.length ? Math.floor((right * 100) / layout.length) : 0, wrong };
}

/** ออกจากหน้าสอบครั้งนี้แล้วต้องส่งเลยไหม — ครั้งที่ 1–4 เตือน · ครั้งที่ 5 ส่งเอง */
export function leaveForcesSubmit(leaveCountAfter: number): boolean {
  return leaveCountAfter >= MAX_LEAVES_BEFORE_SUBMIT;
}

/** ผลครั้งล่าสุดเรียงจากเก่าไปใหม่ → ต้องอ่านใหม่ไหม (ไม่ผ่านติดกันครบ `FAILS_BEFORE_RELEARN` ครั้งท้าย) */
export function needsRelearn(results: readonly boolean[]): boolean {
  if (results.length < FAILS_BEFORE_RELEARN) return false;
  return results.slice(-FAILS_BEFORE_RELEARN).every((passed) => !passed);
}
