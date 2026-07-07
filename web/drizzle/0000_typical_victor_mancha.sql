CREATE TABLE `exercises` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`muscle` text NOT NULL,
	`category` text DEFAULT 'barbell' NOT NULL,
	`met` real DEFAULT 5 NOT NULL,
	`isBodyweight` integer DEFAULT false NOT NULL,
	`defaultRestSec` integer DEFAULT 120 NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_name_unique` ON `exercises` (`name`);--> statement-breakpoint
CREATE TABLE `readiness` (
	`date` text PRIMARY KEY NOT NULL,
	`sleepHours` real,
	`kcalBalance` real,
	`proteinG` real,
	`sorenessNote` text,
	`hrvMs` real,
	`restingHr` integer,
	`score` integer,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rep_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sessionSetId` integer NOT NULL,
	`repIndex` integer NOT NULL,
	`offsetMs` integer NOT NULL,
	`concentricMs` integer,
	FOREIGN KEY (`sessionSetId`) REFERENCES `session_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sessionId` integer NOT NULL,
	`exerciseId` integer NOT NULL,
	`setIndex` integer DEFAULT 0 NOT NULL,
	`supersetGroup` integer,
	`reps` integer DEFAULT 0 NOT NULL,
	`weightKg` real DEFAULT 0 NOT NULL,
	`rpe` real,
	`isWarmup` integer DEFAULT false NOT NULL,
	`restSecActual` integer,
	`startedAt` integer,
	`completedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exerciseId`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workoutId` integer,
	`name` text DEFAULT 'Workout' NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`startedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`endedAt` integer,
	`notes` text,
	`bodyweightKg` real,
	`readinessScore` integer,
	`totalVolumeKg` real DEFAULT 0 NOT NULL,
	`estimatedKcal` real DEFAULT 0 NOT NULL,
	`exportedAt` integer,
	FOREIGN KEY (`workoutId`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `workout_exercises` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workoutId` integer NOT NULL,
	`exerciseId` integer NOT NULL,
	`orderIndex` integer DEFAULT 0 NOT NULL,
	`supersetGroup` integer,
	`targetSets` integer DEFAULT 3 NOT NULL,
	`targetReps` integer DEFAULT 8 NOT NULL,
	`targetWeightKg` real DEFAULT 0 NOT NULL,
	`restSec` integer DEFAULT 120 NOT NULL,
	FOREIGN KEY (`workoutId`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exerciseId`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`archived` integer DEFAULT false NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL
);
