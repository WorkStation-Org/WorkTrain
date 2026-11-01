import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { atomic } from "@/db/atomic";
import { approvalEvents, assignments, documents, examForms, FORMS_PER_VERSION, learningSets, setVersions, type ChangeKind } from "@/db/schema";
import { DELTA_BLUEPRINT, type Blueprint } from "@/domain/blueprint";
import type { Actor } from "@/lib/auth";
import { sendToPerson, type SendResult } from "@/lib/deliver";
import { checkForms, type ExamModel } from "@/lib/exam-generator";
import { formsComplete, insertForms, sourceDocuments } from "@/lib/exam-service";
import { canEditVersion, currentVersion, type Outcome, type SetRow, type VersionRow } from "@/lib/set-service";
import { fetchOrg } from "@/lib/workid";

/**
 * เวอร์ชันใหม่ของเอกสารต้นทาง (spec §7 · ADR-0008)
 *
 * เริ่มเวอร์ชันใหม่ → อัปเอกสาร → AI ออกข้อสอบชุดเต็ม 5 ชุด + สรุปสิ่งที่เปลี่ยน → ส่ง →
 * ผู้อนุมัติเลือกเปลี่ยนเล็ก/ใหญ่ (ใหญ่ = ให้ AI ออกข้อสอบเฉพาะส่วนที่เปลี่ยน) → อนุมัติ → แจ้งผู้เรียนที่ผ่านแล้ว
 *
 * ★ ระหว่างทำเวอร์ชันใหม่ ชุดยัง `active` และผู้เรียนเรียน/สอบเวอร์ชันที่อนุมัติล่าสุดตามเดิม
 * ★ เวอร์ชันแรกใช้สถานะของชุด (approval-service) · ไฟล์นี้ดูแลเวอร์ชันที่ 2 ขึ้นไปเท่านั้น
 */

async function loadSet(setId: number): Promise<SetRow | null> {
  const [row] = await db().select().from(learningSets).where(eq(learningSets.id, setId));
  return row ?? null;
}

/** เวอร์ชันใหม่ที่กำลังทำ (ยังไม่อนุมัติ) ของชุดที่ใช้อยู่ · ไม่มี = null */
async function newVersion(set: SetRow): Promise<VersionRow | null> {
  if (set.status !== "active") return null;
  const v = await currentVersion(set.id);
  return v && v.versionNo > 1 && !v.approvedAt ? v : null;
}

async function previousApproved(setId: number, beforeNo: number): Promise<VersionRow | null> {
  const rows = await db().select().from(setVersions).where(and(eq(setVersions.setId, setId), isNotNull(setVersions.approvedAt))).orderBy(asc(setVersions.versionNo));
  return rows.filter((v) => v.versionNo < beforeNo).at(-1) ?? null;
}

function isOwnerOrAdmin(actor: Pick<Actor, "personId" | "role">, set: SetRow) {
  return actor.role === "admin" || set.authorPersonId === actor.personId;
}

function isVersionApprover(actor: Pick<Actor, "personId">, set: SetRow, v: VersionRow | null): v is VersionRow {
  return v !== null && v.submittedAt !== null && set.approverPersonId === actor.personId;
}

function eventIdOf(results: unknown[]): number {
  const rows = results.at(-1) as { id: number }[];
  return rows[0].id;
}

/** เริ่มเวอร์ชันใหม่ — ผู้สร้างหรือ TG ของชุดที่ใช้อยู่ · มีเวอร์ชันใหม่ค้างอยู่แล้วเริ่มซ้ำไม่ได้ */
export async function startVersion(input: { actor: Actor; setId: number; label?: string; now?: Date }): Promise<Outcome<{ versionId: number }>> {
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  if (!isOwnerOrAdmin(input.actor, set)) return { ok: false, error: "เริ่มเวอร์ชันใหม่ได้เฉพาะผู้สร้างหรือ TG" };
  if (set.status !== "active") return { ok: false, error: "เริ่มเวอร์ชันใหม่ได้เมื่อชุดอนุมัติแล้วเท่านั้น" };
  const latest = await currentVersion(set.id);
  if (!latest?.approvedAt) return { ok: false, error: "มีเวอร์ชันใหม่ที่ยังไม่อนุมัติอยู่แล้ว" };
  const rows = await db()
    .insert(setVersions)
    .values({ setId: set.id, versionNo: latest.versionNo + 1, label: input.label?.trim() || null, createdByPersonId: input.actor.personId, createdAt: input.now ?? new Date() })
    .onConflictDoNothing()
    .returning({ id: setVersions.id });
  if (!rows.length) return { ok: false, error: "มีเวอร์ชันใหม่ที่ยังไม่อนุมัติอยู่แล้ว" };
  return { ok: true, versionId: rows[0].id };
}

