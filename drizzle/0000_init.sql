CREATE TABLE "adhoc_group_members" (
	"group_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"person_name" text NOT NULL,
	CONSTRAINT "adhoc_group_members_group_id_person_id_pk" PRIMARY KEY("group_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "adhoc_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by_person_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"set_id" integer NOT NULL,
	"version_id" integer,
	"action" text NOT NULL,
	"actor_person_id" integer NOT NULL,
	"actor_name" text NOT NULL,
	"comment" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_events_return_has_comment" CHECK ("approval_events"."action" <> 'returned' or length(trim("approval_events"."comment")) > 0)
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"set_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"person_name" text NOT NULL,
	"source" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"passed_at" timestamp with time zone,
	"relearn_required_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_due_after_assigned" CHECK ("assignments"."due_at" > "assignments"."assigned_at")
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" integer NOT NULL,
	"version_id" integer NOT NULL,
	"form_id" integer NOT NULL,
	"kind" text NOT NULL,
	"scan_id" integer NOT NULL,
	"layout" jsonb NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"leave_count" smallint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"score_percent" smallint,
	"passed" boolean,
	CONSTRAINT "attempts_end_fields" CHECK (("attempts"."ended_at" is null) = ("attempts"."end_reason" is null) and ("attempts"."ended_at" is null) = ("attempts"."score_percent" is null) and ("attempts"."ended_at" is null) = ("attempts"."passed" is null)),
	CONSTRAINT "attempts_leave_count" CHECK ("attempts"."leave_count" between 0 and 5),
	CONSTRAINT "attempts_score" CHECK ("attempts"."score_percent" is null or "attempts"."score_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "audience_rules" (
	"set_id" integer NOT NULL,
	"kind" text NOT NULL,
	"ref_id" integer NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "audience_rules_set_id_kind_ref_id_pk" PRIMARY KEY("set_id","kind","ref_id")
);
--> statement-breakpoint
CREATE TABLE "choices" (
	"id" serial PRIMARY KEY NOT NULL,
	"question_id" integer NOT NULL,
	"sort_order" smallint NOT NULL,
	"text" text NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"kind" text NOT NULL,
	"object_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"page_count" smallint,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"kind" text NOT NULL,
	"form_no" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_forms_form_no" CHECK ("exam_forms"."form_no" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "face_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"consent_version" text NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "face_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"object_key" text,
	"status" text NOT NULL,
	"reviewed_by_person_id" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "face_enrollments_deleted_has_no_image" CHECK ("face_enrollments"."status" <> 'deleted' or "face_enrollments"."object_key" is null)
);
--> statement-breakpoint
CREATE TABLE "face_scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"purpose" text NOT NULL,
	"result" text NOT NULL,
	"similarity" numeric(5, 2),
	"object_key" text,
	"delete_after" timestamp with time zone NOT NULL,
	"reviewed_by_person_id" integer,
	"review" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"author_person_id" integer NOT NULL,
	"author_name" text NOT NULL,
	"approver_person_id" integer,
	"approver_name" text,
	"due_days" smallint DEFAULT 7 NOT NULL,
	"exam_minutes" smallint DEFAULT 15 NOT NULL,
	"pass_percent" smallint DEFAULT 80 NOT NULL,
	"blueprint" jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_sets_due_days" CHECK ("learning_sets"."due_days" between 1 and 90),
	CONSTRAINT "learning_sets_exam_minutes" CHECK ("learning_sets"."exam_minutes" between 1 and 120),
	CONSTRAINT "learning_sets_pass_percent" CHECK ("learning_sets"."pass_percent" between 1 and 100),
	CONSTRAINT "learning_sets_active_has_approval" CHECK ("learning_sets"."status" <> 'active' or "learning_sets"."approved_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"dedupe_key" text NOT NULL,
	"kind" text NOT NULL,
	"person_id" integer,
	"line_group_id" text,
	"set_id" integer,
	"status" text DEFAULT 'queued' NOT NULL,
	"job_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "notifications_has_target" CHECK ("notifications"."person_id" is not null or "notifications"."line_group_id" is not null),
	CONSTRAINT "notifications_sent_has_job" CHECK ("notifications"."status" not in ('sent', 'delivered') or "notifications"."job_id" is not null),
	CONSTRAINT "notifications_line_group_shape" CHECK ("notifications"."line_group_id" is null or "notifications"."line_group_id" ~ '^C[0-9a-f]{32}$')
);
--> statement-breakpoint
CREATE TABLE "onboarding_paths" (
	"position_id" integer NOT NULL,
	"position_label" text NOT NULL,
	"set_id" integer NOT NULL,
	"created_by_person_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_paths_position_id_set_id_pk" PRIMARY KEY("position_id","set_id")
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"form_id" integer NOT NULL,
	"sort_order" smallint NOT NULL,
	"topic" text NOT NULL,
	"level" text NOT NULL,
	"text" text NOT NULL,
	"source_ref" text NOT NULL,
	"price_check" text DEFAULT 'not_applicable' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading_progress" (
	"assignment_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"read_round" smallint DEFAULT 1 NOT NULL,
	"pages_seen" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_progress_assignment_id_document_id_read_round_pk" PRIMARY KEY("assignment_id","document_id","read_round")
);
--> statement-breakpoint
CREATE TABLE "set_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"set_id" integer NOT NULL,
	"version_no" smallint NOT NULL,
	"label" text,
	"change_kind" text,
	"change_summary" text,
	"approved_at" timestamp with time zone,
	"created_by_person_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "set_versions_first_is_initial" CHECK (("set_versions"."version_no" = 1) = ("set_versions"."change_kind" is not distinct from 'initial'))
);
--> statement-breakpoint
CREATE TABLE "study_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"scan_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	CONSTRAINT "study_sessions_end_pair" CHECK (("study_sessions"."ended_at" is null) = ("study_sessions"."end_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "version_acknowledgements" (
	"assignment_id" integer NOT NULL,
	"version_id" integer NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "version_acknowledgements_assignment_id_version_id_pk" PRIMARY KEY("assignment_id","version_id")
);
--> statement-breakpoint
ALTER TABLE "adhoc_group_members" ADD CONSTRAINT "adhoc_group_members_group_id_adhoc_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."adhoc_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_set_id_learning_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."learning_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_version_id_set_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."set_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_set_id_learning_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."learning_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_version_id_set_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."set_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_form_id_exam_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."exam_forms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_scan_id_face_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."face_scans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_rules" ADD CONSTRAINT "audience_rules_set_id_learning_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."learning_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "choices" ADD CONSTRAINT "choices_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_views" ADD CONSTRAINT "document_views_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_version_id_set_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."set_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_forms" ADD CONSTRAINT "exam_forms_version_id_set_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."set_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_set_id_learning_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."learning_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_paths" ADD CONSTRAINT "onboarding_paths_set_id_learning_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."learning_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_form_id_exam_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."exam_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_versions" ADD CONSTRAINT "set_versions_set_id_learning_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."learning_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_scan_id_face_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."face_scans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_acknowledgements" ADD CONSTRAINT "version_acknowledgements_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_acknowledgements" ADD CONSTRAINT "version_acknowledgements_version_id_set_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."set_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_events_set_idx" ON "approval_events" USING btree ("set_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_set_person_uniq" ON "assignments" USING btree ("set_id","person_id");--> statement-breakpoint
CREATE INDEX "assignments_person_idx" ON "assignments" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "attempts_assignment_idx" ON "attempts" USING btree ("assignment_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_open_uniq" ON "attempts" USING btree ("assignment_id") WHERE "attempts"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "choices_question_order_uniq" ON "choices" USING btree ("question_id","sort_order");--> statement-breakpoint
CREATE INDEX "document_views_document_idx" ON "document_views" USING btree ("document_id","viewed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_object_key_uniq" ON "documents" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "documents_version_idx" ON "documents" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_forms_version_kind_no_uniq" ON "exam_forms" USING btree ("version_id","kind","form_no");--> statement-breakpoint
CREATE UNIQUE INDEX "face_consents_active_uniq" ON "face_consents" USING btree ("person_id") WHERE "face_consents"."withdrawn_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "face_enrollments_active_uniq" ON "face_enrollments" USING btree ("person_id") WHERE "face_enrollments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "face_scans_person_idx" ON "face_scans" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "learning_sets_author_idx" ON "learning_sets" USING btree ("author_person_id");--> statement-breakpoint
CREATE INDEX "learning_sets_approver_idx" ON "learning_sets" USING btree ("approver_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uniq" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_form_order_uniq" ON "questions" USING btree ("form_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "set_versions_set_no_uniq" ON "set_versions" USING btree ("set_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "study_sessions_open_uniq" ON "study_sessions" USING btree ("person_id") WHERE "study_sessions"."ended_at" is null;