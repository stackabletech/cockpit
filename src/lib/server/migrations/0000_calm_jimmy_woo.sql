CREATE TABLE "user_storage_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"encrypted_payload" text NOT NULL,
	"hash" text NOT NULL,
	"additional_buckets" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "user_id_idx" ON "user_storage_connections" USING btree ("user_id");
