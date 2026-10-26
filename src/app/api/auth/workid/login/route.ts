import { NextResponse, type NextRequest } from "next/server";
import {
  WORKID_STATE_COOKIE,
  WORKID_STATE_TTL_SEC,
  newWorkIdState,
  workIdLoginUrl,
} from "@/lib/workid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/workid/login — จุดเริ่มของการล็อกอิน
 *
 * สุ่ม `state` เก็บลง cookie แล้วพาผู้ใช้ไป WorkID · WorkID ไม่ตีความ `state`
 * แค่ถือไปถือกลับ การเทียบเป็นหน้าที่ของเรา (ดู `callback/route.ts`)
 *
 * `origin` มาจาก request จริง ไม่ใช่ `NEXT_PUBLIC_BASE_URL` — เพราะ return URL
 * ต้องตรงกับที่ลงทะเบียนไว้ทุกอักษร ถ้า env ตั้งไว้คนละค่ากับโดเมนที่เปิดจริง
 * เราอยากให้พังตอนนี้พร้อมข้อความของ WorkID ("ปลายทางไม่อยู่ในรายการที่อนุญาต")
 * ไม่ใช่พังทีหลังแบบเงียบ ๆ
 */
export async function GET(req: NextRequest) {
  const state = newWorkIdState();
  const target = workIdLoginUrl(req.nextUrl.origin, state);

  if (!target) {
    // ยังไม่ตั้ง env — พากลับไปหน้า login แบบ manual พร้อมเหตุผล
    // ไม่ใช่ 500 เพราะ "ยังไม่เปิดใช้ SSO" เป็นสถานะที่ถูกต้องได้
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("manual", "1");
    url.searchParams.set("error", "workid_not_configured");
    return NextResponse.redirect(url);
  }

  const res = NextResponse.redirect(target);
  res.cookies.set(WORKID_STATE_COOKIE, state, {
    httpOnly: true,
    // `lax` จำเป็น ไม่ใช่ทางเลือก — `strict` จะไม่ส่ง cookie กลับมาตอนเด้งกลับ
    // จากโดเมน WorkID แล้ว state จะไม่ตรงทุกครั้งโดยที่โค้ดถูกทุกบรรทัด
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WORKID_STATE_TTL_SEC,
  });
  return res;
}
