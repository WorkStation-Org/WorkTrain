import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { db } from "@/db";
import {
  approvalEvents,
  assignments,
  choices,
  documents,
  examForms,
  learningSets,
  questions,
  setKinds,
  setVersions,
  DOCUMENT_KINDS,
  SPREAD_MODES,
  type DocumentKind,
  type SpreadMode,
} from "@/db/schema";
import { checkBlueprint, type Blueprint } from "@/domain/blueprint";
import {
  MAX_COVER_BYTES,
  MAX_VIDEO_SECONDS,
  coverKey,
  documentKey,
  formatBytesLimit,
  isDocumentMime,
  isJpeg,
  isVideoMime,
  kindAllowsMime,
  maxBytesFor,
  videoSegmentCount,
} from "@/domain/document";
import { mp4DurationSeconds } from "@/domain/mp4";
import type { Actor } from "@/lib/auth";
import { objectStore, VIDEO_LINK_TTL_SECONDS } from "@/lib/object-store";
import { openBlob, signBlob } from "@/lib/session";
import { fetchOrg } from "@/lib/workid";

/**
 * ชุดการเรียนรู้ฝั่งผู้สร้าง — สร้าง · ตั้งค่า · อัปโหลดเอกสารต้นทาง (spec §2)
 *
 * ★ แก้ได้เฉพาะตอน `draft` และเฉพาะผู้สร้างหรือ TG · ส่งขออนุมัติแล้วแก้ได้ทางเดียวคือผู้อนุมัติ (approval-service)
 * ★ ไฟล์อัปจากเบราว์เซอร์ตรงเข้า R2 ด้วยลิงก์อายุสั้น แล้วค่อยยืนยันด้วย HEAD (R2 ไม่มี presigned POST จำกัดขนาด)
 */

export type Outcome<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type SetRow = typeof learningSets.$inferSelect;

const TITLE_MAX = 200;

function isOwnerOrAdmin(actor: Pick<Actor, "personId" | "role">, set: Pick<SetRow, "authorPersonId">): boolean {
  return actor.role === "admin" || set.authorPersonId === actor.personId;
}

/**
 * แก้ผู้รับได้ไหม — ร่าง: ผู้สร้าง/TG · ใช้อยู่: ผู้สร้าง/TG เพิ่มหรือเปลี่ยนเงื่อนไขได้ (คนที่เพิ่มได้รับมอบทันที ·
 * คนที่หลุดเงื่อนไขเก็บการมอบเดิมไว้ตาม spec §5)
 */
export function canEditAudience(actor: Pick<Actor, "personId" | "role">, set: Pick<SetRow, "authorPersonId" | "status">): boolean {
  return (set.status === "draft" || set.status === "active") && isOwnerOrAdmin(actor, set);
}

/** เห็นชุดนี้ในฐานะคนทำงานกับมัน (ไม่ใช่ผู้เรียน) — ผู้สร้าง · ผู้อนุมัติ · TG */
export function canManage(actor: Pick<Actor, "personId" | "role">, set: Pick<SetRow, "authorPersonId" | "approverPersonId">): boolean {
  return isOwnerOrAdmin(actor, set) || set.approverPersonId === actor.personId;
}

export function canEditDraft(actor: Pick<Actor, "personId" | "role">, set: Pick<SetRow, "authorPersonId" | "status">): boolean {
  return set.status === "draft" && isOwnerOrAdmin(actor, set);
}

export type VersionRow = typeof setVersions.$inferSelect;

/**
 * แก้เอกสาร/ข้อสอบของเวอร์ชันนี้ได้ไหม — ผู้สร้างหรือ TG
 * · เวอร์ชันแรก: ตอนชุดยังเป็นร่าง (`canEditDraft`)
 * · เวอร์ชันใหม่ของชุดที่ใช้อยู่ (spec §7): ยังไม่ส่งขออนุมัติ และยังไม่อนุมัติ — ผู้เรียนยังเรียนเวอร์ชันเดิมระหว่างนี้
 */
