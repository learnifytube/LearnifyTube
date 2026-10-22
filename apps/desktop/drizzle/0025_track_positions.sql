ALTER TABLE `audiobook_tracks` ADD `resume_seconds` integer;--> statement-breakpoint
ALTER TABLE `audiobook_tracks` ADD `played_to_end` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `audiobook_tracks` ADD `resume_updated_at` integer;--> statement-breakpoint
-- Each book's Listening position seeds its Track's Track position (ADR-0006).
UPDATE `audiobook_tracks` SET
  `resume_seconds` = (SELECT b.`listening_seconds` FROM `audiobooks` b WHERE b.`id` = `audiobook_tracks`.`audiobook_id`),
  `played_to_end` = (SELECT b.`finished` FROM `audiobooks` b WHERE b.`id` = `audiobook_tracks`.`audiobook_id`),
  `resume_updated_at` = (SELECT b.`listening_updated_at` FROM `audiobooks` b WHERE b.`id` = `audiobook_tracks`.`audiobook_id`)
WHERE `id` IN (
  SELECT b.`listening_track_id` FROM `audiobooks` b
  WHERE b.`listening_track_id` IS NOT NULL AND b.`listening_seconds` IS NOT NULL AND b.`listening_updated_at` IS NOT NULL
);--> statement-breakpoint
-- The Tracks before it in the Track order count as played to their end.
UPDATE `audiobook_tracks` SET
  `resume_seconds` = coalesce(`duration_seconds`, 0),
  `played_to_end` = 1,
  `resume_updated_at` = (SELECT b.`listening_updated_at` FROM `audiobooks` b WHERE b.`id` = `audiobook_tracks`.`audiobook_id`)
WHERE EXISTS (
  SELECT 1 FROM `audiobooks` b
  JOIN `audiobook_tracks` cur ON cur.`id` = b.`listening_track_id`
  WHERE b.`id` = `audiobook_tracks`.`audiobook_id`
    AND b.`listening_updated_at` IS NOT NULL
    AND `audiobook_tracks`.`position` < cur.`position`
);
