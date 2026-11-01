"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { beginScan, devScan, finishScan, giveConsent, hasConsent, type ScanPurpose } from "@/lib/identity-service";
import { acknowledgeVersion, answer, documentLink, endStudySession, recordLeave, recordReading, startAttempt, startStudySession } from "@/lib/learn-service";
import { awsFaceApi } from "@/lib/rekognition";

/**
 * server action ของผู้เรียน — ตัวตนมาจาก session เสมอ · service ตรวจเองว่าการมอบ/ครั้งที่สอบเป็นของคนนี้
 *
 * การสแกน (ADR-0006): `beginScanAction` → เบราว์เซอร์รัน FaceLivenessDetector ด้วย `livenessCredentialsAction`
 * → `finishScanAction` เทียบใบหน้าฝั่งเซิร์ฟเวอร์ → ได้ scanId → `startStudyWithScanAction` / `startExamWithScanAction`
 * บนเครื่อง dev ที่ไม่มี AWS ใช้ `devScanAction` แทนสองขั้นแรก
 */

const PURPOSES: readonly ScanPurpose[] = ["study", "exam", "enroll"];

async function learner() {
  const actor = await requireUser();
  if (!(await hasConsent(actor.personId))) redirect("/consent");
  return actor;
}

function purposeOf(v: string): ScanPurpose {
  if (!PURPOSES.includes(v as ScanPurpose)) throw new Error("จุดประสงค์ของการสแกนไม่ถูกต้อง");
  return v as ScanPurpose;
}

export async function consentAction() {
  const actor = await requireUser();
  await giveConsent(actor.personId);
  redirect("/learn");
}

export async function beginScanAction(purpose: string) {
  const actor = await learner();
  return beginScan({ personId: actor.personId, purpose: purposeOf(purpose), api: awsFaceApi() });
}

/** credential ชั่วคราว 15 นาทีที่ทำได้แค่เปิดสตรีม liveness — ให้ FaceLivenessDetector ในเบราว์เซอร์ */
export async function livenessCredentialsAction() {
  await learner();
  const api = awsFaceApi();
  if (!api) throw new Error("ยังไม่ได้ตั้งระบบสแกนใบหน้าบนเซิร์ฟเวอร์นี้");
  return api.browserCredentials();
}

export async function finishScanAction(ticket: string) {
  const actor = await learner();
  return finishScan({ personId: actor.personId, ticket, api: awsFaceApi() });
}

export async function devScanAction(purpose: string) {
  const actor = await learner();
  return devScan({ personId: actor.personId, purpose: purposeOf(purpose) });
}

export async function startStudyWithScanAction(input: { scanId: number }) {
  const actor = await learner();
  return startStudySession({ personId: actor.personId, scanId: input.scanId });
}

export async function startExamWithScanAction(input: { assignmentId: number; scanId: number }) {
  const actor = await learner();
  return startAttempt({ personId: actor.personId, ...input });
}

export async function endStudyAction(form: FormData) {
  const actor = await learner();
  await endStudySession(actor.personId);
  redirect(`/learn/${Number(form.get("assignmentId"))}`);
}

/** รับทราบเวอร์ชันใหม่ที่เปลี่ยนเล็ก (ADR-0008) */
export async function acknowledgeVersionAction(form: FormData) {
  const actor = await learner();
  const assignmentId = Number(form.get("assignmentId"));
  const out = await acknowledgeVersion({ personId: actor.personId, assignmentId, versionId: Number(form.get("versionId")) });
  redirect(`/learn/${assignmentId}${out.ok ? "" : `?err=${encodeURIComponent(out.error)}`}`);
}

export async function documentLinkAction(input: { assignmentId: number; documentId: number }) {
  const actor = await learner();
  return documentLink({ personId: actor.personId, ...input });
}

export async function readingBeatAction(input: { assignmentId: number; documentId: number; pages: number[]; activeSeconds: number }) {
  const actor = await learner();
  return recordReading({ personId: actor.personId, ...input });
}

export async function answerAction(input: { attemptId: number; questionId: number; choiceId: number }) {
  const actor = await learner();
  return answer({ personId: actor.personId, ...input });
}

export async function leaveAction(input: { attemptId: number }) {
  const actor = await learner();
  return recordLeave({ personId: actor.personId, ...input });
}
