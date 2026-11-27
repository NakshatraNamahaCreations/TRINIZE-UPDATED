ALTER TABLE "site_visits" ADD COLUMN "checked_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_visits" ADD COLUMN "checked_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_visits" ADD COLUMN "report" text DEFAULT '' NOT NULL;