/**
 * ลองฝั่งผู้เรียนบนเครื่อง dev โดยไม่ต้องมี AI / อนุมัติ — ใส่ชุดที่ใช้อยู่ 1 ชุด (ข้อสอบ 5 ชุด ชุดละ 10 ข้อ)
 * พร้อมการมอบให้ personId ที่กำหนด ลงฐาน PGlite
 *
 *   DATABASE_URL=pglite:.pglite node scripts/dev-seed-learner.mjs <personId>
 *
 * แล้วอัป PDF (สร้างไว้ที่ .pglite-seed.pdf) เข้าที่เก็บจำลองของ dev server ที่รันอยู่ตามคำสั่งที่พิมพ์ออกมา
 * ★ ห้ามใช้กับ Neon — ตรวจ `pglite:` เท่านั้น · หยุด `next dev` ก่อนรัน (PGlite เปิดได้ทีละ process)
 */
import { writeFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PDFDocument, StandardFonts } from "pdf-lib";

const url = process.env.DATABASE_URL ?? "";
if (!url.startsWith("pglite:")) {
  console.error("ต้องตั้ง DATABASE_URL=pglite:<โฟลเดอร์> — สคริปต์นี้ไม่แตะ Neon");
  process.exit(1);
}
const personId = Number(process.argv[2]);
if (!Number.isInteger(personId) || personId <= 0) {
  console.error("ใส่ personId ของผู้เรียน เช่น 31");
  process.exit(1);
}

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let i = 1; i <= 3; i++) doc.addPage([595, 842]).drawText(`Dev catalog - page ${i}`, { x: 60, y: 760, size: 28, font });
const bytes = await doc.save();
writeFileSync(".pglite-seed.pdf", bytes);

const pg = new PGlite(url.slice("pglite:".length) || ".pglite");
const one = async (sql, params) => (await pg.query(sql, params)).rows[0];
const blueprint = JSON.stringify([
  { topic: "general", level: "recall", count: 4 },
  { topic: "general", level: "understand", count: 4 },
  { topic: "general", level: "scenario", count: 2 },
]);
const set = await one(
  `insert into learning_sets (title, kind, status, author_person_id, author_name, blueprint, approved_at)
   values ('ชุดทดลอง (dev seed)', 'general', 'active', 10, 'พีดี ผู้สร้าง', $1, now()) returning id`,
  [blueprint],
);
const version = await one(
  `insert into set_versions (set_id, version_no, change_kind, created_by_person_id, approved_at, label) values ($1, 1, 'initial', 10, now(), 'V.1 dev') returning id`,
  [set.id],
);
const key = `sets/${set.id}/v1/devseed${Date.now()}.pdf`;
await pg.query(
  `insert into documents (version_id, kind, object_key, file_name, mime_type, size_bytes, page_count) values ($1, 'catalog', $2, 'Dev catalog.pdf', 'application/pdf', $3, 3)`,
  [version.id, key, bytes.byteLength],
);
for (let f = 1; f <= 5; f++) {
  const form = await one(`insert into exam_forms (version_id, kind, form_no) values ($1, 'full', $2) returning id`, [version.id, f]);
  for (let q = 0; q < 10; q++) {
    const level = q < 4 ? "recall" : q < 8 ? "understand" : "scenario";
    const question = await one(
      `insert into questions (form_id, sort_order, topic, level, text, source_ref) values ($1, $2, 'general', $3, $4, 'Dev catalog.pdf หน้า 1') returning id`,
      [form.id, q, level, `ชุด ${f} ข้อ ${q + 1}: ข้อนี้ตอบ "ถูก"`],
    );
    for (let c = 0; c < 4; c++) {
      await pg.query(`insert into choices (question_id, sort_order, text, is_correct) values ($1, $2, $3, $4)`, [
        question.id,
        c,
        c === 0 ? "ถูก" : `ผิด ${c}`,
        c === 0,
      ]);
    }
  }
}
await pg.query(
  `insert into assignments (set_id, person_id, person_name, source, assigned_at, due_at) values ($1, $2, 'ผู้เรียน dev', 'audience', now(), now() + interval '7 days')`,
  [set.id, personId],
);
await pg.close();
console.log(`ชุด ${set.id} พร้อม · มอบให้ personId ${personId}`);
console.log(`เริ่ม next dev แล้วอัป PDF:\n  curl -X PUT --data-binary @.pglite-seed.pdf "http://localhost:3000/api/dev-store/${key}"`);
