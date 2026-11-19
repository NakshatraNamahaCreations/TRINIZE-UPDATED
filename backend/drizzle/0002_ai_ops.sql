CREATE TABLE "ai_settings" (
	"association_id" uuid PRIMARY KEY NOT NULL,
	"qna" boolean DEFAULT true NOT NULL,
	"issue_create" boolean DEFAULT true NOT NULL,
	"tone_rewrite" boolean DEFAULT true NOT NULL,
	"summaries" boolean DEFAULT true NOT NULL,
	"tones" jsonb DEFAULT '{"Polite":true,"Friendly":true,"Funny":true,"Short & Clear":true}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"number" text NOT NULL,
	"amount" integer NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"last_chased_at" timestamp with time zone,
	"chases" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "knowledge_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"title" text NOT NULL,
	"section" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"who" text NOT NULL,
	"what" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"association_id" uuid PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'Apartment' NOT NULL,
	"plan" text NOT NULL,
	"billing" text DEFAULT 'yearly' NOT NULL,
	"state" text DEFAULT 'Active' NOT NULL,
	"annual_amount" integer NOT NULL,
	"renews_at" timestamp with time zone NOT NULL,
	"plots" integer DEFAULT 0 NOT NULL,
	"owners" integer DEFAULT 0 NOT NULL,
	"admin_name" text DEFAULT '' NOT NULL,
	"admin_role" text DEFAULT '' NOT NULL,
	"admin_phone" text DEFAULT '' NOT NULL,
	"admin_email" text DEFAULT '' NOT NULL,
	"registration" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"association_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"raised_by" text NOT NULL,
	"source" text NOT NULL,
	"priority" text NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"assignee" text,
	"sla_due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "support_tickets_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "ticket_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"by_user_id" uuid,
	"by_name" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"month" text NOT NULL,
	"adoption" integer NOT NULL,
	"logins" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_snapshots_association_id_month_unique" UNIQUE("association_id","month")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD CONSTRAINT "knowledge_docs_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_replies" ADD CONSTRAINT "ticket_replies_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_replies" ADD CONSTRAINT "ticket_replies_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_snapshots" ADD CONSTRAINT "usage_snapshots_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_user_id_created_at_index" ON "chat_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "invoices_association_id_index" ON "invoices" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX "knowledge_docs_association_id_index" ON "knowledge_docs" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX "ops_activity_created_at_index" ON "ops_activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_status_index" ON "support_tickets" USING btree ("status");