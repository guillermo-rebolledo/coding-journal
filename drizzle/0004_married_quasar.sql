CREATE TABLE "github_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"local_date" text NOT NULL,
	"kind" text NOT NULL,
	"deduplication_key" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_login" text NOT NULL,
	"repository_id" text NOT NULL,
	"repository_name" text NOT NULL,
	"evidence_url" text NOT NULL,
	"visibility" text NOT NULL,
	"source" text NOT NULL,
	"subject_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"authored_before_day" boolean DEFAULT false NOT NULL,
	"installation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_reconciliation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"local_date" text NOT NULL,
	"time_zone" text NOT NULL,
	"status" text NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_activity" ADD CONSTRAINT "github_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_reconciliation" ADD CONSTRAINT "journal_reconciliation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_activity_user_deduplication_uidx" ON "github_activity" USING btree ("user_id","deduplication_key");--> statement-breakpoint
CREATE INDEX "github_activity_user_date_idx" ON "github_activity" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_reconciliation_user_date_uidx" ON "journal_reconciliation" USING btree ("user_id","local_date");