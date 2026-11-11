"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createApiKey, revokeApiKey } from "@/lib/api-consumers";
import { requireAdmin } from "@/lib/auth";

/**
 * TG ออก · ถอน API key ของระบบอื่น (ADR-0012) — admin เท่านั้น · ตัวตนมาจาก session ไม่ใช่จากฟอร์ม
 * ★ key เต็มกลับไปที่ฟอร์มผ่าน state ของ action (อยู่ในหน้าจอครั้งเดียว) — ห้ามใส่ใน URL เพราะค้างในประวัติเบราว์เซอร์และ log
 */

export type CreateKeyState = { ok: true; name: string; key: string } | { ok: false; error: string } | null;

function str(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

export async function createApiKeyAction(_prev: CreateKeyState, form: FormData): Promise<CreateKeyState> {
  const actor = await requireAdmin();
  const out = await createApiKey({ actor, name: str(form, "name"), note: str(form, "note") });
  revalidatePath("/admin/api-keys");
  return out.ok ? { ok: true, name: str(form, "name").trim().toLowerCase(), key: out.key } : { ok: false, error: out.error };
}

export async function revokeApiKeyAction(form: FormData) {
  const actor = await requireAdmin();
  const out = await revokeApiKey({ actor, id: Number(str(form, "id")) });
  revalidatePath("/admin/api-keys");
  redirect(`/admin/api-keys?${out.ok ? `msg=${encodeURIComponent("ถอน key แล้ว — ระบบที่ใช้ key นี้เรียก API ไม่ได้ทันที")}` : `err=${encodeURIComponent(out.error)}`}`);
}
