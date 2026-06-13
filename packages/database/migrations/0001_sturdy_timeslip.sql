CREATE TYPE "public"."announcement_status" AS ENUM('draft', 'scheduled', 'sent', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."audit_severity" AS ENUM('info', 'notice', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."automod_action" AS ENUM('log_only', 'delete', 'warn', 'timeout', 'mute', 'kick', 'ban');--> statement-breakpoint
CREATE TYPE "public"."automod_rule_type" AS ENUM('banned_words', 'spam', 'repeated_messages', 'mention_spam', 'caps', 'invite_links', 'suspicious_links', 'attachments', 'new_account', 'raid');--> statement-breakpoint
CREATE TYPE "public"."custom_command_response_type" AS ENUM('text', 'embed', 'random', 'link');--> statement-breakpoint
CREATE TYPE "public"."moderation_case_status" AS ENUM('open', 'resolved', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."role_menu_mode" AS ENUM('multiple', 'single', 'toggle', 'add_only', 'remove_only', 'unique');--> statement-breakpoint
CREATE TYPE "public"."role_menu_type" AS ENUM('reaction', 'button', 'select');--> statement-breakpoint
CREATE TYPE "public"."schedule_type" AS ENUM('once', 'interval', 'daily', 'weekly', 'monthly', 'cron');--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"format" text DEFAULT 'plain' NOT NULL,
	"target_channel_id" text,
	"image_url" text,
	"card_template_id" uuid,
	"embed_color" text,
	"footer" text,
	"mention_mode" text DEFAULT 'none' NOT NULL,
	"mention_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"buttons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "announcement_status" DEFAULT 'draft' NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"sent_message_id" text,
	"failure_reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automod_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rule_type" "automod_rule_type" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action" "automod_action" DEFAULT 'log_only' NOT NULL,
	"severity" integer DEFAULT 1 NOT NULL,
	"ignored_channel_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ignored_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"escalation_threshold" integer,
	"escalation_action" "automod_action",
	"response_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automod_violations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" uuid NOT NULL,
	"rule_id" uuid,
	"user_external_id" text NOT NULL,
	"channel_id" text,
	"rule_type" "automod_rule_type" NOT NULL,
	"action_taken" "automod_action" NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "birthday_announcements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" uuid NOT NULL,
	"user_external_id" text NOT NULL,
	"announced_on" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "birthday_settings" (
	"guild_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"announcement_channel_id" text,
	"message" text DEFAULT '🎉 Happy birthday {{user.mention}}!' NOT NULL,
	"card_template_id" uuid,
	"role_enabled" boolean DEFAULT false NOT NULL,
	"role_id" text,
	"role_duration_hours" integer DEFAULT 24 NOT NULL,
	"announce_hour" integer DEFAULT 9 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "birthdays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"user_external_id" text NOT NULL,
	"month" integer NOT NULL,
	"day" integer NOT NULL,
	"year" integer,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"visibility" text DEFAULT 'members' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid,
	"storage_path" text NOT NULL,
	"original_name" text DEFAULT '' NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid,
	"name" text NOT NULL,
	"kind" text DEFAULT 'generic' NOT NULL,
	"width" integer DEFAULT 1000 NOT NULL,
	"height" integer DEFAULT 420 NOT NULL,
	"layout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"background_asset_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"response_type" "custom_command_response_type" DEFAULT 'text' NOT NULL,
	"response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allowed_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_channel_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cooldown_seconds" integer DEFAULT 0 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"case_number" integer NOT NULL,
	"action_type" "moderation_action_type" NOT NULL,
	"target_user_external_id" text NOT NULL,
	"moderator_external_id" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" "moderation_case_status" DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_settings" (
	"guild_id" uuid PRIMARY KEY NOT NULL,
	"log_channel_id" text,
	"mute_strategy" text DEFAULT 'timeout' NOT NULL,
	"mute_role_id" text,
	"dm_on_action" boolean DEFAULT true NOT NULL,
	"command_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid,
	"user_external_id" text NOT NULL,
	"delivery_type" text DEFAULT 'dm' NOT NULL,
	"channel_id" text,
	"message" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"recurrence_seconds" integer,
	"mention_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_assignment_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" uuid NOT NULL,
	"menu_id" uuid,
	"user_external_id" text NOT NULL,
	"role_id" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_menu_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_id" uuid NOT NULL,
	"role_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"emoji" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "role_menu_type" DEFAULT 'button' NOT NULL,
	"mode" "role_menu_mode" DEFAULT 'multiple' NOT NULL,
	"channel_id" text,
	"message_id" text,
	"style" text DEFAULT 'embed' NOT NULL,
	"title" text DEFAULT 'Select your roles' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_message_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"scheduled_message_id" uuid NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"channel_id" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"format" text DEFAULT 'plain' NOT NULL,
	"embed_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mention_mode" text DEFAULT 'none' NOT NULL,
	"mention_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"schedule_type" "schedule_type" DEFAULT 'once' NOT NULL,
	"schedule_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"paused" boolean DEFAULT false NOT NULL,
	"last_failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "welcome_settings" (
	"guild_id" uuid PRIMARY KEY NOT NULL,
	"welcome_enabled" boolean DEFAULT false NOT NULL,
	"leave_enabled" boolean DEFAULT false NOT NULL,
	"welcome_channel_id" text,
	"leave_channel_id" text,
	"welcome_message" text DEFAULT 'Welcome {{user.mention}} to {{server.name}}!' NOT NULL,
	"leave_message" text DEFAULT '{{user.username}} has left the server.' NOT NULL,
	"welcome_card_template_id" uuid,
	"dm_enabled" boolean DEFAULT false NOT NULL,
	"dm_message" text DEFAULT '' NOT NULL,
	"auto_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rules_channel_id" text,
	"delay_seconds" integer DEFAULT 0 NOT NULL,
	"log_channel_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "module_key" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "severity" "audit_severity" DEFAULT 'info' NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automod_rules" ADD CONSTRAINT "automod_rules_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automod_violations" ADD CONSTRAINT "automod_violations_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automod_violations" ADD CONSTRAINT "automod_violations_rule_id_automod_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automod_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birthday_announcements" ADD CONSTRAINT "birthday_announcements_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birthday_settings" ADD CONSTRAINT "birthday_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birthdays" ADD CONSTRAINT "birthdays_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_assets" ADD CONSTRAINT "card_assets_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_templates" ADD CONSTRAINT "card_templates_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_commands" ADD CONSTRAINT "custom_commands_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_settings" ADD CONSTRAINT "moderation_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignment_logs" ADD CONSTRAINT "role_assignment_logs_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignment_logs" ADD CONSTRAINT "role_assignment_logs_menu_id_role_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."role_menus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_menu_options" ADD CONSTRAINT "role_menu_options_menu_id_role_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."role_menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_menus" ADD CONSTRAINT "role_menus_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_message_runs" ADD CONSTRAINT "scheduled_message_runs_scheduled_message_id_scheduled_messages_id_fk" FOREIGN KEY ("scheduled_message_id") REFERENCES "public"."scheduled_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "welcome_settings" ADD CONSTRAINT "welcome_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_guild_idx" ON "announcements" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "announcements_status_idx" ON "announcements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "announcements_scheduled_idx" ON "announcements" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "automod_rules_guild_idx" ON "automod_rules" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "automod_violations_guild_idx" ON "automod_violations" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "automod_violations_user_idx" ON "automod_violations" USING btree ("guild_id","user_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "birthday_announcements_unique_idx" ON "birthday_announcements" USING btree ("guild_id","user_external_id","announced_on");--> statement-breakpoint
CREATE UNIQUE INDEX "birthdays_guild_user_idx" ON "birthdays" USING btree ("guild_id","user_external_id");--> statement-breakpoint
CREATE INDEX "birthdays_month_day_idx" ON "birthdays" USING btree ("month","day");--> statement-breakpoint
CREATE INDEX "card_assets_guild_idx" ON "card_assets" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "card_templates_guild_idx" ON "card_templates" USING btree ("guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_commands_guild_name_idx" ON "custom_commands" USING btree ("guild_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_cases_guild_number_idx" ON "moderation_cases" USING btree ("guild_id","case_number");--> statement-breakpoint
CREATE INDEX "moderation_cases_target_idx" ON "moderation_cases" USING btree ("guild_id","target_user_external_id");--> statement-breakpoint
CREATE INDEX "moderation_cases_created_idx" ON "moderation_cases" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "reminders" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "reminders_user_idx" ON "reminders" USING btree ("user_external_id");--> statement-breakpoint
CREATE INDEX "role_assignment_logs_guild_idx" ON "role_assignment_logs" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "role_menu_options_menu_idx" ON "role_menu_options" USING btree ("menu_id");--> statement-breakpoint
CREATE INDEX "role_menus_guild_idx" ON "role_menus" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "role_menus_message_idx" ON "role_menus" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "scheduled_message_runs_msg_idx" ON "scheduled_message_runs" USING btree ("scheduled_message_id");--> statement-breakpoint
CREATE INDEX "scheduled_messages_guild_idx" ON "scheduled_messages" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "scheduled_messages_next_run_idx" ON "scheduled_messages" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "audit_logs_module_idx" ON "audit_logs" USING btree ("module_key");--> statement-breakpoint
CREATE INDEX "audit_logs_severity_idx" ON "audit_logs" USING btree ("severity");