import { devShortcutAllowed } from "@/lib/dev";
import { ROLES, type Role } from "@/lib/roles";
import { errorSummary } from "@/lib/errmsg";
import { LINE_GROUP_ID } from "@/lib/line-group";

/**
 * ทุกอย่างที่คุยกับ WorkID อยู่ที่ไฟล์นี้ไฟล์เดียว
 *
 * ★ ข้อ 4: staff ทุกระบบล็อกอินผ่าน WorkID — WorkTrain ไม่ถือ credential ของใคร
 * ★ ข้อ 14: ชื่อฟิลด์ทุกตัวในนี้เปิด source ฝั่ง WorkID มาดูจริง ไม่ได้เดา
 *   `WorkID/src/app/api/v1/auth/exchange/route.ts` → `{ personId, email, fullName, name, nickname, role, epoch }`
 *   `WorkID/src/lib/app-auth.ts` `SessionCheck`    → `{ valid: true, role, epoch }`
 *                                                  | `{ valid: false, reason }`
 *
 * ทุก endpoint ใต้ `/api/v1` ต้องมี `Authorization: Bearer <WORKID_API_KEY>`
 * และ **API key ต้องมี scope `read`** (`requireConsumer(req, "read")`) ขาด scope ได้ 403
 * ซึ่งหน้าตาไม่เหมือน key ผิด (401) เลย
 */

/**
 * path ที่ **ลงทะเบียนไว้ที่ WorkID** — เลือกเองไม่ได้
 *
 * WorkID เทียบ return URL แบบตรงตัวทุกอักษร (`isAllowedReturnUrl` ใช้ `===`
 * ไม่ใช่ "ขึ้นต้นด้วย" เพื่อกัน open redirect) · ยืนยันกับของจริงแล้ว:
 * `/auth/workid/callback` (ไม่มี `/api`) ได้ **400** ส่วนตัวนี้ได้ 307
 */
export const WORKID_CALLBACK_PATH = "/api/auth/workid/callback";

/**
 * cookie ที่เก็บ `state` ระหว่างที่ผู้ใช้ออกไป WorkID แล้วเด้งกลับ
 *
 * อายุสั้น (10 นาที) เพราะมีชีวิตแค่ช่วง redirect · `sameSite=lax` จำเป็น
 * ไม่ใช่ทางเลือก — `strict` จะทำให้ cookie ไม่ถูกส่งมาตอนเด้งกลับจากโดเมนอื่น
 * แล้ว state จะไม่ตรงทุกครั้งโดยที่โค้ดถูกทุกบรรทัด
 */
export const WORKID_STATE_COOKIE = "worktrain_workid_state";
export const WORKID_STATE_TTL_SEC = 600;

/**
 * งบเวลาของการเรียก WorkID — ★ ข้อ 17 ในเวอร์ชันย่อ: งานที่มีเพดานเวลา
 * ต้องยอมแพ้เองก่อนจะลากคนอื่นไปด้วย
 *
 * `fetch` ไม่มี timeout โดยปริยาย — ถ้า WorkID ค้าง (ไม่ใช่ล่ม) ทุกหน้าของ WorkTrain
 * จะค้างตามไปเรื่อย ๆ ทั้งที่กฎบอกให้ **ปล่อยผ่าน** เมื่อถามไม่ได้
 * ความล้มเหลวที่แย่ที่สุดของ fail-open คือการที่มันไม่มีโอกาสได้ fail
 *
 * `session/check` วิ่งบนเส้นทางที่ผู้ใช้กำลังรอหน้าเว็บอยู่ → สั้น
 * `exchange` เกิดครั้งเดียวตอนล็อกอิน และล้มแล้วต้องเริ่มรอบใหม่ทั้งหมด → ยาวกว่าได้
 */
export const WORKID_SESSION_TIMEOUT_MS = 3_000;
export const WORKID_EXCHANGE_TIMEOUT_MS = 10_000;

const baseUrl = () => process.env.WORKID_BASE_URL?.replace(/\/+$/, "") ?? "";
const apiKey = () => process.env.WORKID_API_KEY ?? "";
const appKey = () => process.env.WORKID_APP_KEY ?? "ceo";

