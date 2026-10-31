import { ROLES, type Role } from "@/lib/roles";

/**
 * session cookie ของ WorkTrain — **ที่เดียวที่ถือตัวตนของคนที่ล็อกอินอยู่**
 *
 * WorkTrain ไม่มีตาราง `users` โดยเจตนา (เจ้าของข้อมูลตัวตนคือ WorkID — ข้อ 2)
 * คู่มือ `WorkID/docs/INTEGRATE-SSO.md` เขียนไว้ให้แอปเก็บ `workid_person_id`
 * กับ `workid_epoch` ลงตาราง `users` ของตัวเอง — ที่นี่ไม่มีตารางนั้น เพราะการสร้าง
 * ทะเบียนพนักงานฉบับที่สองขึ้นมาเพื่อเก็บสองคอลัมน์นี้ ขัดกับเหตุผลที่ตัดตาราง
 * `users` ออกตั้งแต่ต้น → **เก็บทั้งสองค่าไว้ใน cookie ที่เซ็นแล้วแทน**
 *
 * ผลที่ต้องยอมรับและกันไว้:
 *   - cookie เป็นของที่ผู้ใช้ถืออยู่ในมือ **การเซ็นจึงเป็นด่านเดียว** ปลอมได้เท่ากับ
 *     ยกตัวเองเป็น admin โดยไม่ต้องแตะฐานข้อมูลเลย → HMAC-SHA256 + เทียบแบบ
 *     เวลาคงที่ + ตรวจอายุทั้งสองทาง (หมดอายุ / ออกในอนาคต)
 *   - `role` ที่อยู่ใน cookie เป็นของ **ณ ตอนล็อกอิน** ซึ่งเก่าได้ → `checkedAt`
 *     บังคับให้กลับไปถาม WorkID ทุก 5 นาที (ดู `needsRecheck`)
 *
 * ใช้ **Web Crypto** ไม่ใช่ `node:crypto` เพราะตัวนี้ถูกเรียกจาก middleware ด้วย
 * ซึ่งรันบน Edge runtime ที่ไม่มี `crypto.timingSafeEqual` ให้ใช้
 */

export const SESSION_COOKIE = "worktrain_session";

/**
 * 12 ชั่วโมง — ล็อกอินตอนเช้าอยู่ได้ทั้งวันทำงาน แล้วหมดอายุก่อนวันถัดไป
 * (ตรงกับ `SSO_TTL_SEC` ของ WorkID เอง — ยาวกว่านั้นก็ไม่มีประโยชน์
 * เพราะ SSO ต้นทางหมดอายุก่อนอยู่ดี)
 */
export const SESSION_TTL_SEC = 12 * 60 * 60;

/**
 * ถามสิทธิ์ใหม่ทุก 5 นาที
 *
 * เลขนี้ **คือเกณฑ์เสร็จของ Slice 2** ("ถอนสิทธิ์ที่ WorkID แล้วหลุดใน 5 นาที")
 * ไม่ใช่ค่าที่ตั้งเอาสวย — ใครจะผ่อนต้องรู้ว่ากำลังผ่อนสัญญาข้อไหน
 * มีเทสต์ผูกค่าไว้ (`__tests__/session.test.ts`)
 */
export const RECHECK_AFTER_SEC = 5 * 60;

/** เผื่อนาฬิกาเครื่องคลาดกัน — token ที่ออก "ในอนาคต" เกินนี้ถือว่าปลอม */
const CLOCK_SKEW_SEC = 120;

export interface SessionData {
  personId: number;
  email: string;
  /** ชื่อ-สกุลล้วนจาก WorkID (session ที่ออกก่อนแยกชื่อเล่นเก็บ `fullName` ไว้ที่นี่) */
  name: string;
  /** ชื่อเล่น — ไม่บังคับ: session ที่ออกก่อนมีฟิลด์นี้ต้องยังใช้ได้ */
  nickname?: string | null;
  role: Role;
  epoch: number;
  /** unix seconds ของครั้งล่าสุดที่ยืนยันสิทธิ์กับ WorkID สำเร็จ */
  checkedAt: number;
}

