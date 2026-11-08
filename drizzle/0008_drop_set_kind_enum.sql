-- ลบ enum เดิมหลัง 0007 ย้ายทุกชุดไป kind_id แล้ว (ADR-0011)
ALTER TABLE "learning_sets" DROP COLUMN "kind";