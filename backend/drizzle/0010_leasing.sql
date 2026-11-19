CREATE TABLE "application_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_url" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"verdict" text,
	"verdict_note" text DEFAULT '' NOT NULL,
	"verdict_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"unit_id" uuid NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"source" text DEFAULT 'Walk-in' NOT NULL,
	"broker_name" text DEFAULT '' NOT NULL,
	"form" jsonb NOT NULL,
	"rent" integer DEFAULT 0 NOT NULL,
	"fee_amount" integer DEFAULT 0 NOT NULL,
	"fee_refundable" boolean DEFAULT false NOT NULL,
	"fee_status" text DEFAULT 'Not required' NOT NULL,
	"fee_mode" text,
	"fee_reference" text DEFAULT '' NOT NULL,
	"fee_paid_at" timestamp with time zone,
	"fee_entry_id" uuid,
	"consent_at" timestamp with time zone,
	"consent_ip" text,
	"consent_agent" text,
	"screening" jsonb NOT NULL,
	"reference_token" text,
	"reference" jsonb,
	"info_request" text DEFAULT '' NOT NULL,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text DEFAULT '' NOT NULL,
	"tenant_user_id" uuid,
	"submitted_at" timestamp with time zone,
	"created_by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_token_unique" UNIQUE("token"),
	CONSTRAINT "applications_reference_token_unique" UNIQUE("reference_token"),
	CONSTRAINT "applications_association_id_number_unique" UNIQUE("association_id","number")
);
--> statement-breakpoint
CREATE TABLE "lease_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"file_url" text,
	"by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"application_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"template_name" text NOT NULL,
	"body" text NOT NULL,
	"rent" integer NOT NULL,
	"deposit" integer DEFAULT 0 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"signing_order" text DEFAULT 'tenant_first' NOT NULL,
	"signers" jsonb NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"last_reminder_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"signed_file_url" text,
	"signed_on_paper" boolean DEFAULT false NOT NULL,
	"edited_by_name" text,
	"by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leases_association_id_number_unique" UNIQUE("association_id","number")
);
--> statement-breakpoint
ALTER TABLE "associations" ADD COLUMN "leasing" jsonb;--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_fee_entry_id_journal_entries_id_fk" FOREIGN KEY ("fee_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_tenant_user_id_users_id_fk" FOREIGN KEY ("tenant_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_templates" ADD CONSTRAINT "lease_templates_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_documents_application_id_index" ON "application_documents" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "application_events_application_id_created_at_index" ON "application_events" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "applications_association_id_status_index" ON "applications" USING btree ("association_id","status");--> statement-breakpoint
CREATE INDEX "applications_association_id_phone_index" ON "applications" USING btree ("association_id","phone");--> statement-breakpoint
CREATE INDEX "lease_templates_association_id_index" ON "lease_templates" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX "leases_association_id_status_index" ON "leases" USING btree ("association_id","status");--> statement-breakpoint
CREATE INDEX "leases_application_id_index" ON "leases" USING btree ("application_id");