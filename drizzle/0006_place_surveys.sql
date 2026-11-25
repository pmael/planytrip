CREATE TABLE `place_surveys` (
	`id` text PRIMARY KEY NOT NULL,
	`destination_id` text NOT NULL,
	`stay_option_id` text NOT NULL,
	`facts_json` text NOT NULL,
	`source` text NOT NULL,
	`surveyed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`stay_option_id`) REFERENCES `stay_options`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `place_surveys_one_per_stay` ON `place_surveys` (`stay_option_id`);--> statement-breakpoint
CREATE INDEX `place_surveys_destination_idx` ON `place_surveys` (`destination_id`);