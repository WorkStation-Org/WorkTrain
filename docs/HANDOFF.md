# WorkTrain — ส่งต่องาน (11 พ.ย. 2569)

## สถานะตอนนี้
- **Production ใช้งานได้:** https://worktrain.workstationoffice.com (Vercel project `worktrain` · ทีม workstationgroup · `prj_mjcs…` — ชื่อเดิม `wso-knowledge` · `.vercel/project.json` บนเครื่องชี้ project นี้ถูกแล้ว)
- **ฐาน:** Neon `fancy-wave-83217363` · migration 0000–0008 ครบ · build ของ production รัน migration เอง (`scripts/migrate-on-deploy.mjs`)
- **WorkID:** ลงทะเบียนแอป `worktrain` แล้ว · env ครบ
- **API Key ให้ระบบอื่น:** TG ออก/ถอนที่ `/admin/api-keys` (ADR-0012 · ตาราง `api_consumers` migration 0009 · ชื่อ key migration 0010) — ยังไม่ได้ออกให้ใคร
- **ช่วงทดลอง LINE:** ตั้ง `TEST_LINE_GROUP_ID` (Production) แล้ว 11 พ.ย. — ทุกข้อความ (รวมตัวต่อตัว) ไปกลุ่ม Test · **ลบ env นี้ = เริ่มส่งพนักงานจริง**
- **ข้อความยินยอม:** HR/ฝ่ายกฎหมายรับรองแล้ว (PR #20)
- **Vercel deploy เองหลัง merge:** Git ของ project หลุดตั้งแต่เปลี่ยนชื่อ (1 พ.ย.) · เจ้าของต่อใหม่แล้ว 11 พ.ย.
- ไม่มี CI บน GitHub — ด่านก่อน merge = `npm run ci` บนเครื่อง แล้วแปะผลเป็นคอมเมนต์ใน PR

## งานที่เสร็จ (8–11 พ.ย.)
- #20 เอาป้ายร่างออกจากหน้ายินยอม
- #22 ทะเบียนชนิดของชุด `/admin/kinds` (ADR-0011) — TG เพิ่ม/แก้ชื่อ/เปิด-ปิดชนิด · แม่แบบข้อสอบต่อชนิด (หัวข้อตั้งเอง) · สวิตช์ Pricelist ต่อชนิด ·
  migration 0007 ย้ายสองชนิดเดิมเข้าตาราง · 0008 ลบคอลัมน์ `kind` · ชุดเดิมไม่เปลี่ยน (คัดลอกแม่แบบตอนสร้าง) · vitest จำกัด 4 worker (เทสต์ PGlite หมดเวลาสุ่ม)
- ชื่อชนิดเอกสาร `catalog` บนจอเป็น "เอกสารหลัก" (ไม่ผูกกับสินค้า) · README ตรงกับสถานะจริง

## งานถัดไป
1. ลองสแกนหน้าบนมือถือจริงกับ AWS · ลองหน้าทำข้อสอบระหว่างสอบบน production · เปิดดู `/admin/kinds` บน production หลังล็อกอิน
2. ลองอนุมัติชุดแรก → ดูข้อความเข้ากลุ่ม Test ครบ (มอบงาน · เตือนวันที่ 3/5 · แจ้ง TG)
3. เปิดใช้จริง: ลบ `TEST_LINE_GROUP_ID` ออกจาก Production แล้ว redeploy
4. เมื่อ WorkHR จะดึงผล: TG ออก key ระบบ `workhr` (ตั้งชื่อ key เช่น "WorkHR — production") ที่ `/admin/api-keys` แล้วส่งให้ทีม WorkHR