/** ให้ AI สรุปสิ่งที่เปลี่ยนเทียบกับเวอร์ชันที่ใช้อยู่ — ผู้สร้างกดก่อนส่ง (ผู้อนุมัติใช้ตัดสินเล็ก/ใหญ่) */
export async function summarizeVersion(input: { actor: Actor; setId: number; model: ExamModel | null }): Promise<Outcome> {
  if (!input.model) return { ok: false, error: "ยังไม่ได้ตั้ง ANTHROPIC_API_KEY บนเซิร์ฟเวอร์นี้" };
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  const v = await newVersion(set);
  if (!v || !canEditVersion(input.actor, set, v)) return { ok: false, error: "สรุปได้เฉพาะเวอร์ชันใหม่ที่ยังไม่ส่งของตัวเอง" };
  const prev = await previousApproved(set.id, v.versionNo);
  if (!prev) return { ok: false, error: "ไม่พบเวอร์ชันที่ใช้อยู่" };
  const before = await sourceDocuments(prev.id);
  if (!before.ok) return before;
  const after = await sourceDocuments(v.id);
  if (!after.ok) return after;
  const out = await input.model.summarizeChanges({ setTitle: set.title, before: before.docs, after: after.docs });
  if (!out.ok) return out;
  await db().update(setVersions).set({ changeSummary: out.value.slice(0, 8000) }).where(eq(setVersions.id, v.id));
  return { ok: true };
}

/** ผู้สร้างแก้สรุปเองได้ — AI อาจพลาด และผู้เรียนที่ผ่านแล้วอ่านสรุปนี้แทนเอกสารทั้งเล่ม */
export async function editSummary(input: { actor: Actor; setId: number; summary: string }): Promise<Outcome> {
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  const v = await newVersion(set);
  if (!v || !canEditVersion(input.actor, set, v)) return { ok: false, error: "แก้ได้เฉพาะเวอร์ชันใหม่ที่ยังไม่ส่งของตัวเอง" };
  const text = input.summary.trim();
  if (!text) return { ok: false, error: "สรุปสิ่งที่เปลี่ยนต้องไม่ว่าง" };
  await db().update(setVersions).set({ changeSummary: text.slice(0, 8000) }).where(eq(setVersions.id, v.id));
  return { ok: true };
}

/** ส่งเวอร์ชันใหม่ขออนุมัติ — ต้องมีเอกสาร · ข้อสอบชุดเต็มครบ 5 ชุด · สรุปสิ่งที่เปลี่ยน */
export async function submitVersion(input: { actor: Actor; setId: number; now?: Date }): Promise<Outcome<{ eventId: number }>> {
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  const v = await newVersion(set);
  if (!v || !canEditVersion(input.actor, set, v)) return { ok: false, error: "ส่งได้เฉพาะเวอร์ชันใหม่ที่ยังไม่ส่งของตัวเอง" };
  if (!set.approverPersonId) return { ok: false, error: "ยังไม่ได้เลือกผู้อนุมัติ" };
  const docs = await db().select({ id: documents.id }).from(documents).where(eq(documents.versionId, v.id));
  if (!docs.length) return { ok: false, error: "เวอร์ชันใหม่ยังไม่มีเอกสาร" };
  const incomplete = await formsComplete(v.id, set.blueprint as Blueprint);
  if (incomplete) return { ok: false, error: incomplete };
  if (!v.changeSummary?.trim()) return { ok: false, error: "ให้ AI สรุปสิ่งที่เปลี่ยนก่อนส่ง" };
  const now = input.now ?? new Date();
  const results = await atomic([
    db().update(setVersions).set({ submittedAt: now }).where(eq(setVersions.id, v.id)),
    db().update(learningSets).set({ updatedAt: now }).where(eq(learningSets.id, set.id)),
    db()
      .insert(approvalEvents)
      .values({ setId: set.id, versionId: v.id, action: "submitted", actorPersonId: input.actor.personId, actorName: input.actor.name, createdAt: now })
      .returning({ id: approvalEvents.id }),
  ]);
  return { ok: true, eventId: eventIdOf(results) };
}

