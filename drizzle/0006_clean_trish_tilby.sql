CREATE TABLE `parcel_planning_lines` (
	`parcel_id` text NOT NULL,
	`line_id` integer NOT NULL,
	`relation` text NOT NULL,
	`distance_m` real NOT NULL,
	`assignment_method` text NOT NULL,
	`confidence` text NOT NULL,
	`reviewed_at` text,
	PRIMARY KEY(`parcel_id`, `line_id`),
	FOREIGN KEY (`parcel_id`) REFERENCES `parcels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`line_id`) REFERENCES `planning_line_features`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `parcel_planning_lines_parcel_idx` ON `parcel_planning_lines` (`parcel_id`);--> statement-breakpoint
CREATE TABLE `planning_line_features` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`official_id` text NOT NULL,
	`line_type` text NOT NULL,
	`official_line_type` text NOT NULL,
	`approval_kind` text,
	`approval_date` text,
	`approval_date_end` text,
	`borough` text NOT NULL,
	`geometry_geojson` text NOT NULL,
	`bbox_west` real NOT NULL,
	`bbox_south` real NOT NULL,
	`bbox_east` real NOT NULL,
	`bbox_north` real NOT NULL,
	`source_id` integer,
	`source_updated_at` text,
	`imported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `planning_line_features_official_id_unique` ON `planning_line_features` (`official_id`);--> statement-breakpoint
CREATE INDEX `planning_line_features_type_idx` ON `planning_line_features` (`line_type`);--> statement-breakpoint
CREATE INDEX `planning_line_features_bbox_idx` ON `planning_line_features` (`bbox_west`,`bbox_east`,`bbox_south`,`bbox_north`);