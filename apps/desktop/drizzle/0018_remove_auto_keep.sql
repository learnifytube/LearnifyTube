DROP TABLE `auto_keep_considered`;--> statement-breakpoint
DROP TABLE `auto_keep_list_items`;--> statement-breakpoint
ALTER TABLE `channels` DROP COLUMN `auto_keep_since`;--> statement-breakpoint
ALTER TABLE `channels` DROP COLUMN `auto_keep_list_id`;--> statement-breakpoint
ALTER TABLE `channels` DROP COLUMN `auto_keep_checked_at`;--> statement-breakpoint
ALTER TABLE `channels` DROP COLUMN `auto_keep_check_failed`;--> statement-breakpoint
ALTER TABLE `channels` DROP COLUMN `auto_keep_remove_watched`;