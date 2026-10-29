CREATE TABLE `coach_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`facts` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`dismissedAt` integer
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `chat` text;