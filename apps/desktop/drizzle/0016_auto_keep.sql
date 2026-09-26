CREATE TABLE `auto_keep_considered` (
	`channel_id` text NOT NULL,
	`video_id` text NOT NULL,
	`considered_at` integer NOT NULL,
	PRIMARY KEY(`channel_id`, `video_id`)
);
--> statement-breakpoint
ALTER TABLE `channels` ADD `auto_keep_since` integer;--> statement-breakpoint
ALTER TABLE `channels` ADD `auto_keep_list_id` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `auto_keep_checked_at` integer;--> statement-breakpoint
ALTER TABLE `channels` ADD `auto_keep_check_failed` integer;