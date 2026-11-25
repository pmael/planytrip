CREATE TABLE `extra_advice` (
	`id` text PRIMARY KEY NOT NULL,
	`destination_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`source` text NOT NULL,
	`input_hash` text NOT NULL,
	`message` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extra_advice_destination_id_unique` ON `extra_advice` (`destination_id`);