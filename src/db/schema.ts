import {
  serial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * ตารางของ WorkTrain รุ่นที่ 1 — คำศัพท์ตรงกับ `CONTEXT.md` · เหตุผลอยู่ใน `docs/spec-release-1.md` และ `docs/adr/`
 *
 * ★ ไม่มีตาราง `users` / ตำแหน่ง / ทีม / หัวหน้า โดยเจตนา (ADR-0002 · กติกาเครือข้อ 2)
 *   คนทุกคนอ้างด้วย `personId` ของ WorkID · ตำแหน่งอ้างด้วย `positionId` (= `positions.id` ของ WorkHR · spec §6.1)
 *   ทีมอ้างด้วย `teamId` ของ WorkID — อ่านผังจาก `/api/v1/org` ตอนใช้งาน
 *   ยกเว้น **ชื่อ ณ เวลานั้น** (snapshot) ในแถวที่ต้องเก็บตลอดไป เพราะ WorkID ลบคนพ้นสภาพหลัง 90 วัน
 *
 * ★ neon-http ไม่มี transaction — ของที่ต้องลงพร้อมกันใช้ `atomic()` (`src/db/atomic.ts`)
 * ★ ไฟล์อยู่ใน R2 แบบ private — เก็บแค่ key ไม่เก็บ URL (ADR-0010)
 */

const ts = (name: string) => timestamp(name, { withTimezone: true });

// ── ชุดการเรียนรู้ ───────────────────────────────────────────────────────────

/** ชนิดของชุด — สินค้า (PD · มีแคตตาล็อก + Pricelist) หรือทั่วไป */
export const SET_KINDS = ["product", "general"] as const;
export type SetKind = (typeof SET_KINDS)[number];

/** สถานะของชุด (spec §2) — ตีกลับ = กลับไป `draft` พร้อมเหตุการณ์ใน `approval_events` */
export const SET_STATUSES = ["draft", "pending_approval", "active", "closed"] as const;
export type SetStatus = (typeof SET_STATUSES)[number];

/**
 * ชุดการเรียนรู้ (CONTEXT.md) — หน่วยหลักของระบบ
 *
 * ผู้อนุมัติค่าเริ่มต้น = หัวหน้าตามผังของผู้สร้าง ณ ตอนสร้าง · ผู้สร้างเปลี่ยนได้ (ADR-0004)
 */
export const learningSets = pgTable(
  "learning_sets",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    kind: text("kind", { enum: SET_KINDS }).notNull(),
    status: text("status", { enum: SET_STATUSES }).notNull().default("draft"),
    authorPersonId: integer("author_person_id").notNull(),
    authorName: text("author_name").notNull(),
    approverPersonId: integer("approver_person_id"),
    approverName: text("approver_name"),
    /** กำหนดส่งนับจากวันที่ได้รับมอบ (spec §2 · ค่าเริ่มต้น 7 วัน) */
    dueDays: smallint("due_days").notNull().default(7),
    /** เวลาสอบต่อครั้ง (spec §10 · ค่าเริ่มต้น 15 นาที) */
    examMinutes: smallint("exam_minutes").notNull().default(15),
    /** เกณฑ์ผ่านเป็นร้อยละ — 80 ตามโจทย์ */
    passPercent: smallint("pass_percent").notNull().default(80),
    /** สัดส่วนหัวข้อ × ระดับของ 10 ข้อ (spec §3) — `[{ topic, level, count }]` */
    blueprint: jsonb("blueprint").notNull(),
    approvedAt: ts("approved_at"),
    closedAt: ts("closed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("learning_sets_due_days", sql`${t.dueDays} between 1 and 90`),
    check("learning_sets_exam_minutes", sql`${t.examMinutes} between 1 and 120`),
    check("learning_sets_pass_percent", sql`${t.passPercent} between 1 and 100`),
    check("learning_sets_active_has_approval", sql`${t.status} <> 'active' or ${t.approvedAt} is not null`),
    index("learning_sets_author_idx").on(t.authorPersonId),
    index("learning_sets_approver_idx").on(t.approverPersonId),
  ],
);

/** การเปลี่ยนของเวอร์ชันใหม่ (ADR-0008) — `initial` = เวอร์ชันแรก */
export const CHANGE_KINDS = ["initial", "small", "large"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/**
 * เวอร์ชันของเอกสารต้นทาง — ครั้งที่สอบผูกกับเวอร์ชันที่สอบเสมอ (ADR-0008)
 * `changeKind` ผู้อนุมัติเลือกตอนอนุมัติเวอร์ชันใหม่ · null = ยังไม่ได้เลือก
 */
export const setVersions = pgTable(
  "set_versions",
  {
    id: serial("id").primaryKey(),
    setId: integer("set_id")
      .notNull()
      .references(() => learningSets.id, { onDelete: "restrict" }),
    versionNo: smallint("version_no").notNull(),
    /** ป้ายตามเอกสาร เช่น "V.3 · 09/2026" — แสดงผลเท่านั้น */
    label: text("label"),
    changeKind: text("change_kind", { enum: CHANGE_KINDS }),
    /** สรุปสิ่งที่เปลี่ยนจาก AI ให้ผู้อนุมัติดู (spec §7) */
    changeSummary: text("change_summary"),
    approvedAt: ts("approved_at"),
    createdByPersonId: integer("created_by_person_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("set_versions_set_no_uniq").on(t.setId, t.versionNo),
    check("set_versions_first_is_initial", sql`(${t.versionNo} = 1) = (${t.changeKind} is not distinct from 'initial')`),
  ],
);

/** ชนิดของเอกสารต้นทาง — Pricelist ดูได้อย่างเดียวพร้อมลายน้ำ (ADR-0010) */
export const DOCUMENT_KINDS = ["catalog", "pricelist", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    versionId: integer("version_id")
      .notNull()
      .references(() => setVersions.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
    /** key ใน R2 แบบ private — ไม่เก็บ URL (ADR-0010) */
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** จำนวนหน้า — ผู้เรียนต้องเลื่อนผ่านครบทุกหน้า (spec §9) · null = ไม่ใช่เอกสารแบบหน้า */
    pageCount: smallint("page_count"),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("documents_object_key_uniq").on(t.objectKey),
    index("documents_version_idx").on(t.versionId),
  ],
);

// ── ข้อสอบ ─────────────────────────────────────────────────────────────────

/** `full` = ชุดข้อสอบเต็ม 10 ข้อ (5 ชุดต่อเวอร์ชัน · ADR-0003) · `delta` = ข้อสอบเฉพาะส่วนที่เปลี่ยนใหญ่ (ADR-0008) */
export const FORM_KINDS = ["full", "delta"] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export const FORMS_PER_VERSION = 5;

export const examForms = pgTable(
  "exam_forms",
  {
    id: serial("id").primaryKey(),
    versionId: integer("version_id")
      .notNull()
      .references(() => setVersions.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: FORM_KINDS }).notNull(),
    formNo: smallint("form_no").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("exam_forms_version_kind_no_uniq").on(t.versionId, t.kind, t.formNo),
    check("exam_forms_form_no", sql`${t.formNo} between 1 and ${sql.raw(String(FORMS_PER_VERSION))}`),
  ],
);

/** หัวข้อของข้อสอบ — ตามแม่แบบ "สินค้าใหม่ (PD)" · `general` = แม่แบบทั่วไป (spec §3) */
export const TOPICS = ["spec", "price", "material", "pairing", "general"] as const;
export type Topic = (typeof TOPICS)[number];

/** ระดับ — จำ 4 · เข้าใจ 4 · สถานการณ์ 2 (spec §3) */
export const LEVELS = ["recall", "understand", "scenario"] as const;
export type Level = (typeof LEVELS)[number];

/** ผลตรวจตัวเลขราคากับ Pricelist (spec §3) — `mismatch` ต้องขึ้นให้ผู้อนุมัติเห็น ไม่ซ่อน */
export const PRICE_CHECKS = ["not_applicable", "match", "mismatch"] as const;

export const questions = pgTable(
  "questions",
  {
    id: serial("id").primaryKey(),
    formId: integer("form_id")
      .notNull()
      .references(() => examForms.id, { onDelete: "cascade" }),
    sortOrder: smallint("sort_order").notNull(),
    topic: text("topic", { enum: TOPICS }).notNull(),
    level: text("level", { enum: LEVELS }).notNull(),
    text: text("text").notNull(),
    /** ที่มาในเอกสาร เช่น "แคตตาล็อก หน้า 5" หรือ "Pricelist แถว 12 คอลัมน์ราคา" — AI ต้องระบุทุกข้อ */
    sourceRef: text("source_ref").notNull(),
    priceCheck: text("price_check", { enum: PRICE_CHECKS }).notNull().default("not_applicable"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("questions_form_order_uniq").on(t.formId, t.sortOrder)],
);

/** ตัวเลือก — ปรนัย 4 ตัวเลือก ถูกข้อเดียว (บังคับที่ service ตอนอนุมัติ ไม่ใช่ที่ฐาน เพราะแก้ทีละตัวเลือก) */
export const choices = pgTable(
  "choices",
  {
    id: serial("id").primaryKey(),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    sortOrder: smallint("sort_order").notNull(),
    text: text("text").notNull(),
    isCorrect: boolean("is_correct").notNull().default(false),
  },
  (t) => [uniqueIndex("choices_question_order_uniq").on(t.questionId, t.sortOrder)],
);

// ── การอนุมัติ ─────────────────────────────────────────────────────────────

export const APPROVAL_ACTIONS = [
  "submitted",
  "approved",
  "returned",
  "question_edited",
  "question_regenerated",
  "approver_changed",
] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

/**
 * ประวัติการอนุมัติและการแก้ข้อสอบ (spec §4) — **มีแต่ insert** (trigger ใน migration ปฏิเสธ update/delete)
 * การแก้ข้อสอบเก็บก่อน/หลังใน `detail`
 */
export const approvalEvents = pgTable(
  "approval_events",
  {
    id: serial("id").primaryKey(),
    setId: integer("set_id")
      .notNull()
      .references(() => learningSets.id, { onDelete: "restrict" }),
    versionId: integer("version_id").references(() => setVersions.id, { onDelete: "restrict" }),
    action: text("action", { enum: APPROVAL_ACTIONS }).notNull(),
    actorPersonId: integer("actor_person_id").notNull(),
    actorName: text("actor_name").notNull(),
    comment: text("comment"),
    detail: jsonb("detail"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("approval_events_set_idx").on(t.setId, t.createdAt),
    check("approval_events_return_has_comment", sql`${t.action} <> 'returned' or length(trim(${t.comment})) > 0`),
  ],
);

// ── ผู้รับและการมอบ ─────────────────────────────────────────────────────────

/**
 * เงื่อนไขผู้รับ (spec §5) — เก็บเงื่อนไข ไม่ใช่รายชื่อ คนที่เข้าตำแหน่ง/ทีมทีหลังได้รับมอบด้วย
 * `position` อ้าง `positionId` ของ WorkHR · `team` / `manages_team` อ้าง `teamId` ของ WorkID ·
 * `adhoc_group` อ้าง `adhoc_groups.id` · `person` อ้าง `personId`
 */
export const AUDIENCE_KINDS = ["position", "team", "manages_team", "adhoc_group", "person"] as const;
export type AudienceKind = (typeof AUDIENCE_KINDS)[number];

export const audienceRules = pgTable(
  "audience_rules",
  {
    setId: integer("set_id")
      .notNull()
      .references(() => learningSets.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: AUDIENCE_KINDS }).notNull(),
    refId: integer("ref_id").notNull(),
    /** ชื่อ ณ ตอนตั้ง (ตำแหน่ง · ทีม · กลุ่ม · คน) — แสดงเมื่อของจริงหายไปแล้ว */
    label: text("label").notNull(),
  },
  (t) => [primaryKey({ columns: [t.setId, t.kind, t.refId] })],
);

/** กลุ่มเฉพาะกิจ — สิ่งเดียวเรื่องคนที่ WorkTrain เก็บเอง (ADR-0002) */
export const adhocGroups = pgTable("adhoc_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdByPersonId: integer("created_by_person_id").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const adhocGroupMembers = pgTable(
  "adhoc_group_members",
  {
    groupId: integer("group_id")
      .notNull()
      .references(() => adhocGroups.id, { onDelete: "cascade" }),
    personId: integer("person_id").notNull(),
    personName: text("person_name").notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.personId] })],
);

