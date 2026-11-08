ALTER TABLE "attempts" ADD COLUMN "read_round" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "face_scans" ADD COLUMN "liveness_session_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_scan_uniq" ON "attempts" USING btree ("scan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "face_scans_liveness_session_uniq" ON "face_scans" USING btree ("liveness_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "study_sessions_scan_uniq" ON "study_sessions" USING btree ("scan_id");