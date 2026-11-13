"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuthor, requireUser } from "@/lib/auth";
import { approve, closeSet, deleteDraft, returnToAuthor, submitForApproval } from "@/lib/approval-service";
import { notifyApprovalEvent, setAudience, syncAssignments } from "@/lib/assignment-service";
import { claudeExamModel } from "@/lib/exam-generator";
import { editQuestion, generateExams, importExams, regenerateQuestion, setQuestionReviewed, type ImportOutcome, type QuestionEdit } from "@/lib/exam-service";
import { MAX_EXAM_SHEET_BYTES } from "@/domain/document";
import {
  authorVideoLink,
  confirmUpload,
  createSet,
  moveDocument,
  removeDocument,
  requestUpload,
  setSpreadMode,
  setVideoCover,
  updateDocument,
  updateSettings,
} from "@/lib/set-service";
import { fetchOrg } from "@/lib/workid";
import {
  approveVersion,
  editSummary,
  generateDeltaExams,
  notifyNewVersion,
  returnVersion,
  setChangeKind,
  startVersion,
  submitVersion,
  summarizeVersion,
} from "@/lib/version-service";
import { DOCUMENT_KINDS, type ChangeKind, type DocumentKind } from "@/db/schema";

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

/** แท็บของหน้าชุด (`?tab=`) — ฟอร์มส่งมาใน hidden input `tab` ให้กลับไปขั้นเดิมหลังบันทึก */
const TABS = ["settings", "docs", "exam", "audience", "learners", "history"] as const;

function back(setId: number, out: { ok: true } | { ok: false; error: string }, okMsg: string, tab?: string): never {
  revalidatePath(`/sets/${setId}`);
  const q = out.ok ? `msg=${encodeURIComponent(okMsg)}` : `err=${encodeURIComponent(out.error)}`;
  const t = tab && (TABS as readonly string[]).includes(tab) ? `tab=${tab}&` : "";
  redirect(`/sets/${setId}?${t}${q}`);
}

export async function createSetAction(form: FormData) {
  const actor = await requireAuthor();
  const out = await createSet({ actor, title: str(form, "title"), kindId: int(form, "kindId") });
  if (!out.ok) redirect(`/sets?err=${encodeURIComponent(out.error)}`);
  redirect(`/sets/${out.setId}`);
}

/** ลบร่าง / ปิดชุดที่ใช้อยู่ (ADR-0016) — สำเร็จกลับไปหน้ารายการ · ไม่สำเร็จอยู่หน้าเดิม */
export async function deleteSetAction(form: FormData) {
  const actor = await requireAuthor();
  const setId = int(form, "setId");
  const out = await deleteDraft({ actor, setId });
  revalidatePath("/sets");
  if (!out.ok) redirect(`/sets?err=${encodeURIComponent(out.error)}`);
  redirect(`/sets?msg=${encodeURIComponent("ลบร่างแล้ว")}`);
}

export async function closeSetAction(form: FormData) {
  const actor = await requireAuthor();
  const setId = int(form, "setId");
  const out = await closeSet({ actor, setId });
  if (!out.ok) back(setId, out, "", str(form, "tab"));
  revalidatePath("/sets");
  redirect(`/sets?msg=${encodeURIComponent("ปิดชุดแล้ว — ไม่มอบและไม่เตือนอีก")}`);
}

