ALTER TABLE "github_activity" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "github_activity" ADD COLUMN "narrative_eligible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "github_activity" ADD COLUMN "attribution_keys" jsonb;--> statement-breakpoint
ALTER TABLE "github_activity" ADD COLUMN "attributed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "github_activity_user_attributed_idx" ON "github_activity" USING btree ("user_id","attributed");