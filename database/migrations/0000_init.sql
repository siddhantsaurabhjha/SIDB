CREATE TABLE `backup_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`kind` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bookmark_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bookmark_folders_parent_idx` ON `bookmark_folders` (`parent_id`);--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`favicon` text,
	`pinned` integer DEFAULT false NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `bookmark_folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bookmarks_folder_idx` ON `bookmarks` (`folder_id`);--> statement-breakpoint
CREATE INDEX `bookmarks_url_idx` ON `bookmarks` (`url`);--> statement-breakpoint
CREATE TABLE `browser_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custom_shortcuts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `download_records` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`save_path` text NOT NULL,
	`source_url` text NOT NULL,
	`mime_type` text,
	`total_bytes` integer DEFAULT 0 NOT NULL,
	`received_bytes` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL,
	`risk_warning` text,
	`started_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `downloads_started_idx` ON `download_records` (`started_at`);--> statement-breakpoint
CREATE TABLE `history_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`favicon` text,
	`visit_count` integer DEFAULT 1 NOT NULL,
	`last_visit` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `history_url_uq` ON `history_entries` (`url`);--> statement-breakpoint
CREATE INDEX `history_last_visit_idx` ON `history_entries` (`last_visit`);--> statement-breakpoint
CREATE TABLE `recently_closed_tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`closed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recently_closed_at_idx` ON `recently_closed_tabs` (`closed_at`);--> statement-breakpoint
CREATE TABLE `session_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`zoom` real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_permission_settings` (
	`origin` text NOT NULL,
	`kind` text NOT NULL,
	`decision` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_permission_uq` ON `site_permission_settings` (`origin`,`kind`);