/**
 * ยังไม่ตั้ง env = ยังไม่เปิดใช้ SSO · **ทุกอย่างต้องทำงานเหมือนเดิม ห้ามพัง**
 * (ข้อบังคับตรง ๆ จาก `WorkID/docs/INTEGRATE-SSO.md` §ตรวจก่อนบอกว่าเสร็จ)
 */
export function workIdConfigured(): boolean {
  return Boolean(baseUrl() && apiKey());
}

/** `origin` มาจาก request จริง — ต้องตรงกับ return URL ที่ลงทะเบียนไว้ทุกอักษร */
export function workIdLoginUrl(origin: string, state: string): string | null {
  if (!workIdConfigured()) return null;
  const url = new URL("/auth/start", baseUrl());
  url.searchParams.set("app", appKey());
  url.searchParams.set("return", new URL(WORKID_CALLBACK_PATH, origin).toString());
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * WorkID ล้าง session กลาง บวกเลขรุ่น แล้วเด้งกลับมาที่ `<โดเมนเรา><หน้าล็อกอิน>?loggedout=1`
 * โดเมนปลายทางมาจาก `return_urls[0]` ของแอป — ฝั่งเราส่งเองไม่ได้ (กัน open redirect)
 */
export function workIdLogoutUrl(): string | null {
  if (!workIdConfigured()) return null;
  const url = new URL("/auth/logout", baseUrl());
  url.searchParams.set("app", appKey());
  return url.toString();
}

/** 32 ไบต์ → base64url 43 ตัวอักษร · ต่ำกว่าเพดาน 128 ของ WorkID สบาย ๆ */
export function newWorkIdState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/**
 * เทียบ state จาก URL กับที่เก็บใน cookie
 *
 * **เช็คความยาวก่อนเสมอ** — กับดักที่คู่มือ WorkID เตือนไว้ตรง ๆ ว่า
 * `crypto.timingSafeEqual` ของ node โยน error เมื่อความยาวไม่เท่ากัน
 * ถ้าปล่อยให้ throw callback จะกลายเป็น 500 แทนการปฏิเสธอย่างสุภาพ
 * (ที่นี่ implement เองด้วย XOR เพราะ middleware/Edge ไม่มี node:crypto ให้ใช้)
 */
export function verifyWorkIdState(
  fromUrl: string | null | undefined,
  fromCookie: string | null | undefined,
): boolean {
  if (!fromUrl || !fromCookie) return false;
  if (fromUrl.length !== fromCookie.length) return false;
  let diff = 0;
  for (let i = 0; i < fromUrl.length; i++) diff |= fromUrl.charCodeAt(i) ^ fromCookie.charCodeAt(i);
  return diff === 0;
}



/**
 * แปลง role ของ WorkID เป็น role ของ WorkTrain — **ไม่รู้จักต้องคืน null**
 *
 * role ของแอปอื่นจะหลุดมาถึงแน่นอน (`designer_admin` ของ DESList เคยไปโผล่ที่ PDList)
 * เดาต่ำไป = เข้ามาแล้วทำอะไรไม่ได้ · เดาสูงไป = ได้สิทธิ์ที่ไม่มีใครตั้งใจให้
 */
export function roleFromWorkId(role: string | null | undefined): Role | null {
  const value = (role ?? "").trim();
  return (ROLES as readonly string[]).includes(value) ? (value as Role) : null;
}

function authHeaders(): HeadersInit {
  return { authorization: `Bearer ${apiKey()}`, accept: "application/json" };
}

/** อ่าน JSON แบบไม่ throw — ปลายทางที่ตอบ HTML (proxy/502) ต้องไม่ทำให้เราระเบิด */
async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/**
 * `name` (ชื่อ-สกุลล้วน) + `nickname` จาก payload ของ WorkID (WorkID ADR-0002) —
 * WorkID รุ่นที่ยังไม่ตอบสองฟิลด์นี้ = `name` ถอยไปใช้ `fullName` · `nickname` = null
 * ★ ห้ามแกะวงเล็บออกจาก `fullName` เอง — ใช้ `src/lib/person-name.ts` แสดงผล
 */
function namesOf(v: Record<string, unknown>, fullName: string): { name: string; nickname: string | null } {
  const name = typeof v.name === "string" && v.name.trim() ? v.name.trim() : fullName;
  const nickname = typeof v.nickname === "string" && v.nickname.trim() ? v.nickname.trim() : null;
  return { name, nickname };
}

// ── แลก code เป็นตัวตน ─────────────────────────────────────────────────────

export interface WorkIdIdentity {
  personId: number;
  email: string;
  fullName: string;
  /** ชื่อ-สกุลล้วน (ไม่มีวงเล็บ) */
  name: string;
  nickname: string | null;
  /** role ดิบจาก WorkID — ต้องผ่าน `roleFromWorkId` ก่อนใช้ */
  role: string;
  epoch: number;
}

export type ExchangeOutcome =
  | { ok: true; identity: WorkIdIdentity }
  | { ok: false; error: string };

function asIdentity(value: unknown): WorkIdIdentity | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.personId !== "number" ||
    !Number.isInteger(v.personId) ||
    v.personId <= 0 ||
    typeof v.email !== "string" ||
    !v.email ||
    typeof v.fullName !== "string" ||
    typeof v.role !== "string" ||
    typeof v.epoch !== "number" ||
    !Number.isInteger(v.epoch)
  ) {
    return null;
  }
  return {
    personId: v.personId,
    email: v.email,
    fullName: v.fullName,
    ...namesOf(v, v.fullName),
    role: v.role,
    epoch: v.epoch,
  };
}