export function canEditVersion(
  actor: Pick<Actor, "personId" | "role">,
  set: Pick<SetRow, "authorPersonId" | "status">,
  version: Pick<VersionRow, "versionNo" | "approvedAt" | "submittedAt"> | null,
): boolean {
  if (canEditDraft(actor, set)) return version === null || version.versionNo === 1;
  return (
    set.status === "active" &&
    version !== null &&
    version.versionNo > 1 &&
    version.approvedAt === null &&
    version.submittedAt === null &&
    isOwnerOrAdmin(actor, set)
  );
}

async function loadSet(setId: number): Promise<SetRow | null> {
  const [row] = await db().select().from(learningSets).where(eq(learningSets.id, setId));
  return row ?? null;
}

export async function currentVersion(setId: number) {
  const [row] = await db()
    .select()
    .from(setVersions)
    .where(eq(setVersions.setId, setId))
    .orderBy(desc(setVersions.versionNo))
    .limit(1);
  return row ?? null;
}

/**
 * ผู้อนุมัติค่าเริ่มต้น = หัวหน้าตามผังของผู้สร้าง (ADR-0004)
 * ถามผังไม่ได้หรือไม่มีหัวหน้า = ว่างไว้ ผู้สร้างเลือกเองก่อนส่ง — ไม่เดา
 */
async function defaultApprover(personId: number): Promise<{ personId: number; name: string } | null> {
  const org = await fetchOrg();
  if (!org.ok) return null;
  const me = org.people.find((p) => p.personId === personId);
  if (!me?.managerPersonId) return null;
  const boss = org.people.find((p) => p.personId === me.managerPersonId);
  return boss ? { personId: boss.personId, name: boss.name } : null;
}

/** สร้างชุดร่าง — คัดลอกแม่แบบข้อสอบของชนิด ณ ตอนนี้มาเป็นของชุด (ADR-0011) · ชนิดต้องเปิดอยู่ */
export async function createSet(input: { actor: Actor; title: string; kindId: number }): Promise<Outcome<{ setId: number }>> {
  const { actor } = input;
  if (actor.role !== "admin" && actor.role !== "author") return { ok: false, error: "บัญชีนี้สร้างชุดการเรียนรู้ไม่ได้" };
  const title = input.title.trim();
  if (!title || title.length > TITLE_MAX) return { ok: false, error: `ชื่อชุดต้องมี 1–${TITLE_MAX} ตัวอักษร` };
  const kind = Number.isInteger(input.kindId) && input.kindId > 0 ? (await db().select().from(setKinds).where(eq(setKinds.id, input.kindId)))[0] : undefined;
  if (!kind) return { ok: false, error: "เลือกชนิดของชุด" };
  if (!kind.active) return { ok: false, error: `ชนิด "${kind.name}" ปิดอยู่` };

  const approver = await defaultApprover(actor.personId);
  const [set] = await db()
    .insert(learningSets)
    .values({
      title,
      kindId: kind.id,
      authorPersonId: actor.personId,
      authorName: actor.name,
      approverPersonId: approver?.personId ?? null,
      approverName: approver?.name ?? null,
      blueprint: structuredClone(kind.blueprint),
    })
    .returning({ id: learningSets.id });
  // ไม่ใช่ atomic โดยเจตนา: ต้องรู้ id ของชุดก่อน · ถ้าแถวนี้ล้ม ได้ชุดร่างที่ไม่มีเวอร์ชัน ซึ่ง `addDocument` สร้างให้เองได้
  await db().insert(setVersions).values({ setId: set.id, versionNo: 1, changeKind: "initial", createdByPersonId: actor.personId });
  return { ok: true, setId: set.id };
}

export interface SetSettings {
  title?: string;
  label?: string | null;
  dueDays?: number;
  examMinutes?: number;
  blueprint?: unknown;
  approver?: { personId: number; name: string } | null;
}

