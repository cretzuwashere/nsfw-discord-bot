# Discord Setup

How to create the Discord application, get the three values for `.env`, and
invite the bot to your server.

## 1. Create the application and bot

1. Open <https://discord.com/developers/applications> → **New Application** →
   name it → **Create**.
2. **General Information** page: copy the **Application ID** —
   this is your **`DISCORD_CLIENT_ID`**.
3. Left sidebar → **Bot**:
   - Press **Reset Token** → confirm → **copy the token immediately**
     (it is shown only once). This is your **`DISCORD_TOKEN`**.
   - A real bot token looks like `MTE4…xxxx.Gh7aBc.yyyy…` — long, with two
     dots. If your value doesn't look like that, you copied the wrong thing
     (the *public key* and *client secret* are different values that won't
     work here).
   - Under **Privileged Gateway Intents**: the **audio bot needs none** — leave
     them off and it connects fine. Only enable these if you also want the
     matching community feature (and set the matching `.env` flag, below):
     - **Server Members Intent** → Welcome/Leave + Birthdays-on-join.
       Set `DISCORD_ENABLE_GUILD_MEMBERS=true`.
     - **Message Content Intent** → content-based auto-moderation.
       Set `DISCORD_ENABLE_MESSAGE_CONTENT=true`.

   > ⚠️ The portal toggle and the `.env` flag must agree. If you set the flag
   > `true` without enabling the intent in the portal, Discord refuses the
   > connection (error **4014 Disallowed intents**) and the bot won't log in.
   > If in doubt, leave both off — you still get audio + moderation + roles +
   > reminders + announcements + birthday commands.

> Treat the token like a password. If it ever leaks (pasted in chat, committed
> to git), go to the Bot page and **Reset Token** — the old one stops working.

## 2. Get your server (guild) ID

1. In the Discord client: **User Settings → Advanced → Developer Mode: ON**.
2. Right-click your server's name → **Copy Server ID** —
   this is your **`DISCORD_GUILD_ID`**.

Setting the guild ID makes slash-command registration **instant** for that
server. Without it, commands register globally and can take up to an hour to
appear.

## 3. Invite the bot to your server

Build the invite URL (replace `YOUR_CLIENT_ID`):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=3147776
```

- **Scopes:** `bot` + `applications.commands`
- **Permissions value `3147776`** = View Channels + Send Messages + Connect +
  Speak — the minimum the audio player needs. (You can also assemble this in
  the developer portal under *OAuth2 → URL Generator*.)

Open the URL in your browser, choose your server, **Authorize**.

## 4. Configure and start

In `.env`:

```env
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
DISCORD_GUILD_ID=your-server-id
```

Then (host shell, Docker-only as always):

```bash
docker compose restart bot
docker compose exec app pnpm discord:register-commands
```

Expected output: `Registered 27 slash commands for guild <id> (instant).`
(10 audio + 12 moderation + announcements/roles/birthday/reminder/custom — the
latter five each register as one command with subcommands.)

## 5. Try it

1. Join a voice channel in your server.
2. `/play url:<link>` — a YouTube link (public **or unlisted**), SoundCloud,
   Spotify track, or a direct audio file (`.mp3`, `.ogg`, `.wav`, …). The bot
   joins your channel and starts playing, and posts a **visual panel** with a
   progress bar and Pause/Skip/Stop/Leave buttons.
3. `/controls` shows that panel any time; `/nowplaying`, `/queue`, `/skip`,
   `/pause`, `/resume`, `/stop`, `/leave` also work.
4. Private/age-restricted YouTube needs a cookies file — see
   [AUDIO_SOURCES.md](AUDIO_SOURCES.md). Unlisted videos need nothing extra.

Browse every command (with options + required permissions) on the admin
panel's **Commands** page. The admin panel (http://localhost:3000 →
*Audio Player*) shows the live session with skip/stop/clear buttons, and
*Dashboard* shows the connection as `connected` with the bot's tag.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Dashboard shows Discord `error` / log says `TokenInvalid` | Wrong/expired token → Reset Token in the portal, update `.env`, `docker compose restart bot` |
| Log says `Disallowed intents` / close code `4014` | You set `DISCORD_ENABLE_GUILD_MEMBERS` or `DISCORD_ENABLE_MESSAGE_CONTENT` to `true` but didn't enable that **Privileged Gateway Intent** in the portal. Enable it there, or set the flag back to `false`. |
| Slash commands don't appear | Re-run `discord:register-commands`; with no `DISCORD_GUILD_ID` wait up to 1 h; make sure the invite included `applications.commands` |
| Bot joins but no sound plays | Check the bot has **Speak** permission in that channel; see [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
| `/play` rejects your link | Only direct http(s) audio links are supported in v1; private/internal hosts are blocked by design |
