import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalEvents,
  choices,
  documents,
  examForms,
  FORMS_PER_VERSION,
  learningSets,
  questionReviews,
  questions,
  setVersions,
  type FormKind,
} from "@/db/schema";
import { DELTA_BLUEPRINT, slots, type Blueprint } from "@/domain/blueprint";
import { aiReadable } from "@/domain/document";
import { spreadPlan } from "@/domain/spread";
import type { Actor } from "@/lib/auth";
import { checkForms, checkQuestion, type ExamModel, type GeneratedQuestion, type SourceDocument } from "@/lib/exam-generator";
import { buildTemplate, parseSheet, readSheet, type ExistingQuestion, type RowError } from "@/lib/exam-sheet";
import { objectStore } from "@/lib/object-store";
import { canEditVersion, canManage, type Outcome, type SetRow, type VersionRow } from "@/lib/set-service";

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

/**
 * แก้ข้อสอบของเวอร์ชันนี้ได้ไหม และในฐานะอะไร — ผู้อนุมัติแก้ตอนรออนุมัติ · ผู้สร้างแก้ตอนร่าง
 * เวอร์ชันใหม่ (spec §7) ใช้สถานะของเวอร์ชัน ไม่ใช่ของชุด · ข้อสอบของเวอร์ชันที่อนุมัติแล้วแก้ไม่ได้
 */
export function examEditor(
  actor: Pick<Actor, "personId" | "role">,
  set: SetRow,
  version: Pick<VersionRow, "versionNo" | "approvedAt" | "submittedAt"> | null,
): "author" | "approver" | null {
  if (version?.approvedAt) return null;
  if (set.approverPersonId === actor.personId) {
    if (set.status === "pending_approval") return "approver";
    if (set.status === "active" && version && version.versionNo > 1 && version.submittedAt) return "approver";
  }
  if (canEditVersion(actor, set, version)) return "author";
  return null;
}

