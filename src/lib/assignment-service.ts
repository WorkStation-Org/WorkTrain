import { createHash } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { atomic } from "@/db/atomic";
import {
  adhocGroupMembers,
  approvalEvents,
  assignments,
  attempts,
  audienceRules,
  learningSets,
  notifications,
  onboardingPaths,
  readingProgress,
  AUDIENCE_KINDS,
  END_REASONS,
  type AudienceKind,
} from "@/db/schema";
import { endGuardTripped, planEnds } from "@/domain/assignment-end";
import { resolveAudience, type AudienceRule } from "@/domain/audience";
import type { Actor } from "@/lib/auth";
import { markCoveredBy, markSkippedBy, MAX_SEND_ATTEMPTS, sendToGroup, sendToPerson, type NotificationKind, type SendResult } from "@/lib/deliver";
import { audienceMode, type Outcome } from "@/lib/set-service";
import { ageInDays, bangkokDate, bangkokParts, formatBangkok } from "@/lib/time";
import { fetchOrg, fetchRolePeople, type OrgPerson } from "@/lib/workid";

/**
 * ผู้รับ → การมอบ → แจ้งเตือน (spec §5 · §6 · §11)
 *
 * ★ การมอบเกิดจากรอบ sync (ตอนอนุมัติ + cron รายวัน) ไม่ใช่ครั้งเดียวตอนอนุมัติ —
 *   คนที่เข้าตำแหน่ง/ทีมทีหลังได้รับมอบด้วย และกำหนดส่งนับจากวันที่เขาได้รับมอบ
 * ★ ถามผังไม่ได้ = ไม่มอบอะไรรอบนั้น (ไม่ใช่มอบจากผังเก่า หรือถือว่าไม่มีใคร)
 * ★ คนที่ไม่ตรงเงื่อนไขแล้ว (ลาออก · ย้ายทีม · ผู้สร้างแก้เงื่อนไข) ถูกตัดจบในรอบ sync — ไม่ลบแถว · กลับมาตรง = เปิดใหม่ (ADR-0017)
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

/**
 * แทนเงื่อนไขผู้รับทั้งชุด (`audienceMode`)
 * - ผู้สร้าง/TG: ร่าง · ใช้อยู่ (TG รออนุมัติได้ด้วย) — แก้ได้ทุกเงื่อนไข
 * - ผู้อนุมัติ: รออนุมัติ · ใช้อยู่ — เพิ่มได้ · ลบได้เฉพาะที่ตัวเองเพิ่ม (ADR-0018)
 * ชุดที่ใช้อยู่: มอบให้คนที่ตรงเงื่อนไขใหม่ทันที · คนที่หลุดเงื่อนไขถูกตัดจบทันที (ADR-0017)
 * ลงประวัติเมื่อชุดใช้อยู่ หรือผู้อนุมัติแก้ (ทุกสถานะ) · `eventId` ให้ผู้เรียกส่งต่อ `notifyApprovalEvent` (ผู้อนุมัติแก้ = แจ้งผู้สร้าง)
 */
