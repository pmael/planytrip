CREATE TABLE `destination_syntheses` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `destination_syntheses_trip_hash` ON `destination_syntheses` (`trip_id`,`input_hash`);