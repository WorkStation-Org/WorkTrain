import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalEvents,
  choices,
  documents,
  examForms,
  FORMS_PER_VERSION,
  learningSets,
  questions,
  setVersions,
} from "@/db/schema";
import type { Blueprint } from "@/domain/blueprint";
import { aiReadable } from "@/domain/document";
import type { Actor } from "@/lib/auth";
import { checkForms, checkQuestion, type ExamModel, type GeneratedQuestion, type SourceDocument } from "@/lib/exam-generator";
import { objectStore } from "@/lib/object-store";
import { canEditDraft, type Outcome, type SetRow } from "@/lib/set-service";

/**
 * ข้อสอบของชุดการเรียนรู้ — ให้ AI ออก 5 ชุด · แก้ทีละข้อ · ออกใหม่ทีละข้อ (spec §3 · §4)
 *
 * ใครแก้ข้อสอบได้: ผู้สร้าง/TG ตอนร่าง · ผู้อนุมัติตอนรออนุมัติ (ADR-0004) — ทุกการแก้ลงประวัติก่อน/หลัง
 */

async function loadSet(setId: number): Promise<SetRow | null> {
  const [row] = await db().select().from(learningSets).where(eq(learningSets.id, setId));
  return row ?? null;
}

async function latestVersion(setId: number) {
  const rows = await db().select().from(setVersions).where(eq(setVersions.setId, setId)).orderBy(asc(setVersions.versionNo));
  return rows.at(-1) ?? null;
}

/** แก้ข้อสอบได้ไหม และในฐานะอะไร — ผู้อนุมัติแก้ตอนรออนุมัติ · ผู้สร้างแก้ตอนร่าง */
export function examEditor(actor: Pick<Actor, "personId" | "role">, set: SetRow): "author" | "approver" | null {
  if (set.status === "pending_approval" && set.approverPersonId === actor.personId) return "approver";
  if (canEditDraft(actor, set)) return "author";
  return null;
}

async function sourceDocuments(versionId: number): Promise<Outcome<{ docs: SourceDocument[] }>> {
  const store = objectStore();
  if (!store) return { ok: false, error: "ยังไม่ได้ตั้งที่เก็บไฟล์ (R2) บนเซิร์ฟเวอร์นี้" };
  const rows = await db().select().from(documents).where(eq(documents.versionId, versionId)).orderBy(asc(documents.sortOrder));
  const readable = rows.filter((d) => aiReadable(d.mimeType));
  if (!readable.length) return { ok: false, error: "ต้องมีเอกสาร PDF อย่างน้อย 1 ไฟล์ก่อนออกข้อสอบ" };
  const docs: SourceDocument[] = [];
  for (const d of readable) {
    const bytes = await store.get(d.objectKey);
    if (!bytes) return { ok: false, error: `อ่านไฟล์ ${d.fileName} จากที่เก็บไม่ได้` };
    docs.push({ fileName: d.fileName, kind: d.kind, pdf: bytes });
  }
  return { ok: true, docs };
}

/** ลงคำถามหนึ่งข้อพร้อม 4 ตัวเลือก — แยกคำสั่งเพราะต้องใช้ id ของคำถามก่อน (ไม่ใช่ atomic) */
async function insertQuestion(formId: number, sortOrder: number, q: GeneratedQuestion): Promise<void> {
  const [row] = await db()
    .insert(questions)
    .values({ formId, sortOrder, topic: q.topic, level: q.level, text: q.text, sourceRef: q.sourceRef })
    .returning({ id: questions.id });
  await db()
    .insert(choices)
    .values(q.choices.map((text, i) => ({ questionId: row.id, sortOrder: i, text, isCorrect: i === q.correctIndex })));
}

/**
 * ให้ AI ออก 5 ชุดใหม่ทั้งหมด — แทนของเดิมของเวอร์ชันนี้ (ตอนร่างเท่านั้น)
 *
 * ออกครบทั้ง 5 ชุดและผ่าน `checkForms` ก่อนค่อยลบของเดิม — AI ล้มกลางทางไม่ทำให้ข้อสอบเดิมหาย
 */
