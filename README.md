# Personal LTC Manager — Railway Ready

A private, read-only Litecoin Discord manager.

## Commands

- `/balance`
- `/history`
- `/address`
- `/refresh`
- `/status`

The slash commands are registered **globally**, so they can be used:
- in your Discord server
- in DMs with the bot

All commands are restricted to `OWNER_ID`.

## Railway deployment

1. Create a new Railway project.
2. Choose **Deploy from GitHub repo** or upload this project through your preferred Railway workflow.
3. Railway automatically runs the `start` script from `package.json`.
4. Add these Variables in Railway:

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_bot_client_id
OWNER_ID=your_discord_user_id
LTC_ADDRESS=LfTAT8gjC6Gg6B5XyDqpfuiCCyvz9ioC48
ALERT_CHANNEL_ID=
CHECK_INTERVAL=30
```

You do NOT need `GUILD_ID`.

## Discord bot setup

In the Discord Developer Portal:

1. Create/open your application.
2. Create a bot and copy its token.
3. Copy the Application ID as `CLIENT_ID`.
4. Enable the bot's installation/invite for your server if you also want it in a server.
5. Use the `bot` and `applications.commands` scopes when installing it.

For DMs, the bot must be installed/available to the user through Discord's normal app installation flow.

## Important

This bot is read-only. It never asks for or stores a Litecoin private key, seed phrase, or wallet password.

The LTC address in this project is public blockchain information.

Global slash commands may take a short time to appear after first deployment because Discord propagates global application commands.
