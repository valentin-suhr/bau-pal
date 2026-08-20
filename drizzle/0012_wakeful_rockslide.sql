CREATE TABLE `heritage_features` (
	`official_id` text PRIMARY KEY NOT NULL,
	`gis_id` text NOT NULL,
	`monument_type` text NOT NULL,
	`detail_url` text,
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
CREATE INDEX `heritage_features_type_idx` ON `heritage_features` (`monument_type`);--> statement-breakpoint
CREATE INDEX `heritage_features_bbox_west_east_idx` ON `heritage_features` (`bbox_west`,`bbox_east`);--> statement-breakpoint
CREATE INDEX `heritage_features_bbox_south_north_idx` ON `heritage_features` (`bbox_south`,`bbox_north`);--> statement-breakpoint
CREATE TABLE `parcel_heritage_constraints` (
	`parcel_id` text NOT NULL,
	`heritage_id` text NOT NULL,
	`relation` text NOT NULL,
	`distance_m` real NOT NULL,
	`assignment_method` text DEFAULT 'official_geometry_spatial_cross_reference_v1' NOT NULL,
	`reviewed_at` text,
	PRIMARY KEY(`parcel_id`, `heritage_id`),
	FOREIGN KEY (`parcel_id`) REFERENCES `parcels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`heritage_id`) REFERENCES `heritage_features`(`official_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `parcel_heritage_constraints_parcel_idx` ON `parcel_heritage_constraints` (`parcel_id`);--> statement-breakpoint
CREATE INDEX `parcel_heritage_constraints_relation_idx` ON `parcel_heritage_constraints` (`relation`,`parcel_id`);