export async function exchangeWorkIdCode(code: string): Promise<ExchangeOutcome> {
  if (!workIdConfigured()) return { ok: false, error: "workid_not_configured" };

  let res: Response;
  try {
    res = await fetch(new URL("/api/v1/auth/exchange", baseUrl()), {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ code }),
      cache: "no-store",
      signal: AbortSignal.timeout(WORKID_EXCHANGE_TIMEOUT_MS),
    });
  } catch (err) {
    // ข้อ 12: ห้ามกลืนเงียบ · เขียน log ให้เห็นว่าคุยกับ WorkID ไม่ได้
    console.log(JSON.stringify({ msg: "workid_exchange_unreachable", error: errorSummary(err) }));
    return { ok: false, error: "workid_unreachable" };
  }

  const body = await readJson(res);

  if (!res.ok) {
    const reason =
      typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `http_${res.status}`;
    return { ok: false, error: reason };
  }

  const identity = asIdentity(body);
  if (!identity) {
    // ★ ข้อ 14: ตอบ 200 แต่รูปร่างไม่ตรง = ล้มเหลว **แบบดัง** ไม่ใช่ตัวตนที่ขาดฟิลด์
    //   ตัวตนที่ไม่มี email จะไปโผล่เป็นเคสที่ไม่รู้ว่าใครแจ้ง ไกลจากต้นเหตุมาก
    console.log(
      JSON.stringify({ msg: "workid_exchange_bad_shape", keys: Object.keys(body ?? {}) }),
    );
    return { ok: false, error: "คำตอบของ WorkID รูปร่างไม่ตรงที่คาด (bad_shape)" };
  }
  return { ok: true, identity };
}

// ── สิทธิ์ยังอยู่ไหม ───────────────────────────────────────────────────────

/**
 * **สามสถานะ ไม่ใช่สอง** — `decided: false` คือ "ถามไม่ได้" ไม่ใช่ "ถูกถอนสิทธิ์"
 *
 * นี่คือกับดักข้อ 8 ของ `WorkID/docs/INTEGRATE-SSO.md` ที่ pdlist/deslist โดนจริง:
 * `(await res.json()) as SessionCheck` แล้วเช็ค `!check.valid` — ถ้า WorkID ตอบ 200
 * แต่ไม่มีฟิลด์ `valid` (schema เปลี่ยน / proxy คืน `{}`) `!check.valid` จะเป็นจริง
 * → **เตะทุกคนที่ล็อกอินด้วย WorkID ออกพร้อมกัน** และล็อกอินใหม่ก็โดนเตะซ้ำทันที
 * เพราะคำตอบยังรูปร่างเดิม · การแยกเป็น type คนละตัวทำให้ลืมเช็คไม่ได้
 */
export type SessionVerdict =
  | { decided: true; valid: true; role: string; epoch: number }
  | { decided: true; valid: false; reason: string }
  | { decided: false; why: string };

function undecided(why: string): SessionVerdict {
  return { decided: false, why };
}

