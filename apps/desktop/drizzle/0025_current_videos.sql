CREATE TABLE `collection_current_videos` (
	`collection_kind` text NOT NULL,
	`collection_id` text NOT NULL,
	`video_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`collection_kind`, `collection_id`)
);
--> statement-breakpoint
-- Each List's slot becomes the Video in that slot; a slot past the end becomes nothing.
INSERT INTO `collection_current_videos` (`collection_kind`, `collection_id`, `video_id`, `updated_at`)
SELECT 'list', p.`id`, i.`video_id`, COALESCE(p.`updated_at`, p.`last_viewed_at`, p.`created_at`)
FROM `custom_playlists` p
JOIN (
	SELECT `playlist_id`, `video_id`,
		ROW_NUMBER() OVER (PARTITION BY `playlist_id` ORDER BY `position`) - 1 AS `slot`
	FROM `custom_playlist_items`
) i ON i.`playlist_id` = p.`id` AND i.`slot` = p.`current_video_index`;
--> statement-breakpoint
-- Each YouTube playlist's slot likewise.
INSERT INTO `collection_current_videos` (`collection_kind`, `collection_id`, `video_id`, `updated_at`)
SELECT 'youtube_playlist', p.`playlist_id`, i.`video_id`, COALESCE(p.`updated_at`, p.`last_viewed_at`, p.`created_at`)
FROM `channel_playlists` p
JOIN (
	SELECT `playlist_id`, `video_id`,
		ROW_NUMBER() OVER (PARTITION BY `playlist_id` ORDER BY `position`) - 1 AS `slot`
	FROM `playlist_items`
) i ON i.`playlist_id` = p.`playlist_id` AND i.`slot` = p.`current_video_index`;
--> statement-breakpoint
ALTER TABLE `channel_playlists` DROP COLUMN `current_video_index`;--> statement-breakpoint
ALTER TABLE `custom_playlists` DROP COLUMN `current_video_index`;
