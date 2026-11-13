<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# WorkTrain

ระบบเรียนรู้ด้วยตัวเอง — ภาพรวมที่ [`README.md`](README.md) · คำศัพท์ที่ [`CONTEXT.md`](CONTEXT.md)

## อ่านก่อนเขียนโค้ดเสมอ

- **`CONTEXT.md`** — ใช้คำตามนั้นทั้งในโค้ด ข้อความบนจอ และ commit · อย่าใช้คำในช่อง _Avoid_
- **`docs/spec-release-1.md`** + **`docs/adr/`** — สิ่งที่ตัดสินแล้วและเหตุผล
- **`WS-Strategy/MASTER-ARCHITECTURE.md` §2** — กติกาข้ามระบบ บังคับทุก repo ในเครือ

## แผนที่โค้ด

- `src/db/schema.ts` — ตารางทั้งหมด · `src/db/atomic.ts` — ของที่ต้องลงพร้อมกัน · `drizzle/` — migration
- `src/lib/auth.ts` + `roles.ts` — ใครกดอยู่ · `requireAdmin()` / `requireAuthor()` / `requireUser()`
- `src/lib/session.ts` + `src/proxy.ts` — session cookie ที่เซ็นแล้ว · ถาม WorkID ใหม่ทุก 5 นาที (fail-open)
- `src/lib/workid.ts` — SSO · `/v1/session/check` · `fetchOrg()` (ผัง: `positionId` · `teamId` · `managedTeamIds` · `managerPersonId` · `lineGroupId`)
- `src/lib/gateway.ts` — client ของ WorkGateWay · `src/lib/deliver.ts` — ส่งตัวต่อตัว/เข้ากลุ่มประจำตัว พร้อมจองแถวและบันทึกผล (ยกจาก WorkDaily)
- `src/domain/audience.ts` — เงื่อนไขผู้รับ → รายชื่อ · `src/lib/assignment-service.ts` — ผู้รับ · มอบ (`syncAssignments`) · เตือน (`runReminders`) · แจ้งเรื่องอนุมัติ
- `src/lib/onboarding-service.ts` — เส้นทาง Onboarding (`/admin/onboarding`) · `trainingStatus()` ให้ WorkHR ·
  `src/lib/api-consumers.ts` — ด่าน `/api/v1/*` (Bearer `wtr_…` · ตาราง `api_consumers` เก็บแค่ hash · TG ออก/ถอนที่ `/admin/api-keys` · ADR-0012)
- `src/domain/stats.ts` — สถิติรายคนต่อเดือน · Leaderboard (คะแนนครั้งแรก → ความไว) · `src/lib/stats-service.ts` — `/dashboard` ·
  การมองเห็นตามบทบาท · export CSV · ตัด TG ด้วย `fetchRolePeople("admin")` (WorkID `/v1/apps/worktrain/people`)
- `src/app/api/cron/daily` — รอบเช้า 09:00: มอบให้คนที่เพิ่งตรงเงื่อนไข แล้วเตือนวันที่ 3 / 5 / เลยกำหนด
- `src/domain/exam.ts` — เลือกชุด (ไม่ซ้ำจนครบ 5) · สลับข้อ/ตัวเลือก · คะแนน · ไม่ผ่าน 2 ครั้งติด = อ่านใหม่
- `src/lib/rekognition.ts` — **ที่เดียวที่คุยกับ AWS** (`FaceApi`: liveness session · ผล liveness · CompareFaces · credential ชั่วคราวให้เบราว์เซอร์)
- `src/lib/identity-service.ts` — ความยินยอม PDPA · ลงทะเบียนใบหน้า (ครั้งแรกใช้ได้ทันที · ใหม่ต้องให้ TG อนุมัติ) · `beginScan`/`finishScan` เทียบฝั่งเซิร์ฟเวอร์ ·
  ไม่ผ่าน 3 ครั้งติด → คิว TG (`/admin/faces`) · ภาพสแกนลบเมื่อครบ 90 วัน (cron เช้า) · ไม่ตั้ง AWS = `scanMode()` เป็น `off` บน production
