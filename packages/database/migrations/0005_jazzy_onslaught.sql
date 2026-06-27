CREATE TABLE "activity_channel_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"date" text NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_user_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" uuid NOT NULL,
	"user_external_id" text NOT NULL,
	"date" text NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serverstats_settings" (
	"guild_id" uuid PRIMARY KEY NOT NULL,
	"recap_channel_id" text,
	"recap_enabled" boolean DEFAULT false NOT NULL,
	"recap_dow" integer DEFAULT 1 NOT NULL,
	"recap_hour_utc" integer DEFAULT 12 NOT NULL,
	"last_recap_date" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_channel_daily" ADD CONSTRAINT "activity_channel_daily_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_user_daily" ADD CONSTRAINT "activity_user_daily_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serverstats_settings" ADD CONSTRAINT "serverstats_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_channel_daily_unique_idx" ON "activity_channel_daily" USING btree ("guild_id","channel_id","date");--> statement-breakpoint
CREATE INDEX "activity_channel_daily_guild_date_idx" ON "activity_channel_daily" USING btree ("guild_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_user_daily_unique_idx" ON "activity_user_daily" USING btree ("guild_id","user_external_id","date");--> statement-breakpoint
CREATE INDEX "activity_user_daily_guild_date_idx" ON "activity_user_daily" USING btree ("guild_id","date");