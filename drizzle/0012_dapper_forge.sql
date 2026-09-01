CREATE TABLE "journal_finalization" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"local_date" text NOT NULL,
	"time_zone" text NOT NULL,
	"status" text NOT NULL,
	"completeness" text,
	"metrics" jsonb,
	"narrative" jsonb,
	"snapshot_hash" text,
	"evidence_keys" jsonb,
	"evidence" jsonb,
	"last_failure" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"finalization_started_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"narrative_redacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_finalization" ADD CONSTRAINT "journal_finalization_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_finalization_user_date_uidx" ON "journal_finalization" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "journal_finalization_history_idx" ON "journal_finalization" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "journal_finalization_status_idx" ON "journal_finalization" USING btree ("status");