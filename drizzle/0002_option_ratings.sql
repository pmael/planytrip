CREATE TABLE `option_ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`stay_option_id` text,
	`transport_option_id` text,
	`verdict` text NOT NULL,
	`score` integer NOT NULL,
	`reason` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`stay_option_id`) REFERENCES `stay_options`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transport_option_id`) REFERENCES `transport_options`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "option_ratings_one_target" CHECK(("option_ratings"."stay_option_id" is not null) + ("option_ratings"."transport_option_id" is not null) = 1),
	CONSTRAINT "option_ratings_score_range" CHECK("option_ratings"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `option_ratings_one_per_stay` ON `option_ratings` (`stay_option_id`) WHERE "option_ratings"."stay_option_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `option_ratings_one_per_transport` ON `option_ratings` (`transport_option_id`) WHERE "option_ratings"."transport_option_id" is not null;--> statement-breakpoint
CREATE TABLE `rating_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`input_hash` text NOT NULL,
	`message` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rating_runs_one_per_destination_and_kind` ON `rating_runs` (`destination_id`,`kind`);