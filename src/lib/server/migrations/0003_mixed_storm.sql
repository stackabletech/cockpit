CREATE TABLE "user_recent_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"query" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_recent_searches_user_connection_bucket_query" UNIQUE("user_id","connection_id","bucket","query")
);
--> statement-breakpoint
ALTER TABLE "user_recent_searches" ADD CONSTRAINT "user_recent_searches_connection_id_user_storage_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."user_storage_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_recent_searches_connection_idx" ON "user_recent_searches" USING btree ("user_id","connection_id");
