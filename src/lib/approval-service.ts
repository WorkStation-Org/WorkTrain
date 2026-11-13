import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { atomic } from "@/db/atomic";
import { approvalEvents, learningSets, setVersions } from "@/db/schema";
import type { Blueprint } from "@/domain/blueprint";
import type { Actor } from "@/lib/auth";
import { formsComplete } from "@/lib/exam-service";
import { canCloseSet, canDeleteDraft, canEditDraft, type Outcome, type SetRow } from "@/lib/set-service";

/**
 * การอนุมัติ (spec §4 · ADR-0004) — ร่าง → รออนุมัติ → (ตีกลับ → ร่าง) → ใช้อยู่ → ปิด · ร่างลบได้ (ADR-0016)
 *
 * ★ อนุมัติแล้วยังไม่มอบให้ใคร — การมอบตามผู้รับเป็น slice ถัดไป (spec §5)
 */

async function loadSet(setId: number): Promise<SetRow | null> {
  const [row] = await db().select().from(learningSets).where(eq(learningSets.id, setId));
  return row ?? null;
}

async function latestVersion(setId: number) {
  const rows = await db().select().from(setVersions).where(eq(setVersions.setId, setId)).orderBy(asc(setVersions.versionNo));
  return rows.at(-1) ?? null;
}

export async function submitForApproval(input: { actor: Actor; setId: number; now?: Date }): Promise<Outcome<{ eventId: number }>> {
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  if (!canEditDraft(input.actor, set)) return { ok: false, error: "ส่งขออนุมัติได้เฉพาะชุดร่างของตัวเอง" };
  if (!set.approverPersonId) return { ok: false, error: "ยังไม่ได้เลือกผู้อนุมัติ" };
  if (set.approverPersonId === set.authorPersonId) return { ok: false, error: "ผู้อนุมัติต้องไม่ใช่ผู้สร้างเอง" };
  // TG แก้ร่างของคนอื่นได้ — ถ้าตั้งตัวเองเป็นผู้อนุมัติแล้วกดส่งเอง จะอนุมัติเองได้โดยไม่มีคนที่สองดู
  if (set.approverPersonId === input.actor.personId) return { ok: false, error: "ผู้ส่งต้องไม่ใช่ผู้อนุมัติ — ให้ผู้สร้างกดส่ง หรือเปลี่ยนผู้อนุมัติ" };
  const version = await latestVersion(set.id);
  if (!version) return { ok: false, error: "ชุดนี้ยังไม่มีเอกสาร" };
  const incomplete = await formsComplete(version.id, set.blueprint as Blueprint);
  if (incomplete) return { ok: false, error: incomplete };

  const now = input.now ?? new Date();
  const results = await atomic([
    db().update(learningSets).set({ status: "pending_approval", updatedAt: now }).where(eq(learningSets.id, set.id)),
    db().insert(approvalEvents).values({
      setId: set.id,
      versionId: version.id,
      action: "submitted",
      actorPersonId: input.actor.personId,
      actorName: input.actor.name,
      createdAt: now,
    }).returning({ id: approvalEvents.id }),
  ]);
  return { ok: true, eventId: eventIdOf(results) };
}

/** id ของประวัติที่เพิ่งลง — ตัวสุดท้ายของ `atomic()` เป็น insert ... returning เสมอ */
function eventIdOf(results: unknown[]): number {
  const rows = results.at(-1) as { id: number }[];
  return rows[0].id;
}

function isApprover(actor: Pick<Actor, "personId">, set: SetRow): boolean {
  return set.status === "pending_approval" && set.approverPersonId === actor.personId;
}

/** ตีกลับพร้อมความเห็น — ใช้เมื่อต้นทางผิด (Pricelist/แคตตาล็อกผิด) ผู้สร้างแก้ไฟล์แล้วออกข้อสอบใหม่ */
export async function returnToAuthor(input: { actor: Actor; setId: number; comment: string; now?: Date }): Promise<Outcome<{ eventId: number }>> {
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  if (!isApprover(input.actor, set)) return { ok: false, error: "ตีกลับได้เฉพาะผู้อนุมัติของชุดที่รออนุมัติ" };
  const comment = input.comment.trim();
  if (!comment) return { ok: false, error: "ตีกลับต้องมีความเห็นบอกผู้สร้างว่าต้องแก้อะไร" };
  const version = await latestVersion(set.id);
  const now = input.now ?? new Date();
  const results = await atomic([
    db().update(learningSets).set({ status: "draft", updatedAt: now }).where(eq(learningSets.id, set.id)),
    db().insert(approvalEvents).values({
      setId: set.id,
      versionId: version?.id ?? null,
      action: "returned",
      actorPersonId: input.actor.personId,
      actorName: input.actor.name,
      comment,
      createdAt: now,
    }).returning({ id: approvalEvents.id }),
  ]);
  return { ok: true, eventId: eventIdOf(results) };
}

