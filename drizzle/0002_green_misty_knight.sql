CREATE TABLE "github_installation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"installation_id" text,
	"account_id" text,
	"account_login" text,
	"account_type" text,
	"repository_selection" text,
	"repository_count" integer,
	"permissions" jsonb,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_installation_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"return_to" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_installation_state_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "github_installation" ADD CONSTRAINT "github_installation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installation_state" ADD CONSTRAINT "github_installation_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_installation_installationId_uidx" ON "github_installation" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "github_installation_userId_idx" ON "github_installation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "github_installation_state_userId_idx" ON "github_installation_state" USING btree ("user_id");