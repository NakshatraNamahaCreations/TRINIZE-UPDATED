CREATE TABLE "site_visit_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"visit_id" uuid,
	"time" text,
	"title" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"issue_id" uuid,
	"requested_by" uuid,
	"extra" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"reply" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_visit_plans" (
	"association_id" uuid PRIMARY KEY NOT NULL,
	"weekday" integer NOT NULL,
	"start" text NOT NULL,
	"end" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"date" text NOT NULL,
	"start" text NOT NULL,
	"end" text NOT NULL,
	"status" text DEFAULT 'Planned' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_visits_association_id_date_unique" UNIQUE("association_id","date")
);
--> statement-breakpoint
ALTER TABLE "site_visit_items" ADD CONSTRAINT "site_visit_items_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visit_items" ADD CONSTRAINT "site_visit_items_visit_id_site_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."site_visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visit_items" ADD CONSTRAINT "site_visit_items_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visit_items" ADD CONSTRAINT "site_visit_items_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visit_plans" ADD CONSTRAINT "site_visit_plans_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_visit_items_association_id_status_index" ON "site_visit_items" USING btree ("association_id","status");--> statement-breakpoint
CREATE INDEX "site_visit_items_visit_id_index" ON "site_visit_items" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "site_visit_items_requested_by_index" ON "site_visit_items" USING btree ("requested_by");