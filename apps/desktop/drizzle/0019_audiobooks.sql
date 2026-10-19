CREATE TABLE `audiobook_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`audiobook_id` text NOT NULL,
	`file_path` text NOT NULL,
	`position` integer NOT NULL,
	`duration_seconds` integer,
	`missing` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`audiobook_id`) REFERENCES `audiobooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audiobook_tracks_book_position_idx` ON `audiobook_tracks` (`audiobook_id`,`position`);--> statement-breakpoint
CREATE TABLE `audiobooks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`source_folder` text NOT NULL,
	`cover_path` text,
	`sent_to_devices` integer DEFAULT false NOT NULL,
	`listening_track_id` text,
	`listening_seconds` integer,
	`listening_updated_at` integer,
	`finished` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
