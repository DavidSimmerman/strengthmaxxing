CREATE TABLE `calibration` (
	`exerciseId` integer PRIMARY KEY NOT NULL,
	`params` text NOT NULL,
	`samples` integer DEFAULT 0 NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`exerciseId`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `motion_traces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exerciseId` integer NOT NULL,
	`setClientId` text,
	`sampleHz` real NOT NULL,
	`detectedReps` integer NOT NULL,
	`actualReps` integer NOT NULL,
	`params` text,
	`samples` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`exerciseId`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`units` text DEFAULT 'lb' NOT NULL,
	`voiceCount` integer DEFAULT true NOT NULL,
	`restAlarmSnoozeSec` integer DEFAULT 60 NOT NULL,
	`profile` text,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `exercises` ADD `isCustom` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `session_sets` ADD `clientId` text;--> statement-breakpoint
CREATE UNIQUE INDEX `session_sets_clientId_unique` ON `session_sets` (`clientId`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `clientId` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `extraExerciseIds` text;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_clientId_unique` ON `sessions` (`clientId`);