export async function checkWorkIdSession(personId: number, epoch: number): Promise<SessionVerdict> {
  if (!workIdConfigured()) return undecided("workid_not_configured");

  const url = new URL("/api/v1/session/check", baseUrl());
  url.searchParams.set("personId", String(personId));
  url.searchParams.set("epoch", String(epoch));

  let res: Response;
  try {
    // ★ กับดักข้อ 1: ห้าม `next: { revalidate: N }` — stale-while-revalidate ทำให้
    //   request แรกหลังหมดเวลายังได้คำตอบเก่า → กด logout แล้ว refresh ครั้งแรก
    //   ยังเข้าได้ · สำหรับการเช็คสิทธิ์นี่คือ **ผิด ไม่ใช่แค่ช้า**
    res = await fetch(url, {
      headers: authHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(WORKID_SESSION_TIMEOUT_MS),
    });
  } catch (err) {
    console.log(JSON.stringify({ msg: "workid_session_unreachable", error: errorSummary(err) }));
    return undecided("unreachable");
  }

  if (!res.ok) return undecided(`http_${res.status}`);

  const body = await readJson(res);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undecided("bad_shape");
  }
  const v = body as Record<string, unknown>;

  // `valid` ต้องเป็น boolean จริง ๆ — "yes" / 1 / undefined ทั้งหมดคือ "ถามไม่ได้"
  if (v.valid === true) {
    if (typeof v.role !== "string" || !v.role || typeof v.epoch !== "number") {
      // ยอมรับ role ที่หายไปจะได้ actor ที่ role เป็น undefined แล้วไปตกที่
      // permission check เป็น "ไม่มีสิทธิ์" ซึ่งแยกไม่ออกจากการถูกถอนสิทธิ์จริง
      return undecided("bad_shape_valid_true");
    }
    return { decided: true, valid: true, role: v.role, epoch: v.epoch };
  }
  if (v.valid === false) {
    const reason = typeof v.reason === "string" && v.reason ? v.reason : "unknown";
    return { decided: true, valid: false, reason };
  }
  return undecided("no_valid_field");
}

// ── ค้นหาคน (LIFF ใช้ตอบว่า "คนที่กดแจ้งคือใคร") ─────────────────────────────

/**
 * ผลของการค้นหาคน — **สามสถานะเหมือน `SessionVerdict`** และด้วยเหตุผลเดียวกัน
 *
 *   `found: true`      เจอ
 *   `found: false`     **ไม่มีในทะเบียน** — คำตอบที่ชัดเจน (LIFF ปิดฟอร์ม
 *                      แล้วบอกให้ติดต่อ IT เพื่อผูกตัวตน)
 *   `found: "unknown"` **ถามไม่ได้** — WorkID ล่ม/ตอบรูปร่างแปลก/ยังไม่ตั้ง env
 *
 * ถ้ายุบ `"unknown"` ลงไปเป็น `false` คนที่เจอ WorkID ล่มจะถูกบอกว่า
 * *"ไม่พบข้อมูลของคุณ"* แล้วไปตามหา IT ให้ผูกตัวตนที่ผูกไว้อยู่แล้ว —
 * ตระกูลเดียวกับกับดักข้อ 8 ของคู่มือ WorkID แต่อยู่ที่หน้าจอผู้ใช้
 */
export type LineLookup =
  | { found: true; email: string; fullName: string; name: string; nickname: string | null }
  | { found: false }
  | { found: "unknown"; why: string };

/** `GET /v1/line/{lineUserId}` → `{ email, fullName, name, nickname, active }` · 404 = ไม่มี หรือพ้นสภาพ */
export async function lookupLineUser(lineUserId: string): Promise<LineLookup> {
  if (!workIdConfigured()) return { found: "unknown", why: "workid_not_configured" };

  let res: Response;
  try {
    res = await fetch(new URL(`/api/v1/line/${encodeURIComponent(lineUserId)}`, baseUrl()), {
      headers: authHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(WORKID_SESSION_TIMEOUT_MS),
    });
  } catch (err) {
    console.log(JSON.stringify({ msg: "workid_line_lookup_unreachable", error: errorSummary(err) }));
    return { found: "unknown", why: "unreachable" };
  }

  if (res.status === 404) return { found: false };
  if (!res.ok) return { found: "unknown", why: `http_${res.status}` };

  const body = await readJson(res);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { found: "unknown", why: "bad_shape" };
  }
  const v = body as Record<string, unknown>;
  if (typeof v.email !== "string" || !v.email || typeof v.fullName !== "string") {
    // ★ ข้อ 14: รูปร่างไม่ตรง = ถามไม่ได้ ไม่ใช่ "ไม่พบ" · ถ้าปล่อยผ่านด้วย
    //   fallback `?? ""` จะได้เคสที่ไม่รู้ว่าใครแจ้ง ซึ่งกู้ทีหลังไม่ได้
    console.log(JSON.stringify({ msg: "workid_line_lookup_bad_shape", keys: Object.keys(v) }));
    return { found: "unknown", why: "bad_shape" };
  }
  return { found: true, email: v.email, fullName: v.fullName, ...namesOf(v, v.fullName) };
}

