CREATE TABLE "trivia_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"user_external_id" text NOT NULL,
	"correct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trivia_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"question_index" integer NOT NULL,
	"correct_index" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"winner_external_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trivia_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"user_external_id" text NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trivia_settings" (
	"guild_id" uuid PRIMARY KEY NOT NULL,
	"auto_channel_id" text,
	"auto_enabled" boolean DEFAULT false NOT NULL,
	"auto_interval_min" integer DEFAULT 360 NOT NULL,
	"last_auto_at" timestamp with time zone,
	"recent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trivia_answers" ADD CONSTRAINT "trivia_answers_round_id_trivia_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."trivia_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trivia_rounds" ADD CONSTRAINT "trivia_rounds_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trivia_scores" ADD CONSTRAINT "trivia_scores_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trivia_settings" ADD CONSTRAINT "trivia_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trivia_answers_round_user_idx" ON "trivia_answers" USING btree ("round_id","user_external_id");--> statement-breakpoint
CREATE INDEX "trivia_rounds_guild_status_idx" ON "trivia_rounds" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "trivia_rounds_channel_idx" ON "trivia_rounds" USING btree ("channel_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "trivia_scores_guild_user_idx" ON "trivia_scores" USING btree ("guild_id","user_external_id");