export async function updateSettings(input: { actor: Actor; setId: number; settings: SetSettings }): Promise<Outcome> {
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  if (!canEditDraft(input.actor, set)) return { ok: false, error: "แก้ได้เฉพาะชุดร่างของตัวเอง" };
  const s = input.settings;
  const patch: Partial<typeof learningSets.$inferInsert> = { updatedAt: new Date() };

  if (s.title !== undefined) {
    const title = s.title.trim();
    if (!title || title.length > TITLE_MAX) return { ok: false, error: `ชื่อชุดต้องมี 1–${TITLE_MAX} ตัวอักษร` };
    patch.title = title;
  }
  if (s.dueDays !== undefined) {
    if (!Number.isInteger(s.dueDays) || s.dueDays < 1 || s.dueDays > 90) return { ok: false, error: "กำหนดส่งต้องเป็น 1–90 วัน" };
    patch.dueDays = s.dueDays;
  }
  if (s.examMinutes !== undefined) {
    if (!Number.isInteger(s.examMinutes) || s.examMinutes < 1 || s.examMinutes > 120) return { ok: false, error: "เวลาสอบต้องเป็น 1–120 นาที" };
    patch.examMinutes = s.examMinutes;
  }
  if (s.blueprint !== undefined) {
    const checked = checkBlueprint(s.blueprint);
    if (!checked.ok) return checked;
    patch.blueprint = checked.blueprint;
  }
  if (s.approver !== undefined) {
    if (s.approver && s.approver.personId === set.authorPersonId) return { ok: false, error: "ผู้อนุมัติต้องไม่ใช่ผู้สร้างเอง" };
    patch.approverPersonId = s.approver?.personId ?? null;
    patch.approverName = s.approver?.name ?? null;
  }
  await db().update(learningSets).set(patch).where(eq(learningSets.id, set.id));
  if (s.label !== undefined) {
    const version = await currentVersion(set.id);
    if (version) await db().update(setVersions).set({ label: s.label?.trim() || null }).where(eq(setVersions.id, version.id));
  }
  return { ok: true };
}

// ── อัปโหลดเอกสาร ────────────────────────────────────────────────────────

const UPLOAD_KIND = "worktrain.upload";
const UPLOAD_TOKEN_TTL_MS = 60 * 60 * 1000;

interface UploadTicket {
  kind: typeof UPLOAD_KIND;
  setId: number;
  versionId: number;
  docKind: DocumentKind;
  key: string;
  fileName: string;
  mime: string;
  size: number;
  personId: number;
  exp: number;
}

/** ขั้นที่ 1 — ขอลิงก์อัป · คืน token ที่เซ็นแล้วไว้ยืนยันในขั้นที่ 2 (ไม่ต้องเก็บอะไรลงฐานก่อนไฟล์มาถึงจริง) */
export async function requestUpload(input: {
  actor: Actor;
  setId: number;
  docKind: DocumentKind;
  fileName: string;
  mime: string;
  size: number;
  now?: Date;
}): Promise<Outcome<{ uploadUrl: string; token: string }>> {
  const store = objectStore();
  if (!store) return { ok: false, error: "ยังไม่ได้ตั้งที่เก็บไฟล์ (R2) บนเซิร์ฟเวอร์นี้" };
  const set = await loadSet(input.setId);
  if (!set) return { ok: false, error: "ไม่พบชุดนี้" };
  let version = await currentVersion(set.id);
  if (!canEditVersion(input.actor, set, version)) return { ok: false, error: "แก้ได้เฉพาะชุดร่างหรือเวอร์ชันใหม่ที่ยังไม่ส่งของตัวเอง" };
  if (!isDocumentMime(input.mime)) return { ok: false, error: "รับเฉพาะ PDF · Excel (.xlsx) · วิดีโอ MP4" };
  const maxBytes = maxBytesFor(input.mime);
  if (!Number.isInteger(input.size) || input.size <= 0 || input.size > maxBytes) {
    return { ok: false, error: `${isVideoMime(input.mime) ? "วิดีโอ" : "ไฟล์"}ต้องไม่เกิน ${formatBytesLimit(maxBytes)}` };
  }
  if (!kindAllowsMime(input.docKind, input.mime)) return { ok: false, error: "Pricelist ต้องเป็น PDF หรือ Excel — วิดีโอแนบเป็นเอกสารหลักหรืออื่น ๆ" };
  if (input.docKind === "pricelist") {
    const [kind] = await db().select({ allowPricelist: setKinds.allowPricelist }).from(setKinds).where(eq(setKinds.id, set.kindId));
    if (!kind?.allowPricelist) return { ok: false, error: "ชนิดของชุดนี้ไม่ได้เปิดให้แนบ Pricelist" };
  }

  if (!version) {
    [version] = await db()
      .insert(setVersions)
      .values({ setId: set.id, versionNo: 1, changeKind: "initial", createdByPersonId: input.actor.personId })
      .returning();
  }
  const key = documentKey(set.id, version.versionNo, input.mime, randomBytes(12).toString("hex"));
  const now = (input.now ?? new Date()).getTime();
  const ticket: UploadTicket = {
    kind: UPLOAD_KIND,
    setId: set.id,
    versionId: version.id,
    docKind: input.docKind,
    key,
    fileName: input.fileName.slice(0, 200),
    mime: input.mime,
    size: input.size,
    personId: input.actor.personId,
    exp: now + UPLOAD_TOKEN_TTL_MS,
  };
  const uploadUrl = await store.presignPut({ key, contentType: input.mime, contentLength: input.size });
  return { ok: true, uploadUrl, token: await signBlob({ ...ticket }) };
}

