import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { atomic } from "@/db/atomic";
import {
  adhocGroupMembers,
  approvalEvents,
  assignments,
  attempts,
  audienceRules,
  learningSets,
  onboardingPaths,
  readingProgress,
  AUDIENCE_KINDS,
  type AudienceKind,
} from "@/db/schema";
import { resolveAudience, type AudienceRule } from "@/domain/audience";
import type { Actor } from "@/lib/auth";
import { sendToGroup, sendToPerson, type SendResult } from "@/lib/deliver";
import { canEditDraft, type Outcome } from "@/lib/set-service";
import { bangkokDate, bangkokParts, formatBangkok } from "@/lib/time";
import { fetchOrg, type OrgPerson } from "@/lib/workid";

/**
 * ผู้รับ → การมอบ → แจ้งเตือน (spec §5 · §6 · §11)
 *
 * ★ การมอบเกิดจากรอบ sync (ตอนอนุมัติ + cron รายวัน) ไม่ใช่ครั้งเดียวตอนอนุมัติ —
 *   คนที่เข้าตำแหน่ง/ทีมทีหลังได้รับมอบด้วย และกำหนดส่งนับจากวันที่เขาได้รับมอบ
 * ★ ถามผังไม่ได้ = ไม่มอบอะไรรอบนั้น (ไม่ใช่มอบจากผังเก่า หรือถือว่าไม่มีใคร)
 * ★ คนที่พ้นสภาพหายจากผังเอง — การมอบเดิมค้างไว้ แต่ไม่ถูกเตือนและไม่นับเป็นคนค้าง
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** วันที่เตือน — นับจากวันที่ได้รับมอบ (spec §11) */
export const REMIND_DAY3 = 3;
export const REMIND_DAY5 = 5;

function appUrl(path = "/"): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? "";
  return `${base}${path}`;
}

// ── ผู้รับ ─────────────────────────────────────────────────────────────────

export interface AudienceInput {
  kind: string;
  refId: number;
  label: string;
}

