-- ชื่อ key ที่ TG ตั้งเอง (ภาษาไทยได้) — key ที่ออกไปแล้วได้ชื่อระบบเป็นชื่อตั้งต้น
ALTER TABLE "api_consumers" ADD COLUMN "label" text;--> statement-breakpoint
UPDATE "api_consumers" SET "label" = "name" WHERE "label" IS NULL;--> statement-breakpoint
ALTER TABLE "api_consumers" ALTER COLUMN "label" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "api_consumers" ADD CONSTRAINT "api_consumers_label_len" CHECK (char_length(btrim("api_consumers"."label")) between 1 and 60);
