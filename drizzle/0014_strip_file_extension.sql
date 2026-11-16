-- ชื่อที่ผู้เรียนเห็นไม่ติดนามสกุลไฟล์ — ตัดเฉพาะนามสกุลของชนิดที่ระบบรับ (.pdf · .xlsx · .mp4) · ตัดแล้วว่างไม่แตะ
-- กติกาเดียวกับ displayFileName() ใน src/domain/document.ts ที่ใช้ตอนอัปโหลดใหม่
UPDATE "documents"
SET "file_name" = btrim(regexp_replace("file_name", '\.(pdf|xlsx|mp4)$', '', 'i'))
WHERE "file_name" ~* '\.(pdf|xlsx|mp4)$'
  AND btrim(regexp_replace("file_name", '\.(pdf|xlsx|mp4)$', '', 'i')) <> '';
