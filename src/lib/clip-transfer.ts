import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { atomic } from "@/db/atomic";
import { approvalEvents, assignments, documents, documentViews, learningSets, readingProgress, setVersions } from "@/db/schema";
import { coverKey, documentKey, isDocumentMime, isVideoMime, requiredForExam } from "@/domain/document";
import type { Actor } from "@/lib/auth";
import { objectStore } from "@/lib/object-store";
import { canEditVersion, currentVersion, type Outcome, type SetRow, type VersionRow } from "@/lib/set-service";

/**
 * ย้าย/คัดลอกคลิปไปชุดการเรียนรู้อื่น — TG เท่านั้น (ADR-0022)
 *
 * ★ คัดลอกไฟล์เสมอ: วิดีโอและปกถูก copy ใน R2 เป็น key ใหม่ใต้ชุดปลายทาง (`sets/<ชุดปลายทาง>/v<n>/…`) แล้วลงแถว `documents` ใหม่
 *   ไม่ใช้ไฟล์ร่วม — `documents.object_key` unique และชุดหนึ่งถูกปิด/ลบร่างแล้วอีกชุดต้องไม่พัง
 * ★ ย้าย = คัดลอก + เอาออกจากชุดเดิม: เวอร์ชันที่ยังแก้ได้และไม่มีใครเรียน = ลบแถวและไฟล์ ·
 *   นอกนั้น = ซ่อน (`reading_progress` อ้างเอกสารแบบ restrict · `document_views` มีแต่ insert — แถวที่มีคนเรียนแล้วลบไม่ได้)
 * ★ ชุดปลายทาง: ร่าง → เวอร์ชันแรก · ใช้อยู่ → เวอร์ชันที่ผู้เรียนเห็นอยู่ (หรือเวอร์ชันใหม่ที่ยังไม่ส่ง) ·
 *   รออนุมัติ / มีเวอร์ชันใหม่รออนุมัติ / ปิด / ลบ = รับไม่ได้ (เนื้อหาที่กำลังตรวจต้องไม่เปลี่ยนเงียบ ๆ)
 * ★ คลิปที่เข้าเวอร์ชันที่ผู้เรียนเห็นอยู่ ผลเหมือนกดสวิตช์ "แสดง": คนที่ยังไม่ผ่านต้องดูก่อนสอบ · คนที่ผ่านแล้วไม่ต้องทำอะไร
 */

export type ClipLanding = "draft" | "new_version" | "live";
export type ClipSourceResult = "kept" | "hidden" | "removed";

/** detail ของประวัติ `clip_sent` (ชุดเดิม) / `clip_received` (ชุดปลายทาง) */
export interface ClipTransferDetail {
  mode: "copy" | "move";
  /** คลิปในชุดที่ลงประวัตินี้ — ชุดเดิม: คลิปเดิม · ชุดปลายทาง: คลิปใหม่ */
  documentId: number;
  fileName: string;
  otherSet: { id: number; title: string };
  /** ชุดเดิมซ่อนหรือลบคลิปเมื่อย้าย (เฉพาะ `clip_sent` ของการย้าย) */
  source?: "hidden" | "removed";
  /** คลิปลงที่ไหนของชุดปลายทาง */
  landing: ClipLanding;
}

/** ชุดที่เลือกเป็นปลายทางได้ — ให้หน้าจอบอกผลกับผู้เรียนก่อนกด */
export interface ClipTarget {
  setId: number;
  title: string;
  status: "draft" | "active";
  landing: ClipLanding;
  /** ผู้เรียนที่ยังไม่ผ่านและยังไม่ถูกตัดจบ — ต้องดูคลิปนี้ก่อนสอบเมื่อคลิปลงเวอร์ชันที่ใช้อยู่ (`live`) */
  learnersToWatch: number;
}

