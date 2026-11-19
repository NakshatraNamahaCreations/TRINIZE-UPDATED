CREATE TABLE "frequent_visitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"visitor_type" text DEFAULT 'Guest' NOT NULL,
	"vehicle" text,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "frequent_visitors_unit_id_phone_unique" UNIQUE("unit_id","phone")
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"unit_id" uuid,
	"kind" text DEFAULT 'visitor' NOT NULL,
	"visitor_type" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"photo_url" text,
	"purpose" text DEFAULT '' NOT NULL,
	"vehicle" text,
	"people" integer DEFAULT 1 NOT NULL,
	"delivery_type" text,
	"partner" text,
	"status" text NOT NULL,
	"flagged" text,
	"pass_code" text,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"decided_by" uuid,
	"decided_by_name" text,
	"decided_via" text,
	"decided_at" timestamp with time zone,
	"entered_at" timestamp with time zone,
	"exited_at" timestamp with time zone,
	"gate" text,
	"guard_id" uuid,
	"guard_name" text,
	"exit_guard_name" text,
	"proof_url" text,
	"kept_at" timestamp with time zone,
	"collect_code" text,
	"collected_at" timestamp with time zone,
	"collected_by" text,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"vehicle" text,
	"reason" text NOT NULL,
	"level" text DEFAULT 'block' NOT NULL,
	"added_by" uuid,
	"added_by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "frequent_visitors" ADD CONSTRAINT "frequent_visitors_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frequent_visitors" ADD CONSTRAINT "frequent_visitors_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frequent_visitors" ADD CONSTRAINT "frequent_visitors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_guard_id_users_id_fk" FOREIGN KEY ("guard_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "frequent_visitors_association_id_phone_index" ON "frequent_visitors" USING btree ("association_id","phone");--> statement-breakpoint
CREATE INDEX "visits_association_id_created_at_index" ON "visits" USING btree ("association_id","created_at");--> statement-breakpoint
CREATE INDEX "visits_unit_id_created_at_index" ON "visits" USING btree ("unit_id","created_at");--> statement-breakpoint
CREATE INDEX "visits_association_id_status_index" ON "visits" USING btree ("association_id","status");--> statement-breakpoint
CREATE INDEX "visits_association_id_pass_code_index" ON "visits" USING btree ("association_id","pass_code");--> statement-breakpoint
CREATE INDEX "watchlist_association_id_index" ON "watchlist" USING btree ("association_id");