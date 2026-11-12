# WorkTrain — ส่งต่องาน (12 พ.ย. 2569)

## เป้าหมาย
ทำ Release 1 ให้พร้อมใช้จริงทั้งบริษัท (spec `docs/spec-release-1.md`): ผู้สร้างทำชุดเรียน → AI ออกข้อสอบ → TG อนุมัติ → มอบให้พนักงานตามเงื่อนไข → เรียน/สแกนหน้า/สอบ → รายงาน และให้ระบบในเครือ (WorkHR) ดึงผลได้

## สถานะตอนนี้
- **Production ใช้งานได้:** https://worktrain.workstationoffice.com (Vercel project `worktrain` · ทีม workstationgroup · `prj_mjcs…` — ชื่อเดิม `wso-knowledge` · `.vercel/project.json` บนเครื่องชี้ project นี้ถูกแล้ว)
- **Deploy:** merge เข้า `main` → Vercel build เองภายในไม่กี่วินาที (Git ต่อใหม่แล้ว 11 พ.ย.) · build รัน migration เอง (`scripts/migrate-on-deploy.mjs` — log บอก "ฐานอยู่ที่ N แล้ว")
- **ฐาน:** Neon `fancy-wave-83217363` · migration 0000–0010 ครบ (ตรวจจาก build log ของ `f0118a9`: 10 → 11)
- **WorkID:** ลงทะเบียนแอป `worktrain` แล้ว · env ครบ
- **API Key ให้ระบบอื่น:** TG ออก/ถอนที่ `/admin/api-keys` (ADR-0012 · ตาราง `api_consumers`) — แต่ละ key มี **ชื่อ key** (ไทยได้ ≤ 60) + **ระบบที่ใช้** (`workhr` · ใช้ใน log) + หมายเหตุ · เก็บแค่ sha256 · key เต็มขึ้นจอครั้งเดียว · **ยังไม่ได้ออกให้ใคร**
- **ช่วงทดลอง LINE:** `TEST_LINE_GROUP_ID` (Production) ตั้งแล้ว — ทุกข้อความ (รวมตัวต่อตัว) ไปกลุ่ม Test · **ลบ env นี้ = เริ่มส่งพนักงานจริง**
- **ข้อความยินยอม:** HR/ฝ่ายกฎหมายรับรองแล้ว (PR #20)
- ไม่มี CI บน GitHub — ด่านก่อน merge = `npm run ci` บนเครื่อง แล้วแปะตารางผลใน PR (ล่าสุด 270/270 ผ่าน)

## งานที่เสร็จ (8–12 พ.ย.)
- #20 เอาป้ายร่างออกจากหน้ายินยอม
- #22 ทะเบียนชนิดของชุด `/admin/kinds` (ADR-0011) — migration 0007/0008 · vitest จำกัด 4 worker
- #23 README ตรงสถานะจริง · ชื่อชนิดเอกสาร `catalog` บนจอเป็น "เอกสารหลัก"
- #24 ส่งต่องาน — TEST_LINE_GROUP_ID · Vercel Git ต่อใหม่
- #25 หน้า TG ออก/ถอน API Key (ADR-0012 · migration 0009) แทน env `WORKTRAIN_API_CONSUMERS` และสคริปต์ `api:new-key` (ลบทิ้งแล้ว)
- #26 ช่อง "ชื่อ key" (migration 0010 เติมชื่อระบบให้ key เดิมก่อนตั้ง NOT NULL)

## วิธีที่ใช้ได้ผล
- ลำดับงาน: branch → `npm run ci` → PR (แปะผล) → merge → ดู build log ใน Vercel ว่า migration ขึ้นและ READY
- ลองบนเครื่อง: `DATABASE_URL=pglite:.pglite npm run db:dev-setup` แล้ว `preview_start worktrain-dev` (`.claude/launch.json`) · ล็อกอินเป็น TG ได้เลยบน dev
- migration ที่เพิ่มคอลัมน์ NOT NULL ให้ตารางที่อาจมีแถวแล้ว: แก้ SQL ที่ drizzle สร้างเป็น add → UPDATE เติมค่า → SET NOT NULL (ดู `drizzle/0010_api_key_label.sql`)
- ตรวจ deploy ผ่าน Vercel MCP (`list_deployments` / `list_deployment_events` builds=1) หรือ `gh api …/commits/<sha>/status`

## สิ่งที่ไม่ได้ผล / ระวัง
- `db().transaction()` ใช้ไม่ได้บน neon-http — ใช้ `atomic()`
- แก้ไฟล์ด้วย Python บน Windows แบบ text mode จะได้ CRLF — เปิดด้วย `newline=''` หรือ `sed -i 's/\r$//'` ทีหลัง
- ลบบรรทัดสุดท้ายใน `package.json` แล้วเหลือ comma ค้าง → vitest โหลด config ไม่ได้
- `db:dev-setup` ต้องมี `DATABASE_URL` เสมอ
- Bash `sleep` ถูกบล็อก — รอด้วย until-loop

## งานถัดไป (ต้องมีคน)
1. ลองสแกนหน้าบนมือถือจริงกับ AWS · ลองทำข้อสอบบน production · ล็อกอินเปิด `/admin/kinds` · `/admin/api-keys` · `/consent` บน production
2. ลองอนุมัติชุดแรก → ดูข้อความเข้ากลุ่ม Test ครบ (มอบงาน · เตือนวันที่ 3/5 · แจ้ง TG)
3. เปิดใช้จริง: ลบ `TEST_LINE_GROUP_ID` ออกจาก Production แล้ว redeploy
4. เมื่อ WorkHR จะดึงผล: TG ออก key ระบบ `workhr` (ชื่อ key เช่น "WorkHR — production") ที่ `/admin/api-keys` แล้วส่งให้ทีม WorkHR ทางช่องส่วนตัว
