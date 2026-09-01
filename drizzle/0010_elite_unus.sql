CREATE TABLE "journal_summary" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"local_date" text NOT NULL,
	"snapshot_hash" text NOT NULL,
	"model" text NOT NULL,
	"output" jsonb NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_microusd" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_summary" ADD CONSTRAINT "journal_summary_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_summary_user_snapshot_uidx" ON "journal_summary" USING btree ("user_id","snapshot_hash");--> statement-breakpoint
CREATE INDEX "journal_summary_user_date_idx" ON "journal_summary" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "journal_summary_created_at_idx" ON "journal_summary" USING btree ("created_at");