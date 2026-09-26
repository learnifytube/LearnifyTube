CREATE TABLE `on_device_lists` (
	`list_id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `phone_list_items` (
	`video_id` text PRIMARY KEY NOT NULL,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`offline_video_ids_json` text NOT NULL,
	`last_seen_at` integer NOT NULL
);
