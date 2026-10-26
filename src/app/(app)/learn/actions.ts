"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { faceVerifier, giveConsent, hasConsent, recordScan } from "@/lib/identity-service";
import { answer, documentLink, endStudySession, recordLeave, recordReading, startAttempt, startStudySession } from "@/lib/learn-service";

/**
 * server action ของผู้เรียน — ตัวตนมาจาก session เสมอ · service ตรวจเองว่าการมอบ/ครั้งที่สอบเป็นของคนนี้
 *
 * ★ การสแกนตอนนี้ใช้ `faceVerifier()` ซึ่งมีแต่ตัว dev — บน production เริ่มเรียน/สอบไม่ได้จนกว่าจะมี AWS (ADR-0006)
 */

async function learner() {
  const actor = await requireUser();
  if (!(await hasConsent(actor.personId))) redirect("/consent");
  return actor;
}

function back(assignmentId: number, error?: string): never {
  redirect(`/learn/${assignmentId}${error ? `?err=${encodeURIComponent(error)}` : ""}`);
}

export async function consentAction() {
  const actor = await requireUser();
  await giveConsent(actor.personId);
  redirect("/learn");
}

/** สแกนใบหน้า → เริ่มรอบเรียน */
export async function startStudyAction(form: FormData) {
  const actor = await learner();
  const assignmentId = Number(form.get("assignmentId"));
  const scan = await recordScan({ personId: actor.personId, purpose: "study", verifier: faceVerifier() });
  if (!scan.ok) back(assignmentId, scan.error);
  if (!scan.passed) back(assignmentId, "สแกนใบหน้าไม่ผ่าน ลองใหม่ในที่ที่มีแสงพอ");
  const s = await startStudySession({ personId: actor.personId, scanId: scan.scanId });
  back(assignmentId, s.ok ? undefined : s.error);
}

export async function endStudyAction(form: FormData) {
  const actor = await learner();
  await endStudySession(actor.personId);
  back(Number(form.get("assignmentId")));
}

/** สแกนใบหน้า → เริ่มสอบ */
export async function startExamAction(form: FormData) {
  const actor = await learner();
  const assignmentId = Number(form.get("assignmentId"));
  const scan = await recordScan({ personId: actor.personId, purpose: "exam", verifier: faceVerifier() });
  if (!scan.ok) back(assignmentId, scan.error);
  if (!scan.passed) back(assignmentId, "สแกนใบหน้าไม่ผ่าน ลองใหม่ในที่ที่มีแสงพอ");
  const out = await startAttempt({ personId: actor.personId, assignmentId, scanId: scan.scanId });
  if (!out.ok) back(assignmentId, out.error);
  redirect(`/learn/${assignmentId}/exam/${out.attemptId}`);
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
