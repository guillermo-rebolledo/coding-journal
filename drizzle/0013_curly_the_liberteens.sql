CREATE TABLE "privacy_operation" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_hash" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"affected_users" integer DEFAULT 0 NOT NULL,
	"deleted_activities" integer DEFAULT 0 NOT NULL,
	"redacted_journals" integer DEFAULT 0 NOT NULL,
	"error_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_operation_operation_hash_unique" UNIQUE("operation_hash")
);
--> statement-breakpoint
CREATE INDEX "privacy_operation_status_idx" ON "privacy_operation" USING btree ("status","updated_at");