"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuthor, requireUser } from "@/lib/auth";
import { approve, returnToAuthor, submitForApproval } from "@/lib/approval-service";
import { claudeExamModel } from "@/lib/exam-generator";
import { editQuestion, generateExams, regenerateQuestion } from "@/lib/exam-service";
import { confirmUpload, createSet, removeDocument, requestUpload, updateSettings } from "@/lib/set-service";
import { fetchOrg } from "@/lib/workid";
import { DOCUMENT_KINDS, SET_KINDS, type DocumentKind, type SetKind } from "@/db/schema";

/**
 * server action ของหน้าชุดการเรียนรู้ — แปลงฟอร์มเป็นคำสั่งเข้า service · ตัวตนมาจาก session เสมอ ไม่ใช่จากฟอร์ม
 * ผลกลับเป็น redirect พร้อม `?msg=` / `?err=` (หน้าเป็น server component ทั้งหมด)
 */

function str(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

function int(form: FormData, name: string): number {
  return Number.parseInt(str(form, name), 10);
}

function back(setId: number, out: { ok: true } | { ok: false; error: string }, okMsg: string): never {
  revalidatePath(`/sets/${setId}`);
  const q = out.ok ? `msg=${encodeURIComponent(okMsg)}` : `err=${encodeURIComponent(out.error)}`;
  redirect(`/sets/${setId}?${q}`);
}

export async function createSetAction(form: FormData) {
  const actor = await requireAuthor();
  const kind = str(form, "kind") as SetKind;
  if (!SET_KINDS.includes(kind)) redirect(`/sets?err=${encodeURIComponent("เลือกชนิดของชุด")}`);
  const out = await createSet({ actor, title: str(form, "title"), kind });
  if (!out.ok) redirect(`/sets?err=${encodeURIComponent(out.error)}`);
  redirect(`/sets/${out.setId}`);
}

export async function updateSettingsAction(form: FormData) {
  const actor = await requireAuthor();
  const setId = int(form, "setId");
  const approverId = int(form, "approverPersonId");
  let approver: { personId: number; name: string } | null = null;
  if (Number.isInteger(approverId)) {
    const org = await fetchOrg();
    const p = org.ok ? org.people.find((x) => x.personId === approverId) : undefined;
    if (!p) back(setId, { ok: false, error: "ไม่พบผู้อนุมัติในผังของ WorkID" }, "");
    approver = { personId: p.personId, name: p.name };
  }
  const out = await updateSettings({
    actor,
    setId,
    settings: {
      title: str(form, "title"),
      label: str(form, "label"),
      dueDays: int(form, "dueDays"),
      examMinutes: int(form, "examMinutes"),
      approver,
    },
  });
  back(setId, out, "บันทึกแล้ว");
}

export async function requestUploadAction(input: { setId: number; docKind: string; fileName: string; mime: string; size: number }) {
  const actor = await requireAuthor();
  if (!DOCUMENT_KINDS.includes(input.docKind as DocumentKind)) return { ok: false as const, error: "เลือกชนิดเอกสาร" };
  return requestUpload({ actor, ...input, docKind: input.docKind as DocumentKind });
}

export async function confirmUploadAction(input: { setId: number; token: string }) {
  const actor = await requireAuthor();
  const out = await confirmUpload({ actor, token: input.token });
  revalidatePath(`/sets/${input.setId}`);
  return out;
}

export async function removeDocumentAction(form: FormData) {
  const actor = await requireAuthor();
  back(int(form, "setId"), await removeDocument({ actor, documentId: int(form, "documentId") }), "ลบเอกสารแล้ว");
}

export async function generateExamsAction(form: FormData) {
  const actor = await requireAuthor();
  const setId = int(form, "setId");
  back(setId, await generateExams({ actor, setId, model: claudeExamModel() }), "AI ออกข้อสอบ 5 ชุดแล้ว — ตรวจทุกข้อก่อนส่งขออนุมัติ");
}

export async function editQuestionAction(form: FormData) {
  // ผู้อนุมัติไม่จำเป็นต้องมี role author — service ตรวจว่าเป็นผู้อนุมัติของชุดนี้เอง
  const actor = await requireUser();
  const out = await editQuestion({
    actor,
    questionId: int(form, "questionId"),
    edit: {
      text: str(form, "text"),
      sourceRef: str(form, "sourceRef"),
      choices: [0, 1, 2, 3].map((i) => str(form, `choice${i}`)),
      correctIndex: int(form, "correctIndex"),
    },
  });
  back(int(form, "setId"), out, "แก้ข้อสอบแล้ว");
}

export async function regenerateQuestionAction(form: FormData) {
  const actor = await requireUser();
  const out = await regenerateQuestion({ actor, questionId: int(form, "questionId"), model: claudeExamModel() });
  back(int(form, "setId"), out, "AI ออกข้อนี้ใหม่แล้ว");
}

export async function submitAction(form: FormData) {
  const actor = await requireAuthor();
  const setId = int(form, "setId");
  back(setId, await submitForApproval({ actor, setId }), "ส่งขออนุมัติแล้ว");
}

export async function approveAction(form: FormData) {
  const actor = await requireUser();
  const setId = int(form, "setId");
  back(setId, await approve({ actor, setId }), "อนุมัติแล้ว");
}

export async function returnAction(form: FormData) {
  const actor = await requireUser();
  const setId = int(form, "setId");
  back(setId, await returnToAuthor({ actor, setId, comment: str(form, "comment") }), "ตีกลับให้ผู้สร้างแล้ว");
}
