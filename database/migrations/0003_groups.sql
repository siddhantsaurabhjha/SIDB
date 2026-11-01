CREATE TABLE `session_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`collapsed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE `session_metadata` ADD `group_id` text;