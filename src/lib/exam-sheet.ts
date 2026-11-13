import ExcelJS from "exceljs";
import type { FormKind, Level, Topic } from "@/db/schema";
import { LEVEL_LABELS, slots, topicLabel, type Blueprint } from "@/domain/blueprint";
import { sourceDocIndex } from "@/domain/spread";
import { checkForms, type GeneratedQuestion } from "@/lib/exam-generator";

/**
 * ไฟล์ Excel ของข้อสอบ — Template ให้ผู้เขียนกรอกเอง แล้ว Import กลับ (ADR-0015) · **ที่เดียวที่แตะ exceljs**
 *
 * ★ ข้อสอบที่คนเขียนผ่านด่านเดียวกับผลของ AI (`checkForms`) — import แทนทั้งชุดในครั้งเดียว ไม่ผ่านไม่ลงอะไร
 * ★ ตรวจทุกแถวแล้วบอกทุกจุดพร้อมเลขแถวใน Excel (ไม่หยุดที่ข้อผิดแรกแบบ `checkForms`)
 * ★ "ชุดที่ · ข้อ · หัวข้อ · ระดับ" เติมจากแม่แบบข้อสอบของชุดและล็อกไว้ — จับคู่ด้วย (ชุดที่, ข้อ) ไม่ใช่ลำดับแถว เรียงแถวใหม่ได้
 */

export const SHEET_COLUMNS = [
  "ชุดที่",
  "ข้อ",
  "หัวข้อ",
  "ระดับ",
  "คำถาม",
  "ตัวเลือก 1",
  "ตัวเลือก 2",
  "ตัวเลือก 3",
  "ตัวเลือก 4",
  "ข้อที่ถูก",
  "ไฟล์",
  "ตำแหน่ง",
] as const;

const C = { form: 0, item: 1, topic: 2, level: 3, text: 4, choice: 5, correct: 9, file: 10, location: 11 } as const;
/** 4 คอลัมน์แรกมาจากแม่แบบ — ล็อกไว้ */
const LOCKED = 4;
const EXAM_SHEET = "ข้อสอบ";
const HELP_SHEET = "วิธีกรอก";
const FILES_SHEET = "ไฟล์";
const META_SHEET = "_meta";
/** ตัวเลือกที่ห้ามใช้ (กติกาเดียวกับที่สั่ง AI) */
const BANNED_CHOICE = /ถูกทุกข้อ|ถูกทั้งหมด|ไม่มีข้อใดถูก|ผิดทุกข้อ/;


export interface ExistingQuestion {
  topic: Topic;
  level: Level;
  text: string;
  choices: string[];
  correctIndex: number;
  sourceRef: string;
}

export interface SheetRow {
  /** เลขแถวใน Excel */
  row: number;
  cells: string[];
}

export interface RowError {
  /** เลขแถวใน Excel · null = ทั้งไฟล์ */
  row: number | null;
  message: string;
}

export type ParseResult = { ok: true; forms: GeneratedQuestion[][] } | { ok: false; errors: RowError[] };

// ── กติกาล้วน ──────────────────────────────────────────────────────────────

