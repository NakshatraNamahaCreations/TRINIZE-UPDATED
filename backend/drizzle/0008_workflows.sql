CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"raised_by" uuid,
	"raised_by_name" text NOT NULL,
	"raised_by_role" text DEFAULT 'resident' NOT NULL,
	"unit_id" uuid,
	"place" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"ack_by_name" text,
	"ack_at" timestamp with time zone,
	"resolved_by_name" text,
	"resolved_at" timestamp with time zone,
	"resolution" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"assignee" text DEFAULT 'admin' NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'Open' NOT NULL,
	"run_id" uuid,
	"link" text,
	"done_by_name" text,
	"done_at" timestamp with time zone,
	"by_name" text DEFAULT 'Workflow' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step" integer NOT NULL,
	"action" text NOT NULL,
	"result" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"association_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"subject_label" text NOT NULL,
	"status" text DEFAULT 'Scheduled' NOT NULL,
	"step_index" integer DEFAULT 0 NOT NULL,
	"repeats_done" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone,
	"failure" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "workflow_runs_workflow_id_subject_id_unique" UNIQUE("workflow_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"name" text NOT NULL,
	"template_key" text,
	"trigger" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_log" ADD CONSTRAINT "workflow_log_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incidents_association_id_created_at_index" ON "incidents" USING btree ("association_id","created_at");--> statement-breakpoint
CREATE INDEX "incidents_association_id_status_index" ON "incidents" USING btree ("association_id","status");--> statement-breakpoint
CREATE INDEX "tasks_association_id_status_index" ON "tasks" USING btree ("association_id","status");--> statement-breakpoint
CREATE INDEX "workflow_log_run_id_created_at_index" ON "workflow_log" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_status_next_at_index" ON "workflow_runs" USING btree ("status","next_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_association_id_started_at_index" ON "workflow_runs" USING btree ("association_id","started_at");--> statement-breakpoint
CREATE INDEX "workflows_association_id_trigger_index" ON "workflows" USING btree ("association_id","trigger");