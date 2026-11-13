import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DELTA_BLUEPRINT, GENERAL_BLUEPRINT, PRODUCT_BLUEPRINT, slots, topicLabel, LEVEL_LABELS, type Blueprint } from "@/domain/blueprint";
import { buildTemplate, joinSourceRef, parseSheet, readSheet, splitSourceRef, templateRows, type SheetRow } from "@/lib/exam-sheet";

/** Template ข้อสอบแบบ Excel (ADR-0015) — กติกาตรวจแถว + ไฟล์จริงไป-กลับผ่าน exceljs */

const FILES = ["คู่มือการขาย-v3.pdf", "แนะนำสินค้า.mp4"];

/** กรอกครบทุกข้อให้ผ่าน */
function filled(blueprint: Blueprint, forms = 5): SheetRow[] {
  return templateRows(blueprint, forms, FILES).map((cells, i) => {
    const n = i + 1;
    const c = [...cells];
    c[4] = `คำถามที่ ${n}`;
    c[5] = `ก${n}`;
    c[6] = `ข${n}`;
    c[7] = `ค${n}`;
    c[8] = `ง${n}`;
    c[9] = String((n % 4) + 1);
    c[10] = FILES[n % 2];
    c[11] = `หน้า ${n}`;
    return { row: i + 2, cells: c };
  });
}

describe("splitSourceRef / joinSourceRef", () => {
  it("แยกชื่อไฟล์ออกจากที่มาที่ AI เขียน — มีหรือไม่มีนามสกุล", () => {
    expect(splitSourceRef("คู่มือการขาย-v3.pdf หน้า 5", FILES)).toEqual({ file: "คู่มือการขาย-v3.pdf", location: "หน้า 5" });
    expect(splitSourceRef("คู่มือการขาย-v3 · หน้า 7", FILES)).toEqual({ file: "คู่มือการขาย-v3.pdf", location: "หน้า 7" });
    expect(splitSourceRef("แนะนำสินค้า.mp4, นาที 2:15", FILES)).toEqual({ file: "แนะนำสินค้า.mp4", location: "นาที 2:15" });
  });

  it("หาไฟล์ไม่เจอ = ไฟล์ว่าง ตำแหน่งเป็นข้อความเดิม", () => {
    expect(splitSourceRef("หน้า 1", FILES)).toEqual({ file: "", location: "หน้า 1" });
  });

  it("รวมกลับเป็นที่มาเดียว", () => {
    expect(joinSourceRef("คู่มือการขาย-v3.pdf", "หน้า 5")).toBe("คู่มือการขาย-v3.pdf หน้า 5");
  });
});

describe("templateRows", () => {
  it("5 ชุด × ช่องของแม่แบบ · 4 คอลัมน์แรกมาจากแม่แบบ", () => {
    const rows = templateRows(PRODUCT_BLUEPRINT, 5, FILES);
    expect(rows).toHaveLength(50);
    const s = slots(PRODUCT_BLUEPRINT);
    expect(rows[0].slice(0, 4)).toEqual(["1", "1", topicLabel(s[0].topic), LEVEL_LABELS[s[0].level]]);
    expect(rows[49].slice(0, 2)).toEqual(["5", "10"]);
    expect(rows[0].slice(4).every((c) => c === "")).toBe(true);
  });

  it("ข้อสอบส่วนที่เปลี่ยน = 5 ชุด × 5 ข้อ", () => {
    expect(templateRows(DELTA_BLUEPRINT, 5, FILES)).toHaveLength(25);
  });

  it("เติมข้อสอบเดิมตามหัวข้อ×ระดับ ไม่ใช่ลำดับที่เก็บ · หาคู่ไม่ได้ปล่อยว่าง", () => {
    const s = slots(GENERAL_BLUEPRINT);
    const scenario = { topic: "general", level: "scenario" as const, text: "ถ้าลูกค้า…", choices: ["a", "b", "c", "d"], correctIndex: 2, sourceRef: "คู่มือการขาย-v3.pdf หน้า 9" };
    const rows = templateRows(GENERAL_BLUEPRINT, 1, FILES, [[scenario]]);
    const at = s.findIndex((x) => x.level === "scenario");
    expect(rows[at].slice(4)).toEqual(["ถ้าลูกค้า…", "a", "b", "c", "d", "3", "คู่มือการขาย-v3.pdf", "หน้า 9"]);
    expect(rows[0][4]).toBe("");
  });
});

