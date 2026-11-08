"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createKind, updateKind } from "@/lib/kind-service";

/** TG เพิ่ม · แก้ · เปิด/ปิดชนิดของชุด (ADR-0011) — admin เท่านั้น · ตัวตนมาจาก session ไม่ใช่จากฟอร์ม */

function back(out: { ok: true } | { ok: false; error: string }, msg: string): never {
  revalidatePath("/admin/kinds");
  revalidatePath("/sets");
  redirect(`/admin/kinds?${out.ok ? `msg=${encodeURIComponent(msg)}` : `err=${encodeURIComponent(out.error)}`}`);
}

function str(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

function blueprint(form: FormData): unknown {
  try {
    return JSON.parse(str(form, "blueprint"));
  } catch {
    return null;
  }
}

export async function createKindAction(form: FormData) {
  const actor = await requireAdmin();
  const out = await createKind({ actor, name: str(form, "name"), blueprint: blueprint(form), allowPricelist: form.get("allowPricelist") === "on" });
  back(out, "เพิ่มชนิดแล้ว — ผู้สร้างเลือกได้ทันที");
}

export async function updateKindAction(form: FormData) {
  const actor = await requireAdmin();
  const out = await updateKind({
    actor,
    kindId: Number(str(form, "kindId")),
    name: str(form, "name"),
    blueprint: blueprint(form),
    allowPricelist: form.get("allowPricelist") === "on",
  });
  back(out, "บันทึกแล้ว — มีผลกับชุดที่สร้างใหม่ ชุดเดิมใช้แม่แบบเดิม");
}

export async function setKindActiveAction(form: FormData) {
  const actor = await requireAdmin();
  const active = str(form, "active") === "1";
  const out = await updateKind({ actor, kindId: Number(str(form, "kindId")), active });
  back(out, active ? "เปิดชนิดแล้ว" : "ปิดชนิดแล้ว — ชุดเดิมยังใช้ได้ตามปกติ");
}
