# CHOWTO Telegram Bot — Deployment Guide

## Prerequisites

- Cloudflare account (free tier works)
- Node.js installed
- Telegram bot token from @BotFather
- Anthropic API key

---

## Step 1 — Get Your Bot Token

1. Open Telegram → search **@BotFather**
2. Send `/newbot`
3. Follow prompts → copy the **BOT_TOKEN**

---

## Step 2 — Install Wrangler

```bash
npm install -g wrangler
wrangler login
```

---

## Step 3 — Deploy the Worker

```bash
# From the chowto-telegram-bot folder:
wrangler deploy
```

Your worker URL will be:
`https://chowto-telegram-bot.<your-account>.workers.dev`

---

## Step 4 — Set Secrets (NEVER put real values in wrangler.toml)

```bash
npx wrangler secret put BOT_TOKEN
# Paste your Telegram bot token when prompted

npx wrangler secret put CLAUDE_API_KEY
# Paste your Anthropic API key when prompted

npx wrangler secret put WEBHOOK_SECRET
# Type any random string, e.g.: chowto_kohsamui_2024
```

---

## Step 5 — Register the Webhook

Visit this URL in your browser (one time only):

```text
https://chowto-telegram-bot.<your-account>.workers.dev/setup
```

You should see: `{"ok": true, "result": true, "description": "Webhook was set"}`

---

## Step 6 — Test the Bot

Open Telegram → find your bot → send `/start`

You should see the CHOWTO welcome message! 🏝️

---

## Optional: Custom Domain (ch-howtoniksen.com)

1. In Cloudflare dashboard → Workers & Pages → your worker → Triggers
2. Add custom domain: `bot.ch-howtoniksen.com`
3. Uncomment the `routes` line in `wrangler.toml`
4. Re-run setup: visit `https://bot.ch-howtoniksen.com/setup`

---

## Commands Reference

| Command      | Action                            |
|-------------|-----------------------------------|
| `/start`    | Welcome menu                      |
| `/newlead`  | Log a new client inquiry          |
| `/properties` | View property inventory        |
| `/tasks`    | Today's priorities                |
| `/draft`    | Draft a client message (EN/TH/RU) |
| `/clear`    | Clear chat history                |
| _free text_ | Ask anything in EN/TH/RU          |

---

## Updating the Bot

```bash
# Edit worker.js, then:
wrangler deploy
```

No need to re-register the webhook after updates.

---

## Persistent Chat History (Optional KV)

By default, history is in-memory (resets on worker restart).
For 24hr persistence across restarts:

```bash
npx wrangler kv:namespace create "CHOWTO_SESSIONS"
# Copy the id from the output into wrangler.toml
```

Then follow the KV instructions at the bottom of `worker.js`.