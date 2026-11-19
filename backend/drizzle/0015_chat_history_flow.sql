ALTER TABLE "chat_messages" ADD COLUMN "flow" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- a question and its answer used to be saved at the same instant; put each answer just after its question so pages read in order
UPDATE "chat_messages" SET "created_at" = "created_at" + interval '1 millisecond' WHERE "role" = 'assistant';