/** คลิปลงเวอร์ชันไหนของชุดปลายทาง · `version` null = ร่างที่ยังไม่มีเวอร์ชัน (สร้างให้ตอนลง) */
function landingOf(set: SetRow, current: VersionRow | null): { ok: true; version: VersionRow | null; landing: ClipLanding } | { ok: false; error: string } {
  if (set.status === "draft") return { ok: true, version: current, landing: "draft" };
  if (set.status === "pending_approval") return { ok: false, error: "ชุดนี้รออนุมัติอยู่ — อนุมัติหรือตีกลับก่อนแล้วค่อยเพิ่มคลิป" };
  if (set.status !== "active" || !current) return { ok: false, error: "ชุดนี้ปิดแล้ว — รับคลิปไม่ได้" };
  if (current.approvedAt) return { ok: true, version: current, landing: "live" };
  if (current.submittedAt) return { ok: false, error: "ชุดนี้มีเวอร์ชันใหม่รออนุมัติ — อนุมัติหรือตีกลับก่อนแล้วค่อยเพิ่มคลิป" };
  return { ok: true, version: current, landing: "new_version" };
}

/** ชุดที่ส่งคลิปไปได้ (ร่าง · ใช้อยู่) ยกเว้นชุดต้นทาง — เฉพาะ TG · ชุดที่รับไม่ได้ตอนนี้ (รออนุมัติ) ไม่อยู่ในรายการ */
export async function clipTargets(actor: Pick<Actor, "role">, sourceSetId: number): Promise<ClipTarget[]> {
  if (actor.role !== "admin") return [];
  const sets = await db()
    .select()
    .from(learningSets)
    .where(and(inArray(learningSets.status, ["draft", "active"]), ne(learningSets.id, sourceSetId)))
    .orderBy(desc(learningSets.updatedAt));
  if (!sets.length) return [];
  const ids = sets.map((s) => s.id);
  const versions = await db().select().from(setVersions).where(inArray(setVersions.setId, ids)).orderBy(desc(setVersions.versionNo));
  const latest = new Map<number, VersionRow>();
  for (const v of versions) if (!latest.has(v.setId)) latest.set(v.setId, v);
  const open = await db()
    .select({ setId: assignments.setId, n: sql<number>`count(*)::int` })
    .from(assignments)
    .where(and(inArray(assignments.setId, ids), isNull(assignments.passedAt), isNull(assignments.endedAt)))
    .groupBy(assignments.setId);
  const waiting = new Map(open.map((r) => [r.setId, Number(r.n)]));
  return sets.flatMap((s) => {
    const l = landingOf(s, latest.get(s.id) ?? null);
    if (!l.ok) return [];
    return [{ setId: s.id, title: s.title, status: s.status as "draft" | "active", landing: l.landing, learnersToWatch: l.landing === "live" ? (waiting.get(s.id) ?? 0) : 0 }];
  });
}

/** มีผู้เรียนเคยดู/อ่านเอกสารนี้ไหม — มีแล้วลบแถวไม่ได้ (ความคืบหน้าอ้างแบบ restrict · log การเปิดมีแต่ insert) */
async function hasLearnerRecords(documentId: number): Promise<boolean> {
  const [progress] = await db().select({ id: readingProgress.documentId }).from(readingProgress).where(eq(readingProgress.documentId, documentId)).limit(1);
  if (progress) return true;
  const [view] = await db().select({ id: documentViews.id }).from(documentViews).where(eq(documentViews.documentId, documentId)).limit(1);
  return Boolean(view);
}

/**
 * ย้ายหรือคัดลอกคลิปหนึ่งคลิปไปชุดปลายทาง — คลิปใหม่ต่อท้ายชุดปลายทาง พร้อมชื่อ · ความยาว · จำนวนช่วง · ปก · ใช้ทำอะไร
 * ลงประวัติทั้งสองชุดในคราวเดียว (`atomic`) · ลงฐานไม่สำเร็จ = ลบไฟล์ที่ copy ไว้ทิ้ง
 */
