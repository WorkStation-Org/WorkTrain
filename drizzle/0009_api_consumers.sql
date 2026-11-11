CREATE TABLE "api_consumers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"scopes" text[] DEFAULT '{read}'::text[] NOT NULL,
	"key_hash" text NOT NULL,
	"key_hint" text NOT NULL,
	"created_by_person_id" integer NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_name" text,
	CONSTRAINT "api_consumers_name_shape" CHECK ("api_consumers"."name" ~ '^[a-z][a-z0-9-]{1,39}$'),
	CONSTRAINT "api_consumers_key_hash_shape" CHECK ("api_consumers"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "api_consumers_scopes_known" CHECK (cardinality("api_consumers"."scopes") > 0 and "api_consumers"."scopes" <@ array['read']::text[])
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_consumers_key_hash_uniq" ON "api_consumers" USING btree ("key_hash");