- `src/app/(app)/learn/scan-flow.tsx` — FaceLivenessDetector (Amplify) · บนเครื่อง dev เป็นปุ่มข้ามกล้อง
- `src/lib/learn-service.ts` — รอบเรียน (นิ่ง 2 นาที = จบ) · ความคืบหน้าการอ่าน · ครั้งที่สอบ (ทีละข้อ · หมดเวลา/ออกหน้าสอบตัดสินที่เซิร์ฟเวอร์) · ทุกฟังก์ชันตรวจว่าเป็นของคนที่ล็อกอิน
- `/learn` (`myLearningList()`: สรุปตัวเลข · ทำต่อจากที่ค้างไว้ · แท็บกรอง + ค้นหา · การ์ดพร้อมปกคลิป) · `/learn/[id]` (`LessonWorkspace`: ตัวแสดงทางซ้าย + รายการเนื้อหาในชุดทางขวา · ตัวอ่าน PDF ด้วย pdfjs ≥ 6.2.108 · ตัวเล่นวิดีโอนับช่วงที่เล่นผ่าน)
- ปกวิดีโอ: `sets/[id]/cover-picker.tsx` (จับเฟรมในเบราว์เซอร์) → `setVideoCover()` ใน set-service · ภาพออกทาง `/api/covers/[documentId]` (ADR-0013) · `/learn/[id]/exam/[attemptId]` · `/consent` — หน้าผู้เรียนผ่าน `learnerActor()` (ต้องยินยอมก่อน)
- `scripts/dev-seed-learner.mjs` — ใส่ชุดพร้อมสอบลง PGlite ไว้ลองฝั่งผู้เรียนบนเครื่องโดยไม่ต้องมี AI
- `src/domain/blueprint.ts` — สัดส่วนหัวข้อ×ระดับของ 10 ข้อ · หัวข้อเป็นข้อความ (`topicLabel()` แปลรหัสเดิม) · แม่แบบตั้งต้นของสองชนิดเดิม ·
  `src/lib/kind-service.ts` — ทะเบียนชนิดของชุด (`/admin/kinds` · TG เท่านั้น · ADR-0011) · `src/domain/document.ts` — ชนิด/ขนาดไฟล์ · key ใน R2 ·
  ช่วงวิดีโอ 10 วินาที · `src/domain/mp4.ts` — ความยาววิดีโอจากหัวไฟล์ MP4 (ADR-0013)
- `src/lib/set-service.ts` — สร้างชุด · ตั้งค่า · อัปโหลด (ขอลิงก์ → PUT ตรงเข้า R2 → ยืนยันด้วย HEAD) · `getSetDetail()` (มีเฉลย — เฉพาะ `canManage`)
- `/sets/[id]` — แถบขั้นตอน `?tab=` ตั้งค่า · เอกสาร · ข้อสอบ · ผู้รับ · ผู้เรียน · ประวัติ (ADR-0014) · client component ต่อขั้น:
  `approver-picker` · `docs-manager` · `spread-panel` + `exam-workspace` (แก้/ตรวจแล้วอยู่ที่เดิม) · `audience-picker` (แก้ได้ทั้งร่างและชุดที่ใช้อยู่) ·
  `src/domain/spread.ts` — แผนเฉลี่ยข้อสอบตามไฟล์ + นับจาก `source_ref`
