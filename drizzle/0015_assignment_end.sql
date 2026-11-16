ALTER TABLE "assignments" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "end_reason" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "assign_round" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_end_pair" CHECK (("assignments"."ended_at" is null) = ("assignments"."end_reason" is null));