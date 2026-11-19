CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"unit_id" uuid,
	"title" text NOT NULL,
	"kind" text DEFAULT 'Other' NOT NULL,
	"file_url" text NOT NULL,
	"shared" boolean DEFAULT true NOT NULL,
	"by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"paid_on" date NOT NULL,
	"mode" text DEFAULT 'Bank transfer' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"entry_id" uuid,
	"by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "associations" ADD COLUMN "owner_portal" jsonb;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "owner_approval" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "occupancy" text DEFAULT 'Owner-occupied' NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "monthly_rent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "lease_end" date;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_activity" ADD CONSTRAINT "owner_activity_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_activity" ADD CONSTRAINT "owner_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_payouts" ADD CONSTRAINT "owner_payouts_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_payouts" ADD CONSTRAINT "owner_payouts_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_payouts" ADD CONSTRAINT "owner_payouts_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_association_id_index" ON "documents" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX "documents_unit_id_index" ON "documents" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "owner_activity_association_id_created_at_index" ON "owner_activity" USING btree ("association_id","created_at");--> statement-breakpoint
CREATE INDEX "owner_payouts_unit_id_paid_on_index" ON "owner_payouts" USING btree ("unit_id","paid_on");