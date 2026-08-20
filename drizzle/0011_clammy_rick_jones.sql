CREATE TABLE `planning_document_zone_reviews` (
	`document_id` integer PRIMARY KEY NOT NULL,
	`source_asset_id` integer,
	`trace_version` text NOT NULL,
	`scope_partition_complete` integer DEFAULT false NOT NULL,
	`land_use_complete` integer DEFAULT false NOT NULL,
	`density_complete` integer DEFAULT false NOT NULL,
	`height_complete` integer DEFAULT false NOT NULL,
	`building_form_complete` integer DEFAULT false NOT NULL,
	`other_constraints_complete` integer DEFAULT false NOT NULL,
	`review_status` text DEFAULT 'machine_checked' NOT NULL,
	`notes_json` text DEFAULT '{}' NOT NULL,
	`reviewed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `planning_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_asset_id`) REFERENCES `planning_document_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `planning_document_zone_review_status_idx` ON `planning_document_zone_reviews` (`review_status`);