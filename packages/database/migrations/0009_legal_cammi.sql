CREATE TABLE "level_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"user_external_id" text NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"last_award_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "level_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"role_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "level_settings" (
	"guild_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"announce_channel_id" text,
	"level_up_message" text DEFAULT '🎉 {user} reached level **{level}**!' NOT NULL,
	"no_xp_channel_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"xp_min" integer DEFAULT 15 NOT NULL,
	"xp_max" integer DEFAULT 25 NOT NULL,
	"cooldown_seconds" integer DEFAULT 60 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "level_members" ADD CONSTRAINT "level_members_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_rewards" ADD CONSTRAINT "level_rewards_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_settings" ADD CONSTRAINT "level_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "level_members_guild_user_idx" ON "level_members" USING btree ("guild_id","user_external_id");--> statement-breakpoint
CREATE INDEX "level_members_guild_xp_idx" ON "level_members" USING btree ("guild_id","xp");--> statement-breakpoint
CREATE UNIQUE INDEX "level_rewards_guild_level_idx" ON "level_rewards" USING btree ("guild_id","level");