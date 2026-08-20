CREATE TABLE `planning_zone_geometry_reviews` (
	`zone_id` integer PRIMARY KEY NOT NULL,
	`source_asset_id` integer,
	`source_page` integer DEFAULT 1 NOT NULL,
	`trace_version` text NOT NULL,
	`render_json` text NOT NULL,
	`control_points_json` text NOT NULL,
	`transform_json` text NOT NULL,
	`residuals_json` text NOT NULL,
	`rms_residual_m` real NOT NULL,
	`max_residual_m` real NOT NULL,
	`review_status` text DEFAULT 'machine_checked' NOT NULL,
	`reviewed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `planning_zones`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_asset_id`) REFERENCES `planning_document_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `planning_zone_geometry_review_asset_idx` ON `planning_zone_geometry_reviews` (`source_asset_id`);--> statement-breakpoint
CREATE INDEX `planning_zone_geometry_review_status_idx` ON `planning_zone_geometry_reviews` (`review_status`,`rms_residual_m`);