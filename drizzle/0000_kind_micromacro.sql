CREATE TABLE `destinations` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`label` text NOT NULL,
	`country_code` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`airports_json` text DEFAULT '[]' NOT NULL,
	`in_scope` integer DEFAULT true NOT NULL,
	`budget_level` text DEFAULT 'medium' NOT NULL,
	`objective` text DEFAULT 'none' NOT NULL,
	`date_from` text,
	`date_to` text,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `destinations_trip_idx` ON `destinations` (`trip_id`);--> statement-breakpoint
CREATE TABLE `geo_cache` (
	`query` text PRIMARY KEY NOT NULL,
	`place_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `guest_modes` (
	`guest_id` text NOT NULL,
	`mode` text NOT NULL,
	PRIMARY KEY(`guest_id`, `mode`),
	FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `guests` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`name` text NOT NULL,
	`home_label` text NOT NULL,
	`home_lat` real NOT NULL,
	`home_lon` real NOT NULL,
	`home_airports_json` text DEFAULT '[]' NOT NULL,
	`origin_key` text NOT NULL,
	`max_budget_eur` integer NOT NULL,
	`available_from` text NOT NULL,
	`available_to` text NOT NULL,
	`preferred_mode` text NOT NULL,
	`favorite_destination_id` text,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`favorite_destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "guests_budget_positive" CHECK("guests"."max_budget_eur" > 0),
	CONSTRAINT "guests_dates_ordered" CHECK("guests"."available_to" >= "guests"."available_from")
);
--> statement-breakpoint
CREATE INDEX `guests_trip_idx` ON `guests` (`trip_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress_json` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_queue_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE TABLE `route_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`destination_id` text NOT NULL,
	`origin_key` text NOT NULL,
	`mode` text NOT NULL,
	`reachable` integer NOT NULL,
	`reason` text,
	`distance_km` integer,
	`duration_min` integer,
	`checked_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `route_checks_unique` ON `route_checks` (`destination_id`,`origin_key`,`mode`);--> statement-breakpoint
CREATE TABLE `scrape_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`payload_json` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scrape_cache_expires_idx` ON `scrape_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `selections` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`kind` text NOT NULL,
	`guest_id` text,
	`transport_option_id` text,
	`stay_option_id` text,
	`reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transport_option_id`) REFERENCES `transport_options`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`stay_option_id`) REFERENCES `stay_options`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "selections_kind_target" CHECK(("selections"."kind" = 'transport' and "selections"."guest_id" is not null and "selections"."transport_option_id" is not null and "selections"."stay_option_id" is null)
        or ("selections"."kind" = 'stay' and "selections"."stay_option_id" is not null and "selections"."transport_option_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `selections_one_stay_per_destination` ON `selections` (`destination_id`,`kind`) WHERE "selections"."kind" = 'stay';--> statement-breakpoint
CREATE UNIQUE INDEX `selections_one_transport_per_guest` ON `selections` (`destination_id`,`kind`,`guest_id`) WHERE "selections"."kind" = 'transport';--> statement-breakpoint
CREATE TABLE `stay_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`stay_id` text NOT NULL,
	`verdict` text NOT NULL,
	`fit_score` integer NOT NULL,
	`pros_json` text DEFAULT '[]' NOT NULL,
	`cons_json` text DEFAULT '[]' NOT NULL,
	`summary` text NOT NULL,
	`input_hash` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`stay_id`) REFERENCES `stay_options`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stay_analyses_stay_id_unique` ON `stay_analyses` (`stay_id`);--> statement-breakpoint
CREATE TABLE `stay_options` (
	`id` text PRIMARY KEY NOT NULL,
	`destination_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text,
	`title` text NOT NULL,
	`photos_json` text DEFAULT '[]' NOT NULL,
	`capacity` integer NOT NULL,
	`rooms` integer,
	`beds` integer,
	`check_in` text NOT NULL,
	`check_out` text NOT NULL,
	`total_price_eur` integer NOT NULL,
	`rating` real,
	`reviews_sample_json` text,
	`url` text,
	`raw_json` text,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stay_options_price_idx` ON `stay_options` (`destination_id`,`total_price_eur`);--> statement-breakpoint
CREATE TABLE `summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`total_eur` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `transport_options` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`origin_key` text NOT NULL,
	`mode` text NOT NULL,
	`provider` text NOT NULL,
	`variant` text DEFAULT 'standard' NOT NULL,
	`out_depart_at` text,
	`out_arrive_at` text,
	`back_depart_at` text,
	`back_arrive_at` text,
	`out_duration_min` integer,
	`back_duration_min` integer,
	`stops` integer,
	`price_eur` integer NOT NULL,
	`price_unit` text NOT NULL,
	`last_mile_eur` integer DEFAULT 0 NOT NULL,
	`comfort_score` integer,
	`comfort_level` text,
	`url` text,
	`raw_json` text,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "transport_options_comfort_score_range" CHECK("transport_options"."comfort_score" is null or "transport_options"."comfort_score" between 0 and 100)
);
--> statement-breakpoint
CREATE INDEX `transport_options_search_idx` ON `transport_options` (`destination_id`,`origin_key`,`mode`);--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`nights` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
