DELETE FROM "storage_download_manifests" WHERE "connection_id" NOT IN (SELECT "id" FROM "user_storage_connections");--> statement-breakpoint
ALTER TABLE "storage_download_manifests" ADD CONSTRAINT "storage_download_manifests_connection_id_user_storage_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."user_storage_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_download_manifests_expiry_idx" ON "storage_download_manifests" USING btree ("expires_at");
