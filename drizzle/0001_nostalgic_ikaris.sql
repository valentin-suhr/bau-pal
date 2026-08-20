PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_parcel_planning_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parcel_id` text NOT NULL,
	`zone_id` integer NOT NULL,
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
INSERT INTO `__new_parcel_planning_segments`("id", "parcel_id", "zone_id", "document_id", "legal_regime", "coverage_ratio", "intersection_area_sqm", "intersection_geojson", "precedence_rank", "is_controlling", "assignment_method", "confidence", "reviewed_at") SELECT "id", "parcel_id", "zone_id", "document_id", "legal_regime", "coverage_ratio", "intersection_area_sqm", "intersection_geojson", "precedence_rank", "is_controlling", "assignment_method", "confidence", "reviewed_at" FROM `parcel_planning_segments`;--> statement-breakpoint
DROP TABLE `parcel_planning_segments`;--> statement-breakpoint
ALTER TABLE `__new_parcel_planning_segments` RENAME TO `parcel_planning_segments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `parcel_planning_segment_unique` ON `parcel_planning_segments` (`parcel_id`,`document_id`,`zone_id`);--> statement-breakpoint
CREATE INDEX `parcel_planning_segments_parcel_idx` ON `parcel_planning_segments` (`parcel_id`);--> statement-breakpoint
CREATE INDEX `parcel_planning_segments_regime_idx` ON `parcel_planning_segments` (`legal_regime`);