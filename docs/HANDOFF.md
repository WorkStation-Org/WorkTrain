# WorkTrain — ส่งต่องาน (11 พ.ย. 2569)

## สถานะตอนนี้
- **Production ใช้งานได้:** https://worktrain.workstationoffice.com (Vercel project `worktrain` · ทีม workstationgroup · `prj_mjcs…` — ชื่อเดิม `wso-knowledge` · `.vercel/project.json` บนเครื่องชี้ project นี้ถูกแล้ว)
- **ฐาน:** Neon `fancy-wave-83217363` · migration 0000–0008 ครบ · build ของ production รัน migration เอง (`scripts/migrate-on-deploy.mjs`)
- **WorkID:** ลงทะเบียนแอป `worktrain` แล้ว · env ครบ ยกเว้น `TEST_LINE_GROUP_ID` และ `WORKTRAIN_API_CONSUMERS`
- **ข้อความยินยอม:** HR/ฝ่ายกฎหมายรับรองแล้ว (PR #20)
- **Vercel ไม่ deploy เองหลัง merge (ตั้งแต่ 1 พ.ย. ที่เปลี่ยนชื่อ project):** project ยังผูก repo อยู่ · แอป Vercel บน GitHub เข้าถึงทุก repo ·
  repo อื่นในเครือ deploy เองปกติ — แต่ push เข้า WorkTrain ไม่ไปถึง Vercel เลย (ไม่มี preview ของ branch ด้วย) ·
  ระหว่างนี้สั่ง deploy เอง (README หัวข้อ Deploy) · ทางแก้ที่น่าจะได้: Vercel → `worktrain` → Settings → Git → Disconnect แล้ว Connect `WorkStation-Org/WorkTrain` ใหม่
- ไม่มี CI บน GitHub — ด่านก่อน merge = `npm run ci` บนเครื่อง แล้วแปะผลเป็นคอมเมนต์ใน PR

## งานที่เสร็จ (8–11 พ.ย.)
- #20 เอาป้ายร่างออกจากหน้ายินยอม
- #22 ทะเบียนชนิดของชุด `/admin/kinds` (ADR-0011) — TG เพิ่ม/แก้ชื่อ/เปิด-ปิดชนิด · แม่แบบข้อสอบต่อชนิด (หัวข้อตั้งเอง) · สวิตช์ Pricelist ต่อชนิด ·
  migration 0007 ย้ายสองชนิดเดิมเข้าตาราง · 0008 ลบคอลัมน์ `kind` · ชุดเดิมไม่เปลี่ยน (คัดลอกแม่แบบตอนสร้าง) · vitest จำกัด 4 worker (เทสต์ PGlite หมดเวลาสุ่ม)
- ชื่อชนิดเอกสาร `catalog` บนจอเป็น "เอกสารหลัก" (ไม่ผูกกับสินค้า) · README ตรงกับสถานะจริง

## งานถัดไป
1. **ตั้ง `TEST_LINE_GROUP_ID` ช่วงทดลอง** — ไม่งั้นข้อความ LINE ไปถึงพนักงานจริงทันทีที่อนุมัติชุดแรก (ต้องได้ groupId กลุ่มทดสอบจากเจ้าของ)
2. แก้ Git integration ของ Vercel (ดูสถานะด้านบน — ทำได้ใน dashboard เท่านั้น)
3. ลองสแกนหน้าบนมือถือจริงกับ AWS · ลองหน้าทำข้อสอบระหว่างสอบบน production · เปิดดู `/admin/kinds` บน production หลังล็อกอิน
4. `WORKTRAIN_API_CONSUMERS` เมื่อ WorkHR จะดึงผล (`npm run api:new-key`)