/**
 * ข้อมูลที่ WorkTrain ต้องใช้จากคนหนึ่ง — **ไม่ใช่ทั้งก้อนที่ WorkID ส่งมา**
 *
 * `team`/`title` มาจาก `org` **ไม่ใช่ชั้นบนสุด** (`org.team.name` / `org.title`)
 * `lineUserIds` เอา **ทุกเครื่อง** — WorkID เขียนกำกับไว้ที่ `LineDevice` ตรง ๆ ว่า
 * "1 คนมีได้หลายเครื่อง ผู้เรียกที่จะส่งข้อความควรส่งทุกเครื่อง ไม่ใช่หยิบตัวแรก
 * อย่างเดียว" และเรียงเครื่องหลักมาก่อนให้แล้ว
 */
export type PersonLookup =
  | {
      found: true;
      personId: number;
      email: string;
      fullName: string;
      name: string;
      nickname: string | null;
      team: string | null;
      title: string | null;
      active: boolean;
      lineUserIds: string[];
      /**
       * เครื่อง LINE ที่เจ้าตัวยืนยันเอง (พิมพ์ `#me`) — ADR 0001: ตัดสินผ่าน LIFF ได้
       * เฉพาะจากเครื่องในลิสต์นี้ · เครื่องที่ import มาหรือ admin กรอกให้ยังไม่นับ
       */
      verifiedLineUserIds: string[];
    }
  | { found: false }
  | { found: "unknown"; why: string };

function lineUserIdsOf(value: unknown, onlyVerified = false): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((d) => {
      if (typeof d !== "object" || d === null) return null;
      const v = d as { lineUserId?: unknown; verified?: unknown };
      if (typeof v.lineUserId !== "string") return null;
      // ★ ข้อ 14: `verified` ต้องเป็น true จริง ๆ — ฟิลด์หายหรือรูปร่างแปลกนับเป็นยังไม่ยืนยัน
      //   (ทางที่ผิดแล้วปลอดภัยคือขอให้ไปยืนยันตัวตน ไม่ใช่ปล่อยให้ตัดสินได้)
      if (onlyVerified && v.verified !== true) return null;
      return v.lineUserId;
    })
    .filter((id): id is string => Boolean(id));
}

/**
 * `GET /v1/people/{email}` — endpoint นี้ **ตอบคนที่พ้นสภาพด้วย** โดยเจตนา
 * (WorkID เขียนไว้ว่า "ระบบลูกต้องรู้ว่าคนนี้พ้นสภาพแล้ว ไม่ใช่หาไม่เจอ
 * ซึ่งแยกจากไม่เคยมีไม่ออก") → ผู้เรียกต้องดู `active` เอง
 */