export async function updateSettingsAction(form: FormData) {
  const actor = await requireAuthor();
  const setId = int(form, "setId");
  const approverId = int(form, "approverPersonId");
  let approver: { personId: number; name: string } | null = null;
  if (Number.isInteger(approverId)) {
    const org = await fetchOrg();
    const p = org.ok ? org.people.find((x) => x.personId === approverId) : undefined;
    if (!p) back(setId, { ok: false, error: "ไม่พบผู้อนุมัติในผังของ WorkID" }, "", str(form, "tab"));
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
  back(setId, out, "บันทึกแล้ว", str(form, "tab"));
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

/** ปกวิดีโอ (ADR-0013) — ฟอร์มส่ง `setId` · `documentId` · `ms` · `cover` (JPEG ที่จับจากเฟรมในเบราว์เซอร์) */
export async function setCoverAction(form: FormData) {
  const actor = await requireUser();
  const file = form.get("cover");
  if (!(file instanceof Blob)) return { ok: false as const, error: "ไม่มีภาพปก" };
  const out = await setVideoCover({ actor, documentId: int(form, "documentId"), ms: Number(str(form, "ms")), bytes: new Uint8Array(await file.arrayBuffer()) });
  revalidatePath(`/sets/${int(form, "setId")}`);
  return out;
}

/** ลิงก์วิดีโอให้ผู้สร้างเลือกเฟรมปกของคลิปที่อัปไว้แล้ว */
export async function authorVideoLinkAction(input: { documentId: number }) {
  const actor = await requireUser();
  return authorVideoLink({ actor, documentId: input.documentId });
}

export async function removeDocumentAction(form: FormData) {
  const actor = await requireAuthor();
  back(int(form, "setId"), await removeDocument({ actor, documentId: int(form, "documentId") }), "ลบเอกสารแล้ว", str(form, "tab"));
}

export async function generateExamsAction(form: FormData) {
  const actor = await requireAuthor();
  const setId = int(form, "setId");
  back(setId, await generateExams({ actor, setId, model: claudeExamModel() }), "AI ออกข้อสอบ 5 ชุดแล้ว — ตรวจทุกข้อก่อนส่งขออนุมัติ", str(form, "tab"));
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
  back(int(form, "setId"), out, "แก้ข้อสอบแล้ว", str(form, "tab"));
}

export async function regenerateQuestionAction(form: FormData) {
  const actor = await requireUser();
  const out = await regenerateQuestion({ actor, questionId: int(form, "questionId"), model: claudeExamModel() });
  back(int(form, "setId"), out, "AI ออกข้อนี้ใหม่แล้ว", str(form, "tab"));
}

/** แจ้งคนถัดไปหลังเหตุการณ์อนุมัติ — ส่งไม่ได้ไม่ทำให้การอนุมัติล้ม (ผลอยู่ใน notifications แล้ว) */
async function notify(out: { ok: true; eventId: number } | { ok: false; error: string }) {
  if (out.ok) await notifyApprovalEvent(out.eventId);
  return out;
}

export async function submitAction(form: FormData) {
  const actor = await requireAuthor();
  const setId = int(form, "setId");
  back(setId, await notify(await submitForApproval({ actor, setId })), "ส่งขออนุมัติแล้ว", str(form, "tab"));
}

export async function approveAction(form: FormData) {
  const actor = await requireUser();
  const setId = int(form, "setId");
  const out = await notify(await approve({ actor, setId }));
  if (!out.ok) back(setId, out, "", str(form, "tab"));
  // มอบทันที ไม่ต้องรอ cron เช้าพรุ่งนี้ · ถามผังไม่ได้ = cron เช้ามอบให้เอง
  const sync = await syncAssignments({ setId });
  back(setId, { ok: true }, sync.ok ? `อนุมัติแล้ว · มอบให้ ${sync.assigned} คน` : "อนุมัติแล้ว · ยังมอบไม่ได้เพราะดึงผังจาก WorkID ไม่ได้ — รอบเช้าจะมอบให้เอง", str(form, "tab"));
}

export async function returnAction(form: FormData) {
  const actor = await requireUser();
  const setId = int(form, "setId");
  back(setId, await notify(await returnToAuthor({ actor, setId, comment: str(form, "comment") })), "ตีกลับให้ผู้สร้างแล้ว", str(form, "tab"));
}

export async function setAudienceAction(form: FormData) {
  const actor = await requireAuthor();
  const setId = int(form, "setId");
  // ค่าแต่ละช่องเป็น "<kind>:<refId>:<label>" — label ไว้แสดงเมื่อของจริงหายไปจากผังแล้ว
  const rules = form.getAll("rule").flatMap((v) => {
    if (typeof v !== "string") return [];
    const [kind, ref, ...label] = v.split(":");
    return [{ kind, refId: Number.parseInt(ref, 10), label: label.join(":") }];
  });
  back(setId, await setAudience({ actor, setId, rules }), "บันทึกผู้รับแล้ว", str(form, "tab"));
}

// ── เวอร์ชันใหม่ (spec §7 · ADR-0008) ─────────────────────────────────────────

export async function startVersionAction(form: FormData) {
  const actor = await requireAuthor();
  const setId = int(form, "setId");
  back(setId, await startVersion({ actor, setId, label: str(form, "label") }), "เริ่มเวอร์ชันใหม่แล้ว — อัปเอกสารใหม่ แล้วให้ AI ออกข้อสอบและสรุปสิ่งที่เปลี่ยน", str(form, "tab"));
}

export async function summarizeVersionAction(form: FormData) {
  const actor = await requireAuthor();
  const setId = int(form, "setId");
  back(setId, await summarizeVersion({ actor, setId, model: claudeExamModel() }), "AI สรุปสิ่งที่เปลี่ยนแล้ว — ตรวจ/แก้ก่อนส่ง", str(form, "tab"));
}

export async function editSummaryAction(form: FormData) {
  const actor = await requireAuthor();
  const setId = int(form, "setId");
  back(setId, await editSummary({ actor, setId, summary: str(form, "summary") }), "บันทึกสรุปแล้ว", str(form, "tab"));
}

export async function submitVersionAction(form: FormData) {
  const actor = await requireAuthor();
  const setId = int(form, "setId");
  back(setId, await notify(await submitVersion({ actor, setId })), "ส่งเวอร์ชันใหม่ขออนุมัติแล้ว", str(form, "tab"));
}

export async function setChangeKindAction(form: FormData) {
  const actor = await requireUser();
  const setId = int(form, "setId");
  back(setId, await setChangeKind({ actor, setId, kind: str(form, "kind") as ChangeKind }), "บันทึกแล้ว", str(form, "tab"));
}

export async function generateDeltaAction(form: FormData) {
  const actor = await requireUser();
  const setId = int(form, "setId");
  back(setId, await generateDeltaExams({ actor, setId, model: claudeExamModel() }), "AI ออกข้อสอบส่วนที่เปลี่ยนแล้ว — ตรวจทุกข้อก่อนอนุมัติ", str(form, "tab"));
}

export async function returnVersionAction(form: FormData) {
  const actor = await requireUser();
  const setId = int(form, "setId");
  back(setId, await notify(await returnVersion({ actor, setId, comment: str(form, "comment") })), "ตีกลับเวอร์ชันใหม่แล้ว", str(form, "tab"));
}

export async function approveVersionAction(form: FormData) {
  const actor = await requireUser();
  const setId = int(form, "setId");
  const out = await approveVersion({ actor, setId });
  if (!out.ok) back(setId, out, "", str(form, "tab"));
  await notifyApprovalEvent(out.eventId);
  const sent = await notifyNewVersion(out.versionId);
  back(setId, { ok: true }, `อนุมัติเวอร์ชันใหม่แล้ว · แจ้งผู้เรียนที่ผ่านแล้ว ${sent.sent} คน${sent.failed ? ` (ส่งไม่ได้ ${sent.failed})` : ""}`, str(form, "tab"));
}

// ── action ที่คืนผลให้หน้าจอ (ไม่ redirect · หน้าอยู่ที่เดิม) ──────────────────────

/** แก้ข้อสอบหนึ่งข้อ — การ์ดเดิมยังเปิดอยู่ที่ข้อเดิม ไม่ต้องเปิดหาใหม่ */
export async function saveQuestionAction(input: { setId: number; questionId: number; edit: QuestionEdit }) {
  const actor = await requireUser();
  const out = await editQuestion({ actor, questionId: input.questionId, edit: input.edit });
  revalidatePath(`/sets/${input.setId}`);
  return out;
}

export async function regenerateQuestionInPlaceAction(input: { setId: number; questionId: number }) {
  const actor = await requireUser();
  const out = await regenerateQuestion({ actor, questionId: input.questionId, model: claudeExamModel() });
  revalidatePath(`/sets/${input.setId}`);
  return out;
}

/** "ตรวจแล้ว" ของคนที่กด */
export async function setReviewAction(input: { setId: number; questionId: number; reviewed: boolean }) {
  const actor = await requireUser();
  const out = await setQuestionReviewed({ actor, questionId: input.questionId, reviewed: input.reviewed });
  revalidatePath(`/sets/${input.setId}`);
  return out;
}

/** ชื่อที่ผู้เรียนเห็น · ใช้ทำอะไร · น้ำหนัก */
export async function updateDocumentAction(input: { setId: number; documentId: number; fileName?: string; kind?: string; examWeight?: number }) {
  const actor = await requireAuthor();
  const out = await updateDocument({ actor, ...input });
  revalidatePath(`/sets/${input.setId}`);
  return out;
}

export async function moveDocumentAction(input: { setId: number; documentId: number; direction: -1 | 1 }) {
  const actor = await requireAuthor();
  const out = await moveDocument({ actor, documentId: input.documentId, direction: input.direction === -1 ? -1 : 1 });
  revalidatePath(`/sets/${input.setId}`);
  return out;
}

export async function setSpreadModeAction(input: { setId: number; mode: string }) {
  const actor = await requireAuthor();
  const out = await setSpreadMode({ actor, setId: input.setId, mode: input.mode });
  revalidatePath(`/sets/${input.setId}`);
  return out;
}

/** บันทึกผู้รับจากตัวเลือกใหม่ — ชุดที่ใช้อยู่ได้รับมอบทันที */
export async function saveAudienceAction(input: { setId: number; rules: { kind: string; refId: number; label: string }[] }) {
  const actor = await requireAuthor();
  const out = await setAudience({ actor, setId: input.setId, rules: input.rules });
  revalidatePath(`/sets/${input.setId}`);
  return out;
}

/**
 * Import ข้อสอบจาก Template ที่กรอกแล้ว (ADR-0015) — คืนผลให้หน้าแสดงอยู่ที่เดิม (รายการข้อผิดตามแถวยาวเกินใส่ใน URL)
 * ผู้อนุมัติไม่จำเป็นต้องมี role author (ข้อสอบส่วนที่เปลี่ยน) — service ตรวจสิทธิ์ต่อส่วนเอง
 */
export async function importExamsAction(form: FormData): Promise<ImportOutcome> {
  const actor = await requireUser();
  const setId = int(form, "setId");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "เลือกไฟล์ .xlsx ก่อน" };
  if (file.size > MAX_EXAM_SHEET_BYTES) return { ok: false, error: "ไฟล์ใหญ่เกิน 900 KB — Template ข้อสอบไม่ควรใหญ่ขนาดนี้ ลองโหลด Template ใหม่" };
  const out = await importExams({
    actor,
    setId,
    kind: str(form, "kind") === "delta" ? "delta" : "full",
    fileName: file.name.slice(0, 200),
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  if (out.ok) revalidatePath(`/sets/${setId}`);
  return out;
}
