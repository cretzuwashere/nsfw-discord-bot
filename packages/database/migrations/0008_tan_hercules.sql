CREATE TABLE "economy_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"user_external_id" text NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"last_daily_date" text,
	"streak" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economy_settings" (
	"guild_id" uuid PRIMARY KEY NOT NULL,
	"currency_name" text DEFAULT 'coins' NOT NULL,
	"currency_emoji" text DEFAULT '🪙' NOT NULL,
	"starting_balance" integer DEFAULT 0 NOT NULL,
	"daily_amount" integer DEFAULT 100 NOT NULL,
	"daily_streak_bonus" integer DEFAULT 10 NOT NULL,
	"daily_streak_cap" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economy_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" uuid NOT NULL,
	"user_external_id" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"kind" text DEFAULT 'role' NOT NULL,
	"role_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"price" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_purchases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" uuid NOT NULL,
	"user_external_id" text NOT NULL,
	"item_id" uuid,
	"price_paid" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "economy_accounts" ADD CONSTRAINT "economy_accounts_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economy_settings" ADD CONSTRAINT "economy_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economy_transactions" ADD CONSTRAINT "economy_transactions_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_items" ADD CONSTRAINT "shop_items_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_purchases" ADD CONSTRAINT "shop_purchases_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_purchases" ADD CONSTRAINT "shop_purchases_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "economy_accounts_guild_user_idx" ON "economy_accounts" USING btree ("guild_id","user_external_id");--> statement-breakpoint
CREATE INDEX "economy_accounts_guild_balance_idx" ON "economy_accounts" USING btree ("guild_id","balance");--> statement-breakpoint
CREATE INDEX "economy_transactions_guild_user_idx" ON "economy_transactions" USING btree ("guild_id","user_external_id");--> statement-breakpoint
CREATE INDEX "shop_items_guild_idx" ON "shop_items" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "shop_purchases_guild_user_idx" ON "shop_purchases" USING btree ("guild_id","user_external_id");