export async function setAudience(input: {
  actor: Actor;
  setId: number;
  rules: AudienceInput[];
  now?: Date;
}): Promise<Outcome<{ assigned: number; ended: number; reopened: number; eventId: number | null }>> {
  const [set] = await db().select().from(learningSets).where(eq(learningSets.id, input.setId));
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  const mode = audienceMode(input.actor, set);
  if (!mode) return { ok: false, error: "แก้ผู้รับได้เฉพาะผู้สร้าง/TG (ร่าง · ชุดที่ใช้อยู่) หรือผู้อนุมัติ (รออนุมัติ · ชุดที่ใช้อยู่)" };
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
  const ruleKey = (r: { kind: string; refId: number }) => `${r.kind}:${r.refId}`;
  const existing = await db().select().from(audienceRules).where(eq(audienceRules.setId, set.id));
  const before = new Map(existing.map((r) => [ruleKey(r), r]));
  const wanted = new Set(rows.map(ruleKey));
  if (mode === "addOnly") {
    const locked = existing.filter((r) => r.addedByPersonId !== input.actor.personId && !wanted.has(ruleKey(r)));
    if (locked.length) return { ok: false, error: `ผู้อนุมัติเอาเงื่อนไขที่ผู้สร้างตั้งไว้ออกไม่ได้: ${locked.map((r) => r.label).join(" · ")}` };
  }
  // ใครเพิ่มเงื่อนไขนี้ — แถวเดิมคงค่าเดิม · แถวใหม่ = คนกด ถ้าไม่ใช่ผู้สร้าง (ผู้อนุมัติลบได้เฉพาะของตัวเอง)
  // ★ ใช้ `has` ไม่ใช่ `??` — แถวเดิมของผู้สร้างเก็บ null ไว้ และต้องคงเป็น null
  for (const r of rows) {
    const prev = before.get(ruleKey(r));
    r.addedByPersonId = prev ? prev.addedByPersonId : input.actor.personId === set.authorPersonId ? null : input.actor.personId;
  }
  const added = rows.filter((r) => !before.has(ruleKey(r)));
  const removed = existing.filter((r) => !wanted.has(ruleKey(r)));
  await atomic([
    db().delete(audienceRules).where(eq(audienceRules.setId, set.id)),
    ...(rows.length ? [db().insert(audienceRules).values(rows)] : []),
  ]);

  const now = input.now ?? new Date();
  const byApprover = mode === "addOnly";
  let eventId: number | null = null;
  if ((added.length || removed.length) && (set.status === "active" || byApprover)) {
    const gained = byApprover ? await gainedPeople(existing, rows) : null;
    const change = [added.length && `เพิ่ม ${added.map((r) => r.label).join(" · ")}`, removed.length && `เอาออก ${removed.map((r) => r.label).join(" · ")}`].filter(Boolean).join(" · ");
    const [ev] = await db()
      .insert(approvalEvents)
      .values({
        setId: set.id,
        action: "audience_changed",
        actorPersonId: input.actor.personId,
        actorName: input.actor.name,
        comment: byApprover ? `${change}${gained ? ` (+${gained} คน)` : ""}` : rows.map((r) => r.label).join(" · ") || "ไม่มีเงื่อนไข",
        detail: byApprover ? { by: "approver", added: added.map((r) => r.label), removed: removed.map((r) => r.label), gained } : null,
        createdAt: now,
      })
      .returning({ id: approvalEvents.id });
    eventId = ev.id;
  }
  if (set.status !== "active") return { ok: true, assigned: 0, ended: 0, reopened: 0, eventId };
  // คนกดเห็นจำนวนที่จะตัดจบแล้วยืนยัน (หน้าเลือกผู้รับ) — ไม่ผ่านด่านกันผังเพี้ยนของรอบอัตโนมัติ
  const sync = await syncAssignments({ setId: set.id, now, guard: false });
  return { ok: true, assigned: sync.assigned, ended: sync.ended, reopened: sync.reopened, eventId };
}

/** คนที่ตรงเงื่อนไขเพิ่มขึ้นจากการแก้ผู้รับ (ข้อความแจ้งผู้สร้าง "+8 คน") · ถามผังไม่ได้ = null */
async function gainedPeople(beforeRules: readonly AudienceRule[], afterRules: readonly AudienceRule[]): Promise<number | null> {
  const org = await fetchOrg();
  if (!org.ok) return null;
  const adhoc = await adhocMembersOf([...beforeRules, ...afterRules]);
  const had = new Set(resolveAudience(org.people, beforeRules, adhoc).map((p) => p.personId));
  return resolveAudience(org.people, afterRules, adhoc).filter((p) => !had.has(p.personId)).length;
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
  /** ตัดจบรอบนี้ — ไม่ตรงเงื่อนไขผู้รับแล้ว (ลาออก · ย้ายทีม · ผู้สร้างแก้เงื่อนไข) */
  ended: number;
  /** เปิดการมอบเดิมใหม่ — กลับมาตรงเงื่อนไข */
  reopened: number;
  /** ด่านกันผังเพี้ยนหยุดการตัดจบรอบนี้ไว้ — จำนวนที่จะตัด (ไม่มี = ไม่ได้หยุด) */
  heldEnds?: number;
  notified: Record<SendResult, number>;
}

function tally(results: SendResult[]): Record<SendResult, number> {
  const t: Record<SendResult, number> = { sent: 0, failed: 0, skipped: 0, duplicate: 0 };
  for (const r of results) t[r] += 1;
  return t;
}

type AssignmentRow = typeof assignments.$inferSelect;

/** dedupe key ต่อการมอบต่อรอบที่ได้รับมอบ — รอบแรกใช้คีย์เดิม (`remind-day3:12`) · เปิดใหม่ต่อท้ายรอบ (`remind-day3:12:r2`) */
function roundKey(prefix: string, a: Pick<AssignmentRow, "id" | "assignRound">): string {
  return a.assignRound > 1 ? `${prefix}:${a.id}:r${a.assignRound}` : `${prefix}:${a.id}`;
}