export async function transferClip(input: {
  actor: Actor;
  documentId: number;
  targetSetId: number;
  mode: "copy" | "move";
  now?: Date;
}): Promise<Outcome<{ documentId: number; targetSetId: number; landing: ClipLanding; source: ClipSourceResult }>> {
  const { actor, mode } = input;
  if (actor.role !== "admin") return { ok: false, error: "ย้าย/คัดลอกคลิปได้เฉพาะ TG" };
  if (mode !== "copy" && mode !== "move") return { ok: false, error: "เลือกย้ายหรือคัดลอก" };

  const [row] = Number.isSafeInteger(input.documentId)
    ? await db()
        .select({ doc: documents, set: learningSets })
        .from(documents)
        .innerJoin(setVersions, eq(setVersions.id, documents.versionId))
        .innerJoin(learningSets, eq(learningSets.id, setVersions.setId))
        .where(eq(documents.id, input.documentId))
    : [];
  if (!row || row.set.status === "deleted") return { ok: false, error: "ไม่พบคลิปนี้" };
  const { doc, set: source } = row;
  if (!isVideoMime(doc.mimeType) || !isDocumentMime(doc.mimeType)) return { ok: false, error: "ย้าย/คัดลอกได้เฉพาะคลิปวิดีโอ" };

  const [target] = Number.isSafeInteger(input.targetSetId) ? await db().select().from(learningSets).where(eq(learningSets.id, input.targetSetId)) : [];
  if (!target || target.status === "deleted" || target.id === source.id) return { ok: false, error: "เลือกชุดปลายทาง" };
  const landing = landingOf(target, await currentVersion(target.id));
  if (!landing.ok) return landing;

  if (landing.version) {
    const same = await db()
      .select({ hidden: documents.hidden })
      .from(documents)
      .where(and(eq(documents.versionId, landing.version.id), eq(documents.fileName, doc.fileName), eq(documents.sizeBytes, doc.sizeBytes)));
    if (same.length) {
      return { ok: false, error: `ชุด "${target.title}" มีคลิป "${doc.fileName}" อยู่แล้ว${same.some((d) => d.hidden) ? " (ซ่อนอยู่ — กดแสดงในชุดนั้นแทน)" : ""}` };
    }
  }

  // ย้าย: ชุดเดิมลบได้เฉพาะเวอร์ชันที่ยังแก้ได้และยังไม่มีใครเรียน · นอกนั้นซ่อน (ต้องเหลือเนื้อหาให้ผู้เรียนอย่างน้อย 1 รายการ)
  let sourceResult: ClipSourceResult = "kept";
  if (mode === "move") {
    if (source.status === "closed") return { ok: false, error: "ชุดนี้ปิดแล้ว — คัดลอกได้อย่างเดียว" };
    const current = await currentVersion(source.id);
    const editable = current?.id === doc.versionId && canEditVersion(actor, source, current);
    if (editable && !(await hasLearnerRecords(doc.id))) sourceResult = "removed";
    else {
      if (requiredForExam(doc)) {
        const siblings = await db().select().from(documents).where(eq(documents.versionId, doc.versionId));
        const left = siblings.filter((d) => d.id !== doc.id && requiredForExam(d));
        if (!left.length) return { ok: false, error: "ชุดนี้ต้องเหลือคลิปหรือเอกสารให้ผู้เรียนอย่างน้อย 1 รายการ — คัดลอกแทนการย้าย" };
      }
      sourceResult = "hidden";
    }
  }

  const store = objectStore();
  if (!store) return { ok: false, error: "ยังไม่ได้ตั้งที่เก็บไฟล์ (R2) บนเซิร์ฟเวอร์นี้" };
  const now = input.now ?? new Date();
  let version = landing.version;
  if (!version) {
    [version] = await db().insert(setVersions).values({ setId: target.id, versionNo: 1, changeKind: "initial", createdByPersonId: actor.personId }).returning();
  }

  // ไฟล์ก่อน แล้วค่อยลงฐาน — ลงฐานล้มก็แค่ลบไฟล์ที่ copy ไว้ · กลับกันจะได้แถวที่ชี้ไฟล์ที่ไม่มีอยู่
  const newKey = documentKey(target.id, version.versionNo, doc.mimeType, randomBytes(12).toString("hex"));
  await store.copy(doc.objectKey, newKey, doc.mimeType);
  let newCover: string | null = null;
  if (doc.coverKey) {
    const key = coverKey(newKey, randomBytes(12).toString("hex"));
    // ปกไม่ใช่เนื้อหาที่ต้องเรียน — copy ไม่ได้ก็ไปต่อ TG ตั้งปกใหม่ทีหลังได้
    newCover = await store.copy(doc.coverKey, key, "image/jpeg").then(
      () => key,
      () => null,
    );
  }

  try {
    // จอง id ของคลิปใหม่ก่อน — ประวัติของทั้งสองชุดอ้าง id นี้ได้ใน batch เดียว (atomic ใช้ผลของคำสั่งก่อนหน้าไม่ได้)
    const { rows } = await db().execute<{ id: number }>(sql`select nextval(pg_get_serial_sequence('documents', 'id'))::int as id`);
    const newId = Number(rows[0].id);
    const [{ top }] = await db().select({ top: max(documents.sortOrder) }).from(documents).where(eq(documents.versionId, version.id));
    const base = { mode, fileName: doc.fileName, landing: landing.landing } as const;
    const received: ClipTransferDetail = { ...base, documentId: newId, otherSet: { id: source.id, title: source.title } };
    const sent: ClipTransferDetail = { ...base, documentId: doc.id, otherSet: { id: target.id, title: target.title }, ...(sourceResult !== "kept" ? { source: sourceResult } : {}) };
    await atomic([
      db()
        .insert(documents)
        .values({
          id: newId,
          versionId: version.id,
          kind: doc.kind,
          objectKey: newKey,
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          sizeBytes: doc.sizeBytes,
          pageCount: doc.pageCount,
          durationSeconds: doc.durationSeconds,
          coverKey: newCover,
          coverMs: newCover ? doc.coverMs : null,
          examWeight: doc.examWeight,
          sortOrder: top === null ? 0 : top + 1,
          createdAt: now,
        }),
      db().update(learningSets).set({ updatedAt: now }).where(eq(learningSets.id, target.id)),
      db()
        .insert(approvalEvents)
        .values({ setId: target.id, versionId: version.id, action: "clip_received", actorPersonId: actor.personId, actorName: actor.name, detail: received, createdAt: now }),
      db()
        .insert(approvalEvents)
        .values({ setId: source.id, versionId: doc.versionId, action: "clip_sent", actorPersonId: actor.personId, actorName: actor.name, detail: sent, createdAt: now }),
      ...(sourceResult === "hidden" && !doc.hidden ? [db().update(documents).set({ hidden: true }).where(eq(documents.id, doc.id))] : []),
      ...(sourceResult === "removed" ? [db().delete(documents).where(eq(documents.id, doc.id))] : []),
      ...(mode === "move" ? [db().update(learningSets).set({ updatedAt: now }).where(eq(learningSets.id, source.id))] : []),
    ]);
    if (sourceResult === "removed") {
      // แถวหายแล้ว — ไฟล์เดิมลบทีหลัง ลบไม่ได้ก็แค่เหลือไฟล์ที่ไม่มีใครอ้าง (เหมือนร่างที่ลบ · ADR-0016)
      await store.delete(doc.objectKey).catch(() => undefined);
      if (doc.coverKey) await store.delete(doc.coverKey).catch(() => undefined);
    }
    return { ok: true, documentId: newId, targetSetId: target.id, landing: landing.landing, source: sourceResult };
  } catch (err) {
    await store.delete(newKey).catch(() => undefined);
    if (newCover) await store.delete(newCover).catch(() => undefined);
    throw err;
  }
}
