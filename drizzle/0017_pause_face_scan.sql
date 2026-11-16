-- พักการสแกนใบหน้าได้ (ADR-0019) — รอบเรียน/ครั้งที่สอบที่เริ่มตอนพักไม่มีผลสแกน (scan_id ว่าง)
-- unique index ของ scan_id ยังกันผลสแกนเดียวใช้สองครั้งเหมือนเดิม (ค่าว่างซ้ำกันได้)
ALTER TABLE "attempts" ALTER COLUMN "scan_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "study_sessions" ALTER COLUMN "scan_id" DROP NOT NULL;