/** เส้นทาง Onboarding (ADR-0005) — ตำแหน่งอ้างด้วย `positionId` ของ WorkHR เท่านั้น (spec §6.1) */
export const onboardingPaths = pgTable(
  "onboarding_paths",
  {
    positionId: integer("position_id").notNull(),
    /** ชื่อตำแหน่ง ณ ตอนผูก — แสดงผลเท่านั้น ห้ามใช้จับคู่ */
    positionLabel: text("position_label").notNull(),
    setId: integer("set_id")
      .notNull()
      .references(() => learningSets.id, { onDelete: "cascade" }),
    createdByPersonId: integer("created_by_person_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.positionId, t.setId] })],
);

/** มาจากเงื่อนไขผู้รับ หรือจากเส้นทาง Onboarding */
export const ASSIGNMENT_SOURCES = ["audience", "onboarding"] as const;

/**
 * การมอบ (CONTEXT.md) — คนหนึ่งต่อชุดหนึ่งมีได้แถวเดียว
 * `passedAt` = สอบผ่านชุดเต็มครั้งแรก · ผ่านแล้วไม่ย้อนกลับ (เปลี่ยนใหญ่สอบเพิ่มที่ `delta` แยก)
 */
export const assignments = pgTable(
  "assignments",
  {
    id: serial("id").primaryKey(),
    setId: integer("set_id")
      .notNull()
      .references(() => learningSets.id, { onDelete: "restrict" }),
    personId: integer("person_id").notNull(),
    personName: text("person_name").notNull(),
    source: text("source", { enum: ASSIGNMENT_SOURCES }).notNull(),
    assignedAt: ts("assigned_at").notNull().defaultNow(),
    dueAt: ts("due_at").notNull(),
    passedAt: ts("passed_at"),
    /** ไม่ผ่าน 2 ครั้งติด = ต้องอ่านใหม่ก่อนสอบ (spec §10) · ล้างเมื่ออ่านครบอีกรอบ */
    relearnRequiredAt: ts("relearn_required_at"),
    /** รอบการอ่านปัจจุบัน — เริ่ม 1 · ต้องอ่านใหม่ = +1 แล้วนับหน้าที่อ่านใหม่ทั้งหมดใน `reading_progress` รอบนั้น */
    readRound: smallint("read_round").notNull().default(1),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("assignments_set_person_uniq").on(t.setId, t.personId),
    index("assignments_person_idx").on(t.personId),
    check("assignments_due_after_assigned", sql`${t.dueAt} > ${t.assignedAt}`),
  ],
);

/** รับทราบเปลี่ยนเล็ก (ADR-0008) — มีแต่ insert */
export const versionAcknowledgements = pgTable(
  "version_acknowledgements",
  {
    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "restrict" }),
    versionId: integer("version_id")
      .notNull()
      .references(() => setVersions.id, { onDelete: "restrict" }),
    acknowledgedAt: ts("acknowledged_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.assignmentId, t.versionId] })],
);

// ── การยืนยันตัวตน ─────────────────────────────────────────────────────────

/**
 * ความยินยอม PDPA สำหรับใบหน้า (spec §8) — ไม่ยินยอม = ใช้แอปไม่ได้
 * `consentVersion` = ฉบับของข้อความยินยอม · แก้ข้อความ = ทุกคนต้องยินยอมใหม่
 */
export const faceConsents = pgTable(
  "face_consents",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id").notNull(),
    consentVersion: text("consent_version").notNull(),
    consentedAt: ts("consented_at").notNull().defaultNow(),
    withdrawnAt: ts("withdrawn_at"),
  },
  (t) => [
    // ยินยอมที่ยังมีผลได้แถวเดียวต่อคน
    uniqueIndex("face_consents_active_uniq").on(t.personId).where(sql`${t.withdrawnAt} is null`),
  ],
);

/** `pending` = ลงทะเบียนใหม่ รอ TG อนุมัติ (spec §8) */
export const ENROLLMENT_STATUSES = ["active", "pending", "superseded", "rejected", "deleted"] as const;

export const faceEnrollments = pgTable(
  "face_enrollments",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id").notNull(),
    /** ภาพอ้างอิงใน R2 private · ลบเมื่อถอนความยินยอมหรือพ้นสภาพ */
    objectKey: text("object_key"),
    status: text("status", { enum: ENROLLMENT_STATUSES }).notNull(),
    reviewedByPersonId: integer("reviewed_by_person_id"),
    reviewedAt: ts("reviewed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("face_enrollments_active_uniq").on(t.personId).where(sql`${t.status} = 'active'`),
    check("face_enrollments_deleted_has_no_image", sql`${t.status} <> 'deleted' or ${t.objectKey} is null`),
  ],
);

/** `enroll` = ลงทะเบียนใบหน้า (ครั้งแรก หรือขอลงทะเบียนใหม่) */
export const SCAN_PURPOSES = ["study", "exam", "enroll"] as const;
/** `liveness_fail` = ไม่ใช่คนจริงต่อหน้ากล้อง · `no_match` = คนจริงแต่ไม่ตรงกับใบหน้าที่ลงทะเบียน */
export const SCAN_RESULTS = ["pass", "liveness_fail", "no_match", "error"] as const;
export const SCAN_REVIEWS = ["confirmed", "rejected"] as const;

/**
 * การสแกน (ADR-0006) — ภาพเก็บ 90 วันแล้วลบ (`deleteAfter`) · TG ตรวจภาพเมื่อไม่ผ่าน 3 ครั้งติด
 */
export const faceScans = pgTable(
  "face_scans",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id").notNull(),
    purpose: text("purpose", { enum: SCAN_PURPOSES }).notNull(),
    result: text("result", { enum: SCAN_RESULTS }).notNull(),
    /** ความเหมือนจาก CompareFaces (0–100) · null = ไม่ได้เทียบ */
    similarity: numeric("similarity", { precision: 5, scale: 2 }),
    objectKey: text("object_key"),
    deleteAfter: ts("delete_after").notNull(),
    reviewedByPersonId: integer("reviewed_by_person_id"),
    review: text("review", { enum: SCAN_REVIEWS }),
    reviewedAt: ts("reviewed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("face_scans_person_idx").on(t.personId, t.createdAt)],
);

// ── การเรียนและการสอบ ──────────────────────────────────────────────────────

/** เหตุที่รอบเรียนจบ (spec §9) */
export const SESSION_END_REASONS = ["logout", "idle", "expired"] as const;

/** รอบเรียน (CONTEXT.md) — เริ่มด้วยการสแกนที่ผ่าน · ความคืบหน้าเป็นของผู้เรียน ไม่ใช่ของรอบ */
export const studySessions = pgTable(
  "study_sessions",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id").notNull(),
    scanId: integer("scan_id")
      .notNull()
      .references(() => faceScans.id, { onDelete: "restrict" }),
    startedAt: ts("started_at").notNull().defaultNow(),
    lastActiveAt: ts("last_active_at").notNull().defaultNow(),
    endedAt: ts("ended_at"),
    endReason: text("end_reason", { enum: SESSION_END_REASONS }),
  },
  (t) => [
    check("study_sessions_end_pair", sql`(${t.endedAt} is null) = (${t.endReason} is null)`),
    uniqueIndex("study_sessions_open_uniq").on(t.personId).where(sql`${t.endedAt} is null`),
  ],
);

/**
 * ความคืบหน้าการอ่านต่อเอกสาร — หน้าที่เลื่อนผ่านแล้ว + เวลาอ่านที่แท็บอยู่หน้า (spec §9)
 * `completedAt` = ผ่านครบทุกหน้า · forced re-learn ล้างค่านี้ด้วยการเริ่มรอบอ่านใหม่ (`readRound`)
 */
export const readingProgress = pgTable(
  "reading_progress",
  {
    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    readRound: smallint("read_round").notNull().default(1),
    pagesSeen: smallint("pages_seen").array().notNull().default(sql`'{}'::smallint[]`),
    activeSeconds: integer("active_seconds").notNull().default(0),
    completedAt: ts("completed_at"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.assignmentId, t.documentId, t.readRound] })],
);