interface SignedPayload extends SessionData {
  /** issued at (unix seconds) — แยกจาก `checkedAt` เพราะตอบคำถามคนละข้อ */
  iat: number;
}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  // ★ ข้อ 14: ตั้งค่าไม่ครบต้องดัง · ถ้าคืน null เงียบ ๆ อาการจะกลายเป็น
  //   "ล็อกอินไม่ติด" ที่แยกไม่ออกจาก "รหัสผิด" และไม่มีใครนึกถึง env ที่หายไป
  if (!value) {
    throw new Error("SESSION_SECRET is not set — WorkTrain cannot sign or read its session cookie");
  }
  return value;
}

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array | null {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  try {
    const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

/**
 * เทียบแบบเวลาคงที่ — ไม่ใช้ `===` กับ MAC
 *
 * `node:crypto.timingSafeEqual` ใช้ที่นี่ไม่ได้ (Edge runtime ไม่มี) และมันยัง
 * **โยน error เมื่อความยาวไม่เท่ากัน** ซึ่งเป็นกับดักที่คู่มือ WorkID เตือนไว้ตรง ๆ
 * → เช็คความยาวก่อนเสมอ แล้วค่อยไล่ XOR ทุกไบต์
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signSession(data: SessionData, nowMs: number = Date.now()): Promise<string> {
  const payload: SignedPayload = { ...data, iat: Math.floor(nowMs / 1000) };
  const encoded = b64urlEncode(enc.encode(JSON.stringify(payload)));
  return `${encoded}.${b64urlEncode(await hmac(encoded))}`;
}

const ROLE_SET = new Set<Role>(ROLES);

function asSessionData(value: unknown): SignedPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  // ★ ตรวจ ไม่ใช่ cast — payload มาจาก cookie ของผู้ใช้ `as SessionData` เท่ากับ
  //   เชื่อของที่ผู้ใช้ส่งมาว่ามีรูปร่างถูก (แม้ MAC จะถูก ก็ยังกันของที่เซ็นด้วย
  //   schema รุ่นเก่าไม่ได้ — cookie ค้างข้าม deploy เป็นเรื่องปกติ)
  if (
    typeof v.personId !== "number" ||
    !Number.isInteger(v.personId) ||
    v.personId <= 0 ||
    typeof v.email !== "string" ||
    typeof v.name !== "string" ||
    (v.nickname !== undefined && v.nickname !== null && typeof v.nickname !== "string") ||
    typeof v.role !== "string" ||
    !ROLE_SET.has(v.role as Role) ||
    typeof v.epoch !== "number" ||
    !Number.isInteger(v.epoch) ||
    typeof v.checkedAt !== "number" ||
    typeof v.iat !== "number"
  ) {
    return null;
  }
  return {
    personId: v.personId,
    email: v.email,
    name: v.name,
    nickname: typeof v.nickname === "string" ? v.nickname : null,
    role: v.role as Role,
    epoch: v.epoch,
    checkedAt: v.checkedAt,
    iat: v.iat,
  };
}

/** คืน `null` เมื่อ cookie ใช้ไม่ได้ (ไม่ throw) · throw เฉพาะตอน `SESSION_SECRET` หาย */
export async function verifySession(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): Promise<SessionData | null> {
  // เรียกก่อนทุกกรณี — "ยังไม่ตั้ง env" ต้องดังแม้ไม่มี cookie มาให้ตรวจ
  secret();
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, mac] = parts;
  if (!encoded || !mac) return null;

  const givenMac = b64urlDecode(mac);
  if (!givenMac) return null;
  if (!timingSafeEqual(await hmac(encoded), givenMac)) return null;

  const raw = b64urlDecode(encoded);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }

  const payload = asSessionData(parsed);
  if (!payload) return null;

  const now = Math.floor(nowMs / 1000);
  if (payload.iat > now + CLOCK_SKEW_SEC) return null; // ออกในอนาคต = ของปลอม
  if (now - payload.iat > SESSION_TTL_SEC) return null;

  const { iat: _iat, ...data } = payload;
  return data;
}

/** ถึงเวลากลับไปถาม WorkID ว่าสิทธิ์ยังอยู่ไหม */
export function needsRecheck(data: SessionData, nowMs: number = Date.now()): boolean {
  return Math.floor(nowMs / 1000) - data.checkedAt >= RECHECK_AFTER_SEC;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // production เท่านั้น — dev รันบน http://localhost ถ้าบังคับ secure cookie จะไม่ถูกเก็บ
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  };
}

/**
 * ค่าเล็ก ๆ ที่เซ็นด้วยกุญแจเดียวกับ session — ใช้กับ cookie อื่นของแอป (เช่น "ใช้งานเป็น" · ADR 0006)
 * ผู้เรียกต้องใส่ `kind` ของตัวเองและตรวจเองตอนเปิด — กัน token ชนิดหนึ่งถูกเอาไปใช้เป็นอีกชนิด
 */
export async function signBlob(value: Record<string, unknown>): Promise<string> {
  const encoded = b64urlEncode(enc.encode(JSON.stringify(value)));
  return `${encoded}.${b64urlEncode(await hmac(encoded))}`;
}

/** เปิด `signBlob` — ลายเซ็นไม่ผ่านหรือรูปผิด = null (ไม่ตรวจเนื้อใน ผู้เรียกตรวจเอง) */
export async function openBlob(token: string | null | undefined): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  const [encoded, mac, extra] = token.split(".");
  if (!encoded || !mac || extra !== undefined) return null;
  const givenMac = b64urlDecode(mac);
  if (!givenMac || !timingSafeEqual(await hmac(encoded), givenMac)) return null;
  const raw = b64urlDecode(encoded);
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(raw));
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
