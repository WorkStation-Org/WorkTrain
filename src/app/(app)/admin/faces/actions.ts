"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { reviewEnrollment, reviewFailedScans } from "@/lib/identity-service";

/** TG ตรวจภาพ (spec §8) — admin เท่านั้น */

function back(out: { ok: true } | { ok: false; error: string }, msg: string): never {
  revalidatePath("/admin/faces");
  redirect(`/admin/faces?${out.ok ? `msg=${encodeURIComponent(msg)}` : `err=${encodeURIComponent(out.error)}`}`);
}

export async function reviewScansAction(form: FormData) {
  const tg = await requireAdmin();
  const confirm = form.get("decision") === "confirm";
  const out = await reviewFailedScans({ reviewerPersonId: tg.personId, personId: Number(form.get("personId")), confirm });
  back(out, confirm ? "ยืนยันตัวตนแล้ว — เริ่มเรียน/สอบได้ภายใน 24 ชม." : "ปฏิเสธแล้ว — ต้องสแกนใหม่");
}

export async function reviewEnrollmentAction(form: FormData) {
  const tg = await requireAdmin();
  const approve = form.get("decision") === "approve";
  const out = await reviewEnrollment({ reviewerPersonId: tg.personId, enrollmentId: Number(form.get("enrollmentId")), approve });
  back(out, approve ? "อนุมัติใบหน้าใหม่แล้ว" : "ปฏิเสธคำขอแล้ว");
}
