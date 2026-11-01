import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assignments, learningSets, onboardingPaths } from "@/db/schema";
import type { Actor } from "@/lib/auth";
import type { Outcome } from "@/lib/set-service";
import { fetchOrg, type OrgPerson } from "@/lib/workid";

/**
 * เส้นทาง Onboarding (spec §6 · ADR-0005) — TG ผูกชุดเข้ากับตำแหน่ง · WorkHR ดึงสถานะผ่าน `/api/v1/people/{email}/training-status`
 *
 * ★ ตำแหน่งอ้างด้วย `positionId` ของ WorkHR เท่านั้น — `positionLabel` เป็นชื่อ ณ ตอนผูก ใช้แสดงผล ห้ามใช้จับคู่ (spec §6.1)
 * ★ การมอบเกิดที่ `syncAssignments()` (cron เช้า) ไม่ใช่ตอนผูก — ผูกแล้วคนในตำแหน่งได้รับมอบในรอบถัดไป
 */

export interface PositionOption {
  positionId: number;
  label: string;
  people: number;
}

/**
 * ตำแหน่งที่มีคนอยู่ในผังวันนี้ — ยังไม่มีแคตตาล็อกตำแหน่งจาก WorkHR/WorkID (spec §6.1 ข้อ 3)
 * ตำแหน่งที่ยังไม่มีใครเลยจึงยังผูกไม่ได้ · ชื่อใช้ `title` ที่พบบ่อยที่สุดของคนในตำแหน่งนั้น
 */
export function positionsFromOrg(people: readonly Pick<OrgPerson, "positionId" | "title">[]): PositionOption[] {
  const byId = new Map<number, Map<string, number>>();
  for (const p of people) {
    if (p.positionId === null) continue;
    const titles = byId.get(p.positionId) ?? new Map<string, number>();
    const t = p.title?.trim() || `ตำแหน่ง #${p.positionId}`;
    titles.set(t, (titles.get(t) ?? 0) + 1);
    byId.set(p.positionId, titles);
  }
  return [...byId.entries()]
    .map(([positionId, titles]) => {
      const sorted = [...titles.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "th"));
      return { positionId, label: sorted[0]![0], people: sorted.reduce((n, [, c]) => n + c, 0) };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "th"));
}

export async function listPaths() {
  return db()
    .select({ positionId: onboardingPaths.positionId, positionLabel: onboardingPaths.positionLabel, setId: onboardingPaths.setId, title: learningSets.title, status: learningSets.status })
    .from(onboardingPaths)
    .innerJoin(learningSets, eq(learningSets.id, onboardingPaths.setId))
    .orderBy(asc(onboardingPaths.positionLabel), asc(learningSets.title));
}

/** ผูกชุดเข้ากับตำแหน่ง — TG เท่านั้น · ชุดปิดแล้วผูกไม่ได้ · ผูกซ้ำ = ไม่ทำอะไร */
export async function addPath(input: { actor: Actor; positionId: number; positionLabel: string; setId: number; now?: Date }): Promise<Outcome> {
  if (input.actor.role !== "admin") return { ok: false, error: "เฉพาะ TG" };
  if (!Number.isInteger(input.positionId) || input.positionId <= 0) return { ok: false, error: "เลือกตำแหน่ง" };
  const label = input.positionLabel.trim();
  if (!label) return { ok: false, error: "เลือกตำแหน่ง" };
  const [set] = await db().select().from(learningSets).where(eq(learningSets.id, input.setId));
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  if (set.status === "closed") return { ok: false, error: "ชุดนี้ปิดแล้ว" };
  await db()
    .insert(onboardingPaths)
    .values({ positionId: input.positionId, positionLabel: label, setId: set.id, createdByPersonId: input.actor.personId, createdAt: input.now ?? new Date() })
    .onConflictDoNothing();
  return { ok: true };
}

/** ถอดชุดออกจากเส้นทาง — การมอบที่เกิดไปแล้วค้างไว้ตามเดิม (ไม่ลบประวัติของคน) */
export async function removePath(input: { actor: Actor; positionId: number; setId: number }): Promise<Outcome> {
  if (input.actor.role !== "admin") return { ok: false, error: "เฉพาะ TG" };
  await db().delete(onboardingPaths).where(and(eq(onboardingPaths.positionId, input.positionId), eq(onboardingPaths.setId, input.setId)));
  return { ok: true };
}

// ── API ให้ WorkHR ─────────────────────────────────────────────────────────

export interface PathSetStatus {
  setId: number;
  title: string;
  assignedAt: Date | null;
  dueAt: Date | null;
  passed: boolean;
  passedAt: Date | null;
}

export interface TrainingStatus {
  email: string;
  personId: number;
  positionId: number | null;
  /** ชุดในเส้นทางของตำแหน่งปัจจุบัน (เฉพาะชุดที่ใช้อยู่) — ยังไม่ได้รับมอบ = `assignedAt: null` */
  sets: PathSetStatus[];
  /** ผ่านครบทุกชุดในเส้นทาง · `null` = ตำแหน่งนี้ไม่มีเส้นทาง (ไม่ใช่ "ไม่ผ่าน") */
  complete: boolean | null;
}

export type TrainingStatusLookup = { ok: true; status: TrainingStatus } | { ok: false; why: "not_found" | "org_unavailable" };

/**
 * สถานะเส้นทาง Onboarding ของคนหนึ่ง (spec §6) — WorkHR ใช้ติ๊ก "ผ่าน training พื้นฐาน" ใน checklist
 *
 * ★ ถามผังไม่ได้ = `org_unavailable` (503) ไม่ใช่ "ไม่พบ" — WorkHR ต้องลองใหม่ ไม่ใช่สรุปว่ายังไม่ผ่าน
 * ★ ไม่ส่ง `lineGroupId` หรือข้อมูลผังอื่นออกไป — มีแค่ที่ checklist ใช้
 */
export async function trainingStatus(email: string, now: number = Date.now()): Promise<TrainingStatusLookup> {
  const org = await fetchOrg(now);
  if (!org.ok) return { ok: false, why: "org_unavailable" };
  const wanted = email.trim().toLowerCase();
  const person = org.people.find((p) => p.email.toLowerCase() === wanted);
  if (!person) return { ok: false, why: "not_found" };

  const pathSets =
    person.positionId === null
      ? []
      : await db()
          .select({ setId: learningSets.id, title: learningSets.title })
          .from(onboardingPaths)
          .innerJoin(learningSets, eq(learningSets.id, onboardingPaths.setId))
          .where(and(eq(onboardingPaths.positionId, person.positionId), eq(learningSets.status, "active")))
          .orderBy(asc(learningSets.title));
  const mine = pathSets.length
    ? await db()
        .select()
        .from(assignments)
        .where(and(eq(assignments.personId, person.personId), inArray(assignments.setId, pathSets.map((s) => s.setId))))
    : [];
  const bySet = new Map(mine.map((a) => [a.setId, a]));
  const sets = pathSets.map((s): PathSetStatus => {
    const a = bySet.get(s.setId);
    return { setId: s.setId, title: s.title, assignedAt: a?.assignedAt ?? null, dueAt: a?.dueAt ?? null, passed: Boolean(a?.passedAt), passedAt: a?.passedAt ?? null };
  });
  return {
    ok: true,
    status: {
      email: person.email,
      personId: person.personId,
      positionId: person.positionId,
      sets,
      complete: sets.length ? sets.every((s) => s.passed) : null,
    },
  };
}
