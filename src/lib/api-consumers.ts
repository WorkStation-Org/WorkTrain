import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * ระบบอื่นของเครือที่อ่าน API ของ WorkTrain (`/api/v1/*`) — ด่าน = `Authorization: Bearer <key ของ consumer>` ไม่ใช่ session
 *
 * แบบเดียวกับ `WorkHR/src/lib/api-consumers.ts`: เก็บแค่ sha256 ของ key · key เต็มแสดงครั้งเดียวตอนออก · consumer มี scope
 * ทะเบียนอยู่ใน env `WORKTRAIN_API_CONSUMERS` ไม่ใช่ตาราง — consumer มีไม่กี่ตัว (วันนี้ `workhr` ตัวเดียว · spec §6)
 * เพิ่ม/ถอน/หมุน = แก้ env แล้ว deploy
 *
 * รูป env: คั่นด้วยจุลภาคหรือขึ้นบรรทัด · แต่ละตัว `ชื่อ:scope[+scope]:sha256hex` เช่น `workhr:read:3f…` ·
 * ออก key ด้วย `npm run api:new-key -- <ชื่อ>`
 * ★ ตัวที่รูปผิดถูกข้าม**และ log ดัง ๆ** (`api_consumer_invalid` · ชื่อ/ลำดับเท่านั้น) — ไม่ทำให้ตัวอื่นใช้ไม่ได้
 */

export const API_CONSUMER_SCOPES = ["read"] as const;
export type ApiConsumerScope = (typeof API_CONSUMER_SCOPES)[number];

export const CONSUMER_KEY_PREFIX = "wtr_";

export interface ApiConsumer {
  name: string;
  scopes: ApiConsumerScope[];
  keyHash: string;
}

const NAME_RE = /^[a-z][a-z0-9-]{1,39}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function newConsumerKey(): string {
  return `${CONSUMER_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** บรรทัดสำหรับ `WORKTRAIN_API_CONSUMERS` ของ key นี้ */
export function consumerEntry(name: string, scopes: readonly ApiConsumerScope[], key: string): string {
  return `${name}:${scopes.join("+")}:${hashApiKey(key)}`;
}

export function parseConsumers(raw: string | undefined): { consumers: ApiConsumer[]; invalid: string[] } {
  const consumers: ApiConsumer[] = [];
  const invalid: string[] = [];
  const entries = (raw ?? "").split(/[,\n]/).map((e) => e.trim()).filter(Boolean);
  entries.forEach((entry, i) => {
    const [name = "", scopeText = "", hash = "", ...rest] = entry.split(":").map((p) => p.trim());
    const scopes = scopeText.split("+").filter(Boolean);
    const ok =
      rest.length === 0 &&
      NAME_RE.test(name) &&
      HASH_RE.test(hash.toLowerCase()) &&
      scopes.length > 0 &&
      scopes.every((s) => (API_CONSUMER_SCOPES as readonly string[]).includes(s)) &&
      !consumers.some((c) => c.name === name);
    if (ok) consumers.push({ name, scopes: scopes as ApiConsumerScope[], keyHash: hash.toLowerCase() });
    else invalid.push(NAME_RE.test(name) ? name : `#${i + 1}`);
  });
  return { consumers, invalid };
}

/** `Authorization: Bearer wtr_…` → consumer ที่ตรง หรือ null (ไม่มี/รูปผิด/ไม่รู้จัก — ไม่แยกให้คนนอกรู้) */
export function findConsumer(header: string | null, consumers: readonly ApiConsumer[]): ApiConsumer | null {
  const m = /^Bearer\s+(wtr_[A-Za-z0-9_-]{20,100})\s*$/.exec(header ?? "");
  if (!m) return null;
  const got = Buffer.from(hashApiKey(m[1]!), "hex");
  // เทียบทุกตัวแบบเวลาคงที่ — จำนวน consumer น้อย ไม่ต้องทำ index
  let found: ApiConsumer | null = null;
  for (const c of consumers) {
    if (timingSafeEqual(got, Buffer.from(c.keyHash, "hex"))) found = c;
  }
  return found;
}

export type ConsumerGuard = { ok: true; consumer: ApiConsumer } | { ok: false; res: Response };

/**
 * ต้นทางของทุก route ใต้ `/api/v1/` — `const g = requireConsumer(req, "read"); if (!g.ok) return g.res;`
 * ไม่มี/ผิด key = 401 `unauthorized` · key ถูกแต่ไม่มี scope = 403 `forbidden` (รหัสเดียวกับ WorkID · WorkHR)
 */
export function requireConsumer(req: Request, scope: ApiConsumerScope, env: string | undefined = process.env.WORKTRAIN_API_CONSUMERS): ConsumerGuard {
  const { consumers, invalid } = parseConsumers(env);
  if (invalid.length > 0) console.log(JSON.stringify({ msg: "api_consumer_invalid", entries: invalid }));
  const consumer = findConsumer(req.headers.get("authorization"), consumers);
  if (!consumer) return { ok: false, res: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (!consumer.scopes.includes(scope)) return { ok: false, res: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { ok: true, consumer };
}
