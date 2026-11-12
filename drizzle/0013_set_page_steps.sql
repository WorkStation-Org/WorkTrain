CREATE TABLE "question_reviews" (
	"question_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_reviews_question_id_person_id_pk" PRIMARY KEY("question_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "exam_weight" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_sets" ADD COLUMN "spread_mode" text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE "question_reviews" ADD CONSTRAINT "question_reviews_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_exam_weight" CHECK ("documents"."exam_weight" between 0 and 5);