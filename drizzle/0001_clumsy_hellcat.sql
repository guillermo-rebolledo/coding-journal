CREATE TABLE "journal_onboarding" (
	"user_id" text PRIMARY KEY NOT NULL,
	"time_zone" text,
	"github_access_mode" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_onboarding" ADD CONSTRAINT "journal_onboarding_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;