# Personal LTC Manager — Railway Ready

This version works with global slash commands in servers and DMs.

## Railway Variables

Add only:

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_discord_application_id
OWNER_ID=your_discord_user_id
LTC_ADDRESS=LfTAT8gjC6Gg6B5XyDqpfuiCCyvz9ioC48
ALERT_CHANNEL_ID=
CHECK_INTERVAL=30
```

**Do not add `GUILD_ID`; this version does not use it.**

## Commands

`/balance`
`/history`
`/address`
`/refresh`
`/status`

Commands are restricted to `OWNER_ID`.

## Deployment

Upload/deploy this project to Railway. Railway will run:

```bash
npm start
```

After deployment, wait for the bot to log in. Global slash commands can take a short time to appear in Discord.

## Security

This bot is read-only. Never put a Litecoin private key, seed phrase, recovery phrase, WIF, or wallet password into Railway Variables.