export async function generateExams(input: { actor: Actor; setId: number; model: ExamModel | null }): Promise<Outcome> {
  if (!input.model) return { ok: false, error: "ยังไม่ได้ตั้ง ANTHROPIC_API_KEY บนเซิร์ฟเวอร์นี้" };
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  if (!canEditDraft(input.actor, set)) return { ok: false, error: "ออกข้อสอบได้เฉพาะชุดร่างของตัวเอง" };
  const version = await latestVersion(set.id);
  if (!version) return { ok: false, error: "ชุดนี้ยังไม่มีเอกสาร" };
  const src = await sourceDocuments(version.id);
  if (!src.ok) return src;

  const blueprint = set.blueprint as Blueprint;
  const out = await input.model.generateForms({ setTitle: set.title, documents: src.docs, blueprint, formCount: FORMS_PER_VERSION });
  if (!out.ok) return out;
  const bad = checkForms(out.value, blueprint, FORMS_PER_VERSION);
  if (bad) return { ok: false, error: `AI ออกข้อสอบไม่ครบตามที่ตั้งไว้ (${bad}) — ลองกดออกใหม่` };

  // ของเดิมลบได้เพราะยังเป็นร่าง ไม่มีใครสอบ (attempts อ้างชุดข้อสอบด้วย restrict — ถ้ามีจะล้มตรงนี้ ไม่ใช่ลบเงียบ)
  await db().delete(examForms).where(eq(examForms.versionId, version.id));
  for (const [i, form] of out.value.entries()) {
    const [f] = await db()
      .insert(examForms)
      .values({ versionId: version.id, kind: "full", formNo: i + 1 })
      .returning({ id: examForms.id });
    for (const [j, q] of form.entries()) await insertQuestion(f.id, j, q);
  }
  await db().update(learningSets).set({ updatedAt: new Date() }).where(eq(learningSets.id, set.id));
  return { ok: true };
}

async function loadQuestion(questionId: number) {
  const [row] = await db()
    .select({ q: questions, formId: examForms.id, versionId: setVersions.id, setId: setVersions.setId })
    .from(questions)
    .innerJoin(examForms, eq(examForms.id, questions.formId))
    .innerJoin(setVersions, eq(setVersions.id, examForms.versionId))
    .where(eq(questions.id, questionId));
  if (!row) return null;
  const opts = await db().select().from(choices).where(eq(choices.questionId, questionId)).orderBy(asc(choices.sortOrder));
  return { ...row, choices: opts };
}

function snapshot(q: { text: string; sourceRef: string }, opts: { text: string; isCorrect: boolean }[]) {
  return { text: q.text, sourceRef: q.sourceRef, choices: opts.map((c) => c.text), correctIndex: opts.findIndex((c) => c.isCorrect) };
}

export interface QuestionEdit {
  text: string;
  sourceRef: string;
  choices: string[];
  correctIndex: number;
}

/** แก้ข้อสอบหนึ่งข้อ (คำถาม · ตัวเลือก · เฉลย · ที่มา) — ลงประวัติก่อน/หลัง */
export async function editQuestion(input: { actor: Actor; questionId: number; edit: QuestionEdit }): Promise<Outcome> {
  const found = await loadQuestion(input.questionId);
  if (!found) return { ok: false, error: "ไม่พบข้อสอบ" };
  const set = await loadSet(found.setId);
  if (!set || !examEditor(input.actor, set)) return { ok: false, error: "แก้ข้อสอบชุดนี้ไม่ได้ในตอนนี้" };

  const next: GeneratedQuestion = {
    topic: found.q.topic,
    level: found.q.level,
    text: input.edit.text.trim(),
    sourceRef: input.edit.sourceRef.trim(),
    choices: input.edit.choices.map((c) => c.trim()),
    correctIndex: input.edit.correctIndex,
  };
  const bad = checkQuestion(next);
  if (bad) return { ok: false, error: bad };

  const before = snapshot(found.q, found.choices);
  await replaceQuestionContent(found.q.id, found.choices.map((c) => c.id), next);
  await db().insert(approvalEvents).values({
    setId: set.id,
    versionId: found.versionId,
    action: "question_edited",
    actorPersonId: input.actor.personId,
    actorName: input.actor.name,
    detail: { questionId: found.q.id, before, after: snapshot(next, next.choices.map((t, i) => ({ text: t, isCorrect: i === next.correctIndex }))) },
  });
  return { ok: true };
}

