-- ดูคลิปได้ทีละคลิป (ADR-0020) — คลิปที่นับอยู่ของรอบเรียน + งบช่วงวิดีโอตามเวลาจริง (เปิดหลายแท็บเล่นพร้อมกันไม่ได้เร็วขึ้น)
ALTER TABLE "study_sessions" ADD COLUMN "video_document_id" integer;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "video_held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "video_credit_until" timestamp with time zone;