- `src/lib/exam-generator.ts` — **ที่เดียวที่คุยกับ Anthropic API** (`ExamModel`) · ออก 5 ชุดในคำขอเดียว · `checkForms()` ตรวจผลของ AI ก่อนลงฐานทุกครั้ง
- `src/lib/exam-service.ts` — ออกข้อสอบ · แก้/ออกใหม่ทีละข้อ (ลงประวัติก่อน/หลัง) · `examTemplate()` / `importExams()` (ADR-0015)
- `src/lib/exam-sheet.ts` — **ที่เดียวที่แตะ exceljs** · Template .xlsx ของชุด · `parseSheet()` ตรวจทุกแถวบอกเลขแถว แล้ว `checkForms()` เป็นด่านสุดท้าย ·
  ปุ่ม `sets/[id]/exam-import.tsx` (Template · Import) · route `/sets/[id]/exam-template`
- `src/lib/approval-service.ts` — ส่ง · ตีกลับ · อนุมัติ · ลบร่าง / ปิดชุด (`deleteDraft` · `closeSet` · ADR-0016 — ลบแถวจริงไม่ได้เพราะประวัติมีแต่ insert)
- `src/lib/version-service.ts` — เวอร์ชันใหม่ (spec §7): เริ่ม · สรุปด้วย AI · ส่ง · ผู้อนุมัติเลือกอ่านเพื่อรับทราบ/เรียนรู้และทดสอบ (`small`/`large`) · ข้อสอบส่วนที่เปลี่ยน (`DELTA_BLUEPRINT`) · อนุมัติ + แจ้งคนที่ผ่านแล้ว ·
  ฝั่งผู้เรียน `pendingUpdate()` / `acknowledgeVersion()` ใน learn-service · เวอร์ชันแรกยังใช้สถานะของชุด (approval-service)
- `src/lib/watermark.ts` — ประทับลายน้ำ Pricelist ทุกหน้า · `pricelistPdf()` + route `/learn/[id]/doc/[documentId]` (ไม่ส่งไฟล์ต้นฉบับ)
- `src/lib/object-store.ts` — **ที่เดียวที่แตะ R2** · dev ไม่มี R2 = ที่เก็บในหน่วยความจำผ่าน `/api/dev-store`
- `src/lib/time.ts` — วันที่ไทย · ห้าม `toISOString()` นอกไฟล์นี้ (มีเทสต์บังคับ)
- ยกโครงมาจาก WorkDaily: `session.ts` · `workid.ts` · `gateway.ts` · `time.ts` · `auth.ts` · `proxy.ts` · `errmsg.ts` — แก้แล้วเทสต์ที่ติดมาต้องยังผ่าน

## ข้อผิดที่ repo นี้ต้องไม่ทำ

- **เก็บทะเบียนคน ตำแหน่ง ทีม หรือหัวหน้าไว้ที่ WorkTrain เอง** (ADR-0002) — ยกเว้นชื่อ ณ เวลานั้น (snapshot) ในแถวที่เก็บตลอดไป และกลุ่มเฉพาะกิจ
- **อ้างตำแหน่งด้วยชื่อ (`title`)** — ใช้ `positionId` ของ WorkHR เท่านั้น (spec §6.1)
- **`db().transaction()`** — neon-http โยน error บน production · ใช้ `atomic()` · เทสต์จำลองไว้แล้ว
- **UPDATE/DELETE `approval_events` · `version_acknowledgements` · `document_views`** — ฐานปฏิเสธด้วย trigger (migration 0001)
- **เก็บหรือส่ง URL ของไฟล์** — เก็บแค่ object key ใน R2 แบบ private · เปิดด้วย presigned URL อายุสั้นหลังตรวจสิทธิ์ (ADR-0010)
- **รายงานว่าส่ง LINE สำเร็จโดยไม่มี jobId** (กติกาเครือข้อ 12) — ฐานบังคับด้วย CHECK
- **ส่ง `lineGroupId` ออกไปหน้าจอหรือ API** — groupId ใช้ยิงข้อความเข้ากลุ่มได้

## Git

- เข้า `main` ผ่าน Pull Request เท่านั้น (กติกาเครือข้อ 9) — `.githooks/pre-push` กันไว้ · `npm run ci` ต้องเขียวก่อน merge (ข้อ 11)