/** แยก `source_ref` เดิมเป็นไฟล์ + ตำแหน่ง — ข้อที่ AI ออก ("Signature.pdf หน้า 5") · หาไฟล์ไม่เจอ = ไฟล์ว่าง ตำแหน่งเป็นข้อความเดิม */
export function splitSourceRef(ref: string, fileNames: readonly string[]): { file: string; location: string } {
  const i = sourceDocIndex(ref, fileNames);
  if (i < 0) return { file: "", location: ref.trim() };
  const file = fileNames[i];
  const stem = file.replace(/\.[a-z0-9]+$/i, "");
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const location = ref
    .replace(new RegExp(escape(file), "i"), "")
    .replace(new RegExp(escape(stem), "i"), "")
    .replace(/^[\s"'“”·,:;\-–—]+|[\s"'“”·,:;\-–—]+$/g, "")
    .trim();
  return { file, location };
}

/** ที่มาที่ลงฐาน — รวมไฟล์กับตำแหน่ง แถบเฉลี่ยตามไฟล์ (`coverage`) จึงนับถูกทุกข้อ */
export function joinSourceRef(file: string, location: string): string {
  return `${file} ${location}`.trim();
}

/**
 * แถวของ Template — ชุดละ `slots(blueprint)` ข้อ · มีข้อสอบเดิมก็เติมลงไป (จับคู่ตามหัวข้อ×ระดับ — ลำดับที่ AI ให้มาไม่ตรงแม่แบบ)
 * ข้อที่หาคู่ไม่ได้ (แม่แบบเปลี่ยนหลังออกข้อสอบ) ปล่อยว่าง
 */
export function templateRows(blueprint: Blueprint, formCount: number, fileNames: readonly string[], existing: ExistingQuestion[][] = []): string[][] {
  const want = slots(blueprint);
  const rows: string[][] = [];
  for (let f = 0; f < formCount; f++) {
    const pool = [...(existing[f] ?? [])];
    want.forEach((s, j) => {
      const k = pool.findIndex((q) => q.topic === s.topic && q.level === s.level);
      const q = k >= 0 ? pool.splice(k, 1)[0] : null;
      const src = q ? splitSourceRef(q.sourceRef, fileNames) : { file: "", location: "" };
      rows.push([
        String(f + 1),
        String(j + 1),
        topicLabel(s.topic),
        LEVEL_LABELS[s.level],
        q?.text ?? "",
        ...[0, 1, 2, 3].map((i) => q?.choices[i] ?? ""),
        q && q.correctIndex >= 0 ? String(q.correctIndex + 1) : "",
        src.file,
        src.location,
      ]);
    });
  }
  return rows;
}

function norm(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function wholeNumber(s: string): number | null {
  const t = s.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

/**
 * อ่านแถวที่กรอกแล้วเป็นชุดข้อสอบ — เก็บข้อผิดทุกจุด · ผ่านหมดแล้วยังต้องผ่าน `checkForms` เป็นด่านสุดท้าย
 * `fileNames` = เอกสารทั้งหมดของเวอร์ชัน (รวมวิดีโอ — import ไม่ต้องมี PDF)
 */
export function parseSheet(rows: readonly SheetRow[], blueprint: Blueprint, formCount: number, fileNames: readonly string[]): ParseResult {
  const want = slots(blueprint);
  const errors: RowError[] = [];
  const byKey = new Map<string, { row: number; q: GeneratedQuestion | null }>();
  const texts = new Map<string, number>();

  for (const { row, cells } of rows) {
    const cell = (i: number) => (cells[i] ?? "").trim();
    if (cells.every((c) => !c.trim())) continue;

    const formNo = wholeNumber(cell(C.form));
    const itemNo = wholeNumber(cell(C.item));
    if (formNo === null || itemNo === null || formNo < 1 || formNo > formCount || itemNo < 1 || itemNo > want.length) {
      errors.push({ row, message: `ชุดที่/ข้อ ไม่อยู่ในแม่แบบของชุดนี้ (ชุดที่ 1–${formCount} · ข้อ 1–${want.length}) — อย่าแก้ ${LOCKED} คอลัมน์แรก` });
      continue;
    }
    const key = `${formNo}:${itemNo}`;
    const dup = byKey.get(key);
    if (dup) {
      errors.push({ row, message: `ชุดที่ ${formNo} ข้อ ${itemNo} ซ้ำกับแถว ${dup.row}` });
      continue;
    }
    const slot = want[itemNo - 1];
    if (cell(C.topic) !== topicLabel(slot.topic) || cell(C.level) !== LEVEL_LABELS[slot.level]) {
      errors.push({ row, message: "หัวข้อ/ระดับไม่ตรงกับแม่แบบข้อสอบของชุดตอนนี้ — กด Template เพื่อโหลดใหม่" });
      continue;
    }

    const problems: string[] = [];
    const text = cell(C.text);
    const opts = [0, 1, 2, 3].map((i) => cell(C.choice + i));
    const correct = wholeNumber(cell(C.correct));
    const file = cell(C.file);
    const location = cell(C.location);

    if (!text) problems.push("ยังไม่ได้กรอกคำถาม");
    const empty = opts.flatMap((o, i) => (o ? [] : [i + 1]));
    if (empty.length) problems.push(`ตัวเลือก ${empty.join(", ")} ว่าง`);
    const seen = new Map<string, number>();
    opts.forEach((o, i) => {
      if (!o) return;
      const prev = seen.get(norm(o));
      if (prev !== undefined) problems.push(`ตัวเลือก ${prev + 1} กับ ${i + 1} ซ้ำกัน`);
      else seen.set(norm(o), i);
    });
    if (opts.some((o) => BANNED_CHOICE.test(o))) problems.push('ห้ามใช้ตัวเลือก "ถูกทุกข้อ" หรือ "ไม่มีข้อใดถูก"');
    if (correct === null || correct < 1 || correct > 4) problems.push("ข้อที่ถูกต้องเป็น 1–4");
    if (!file) problems.push("ยังไม่ได้เลือกไฟล์ที่มา");
    else if (!fileNames.includes(file)) problems.push(`ไม่มีไฟล์ "${file}" ในเอกสารของชุดนี้`);
    if (!location) problems.push("ยังไม่ได้กรอกตำแหน่ง (เช่น หน้า 5 หรือ นาที 2:15)");
    if (text) {
      const prevRow = texts.get(norm(text));
      if (prevRow !== undefined) problems.push(`คำถามซ้ำกับแถว ${prevRow}`);
      else texts.set(norm(text), row);
    }

    if (problems.length) {
      errors.push({ row, message: problems.join(" · ") });
      byKey.set(key, { row, q: null });
      continue;
    }
    byKey.set(key, {
      row,
      q: { topic: slot.topic, level: slot.level, text, choices: opts, correctIndex: (correct as number) - 1, sourceRef: joinSourceRef(file, location) },
    });
  }

  for (let f = 1; f <= formCount; f++) {
    for (let j = 1; j <= want.length; j++) {
      if (!byKey.has(`${f}:${j}`)) errors.push({ row: null, message: `ไม่มีแถวของชุดที่ ${f} ข้อ ${j}` });
    }
  }
  if (errors.length) return { ok: false, errors: sortErrors(errors) };

  const forms = Array.from({ length: formCount }, (_, f) => want.map((_, j) => byKey.get(`${f + 1}:${j + 1}`)!.q!));
  // ด่านสุดท้ายเดียวกับผลของ AI — กติกาข้างบนควรจับได้หมดแล้ว ถ้ายังหลุดมาก็ไม่ลงฐาน
  const bad = checkForms(forms, blueprint, formCount);
  if (bad) return { ok: false, errors: [{ row: null, message: bad }] };
  return { ok: true, forms };
}

function sortErrors(errors: RowError[]): RowError[] {
  return [...errors].sort((a, b) => (a.row ?? Number.MAX_SAFE_INTEGER) - (b.row ?? Number.MAX_SAFE_INTEGER));
}

// ── Excel ──────────────────────────────────────────────────────────────────

export interface TemplateInput {
  setTitle: string;
  kind: FormKind;
  blueprint: Blueprint;
  formCount: number;
  fileNames: readonly string[];
  existing?: ExistingQuestion[][];
}

const HELP_LINES = [
  "วิธีกรอกข้อสอบ",
  "",
  "1. กรอกในชีต \"ข้อสอบ\" แถวละ 1 ข้อ · 4 คอลัมน์แรก (ชุดที่ · ข้อ · หัวข้อ · ระดับ) มาจากแม่แบบข้อสอบของชุด ห้ามแก้",
  "2. ทุกข้อมี 4 ตัวเลือก ห้ามซ้ำกัน · \"ข้อที่ถูก\" เลือก 1–4 ตามคอลัมน์ตัวเลือก (ตอนสอบระบบสลับลำดับตัวเลือกเอง)",
  "3. ห้ามใช้ตัวเลือก \"ถูกทุกข้อ\" หรือ \"ไม่มีข้อใดถูก\" · ตัวเลือกที่ผิดควรฟังดูเป็นไปได้ ไม่ใช่ผิดชัดจนเดาได้",
  "4. คำถามห้ามซ้ำกันทั้งไฟล์ (ข้ามชุดด้วย)",
  "5. \"ไฟล์\" เลือกจากเอกสารที่แนบในชุด · \"ตำแหน่ง\" บอกว่าอยู่ตรงไหน เช่น หน้า 5 หรือ นาที 2:15 — ผู้อนุมัติใช้ตามไปเปิดดู",
  "",
  "ระดับ",
  "• จำ = ถามข้อเท็จจริงในเอกสาร",
  "• เข้าใจ = เปรียบเทียบหรืออธิบายเหตุผล",
  "• สถานการณ์ = เจอเหตุการณ์ในงานจริงแบบนี้ ควรทำหรือเสนออะไร",
  "",
  "Import แล้วข้อสอบทั้งหมดของส่วนนี้ถูกแทนด้วยไฟล์นี้ · เครื่องหมาย \"ตรวจแล้ว\" หายหมด",
  "ไฟล์ไม่ผ่าน ระบบบอกทุกจุดพร้อมเลขแถว และไม่แตะข้อสอบเดิม",
  "",
  "ตัวอย่าง 1 ข้อ",
];

/** Template ของชุดนี้เป็น .xlsx */
export async function buildTemplate(input: TemplateInput): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "WorkTrain";

  const ws = wb.addWorksheet(EXAM_SHEET, { views: [{ state: "frozen", xSplit: LOCKED, ySplit: 1 }] });
  ws.columns = SHEET_COLUMNS.map((header, i) => ({
    header,
    width: i === C.text ? 48 : i >= C.choice && i < C.correct ? 26 : i === C.file ? 28 : i === C.location ? 16 : i === C.topic ? 22 : 9,
  }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: "middle", wrapText: true };
  head.eachCell((c, i) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i <= LOCKED ? "FFE5E7EB" : "FFFDF6D8" } };
  });

  const rows = templateRows(input.blueprint, input.formCount, input.fileNames, input.existing);
  const files = wb.addWorksheet(FILES_SHEET, { state: "hidden" });
  input.fileNames.forEach((name, i) => (files.getCell(i + 1, 1).value = name));
  const fileList = input.fileNames.length ? `'${FILES_SHEET}'!$A$1:$A$${input.fileNames.length}` : null;

  rows.forEach((cells, r) => {
    const row = ws.getRow(r + 2);
    cells.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = i < 2 || (i === C.correct && v) ? (v ? Number(v) : null) : v || null;
      cell.alignment = { vertical: "top", wrapText: i >= C.text };
      if (i < LOCKED) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      } else {
        cell.protection = { locked: false };
      }
    });
    row.getCell(C.correct + 1).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"1,2,3,4"'],
      showErrorMessage: true,
      errorTitle: "ข้อที่ถูก",
      error: "เลือก 1–4",
    };
    if (fileList) {
      row.getCell(C.file + 1).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [fileList],
        showErrorMessage: true,
        errorTitle: "ไฟล์",
        error: "เลือกจากเอกสารที่แนบในชุด",
      };
    }
  });
  await ws.protect("", { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true, autoFilter: true });

  const help = wb.addWorksheet(HELP_SHEET);
  help.getColumn(1).width = 110;
  HELP_LINES.forEach((line, i) => {
    const c = help.getCell(i + 1, 1);
    c.value = line;
    if (i === 0) c.font = { bold: true, size: 14 };
    else if (line === "ระดับ" || line === "ตัวอย่าง 1 ข้อ") c.font = { bold: true };
  });
  const ex = HELP_LINES.length + 1;
  SHEET_COLUMNS.forEach((h, i) => {
    help.getCell(ex, i + 2).value = h;
    help.getCell(ex, i + 2).font = { bold: true };
  });
  help.getCell(ex, 1).value = "";
  ["1", "1", "ทั่วไป", "สถานการณ์", "ลูกค้าต้องการโต๊ะประชุม 8 ที่นั่งที่พับเก็บได้ ควรเสนอรุ่นใด", "F331", "F208", "M120", "F415", "1", "คู่มือสินค้า.pdf", "หน้า 12"].forEach(
    (v, i) => (help.getCell(ex + 1, i + 2).value = v),
  );
  help.getCell(ex + 3, 1).value = `ชุด: ${input.setTitle} · ${input.kind === "delta" ? "ข้อสอบส่วนที่เปลี่ยน" : "ข้อสอบชุดเต็ม"} · ${input.formCount} ชุด × ${slots(input.blueprint).length} ข้อ`;

  const meta = wb.addWorksheet(META_SHEET, { state: "veryHidden" });
  meta.getCell("A1").value = "kind";
  meta.getCell("B1").value = input.kind;

  // แผ่น "ข้อสอบ" เปิดเป็นแผ่นแรก
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 0, visibility: "visible" }];
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export type ReadResult = { ok: true; kind: FormKind | null; rows: SheetRow[] } | { ok: false; error: string };

