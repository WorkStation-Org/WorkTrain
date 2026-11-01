"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { addPath, removePath } from "@/lib/onboarding-service";

/** TG ผูก/ถอดชุดในเส้นทาง Onboarding (spec §6) — admin เท่านั้น */

function back(out: { ok: true } | { ok: false; error: string }, msg: string): never {
  revalidatePath("/admin/onboarding");
  redirect(`/admin/onboarding?${out.ok ? `msg=${encodeURIComponent(msg)}` : `err=${encodeURIComponent(out.error)}`}`);
}

export async function addPathAction(form: FormData) {
  const actor = await requireAdmin();
  // ค่าในตัวเลือกเป็น `positionId|ชื่อ` — ชื่อเก็บไว้แสดงผลเท่านั้น
  const [id = "", ...label] = String(form.get("position") ?? "").split("|");
  const out = await addPath({ actor, positionId: Number(id), positionLabel: label.join("|"), setId: Number(form.get("setId")) });
  back(out, "ผูกแล้ว — คนในตำแหน่งนี้ได้รับมอบในรอบเช้าถัดไป");
}

export async function removePathAction(form: FormData) {
  const actor = await requireAdmin();
  const out = await removePath({ actor, positionId: Number(form.get("positionId")), setId: Number(form.get("setId")) });
  back(out, "ถอดออกแล้ว — การมอบที่เกิดไปแล้วยังอยู่");
}
