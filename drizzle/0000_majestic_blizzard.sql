CREATE TABLE `import_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dataset` text NOT NULL,
	`source_url` text NOT NULL,
	`source_version` text,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`finished_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`records_read` integer DEFAULT 0 NOT NULL,
	`records_written` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `parcel_addresses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parcel_id` text NOT NULL,
	`street` text NOT NULL,
	`house_number` text,
	`postcode` text,
	`city` text DEFAULT 'Berlin' NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`source_id` integer,
	FOREIGN KEY (`parcel_id`) REFERENCES `parcels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parcel_addresses_unique` ON `parcel_addresses` (`parcel_id`,`street`,`house_number`);--> statement-breakpoint
CREATE INDEX `parcel_addresses_street_idx` ON `parcel_addresses` (`street`,`house_number`);--> statement-breakpoint
CREATE TABLE `parcel_development_profiles` (
	`parcel_id` text PRIMARY KEY NOT NULL,
	`primary_regime` text NOT NULL,
	`controlling_plan_keys_json` text DEFAULT '[]' NOT NULL,
	`permitted_uses_json` text DEFAULT '[]' NOT NULL,
	`legal_grz` real,
	`legal_gfz` real,
	`legal_bmz` real,
	`legal_storeys_min` integer,
	`legal_storeys_max` integer,
	`legal_height_max_m` real,
	`building_form` text,
	`building_depth_m` real,
	`roof_rules` text,
	`other_constraints_json` text DEFAULT '[]' NOT NULL,
	`observed_context_grz` real,
	`observed_context_gfz_min` real,
	`observed_context_gfz_max` real,
	`observed_context_storeys_min` integer,
	`observed_context_storeys_max` integer,
	`max_principal_footprint_sqm` real,
	`max_legal_floor_area_sqm` real,
	`resolution_confidence` text NOT NULL,
	`review_status` text DEFAULT 'unreviewed' NOT NULL,
	`unresolved_fields_json` text DEFAULT '[]' NOT NULL,
	`resolved_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`notes` text,
	FOREIGN KEY (`parcel_id`) REFERENCES `parcels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `parcel_profiles_regime_idx` ON `parcel_development_profiles` (`primary_regime`);--> statement-breakpoint
CREATE INDEX `parcel_profiles_confidence_idx` ON `parcel_development_profiles` (`resolution_confidence`,`review_status`);--> statement-breakpoint
CREATE INDEX `parcel_profiles_grz_gfz_idx` ON `parcel_development_profiles` (`legal_grz`,`legal_gfz`);--> statement-breakpoint
CREATE TABLE `parcel_planning_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parcel_id` text NOT NULL,
	`zone_id` integer,
	`document_id` integer NOT NULL,
	`legal_regime` text NOT NULL,
	`coverage_ratio` real NOT NULL,
	`intersection_area_sqm` real NOT NULL,
	`intersection_geojson` text,
	`precedence_rank` integer DEFAULT 0 NOT NULL,
	`is_controlling` integer DEFAULT false NOT NULL,
	`assignment_method` text NOT NULL,
	`confidence` text NOT NULL,
	`reviewed_at` text,
	FOREIGN KEY (`parcel_id`) REFERENCES `parcels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `planning_zones`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `planning_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parcel_planning_segment_unique` ON `parcel_planning_segments` (`parcel_id`,`document_id`,`zone_id`);--> statement-breakpoint