export async function approve(input: { actor: Actor; setId: number; now?: Date }): Promise<Outcome<{ eventId: number }>> {
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  if (!isApprover(input.actor, set)) return { ok: false, error: "อนุมัติได้เฉพาะผู้อนุมัติของชุดที่รออนุมัติ" };
  const version = await latestVersion(set.id);
  if (!version) return { ok: false, error: "ชุดนี้ยังไม่มีเอกสาร" };
  // ผู้อนุมัติแก้ข้อสอบได้ — ตรวจซ้ำตอนกดอนุมัติ ไม่เชื่อผลตรวจตอนส่ง
  const incomplete = await formsComplete(version.id, set.blueprint as Blueprint);
  if (incomplete) return { ok: false, error: incomplete };

  const now = input.now ?? new Date();
  const results = await atomic([
    db().update(setVersions).set({ approvedAt: now }).where(eq(setVersions.id, version.id)),
    db().update(learningSets).set({ status: "active", approvedAt: now, updatedAt: now }).where(eq(learningSets.id, set.id)),
    db().insert(approvalEvents).values({
      setId: set.id,
      versionId: version.id,
      action: "approved",
      actorPersonId: input.actor.personId,
      actorName: input.actor.name,
      createdAt: now,
    }).returning({ id: approvalEvents.id }),
  ]);
  return { ok: true, eventId: eventIdOf(results) };
}

/**
 * ลบร่าง (ADR-0016) — ผู้สร้าง/TG · สถานะเป็น `deleted` ไม่ลบแถวจริง (ประวัติใน `approval_events` มีแต่ insert)
 * ชุดหายจากรายการและเปิดหน้าชุดไม่ได้อีก · ร่างไม่เคยมอบให้ใคร จึงไม่มีผู้เรียนได้รับผล
 */
export async function deleteDraft(input: { actor: Actor; setId: number; now?: Date }): Promise<Outcome> {
  const set = await loadSet(input.setId);
  if (!set || set.status === "deleted") return { ok: false, error: "ไม่พบชุดนี้" };
  if (!canDeleteDraft(input.actor, set)) return { ok: false, error: "ลบได้เฉพาะชุดร่างของตัวเอง" };
  await endSet(input.actor, set, "deleted", input.now ?? new Date());
  return { ok: true };
}

/**
 * ปิดชุดที่ใช้อยู่ (spec §2 · ADR-0016) — ผู้สร้าง/TG · เลิกมอบคนใหม่ · เลิกเตือน · หายจากหน้าผู้เรียน
 * ผลที่สอบไปแล้วยังอยู่ในสถิติ · เปิดกลับไม่ได้ (ทำชุดใหม่แทน)
 */
export async function closeSet(input: { actor: Actor; setId: number; now?: Date }): Promise<Outcome> {
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  if (!canCloseSet(input.actor, set)) return { ok: false, error: "ปิดได้เฉพาะชุดที่ใช้อยู่ของตัวเอง" };
  await endSet(input.actor, set, "closed", input.now ?? new Date());
  return { ok: true };
}

async function endSet(actor: Actor, set: SetRow, to: "deleted" | "closed", now: Date) {
  const version = await latestVersion(set.id);
  await atomic([
    db()
      .update(learningSets)
      .set({ status: to, updatedAt: now, ...(to === "closed" ? { closedAt: now } : {}) })
      .where(eq(learningSets.id, set.id)),
    db().insert(approvalEvents).values({
      setId: set.id,
      versionId: version?.id ?? null,
      action: to,
      actorPersonId: actor.personId,
      actorName: actor.name,
      createdAt: now,
    }),
  ]);
}