/** แทนเงื่อนไขผู้รับทั้งชุด — ตอนร่างเท่านั้น (อนุมัติแล้วเปลี่ยนผู้รับ = slice ถัดไป) */
export async function setAudience(input: { actor: Actor; setId: number; rules: AudienceInput[] }): Promise<Outcome> {
  const [set] = await db().select().from(learningSets).where(eq(learningSets.id, input.setId));
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  if (!canEditDraft(input.actor, set)) return { ok: false, error: "แก้ผู้รับได้เฉพาะชุดร่างของตัวเอง" };
  const seen = new Set<string>();
  const rows: (typeof audienceRules.$inferInsert)[] = [];
  for (const r of input.rules) {
    if (!AUDIENCE_KINDS.includes(r.kind as AudienceKind)) return { ok: false, error: `ไม่รู้จักเงื่อนไข ${r.kind}` };
    if (!Number.isInteger(r.refId) || r.refId <= 0) return { ok: false, error: "เงื่อนไขผู้รับไม่ถูกต้อง" };
    const key = `${r.kind}:${r.refId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ setId: set.id, kind: r.kind as AudienceKind, refId: r.refId, label: r.label.trim().slice(0, 200) || key });
  }
  await atomic([
    db().delete(audienceRules).where(eq(audienceRules.setId, set.id)),
    ...(rows.length ? [db().insert(audienceRules).values(rows)] : []),
  ]);
  return { ok: true };
}

async function adhocMembersOf(rules: readonly AudienceRule[]): Promise<Map<number, Set<number>>> {
  const groupIds = rules.filter((r) => r.kind === "adhoc_group").map((r) => r.refId);
  const out = new Map<number, Set<number>>();
  if (!groupIds.length) return out;
  const rows = await db().select().from(adhocGroupMembers).where(inArray(adhocGroupMembers.groupId, groupIds));
  for (const r of rows) out.set(r.groupId, (out.get(r.groupId) ?? new Set()).add(r.personId));
  return out;
}

/** รายชื่อคนที่ตรงเงื่อนไขตอนนี้ — หน้าเลือกผู้รับแสดงก่อนส่ง (spec §5) */
export async function previewAudience(setId: number): Promise<{ ok: true; people: OrgPerson[] } | { ok: false; error: string }> {
  const org = await fetchOrg();
  if (!org.ok) return { ok: false, error: `ดึงผังจาก WorkID ไม่ได้ (${org.why})` };
  const rules = await db().select().from(audienceRules).where(eq(audienceRules.setId, setId));
  return { ok: true, people: resolveAudience(org.people, rules, await adhocMembersOf(rules)) };
}

// ── การมอบ ─────────────────────────────────────────────────────────────────

export interface SyncResult {
  ok: boolean;
  why?: string;
  assigned: number;
  notified: Record<SendResult, number>;
}

function tally(results: SendResult[]): Record<SendResult, number> {
  const t: Record<SendResult, number> = { sent: 0, failed: 0, skipped: 0, duplicate: 0 };
  for (const r of results) t[r] += 1;
  return t;
}

/**
 * มอบชุดที่ใช้อยู่ให้คนที่ตรงเงื่อนไขแต่ยังไม่ได้รับมอบ (จากผู้รับ + เส้นทาง Onboarding) แล้วแจ้งวันที่ 0
 * `setId` = เฉพาะชุดนั้น (ตอนอนุมัติ) · ไม่ใส่ = ทุกชุดที่ใช้อยู่ (cron)
 */
export async function syncAssignments(input: { now?: Date; setId?: number } = {}): Promise<SyncResult> {
  const now = input.now ?? new Date();
  const org = await fetchOrg(now.getTime());
  if (!org.ok) return { ok: false, why: `workid_org_${org.why}`, assigned: 0, notified: tally([]) };

  const sets = await db()
    .select()
    .from(learningSets)
    .where(input.setId ? and(eq(learningSets.status, "active"), eq(learningSets.id, input.setId)) : eq(learningSets.status, "active"));
  if (!sets.length) return { ok: true, assigned: 0, notified: tally([]) };
  const setIds = sets.map((s) => s.id);

  const rules = await db().select().from(audienceRules).where(inArray(audienceRules.setId, setIds));
  const paths = await db().select().from(onboardingPaths).where(inArray(onboardingPaths.setId, setIds));
  const adhoc = await adhocMembersOf(rules);
  const existing = await db()
    .select({ setId: assignments.setId, personId: assignments.personId })
    .from(assignments)
    .where(inArray(assignments.setId, setIds));
  const have = new Set(existing.map((e) => `${e.setId}:${e.personId}`));

  const toInsert: (typeof assignments.$inferInsert)[] = [];
  for (const set of sets) {
    const viaAudience = resolveAudience(org.people, rules.filter((r) => r.setId === set.id), adhoc);
    const positionIds = new Set(paths.filter((p) => p.setId === set.id).map((p) => p.positionId));
    const viaOnboarding = org.people.filter((p) => p.positionId !== null && positionIds.has(p.positionId));
    for (const [people, source] of [
      [viaAudience, "audience"],
      [viaOnboarding, "onboarding"],
    ] as const) {
      for (const p of people) {
        const key = `${set.id}:${p.personId}`;
        if (have.has(key)) continue;
        have.add(key);
        toInsert.push({
          setId: set.id,
          personId: p.personId,
          personName: p.name,
          source,
          assignedAt: now,
          dueAt: new Date(now.getTime() + set.dueDays * DAY_MS),
        });
      }
    }
  }
  if (!toInsert.length) return { ok: true, assigned: 0, notified: tally([]) };

  // ON CONFLICT DO NOTHING — สองรอบ sync ที่ชนกันไม่มอบซ้ำ และแจ้งเฉพาะแถวที่รอบนี้ลงได้จริง
  const inserted = await db().insert(assignments).values(toInsert).onConflictDoNothing().returning();
  const titles = new Map(sets.map((s) => [s.id, s.title]));
  const results = await Promise.all(
    inserted.map((a) =>
      sendToPerson(
        {
          dedupeKey: `assigned:${a.id}`,
          kind: "assigned",
          personId: a.personId,
          setId: a.setId,
          assignmentId: a.id,
          text: `📚 ชุดการเรียนรู้ใหม่: ${titles.get(a.setId)}\nเรียนแล้วสอบให้ผ่าน 80% ภายใน ${formatBangkok(a.dueAt)}\n${appUrl()}`,
        },
        org.people,
      ),
    ),
  );
  return { ok: true, assigned: inserted.length, notified: tally(results) };
}

// ── เตือน ──────────────────────────────────────────────────────────────────

function isMonday(now: Date): boolean {
  const p = bangkokParts(now);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() === 1;
}

export interface ReminderResult {
  ok: boolean;
  why?: string;
  day3: Record<SendResult, number>;
  day5: Record<SendResult, number>;
  overdue: Record<SendResult, number>;
}

/**
 * เตือนแบบไล่ระดับ (spec §11) — รันวันละครั้งตอนเช้า
 * - วันที่ 3 ถ้ายังไม่เริ่ม (ไม่มีการอ่าน ไม่มีการสอบ) → ตัวต่อตัว
 * - วันที่ 5 ถ้ายังไม่ผ่าน → กลุ่ม LINE ประจำตัว (มีหัวหน้าอยู่ด้วย) · ไม่มีกลุ่ม = ตัวต่อตัวแทน
 * - เลยกำหนดส่ง → สรุปให้หัวหน้าแต่ละคนทุกวันจันทร์
 *
 * ★ dedupe ต่อการมอบ — cron รันซ้ำวันเดียวกันไม่เตือนซ้ำ · ส่งล้ม (`failed`) รอบถัดไปลองใหม่ให้เอง
 * ★ ส่วน "สรุปให้ TG" ยังไม่ทำ: role `admin` ของแอปอยู่ที่ WorkID ยังไม่มี API ที่ WorkTrain ใช้ถามรายชื่อ
 */
export async function runReminders(input: { now?: Date } = {}): Promise<ReminderResult> {
  const now = input.now ?? new Date();
  const empty = { day3: tally([]), day5: tally([]), overdue: tally([]) };
  const org = await fetchOrg(now.getTime());
  if (!org.ok) return { ok: false, why: `workid_org_${org.why}`, ...empty };
  const inOrg = new Map(org.people.map((p) => [p.personId, p]));

  const open = await db()
    .select({ a: assignments, title: learningSets.title })
    .from(assignments)
    .innerJoin(learningSets, eq(learningSets.id, assignments.setId))
    .where(and(eq(learningSets.status, "active"), isNull(assignments.passedAt)));
  // คนที่หายจากผัง (พ้นสภาพ) ไม่เตือนและไม่นับเป็นคนค้าง
  const live = open.filter((r) => inOrg.has(r.a.personId));
  if (!live.length) return { ok: true, ...empty };

  const ids = live.map((r) => r.a.id);
  const read = await db().selectDistinct({ id: readingProgress.assignmentId }).from(readingProgress).where(inArray(readingProgress.assignmentId, ids));
  const tried = await db().selectDistinct({ id: attempts.assignmentId }).from(attempts).where(inArray(attempts.assignmentId, ids));
  const started = new Set([...read, ...tried].map((r) => r.id));
  const ageDays = (a: { assignedAt: Date }) => Math.floor((now.getTime() - a.assignedAt.getTime()) / DAY_MS);

  const day3 = live.filter((r) => ageDays(r.a) >= REMIND_DAY3 && !started.has(r.a.id) && r.a.dueAt > now);
  const day5 = live.filter((r) => ageDays(r.a) >= REMIND_DAY5 && r.a.dueAt > now);
  const overdue = live.filter((r) => r.a.dueAt <= now);

  const day3Results = await Promise.all(
    day3.map((r) =>
      sendToPerson(
        {
          dedupeKey: `remind-day3:${r.a.id}`,
          kind: "remind_day3",
          personId: r.a.personId,
          setId: r.a.setId,
          assignmentId: r.a.id,
          text: `⏰ ยังไม่ได้เริ่มเรียน: ${r.title}\nกำหนดส่ง ${formatBangkok(r.a.dueAt)}\n${appUrl()}`,
        },
        org.people,
      ),
    ),
  );

  const day5Results = await Promise.all(
    day5.map(async (r) => {
      const p = inOrg.get(r.a.personId)!;
      const msg = {
        dedupeKey: `remind-day5:${r.a.id}`,
        kind: "remind_day5" as const,
        personId: r.a.personId,
        setId: r.a.setId,
        assignmentId: r.a.id,
        text: `⚠️ ${p.nickname ?? p.name} ยังสอบไม่ผ่าน: ${r.title}\nกำหนดส่ง ${formatBangkok(r.a.dueAt)}\n${appUrl()}`,
      };
      return p.lineGroupId ? sendToGroup({ ...msg, lineGroupId: p.lineGroupId }) : sendToPerson(msg, org.people);
    }),
  );

  let overdueResults: SendResult[] = [];
  if (isMonday(now)) {
    const byManager = new Map<number, typeof overdue>();
    for (const r of overdue) {
      const boss = inOrg.get(r.a.personId)?.managerPersonId;
      if (boss) byManager.set(boss, [...(byManager.get(boss) ?? []), r]);
    }
    const ymd = bangkokDate(now);
    overdueResults = await Promise.all(
      [...byManager.entries()].map(([boss, rows]) =>
        sendToPerson(
          {
            dedupeKey: `overdue:${boss}:${ymd}`,
            kind: "overdue_summary",
            personId: boss,
            text: [`📋 ลูกทีมที่เลยกำหนดส่งและยังสอบไม่ผ่าน (${rows.length})`, ...rows.map((r) => `- ${r.a.personName} · ${r.title}`)].join("\n"),
          },
          org.people,
        ),
      ),
    );
  }

  return { ok: true, day3: tally(day3Results), day5: tally(day5Results), overdue: tally(overdueResults) };
}

// ── แจ้งเรื่องการอนุมัติ ────────────────────────────────────────────────────

/**
 * แจ้งคนที่ต้องทำต่อหลังเหตุการณ์อนุมัติ — ส่ง → ผู้อนุมัติ · ตีกลับ/อนุมัติ → ผู้สร้าง
 * ส่งไม่ได้ไม่ทำให้การอนุมัติล้ม (บันทึกผลไว้ใน `notifications` แล้ว)
 */
export async function notifyApprovalEvent(eventId: number): Promise<SendResult | null> {
  const [row] = await db()
    .select({ e: approvalEvents, set: learningSets })
    .from(approvalEvents)
    .innerJoin(learningSets, eq(learningSets.id, approvalEvents.setId))
    .where(eq(approvalEvents.id, eventId));
  if (!row) return null;
  const { e, set } = row;
  const link = appUrl(`/sets/${set.id}`);
  const plan =
    e.action === "submitted" && set.approverPersonId
      ? { kind: "approval_requested" as const, to: set.approverPersonId, text: `📝 ${set.authorName} ส่งข้อสอบให้ตรวจ: ${set.title}\n${link}` }
      : e.action === "returned"
        ? { kind: "approval_returned" as const, to: set.authorPersonId, text: `↩️ ${e.actorName} ตีกลับ: ${set.title}\n${e.comment ?? ""}\n${link}` }
        : e.action === "approved"
          ? { kind: "approval_approved" as const, to: set.authorPersonId, text: `✅ ${e.actorName} อนุมัติแล้ว: ${set.title}\n${link}` }
          : null;
  if (!plan) return null;
  const org = await fetchOrg();
  return sendToPerson(
    { dedupeKey: `approval:${e.id}`, kind: plan.kind, personId: plan.to, setId: set.id, text: plan.text },
    org.ok ? org.people : [],
  );
}

// ── อ่าน ───────────────────────────────────────────────────────────────────

export async function audienceRulesOf(setId: number) {
  return db().select().from(audienceRules).where(eq(audienceRules.setId, setId));
}

export type AssignmentState = "passed" | "started" | "not_started" | "overdue";

/** สถานะรายคนของชุดหนึ่ง — หน้าชุดของผู้สร้าง/ผู้อนุมัติ/TG (spec §12 ส่วนแรก) */
export async function assignmentStatus(setId: number, now: Date = new Date()) {
  const rows = await db().select().from(assignments).where(eq(assignments.setId, setId)).orderBy(assignments.personName);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const read = await db().selectDistinct({ id: readingProgress.assignmentId }).from(readingProgress).where(inArray(readingProgress.assignmentId, ids));
  const tried = await db().select({ id: attempts.assignmentId }).from(attempts).where(inArray(attempts.assignmentId, ids));
  const started = new Set([...read.map((r) => r.id), ...tried.map((r) => r.id)]);
  const attemptCount = new Map<number, number>();
  for (const t of tried) attemptCount.set(t.id, (attemptCount.get(t.id) ?? 0) + 1);
  return rows.map((r) => {
    const state: AssignmentState = r.passedAt ? "passed" : r.dueAt <= now ? "overdue" : started.has(r.id) ? "started" : "not_started";
    return { ...r, state, attempts: attemptCount.get(r.id) ?? 0 };
  });
}
