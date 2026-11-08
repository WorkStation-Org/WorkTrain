-- ทะเบียนชนิดของชุด (ADR-0011) — แทน enum `learning_sets.kind` ('product' | 'general')
-- ★ ชุดเดิมไม่เปลี่ยน: ชุดเก็บแม่แบบของตัวเองใน learning_sets.blueprint อยู่แล้ว · ที่ย้ายมีแค่ "ชนิดไหน"
-- ★ id 1 / 2 ตายตัว (SEEDED_KIND_IDS ใน schema.ts) · แม่แบบเท่ากับ PRODUCT_BLUEPRINT / GENERAL_BLUEPRINT (มีเทสต์เทียบ)
CREATE TABLE "set_kinds" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"blueprint" jsonb NOT NULL,
	"allow_pricelist" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "set_kinds_name_uniq" ON "set_kinds" USING btree (lower("name"));--> statement-breakpoint
INSERT INTO "set_kinds" ("id", "name", "blueprint", "allow_pricelist") VALUES
	(1, 'สินค้าใหม่ (PD)', '[{"topic":"spec","level":"recall","count":2},{"topic":"spec","level":"understand","count":1},{"topic":"price","level":"recall","count":1},{"topic":"price","level":"understand","count":1},{"topic":"price","level":"scenario","count":1},{"topic":"material","level":"recall","count":1},{"topic":"material","level":"understand","count":1},{"topic":"pairing","level":"understand","count":1},{"topic":"pairing","level":"scenario","count":1}]', true),
	(2, 'ทั่วไป', '[{"topic":"general","level":"recall","count":4},{"topic":"general","level":"understand","count":4},{"topic":"general","level":"scenario","count":2}]', false);--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('set_kinds', 'id'), 2);--> statement-breakpoint
ALTER TABLE "learning_sets" ADD COLUMN "kind_id" integer;--> statement-breakpoint
UPDATE "learning_sets" SET "kind_id" = CASE WHEN "kind" = 'product' THEN 1 ELSE 2 END;--> statement-breakpoint
ALTER TABLE "learning_sets" ALTER COLUMN "kind_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_sets" ADD CONSTRAINT "learning_sets_kind_id_set_kinds_id_fk" FOREIGN KEY ("kind_id") REFERENCES "public"."set_kinds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_sets_kind_idx" ON "learning_sets" USING btree ("kind_id");
