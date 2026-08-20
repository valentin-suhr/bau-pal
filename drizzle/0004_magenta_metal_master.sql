CREATE TABLE `parcel_planning_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parcel_id` text NOT NULL,
	`document_id` integer,
	`observation_type` text NOT NULL,
	`numeric_value` real,
	`text_value` text,
	`extraction_method` text NOT NULL,
	`confidence` text NOT NULL,
	`review_status` text DEFAULT 'unreviewed' NOT NULL,
	`source_id` integer,
	`source_locator` text,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`observed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`parcel_id`) REFERENCES `parcels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `planning_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `parcel_planning_observations_parcel_idx` ON `parcel_planning_observations` (`parcel_id`);--> statement-breakpoint
CREATE INDEX `parcel_planning_observations_type_idx` ON `parcel_planning_observations` (`observation_type`,`confidence`);--> statement-breakpoint
ALTER TABLE `parcel_development_profiles` ADD `legal_basis` text DEFAULT 'unresolved' NOT NULL;