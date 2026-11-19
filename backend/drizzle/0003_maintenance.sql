CREATE TABLE "issue_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"file_url" text,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"thread" text NOT NULL,
	"from_user_id" uuid,
	"from_role" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"attachment_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "associations" ADD COLUMN "approval_limit" integer DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "scope" text DEFAULT 'unit' NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "asset" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "vendor_state" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "cost_estimate" integer;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "cost_actual" integer;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "approval" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "approval_by" uuid;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "access_note" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "last_reminder_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "contact" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "service_area" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_invoices" ADD CONSTRAINT "issue_invoices_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_invoices" ADD CONSTRAINT "issue_invoices_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_invoices" ADD CONSTRAINT "issue_invoices_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_messages" ADD CONSTRAINT "issue_messages_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_messages" ADD CONSTRAINT "issue_messages_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_invoices_issue_id_index" ON "issue_invoices" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "issue_invoices_vendor_id_index" ON "issue_invoices" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "issue_messages_issue_id_created_at_index" ON "issue_messages" USING btree ("issue_id","created_at");--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_approval_by_users_id_fk" FOREIGN KEY ("approval_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;