export async function getWorkIdPerson(email: string): Promise<PersonLookup> {
  if (!workIdConfigured()) return { found: "unknown", why: "workid_not_configured" };

  let res: Response;
  try {
    res = await fetch(new URL(`/api/v1/people/${encodeURIComponent(email)}`, baseUrl()), {
      headers: authHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(WORKID_SESSION_TIMEOUT_MS),
    });
  } catch (err) {
    console.log(JSON.stringify({ msg: "workid_person_unreachable", error: errorSummary(err) }));
    return { found: "unknown", why: "unreachable" };
  }

  if (res.status === 404) return { found: false };
  if (!res.ok) return { found: "unknown", why: `http_${res.status}` };

  const body = await readJson(res);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { found: "unknown", why: "bad_shape" };
  }
  const v = body as Record<string, unknown>;
  if (
    typeof v.id !== "number" ||
    typeof v.email !== "string" ||
    !v.email ||
    typeof v.fullName !== "string" ||
    typeof v.active !== "boolean"
  ) {
    console.log(JSON.stringify({ msg: "workid_person_bad_shape", keys: Object.keys(v) }));
    return { found: "unknown", why: "bad_shape" };
  }

  const org = (typeof v.org === "object" && v.org !== null ? v.org : {}) as Record<string, unknown>;
  const team = typeof org.team === "object" && org.team !== null ? (org.team as { name?: unknown }).name : null;

  return {
    found: true,
    personId: v.id,
    email: v.email,
    fullName: v.fullName,
    ...namesOf(v, v.fullName),
    team: typeof team === "string" && team ? team : null,
    title: typeof org.title === "string" && org.title ? org.title : null,
    active: v.active,
    lineUserIds: lineUserIdsOf(v.lines),
    verifiedLineUserIds: lineUserIdsOf(v.lines, true),
  };
}

// ── ผังองค์กร (ชื่อคนบนหน้าจอ + ตัวเลือกคน) ────────────────────────────────

/**
 * คนหนึ่งคนจาก `GET /api/v1/org` — ชื่อฟิลด์ตรงกับ `OrgPerson` ใน `WorkID/src/lib/directory.ts`
 * (ข้อ 14: เปิดดูของจริงแล้ว ไม่ได้เดา)
 */
export interface OrgPerson {
  personId: number;
  email: string;
  /** "ชื่อ-สกุล (ชื่อเล่น)" — แสดงในช่องเลือกคนเท่านั้น ห้ามแกะ */
  fullName: string;
  /** ชื่อ-สกุลล้วน — snapshot ในแถว · หน้ารายชื่อ */
  name: string;
  /** ชื่อเล่น — ข้อความ LINE ใช้ผ่าน `callName()` */
  nickname: string | null;
  title: string | null;
  /**
   * `positions.id` ของ WorkHR คู่กับ `title` · null = ไม่รู้ (WorkID รุ่นก่อน 9b95294 ไม่ส่งมา)
   * ★ เส้นทาง Onboarding และผู้รับตามตำแหน่งอ้างช่องนี้เท่านั้น ห้ามอ้าง `title` — ชื่อแก้ได้ทีหลัง (spec §6.1)
   */
  positionId: number | null;
  teamId: number | null;
  teamName: string | null;
  /** ทีมที่คนนี้ดูแล (ไม่ใช่ทีมที่สังกัด) — หัวหน้าเห็นสถิติของทีมเหล่านี้ (spec §12) */
  managedTeamIds: number[];
  /**
   * กลุ่มรับงาน — กลุ่ม LINE ของคนนี้กับหัวหน้า ตั้งใน WorkID (ADR 0008) · null = ไม่ได้ตั้ง
   *
   * ★ อ่านแบบระวัง: WorkID รุ่นที่ยังไม่มีฟิลด์นี้ต้องทำงานเหมือน null ทุกอย่าง
   *   ค่าที่ผิดรูปแบบก็นับเป็น null (ส่งแชทส่วนตัวแทน) ไม่ใช่ส่งไปที่ที่ไม่รู้ว่าคือที่ไหน
   *
   * ★ ห้ามส่งออกไปหน้าจอหรือ API ของ LIFF — ใช้เลือกทางส่งข้อความเท่านั้น
   *
   * ข้อ 14: ชื่อฟิลด์ตรงกับ `OrgPerson.lineGroupId` ใน `WorkID/src/lib/directory.ts` ของ branch
   * `feat/person-line-group` (29 ก.ย. 2026 ยังไม่ merge/deploy) — ถ้าชื่อเปลี่ยนก่อน merge ต้องแก้ที่นี่
   */
  lineGroupId: string | null;
  /**
   * หัวหน้าของคนนี้ (personId ใน WorkID) — WorkHR เป็นคนกำหนดแล้ว sync เข้า WorkID · null = ไม่ได้ตั้ง
   * WorkTrain ใช้เป็นผู้อนุมัติค่าเริ่มต้นของชุดที่คนนี้สร้าง (ADR-0004) และหัวหน้าที่ได้รับแจ้งวันที่ 5
   */
  managerPersonId: number | null;
}

