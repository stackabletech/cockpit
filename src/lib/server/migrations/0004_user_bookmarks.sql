CREATE TABLE "user_bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"name" text NOT NULL,
	"environment" text NOT NULL,
	"url" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "user_bookmarks_user_id_idx" ON "user_bookmarks" USING btree ("user_id");
