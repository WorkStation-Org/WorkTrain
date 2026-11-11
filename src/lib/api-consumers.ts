import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { API_SCOPES, apiConsumers, type ApiScope } from "@/db/schema";
import type { Actor } from "@/lib/auth";
import type { Outcome } from "@/lib/set-service";

/**
 * API key ของระบบอื่นในเครือที่อ่าน `/api/v1/*` (ADR-0012) — ด่าน = `Authorization: Bearer wtr_…` ไม่ใช่ session
 *
 * ★ TG ออก/ถอนที่ `/admin/api-keys` · ทะเบียนอยู่ในตาราง `api_consumers` (เดิมอยู่ใน env — ADR-0012 อธิบายเหตุที่ย้าย)
 * ★ เก็บแค่ sha256 · key เต็มคืนจาก `createApiKey()` ครั้งเดียว ไม่ลงฐาน ไม่ลง log ไม่ลง URL
 * ★ key สุ่ม 256 บิต — ค้นด้วย hash ตรง ๆ ได้ (ไม่ต้องเทียบเวลาคงที่เหมือนรหัสผ่าน: รู้ hash ก็ย้อนเป็น key ไม่ได้)
 */

export const API_CONSUMER_SCOPES = API_SCOPES;
export type ApiConsumerScope = ApiScope;

export const CONSUMER_KEY_PREFIX = "wtr_";
export const CONSUMER_NAME_RE = /^[a-z][a-z0-9-]{1,39}$/;
export const LABEL_MAX = 60;
export const NOTE_MAX = 120;

const KEY_RE = /^Bearer\s+(wtr_[A-Za-z0-9_-]{20,100})\s*$/;

/** อัปเดต "ใช้ล่าสุด" ไม่เกินชั่วโมงละครั้งต่อ key — ไม่ต้องเขียนฐานทุกคำขอ */
const TOUCH_EVERY_MS = 60 * 60 * 1000;

export interface ApiConsumer {
  id: number;
  name: string;
  scopes: ApiConsumerScope[];
}

export type ApiKeyRow = Omit<typeof apiConsumers.$inferSelect, "keyHash">;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function newConsumerKey(): string {
  return `${CONSUMER_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** ทุก key (ใหม่ก่อน) — หน้า TG · ไม่คืน hash */
export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const rows = await db().select().from(apiConsumers).orderBy(desc(apiConsumers.createdAt), desc(apiConsumers.id));
  return rows.map(({ keyHash: _hash, ...rest }) => rest);
}

/** ออก key ใหม่ — คืน key เต็มครั้งเดียว ให้ TG คัดลอกส่งปลายทาง */
export async function createApiKey(input: { actor: Actor; name: string; label: string; note?: string }): Promise<Outcome<{ id: number; key: string }>> {
  if (input.actor.role !== "admin") return { ok: false, error: "เฉพาะ TG" };
  const name = input.name.trim().toLowerCase();
  if (!CONSUMER_NAME_RE.test(name)) return { ok: false, error: "ชื่อระบบต้องเป็นอังกฤษตัวเล็ก ตัวเลข หรือ - (2–40 ตัว) ขึ้นต้นด้วยตัวอักษร เช่น workhr" };
  const label = input.label.trim().replace(/\s+/g, " ");
  if (!label) return { ok: false, error: "ตั้งชื่อ key ก่อน เช่น WorkHR — production" };
  if (label.length > LABEL_MAX) return { ok: false, error: `ชื่อ key ยาวได้ไม่เกิน ${LABEL_MAX} ตัวอักษร` };
  const note = (input.note ?? "").trim().replace(/\s+/g, " ");
  if (note.length > NOTE_MAX) return { ok: false, error: `หมายเหตุยาวได้ไม่เกิน ${NOTE_MAX} ตัวอักษร` };
  const key = newConsumerKey();
  const [row] = await db()
    .insert(apiConsumers)
    .values({
      name,
      label,
      note: note || null,
      scopes: ["read"],
      keyHash: hashApiKey(key),
      keyHint: key.slice(-4),
      createdByPersonId: input.actor.personId,
      createdByName: input.actor.name,
    })
    .returning({ id: apiConsumers.id });
  console.log(JSON.stringify({ msg: "api_key_created", id: row.id, name, label, by: input.actor.personId }));
  return { ok: true, id: row.id, key };
}

/** ถอน key — ใช้ไม่ได้ทันที · ถอนแล้วเปิดคืนไม่ได้ (ออกใหม่แทน) */
export async function revokeApiKey(input: { actor: Actor; id: number }): Promise<Outcome> {
  if (input.actor.role !== "admin") return { ok: false, error: "เฉพาะ TG" };
  if (!Number.isInteger(input.id) || input.id <= 0) return { ok: false, error: "ไม่พบ key นี้" };
  const done = await db()
    .update(apiConsumers)
    .set({ revokedAt: new Date(), revokedByName: input.actor.name })
    .where(and(eq(apiConsumers.id, input.id), isNull(apiConsumers.revokedAt)))
    .returning({ id: apiConsumers.id, name: apiConsumers.name, label: apiConsumers.label });
  if (done.length === 0) return { ok: false, error: "ไม่พบ key นี้ หรือถอนไปแล้ว" };
  console.log(JSON.stringify({ msg: "api_key_revoked", id: input.id, name: done[0].name, label: done[0].label, by: input.actor.personId }));
  return { ok: true };
}

/** `Authorization: Bearer wtr_…` → consumer ที่ยังไม่ถอน หรือ null (ไม่มี/รูปผิด/ไม่รู้จัก/ถอนแล้ว — ไม่แยกให้คนนอกรู้) */
export async function findConsumer(header: string | null, now: Date = new Date()): Promise<ApiConsumer | null> {
  const m = KEY_RE.exec(header ?? "");
  if (!m) return null;
  const [row] = await db()
    .select({ id: apiConsumers.id, name: apiConsumers.name, scopes: apiConsumers.scopes, lastUsedAt: apiConsumers.lastUsedAt })
    .from(apiConsumers)
    .where(and(eq(apiConsumers.keyHash, hashApiKey(m[1]!)), isNull(apiConsumers.revokedAt)));
  if (!row) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= TOUCH_EVERY_MS) {
    // บันทึกไม่ได้ไม่ใช่เหตุให้ปฏิเสธคำขอ
    await db()
      .update(apiConsumers)
      .set({ lastUsedAt: now })
      .where(eq(apiConsumers.id, row.id))
      .catch((e: unknown) => console.log(JSON.stringify({ msg: "api_key_touch_failed", id: row.id, error: String(e).slice(0, 200) })));
  }
  const scopes = row.scopes.filter((s): s is ApiConsumerScope => (API_CONSUMER_SCOPES as readonly string[]).includes(s));
  return { id: row.id, name: row.name, scopes };
}

export type ConsumerGuard = { ok: true; consumer: ApiConsumer } | { ok: false; res: Response };

/**
 * ต้นทางของทุก route ใต้ `/api/v1/` — `const g = await requireConsumer(req, "read"); if (!g.ok) return g.res;`
 * ไม่มี/ผิด/ถอนแล้ว = 401 `unauthorized` · key ถูกแต่ไม่มี scope = 403 `forbidden` (รหัสเดียวกับ WorkID · WorkHR)
 */
export async function requireConsumer(req: Request, scope: ApiConsumerScope): Promise<ConsumerGuard> {
  const consumer = await findConsumer(req.headers.get("authorization"));
  if (!consumer) return { ok: false, res: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (!consumer.scopes.includes(scope)) return { ok: false, res: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { ok: true, consumer };
}
