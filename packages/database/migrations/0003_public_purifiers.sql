CREATE TABLE "prompt_settings" (
	"guild_id" uuid PRIMARY KEY NOT NULL,
	"qotd_channel_id" text,
	"qotd_enabled" boolean DEFAULT false NOT NULL,
	"qotd_hour_utc" integer DEFAULT 12 NOT NULL,
	"last_qotd_date" text,
	"recent" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prompt_settings" ADD CONSTRAINT "prompt_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;