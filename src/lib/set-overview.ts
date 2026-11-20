import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { assignments, attempts, documents, learningSets, readingProgress, setKinds, setVersions, type SetStatus } from "@/db/schema";
import { hiddenFromLists } from "@/domain/assignment-end";
import { isVideoMime, requiredForExam, VIDEO_SEGMENT_SECONDS } from "@/domain/document";
import { assignmentState, type AssignmentState } from "@/lib/assignment-service";
import type { Actor } from "@/lib/auth";
import { coverPath } from "@/lib/set-service";
import { fetchOrg } from "@/lib/workid";

/**
 * ภาพรวมชุดการเรียนรู้ (`/sets` — การ์ด/ตาราง) — ทุกชุดที่คนนี้ทำงานด้วย ทั้งร่าง · รออนุมัติ · ใช้อยู่ · ปิดแล้ว:
 * เนื้อหา (ชุดที่ปล่อยแล้วนับเวอร์ชันที่ผู้เรียนเห็น · ยังไม่ปล่อยนับเวอร์ชันล่าสุด) · ปล่อยเมื่อไร ·
 * ได้รับมอบกี่คน ผ่าน/กำลังเรียน/ยังไม่เริ่ม/เลยกำหนดเท่าไร
 *
 * การมองเห็นเดียวกับ `listManagedSets()` — ผู้สร้างเห็นชุดของตัวเอง · ผู้อนุมัติเห็นชุดที่ตัวเองอนุมัติ · TG เห็นทุกชุด
 * สถานะรายการมอบใช้ `assignmentState()` ตัวเดียวกับแท็บผู้เรียนของหน้าชุด และไม่นับคนที่แท็บนั้นซ่อน (`hiddenFromLists()` —
 * ลาออกแล้ว · ตัดจบที่ยังไม่ผ่าน · ADR-0017) — ตัวเลขบนการ์ดตรงกับ "ผ่าน x/y" ในชุดเสมอ
 */

export interface SetOverview {
  setId: number;
  title: string;
  kindName: string;
  status: Exclude<SetStatus, "deleted">;
  /** ป้ายเวอร์ชันที่ผู้เรียนเห็น (ยังไม่ปล่อย = เวอร์ชันล่าสุด) เช่น "V.3 · 09/2026" — ไม่มีป้าย = "เวอร์ชัน n" */
  versionLabel: string;
  /** ชุดที่ปล่อยแล้วมีเวอร์ชันใหม่ที่ยังไม่อนุมัติ — กำลังทำ / ส่งขออนุมัติแล้ว */
  newVersion: "drafting" | "submitted" | null;
  /** วันที่อนุมัติครั้งแรก · null = ยังไม่ปล่อย (ร่าง/รออนุมัติ) */
  releasedAt: Date | null;
  closedAt: Date | null;
  updatedAt: Date;
  authorPersonId: number;
  authorName: string;
  approverName: string | null;
  videos: number;
  videoSeconds: number;
  pdfs: number;
  pdfPages: number;
  /** ปกของคลิปแรกที่มีปก */
  coverUrl: string | null;
  learners: number;
  counts: Record<AssignmentState, number>;
}

/** ชุดที่ปล่อยแล้ว (ใช้อยู่ + ปิดแล้ว) — รูปเดิมของภาพรวม · วันที่ปล่อยมีเสมอ */
export interface ReleasedSet extends Omit<SetOverview, "status" | "releasedAt"> {
  status: "active" | "closed";
  releasedAt: Date;
}

const LIVE = ["draft", "pending_approval", "active", "closed"] as const;
const RELEASED = ["active", "closed"] as const;

/** ทุกชุดที่คนนี้ทำงานด้วย — รออนุมัติก่อน แล้วร่าง (แก้ล่าสุดก่อน) · ใช้อยู่ (ปล่อยล่าสุดก่อน) · ปิดแล้ว (ปิดล่าสุดก่อน) */
export async function setsOverview(actor: Pick<Actor, "personId" | "role">, now: Date = new Date()): Promise<SetOverview[]> {
  return overview(actor, LIVE, now);
}

/** เฉพาะชุดที่ปล่อยแล้ว (ใช้อยู่ + ปิดแล้ว) — ใช้อยู่ก่อน (ปล่อยล่าสุดก่อน) แล้วชุดที่ปิดแล้ว */
export async function releasedSets(actor: Pick<Actor, "personId" | "role">, now: Date = new Date()): Promise<ReleasedSet[]> {
  const rows = await overview(actor, RELEASED, now);
  // ชุดที่ใช้อยู่/ปิดแล้วมี approvedAt เสมอ (ฐานบังคับสำหรับ active) — กันแถวเก่าด้วยวันที่แก้ล่าสุด
  return rows.map((s) => ({ ...s, status: s.status as ReleasedSet["status"], releasedAt: s.releasedAt ?? s.updatedAt }));
}

