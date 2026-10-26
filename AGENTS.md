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
- `src/lib/gateway.ts` — ส่ง LINE ผ่าน WorkGateWay (ยังไม่มีผู้เรียก — ใช้ใน slice การแจ้งเตือน)
- `src/domain/blueprint.ts` — สัดส่วนหัวข้อ×ระดับของ 10 ข้อ · แม่แบบ PD/ทั่วไป · `src/domain/document.ts` — ชนิด/ขนาดไฟล์ · key ใน R2
- `src/lib/set-service.ts` — สร้างชุด · ตั้งค่า · อัปโหลด (ขอลิงก์ → PUT ตรงเข้า R2 → ยืนยันด้วย HEAD) · `getSetDetail()` (มีเฉลย — เฉพาะ `canManage`)
- `src/lib/exam-generator.ts` — **ที่เดียวที่คุยกับ Anthropic API** (`ExamModel`) · ออก 5 ชุดในคำขอเดียว · `checkForms()` ตรวจผลของ AI ก่อนลงฐานทุกครั้ง
- `src/lib/exam-service.ts` — ออกข้อสอบ · แก้/ออกใหม่ทีละข้อ (ลงประวัติก่อน/หลัง) · `src/lib/approval-service.ts` — ส่ง · ตีกลับ · อนุมัติ
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
