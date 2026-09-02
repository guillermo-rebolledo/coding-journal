CREATE TABLE "github_access_block" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"installation_id" text,
	"repository_id" text,
	"all_private" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_access_block" ADD CONSTRAINT "github_access_block_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_access_block_user_scope_uidx" ON "github_access_block" USING btree ("user_id","scope_key");--> statement-breakpoint
CREATE INDEX "github_access_block_user_idx" ON "github_access_block" USING btree ("user_id");