/** ขั้นที่ 2 — ยืนยันว่าไฟล์มาถึงจริงและขนาดตรงกับที่ขอ แล้วค่อยลงฐาน */
export async function confirmUpload(input: { actor: Actor; token: string; now?: Date }): Promise<Outcome<{ documentId: number }>> {
  const raw = await openBlob(input.token);
  const t = raw as unknown as UploadTicket | null;
  const now = (input.now ?? new Date()).getTime();
  if (!t || t.kind !== UPLOAD_KIND || t.personId !== input.actor.personId) return { ok: false, error: "ใบอัปโหลดไม่ถูกต้อง" };
  if (t.exp < now) return { ok: false, error: "ใบอัปโหลดหมดอายุ ลองอัปใหม่" };
  const set = await loadSet(t.setId);
  const current = set ? await currentVersion(set.id) : null;
  if (!set || current?.id !== t.versionId || !canEditVersion(input.actor, set, current)) {
    return { ok: false, error: "แก้ได้เฉพาะชุดร่างหรือเวอร์ชันใหม่ที่ยังไม่ส่งของตัวเอง" };
  }

  const store = objectStore();
  if (!store) return { ok: false, error: "ยังไม่ได้ตั้งที่เก็บไฟล์ (R2) บนเซิร์ฟเวอร์นี้" };
  const head = await store.head(t.key);
  if (!head) return { ok: false, error: "ยังไม่พบไฟล์ที่อัป ลองอัปใหม่" };
  if (head.size !== t.size) {
    await store.delete(t.key);
    return { ok: false, error: "ขนาดไฟล์ไม่ตรงกับที่แจ้งไว้" };
  }
  const existing = await db().select({ id: documents.id }).from(documents).where(eq(documents.objectKey, t.key));
  if (existing.length) return { ok: true, documentId: existing[0].id };

  // นับหน้าตอนรับไฟล์ — ผู้เรียนต้องเลื่อนผ่านครบทุกหน้า (spec §9) จึงต้องรู้จำนวนหน้าจากไฟล์จริง ไม่ใช่จากเบราว์เซอร์
  let pageCount: number | null = null;
  let durationSeconds: number | null = null;
  if (isVideoMime(t.mime)) {
    // วิดีโอ: ความยาวจากหัวไฟล์จริง → จำนวนช่วงละ 10 วินาที (ADR-0013) · อ่านทีละช่วงสั้น ไม่โหลดทั้งไฟล์
    const seconds = await mp4DurationSeconds((start, length) => store.getRange(t.key, start, length), head.size);
    if (seconds === null || seconds > MAX_VIDEO_SECONDS) {
      await store.delete(t.key);
      return { ok: false, error: "อ่านไฟล์วิดีโอไม่ได้ — ต้องเป็น MP4 ที่ไม่เสีย (export จากโปรแกรมตัดต่อเป็น MP4 H.264)" };
    }
    durationSeconds = Math.round(seconds);
    pageCount = videoSegmentCount(seconds);
  } else if (t.mime === "application/pdf") {
    const bytes = await store.get(t.key);
    pageCount = bytes ? await countPdfPages(bytes) : null;
    if (pageCount === null) {
      await store.delete(t.key);
      return { ok: false, error: "อ่านไฟล์ PDF ไม่ได้ — ไฟล์อาจเสียหรือมีรหัสผ่าน" };
    }
  }

  const order = await db().select({ id: documents.id }).from(documents).where(eq(documents.versionId, t.versionId));
  const [doc] = await db()
    .insert(documents)
    .values({
      versionId: t.versionId,
      kind: t.docKind,
      objectKey: t.key,
      fileName: t.fileName,
      mimeType: t.mime,
      sizeBytes: t.size,
      pageCount,
      durationSeconds,
      sortOrder: order.length,
    })
    .returning({ id: documents.id });
  return { ok: true, documentId: doc.id };
}