async function overview(actor: Pick<Actor, "personId" | "role">, statuses: readonly SetStatus[], now: Date): Promise<SetOverview[]> {
  const inStatus = inArray(learningSets.status, [...statuses]);
  const sets = await db()
    .select({ set: learningSets, kindName: setKinds.name })
    .from(learningSets)
    .innerJoin(setKinds, eq(setKinds.id, learningSets.kindId))
    .where(
      actor.role === "admin"
        ? inStatus
        : and(inStatus, or(eq(learningSets.authorPersonId, actor.personId), eq(learningSets.approverPersonId, actor.personId))),
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
  // เวอร์ชันที่การ์ดนับเนื้อหา — ปล่อยแล้ว = ที่ผู้เรียนเห็น · ยังไม่ปล่อย = ล่าสุดที่กำลังทำ
  const shownOf = new Map<number, (typeof versions)[number]>();
  for (const { set } of sets) {
    const v = approvedOf.get(set.id) ?? latestOf.get(set.id);
    if (v) shownOf.set(set.id, v);
  }
  const shownIds = [...shownOf.values()].map((v) => v.id);
  // เอกสารที่ผู้เรียนต้องดู/อ่าน (มีจำนวนหน้า/ช่วง) — แบบเดียวกับหน้ารายการของผู้เรียน · Excel ไม่นับ · ที่ซ่อนไว้และเอกสารประกอบไม่นับ
  const docs = shownIds.length
    ? (await db().select().from(documents).where(inArray(documents.versionId, shownIds)).orderBy(documents.sortOrder)).filter(requiredForExam)
    : [];

  // ชุดที่ยังไม่ปล่อยไม่มีการมอบ — ไม่ต้องถามผัง
  const releasedIds = sets.filter(({ set }) => set.status === "active" || set.status === "closed").map(({ set }) => set.id);
  const counted = releasedIds.length ? await assignmentCounts(releasedIds, now) : new Map<number, { learners: number; counts: Record<AssignmentState, number> }>();

  const out: SetOverview[] = sets.map(({ set, kindName }) => {
    const shown = shownOf.get(set.id);
    const latest = latestOf.get(set.id);
    const mine = shown ? docs.filter((d) => d.versionId === shown.id) : [];
    const videos = mine.filter((d) => isVideoMime(d.mimeType));
    const pdfs = mine.filter((d) => !isVideoMime(d.mimeType));
    const released = set.status === "active" || set.status === "closed";
    const pending = released && latest && !latest.approvedAt ? latest : null;
    const c = counted.get(set.id);
    return {
      setId: set.id,
      title: set.title,
      kindName,
      status: set.status as SetOverview["status"],
      versionLabel: shown?.label?.trim() || `เวอร์ชัน ${shown?.versionNo ?? 1}`,
      newVersion: pending ? (pending.submittedAt ? "submitted" : "drafting") : null,
      releasedAt: released ? (set.approvedAt ?? set.createdAt) : null,
      closedAt: set.closedAt,
      updatedAt: set.updatedAt,
      authorPersonId: set.authorPersonId,
      authorName: set.authorName,
      approverName: set.approverName,
      videos: videos.length,
      videoSeconds: videos.reduce((n, d) => n + (d.durationSeconds ?? (d.pageCount ?? 0) * VIDEO_SEGMENT_SECONDS), 0),
      pdfs: pdfs.length,
      pdfPages: pdfs.reduce((n, d) => n + (d.pageCount ?? 0), 0),
      coverUrl: (() => {
        const first = videos.find((d) => d.coverKey);
        return first ? coverPath(first) : null;
      })(),
      learners: c?.learners ?? 0,
      counts: c?.counts ?? { passed: 0, started: 0, not_started: 0, overdue: 0 },
    };
  });

  const by = (s: SetOverview["status"]) => out.filter((x) => x.status === s);
  const newest = (f: (x: SetOverview) => Date) => (x: SetOverview, y: SetOverview) => f(y).getTime() - f(x).getTime();
  return [
    ...by("pending_approval").sort(newest((x) => x.updatedAt)),
    ...by("draft").sort(newest((x) => x.updatedAt)),
    ...by("active").sort(newest((x) => x.releasedAt ?? x.updatedAt)),
    ...by("closed").sort(newest((x) => x.closedAt ?? x.releasedAt ?? x.updatedAt)),
  ];
}

/** จำนวนผู้ได้รับมอบต่อชุด แยกตามสถานะ — ไม่นับคนที่แท็บผู้เรียนซ่อน */
async function assignmentCounts(setIds: number[], now: Date) {
  // ถามผังไม่ได้ = null → ไม่ซ่อนใครเพราะ "ไม่อยู่ในผัง" (แบบเดียวกับแท็บผู้เรียน) · fetchOrg จำไว้ 5 นาที
  const org = await fetchOrg(now.getTime());
  const inOrg = org.ok ? new Set(org.people.map((p) => p.personId)) : null;
  const rows = (
    await db()
      .select({ id: assignments.id, setId: assignments.setId, personId: assignments.personId, passedAt: assignments.passedAt, dueAt: assignments.dueAt, endedAt: assignments.endedAt })
      .from(assignments)
      .where(inArray(assignments.setId, setIds))
  ).filter((a) => !hiddenFromLists(a, inOrg));
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
  const out = new Map<number, { learners: number; counts: Record<AssignmentState, number> }>();
  for (const a of rows) {
    const c = out.get(a.setId) ?? { learners: 0, counts: { passed: 0, started: 0, not_started: 0, overdue: 0 } };
    c.learners++;
    c.counts[assignmentState(a, started.has(a.id), now)]++;
    out.set(a.setId, c);
  }
  return out;
}
