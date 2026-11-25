CREATE TABLE `destination_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`destination_id` text NOT NULL,
	`prices_json` text NOT NULL,
	`source` text NOT NULL,
	`input_hash` text NOT NULL,
	`message` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `destination_prices_destination_id_unique` ON `destination_prices` (`destination_id`);--> statement-breakpoint
CREATE TABLE `extra_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`destination_id` text NOT NULL,
	`rank` integer NOT NULL,
	`objective` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`price_eur` real NOT NULL,
	`duration_h` real,
	`note` text,
	`map_name` text NOT NULL,
	`lat` real,
	`lon` real,
	`source` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `extra_activities_destination_idx` ON `extra_activities` (`destination_id`,`rank`);