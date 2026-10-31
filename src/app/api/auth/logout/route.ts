import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
import { workIdLogoutUrl } from "@/lib/workid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ออกจากระบบ — **ต้องไปจบที่ WorkID ทุกครั้ง**
 *
 * ★ กับดักข้อ 3 ของ `INTEGRATE-SSO.md`: ถ้ามีทางออกหลายที่แล้วลืมไปที่ใดที่หนึ่ง
 *   ทางนั้นจะล้างแค่ cookie ของโดเมนตัวเอง คนยังเข้าแอปอื่นในเครือได้อยู่
 *   และไล่หายากมากเพราะดูเผิน ๆ เหมือนทำงานถูก
 *   → **ที่นี่คือทางออกเดียวของ WorkTrain** ปุ่ม logout ทุกที่ต้อง POST มาที่นี่
 *
 * เป็น POST ไม่ใช่ GET โดยเจตนา — logout ด้วย GET ถูกยิงข้ามเว็บได้
 * (แค่ฝัง `<img src=".../logout">` ก็เตะคนออกจากระบบได้) ซึ่งไม่อันตราย
 * แต่กวนคนทำงาน · คู่มือเขียนตัวอย่างเป็น redirect เฉย ๆ ตรงนี้จึงเข้มกว่าคู่มือ
 */
export async function POST(req: NextRequest) {
  const dest = workIdLogoutUrl() ?? new URL("/login?loggedout=1", req.nextUrl.origin).toString();
  // 303 — เบราว์เซอร์ต้องตาม redirect ด้วย GET หลัง POST
  const res = NextResponse.redirect(dest, 303);
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
