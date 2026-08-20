CREATE TABLE `parcel_jurisdiction_contexts` (
	`parcel_id` text PRIMARY KEY NOT NULL,
	`locality` text,
	`historical_sector` text NOT NULL,
	`workflow` text NOT NULL,
	`reason` text NOT NULL,
	`assignment_method` text NOT NULL,
	`confidence` text NOT NULL,
	`source_id` integer,
	`source_locator` text,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`reviewed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`parcel_id`) REFERENCES `parcels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `parcel_jurisdiction_workflow_idx` ON `parcel_jurisdiction_contexts` (`workflow`,`confidence`);--> statement-breakpoint
CREATE INDEX `parcel_jurisdiction_sector_idx` ON `parcel_jurisdiction_contexts` (`historical_sector`);