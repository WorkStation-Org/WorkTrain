import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";
import {
  WORKID_STATE_COOKIE,
  exchangeWorkIdCode,
  roleFromWorkId,
  verifyWorkIdState,
} from "@/lib/workid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/workid/callback — ปลายทางที่ WorkID เด้งกลับมาพร้อม `?code=` หรือ `?error=`
 *
 * path นี้ **เลือกเองไม่ได้** ต้องตรงกับ `return_urls` ที่ลงทะเบียนไว้ที่ WorkID ทุกอักษร
 * (ดู `WORKID_CALLBACK_PATH` และ docs/PLAN.md §โดเมนและการลงทะเบียนแอปใน WorkID)
 *
 * ลำดับในนี้สำคัญกว่าที่เห็น:
 *   1. **ตรวจ `state` ก่อนแตะ `code`** — ถ้า state ไม่ผ่าน เราไม่ควรเอา code ไปแลก
 *      ตั้งแต่แรก · `code` ไม่ได้ผูกกับเบราว์เซอร์ไหน คนร้ายจึงขอ code ของ *ตัวเอง*
 *      ค้างไว้ (อายุ 2 นาที) แล้วส่งลิงก์นี้ให้เหยื่อเปิด → เหยื่อกลายเป็นล็อกอิน
 *      ด้วยบัญชีคนร้าย โดยคนร้ายไม่ได้สิทธิ์เพิ่มเลย แต่บันทึกในระบบเป็นชื่อผิดคน
 *      และเหยื่ออาจกรอกของลงบัญชีที่ไม่ใช่ของตัวเอง
 *      (gateway/pdlist/deslist ปิดช่องนี้ไปแล้ว 30 ก.ค. 2026 — แอปใหม่ต้องทำตั้งแต่แรก)
 *   2. **ล้าง state cookie ทุกทางออก** รวมทางที่สำเร็จ — cookie ที่ค้างคือ state
 *      ที่ใช้ซ้ำได้ ซึ่งทำให้ตัวกันในข้อ 1 อ่อนลงเอง
 *   3. `role` ที่แปลไม่ออก = ปฏิเสธ ไม่เดา
 */
function backToLogin(req: NextRequest, error: string) {
  const url = new URL("/login", req.nextUrl.origin);
  url.searchParams.set("error", error);
  const res = NextResponse.redirect(url);
  // ล้างทุกทางออก — ตั้งค่าว่างพร้อม maxAge 0 ไม่ใช่แค่ "ไม่แตะ"
  res.cookies.set(WORKID_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const fromCookie = req.cookies.get(WORKID_STATE_COOKIE)?.value;

  // ★ ข้อ 1 — ก่อนอย่างอื่นทั้งหมด รวมก่อนอ่าน ?error ด้วย
  //   คำตอบที่ไม่ได้มาจาก flow ของเบราว์เซอร์นี้ ไม่ควรมีผลอะไรกับเบราว์เซอร์นี้เลย
  if (!verifyWorkIdState(params.get("state"), fromCookie)) {
    console.log(JSON.stringify({ msg: "workid_callback_state_mismatch" }));
    return backToLogin(req, "state_mismatch");
  }

  const error = params.get("error");
  if (error) {
    console.log(JSON.stringify({ msg: "workid_callback_error", error }));
    return backToLogin(req, error);
  }

  const code = params.get("code");
  if (!code) return backToLogin(req, "missing_code");

  const outcome = await exchangeWorkIdCode(code);
  if (!outcome.ok) {
    console.log(JSON.stringify({ msg: "workid_exchange_failed", error: outcome.error }));
    return backToLogin(req, outcome.error);
  }

  const role = roleFromWorkId(outcome.identity.role);
  if (!role) {
    // ★ role ของแอปอื่นหลุดมาถึงแน่นอน — log ชื่อ role ไว้ด้วย ไม่งั้นคนสืบจะไม่รู้ว่าได้อะไรมา
    console.log(
      JSON.stringify({
        msg: "workid_unknown_role",
        role: outcome.identity.role,
        email: outcome.identity.email,
      }),
    );
    return backToLogin(req, "unknown_role");
  }

  const token = await signSession({
    personId: outcome.identity.personId,
    email: outcome.identity.email,
    name: outcome.identity.name,
    nickname: outcome.identity.nickname,
    role,
    epoch: outcome.identity.epoch,
    checkedAt: Math.floor(Date.now() / 1000),
  });

  console.log(
    JSON.stringify({
      msg: "workid_login_ok",
      email: outcome.identity.email,
      role,
      personId: outcome.identity.personId,
    }),
  );

  const res = NextResponse.redirect(new URL("/", req.nextUrl.origin));
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  res.cookies.set(WORKID_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
