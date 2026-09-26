ALTER TABLE `video_watch_stats` ADD `watched_at` integer;--> statement-breakpoint
ALTER TABLE `youtube_videos` ADD `kept_at` integer;--> statement-breakpoint
UPDATE `youtube_videos` SET `kept_at` = COALESCE(`last_downloaded_at`, `updated_at`, `created_at`) WHERE `download_status` IS NOT NULL AND `download_status` != 'cancelled';--> statement-breakpoint
UPDATE `video_watch_stats` SET `watched_at` = COALESCE(`last_watched_at`, `updated_at`, `created_at`) WHERE `video_id` IN (SELECT `video_id` FROM `youtube_videos` WHERE `duration_seconds` > 0 AND `video_watch_stats`.`last_position_seconds` >= `duration_seconds` * 0.9);
