import { cookies } from "next/headers";
import { devShortcutAllowed } from "@/lib/dev";
import { ROLES, type Role } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * ด่านสิทธิ์ของเว็บ — **ที่เดียวที่ตอบว่า "คนที่กดอยู่นี่คือใคร"** (ยกโครงมาจาก WorkDecision)
 *
 * ★ ข้อ 4: staff ทุกระบบล็อกอินผ่าน WorkID (SSO broker) — WorkTrain ไม่ถือรหัสผ่านของใคร
 *
 * ตัวตนมาจากสองทาง เรียงตามลำดับความน่าเชื่อถือ:
 *   1. **session cookie ที่ออกให้ตอนล็อกอินผ่าน WorkID** (`sessionActor()`) — ทางจริง
 *   2. ทางลัด `WORKTRAIN_DEV_ACTOR` — ใช้ได้**เฉพาะบนเครื่อง dev** เท่านั้น
 *
 * ทำไมต้องเช็คทั้ง `VERCEL` และ `NODE_ENV`:
 *   การพึ่ง "เราจะไม่ตั้ง env ตัวนั้นบน production" ไม่ใช่กลไกกัน มันคือความตั้งใจ
 *   ซึ่งข้อ 16 บอกไว้ว่าดริฟต์เสมอและดริฟต์แบบเงียบ · preview deploy ของ Vercel
 *   ก็เป็น `NODE_ENV=production` และ env มักถูกตั้งครอบทุก environment พร้อมกัน
 *   ทางลัดนี้จึงต้องตายเพราะ **ที่ที่มันรันอยู่** ไม่ใช่เพราะใครจำได้ว่าอย่าตั้งค่า
 */

export { ROLES, type Role } from "@/lib/roles";

export interface Actor {
  personId: number;
  email: string;
  /** ชื่อ-สกุลล้วน — ใช้เป็น snapshot "ใครทำ" ในแถว */
  name: string;
  /** ชื่อเล่น — ชื่อบนเมนู/คำทักใช้ `callName()` · ไม่มี = คำแรกของ `name` */
  nickname?: string | null;
  role: Role;
}

export class NotAuthenticatedError extends Error {
  constructor(message = "ต้องล็อกอินด้วยบัญชี Work Station ก่อน — ไปที่ /login") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export { devShortcutAllowed };

/**
 * `WORKTRAIN_DEV_ACTOR="personId:อีเมล:ชื่อ:role"` — personId คือเลขคนใน WorkID
 *
 * ตั้งมาผิดรูปแบบต้อง **โยน** ไม่ใช่คืน `null` — ข้อ 14: fallback ที่เปลี่ยน
 * "ตั้งค่าผิด" ให้กลายเป็น "ไม่มีสิทธิ์" ทำให้คนแก้ไปเดาผิดทางทั้งวัน
 */
export function devActor(): Actor | null {
  const raw = process.env.WORKTRAIN_DEV_ACTOR;
  if (!raw) return null;

  const [idRaw, email, name, role] = raw.split(":").map((s) => s.trim());
  const personId = Number(idRaw);
  if (
    !Number.isInteger(personId) ||
    personId <= 0 ||
    !email?.includes("@") ||
    !name ||
    !role ||
    !(ROLES as readonly string[]).includes(role)
  ) {
    throw new Error(
      `WORKTRAIN_DEV_ACTOR รูปแบบไม่ถูกต้อง — ต้องเป็น "personId:อีเมล:ชื่อ:${ROLES.join("|")}" (ได้มา: ${JSON.stringify(raw)})`,
    );
  }
  return { personId, email, name, role: role as Role };
}

/**
 * อ่าน session cookie ที่ออกให้ตอนล็อกอินผ่าน WorkID
 *
 * **การถาม WorkID ว่าสิทธิ์ยังอยู่ไหมไม่ได้อยู่ที่นี่** — อยู่ที่ `src/proxy.ts`
 * เพราะ Server Component เขียน cookie ไม่ได้ จึงอัปเดต `checkedAt` ไม่ได้ · ที่นี่จึง
 * **เชื่อ cookie ที่ลายเซ็นผ่าน** ซึ่งถูกต้องเพราะ proxy การันตีว่ามันไม่เก่าเกิน 5 นาที
 */
async function sessionActor(): Promise<Actor | null> {
  let token: string | undefined;
  try {
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    // ถูกเรียกนอก request context (สคริปต์ / เทสต์) = ไม่มี cookie ให้อ่าน
    return null;
  }

  // ไม่มี cookie เลย → ยังไม่ได้ล็อกอิน · **ยังไม่ต้องแตะ SESSION_SECRET**
  if (!token) return null;

  // มี cookie แต่ไม่มี secret → `verifySession` โยน และ **ต้องปล่อยให้ดัง** (ข้อ 14)
  const data = await verifySession(token);
  if (!data) return null;

  return { personId: data.personId, email: data.email, name: data.name, nickname: data.nickname ?? null, role: data.role };
}

/** คนที่ใช้งานอยู่ (session หรือทางลัด dev) */
export async function currentActor(): Promise<Actor | null> {
  const fromSession = await sessionActor();
  if (fromSession) return fromSession;

  if (!devShortcutAllowed()) return null;

  const actor = devActor();
  if (actor) {
    console.log(JSON.stringify({ msg: "auth_dev_shortcut_used", personId: actor.personId, role: actor.role }));
  }
  return actor;
}

async function requireRole(allowed: readonly Role[]): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new NotAuthenticatedError();
  if (!allowed.includes(actor.role)) throw new ForbiddenError();
  return actor;
}

/** ดูแลระบบ — TG (admin) เท่านั้น */
export function requireAdmin(): Promise<Actor> {
  return requireRole(["admin"]);
}

/** สร้างชุดการเรียนรู้ — ผู้สร้าง หรือ TG */
export function requireAuthor(): Promise<Actor> {
  return requireRole(["admin", "author"]);
}

/** ใช้ระบบทั่วไป (เรียน · สอบ) — ว่าเห็นสถิติของใครได้บ้างตัดสินจากผังของ WorkID ไม่ใช่ role */
export function requireUser(): Promise<Actor> {
  return requireRole(ROLES);
}

/** เห็นทุกคน — TG เท่านั้น (spec §12) */
export function seesEveryone(actor: Pick<Actor, "role">): boolean {
  return actor.role === "admin";
}