/** แทนเนื้อข้อสอบเดิมในแถวเดิม (id ของคำถามไม่เปลี่ยน — ประวัติอ้างถึงได้) */
async function replaceQuestionContent(questionId: number, choiceIds: number[], q: GeneratedQuestion): Promise<void> {
  await db()
    .update(questions)
    .set({ text: q.text, sourceRef: q.sourceRef, priceCheck: "not_applicable", updatedAt: new Date() })
    .where(eq(questions.id, questionId));
  if (choiceIds.length) await db().delete(choices).where(inArray(choices.id, choiceIds));
  await db()
    .insert(choices)
    .values(q.choices.map((text, i) => ({ questionId, sortOrder: i, text, isCorrect: i === q.correctIndex })));
}

/** ให้ AI ออกข้อนี้ใหม่ หัวข้อและระดับเดิม (spec §4 ข้อ 2) */
export async function regenerateQuestion(input: { actor: Actor; questionId: number; model: ExamModel | null }): Promise<Outcome> {
  if (!input.model) return { ok: false, error: "ยังไม่ได้ตั้ง ANTHROPIC_API_KEY บนเซิร์ฟเวอร์นี้" };
  const found = await loadQuestion(input.questionId);
  if (!found) return { ok: false, error: "ไม่พบข้อสอบ" };
  const set = await loadSet(found.setId);
  if (!set || !examEditor(input.actor, set)) return { ok: false, error: "แก้ข้อสอบชุดนี้ไม่ได้ในตอนนี้" };
  const src = await sourceDocuments(found.versionId);
  if (!src.ok) return src;

  const siblings = await db().select({ text: questions.text }).from(questions).where(eq(questions.formId, found.formId));
  const out = await input.model.regenerateQuestion({
    setTitle: set.title,
    documents: src.docs,
    topic: found.q.topic,
    level: found.q.level,
    replacing: found.q.text,
    avoid: siblings.map((s) => s.text).filter((t) => t !== found.q.text),
  });
  if (!out.ok) return out;
  const q = { ...out.value, topic: found.q.topic, level: found.q.level };
  const bad = checkQuestion(q);
  if (bad) return { ok: false, error: `AI ออกข้อใหม่ไม่ถูกรูป (${bad}) — ลองอีกครั้ง` };

  const before = snapshot(found.q, found.choices);
  await replaceQuestionContent(found.q.id, found.choices.map((c) => c.id), q);
  await db().insert(approvalEvents).values({
    setId: set.id,
    versionId: found.versionId,
    action: "question_regenerated",
    actorPersonId: input.actor.personId,
    actorName: input.actor.name,
    detail: { questionId: found.q.id, before },
  });
  return { ok: true };
}

/** ข้อสอบของเวอร์ชันครบพร้อมส่ง/อนุมัติไหม — 5 ชุด · ชุดละ 10 ข้อ · ทุกข้อ 4 ตัวเลือกถูกข้อเดียว */
export async function formsComplete(versionId: number, blueprint: Blueprint): Promise<string | null> {
  const forms = await db().select().from(examForms).where(eq(examForms.versionId, versionId));
  const full = forms.filter((f) => f.kind === "full");
  if (full.length !== FORMS_PER_VERSION) return `ต้องมีข้อสอบ ${FORMS_PER_VERSION} ชุด (มี ${full.length})`;
  const qs = await db().select().from(questions).where(inArray(questions.formId, full.map((f) => f.id)));
  const opts = qs.length ? await db().select().from(choices).where(inArray(choices.questionId, qs.map((q) => q.id))) : [];
  const perForm = slotsPerForm(blueprint);
  for (const f of full) {
    const mine = qs.filter((q) => q.formId === f.id);
    if (mine.length !== perForm) return `ชุดที่ ${f.formNo} มี ${mine.length} ข้อ (ต้อง ${perForm})`;
    for (const q of mine) {
      const o = opts.filter((c) => c.questionId === q.id);
      if (o.length !== 4 || o.filter((c) => c.isCorrect).length !== 1) return `ชุดที่ ${f.formNo} ข้อ ${q.sortOrder + 1}: ต้องมี 4 ตัวเลือกและถูกข้อเดียว`;
    }
  }
  return null;
}

function slotsPerForm(blueprint: Blueprint): number {
  return blueprint.reduce((n, c) => n + c.count, 0);
}