/** เหตุที่ครั้งที่สอบจบ (spec §10) — `left_page` = ออกจากหน้าสอบครั้งที่ 5 */
export const ATTEMPT_END_REASONS = ["submitted", "timeout", "left_page"] as const;
export const MAX_LEAVES_BEFORE_SUBMIT = 5;

/**
 * ครั้งที่สอบ (CONTEXT.md) — ผูกกับเวอร์ชันและชุดข้อสอบที่ได้ · ลำดับข้อ/ตัวเลือกที่สลับแล้วเก็บไว้ตรวจย้อนหลัง
 * คะแนนครั้งแรก = แถวแรกตาม `startedAt` ของการมอบนั้นที่ `kind = 'full'` (ADR-0009)
 */
export const attempts = pgTable(
  "attempts",
  {
    id: serial("id").primaryKey(),
    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "restrict" }),
    versionId: integer("version_id")
      .notNull()
      .references(() => setVersions.id, { onDelete: "restrict" }),
    formId: integer("form_id")
      .notNull()
      .references(() => examForms.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: FORM_KINDS }).notNull(),
    scanId: integer("scan_id")
      .notNull()
      .references(() => faceScans.id, { onDelete: "restrict" }),
    /** `[{ questionId, choiceIds: [...] }]` ตามลำดับที่แสดง */
    layout: jsonb("layout").notNull(),
    /** `{ [questionId]: choiceId }` */
    answers: jsonb("answers").notNull().default({}),
    leaveCount: smallint("leave_count").notNull().default(0),
    startedAt: ts("started_at").notNull().defaultNow(),
    deadlineAt: ts("deadline_at").notNull(),
    endedAt: ts("ended_at"),
    endReason: text("end_reason", { enum: ATTEMPT_END_REASONS }),
    scorePercent: smallint("score_percent"),
    passed: boolean("passed"),
  },
  (t) => [
    index("attempts_assignment_idx").on(t.assignmentId, t.startedAt),
    check("attempts_end_fields", sql`(${t.endedAt} is null) = (${t.endReason} is null) and (${t.endedAt} is null) = (${t.scorePercent} is null) and (${t.endedAt} is null) = (${t.passed} is null)`),
    check("attempts_leave_count", sql`${t.leaveCount} between 0 and ${sql.raw(String(MAX_LEAVES_BEFORE_SUBMIT))}`),
    check("attempts_score", sql`${t.scorePercent} is null or ${t.scorePercent} between 0 and 100`),
    // สอบค้างได้ครั้งเดียวต่อการมอบ
    uniqueIndex("attempts_open_uniq").on(t.assignmentId).where(sql`${t.endedAt} is null`),
  ],
);

