CREATE TABLE `planning_document_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`asset_type` text NOT NULL,
	`url` text NOT NULL,
	`mime_type` text,
	`content_hash_sha256` text,
	`byte_size` integer,
	`page_count` integer,
	`source_modified_at` text,
	`retrieved_at` text,
	`retrieval_status` text DEFAULT 'pending' NOT NULL,
	`local_path` text,
	`ocr_status` text DEFAULT 'pending' NOT NULL,
	`extraction_status` text DEFAULT 'pending' NOT NULL,
	`extraction_version` text,
	`error` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `planning_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `planning_document_assets_url_unique` ON `planning_document_assets` (`url`);--> statement-breakpoint
CREATE INDEX `planning_document_assets_document_idx` ON `planning_document_assets` (`document_id`);--> statement-breakpoint
CREATE INDEX `planning_document_assets_queue_idx` ON `planning_document_assets` (`retrieval_status`,`extraction_status`);