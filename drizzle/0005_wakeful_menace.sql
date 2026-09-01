CREATE TABLE "github_webhook_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"event_type" text NOT NULL,
	"installation_id" text,
	"status" text NOT NULL,
	"error_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "github_webhook_delivery_deliveryId_uidx" ON "github_webhook_delivery" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "github_installation_installationId_idx" ON "github_installation" USING btree ("installation_id");