/** ข้อความวันที่ 0 — รอบแรก "ชุดใหม่" · เปิดใหม่ "ได้รับมอบอีกครั้ง" */
function dayZeroKey(a: Pick<AssignmentRow, "id" | "assignRound">): string {
  return a.assignRound > 1 ? `reassigned:${a.id}:r${a.assignRound}` : `assigned:${a.id}`;
}

/**
 * มอบชุดที่ใช้อยู่ให้คนที่ตรงเงื่อนไขแต่ยังไม่ได้รับมอบ (จากผู้รับ + เส้นทาง Onboarding) · ตัดจบคนที่ไม่ตรงแล้ว ·
 * เปิดใหม่ให้คนที่กลับมาตรง · แล้วแจ้งทาง LINE (รวมต่อคน)
 * `setId` = เฉพาะชุดนั้น (ตอนอนุมัติ · ตอนบันทึกผู้รับ) · ไม่ใส่ = ทุกชุดที่ใช้อยู่ (cron)
 * `guard: false` = ไม่ผ่านด่านกันผังเพี้ยน — ใช้ตอนกดบันทึกผู้รับเอง (เห็นจำนวนแล้วยืนยัน)
 */
export async function syncAssignments(input: { now?: Date; setId?: number; guard?: boolean } = {}): Promise<SyncResult> {
  const now = input.now ?? new Date();
  const empty = { assigned: 0, ended: 0, reopened: 0, notified: tally([]) };
  const org = await fetchOrg(now.getTime());
  if (!org.ok) return { ok: false, why: `workid_org_${org.why}`, ...empty };

  const sets = await db()
    .select()
    .from(learningSets)
    .where(input.setId ? and(eq(learningSets.status, "active"), eq(learningSets.id, input.setId)) : eq(learningSets.status, "active"));
  if (!sets.length) return { ok: true, ...empty };
  const setIds = sets.map((s) => s.id);
  const setById = new Map(sets.map((s) => [s.id, s]));

  const rules = await db().select().from(audienceRules).where(inArray(audienceRules.setId, setIds));
  const paths = await db().select().from(onboardingPaths).where(inArray(onboardingPaths.setId, setIds));
  const adhoc = await adhocMembersOf(rules);
  const existing = await db().select().from(assignments).where(inArray(assignments.setId, setIds));
  const have = new Set(existing.map((e) => `${e.setId}:${e.personId}`));

  const eligible = new Map<number, Set<number>>();
  const toInsert: (typeof assignments.$inferInsert)[] = [];
  for (const set of sets) {
    const viaAudience = resolveAudience(org.people, rules.filter((r) => r.setId === set.id), adhoc);
    const positionIds = new Set(paths.filter((p) => p.setId === set.id).map((p) => p.positionId));
    const viaOnboarding = org.people.filter((p) => p.positionId !== null && positionIds.has(p.positionId));
    eligible.set(set.id, new Set([...viaAudience, ...viaOnboarding].map((p) => p.personId)));
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
  // ON CONFLICT DO NOTHING — สองรอบ sync ที่ชนกันไม่มอบซ้ำ
  const inserted = toInsert.length ? await db().insert(assignments).values(toInsert).onConflictDoNothing().returning() : [];

  // ตัดจบ / เปิดใหม่ — ถามผังได้แล้วเท่านั้นจึงมาถึงตรงนี้ (ถามไม่ได้ = ไม่ตัดใคร)
  const inOrg = new Set(org.people.map((p) => p.personId));
  const plan = planEnds(existing, eligible, inOrg);
  let ends = plan.end;
  let heldEnds: number | undefined;
  if (ends.length && (input.guard ?? true)) {
    const open = existing.filter((a) => a.endedAt === null).length;
    if (endGuardTripped(ends.length, open) && !(await heldSinceEarlierDay(ends.map((e) => e.id), open, now))) {
      heldEnds = ends.length;
      ends = [];
    }
  }
  const ended = (
    await Promise.all(
      END_REASONS.map((reason) => {
        const ids = ends.filter((e) => e.reason === reason).map((e) => e.id);
        return ids.length
          ? db()
              .update(assignments)
              .set({ endedAt: now, endReason: reason })
              .where(and(inArray(assignments.id, ids), isNull(assignments.endedAt)))
              .returning()
          : [];
      }),
    )
  ).flat();
  const reopenedPassed = plan.reopen.filter((r) => r.passed).map((r) => r.id);
  if (reopenedPassed.length) {
    // ผ่านแล้วกลับมาตรงเงื่อนไข — แค่กลับมารับเวอร์ชันใหม่ ไม่ต้องเรียนใหม่ ไม่ต้องแจ้ง
    await db().update(assignments).set({ endedAt: null, endReason: null }).where(and(inArray(assignments.id, reopenedPassed), isNotNull(assignments.endedAt)));
  }
  const reopenIds = new Set(plan.reopen.filter((r) => !r.passed).map((r) => r.id));
  const reopened = (
    await Promise.all(
      sets.map((set) => {
        const ids = existing.filter((a) => a.setId === set.id && reopenIds.has(a.id)).map((a) => a.id);
        // นับวันที่ได้รับมอบและกำหนดส่งใหม่จากวันที่กลับมา · ความคืบหน้าการอ่านและครั้งที่สอบเดิมเก็บไว้
        return ids.length
          ? db()
              .update(assignments)
              .set({
                endedAt: null,
                endReason: null,
                assignRound: sql`${assignments.assignRound} + 1`,
                assignedAt: now,
                dueAt: new Date(now.getTime() + set.dueDays * DAY_MS),
              })
              .where(and(inArray(assignments.id, ids), isNotNull(assignments.endedAt)))
              .returning()
          : [];
      }),
    )
  ).flat();

  // ข้อความวันที่ 0 ที่ยังไม่ถึง (ส่งล้ม · ล้มก่อนได้จอง) ลองใหม่รอบนี้ — `claim()` ตัดสินเองว่าจองซ้ำได้ไหม
  const retry = await unsentDayZero(setIds, inOrg, new Set([...inserted, ...reopened].map((a) => a.id)), now);
  const title = (a: AssignmentRow) => setById.get(a.setId)?.title ?? "";
  const due = (a: AssignmentRow) => formatBangkok(a.dueAt);
  const results = [
    ...(await sendCombined([...inserted, ...retry.filter((a) => a.assignRound === 1)], org.people, {
      kind: "assigned",
      key: dayZeroKey,
      one: (a) => `📚 ชุดการเรียนรู้ใหม่: ${title(a)}\nเรียนแล้วสอบให้ผ่าน 80% ภายใน ${due(a)}\n${appUrl()}`,
      many: (as) => [`📚 ชุดการเรียนรู้ใหม่ ${as.length} ชุด — เรียนแล้วสอบให้ผ่าน 80%`, ...as.map((a) => `- ${title(a)} · ภายใน ${due(a)}`), appUrl()].join("\n"),
    })),
    ...(await sendCombined([...reopened, ...retry.filter((a) => a.assignRound > 1)], org.people, {
      kind: "reassigned",
      key: dayZeroKey,
      one: (a) => `🔁 ได้รับมอบอีกครั้ง: ${title(a)}\nเรียนแล้วสอบให้ผ่าน 80% ภายใน ${due(a)}\n${appUrl()}`,
      many: (as) => [`🔁 ได้รับมอบอีกครั้ง ${as.length} ชุด — เรียนแล้วสอบให้ผ่าน 80%`, ...as.map((a) => `- ${title(a)} · ภายใน ${due(a)}`), appUrl()].join("\n"),
    })),
    // ไม่ต้องเรียนแล้ว — เฉพาะคนที่ยังไม่ผ่านและยังอยู่ในผัง (คนลาออกไม่ต้องแจ้ง)
    ...(await sendCombined(
      ended.filter((a) => a.endReason === "not_in_audience" && !a.passedAt),
      org.people,
      {
        kind: "assignment_ended",
        key: (a) => roundKey("ended", a),
        one: (a) => `📕 ชุดการเรียนรู้ ${title(a)} ไม่ต้องเรียนแล้ว (คุณไม่อยู่ในกลุ่มผู้รับของชุดนี้แล้ว)`,
        many: (as) => [`📕 ไม่ต้องเรียนแล้ว ${as.length} ชุด (คุณไม่อยู่ในกลุ่มผู้รับของชุดเหล่านี้แล้ว)`, ...as.map((a) => `- ${title(a)}`)].join("\n"),
      },
    )),
  ];
  return {
    ok: true,
    assigned: inserted.length,
    ended: ended.length,
    reopened: reopened.length + reopenedPassed.length,
    ...(heldEnds ? { heldEnds } : {}),
    notified: tally(results),
  };
}

/**
 * ส่งตัวต่อตัวแบบรวมต่อคน — คนเดียวหลายเรื่องชนิดเดียวกันในรอบเดียว = ข้อความเดียว (เจ้าของตัดสิน 16 พ.ย. 2569)
 * เรื่องเดียว = คีย์ของเรื่องนั้นตรง ๆ · หลายเรื่อง = คีย์รวมจากชุดคีย์ แล้วลงแถวของแต่ละเรื่องว่าส่งรวมแล้ว (ไม่ส่งแยกซ้ำทีหลัง)
 * ★ ผู้เรียกต้องตัดเรื่องที่ส่งแล้ว/ข้ามแล้วออกก่อน — ไม่งั้นชุดคีย์เปลี่ยนแล้วได้ข้อความรวมซ้ำ
 */
async function sendCombined<T extends Pick<AssignmentRow, "id" | "setId" | "personId">>(
  rows: readonly T[],
  people: readonly OrgPerson[],
  spec: { kind: NotificationKind; key: (r: T) => string; one: (r: T) => string; many: (rs: T[]) => string },
): Promise<SendResult[]> {
  const byPerson = new Map<number, T[]>();
  for (const r of rows) byPerson.set(r.personId, [...(byPerson.get(r.personId) ?? []), r]);
  const out = await Promise.all(
    [...byPerson.entries()].map(async ([personId, list]) => {
      const sorted = [...list].sort((a, b) => a.id - b.id);
      if (sorted.length === 1) {
        const r = sorted[0];
        return [await sendToPerson({ dedupeKey: spec.key(r), kind: spec.kind, personId, setId: r.setId, assignmentId: r.id, text: spec.one(r) }, people)];
      }
      const keys = sorted.map(spec.key);
      const groupKey = `${spec.kind}-combined:${createHash("sha256").update(keys.join(",")).digest("hex").slice(0, 32)}`;
      const res = await sendToPerson({ dedupeKey: groupKey, kind: spec.kind, personId, text: spec.many(sorted) }, people);
      const items = sorted.map((r) => ({ dedupeKey: spec.key(r), kind: spec.kind, personId, setId: r.setId, assignmentId: r.id }));
      if (res === "sent") await markCoveredBy(groupKey, items);
      else if (res === "skipped") await markSkippedBy(groupKey, items);
      return sorted.map(() => res);
    }),
  );
  return out.flat();
}

/**
 * ด่านกันผังเพี้ยน — จำการหยุดด้วยแถวใน `notifications` (kind `end_held` · `skipped` · ไม่ได้ส่งถึงใคร) แล้วแจ้ง TG
 * การมอบชุดเดียวกันทุกตัวถูกหยุดไว้ตั้งแต่วันก่อนแล้ว = ผังยืนยันซ้ำข้ามวัน ไม่ใช่เพี้ยนชั่วคราว → true (ตัดได้)
 */
async function heldSinceEarlierDay(ids: number[], open: number, now: Date): Promise<boolean> {
  const sorted = [...ids].sort((a, b) => a - b);
  const key = `end-held:${createHash("sha256").update(sorted.join(",")).digest("hex").slice(0, 32)}`;
  const [prev] = await db().select({ createdAt: notifications.createdAt }).from(notifications).where(eq(notifications.dedupeKey, key));
  if (prev) return bangkokDate(prev.createdAt) < bangkokDate(now);
  await db()
    .insert(notifications)
    .values({ dedupeKey: key, kind: "end_held", personId: null, status: "skipped", detail: `หยุดการตัดจบ ${sorted.length} การมอบ (เปิดอยู่ ${open}) — รอผังยืนยันวันถัดไป`, createdAt: now })
    .onConflictDoNothing();
  const tg = await fetchRolePeople("admin");
  if (!tg.ok) {
    console.log(JSON.stringify({ msg: "end_guard_no_tg_list", why: tg.why, held: sorted.length }));
    return false;
  }
  const org = await fetchOrg(now.getTime());
  const text = [
    `⚠️ รอบเช้านี้ระบบจะตัดจบ ${sorted.length} การมอบ (จาก ${open} ที่เปิดอยู่) — มากผิดปกติ จึงหยุดไว้ก่อน`,
    "ถ้าพรุ่งนี้ผัง WorkID ยังบอกเหมือนเดิม ระบบจะตัดจบตามนั้น",
    appUrl("/dashboard"),
  ].join("\n");
  for (const tgId of tg.personIds) await sendToPerson({ dedupeKey: `${key}:tg${tgId}`, kind: "end_guard", personId: tgId, text }, org.ok ? org.people : null);
  return false;
}

/** dedupe key ไหนในนี้ที่ส่งแล้วหรือข้ามแล้ว (ไม่ต้องส่งอีก) */
async function sentOrSkipped(keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const rows = await db()
    .select({ key: notifications.dedupeKey })
    .from(notifications)
    .where(and(inArray(notifications.dedupeKey, keys), inArray(notifications.status, ["sent", "skipped"])));
  return new Set(rows.map((r) => r.key));
}

/** การมอบที่ยังเปิด (ยังไม่ผ่าน · ยังไม่เลยกำหนด · ไม่ถูกตัดจบ · คนยังอยู่ในผัง) ที่ข้อความวันที่ 0 ของรอบนี้ยังไม่ `sent`/`skipped` */
async function unsentDayZero(setIds: number[], inOrg: Set<number>, skip: Set<number>, now: Date) {
  const open = (
    await db()
      .select()
      .from(assignments)
      .where(and(inArray(assignments.setId, setIds), isNull(assignments.passedAt), isNull(assignments.endedAt), gt(assignments.dueAt, now)))
  ).filter((a) => !skip.has(a.id) && inOrg.has(a.personId));
  if (!open.length) return [];
  const done = await sentOrSkipped(open.map(dayZeroKey));
  return open.filter((a) => !done.has(dayZeroKey(a)));
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
 * - วันที่ 3 ถ้ายังไม่เริ่ม (ไม่มีการอ่าน ไม่มีการสอบ) → ตัวต่อตัว (หลายชุดของคนเดียวกัน = ข้อความเดียว)
 * - วันที่ 5 ถ้ายังไม่ผ่าน → กลุ่ม LINE ประจำตัว (มีหัวหน้าอยู่ด้วย) · ไม่มีกลุ่ม = ตัวต่อตัวแทน (รวมต่อคนเหมือนกัน)
 * - เลยกำหนดส่ง → สรุปให้หัวหน้าแต่ละคนทุกวันจันทร์
 *
 * ★ dedupe ต่อการมอบต่อรอบที่ได้รับมอบ — cron รันซ้ำวันเดียวกันไม่เตือนซ้ำ · เปิดใหม่หลังตัดจบ = นับวันใหม่ เตือนใหม่
 * ★ การมอบที่ถูกตัดจบไม่ถูกเตือน · คนที่หายจากผัง (พ้นสภาพ) ไม่เตือนและไม่นับเป็นคนค้าง
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
    .where(and(eq(learningSets.status, "active"), isNull(assignments.passedAt), isNull(assignments.endedAt)));
  // คนที่หายจากผัง (พ้นสภาพ) ไม่เตือนและไม่นับเป็นคนค้าง
  const live = open.filter((r) => inOrg.has(r.a.personId));
  if (!live.length) return { ok: true, ...empty };

  const ids = live.map((r) => r.a.id);
  const read = await db().selectDistinct({ id: readingProgress.assignmentId }).from(readingProgress).where(inArray(readingProgress.assignmentId, ids));
  const tried = await db().selectDistinct({ id: attempts.assignmentId }).from(attempts).where(inArray(attempts.assignmentId, ids));
  const started = new Set([...read, ...tried].map((r) => r.id));
  // นับตามปฏิทินไทย ไม่ใช่รอบ 24 ชม. — มอบตอนบ่ายวันที่ 0 ต้องถูกเตือนตอนเช้าวันที่ 3 ไม่ใช่วันที่ 4
  const ageDays = (a: { assignedAt: Date }) => ageInDays(a.assignedAt, now);
  // กำหนดส่งสั้นกว่า 6 วัน: เตือนกลุ่มก่อนครบกำหนด 1 วันแทน ไม่อย่างนั้นหัวหน้าไม่เคยได้ยินก่อนเลยกำหนด
  const day5At = (a: { assignedAt: Date; dueAt: Date }) => Math.max(1, Math.min(REMIND_DAY5, ageInDays(a.assignedAt, a.dueAt) - 1));

  type Live = (typeof live)[number];
  const day3Key = (r: Live) => roundKey("remind-day3", r.a);
  const day5Key = (r: Live) => roundKey("remind-day5", r.a);
  const asRow = (r: Live) => ({ id: r.a.id, setId: r.a.setId, personId: r.a.personId, r });

  const day3All = live.filter((r) => ageDays(r.a) >= REMIND_DAY3 && !started.has(r.a.id) && r.a.dueAt > now);
  const day3Done = await sentOrSkipped(day3All.map(day3Key));
  const day3Results = await sendCombined(
    day3All.filter((r) => !day3Done.has(day3Key(r))).map(asRow),
    org.people,
    {
      kind: "remind_day3",
      key: (x) => day3Key(x.r),
      one: (x) => `⏰ ยังไม่ได้เริ่มเรียน: ${x.r.title}\nกำหนดส่ง ${formatBangkok(x.r.a.dueAt)}\n${appUrl()}`,
      many: (xs) => [`⏰ ยังไม่ได้เริ่มเรียน ${xs.length} ชุด`, ...xs.map((x) => `- ${x.r.title} · กำหนดส่ง ${formatBangkok(x.r.a.dueAt)}`), appUrl()].join("\n"),
    },
  );

  // วันที่ 5 — รวมตามกลุ่ม LINE ก่อนส่ง (spec §11): หัวหน้าคนเดียวอยู่กลุ่มเดียวกับลูกทีมหลายคน
  // ไม่ควรได้ข้อความแยกทีละคน · ส่งแล้ว (หรือข้ามแล้ว) ต่อการมอบไม่ส่งซ้ำ
  const day5 = live.filter((r) => ageDays(r.a) >= day5At(r.a) && r.a.dueAt > now);
  const day5Done = await sentOrSkipped(day5.map(day5Key));
  const day5Pending = day5.filter((r) => !day5Done.has(day5Key(r)));
  const byGroup = new Map<string, typeof day5Pending>();
  const day5Solo: typeof day5Pending = [];
  for (const r of day5Pending) {
    const g = inOrg.get(r.a.personId)!.lineGroupId;
    if (g) byGroup.set(g, [...(byGroup.get(g) ?? []), r]);
    else day5Solo.push(r);
  }
  const line5 = (r: Live) => {
    const p = inOrg.get(r.a.personId)!;
    return `- ${p.nickname ?? p.name} · ${r.title} · กำหนดส่ง ${formatBangkok(r.a.dueAt)}`;
  };
  const soloResults = await sendCombined(day5Solo.map(asRow), org.people, {
    kind: "remind_day5",
    key: (x) => day5Key(x.r),
    one: (x) => `⚠️ ยังสอบไม่ผ่าน\n${line5(x.r)}\n${appUrl()}`,
    many: (xs) => [`⚠️ ยังสอบไม่ผ่าน (${xs.length})`, ...xs.map((x) => line5(x.r)), appUrl()].join("\n"),
  });
  const groupResults = await Promise.all(
    [...byGroup.entries()].map(async ([lineGroupId, rows]) => {
      const keys = rows.map(day5Key).sort();
      // คีย์ของข้อความรวม = ชุดการมอบในข้อความ — ส่งล้มแล้วรอบถัดไปชุดเดิมจองซ้ำได้ · มีคนเพิ่ม = ข้อความใหม่เฉพาะที่ยังค้าง
      const groupKey = `remind-day5-group:${createHash("sha256").update(keys.join(",")).digest("hex").slice(0, 32)}`;
      const out = await sendToGroup({
        dedupeKey: groupKey,
        kind: "remind_day5",
        personId: rows.length === 1 ? rows[0].a.personId : null,
        lineGroupId,
        text: [`⚠️ ยังสอบไม่ผ่าน (${rows.length})`, ...rows.map(line5), appUrl()].join("\n"),
      });
      // ส่งถึงแล้ว = ทุกการมอบในข้อความนี้นับว่าเตือนวันที่ 5 แล้ว (ใช้ jobId ของข้อความรวม)
      if (out === "sent") await markCoveredBy(groupKey, rows.map((r) => ({ dedupeKey: day5Key(r), kind: "remind_day5", personId: r.a.personId, setId: r.a.setId, assignmentId: r.a.id })));
      return rows.map(() => out);
    }),
  );
  const day5Results = [...soloResults, ...groupResults.flat()];

  let overdueResults: SendResult[] = [];
  if (isMonday(now)) {
    const overdue = live.filter((r) => r.a.dueAt <= now);
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
 * แจ้งคนที่ต้องทำต่อหลังเหตุการณ์อนุมัติ — ส่ง → ผู้อนุมัติ · ตีกลับ/อนุมัติ → ผู้สร้าง · ผู้อนุมัติเพิ่มผู้รับ → ผู้สร้าง
 * ★ TG กดแทน (ADR-0018): ข้อความบอกว่า "(TG) … แทน คุณ…" และแจ้งผู้อนุมัติตัวจริงด้วย · ไม่แจ้งคนที่กดเอง
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
  const d = (e.detail ?? {}) as { onBehalfOf?: { personId: number; name: string | null } | null; by?: string; added?: string[]; gained?: number | null };
  const byTg = d.onBehalfOf !== undefined;
  const who = byTg ? `${e.actorName} (TG)` : e.actorName;
  const instead = byTg && d.onBehalfOf ? `แทน ${d.onBehalfOf.name ?? "ผู้อนุมัติ"}` : "";
  const plan =
    e.action === "submitted" && set.approverPersonId
      ? { kind: "approval_requested" as const, to: set.approverPersonId, text: `📝 ${set.authorName} ส่งข้อสอบให้ตรวจ: ${set.title}\n${link}` }
      : e.action === "returned"
        ? { kind: "approval_returned" as const, to: set.authorPersonId, text: `↩️ ${who} ตีกลับ${instead}: ${set.title}\n${e.comment ?? ""}\n${link}` }
        : e.action === "approved"
          ? { kind: "approval_approved" as const, to: set.authorPersonId, text: `✅ ${who} อนุมัติ${instead || "แล้ว"}: ${set.title}\n${link}` }
          : e.action === "audience_changed" && d.by === "approver"
            ? {
                kind: "audience_added" as const,
                to: set.authorPersonId,
                text: `➕ ${e.actorName} (ผู้อนุมัติ) เพิ่มผู้รับในชุด ${set.title}: ${(d.added ?? []).join(" · ")}${d.gained ? ` (+${d.gained} คน)` : ""}\n${link}`,
              }
            : null;
  if (!plan) return null;
  const org = await fetchOrg();
  const people = org.ok ? org.people : null;
  // ไม่แจ้งคนที่กดเอง — TG อนุมัติชุดที่ตัวเองสร้าง
  const main =
    plan.to === e.actorPersonId ? null : await sendToPerson({ dedupeKey: `approval:${e.id}`, kind: plan.kind, personId: plan.to, setId: set.id, text: plan.text }, people);
  // TG กดแทน → บอกผู้อนุมัติตัวจริงด้วย จะได้ไม่เข้าไปหางานที่เสร็จไปแล้ว
  if (byTg && d.onBehalfOf && (e.action === "approved" || e.action === "returned") && d.onBehalfOf.personId !== e.actorPersonId) {
    await sendToPerson(
      {
        dedupeKey: `approval:${e.id}:approver`,
        kind: plan.kind,
        personId: d.onBehalfOf.personId,
        setId: set.id,
        text: `ℹ️ ${who} ${e.action === "approved" ? "อนุมัติ" : "ตีกลับ"}แทนคุณแล้ว: ${set.title}\n${link}`,
      },
      people,
    );
  }
  return main;
}

/**
 * ส่งข้อความเรื่องการอนุมัติที่ล้มไปแล้วซ้ำ (เช่น WorkID/GateWay ล่มตอนกดส่ง) — รันใน cron เช้า
 * `claim()` คุมเพดานจำนวนครั้งและกันส่งซ้ำ
 */
export async function retryApprovalNotices(): Promise<Record<SendResult, number>> {
  const rows = await db()
    .select({ key: notifications.dedupeKey })
    .from(notifications)
    .where(
      and(
        inArray(notifications.kind, ["approval_requested", "approval_returned", "approval_approved", "audience_added"]),
        eq(notifications.status, "failed"),
        lt(notifications.attempts, MAX_SEND_ATTEMPTS),
      ),
    );
  const results: SendResult[] = [];
  for (const r of rows) {
    // `approval:12` ถึงผู้สร้าง/ผู้อนุมัติ · `approval:12:approver` ถึงผู้อนุมัติตัวจริงเมื่อ TG กดแทน — ส่งใหม่ทั้งคู่ (ที่ส่งแล้ว claim ไม่ให้ซ้ำ)
    const eventId = Number(/^approval:(\d+)(?::approver)?$/.exec(r.key)?.[1]);
    if (!Number.isInteger(eventId)) continue;
    const out = await notifyApprovalEvent(eventId);
    if (out) results.push(out);
  }
  return tally(results);
}

// ── อ่าน ───────────────────────────────────────────────────────────────────

export async function audienceRulesOf(setId: number) {
  return db().select().from(audienceRules).where(eq(audienceRules.setId, setId));
}

/** ตำแหน่งที่ผูกชุดนี้ไว้ในเส้นทาง Onboarding — หน้าเลือกผู้รับบอกได้ว่าใครยังตรงผ่านเส้นทาง (แก้ผู้รับแล้วไม่ถูกตัดจบ) */
export async function onboardingPositionsOf(setId: number): Promise<number[]> {
  const rows = await db().select({ positionId: onboardingPaths.positionId }).from(onboardingPaths).where(eq(onboardingPaths.setId, setId));
  return rows.map((r) => r.positionId);
}

export type AssignmentState = "passed" | "started" | "not_started" | "overdue";

/** สถานะของการมอบหนึ่ง — ผ่าน · เลยกำหนด (ยังไม่ผ่าน) · เริ่มแล้ว (อ่านหรือสอบแล้ว) · ยังไม่เริ่ม */
export function assignmentState(a: { passedAt: Date | null; dueAt: Date }, started: boolean, now: Date): AssignmentState {
  return a.passedAt ? "passed" : a.dueAt <= now ? "overdue" : started ? "started" : "not_started";
}

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
    return { ...r, state: assignmentState(r, started.has(r.id), now), attempts: attemptCount.get(r.id) ?? 0 };
  });
}