const NOT_TEMPLATE = "ไฟล์นี้ไม่ใช่ Template ข้อสอบของ WorkTrain — กด Template เพื่อโหลดไฟล์ที่ถูกต้อง";

/** อ่าน .xlsx ที่กรอกแล้ว — ทุกเซลล์เป็นข้อความที่เห็นใน Excel */
export async function readSheet(bytes: Uint8Array): Promise<ReadResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    return { ok: false, error: "เปิดไฟล์ไม่ได้ — ต้องเป็นไฟล์ .xlsx (บันทึกจาก Excel แบบ Excel Workbook)" };
  }
  const ws = wb.getWorksheet(EXAM_SHEET);
  if (!ws) return { ok: false, error: NOT_TEMPLATE };
  const header = SHEET_COLUMNS.map((_, i) => cellText(ws.getRow(1).getCell(i + 1)));
  if (header.some((h, i) => h !== SHEET_COLUMNS[i])) return { ok: false, error: NOT_TEMPLATE };

  const kindCell = wb.getWorksheet(META_SHEET)?.getCell("B1");
  const kindText = kindCell ? cellText(kindCell) : "";
  const kind: FormKind | null = kindText === "full" || kindText === "delta" ? kindText : null;

  const rows: SheetRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    rows.push({ row: r, cells: SHEET_COLUMNS.map((_, i) => cellText(row.getCell(i + 1))) });
  }
  return { ok: true, kind, rows };
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "richText" in v) return v.richText.map((t) => t.text).join("").trim();
  if (typeof v === "object" && "result" in v) return String(v.result ?? "").trim();
  if (typeof v === "object" && "text" in v) return String(v.text).trim();
  return String(cell.text ?? v).trim();
}