/** ผู้อนุมัติเลือกเปลี่ยนเล็ก/ใหญ่ — เปลี่ยนเป็นเล็กแล้วข้อสอบส่วนที่เปลี่ยนที่ออกไว้ถูกลบ (ยังไม่มีใครสอบ) */
export async function setChangeKind(input: { actor: Actor; setId: number; kind: ChangeKind }): Promise<Outcome> {
  if (input.kind !== "small" && input.kind !== "large") return { ok: false, error: "เลือกเปลี่ยนเล็กหรือเปลี่ยนใหญ่" };
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  const v = await newVersion(set);
  if (!isVersionApprover(input.actor, set, v)) return { ok: false, error: "เลือกได้เฉพาะผู้อนุมัติของเวอร์ชันที่รออนุมัติ" };
  await db().update(setVersions).set({ changeKind: input.kind }).where(eq(setVersions.id, v.id));
  if (input.kind === "small") await db().delete(examForms).where(and(eq(examForms.versionId, v.id), eq(examForms.kind, "delta")));
  return { ok: true };
}

/** เปลี่ยนใหญ่ → ให้ AI ออกข้อสอบเฉพาะส่วนที่เปลี่ยน 5 ชุด ชุดละ 5 ข้อ (ADR-0008) — ผู้อนุมัติกด แล้วตรวจ/แก้ได้เหมือนข้อสอบชุดเต็ม */
export async function generateDeltaExams(input: { actor: Actor; setId: number; model: ExamModel | null }): Promise<Outcome> {
  if (!input.model) return { ok: false, error: "ยังไม่ได้ตั้ง ANTHROPIC_API_KEY บนเซิร์ฟเวอร์นี้" };
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  const v = await newVersion(set);
  if (!isVersionApprover(input.actor, set, v)) return { ok: false, error: "ออกได้เฉพาะผู้อนุมัติของเวอร์ชันที่รออนุมัติ" };
  if (v.changeKind !== "large") return { ok: false, error: "เลือก \"เปลี่ยนใหญ่\" ก่อน" };
  const src = await sourceDocuments(v.id);
  if (!src.ok) return src;
  const out = await input.model.generateForms({ setTitle: set.title, documents: src.docs, blueprint: DELTA_BLUEPRINT, formCount: FORMS_PER_VERSION, focus: v.changeSummary ?? "" });
  if (!out.ok) return out;
  const bad = checkForms(out.value, DELTA_BLUEPRINT, FORMS_PER_VERSION);
  if (bad) return { ok: false, error: `AI ออกข้อสอบส่วนที่เปลี่ยนไม่ครบ (${bad}) — ลองกดออกใหม่` };
  await db().delete(examForms).where(and(eq(examForms.versionId, v.id), eq(examForms.kind, "delta")));
  await insertForms(v.id, "delta", out.value);
  return { ok: true };
}

/** ตีกลับเวอร์ชันใหม่ — ผู้สร้างแก้เอกสาร/ข้อสอบแล้วส่งใหม่ · ผู้เรียนยังใช้เวอร์ชันเดิม */
export async function returnVersion(input: { actor: Actor; setId: number; comment: string; now?: Date }): Promise<Outcome<{ eventId: number }>> {
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  const v = await newVersion(set);
  if (!isVersionApprover(input.actor, set, v)) return { ok: false, error: "ตีกลับได้เฉพาะผู้อนุมัติของเวอร์ชันที่รออนุมัติ" };
  const comment = input.comment.trim();
  if (!comment) return { ok: false, error: "ตีกลับต้องมีความเห็นบอกผู้สร้างว่าต้องแก้อะไร" };
  const now = input.now ?? new Date();
  const results = await atomic([
    db().update(setVersions).set({ submittedAt: null }).where(eq(setVersions.id, v.id)),
    db()
      .insert(approvalEvents)
      .values({ setId: set.id, versionId: v.id, action: "returned", actorPersonId: input.actor.personId, actorName: input.actor.name, comment, createdAt: now })
      .returning({ id: approvalEvents.id }),
  ]);
  return { ok: true, eventId: eventIdOf(results) };
}

