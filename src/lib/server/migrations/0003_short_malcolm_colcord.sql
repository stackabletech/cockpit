CREATE TABLE "storage_download_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"prefix" text NOT NULL,
	"entries" jsonb NOT NULL,
	"format" text NOT NULL,
	"archive" text,
	"archive_size" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "storage_download_manifests_user_expiry_idx" ON "storage_download_manifests" USING btree ("user_id","expires_at");