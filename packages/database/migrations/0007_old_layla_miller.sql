CREATE TABLE "minigame_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"game" text NOT NULL,
	"player_x" text NOT NULL,
	"player_o" text NOT NULL,
	"board" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"turn" text DEFAULT 'X' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"winner" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "minigame_sessions" ADD CONSTRAINT "minigame_sessions_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "minigame_sessions_status_idx" ON "minigame_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "minigame_sessions_guild_idx" ON "minigame_sessions" USING btree ("guild_id");