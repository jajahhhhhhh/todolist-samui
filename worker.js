/**
 * CHOWTO Property Management — Telegram Bot
 * Cloudflare Worker (JavaScript)
 * 
 * Environment Variables Required:
 *   BOT_TOKEN       — Telegram Bot token from @BotFather
 *   CLAUDE_API_KEY  — Anthropic API key
 *   WEBHOOK_SECRET  — Random secret string for webhook verification (optional but recommended)
 */

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the CHOWTO Property Management assistant for Koh Samui, Thailand.
You help J manage rental properties, clients, and deals through Telegram.

Your capabilities:
- Log client inquiries and requirements (villas, condos, budgets, dates)
- Track property availability (Chaweng Noi mountain view house, Thaledi 3-storey commercial building)
- Manage deal pipeline: New Lead → Viewing → Negotiation → Closed
- Draft messages in English, Thai 🇹🇭, and Russian 🇷🇺
- Summarize daily tasks and priorities
- Format responses with clear structure using emojis

Client channels:
- Telegram: Russian & European clients
- Line: Thai clients  
- Facebook Messenger: International expats

Always respond concisely and professionally. When asked to draft messages, provide them in the requested language(s).
When logging a new lead or property requirement, confirm the details back in a structured format.

Current properties managed:
1. Chaweng Noi — Mountain View House (residential)
2. Thaledi — 3-Storey Commercial Building

Respond in the same language the user writes in (English/Thai/Russian). Default to English.`;

// ─── Claude API ───────────────────────────────────────────────────────────────

async function askClaude(userMessage, history = [], apiKey) {
  const messages = [
    ...history,
    { role: "user", content: userMessage }
  ];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// ─── Telegram API Helpers ─────────────────────────────────────────────────────

async function sendMessage(chatId, text, botToken, options = {}) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    ...options
  };

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function sendTyping(chatId, botToken) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" })
  });
}

// ─── Conversation History (in-memory per worker instance) ────────────────────
// For persistent history, replace with KV store (see KV section below)

const conversationHistory = new Map();

function getHistory(chatId) {
  return conversationHistory.get(chatId) || [];
}

function appendHistory(chatId, role, content) {
  const history = getHistory(chatId);
  history.push({ role, content });
  // Keep last 20 messages to stay within context limits
  if (history.length > 20) history.splice(0, history.length - 20);
  conversationHistory.set(chatId, history);
}

// ─── Command Handlers ─────────────────────────────────────────────────────────

async function handleStart(chatId, botToken) {
  const welcome = `🏝️ *CHOWTO Property Management Bot*

สวัสดี! Привет! Hello!

I'm your AI assistant for managing properties on *Koh Samui*.

*Quick commands:*
/start — Show this menu
/newlead — Log a new client inquiry
/properties — View current property inventory
/tasks — Today's priority tasks
/draft — Draft a client message
/clear — Clear conversation history

Or just *type freely* — I understand English, Thai, and Russian! 🌏`;

  await sendMessage(chatId, welcome, botToken);
}

async function handleProperties(chatId, botToken) {
  const inventory = `🏠 *Current Property Inventory*

1️⃣ *Chaweng Noi — Mountain View House*
   📍 Chaweng Noi, Koh Samui
   🏡 Type: Residential Villa
   🌄 Feature: Mountain view
   📋 Status: Available for inquiry

2️⃣ *Thaledi — Commercial Building*
   📍 Thaledi, Koh Samui
   🏢 Type: 3-Storey Commercial
   📋 Status: Available for inquiry

_Type /newlead to log a client requirement_`;

  await sendMessage(chatId, inventory, botToken);
}

async function handleClear(chatId, botToken) {
  conversationHistory.delete(chatId);
  await sendMessage(chatId, "✅ Conversation history cleared.", botToken);
}

// ─── Main Message Handler ─────────────────────────────────────────────────────

async function handleMessage(message, env) {
  const chatId = message.chat.id;
  const text = message.text || "";
  const botToken = env.BOT_TOKEN;

  // Commands
  if (text === "/start") return handleStart(chatId, botToken);
  if (text === "/properties") return handleProperties(chatId, botToken);
  if (text === "/clear") return handleClear(chatId, botToken);

  // Show typing indicator
  await sendTyping(chatId, botToken);

  // For /newlead, /tasks, /draft — pass to Claude with context
  let userMessage = text;
  if (text === "/newlead") userMessage = "Help me log a new client lead. Ask me for their name, contact, property type, budget, and preferred dates.";
  if (text === "/tasks") userMessage = "List my top 5 property management priorities for today based on our recent conversation.";
  if (text === "/draft") userMessage = "Help me draft a professional message to a client. Ask me for the language (English/Thai/Russian), recipient, and what to communicate.";

  try {
    // Get conversation history
    const history = getHistory(chatId);

    // Get Claude response
    const reply = await askClaude(userMessage, history, env.CLAUDE_API_KEY);

    // Save to history
    appendHistory(chatId, "user", userMessage);
    appendHistory(chatId, "assistant", reply);

    // Send reply
    await sendMessage(chatId, reply, botToken);
  } catch (err) {
    console.error("Error:", err);
    await sendMessage(
      chatId,
      "⚠️ Something went wrong. Please try again in a moment.",
      botToken
    );
  }
}

// ─── Webhook Setup Helper ─────────────────────────────────────────────────────
// Visit: https://your-worker.workers.dev/setup to register the webhook

async function setupWebhook(request, env) {
  const workerUrl = new URL(request.url).origin;
  const webhookUrl = `${workerUrl}/webhook`;

  const res = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: env.WEBHOOK_SECRET || undefined,
        allowed_updates: ["message"]
      })
    }
  );

  const data = await res.json();
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json" }
  });
}

// ─── Cloudflare Worker Entry Point ────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Webhook setup endpoint
    if (url.pathname === "/setup" && request.method === "GET") {
      return setupWebhook(request, env);
    }

    // Telegram webhook endpoint
    if (url.pathname === "/webhook" && request.method === "POST") {
      // Verify webhook secret if set
      if (env.WEBHOOK_SECRET) {
        const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (secret !== env.WEBHOOK_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      try {
        const update = await request.json();

        if (update.message) {
          await handleMessage(update.message, env);
        }

        return new Response("OK", { status: 200 });
      } catch (err) {
        console.error("Webhook error:", err);
        return new Response("Error", { status: 500 });
      }
    }

    // Health check
    if (url.pathname === "/") {
      return new Response("🏝️ CHOWTO Bot is running!", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  }
};

/**
 * ─── OPTIONAL: Persistent History with Cloudflare KV ──────────────────────────
 * 
 * To persist conversations across worker restarts:
 * 
 * 1. Create a KV namespace in Cloudflare dashboard: "CHOWTO_SESSIONS"
 * 2. Bind it in wrangler.toml:
 *    [[kv_namespaces]]
 *    binding = "SESSIONS"
 *    id = "your-kv-namespace-id"
 * 
 * 3. Replace getHistory / appendHistory with:
 * 
 *    async function getHistory(chatId, env) {
 *      const data = await env.SESSIONS.get(`chat:${chatId}`, "json");
 *      return data || [];
 *    }
 * 
 *    async function appendHistory(chatId, role, content, env) {
 *      const history = await getHistory(chatId, env);
 *      history.push({ role, content });
 *      if (history.length > 20) history.splice(0, history.length - 20);
 *      await env.SESSIONS.put(`chat:${chatId}`, JSON.stringify(history), {
 *        expirationTtl: 86400  // 24 hours
 *      });
 *    }
 */