/**
 * `lineGroupId` จากผัง — ไม่มีฟิลด์ / null / สตริงว่าง = ไม่ได้ตั้ง (เงียบ)
 * มีค่าแต่ผิดรูปแบบ = ไม่ได้ตั้ง และจดไว้ให้ `fetchOrg()` เขียน log
 */
function orgLineGroupId(value: unknown): { id: string | null; malformed: boolean } {
  if (value === undefined || value === null || value === "") return { id: null, malformed: false };
  if (typeof value === "string" && LINE_GROUP_ID.test(value)) return { id: value, malformed: false };
  return { id: null, malformed: true };
}

/**
 * log เรื่องกลุ่มรับงานผิดรูปแบบครั้งเดียวต่อชุดคน — ผังถูกถามใหม่ทุก 5 นาที
 * ถ้า log ทุกครั้งจะกลบ log อื่น · ชุดคนเปลี่ยน (แก้แล้ว หรือมีคนใหม่ผิด) จึง log อีกครั้ง
 */
let loggedBadGroups: string | null = null;

/** รหัสจาก WorkID (personId · teamId · positionId) — ไม่ใช่จำนวนเต็มบวก = ไม่มี ไม่ใช่ 0 */
function positiveIntOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export type OrgLookup = { ok: true; people: OrgPerson[] } | { ok: false; why: string };

/** ผังทั้งบริษัทเปลี่ยนไม่บ่อย — จำไว้ 5 นาทีต่อ instance พอให้ทุกหน้าไม่ต้องยิงถามซ้ำ */
export const ORG_CACHE_MS = 5 * 60 * 1000;
/**
 * ถามไม่ได้แล้วจำไว้ 30 วินาที — ทุกหน้าใช้ผังนี้ (ชื่อคน ช่องเลือกคน) ถ้า WorkID ช้า
 * แล้วทุกหน้าต่างรอ timeout เอง ระบบทั้งระบบจะช้าตาม WorkID ทั้งที่ใช้งานต่อได้ (fail-open)
 */
export const ORG_FAILURE_CACHE_MS = 30 * 1000;
let orgCache: { at: number; people: OrgPerson[] } | null = null;
let orgFailure: { at: number; why: string } | null = null;

export function clearOrgCache(): void {
  orgCache = null;
  orgFailure = null;
  loggedBadGroups = null;
}

/**
 * ทั้งบริษัทในคำขอเดียว — WorkID ตั้งใจให้ระบบลูกถามก้อนเดียวแทนการถามทีละคน (N+1 ข้ามเครือข่าย)
 *
 * ถามไม่ได้ = `ok:false` ไม่ใช่ลิสต์ว่าง · หน้าจอต้องพูดว่า "ดึงรายชื่อไม่ได้" ไม่ใช่ "ไม่มีใคร"
 */
