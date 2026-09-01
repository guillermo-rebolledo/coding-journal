CREATE TABLE "journal_summary_generation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"local_date" text NOT NULL,
	"snapshot_hash" text NOT NULL,
	"status" text NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_summary_generation" ADD CONSTRAINT "journal_summary_generation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_summary_generation_user_snapshot_uidx" ON "journal_summary_generation" USING btree ("user_id","snapshot_hash");--> statement-breakpoint
CREATE INDEX "journal_summary_generation_usage_idx" ON "journal_summary_generation" USING btree ("user_id","local_date","claimed_at");