export async function sourceDocuments(versionId: number): Promise<Outcome<{ docs: SourceDocument[]; weights: number[] }>> {
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
  return { ok: true, docs, weights: readable.map((d) => d.examWeight) };
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

/** ลงชุดข้อสอบที่ผ่าน `checkForms` แล้ว — ชุดเต็มหรือชุดส่วนที่เปลี่ยน (version-service) */
export async function insertForms(versionId: number, kind: FormKind, forms: GeneratedQuestion[][]): Promise<void> {
  for (const [i, form] of forms.entries()) {
    const [f] = await db().insert(examForms).values({ versionId, kind, formNo: i + 1 }).returning({ id: examForms.id });
    for (const [j, q] of form.entries()) await insertQuestion(f.id, j, q);
  }
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
  const version = await latestVersion(set.id);
  if (!version) return { ok: false, error: "ชุดนี้ยังไม่มีเอกสาร" };
  if (!canEditVersion(input.actor, set, version)) return { ok: false, error: "ออกข้อสอบได้เฉพาะชุดร่างหรือเวอร์ชันใหม่ที่ยังไม่ส่งของตัวเอง" };
  const src = await sourceDocuments(version.id);
  if (!src.ok) return src;

  const blueprint = set.blueprint as Blueprint;
  // เฉลี่ยตามไฟล์ (ค่าตั้งต้น) หรือตามน้ำหนักที่ตั้งเอง · ตามหัวข้อ = ให้ AI กระจายเองตาม blueprint
  const plan =
    set.spreadMode === "topic" || src.docs.length < 2
      ? undefined
      : spreadPlan(set.spreadMode === "custom" ? src.weights : src.docs.map(() => 1), slots(blueprint).length, FORMS_PER_VERSION);
  const out = await input.model.generateForms({ setTitle: set.title, documents: src.docs, blueprint, formCount: FORMS_PER_VERSION, plan });
  if (!out.ok) return out;
  const bad = checkForms(out.value, blueprint, FORMS_PER_VERSION);
  if (bad) return { ok: false, error: `AI ออกข้อสอบไม่ครบตามที่ตั้งไว้ (${bad}) — ลองกดออกใหม่` };

  await replaceForms(version.id, "full", out.value);
  await db().update(learningSets).set({ updatedAt: new Date() }).where(eq(learningSets.id, set.id));
  await logFormsEvent({ actor: input.actor, setId: set.id, versionId: version.id, action: "exams_generated", detail: { kind: "full" } });
  return { ok: true };
}

/**
 * แทนข้อสอบทั้งหมดของส่วนนี้ (ชุดเต็มหรือส่วนที่เปลี่ยน) — เรียกหลังผ่าน `checkForms` แล้วเท่านั้น
 * ลบได้เพราะยังไม่มีใครสอบ (attempts อ้างชุดข้อสอบด้วย restrict — ถ้ามีจะล้มตรงนี้ ไม่ใช่ลบเงียบ) · "ตรวจแล้ว" หายตามข้อ
 */
export async function replaceForms(versionId: number, kind: FormKind, forms: GeneratedQuestion[][]): Promise<void> {
  await db().delete(examForms).where(and(eq(examForms.versionId, versionId), eq(examForms.kind, kind)));
  await insertForms(versionId, kind, forms);
}

/** ลงประวัติว่าข้อสอบทั้งชุดมาจากไหน — AI ออก หรือ Import จากไฟล์ */
export async function logFormsEvent(input: {
  actor: Pick<Actor, "personId" | "name">;
  setId: number;
  versionId: number;
  action: "exams_generated" | "exams_imported";
  detail: { kind: FormKind; fileName?: string };
}): Promise<void> {
  await db().insert(approvalEvents).values({
    setId: input.setId,
    versionId: input.versionId,
    action: input.action,
    actorPersonId: input.actor.personId,
    actorName: input.actor.name,
    detail: input.detail,
  });
}

async function loadQuestion(questionId: number) {
  const [row] = await db()
    .select({ q: questions, formId: examForms.id, version: setVersions, versionId: setVersions.id, setId: setVersions.setId })
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
  if (!set || !examEditor(input.actor, set, found.version)) return { ok: false, error: "แก้ข้อสอบชุดนี้ไม่ได้ในตอนนี้" };

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
  // แก้เอง = ตรวจข้อนี้แล้ว
  await db().insert(questionReviews).values({ questionId: found.q.id, personId: input.actor.personId }).onConflictDoNothing();
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
  if (!set || !examEditor(input.actor, set, found.version)) return { ok: false, error: "แก้ข้อสอบชุดนี้ไม่ได้ในตอนนี้" };
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
  // เนื้อเปลี่ยนทั้งข้อ — "ตรวจแล้ว" ของทุกคนไม่นับแล้ว
  await db().delete(questionReviews).where(eq(questionReviews.questionId, found.q.id));
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

/** ทำเครื่องหมาย "ตรวจแล้ว" ของคนนี้ต่อข้อสอบหนึ่งข้อ — คนที่ทำงานกับชุด (ผู้สร้าง · ผู้อนุมัติ · TG) */
export async function setQuestionReviewed(input: { actor: Actor; questionId: number; reviewed: boolean; now?: Date }): Promise<Outcome> {
  const found = await loadQuestion(input.questionId);
  if (!found) return { ok: false, error: "ไม่พบข้อสอบ" };
  const set = await loadSet(found.setId);
  if (!set || !canManage(input.actor, set)) return { ok: false, error: "ไม่พบข้อสอบ" };
  if (input.reviewed) {
    await db()
      .insert(questionReviews)
      .values({ questionId: found.q.id, personId: input.actor.personId, reviewedAt: input.now ?? new Date() })
      .onConflictDoNothing();
  } else {
    await db().delete(questionReviews).where(and(eq(questionReviews.questionId, found.q.id), eq(questionReviews.personId, input.actor.personId)));
  }
  return { ok: true };
}

/** ข้อที่คนนี้ตรวจแล้วในเวอร์ชันนี้ */
export async function reviewedQuestionIds(versionId: number, personId: number): Promise<Set<number>> {
  const rows = await db()
    .select({ id: questionReviews.questionId })
    .from(questionReviews)
    .innerJoin(questions, eq(questions.id, questionReviews.questionId))
    .innerJoin(examForms, eq(examForms.id, questions.formId))
    .where(and(eq(examForms.versionId, versionId), eq(questionReviews.personId, personId)));
  return new Set(rows.map((r) => r.id));
}

/**
 * ข้อสอบของเวอร์ชันครบพร้อมส่ง/อนุมัติไหม — 5 ชุด · ชุดละ 10 ข้อ · ทุกข้อ 4 ตัวเลือกถูกข้อเดียว
 * `kind = "delta"` = ข้อสอบส่วนที่เปลี่ยน ของเวอร์ชันแบบเรียนรู้และทดสอบ (ADR-0008) ตาม `DELTA_BLUEPRINT`
 */
export async function formsComplete(versionId: number, blueprint: Blueprint, kind: FormKind = "full"): Promise<string | null> {
  const forms = await db().select().from(examForms).where(eq(examForms.versionId, versionId));
  const full = forms.filter((f) => f.kind === kind);
  const what = kind === "delta" ? "ข้อสอบส่วนที่เปลี่ยน" : "ข้อสอบ";
  if (full.length !== FORMS_PER_VERSION) return `ต้องมี${what} ${FORMS_PER_VERSION} ชุด (มี ${full.length})`;
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

// ── Template / Import (ADR-0015) ────────────────────────────────────────────

/**
 * ใคร Template/Import ข้อสอบส่วนไหนได้ — ตามคนที่กดให้ AI ออกส่วนนั้นอยู่แล้ว
 * ชุดเต็ม = ผู้สร้าง/TG ตอนร่างหรือเวอร์ชันใหม่ที่ยังไม่ส่ง (`canEditVersion`) · ผู้อนุมัติ import ชุดเต็มไม่ได้
 * ส่วนที่เปลี่ยน = ผู้อนุมัติของเวอร์ชันใหม่ที่รออนุมัติ หลังเลือก "เรียนรู้และทดสอบ" (ADR-0008)
 * ไม่ต้องมี PDF (ต่างจาก AI) — แค่ต้องมีเอกสารอย่างน้อย 1 ไฟล์ให้อ้างเป็นที่มา
 */
async function sheetTarget(actor: Pick<Actor, "personId" | "role">, setId: number, kind: FormKind) {
  const set = await loadSet(setId);
  if (!set) return { ok: false as const, error: "ไม่พบชุดนี้" };
  const version = await latestVersion(set.id);
  if (!version) return { ok: false as const, error: "ชุดนี้ยังไม่มีเอกสาร" };
  if (kind === "full") {
    if (!canEditVersion(actor, set, version)) return { ok: false as const, error: "Import ข้อสอบได้เฉพาะชุดร่างหรือเวอร์ชันใหม่ที่ยังไม่ส่งของตัวเอง" };
  } else {
    const pending = set.status === "active" && version.versionNo > 1 && !version.approvedAt && version.submittedAt;
    if (!pending || set.approverPersonId !== actor.personId) return { ok: false as const, error: "Import ข้อสอบส่วนที่เปลี่ยนได้เฉพาะผู้อนุมัติของเวอร์ชันที่รออนุมัติ" };
    if (version.changeKind !== "large") return { ok: false as const, error: 'เลือก "เรียนรู้และทดสอบ" ก่อน' };
  }
  const docs = await db().select({ fileName: documents.fileName }).from(documents).where(eq(documents.versionId, version.id)).orderBy(asc(documents.sortOrder));
  if (!docs.length) return { ok: false as const, error: "ชุดนี้ยังไม่มีเอกสาร" };
  const blueprint = kind === "delta" ? DELTA_BLUEPRINT : (set.blueprint as Blueprint);
  return { ok: true as const, set, version, blueprint, fileNames: docs.map((d) => d.fileName) };
}

async function existingForms(versionId: number, kind: FormKind): Promise<ExistingQuestion[][]> {
  const forms = await db().select().from(examForms).where(and(eq(examForms.versionId, versionId), eq(examForms.kind, kind))).orderBy(asc(examForms.formNo));
  if (!forms.length) return [];
  const qs = await db().select().from(questions).where(inArray(questions.formId, forms.map((f) => f.id))).orderBy(asc(questions.sortOrder));
  const opts = qs.length ? await db().select().from(choices).where(inArray(choices.questionId, qs.map((q) => q.id))).orderBy(asc(choices.sortOrder)) : [];
  return forms.map((f) =>
    qs
      .filter((q) => q.formId === f.id)
      .map((q) => {
        const mine = opts.filter((c) => c.questionId === q.id);
        return { topic: q.topic, level: q.level, text: q.text, sourceRef: q.sourceRef, choices: mine.map((c) => c.text), correctIndex: mine.findIndex((c) => c.isCorrect) };
      }),
  );
}

/** Template .xlsx ของชุดนี้ — มีข้อสอบอยู่แล้วก็เติมลงไป ให้แก้แล้ว import กลับได้ */
export async function examTemplate(input: { actor: Actor; setId: number; kind: FormKind }): Promise<Outcome<{ bytes: Uint8Array; fileName: string }>> {
  const t = await sheetTarget(input.actor, input.setId, input.kind);
  if (!t.ok) return t;
  const bytes = await buildTemplate({
    setTitle: t.set.title,
    kind: input.kind,
    blueprint: t.blueprint,
    formCount: FORMS_PER_VERSION,
    fileNames: t.fileNames,
    existing: await existingForms(t.version.id, input.kind),
  });
  const what = input.kind === "delta" ? "ข้อสอบส่วนที่เปลี่ยน" : "ข้อสอบ";
  return { ok: true, bytes, fileName: `${what} - ${t.set.title}.xlsx` };
}

export type ImportOutcome = { ok: true; count: number } | { ok: false; error: string; rows?: RowError[] };

/** Import ข้อสอบจาก Template ที่กรอกแล้ว — ผ่านทุกข้อถึงจะแทนของเดิมทั้งหมด · ไม่ผ่านบอกทุกจุดพร้อมเลขแถว */
export async function importExams(input: { actor: Actor; setId: number; kind: FormKind; fileName: string; bytes: Uint8Array }): Promise<ImportOutcome> {
  const t = await sheetTarget(input.actor, input.setId, input.kind);
  if (!t.ok) return t;
  const read = await readSheet(input.bytes);
  if (!read.ok) return read;
  if (read.kind && read.kind !== input.kind) {
    return { ok: false, error: read.kind === "delta" ? "ไฟล์นี้เป็น Template ของข้อสอบส่วนที่เปลี่ยน ไม่ใช่ข้อสอบชุดเต็ม" : "ไฟล์นี้เป็น Template ของข้อสอบชุดเต็ม ไม่ใช่ข้อสอบส่วนที่เปลี่ยน" };
  }
  const parsed = parseSheet(read.rows, t.blueprint, FORMS_PER_VERSION, t.fileNames);
  if (!parsed.ok) return { ok: false, error: `ไฟล์ยังไม่ผ่าน ${parsed.errors.length} จุด — แก้แล้ว Import ใหม่ (ข้อสอบเดิมยังอยู่)`, rows: parsed.errors };

  await replaceForms(t.version.id, input.kind, parsed.forms);
  await db().update(learningSets).set({ updatedAt: new Date() }).where(eq(learningSets.id, t.set.id));
  await logFormsEvent({ actor: input.actor, setId: t.set.id, versionId: t.version.id, action: "exams_imported", detail: { kind: input.kind, fileName: input.fileName } });
  return { ok: true, count: parsed.forms.flat().length };
}
