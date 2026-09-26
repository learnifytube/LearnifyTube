ALTER TABLE `channels` ADD `subscribed_at` integer;--> statement-breakpoint
-- Every Channel known before Subscriptions became explicit counted as one: keep it that way
UPDATE `channels` SET `subscribed_at` = `created_at`;
