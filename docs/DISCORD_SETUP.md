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
   - Under **Privileged Gateway Intents**: none are required for this bot
     (audio playback uses only the standard `Guilds` and `GuildVoiceStates`
     intents).

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

Expected output: `Registered 9 slash commands for guild <id> (instant).`

## 5. Try it

1. Join a voice channel in your server.
2. Type `/join` — the bot joins your channel.
3. `/play url:` + a direct link to an audio file (`.mp3`, `.ogg`, `.wav`, …).
4. `/queue`, `/skip`, `/pause`, `/resume`, `/stop`, `/nowplaying`, `/leave`.

The admin panel (http://localhost:3000 → *Audio Player*) shows the live
session with skip/stop/clear buttons, and *Dashboard* shows the connection
as `connected` with the bot's tag.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Dashboard shows Discord `error` / log says `TokenInvalid` | Wrong/expired token → Reset Token in the portal, update `.env`, `docker compose restart bot` |
| Slash commands don't appear | Re-run `discord:register-commands`; with no `DISCORD_GUILD_ID` wait up to 1 h; make sure the invite included `applications.commands` |
| Bot joins but no sound plays | Check the bot has **Speak** permission in that channel; see [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
| `/play` rejects your link | Only direct http(s) audio links are supported in v1; private/internal hosts are blocked by design |
