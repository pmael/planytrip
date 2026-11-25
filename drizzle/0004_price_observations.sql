CREATE TABLE `price_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`captured_at` text NOT NULL,
	`travel_date` text NOT NULL,
	`days_before` integer NOT NULL,
	`direction` text,
	`origin_label` text NOT NULL,
	`destination_label` text NOT NULL,
	`depart_station` text DEFAULT '' NOT NULL,
	`arrive_station` text DEFAULT '' NOT NULL,
	`depart_time` text NOT NULL,
	`arrive_time` text NOT NULL,
	`duration_min` integer,
	`changes` integer,
	`train_type` text,
	`price_2nd_eur` real NOT NULL,
	`price_1st_eur` real,
	`distance_km` integer,
	`range_min_eur` real,
	`range_max_eur` real,
	`transport_option_id` text,
	`estimate_eur` real,
	`estimate_method` text,
	`raw_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`transport_option_id`) REFERENCES `transport_options`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `price_observations_train_idx` ON `price_observations` (`travel_date`,`depart_time`);--> statement-breakpoint
CREATE UNIQUE INDEX `price_observations_once` ON `price_observations` (`source`,`travel_date`,`depart_station`,`depart_time`,`captured_at`);