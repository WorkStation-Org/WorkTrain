import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { atomic } from "@/db/atomic";
import { approvalEvents, learningSets, setVersions } from "@/db/schema";
import type { Blueprint } from "@/domain/blueprint";
import type { Actor } from "@/lib/auth";
import { formsComplete } from "@/lib/exam-service";
import { canEditDraft, type Outcome, type SetRow } from "@/lib/set-service";

/**
 * การอนุมัติ (spec §4 · ADR-0004) — ร่าง → รออนุมัติ → (ตีกลับ → ร่าง) → ใช้อยู่
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

export async function submitForApproval(input: { actor: Actor; setId: number; now?: Date }): Promise<Outcome> {
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  if (!canEditDraft(input.actor, set)) return { ok: false, error: "ส่งขออนุมัติได้เฉพาะชุดร่างของตัวเอง" };
  if (!set.approverPersonId) return { ok: false, error: "ยังไม่ได้เลือกผู้อนุมัติ" };
  if (set.approverPersonId === set.authorPersonId) return { ok: false, error: "ผู้อนุมัติต้องไม่ใช่ผู้สร้างเอง" };
  const version = await latestVersion(set.id);
  if (!version) return { ok: false, error: "ชุดนี้ยังไม่มีเอกสาร" };
  const incomplete = await formsComplete(version.id, set.blueprint as Blueprint);
  if (incomplete) return { ok: false, error: incomplete };

  const now = input.now ?? new Date();
  await atomic([
    db().update(learningSets).set({ status: "pending_approval", updatedAt: now }).where(eq(learningSets.id, set.id)),
    db().insert(approvalEvents).values({
      setId: set.id,
      versionId: version.id,
      action: "submitted",
      actorPersonId: input.actor.personId,
      actorName: input.actor.name,
      createdAt: now,
    }),
  ]);
  return { ok: true };
}

function isApprover(actor: Pick<Actor, "personId">, set: SetRow): boolean {
  return set.status === "pending_approval" && set.approverPersonId === actor.personId;
}

/** ตีกลับพร้อมความเห็น — ใช้เมื่อต้นทางผิด (Pricelist/แคตตาล็อกผิด) ผู้สร้างแก้ไฟล์แล้วออกข้อสอบใหม่ */
export async function returnToAuthor(input: { actor: Actor; setId: number; comment: string; now?: Date }): Promise<Outcome> {
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  if (!isApprover(input.actor, set)) return { ok: false, error: "ตีกลับได้เฉพาะผู้อนุมัติของชุดที่รออนุมัติ" };
  const comment = input.comment.trim();
  if (!comment) return { ok: false, error: "ตีกลับต้องมีความเห็นบอกผู้สร้างว่าต้องแก้อะไร" };
  const version = await latestVersion(set.id);
  const now = input.now ?? new Date();
  await atomic([
    db().update(learningSets).set({ status: "draft", updatedAt: now }).where(eq(learningSets.id, set.id)),
    db().insert(approvalEvents).values({
      setId: set.id,
      versionId: version?.id ?? null,
      action: "returned",
      actorPersonId: input.actor.personId,
      actorName: input.actor.name,
      comment,
      createdAt: now,
    }),
  ]);
  return { ok: true };
}

export async function approve(input: { actor: Actor; setId: number; now?: Date }): Promise<Outcome> {
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  if (!isApprover(input.actor, set)) return { ok: false, error: "อนุมัติได้เฉพาะผู้อนุมัติของชุดที่รออนุมัติ" };
  const version = await latestVersion(set.id);
  if (!version) return { ok: false, error: "ชุดนี้ยังไม่มีเอกสาร" };
  // ผู้อนุมัติแก้ข้อสอบได้ — ตรวจซ้ำตอนกดอนุมัติ ไม่เชื่อผลตรวจตอนส่ง
  const incomplete = await formsComplete(version.id, set.blueprint as Blueprint);
  if (incomplete) return { ok: false, error: incomplete };

  const now = input.now ?? new Date();
  await atomic([
    db().update(setVersions).set({ approvedAt: now }).where(eq(setVersions.id, version.id)),
    db().update(learningSets).set({ status: "active", approvedAt: now, updatedAt: now }).where(eq(learningSets.id, set.id)),
    db().insert(approvalEvents).values({
      setId: set.id,
      versionId: version.id,
      action: "approved",
      actorPersonId: input.actor.personId,
      actorName: input.actor.name,
      createdAt: now,
    }),
  ]);
  return { ok: true };
}