CREATE INDEX `parcel_planning_segments_parcel_idx` ON `parcel_planning_segments` (`parcel_id`);--> statement-breakpoint
CREATE INDEX `parcel_planning_segments_regime_idx` ON `parcel_planning_segments` (`legal_regime`);--> statement-breakpoint
CREATE TABLE `parcels` (
	`id` text PRIMARY KEY NOT NULL,
	`alkis_uuid` text NOT NULL,
	`numerator` text NOT NULL,
	`denominator` text,
	`cadastral_district_code` text NOT NULL,
	`cadastral_district` text NOT NULL,
	`flur` text NOT NULL,
	`borough` text NOT NULL,
	`locality` text,
	`area_sqm` real NOT NULL,
	`centroid_lng` real NOT NULL,
	`centroid_lat` real NOT NULL,
	`bbox_west` real NOT NULL,
	`bbox_south` real NOT NULL,
	`bbox_east` real NOT NULL,
	`bbox_north` real NOT NULL,
	`geometry_geojson` text NOT NULL,
	`source_id` integer,
	`source_feature_timestamp` text,
	`imported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parcels_alkis_uuid_unique` ON `parcels` (`alkis_uuid`);--> statement-breakpoint
CREATE INDEX `parcels_borough_idx` ON `parcels` (`borough`);--> statement-breakpoint
CREATE INDEX `parcels_centroid_idx` ON `parcels` (`centroid_lng`,`centroid_lat`);--> statement-breakpoint
CREATE INDEX `parcels_bbox_west_east_idx` ON `parcels` (`bbox_west`,`bbox_east`);--> statement-breakpoint
CREATE INDEX `parcels_bbox_south_north_idx` ON `parcels` (`bbox_south`,`bbox_north`);--> statement-breakpoint
CREATE TABLE `planning_document_relations` (
	`from_document_id` integer NOT NULL,
	`to_document_id` integer NOT NULL,
	`relation` text NOT NULL,
	`notes` text,
	PRIMARY KEY(`from_document_id`, `to_document_id`, `relation`),
	FOREIGN KEY (`from_document_id`) REFERENCES `planning_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_document_id`) REFERENCES `planning_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `planning_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plan_key` text NOT NULL,
	`title` text NOT NULL,
	`plan_type` text NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`borough` text,
	`effective_from` text,
	`effective_to` text,
	`source_id` integer,
	`notes` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `planning_documents_plan_key_unique` ON `planning_documents` (`plan_key`);--> statement-breakpoint
CREATE INDEX `planning_documents_borough_idx` ON `planning_documents` (`borough`);--> statement-breakpoint
CREATE TABLE `planning_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`zone_id` integer,
	`rule_type` text NOT NULL,
	`numeric_value` real,
	`text_value` text,
	`unit` text,
	`legal_citation` text,
	`interpretation` text,
	`extraction_method` text NOT NULL,
	`confidence` text NOT NULL,
	`review_status` text DEFAULT 'unreviewed' NOT NULL,
	`source_id` integer,
	`source_locator` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `planning_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `planning_zones`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `planning_rules_document_idx` ON `planning_rules` (`document_id`);--> statement-breakpoint
CREATE INDEX `planning_rules_zone_type_idx` ON `planning_rules` (`zone_id`,`rule_type`);--> statement-breakpoint
CREATE TABLE `planning_zones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`zone_key` text NOT NULL,
	`label` text,
	`geometry_geojson` text NOT NULL,
	`bbox_west` real NOT NULL,
	`bbox_south` real NOT NULL,
	`bbox_east` real NOT NULL,
	`bbox_north` real NOT NULL,
	`geometry_method` text NOT NULL,
	`confidence` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `planning_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `planning_zones_document_zone_unique` ON `planning_zones` (`document_id`,`zone_key`);--> statement-breakpoint
CREATE INDEX `planning_zones_bbox_west_east_idx` ON `planning_zones` (`bbox_west`,`bbox_east`);--> statement-breakpoint
CREATE INDEX `planning_zones_bbox_south_north_idx` ON `planning_zones` (`bbox_south`,`bbox_north`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_key` text NOT NULL,
	`title` text NOT NULL,
	`publisher` text NOT NULL,
	`source_type` text NOT NULL,
	`url` text NOT NULL,
	`licence` text,
	`effective_from` text,
	`effective_to` text,
	`retrieved_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_source_key_unique` ON `sources` (`source_key`);