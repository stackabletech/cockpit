ALTER TABLE "user_recent_searches" DROP CONSTRAINT "user_recent_searches_connection_query";--> statement-breakpoint
ALTER TABLE "user_recent_searches" ADD COLUMN "search_key" text;--> statement-breakpoint
-- Existing rows get a unique placeholder key; they no longer deduplicate with new searches.
UPDATE "user_recent_searches" SET "search_key" = "id"::text;--> statement-breakpoint
ALTER TABLE "user_recent_searches" ALTER COLUMN "search_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_recent_searches" ADD CONSTRAINT "user_recent_searches_search_key" UNIQUE("user_id","connection_id","search_key");