describe("parseSheet", () => {
  it("กรอกครบ → 5 ชุดตามแม่แบบ · ที่มา = ไฟล์ + ตำแหน่ง · เฉลย 1–4 เป็น index 0–3", () => {
    const out = parseSheet(filled(PRODUCT_BLUEPRINT), PRODUCT_BLUEPRINT, 5, FILES);
    if (!out.ok) throw new Error(JSON.stringify(out.errors));
    expect(out.forms).toHaveLength(5);
    expect(out.forms[0]).toHaveLength(10);
    expect(out.forms[0][0]).toMatchObject({ text: "คำถามที่ 1", correctIndex: 1, sourceRef: "แนะนำสินค้า.mp4 หน้า 1" });
  });

  it("เรียงแถวใหม่ได้ — จับคู่ด้วยชุดที่/ข้อ · แถวว่างข้ามไป", () => {
    const rows = filled(GENERAL_BLUEPRINT).reverse();
    rows.push({ row: 99, cells: Array(12).fill("") });
    const out = parseSheet(rows, GENERAL_BLUEPRINT, 5, FILES);
    expect(out.ok && out.forms[0][0].text).toBe("คำถามที่ 1");
  });

  it("บอกทุกจุดพร้อมเลขแถว ไม่หยุดที่ข้อผิดแรก", () => {
    const rows = filled(GENERAL_BLUEPRINT);
    rows[0].cells[4] = "";
    rows[2].cells[6] = rows[2].cells[5];
    rows[3].cells[9] = "5";
    rows[4].cells[10] = "ไฟล์อื่น.pdf";
    rows[5].cells[11] = "";
    rows[6].cells[8] = "ถูกทุกข้อ";
    rows[20].cells[4] = rows[1].cells[4];
    const out = parseSheet(rows, GENERAL_BLUEPRINT, 5, FILES);
    if (out.ok) throw new Error("ควรไม่ผ่าน");
    expect(out.errors).toEqual([
      { row: 2, message: "ยังไม่ได้กรอกคำถาม" },
      { row: 4, message: "ตัวเลือก 1 กับ 2 ซ้ำกัน" },
      { row: 5, message: "ข้อที่ถูกต้องเป็น 1–4" },
      { row: 6, message: 'ไม่มีไฟล์ "ไฟล์อื่น.pdf" ในเอกสารของชุดนี้' },
      { row: 7, message: "ยังไม่ได้กรอกตำแหน่ง (เช่น หน้า 5 หรือ นาที 2:15)" },
      { row: 8, message: 'ห้ามใช้ตัวเลือก "ถูกทุกข้อ" หรือ "ไม่มีข้อใดถูก"' },
      { row: 22, message: "คำถามซ้ำกับแถว 3" },
    ]);
  });

  it("หลายปัญหาในแถวเดียวรวมเป็นข้อความเดียว", () => {
    const rows = filled(GENERAL_BLUEPRINT);
    rows[0].cells[5] = "";
    rows[0].cells[6] = "";
    rows[0].cells[10] = "";
    const out = parseSheet(rows, GENERAL_BLUEPRINT, 5, FILES);
    expect(!out.ok && out.errors[0]).toEqual({ row: 2, message: "ตัวเลือก 1, 2 ว่าง · ยังไม่ได้เลือกไฟล์ที่มา" });
  });

  it("แก้คอลัมน์ที่ล็อก · แถวซ้ำ · แถวหาย", () => {
    const rows = filled(GENERAL_BLUEPRINT);
    rows[0].cells[3] = "สถานการณ์"; // ข้อ 1 ของแม่แบบเป็นระดับจำ
    rows[1].cells[0] = "6";
    rows[2].cells[1] = rows[3].cells[1];
    const out = parseSheet(rows, GENERAL_BLUEPRINT, 5, FILES);
    if (out.ok) throw new Error("ควรไม่ผ่าน");
    expect(out.errors.map((e) => e.row)).toEqual([2, 3, 5, null, null, null]);
    expect(out.errors[0].message).toContain("กด Template เพื่อโหลดใหม่");
    expect(out.errors[2].message).toBe("ชุดที่ 1 ข้อ 4 ซ้ำกับแถว 4");
    expect(out.errors.slice(3).map((e) => e.message)).toEqual(["ไม่มีแถวของชุดที่ 1 ข้อ 1", "ไม่มีแถวของชุดที่ 1 ข้อ 2", "ไม่มีแถวของชุดที่ 1 ข้อ 3"]);
  });
});

describe("ไฟล์ .xlsx", () => {
  it("Template → กรอกใน Excel → อ่านกลับได้ครบ (ภาษาไทยไม่เพี้ยน) · บอกชนิดของ Template", async () => {
    const bytes = await buildTemplate({ setTitle: "F331", kind: "delta", blueprint: DELTA_BLUEPRINT, formCount: 5, fileNames: FILES });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("ข้อสอบ")!;
    expect(ws.getCell("A2").protection?.locked).not.toBe(false);
    expect(ws.getCell("E2").protection?.locked).toBe(false);
    expect(ws.getCell("K2").dataValidation?.formulae).toEqual(["'ไฟล์'!$A$1:$A$2"]);
    filled(DELTA_BLUEPRINT).forEach(({ row, cells }) => cells.forEach((v, i) => i >= 4 && (ws.getRow(row).getCell(i + 1).value = i === 9 ? Number(v) : v)));
    ws.getCell("E2").value = { richText: [{ text: "ราคา " }, { text: "F331", font: { bold: true } }] };

    const read = await readSheet(new Uint8Array(await wb.xlsx.writeBuffer()));
    if (!read.ok) throw new Error(read.error);
    expect(read.kind).toBe("delta");
    const out = parseSheet(read.rows, DELTA_BLUEPRINT, 5, FILES);
    if (!out.ok) throw new Error(JSON.stringify(out.errors));
    expect(out.forms.flat()).toHaveLength(25);
    expect(out.forms[0][0].text).toBe("ราคา F331");
  });

  it("ไม่ใช่ xlsx หรือไม่ใช่ Template ของ WorkTrain → บอกให้โหลดใหม่", async () => {
    expect(await readSheet(new TextEncoder().encode("a,b,c"))).toMatchObject({ ok: false, error: expect.stringContaining(".xlsx") });
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Sheet1").getCell("A1").value = "x";
    expect(await readSheet(new Uint8Array(await wb.xlsx.writeBuffer()))).toMatchObject({ ok: false, error: expect.stringContaining("กด Template") });
  });
});