/** จำนวนหน้าของ PDF · อ่านไม่ได้ = null */
export async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const n = doc.getPageCount();
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

export async function removeDocument(input: { actor: Actor; documentId: number }): Promise<Outcome> {
  const [row] = await db()
    .select({ doc: documents, setId: setVersions.setId })
    .from(documents)
    .innerJoin(setVersions, eq(setVersions.id, documents.versionId))
    .where(eq(documents.id, input.documentId));
  if (!row) return { ok: false, error: "ไม่พบเอกสาร" };
  const set = await loadSet(row.setId);
  const current = set ? await currentVersion(set.id) : null;
  if (!set || current?.id !== row.doc.versionId || !canEditVersion(input.actor, set, current)) {
    return { ok: false, error: "แก้ได้เฉพาะชุดร่างหรือเวอร์ชันใหม่ที่ยังไม่ส่งของตัวเอง" };
  }
  const used = await db().select({ id: examForms.id }).from(examForms).where(eq(examForms.versionId, row.doc.versionId)).limit(1);
  if (used.length) return { ok: false, error: "เอกสารนี้ถูกใช้ออกข้อสอบแล้ว — ลบข้อสอบก่อน" };
  await db().delete(documents).where(eq(documents.id, row.doc.id));
  await objectStore()?.delete(row.doc.objectKey);
  if (row.doc.coverKey) await objectStore()?.delete(row.doc.coverKey);
  return { ok: true };
}

// ── จัดเอกสาร (ชื่อ · ใช้ทำอะไร · น้ำหนัก · ลำดับ) ─────────────────────────────

/** เอกสารของเวอร์ชันที่แก้ได้อยู่ตอนนี้ — ร่าง หรือเวอร์ชันใหม่ที่ยังไม่ส่ง */
async function editableDocument(actor: Actor, documentId: number) {
  const [row] = await db()
    .select({ doc: documents, setId: setVersions.setId })
    .from(documents)
    .innerJoin(setVersions, eq(setVersions.id, documents.versionId))
    .where(eq(documents.id, documentId));
  if (!row) return null;
  const set = await loadSet(row.setId);
  const current = set ? await currentVersion(set.id) : null;
  if (!set || current?.id !== row.doc.versionId || !canEditVersion(actor, set, current)) return null;
  return { doc: row.doc, set };
}

const NOT_EDITABLE = "แก้ได้เฉพาะชุดร่างหรือเวอร์ชันใหม่ที่ยังไม่ส่งของตัวเอง";

