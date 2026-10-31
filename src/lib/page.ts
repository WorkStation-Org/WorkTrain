import { redirect } from "next/navigation";
import { currentActor, type Actor, type Role } from "@/lib/auth";

/**
 * ด่านของหน้าเว็บ (server component) — ยังไม่ล็อกอินพาไป `/login` · role ไม่พอพากลับหน้าแรก
 *
 * ★ ไม่ใช่ด่านเดียว — server action ทุกตัวเรียก `requireAdmin()`/`requireAuthor()`/`requireUser()` เองอีกชั้น (ข้อ 21)
 */
export async function pageActor(allowed?: readonly Role[]): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (allowed && !allowed.includes(actor.role)) redirect("/?err=" + encodeURIComponent("บัญชีนี้ไม่มีสิทธิ์เปิดหน้านั้น"));
  return actor;
}

/** ค่าแรกของ query string */
export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
