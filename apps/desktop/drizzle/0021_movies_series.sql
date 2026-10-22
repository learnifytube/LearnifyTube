CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`season_id` text NOT NULL,
	`title` text NOT NULL,
	`file_path` text NOT NULL,
	`number` integer,
	`position` integer NOT NULL,
	`duration_seconds` integer,
	`video_codec` text,
	`audio_codec` text,
	`missing` integer DEFAULT false NOT NULL,
	`position_seconds` integer,
	`watched_at` integer,
	`watch_updated_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `episodes_season_position_idx` ON `episodes` (`season_id`,`position`);--> statement-breakpoint
CREATE TABLE `movies` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source_folder` text NOT NULL,
	`file_path` text NOT NULL,
	`poster_path` text,
	`duration_seconds` integer,
	`video_codec` text,
	`audio_codec` text,
	`missing` integer DEFAULT false NOT NULL,
	`shown_on_devices` integer DEFAULT true NOT NULL,
	`sent_to_devices` integer DEFAULT false NOT NULL,
	`position_seconds` integer,
	`watched_at` integer,
	`watch_updated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`title` text NOT NULL,
	`number` integer,
	`position` integer NOT NULL,
	`sent_to_devices` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `seasons_series_position_idx` ON `seasons` (`series_id`,`position`);--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source_folder` text NOT NULL,
	`poster_path` text,
	`shown_on_devices` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
