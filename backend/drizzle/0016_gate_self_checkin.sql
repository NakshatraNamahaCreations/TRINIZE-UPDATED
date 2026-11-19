CREATE TABLE "gate_stickers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"gate" text NOT NULL,
	"token" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gate_stickers_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "self_token" text;--> statement-breakpoint
ALTER TABLE "gate_stickers" ADD CONSTRAINT "gate_stickers_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_stickers" ADD CONSTRAINT "gate_stickers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gate_stickers_association_id_index" ON "gate_stickers" USING btree ("association_id");--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_self_token_unique" UNIQUE("self_token");