/** อนุมัติเวอร์ชันใหม่ — ผู้เรียนเห็นเวอร์ชันนี้ทันที · ผู้เรียนที่ผ่านแล้วต้องรับทราบ (เล็ก) หรือสอบส่วนที่เปลี่ยน (ใหญ่) */
export async function approveVersion(input: { actor: Actor; setId: number; now?: Date }): Promise<Outcome<{ eventId: number; versionId: number }>> {
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  const v = await newVersion(set);
  if (!isVersionApprover(input.actor, set, v)) return { ok: false, error: "อนุมัติได้เฉพาะผู้อนุมัติของเวอร์ชันที่รออนุมัติ" };
  if (v.changeKind !== "small" && v.changeKind !== "large") return { ok: false, error: "เลือกก่อนว่าเปลี่ยนเล็กหรือเปลี่ยนใหญ่" };
  // ผู้อนุมัติแก้ข้อสอบได้ — ตรวจซ้ำตอนกดอนุมัติ
  const incomplete = await formsComplete(v.id, set.blueprint as Blueprint);
  if (incomplete) return { ok: false, error: incomplete };
  if (v.changeKind === "large") {
    const delta = await formsComplete(v.id, DELTA_BLUEPRINT, "delta");
    if (delta) return { ok: false, error: delta };
  }
  const now = input.now ?? new Date();
  const results = await atomic([
    db().update(setVersions).set({ approvedAt: now }).where(eq(setVersions.id, v.id)),
    db().update(learningSets).set({ updatedAt: now }).where(eq(learningSets.id, set.id)),
    db()
      .insert(approvalEvents)
      .values({ setId: set.id, versionId: v.id, action: "approved", actorPersonId: input.actor.personId, actorName: input.actor.name, createdAt: now })
      .returning({ id: approvalEvents.id }),
  ]);
  return { ok: true, eventId: eventIdOf(results), versionId: v.id };
}

function appUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? ""}${path}`;
}

/** แจ้งผู้เรียนที่ผ่านแล้วว่ามีเวอร์ชันใหม่ (spec §11) — ส่งไม่ได้ไม่ทำให้การอนุมัติล้ม */
export async function notifyNewVersion(versionId: number): Promise<Record<SendResult, number>> {
  const tally: Record<SendResult, number> = { sent: 0, failed: 0, skipped: 0, duplicate: 0 };
  const [row] = await db().select({ v: setVersions, title: learningSets.title }).from(setVersions).innerJoin(learningSets, eq(learningSets.id, setVersions.setId)).where(eq(setVersions.id, versionId));
  if (!row?.v.approvedAt || !row.v.changeKind || row.v.changeKind === "initial") return tally;
  const passed = await db()
    .select()
    .from(assignments)
    .where(and(eq(assignments.setId, row.v.setId), isNotNull(assignments.passedAt)));
  const targets = passed.filter((a) => a.passedAt! < row.v.approvedAt!);
  if (!targets.length) return tally;
  const org = await fetchOrg();
  const what = row.v.changeKind === "large" ? "ต้องสอบเฉพาะส่วนที่เปลี่ยน (~5 ข้อ)" : "อ่านสิ่งที่เปลี่ยนแล้วกดรับทราบ";
  const results = await Promise.all(
    targets.map((a) =>
      sendToPerson(
        {
          dedupeKey: `version:${versionId}:${a.id}`,
          kind: "new_version",
          personId: a.personId,
          setId: a.setId,
          assignmentId: a.id,
          text: `🔄 ${row.title} มีเวอร์ชันใหม่${row.v.label ? ` (${row.v.label})` : ""} — ${what}\n${appUrl(`/learn/${a.id}`)}`,
        },
        org.ok ? org.people : [],
      ),
    ),
  );
  for (const r of results) tally[r] += 1;
  return tally;
}