/** ชื่อที่ผู้เรียนเห็น · ใช้ทำอะไร (เอกสารหลัก/Pricelist/อื่น ๆ) · น้ำหนักตอนเฉลี่ยข้อสอบ */
export async function updateDocument(input: {
  actor: Actor;
  documentId: number;
  fileName?: string;
  kind?: string;
  examWeight?: number;
}): Promise<Outcome> {
  const found = await editableDocument(input.actor, input.documentId);
  if (!found) return { ok: false, error: NOT_EDITABLE };
  const { doc, set } = found;
  const patch: Partial<typeof documents.$inferInsert> = {};
  if (input.fileName !== undefined) {
    const name = input.fileName.trim();
    if (!name || name.length > 200) return { ok: false, error: "ชื่อต้องมี 1–200 ตัวอักษร" };
    patch.fileName = name;
  }
  if (input.kind !== undefined) {
    if (!DOCUMENT_KINDS.includes(input.kind as DocumentKind)) return { ok: false, error: "เลือกว่าใช้ทำอะไร" };
    const kind = input.kind as DocumentKind;
    if (isDocumentMime(doc.mimeType) && !kindAllowsMime(kind, doc.mimeType)) return { ok: false, error: "Pricelist ต้องเป็น PDF หรือ Excel — วิดีโอแนบเป็นเอกสารหลักหรืออื่น ๆ" };
    if (kind === "pricelist") {
      const [k] = await db().select({ allowPricelist: setKinds.allowPricelist }).from(setKinds).where(eq(setKinds.id, set.kindId));
      if (!k?.allowPricelist) return { ok: false, error: "ชนิดของชุดนี้ไม่ได้เปิดให้แนบ Pricelist" };
    }
    patch.kind = kind;
  }
  if (input.examWeight !== undefined) {
    if (!Number.isInteger(input.examWeight) || input.examWeight < 0 || input.examWeight > 5) return { ok: false, error: "น้ำหนักต้องเป็น 0–5" };
    patch.examWeight = input.examWeight;
  }
  if (Object.keys(patch).length) await db().update(documents).set(patch).where(eq(documents.id, doc.id));
  return { ok: true };
}

/** เลื่อนเอกสารขึ้น/ลงหนึ่งตำแหน่ง — ลำดับที่ผู้เรียนเห็น (ลำดับใหม่ 0..n-1 ทุกครั้ง กันค่าซ้ำจากข้อมูลเก่า) */
export async function moveDocument(input: { actor: Actor; documentId: number; direction: -1 | 1 }): Promise<Outcome> {
  const found = await editableDocument(input.actor, input.documentId);
  if (!found) return { ok: false, error: NOT_EDITABLE };
  const rows = await db()
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.versionId, found.doc.versionId))
    .orderBy(asc(documents.sortOrder), asc(documents.id));
  const ids = rows.map((r) => r.id);
  const i = ids.indexOf(found.doc.id);
  const j = i + input.direction;
  if (i < 0 || j < 0 || j >= ids.length) return { ok: true };
  [ids[i], ids[j]] = [ids[j], ids[i]];
  for (const [order, id] of ids.entries()) await db().update(documents).set({ sortOrder: order }).where(eq(documents.id, id));
  return { ok: true };
}

/** วิธีเฉลี่ยข้อสอบตอนให้ AI ออก (`src/domain/spread.ts`) */
export async function setSpreadMode(input: { actor: Actor; setId: number; mode: string }): Promise<Outcome> {
  if (!SPREAD_MODES.includes(input.mode as SpreadMode)) return { ok: false, error: "เลือกวิธีเฉลี่ย" };
  const set = await loadSet(input.setId);
  if (!set || !canEditVersion(input.actor, set, await currentVersion(set.id))) return { ok: false, error: NOT_EDITABLE };
  await db().update(learningSets).set({ spreadMode: input.mode as SpreadMode, updatedAt: new Date() }).where(eq(learningSets.id, set.id));
  return { ok: true };
}

// ── ปกวิดีโอ (ADR-0013) ─────────────────────────────────────────────────────

async function documentWithSet(documentId: number) {
  const [row] = await db()
    .select({ doc: documents, setId: setVersions.setId })
    .from(documents)
    .innerJoin(setVersions, eq(setVersions.id, documents.versionId))
    .where(eq(documents.id, documentId));
  if (!row) return null;
  const set = await loadSet(row.setId);
  return set ? { doc: row.doc, set } : null;
}

