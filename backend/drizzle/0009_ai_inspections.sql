CREATE TABLE "ai_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"user_id" uuid,
	"user_name" text NOT NULL,
	"role" text NOT NULL,
	"surface" text NOT NULL,
	"prompt" text NOT NULL,
	"response" text DEFAULT '' NOT NULL,
	"data_accessed" jsonb NOT NULL,
	"action" jsonb,
	"approval_required" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'answered' NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"by" text DEFAULT 'rules' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"section" text NOT NULL,
	"item" text NOT NULL,
	"photo_required" boolean DEFAULT false NOT NULL,
	"condition" text,
	"note" text DEFAULT '' NOT NULL,
	"photos" jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"finding" text DEFAULT '' NOT NULL,
	"severity" text,
	"recommendation" text,
	"category" text,
	"finding_by" text,
	"issue_id" uuid
);
--> statement-breakpoint
CREATE TABLE "inspection_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"sections" jsonb NOT NULL,
	"by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"type" text NOT NULL,
	"template_name" text NOT NULL,
	"scope" text NOT NULL,
	"unit_id" uuid,
	"place" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'In progress' NOT NULL,
	"inspector_id" uuid,
	"inspector_name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"summary" text DEFAULT '' NOT NULL,
	"summary_by" text,
	"share_owner" boolean DEFAULT false NOT NULL,
	"share_tenant" boolean DEFAULT false NOT NULL,
	"ack_name" text,
	"ack_role" text,
	"ack_note" text DEFAULT '' NOT NULL,
	"ack_at" timestamp with time zone,
	CONSTRAINT "inspections_association_id_number_unique" UNIQUE("association_id","number")
);
--> statement-breakpoint
ALTER TABLE "ai_audit" ADD CONSTRAINT "ai_audit_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_audit" ADD CONSTRAINT "ai_audit_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_templates" ADD CONSTRAINT "inspection_templates_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspector_id_users_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_audit_association_id_created_at_index" ON "ai_audit" USING btree ("association_id","created_at");--> statement-breakpoint
CREATE INDEX "inspection_items_inspection_id_position_index" ON "inspection_items" USING btree ("inspection_id","position");--> statement-breakpoint
CREATE INDEX "inspection_templates_association_id_index" ON "inspection_templates" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX "inspections_association_id_started_at_index" ON "inspections" USING btree ("association_id","started_at");--> statement-breakpoint
CREATE INDEX "inspections_unit_id_index" ON "inspections" USING btree ("unit_id");