CREATE TABLE "rate_limit_counter" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"subject" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"window_ends_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_circuit" (
	"service" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone,
	"retry_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_lease" (
	"id" text PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"slot" integer NOT NULL,
	"holder" text NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_counter_scope_subject_uidx" ON "rate_limit_counter" USING btree ("scope","subject");--> statement-breakpoint
CREATE INDEX "rate_limit_counter_window_idx" ON "rate_limit_counter" USING btree ("window_ends_at");--> statement-breakpoint
CREATE INDEX "service_lease_topic_idx" ON "service_lease" USING btree ("topic","slot");