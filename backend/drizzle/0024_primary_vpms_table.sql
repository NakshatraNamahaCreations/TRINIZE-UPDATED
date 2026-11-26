CREATE TABLE "primary_vpms" (
	"association_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- keep any choice made while it was a column on associations (0021)
INSERT INTO "primary_vpms" ("association_id", "user_id") SELECT "id", "primary_vpm_id" FROM "associations" WHERE "primary_vpm_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "associations" DROP CONSTRAINT "associations_primary_vpm_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "primary_vpms" ADD CONSTRAINT "primary_vpms_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_vpms" ADD CONSTRAINT "primary_vpms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "associations" DROP COLUMN "primary_vpm_id";