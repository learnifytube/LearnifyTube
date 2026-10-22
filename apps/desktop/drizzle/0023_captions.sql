CREATE TABLE `captions` (
	`id` text PRIMARY KEY NOT NULL,
	`movie_id` text,
	`episode_id` text,
	`file_path` text NOT NULL,
	`language` text,
	`label` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `captions_movie_idx` ON `captions` (`movie_id`);--> statement-breakpoint
CREATE INDEX `captions_episode_idx` ON `captions` (`episode_id`);