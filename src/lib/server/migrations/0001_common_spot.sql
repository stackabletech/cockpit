CREATE TABLE "storage_download_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"prefix" text NOT NULL,
	"entries" jsonb NOT NULL,
	"format" text NOT NULL,
	"archive" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_recent_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"buckets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"query" text NOT NULL,
	"use_regex" boolean DEFAULT false NOT NULL,
	"exclude_patterns" text[] DEFAULT '{}' NOT NULL,
	"search_path" text DEFAULT '' NOT NULL,
	"max_depth" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_recent_searches_connection_query" UNIQUE NULLS NOT DISTINCT("user_id","connection_id","query","use_regex","exclude_patterns","search_path","max_depth","buckets")
);
--> statement-breakpoint
ALTER TABLE "user_recent_searches" ADD CONSTRAINT "user_recent_searches_connection_id_user_storage_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."user_storage_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_download_manifests_user_expiry_idx" ON "storage_download_manifests" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "user_recent_searches_connection_idx" ON "user_recent_searches" USING btree ("user_id","connection_id");
