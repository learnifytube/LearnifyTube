ALTER TABLE `sync_devices` ADD `held_movie_ids_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_devices` ADD `held_episode_ids_json` text DEFAULT '[]' NOT NULL;