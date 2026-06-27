CREATE TABLE "speaker_queue_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue_id" uuid NOT NULL,
	"user_external_id" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "speaker_queues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"voice_channel_id" text NOT NULL,
	"voice_channel_name" text DEFAULT '' NOT NULL,
	"panel_channel_id" text,
	"panel_message_id" text,
	"announce_channel_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "speaker_queue_entries" ADD CONSTRAINT "speaker_queue_entries_queue_id_speaker_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."speaker_queues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaker_queues" ADD CONSTRAINT "speaker_queues_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "speaker_queue_entries_queue_idx" ON "speaker_queue_entries" USING btree ("queue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "speaker_queue_entries_active_user_idx" ON "speaker_queue_entries" USING btree ("queue_id","user_external_id") WHERE status <> 'done';--> statement-breakpoint
CREATE UNIQUE INDEX "speaker_queues_guild_channel_idx" ON "speaker_queues" USING btree ("guild_id","voice_channel_id");