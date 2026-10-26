CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"dedupe_key" text NOT NULL,
	"kind" text NOT NULL,
	"person_id" integer,
	"line_group_id" text,
	"set_id" integer,
	"assignment_id" integer,
	"status" text NOT NULL,
	"job_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"detail" text,
	"text" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "notifications_sent_has_job" CHECK ("notifications"."status" <> 'sent' or cardinality("notifications"."job_ids") > 0),
	CONSTRAINT "notifications_line_group_shape" CHECK ("notifications"."line_group_id" is null or "notifications"."line_group_id" ~ '^C[0-9a-f]{32}$')
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_set_id_learning_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."learning_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uniq" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_assignment_idx" ON "notifications" USING btree ("assignment_id");