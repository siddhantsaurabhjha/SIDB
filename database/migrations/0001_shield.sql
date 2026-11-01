CREATE TABLE `shield_exceptions` (
	`host` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shield_stats` (
	`day` integer PRIMARY KEY NOT NULL,
	`blocked` integer DEFAULT 0 NOT NULL,
	`popups` integer DEFAULT 0 NOT NULL
);