/**
 * ตั้งปกวิดีโอจากเฟรมที่ผู้สร้างจับในเบราว์เซอร์ — ผู้สร้างหรือ TG เปลี่ยนได้ทุกเมื่อ (ปกไม่ใช่เนื้อหาที่ต้องเรียน จึงไม่ผูกกับร่าง/อนุมัติ)
 * ตรวจไฟล์เองว่าเป็น JPEG จริงและไม่ใหญ่เกิน · ปกเก่าถูกลบจากที่เก็บ
 */
export async function setVideoCover(input: { actor: Actor; documentId: number; bytes: Uint8Array; ms: number }): Promise<Outcome> {
  const found = await documentWithSet(input.documentId);
  if (!found || !isOwnerOrAdmin(input.actor, found.set)) return { ok: false, error: "ไม่พบวิดีโอนี้ หรือไม่มีสิทธิ์เปลี่ยนปก" };
  const { doc } = found;
  if (!isVideoMime(doc.mimeType)) return { ok: false, error: "ตั้งปกได้เฉพาะวิดีโอ" };
  if (input.bytes.byteLength > MAX_COVER_BYTES || !isJpeg(input.bytes)) return { ok: false, error: "ภาพปกไม่ถูกต้อง ลองเลือกเฟรมใหม่" };
  const maxMs = (doc.durationSeconds ?? 0) * 1000 + 1000;
  const ms = Math.round(input.ms);
  if (!Number.isFinite(ms) || ms < 0 || ms > maxMs) return { ok: false, error: "ตำแหน่งเฟรมอยู่นอกความยาวคลิป" };
  const store = objectStore();
  if (!store) return { ok: false, error: "ยังไม่ได้ตั้งที่เก็บไฟล์ (R2) บนเซิร์ฟเวอร์นี้" };
  const key = coverKey(doc.objectKey, randomBytes(12).toString("hex"));
  await store.put(key, input.bytes, "image/jpeg");
  await db().update(documents).set({ coverKey: key, coverMs: ms }).where(eq(documents.id, doc.id));
  if (doc.coverKey) await store.delete(doc.coverKey);
  return { ok: true };
}

/** ลิงก์วิดีโอให้ผู้สร้างเลือกเฟรมปก — คนที่ทำงานกับชุดนี้ (`canManage`) เท่านั้น · ไม่ต้องมีรอบเรียน ไม่บันทึกเป็นการเปิดของผู้เรียน */
export async function authorVideoLink(input: { actor: Actor; documentId: number }): Promise<Outcome<{ url: string }>> {
  const found = await documentWithSet(input.documentId);
  if (!found || !canManage(input.actor, found.set) || !isVideoMime(found.doc.mimeType)) return { ok: false, error: "ไม่พบวิดีโอนี้" };
  const store = objectStore();
  if (!store) return { ok: false, error: "ยังไม่ได้ตั้งที่เก็บไฟล์ (R2) บนเซิร์ฟเวอร์นี้" };
  const url = await store.presignGet({ key: found.doc.objectKey, contentType: found.doc.mimeType, disposition: "inline", expiresIn: VIDEO_LINK_TTL_SECONDS });
  return { ok: true, url };
}

/** ภาพปก — คนที่ทำงานกับชุด หรือผู้เรียนที่ได้รับมอบชุดนี้ · `null` = ไม่มีปกหรือไม่มีสิทธิ์ */
export async function coverImage(input: { actor: Pick<Actor, "personId" | "role">; documentId: number }): Promise<Uint8Array | null> {
  const found = await documentWithSet(input.documentId);
  if (!found?.doc.coverKey) return null;
  if (!canManage(input.actor, found.set)) {
    const mine = await db()
      .select({ id: assignments.id })
      .from(assignments)
      .where(and(eq(assignments.setId, found.set.id), eq(assignments.personId, input.actor.personId)))
      .limit(1);
    if (!mine.length) return null;
  }
  return (await objectStore()?.get(found.doc.coverKey)) ?? null;
}

