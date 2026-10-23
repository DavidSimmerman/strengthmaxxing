ALTER TABLE `session_sets` ADD `side` text;--> statement-breakpoint
ALTER TABLE `workout_exercises` ADD `perSide` integer DEFAULT false NOT NULL;