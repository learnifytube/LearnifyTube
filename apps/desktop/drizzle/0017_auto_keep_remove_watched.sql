CREATE TABLE `auto_keep_list_items` (
	`list_id` text NOT NULL,
	`video_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`list_id`, `video_id`)
);
--> statement-breakpoint
CREATE INDEX `auto_keep_list_items_video_id_idx` ON `auto_keep_list_items` (`video_id`);--> statement-breakpoint
ALTER TABLE `channels` ADD `auto_keep_remove_watched` integer DEFAULT false NOT NULL;