export async function fetchOrg(now: number = Date.now()): Promise<OrgLookup> {
  const dev = devOrg();
  if (dev) return dev;
  if (orgCache && now - orgCache.at < ORG_CACHE_MS) return { ok: true, people: orgCache.people };
  if (!workIdConfigured()) return { ok: false, why: "workid_not_configured" };
  if (orgFailure && now - orgFailure.at < ORG_FAILURE_CACHE_MS) return { ok: false, why: orgFailure.why };
  const failed = (why: string): OrgLookup => {
    orgFailure = { at: now, why };
    return { ok: false, why };
  };

  let res: Response;
  try {
    res = await fetch(new URL("/api/v1/org", baseUrl()), {
      headers: authHeaders(),
      cache: "no-store",
      // สั้นแบบเดียวกับ session/check — อยู่บนเส้นทางที่คนกำลังรอหน้าเว็บ
      signal: AbortSignal.timeout(WORKID_SESSION_TIMEOUT_MS),
    });
  } catch (err) {
    console.log(JSON.stringify({ msg: "workid_org_unreachable", error: errorSummary(err) }));
    return failed("unreachable");
  }
  if (!res.ok) return failed(`http_${res.status}`);

  const body = await readJson(res);
  const list = (body as { people?: unknown } | null)?.people;
  if (!Array.isArray(list)) {
    console.log(JSON.stringify({ msg: "workid_org_bad_shape" }));
    return failed("bad_shape");
  }
  const badGroups: number[] = [];
  const people = list.flatMap((p): OrgPerson[] => {
    if (typeof p !== "object" || p === null) return [];
    const v = p as Record<string, unknown>;
    if (typeof v.personId !== "number" || typeof v.email !== "string" || typeof v.fullName !== "string") return [];
    const group = orgLineGroupId(v.lineGroupId);
    if (group.malformed) badGroups.push(v.personId);
    return [
      {
        personId: v.personId,
        email: v.email,
        fullName: v.fullName,
        ...namesOf(v, v.fullName),
        title: typeof v.title === "string" && v.title ? v.title : null,
        positionId: positiveIntOrNull(v.positionId),
        teamId: positiveIntOrNull(v.teamId),
        teamName: typeof v.teamName === "string" && v.teamName ? v.teamName : null,
        managedTeamIds: Array.isArray(v.managedTeamIds) ? v.managedTeamIds.flatMap((t) => positiveIntOrNull(t) ?? []) : [],
        lineGroupId: group.id,
        managerPersonId:
          typeof v.managerPersonId === "number" && Number.isInteger(v.managerPersonId) && v.managerPersonId > 0
            ? v.managerPersonId
            : null,
      },
    ];
  });
  const badKey = badGroups.length > 0 ? badGroups.join(",") : null;
  if (badKey !== null && badKey !== loggedBadGroups) {
    // ไม่เขียนค่าที่ผิดลง log — groupId ใช้ยิงข้อความเข้ากลุ่มได้ · บอกแค่ว่าใครต้องไปแก้ใน WorkID
    console.log(JSON.stringify({ msg: "workid_org_bad_line_group_id", personIds: badGroups }));
  }
  loggedBadGroups = badKey;
  if (list.length > 0 && people.length === 0) {
    // ทุกแถวรูปร่างไม่ตรง = เราอ่านฟิลด์ผิด ไม่ใช่บริษัทไม่มีคน (ข้อ 14)
    console.log(JSON.stringify({ msg: "workid_org_all_rows_bad_shape", count: list.length }));
    return failed("bad_shape");
  }
  orgCache = { at: now, people };
  orgFailure = null;
  return { ok: true, people };
}

/**
 * ผังจำลองบนเครื่อง dev — `WORKTRAIN_DEV_ORG='[{"personId":1,"email":"a@b.c","fullName":"ชื่อ สกุล (เล่น)","name":"ชื่อ สกุล","nickname":"เล่น","title":"Sales Spec","managerPersonId":2,"lineGroupId":null}]'`
 *
 * มีไว้เพราะ consumer key ของ WorkID เป็นค่า Sensitive ใน Vercel ดึงลงเครื่องไม่ได้ (และไม่ควร)
 * ★ ตายบน Vercel ทุก environment (`devShortcutAllowed`) · ตั้งผิดรูปแบบต้องดัง (ข้อ 14)
 */
function devOrg(): OrgLookup | null {
  const raw = process.env.WORKTRAIN_DEV_ORG;
  if (!raw || !devShortcutAllowed()) return null;
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    throw new Error("WORKTRAIN_DEV_ORG ไม่ใช่ JSON ที่อ่านได้");
  }
  if (!Array.isArray(list)) throw new Error("WORKTRAIN_DEV_ORG ต้องเป็น JSON array ของคน");
  const people = list.map((p: Record<string, unknown>): OrgPerson => {
    if (typeof p.personId !== "number" || typeof p.email !== "string" || typeof p.fullName !== "string") {
      throw new Error("WORKTRAIN_DEV_ORG: ทุกคนต้องมี personId · email · fullName");
    }
    return {
      personId: p.personId,
      email: p.email,
      fullName: p.fullName,
      ...namesOf(p, p.fullName),
      title: typeof p.title === "string" ? p.title : null,
      positionId: positiveIntOrNull(p.positionId),
      teamId: positiveIntOrNull(p.teamId),
      teamName: typeof p.teamName === "string" ? p.teamName : null,
      managedTeamIds: Array.isArray(p.managedTeamIds) ? p.managedTeamIds.flatMap((t) => positiveIntOrNull(t) ?? []) : [],
      lineGroupId: typeof p.lineGroupId === "string" && LINE_GROUP_ID.test(p.lineGroupId) ? p.lineGroupId : null,
      managerPersonId: typeof p.managerPersonId === "number" ? p.managerPersonId : null,
    };
  });
  return { ok: true, people };
}