/** ที่อยู่ภาพปกสำหรับหน้าจอ — `v` เปลี่ยนเมื่อเปลี่ยนเฟรม ให้เบราว์เซอร์ไม่ใช้ภาพเก่าใน cache */
export function coverPath(doc: { id: number; coverKey: string | null; coverMs: number | null }): string | null {
  return doc.coverKey ? `/api/covers/${doc.id}?v=${doc.coverKey.slice(-12, -4)}` : null;
}

// ── อ่าน ───────────────────────────────────────────────────────────────────

/** ชุดที่คนนี้ทำงานด้วย — ของตัวเอง + ที่ตัวเองเป็นผู้อนุมัติ · TG เห็นทุกชุด */
export async function listManagedSets(actor: Pick<Actor, "personId" | "role">) {
  const q = db().select().from(learningSets);
  const rows =
    actor.role === "admin"
      ? await q.orderBy(desc(learningSets.updatedAt))
      : await q
          .where(or(eq(learningSets.authorPersonId, actor.personId), eq(learningSets.approverPersonId, actor.personId)))
          .orderBy(desc(learningSets.updatedAt));
  return rows;
}

export interface QuestionView {
  id: number;
  sortOrder: number;
  topic: string;
  level: string;
  text: string;
  sourceRef: string;
  priceCheck: string;
  choices: { id: number; sortOrder: number; text: string; isCorrect: boolean }[];
}

export interface SetDetail {
  set: SetRow;
  kind: { id: number; name: string; allowPricelist: boolean };
  version: typeof setVersions.$inferSelect | null;
  documents: (typeof documents.$inferSelect)[];
  forms: { id: number; kind: string; formNo: number; questions: QuestionView[] }[];
  events: (typeof approvalEvents.$inferSelect)[];
  blueprint: Blueprint;
}

/** รายละเอียดชุด + ข้อสอบของเวอร์ชันล่าสุด — เฉพาะคนที่ `canManage` (มีเฉลยอยู่ในนี้) */
export async function getSetDetail(actor: Pick<Actor, "personId" | "role">, setId: number): Promise<SetDetail | null> {
  const set = await loadSet(setId);
  if (!set || !canManage(actor, set)) return null;
  const [kind] = await db()
    .select({ id: setKinds.id, name: setKinds.name, allowPricelist: setKinds.allowPricelist })
    .from(setKinds)
    .where(eq(setKinds.id, set.kindId));
  const version = await currentVersion(set.id);
  const docs = version
    ? await db().select().from(documents).where(eq(documents.versionId, version.id)).orderBy(asc(documents.sortOrder))
    : [];
  const formRows = version
    ? await db().select().from(examForms).where(eq(examForms.versionId, version.id)).orderBy(asc(examForms.kind), asc(examForms.formNo))
    : [];
  const formIds = formRows.map((f) => f.id);
  const qRows = formIds.length
    ? await db().select().from(questions).where(inArray(questions.formId, formIds)).orderBy(asc(questions.sortOrder))
    : [];
  const qIds = qRows.map((q) => q.id);
  const cRows = qIds.length
    ? await db().select().from(choices).where(inArray(choices.questionId, qIds)).orderBy(asc(choices.sortOrder))
    : [];
  const events = await db()
    .select()
    .from(approvalEvents)
    .where(eq(approvalEvents.setId, set.id))
    .orderBy(desc(approvalEvents.createdAt), desc(approvalEvents.id));

  const forms = formRows.map((f) => ({
    id: f.id,
    kind: f.kind,
    formNo: f.formNo,
    questions: qRows
      .filter((q) => q.formId === f.id)
      .map((q) => ({
        id: q.id,
        sortOrder: q.sortOrder,
        topic: q.topic,
        level: q.level,
        text: q.text,
        sourceRef: q.sourceRef,
        priceCheck: q.priceCheck,
        choices: cRows
          .filter((c) => c.questionId === q.id)
          .map((c) => ({ id: c.id, sortOrder: c.sortOrder, text: c.text, isCorrect: c.isCorrect })),
      })),
  }));
  return { set, kind, version, documents: docs, forms, events, blueprint: set.blueprint as Blueprint };
}

