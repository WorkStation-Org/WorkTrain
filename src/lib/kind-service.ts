import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { learningSets, setKinds } from "@/db/schema";
import { checkBlueprint, type Blueprint } from "@/domain/blueprint";
import type { Actor } from "@/lib/auth";
import type { Outcome } from "@/lib/set-service";

/**
 * ทะเบียนชนิดของชุดการเรียนรู้ (ADR-0011) — TG ดูแลที่ `/admin/kinds`
 *
 * ★ TG เท่านั้นที่เพิ่ม แก้ เปิด/ปิด · ผู้สร้างเลือกจากชนิดที่เปิดอยู่ตอนสร้างชุด
 * ★ ชุดคัดลอกแม่แบบไปตอนสร้าง — แก้แม่แบบที่นี่ไม่กระทบชุดที่มีอยู่
 * ★ ไม่มีการลบ (ชุดอ้างชนิดตลอดไป) · ต้องเหลือชนิดที่เปิดอยู่อย่างน้อยหนึ่งชนิด ไม่งั้นสร้างชุดไม่ได้เลย
 */

export type KindRow = typeof setKinds.$inferSelect;
export type Kind = Omit<KindRow, "blueprint"> & { blueprint: Blueprint };

export const KIND_NAME_MAX = 60;

function toKind(row: KindRow): Kind {
  return { ...row, blueprint: row.blueprint as Blueprint };
}

/** ชนิดทั้งหมดพร้อมจำนวนชุดที่ใช้ — หน้า TG */
export async function listKinds(): Promise<(Kind & { setCount: number })[]> {
  const rows = await db().select().from(setKinds).orderBy(asc(setKinds.id));
  const counts = await db().select({ kindId: learningSets.kindId, n: count() }).from(learningSets).groupBy(learningSets.kindId);
  const byKind = new Map(counts.map((c) => [c.kindId, Number(c.n)]));
  return rows.map((r) => ({ ...toKind(r), setCount: byKind.get(r.id) ?? 0 }));
}

/** ชนิดที่เปิดอยู่ — ตัวเลือกในฟอร์มสร้างชุด */
export async function activeKinds(): Promise<Kind[]> {
  const rows = await db().select().from(setKinds).where(eq(setKinds.active, true)).orderBy(asc(setKinds.id));
  return rows.map(toKind);
}

export async function getKind(id: number): Promise<Kind | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [row] = await db().select().from(setKinds).where(eq(setKinds.id, id));
  return row ? toKind(row) : null;
}

function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

async function nameTaken(name: string, exceptId?: number): Promise<boolean> {
  const rows = await db().select({ id: setKinds.id, name: setKinds.name }).from(setKinds);
  const lower = name.toLocaleLowerCase("th");
  return rows.some((r) => r.id !== exceptId && r.name.toLocaleLowerCase("th") === lower);
}

function checkName(raw: string): Outcome<{ name: string }> {
  const name = cleanName(raw);
  if (!name || name.length > KIND_NAME_MAX) return { ok: false, error: `ชื่อชนิดต้องมี 1–${KIND_NAME_MAX} ตัวอักษร` };
  return { ok: true, name };
}

export async function createKind(input: { actor: Actor; name: string; blueprint: unknown; allowPricelist: boolean }): Promise<Outcome<{ kindId: number }>> {
  if (input.actor.role !== "admin") return { ok: false, error: "เฉพาะ TG" };
  const n = checkName(input.name);
  if (!n.ok) return n;
  const bp = checkBlueprint(input.blueprint);
  if (!bp.ok) return bp;
  if (await nameTaken(n.name)) return { ok: false, error: `มีชนิด "${n.name}" อยู่แล้ว` };
  const [row] = await db()
    .insert(setKinds)
    .values({ name: n.name, blueprint: bp.blueprint, allowPricelist: input.allowPricelist })
    .returning({ id: setKinds.id });
  return { ok: true, kindId: row.id };
}

export async function updateKind(input: {
  actor: Actor;
  kindId: number;
  name?: string;
  blueprint?: unknown;
  allowPricelist?: boolean;
  active?: boolean;
}): Promise<Outcome> {
  if (input.actor.role !== "admin") return { ok: false, error: "เฉพาะ TG" };
  const kind = await getKind(input.kindId);
  if (!kind) return { ok: false, error: "ไม่พบชนิดนี้" };
  const patch: Partial<typeof setKinds.$inferInsert> = { updatedAt: new Date() };

  if (input.name !== undefined) {
    const n = checkName(input.name);
    if (!n.ok) return n;
    if (await nameTaken(n.name, kind.id)) return { ok: false, error: `มีชนิด "${n.name}" อยู่แล้ว` };
    patch.name = n.name;
  }
  if (input.blueprint !== undefined) {
    const bp = checkBlueprint(input.blueprint);
    if (!bp.ok) return bp;
    patch.blueprint = bp.blueprint;
  }
  if (input.allowPricelist !== undefined) patch.allowPricelist = input.allowPricelist;
  if (input.active !== undefined) {
    if (!input.active && kind.active) {
      const open = await activeKinds();
      if (open.length <= 1) return { ok: false, error: "ต้องเปิดไว้อย่างน้อยหนึ่งชนิด ไม่งั้นสร้างชุดใหม่ไม่ได้" };
    }
    patch.active = input.active;
  }
  await db().update(setKinds).set(patch).where(eq(setKinds.id, kind.id));
  return { ok: true };
}
