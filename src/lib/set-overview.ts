import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { assignments, attempts, documents, learningSets, readingProgress, setKinds, setVersions } from "@/db/schema";
import { isVideoMime, VIDEO_SEGMENT_SECONDS } from "@/domain/document";
import { assignmentState, type AssignmentState } from "@/lib/assignment-service";
import type { Actor } from "@/lib/auth";
import { coverPath } from "@/lib/set-service";

/**
 * ภาพรวมชุดที่ปล่อยแล้ว (`/sets/released`) — ชุดที่อนุมัติแล้ว (ใช้อยู่ + ปิดแล้ว) ทีละการ์ด:
 * เนื้อหาของเวอร์ชันที่ผู้เรียนเห็น · ปล่อยเมื่อไร · ได้รับมอบกี่คน ผ่าน/กำลังเรียน/ยังไม่เริ่ม/เลยกำหนดเท่าไร
 *
 * การมองเห็นเดียวกับ `listManagedSets()` — ผู้สร้างเห็นชุดของตัวเอง · ผู้อนุมัติเห็นชุดที่ตัวเองอนุมัติ · TG เห็นทุกชุด
 * สถานะรายการมอบใช้ `assignmentState()` ตัวเดียวกับแท็บผู้เรียนของหน้าชุด — ตัวเลขบนการ์ดตรงกับในชุดเสมอ
 */

export interface ReleasedSet {
  setId: number;
  title: string;
  kindName: string;
  status: "active" | "closed";
  /** ป้ายเวอร์ชันที่ผู้เรียนเห็น เช่น "V.3 · 09/2026" — ไม่มีป้าย = "เวอร์ชัน n" */
  versionLabel: string;
  /** มีเวอร์ชันใหม่ที่ยังไม่อนุมัติ — กำลังทำ / ส่งขออนุมัติแล้ว */
  newVersion: "drafting" | "submitted" | null;
  releasedAt: Date;
  closedAt: Date | null;
  authorName: string;
  videos: number;
  videoSeconds: number;
  pdfs: number;
  pdfPages: number;
  /** ปกของคลิปแรกที่มีปก */
  coverUrl: string | null;
  learners: number;
  counts: Record<AssignmentState, number>;
}

const RELEASED = ["active", "closed"] as const;

export async function releasedSets(actor: Pick<Actor, "personId" | "role">, now: Date = new Date()): Promise<ReleasedSet[]> {
  const released = inArray(learningSets.status, [...RELEASED]);
  const sets = await db()
    .select({ set: learningSets, kindName: setKinds.name })
    .from(learningSets)
    .innerJoin(setKinds, eq(setKinds.id, learningSets.kindId))
    .where(
      actor.role === "admin"
        ? released
        : and(released, or(eq(learningSets.authorPersonId, actor.personId), eq(learningSets.approverPersonId, actor.personId))),
    );
  if (!sets.length) return [];
  const setIds = sets.map((s) => s.set.id);

  const versions = await db().select().from(setVersions).where(inArray(setVersions.setId, setIds)).orderBy(desc(setVersions.versionNo));
  const approvedOf = new Map<number, (typeof versions)[number]>();
  const latestOf = new Map<number, (typeof versions)[number]>();
  for (const v of versions) {
    if (!latestOf.has(v.setId)) latestOf.set(v.setId, v);
    if (v.approvedAt && !approvedOf.has(v.setId)) approvedOf.set(v.setId, v);
  }
  const approvedIds = [...approvedOf.values()].map((v) => v.id);
  // เอกสารที่ผู้เรียนต้องดู/อ่าน (มีจำนวนหน้า/ช่วง) — แบบเดียวกับหน้ารายการของผู้เรียน · Excel ไม่นับ
  const docs = approvedIds.length
    ? (await db().select().from(documents).where(inArray(documents.versionId, approvedIds)).orderBy(documents.sortOrder)).filter((d) => d.pageCount !== null)
    : [];

  const rows = await db()
    .select({ id: assignments.id, setId: assignments.setId, passedAt: assignments.passedAt, dueAt: assignments.dueAt })
    .from(assignments)
    .where(inArray(assignments.setId, setIds));
  // เริ่มแล้ว = มีความคืบหน้าการอ่าน หรือเคยสอบ — join ด้วย setId แทนการส่ง id การมอบทีละตัว
  const read = await db()
    .selectDistinct({ id: readingProgress.assignmentId })
    .from(readingProgress)
    .innerJoin(assignments, eq(assignments.id, readingProgress.assignmentId))
    .where(inArray(assignments.setId, setIds));
  const tried = await db()
    .selectDistinct({ id: attempts.assignmentId })
    .from(attempts)
    .innerJoin(assignments, eq(assignments.id, attempts.assignmentId))
    .where(inArray(assignments.setId, setIds));
  const started = new Set([...read, ...tried].map((r) => r.id));

  const out: ReleasedSet[] = sets.map(({ set, kindName }) => {
    const version = approvedOf.get(set.id);
    const latest = latestOf.get(set.id);
    const mine = version ? docs.filter((d) => d.versionId === version.id) : [];
    const videos = mine.filter((d) => isVideoMime(d.mimeType));
    const pdfs = mine.filter((d) => !isVideoMime(d.mimeType));
    const counts: Record<AssignmentState, number> = { passed: 0, started: 0, not_started: 0, overdue: 0 };
    let learners = 0;
    for (const a of rows) {
      if (a.setId !== set.id) continue;
      learners++;
      counts[assignmentState(a, started.has(a.id), now)]++;
    }
    const pending = latest && !latest.approvedAt ? latest : null;
    return {
      setId: set.id,
      title: set.title,
      kindName,
      status: set.status as ReleasedSet["status"],
      versionLabel: version?.label?.trim() || `เวอร์ชัน ${version?.versionNo ?? 1}`,
      newVersion: pending ? (pending.submittedAt ? "submitted" : "drafting") : null,
      // ชุดที่ใช้อยู่/ปิดแล้วมี approvedAt เสมอ (ฐานบังคับสำหรับ active) — กันแถวเก่าด้วยวันที่สร้าง
      releasedAt: set.approvedAt ?? set.createdAt,
      closedAt: set.closedAt,
      authorName: set.authorName,
      videos: videos.length,
      videoSeconds: videos.reduce((n, d) => n + (d.durationSeconds ?? (d.pageCount ?? 0) * VIDEO_SEGMENT_SECONDS), 0),
      pdfs: pdfs.length,
      pdfPages: pdfs.reduce((n, d) => n + (d.pageCount ?? 0), 0),
      coverUrl: (() => {
        const first = videos.find((d) => d.coverKey);
        return first ? coverPath(first) : null;
      })(),
      learners,
      counts,
    };
  });

  // ใช้อยู่ก่อน (ปล่อยล่าสุดก่อน) แล้วชุดที่ปิดแล้ว (ปิดล่าสุดก่อน)
  const active = out.filter((s) => s.status === "active").sort((x, y) => y.releasedAt.getTime() - x.releasedAt.getTime());
  const closed = out
    .filter((s) => s.status === "closed")
    .sort((x, y) => (y.closedAt ?? y.releasedAt).getTime() - (x.closedAt ?? x.releasedAt).getTime());
  return [...active, ...closed];
}
