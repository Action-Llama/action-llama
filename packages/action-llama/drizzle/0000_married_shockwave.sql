CREATE TABLE `call_edges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`caller_agent` text NOT NULL,
	`caller_instance` text NOT NULL,
	`target_agent` text NOT NULL,
	`target_instance` text,
	`depth` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`duration_ms` integer,
	`status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_calls_caller` ON `call_edges` (`caller_agent`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_calls_target` ON `call_edges` (`target_agent`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_calls_target_instance` ON `call_edges` (`target_instance`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`stream` text NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`metadata` text,
	`timestamp` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`sequence` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_stream` ON `events` (`stream`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_events_type` ON `events` (`stream`,`type`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_events_timestamp` ON `events` (`stream`,`timestamp`);--> statement-breakpoint
CREATE TABLE `kv_store` (
	`namespace` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`namespace`, `key`)
);
--> statement-breakpoint
CREATE INDEX `idx_kv_expires` ON `kv_store` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_kv_namespace` ON `kv_store` (`namespace`);--> statement-breakpoint
CREATE TABLE `queue` (
	`id` text NOT NULL,
	`name` text NOT NULL,
	`payload` text NOT NULL,
	`enqueued_at` integer NOT NULL,
	PRIMARY KEY(`name`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_queue_name` ON `queue` (`name`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` text NOT NULL,
	`agent_name` text NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger_source` text,
	`result` text NOT NULL,
	`exit_code` integer,
	`started_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`pre_hook_ms` integer,
	`post_hook_ms` integer,
	`webhook_receipt_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_runs_agent` ON `runs` (`agent_name`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_runs_started` ON `runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`stream` text NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`event_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`stream`, `type`)
);
--> statement-breakpoint
CREATE INDEX `idx_snapshots_stream` ON `snapshots` (`stream`);--> statement-breakpoint
CREATE TABLE `state` (
	`ns` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer,
	PRIMARY KEY(`ns`, `key`)
);
--> statement-breakpoint
CREATE INDEX `idx_state_expires` ON `state` (`expires_at`);--> statement-breakpoint
CREATE TABLE `webhook_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`delivery_id` text,
	`source` text NOT NULL,
	`event_summary` text,
	`timestamp` integer NOT NULL,
	`headers` text,
	`body` text,
	`matched_agents` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`dead_letter_reason` text
);
--> statement-breakpoint
CREATE INDEX `idx_wr_timestamp` ON `webhook_receipts` (`timestamp`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_wr_delivery` ON `webhook_receipts` (`delivery_id`);--> statement-breakpoint
CREATE TABLE `work_queue` (
	`id` text NOT NULL,
	`agent` text NOT NULL,
	`payload` text NOT NULL,
	`received_at` integer NOT NULL,
	PRIMARY KEY(`agent`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_wq_agent` ON `work_queue` (`agent`);