// ── log ────────────────────────────────────────────────────────────────────

/** การเปิดเอกสารต้นทาง (ADR-0010) — มีแต่ insert */
export const documentViews = pgTable(
  "document_views",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    personId: integer("person_id").notNull(),
    viewedAt: ts("viewed_at").notNull().defaultNow(),
  },
  (t) => [index("document_views_document_idx").on(t.documentId, t.viewedAt)],
);

/** `pending` = จองไว้กำลังส่ง · `skipped` = ส่งไม่ได้เพราะการตั้งค่า (ไม่ผูก LINE · ไม่แอด Work Bot) ไม่ต้องลองซ้ำ */
export const NOTIFICATION_STATUSES = ["pending", "sent", "failed", "skipped"] as const;

/**
 * ข้อความที่ส่งผ่าน WorkGateWay (spec §11) — โครงเดียวกับ WorkDaily (`src/lib/deliver.ts` ยกมาจากที่นั่น)
 *
 * ★ `sent` = GateWay รับเข้าคิวแล้ว **มี jobId** เท่านั้น (กติกาเครือข้อ 12) — ฐานบังคับด้วย CHECK
 * ★ จองแถวด้วย `dedupeKey` ก่อนส่ง — สองรอบ cron ที่ชนกันส่งได้ครั้งเดียว · `failed` จองใหม่ได้ (ลองซ้ำรอบถัดไป)
 *   เช่น `assigned:<assignmentId>` · `remind-day3:<assignmentId>` · `approval:<eventId>`
 */
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    dedupeKey: text("dedupe_key").notNull(),
    kind: text("kind").notNull(),
    /** คนที่ข้อความส่งถึงหรือพูดถึง · null = ข้อความรวมหลายคน */
    personId: integer("person_id"),
    /** กลุ่มที่ส่งไปจริง (กลุ่ม LINE ประจำตัว หรือกลุ่ม Test ช่วง dev) — ห้ามส่งค่านี้ออกไปหน้าจอหรือ API */
    lineGroupId: text("line_group_id"),
    setId: integer("set_id").references(() => learningSets.id, { onDelete: "restrict" }),
    assignmentId: integer("assignment_id").references(() => assignments.id, { onDelete: "restrict" }),
    status: text("status", { enum: NOTIFICATION_STATUSES }).notNull(),
    jobIds: text("job_ids").array().notNull().default(sql`'{}'::text[]`),
    detail: text("detail"),
    /** ข้อความล้วน — สำเนาของสิ่งที่ส่ง ใช้ส่งซ้ำ */
    text: text("text"),
    attempts: integer("attempts").notNull().default(1),
    claimedAt: ts("claimed_at").notNull().defaultNow(),
    createdAt: ts("created_at").notNull().defaultNow(),
    deliveredAt: ts("delivered_at"),
  },
  (t) => [
    uniqueIndex("notifications_dedupe_uniq").on(t.dedupeKey),
    index("notifications_assignment_idx").on(t.assignmentId),
    check("notifications_sent_has_job", sql`${t.status} <> 'sent' or cardinality(${t.jobIds}) > 0`),
    check("notifications_line_group_shape", sql`${t.lineGroupId} is null or ${t.lineGroupId} ~ '^C[0-9a-f]{32}$'`),
  ],
);
