import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  needsRecheck,
  sessionCookieOptions,
  signSession,
  verifySession,
} from "@/lib/session";
import { checkWorkIdSession, roleFromWorkId, workIdConfigured } from "@/lib/workid";

/**
 * ต่ออายุ / ตัด session ตามคำตอบของ WorkID — **ที่เดียวในระบบที่เขียน cookie ได้ทุก request**
 *
 * ทำไมอยู่ที่นี่ ไม่ใช่ใน `sessionActor()`:
 *   Server Component เขียน cookie ไม่ได้ ถ้าไปเช็คตอน render จะอัปเดต `checkedAt`
 *   ไม่ได้ → ต้องยิงถาม WorkID **ทุก request** ซึ่ง `INTEGRATE-SSO.md` เตือนไว้ว่า
 *   จะกลายเป็น 1 คำขอข้ามเครือข่ายต่อ 1 หน้า
 *
 * ★ กับดักข้อ 5 ของคู่มือ WorkID (fail-open): "ถามไม่ได้" ต้อง **ปล่อยผ่าน**
 *   ไม่ใช่เตะออก · ถ้าเลือกเตะ ทั้งบริษัทจะใช้ทุกระบบไม่ได้พร้อมกันทันทีที่ระบบกลาง
 *   สะดุด ซึ่งแย่กว่าการที่คนเพิ่งกด logout ยังค้างอยู่อีกไม่กี่นาที
 *   `SessionVerdict` แยก `decided: false` ออกมาเป็น type คนละตัว จึงลืมเช็คไม่ได้
 *
 * ★ กับดักข้อ 7: ตัด session ต้องมี log บอกเหตุผลตั้งแต่แรก ไม่ใช่ไปเดาทีหลัง
 */
function clearSession(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.next();

  const session = await verifySession(token);
  // cookie อ่านไม่ออก (ปลอม / หมดอายุ / เซ็นด้วย secret เก่า) → ล้างทิ้งเลย
  // ไม่เอาไปถาม WorkID เพราะเรายังไม่รู้ว่ามันอ้างว่าเป็นใครด้วยซ้ำ
  if (!session) return clearSession(NextResponse.next());

  if (!workIdConfigured()) return NextResponse.next();
  if (!needsRecheck(session)) return NextResponse.next();

  const verdict = await checkWorkIdSession(session.personId, session.epoch);

  // ถามไม่ได้ → ปล่อยผ่าน ถอยไปเช็ครอบหน้า · **ไม่แตะ cookie**
  // (ไม่ขยับ checkedAt ด้วย ไม่งั้นการล่มของ WorkID จะกลายเป็นการต่ออายุสิทธิ์ให้ฟรี)
  if (!verdict.decided) {
    console.log(
      JSON.stringify({
        msg: "workid_session_undecided",
        personId: session.personId,
        why: verdict.why,
      }),
    );
    return NextResponse.next();
  }

  if (!verdict.valid) {
    console.log(
      JSON.stringify({
        msg: "workid_session_revoked",
        personId: session.personId,
        email: session.email,
        reason: verdict.reason,
      }),
    );
    return clearSession(NextResponse.redirect(new URL("/login?loggedout=1", req.nextUrl.origin)));
  }

  const role = roleFromWorkId(verdict.role);
  if (!role) {
    // role เปลี่ยนไปเป็นของแอปอื่น = ถือว่าหลุด · คงสิทธิ์เดิมไว้คืออันตรายกว่า
    console.log(
      JSON.stringify({
        msg: "workid_session_unknown_role",
        personId: session.personId,
        role: verdict.role,
      }),
    );
    return clearSession(NextResponse.redirect(new URL("/login?error=unknown_role", req.nextUrl.origin)));
  }

  // ยังมีสิทธิ์ → ต่ออายุพร้อม role/epoch ล่าสุด (role ถูกลดที่ WorkID ต้องมีผลทันที
  // ไม่ใช่ค้างของเดิมไว้จนหมดอายุ 12 ชั่วโมง)
  const res = NextResponse.next();
  res.cookies.set(
    SESSION_COOKIE,
    await signSession({
      ...session,
      role,
      epoch: verdict.epoch,
      checkedAt: Math.floor(Date.now() / 1000),
    }),
    sessionCookieOptions(),
  );
  return res;
}

/**
 * (เดิมชื่อ `middleware.ts` — Next 16 เปลี่ยนชื่อ convention เป็น `proxy`
 *  ไฟล์ชื่อเดิมยังทำงานได้แต่ขึ้นคำเตือน "deprecated" ทุกครั้งที่ build
 *  ข้อ 11: คำเตือนที่ค้างคือคำเตือนที่ไม่มีใครอ่าน จึงเปลี่ยนชื่อตั้งแต่ตอนนี้)
 *
 * ข้ามของที่ไม่ใช่หน้า/API ของแอป — ไฟล์ static ไม่มี session ให้ต่ออายุ
 * และการเรียก WorkID ให้ทุกไฟล์รูปคือการเผาโควตาเปล่า ๆ (ข้อ 18)
 *
 * `/api/auth/*` ก็ข้าม เพราะมันคือ flow ล็อกอินเอง — ให้ middleware ไปตัด session
 * ระหว่างที่คนกำลังล็อกอินจะกลายเป็นวงวน
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|api/auth|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
