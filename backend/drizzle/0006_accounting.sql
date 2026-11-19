CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"role" text,
	"system" integer DEFAULT 0 NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "accounts_association_id_code_unique" UNIQUE("association_id","code")
);
--> statement-breakpoint
CREATE TABLE "bank_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"debit" integer DEFAULT 0 NOT NULL,
	"credit" integer DEFAULT 0 NOT NULL,
	"balance" integer,
	"status" text DEFAULT 'Unmatched' NOT NULL,
	"matched_type" text,
	"matched_id" uuid,
	"matched_how" text,
	"batch" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bill_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"period" text NOT NULL,
	"charge_type" text NOT NULL,
	"method" text NOT NULL,
	"rate" jsonb NOT NULL,
	"due_date" date NOT NULL,
	"bills" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"number" text NOT NULL,
	"period" text NOT NULL,
	"charge_type" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount" integer NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL,
	"waived" integer DEFAULT 0 NOT NULL,
	"due_date" date NOT NULL,
	"cancelled_at" timestamp with time zone,
	"run_id" uuid,
	"entry_id" uuid,
	"late_fee_for" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_association_id_number_unique" UNIQUE("association_id","number")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"number" text NOT NULL,
	"vendor_id" uuid,
	"payee" text NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"date" date NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"bill_no" text DEFAULT '' NOT NULL,
	"receipt_url" text,
	"status" text DEFAULT 'Pending approval' NOT NULL,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"paid_on" date,
	"paid_from" uuid,
	"payment_mode" text,
	"reference" text DEFAULT '' NOT NULL,
	"entry_id" uuid,
	"pay_entry_id" uuid,
	"issue_invoice_id" uuid,
	"created_by" uuid,
	"by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_association_id_number_unique" UNIQUE("association_id","number")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"date" date NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"source_id" uuid,
	"reverses" uuid,
	"reversed_by" uuid,
	"created_by" uuid,
	"by_name" text DEFAULT 'System' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_association_id_number_unique" UNIQUE("association_id","number")
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" integer DEFAULT 0 NOT NULL,
	"credit" integer DEFAULT 0 NOT NULL,
	"unit_id" uuid,
	"vendor_id" uuid
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"payment_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	CONSTRAINT "payment_allocations_payment_id_bill_id_pk" PRIMARY KEY("payment_id","bill_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"number" text NOT NULL,
	"amount" integer NOT NULL,
	"mode" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"cheque_no" text,
	"cheque_date" date,
	"cheque_status" text,
	"received_on" date NOT NULL,
	"payer_name" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'office' NOT NULL,
	"account_id" uuid NOT NULL,
	"entry_id" uuid,
	"reversed_at" timestamp with time zone,
	"reverse_reason" text,
	"created_by" uuid,
	"by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_association_id_number_unique" UNIQUE("association_id","number")
);
--> statement-breakpoint
CREATE TABLE "period_locks" (
	"association_id" uuid NOT NULL,
	"period" text NOT NULL,
	"by_name" text NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_locks_association_id_period_pk" PRIMARY KEY("association_id","period")
);
--> statement-breakpoint
ALTER TABLE "associations" ADD COLUMN "accounting" jsonb;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "area" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "flat_type" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_runs" ADD CONSTRAINT "bill_runs_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_run_id_bill_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."bill_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_from_accounts_id_fk" FOREIGN KEY ("paid_from") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_pay_entry_id_journal_entries_id_fk" FOREIGN KEY ("pay_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_association_id_index" ON "accounts" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX "bank_lines_association_id_date_index" ON "bank_lines" USING btree ("association_id","date");--> statement-breakpoint
CREATE INDEX "bank_lines_batch_index" ON "bank_lines" USING btree ("batch");--> statement-breakpoint
CREATE INDEX "bill_runs_association_id_period_index" ON "bill_runs" USING btree ("association_id","period");--> statement-breakpoint
CREATE INDEX "bills_unit_id_index" ON "bills" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "bills_association_id_period_index" ON "bills" USING btree ("association_id","period");--> statement-breakpoint
CREATE INDEX "expenses_association_id_date_index" ON "expenses" USING btree ("association_id","date");--> statement-breakpoint
CREATE INDEX "expenses_issue_invoice_id_index" ON "expenses" USING btree ("issue_invoice_id");--> statement-breakpoint
CREATE INDEX "journal_entries_association_id_date_index" ON "journal_entries" USING btree ("association_id","date");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_id_index" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_id_index" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_unit_id_index" ON "journal_lines" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "payments_unit_id_index" ON "payments" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "payments_association_id_received_on_index" ON "payments" USING btree ("association_id","received_on");