CREATE TABLE `planning_codebook_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`codebook_key` text NOT NULL,
	`code` text NOT NULL,
	`rule_type` text NOT NULL,
	`numeric_value` real,
	`text_value` text,
	`source_id` integer,
	`source_locator` text,
	`confidence` text NOT NULL,
	`review_status` text DEFAULT 'unreviewed' NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `planning_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `planning_codebook_entry_unique` ON `planning_codebook_entries` (`document_id`,`codebook_key`,`code`,`rule_type`);--> statement-breakpoint
CREATE INDEX `planning_codebook_lookup_idx` ON `planning_codebook_entries` (`codebook_key`,`code`);