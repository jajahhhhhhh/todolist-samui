// ============================================================
// CHOWTO Telegram Bot — Cloudflare Worker
// Real-time message capture → Task list
// Deploy at: Cloudflare Dashboard → Workers → New Worker
// ============================================================

// ─── CONFIG (set these in Cloudflare Worker Environment Variables) ───────────
// TELEGRAM_BOT_TOKEN  = your bot token from @BotFather
// CLAUDE_API_KEY      = your Anthropic API key
// WEBHOOK_SECRET      = any random string e.g. "chowto2026secure"
// ────────────────────────────────────────────────────────────────────────────

// In-memory task store (persists during worker lifetime)
// For production: replace with Cloudflare KV or D1
let TASKS = [];
let TASK_ID = 1;

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Webhook from Telegram
    if (request.method === "POST" && url.pathname === "/webhook") {
      return handleWebhook(request, env);
    }

    // View tasks as JSON (for dashboard integration)
    if (url.pathname === "/tasks") {
      return new Response(JSON.stringify(TASKS, null, 2), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // Health check
    return new Response("🤖 CHOWTO Bot is running!", { status: 200 });
  }
};

// ─── WEBHOOK HANDLER ─────────────────────────────────────────────────────────
async function handleWebhook(request, env) {
  try {
    // Verify secret
    const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (secret !== env.WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await request.json();
    const msg = body.message || body.edited_message;
    if (!msg) return new Response("OK");

    const chatId = msg.chat.id;
    const text = msg.text || "";
    const from = msg.from?.first_name || "Unknown";
    const chatTitle = msg.chat.title || msg.chat.first_name || "Private";

    // Handle commands
    if (text.startsWith("/")) {
      return handleCommand(text, chatId, chatTitle, from, env);
    }

    // Auto-detect if message looks like a task/work item
    const isWorkRelated = await detectWorkMessage(text, env);

    if (isWorkRelated) {
      // Extract task using Claude AI
      const task = await extractTask(text, chatTitle, from, env);
      if (task) {
        TASKS.unshift(task);
        await sendMessage(chatId, formatTaskAdded(task), env);
      }
    }

    return new Response("OK");
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response("Error", { status: 500 });
  }
}

// ─── COMMAND HANDLER ─────────────────────────────────────────────────────────
async function handleCommand(text, chatId, chatTitle, from, env) {
  const cmd = text.split(" ")[0].toLowerCase();
  const args = text.slice(cmd.length).trim();

  switch (cmd) {
    case "/tasks":
    case "/งาน":
      return sendAndReturn(chatId, formatTaskList(), env);

    case "/add":
    case "/เพิ่ม":
      if (!args) return sendAndReturn(chatId, "❌ กรุณาระบุงาน\nตัวอย่าง: /add ส่งเอกสารให้ Joy", env);
      const newTask = createTask(args, chatTitle, from, "medium");
      TASKS.unshift(newTask);
      return sendAndReturn(chatId, formatTaskAdded(newTask), env);

    case "/done":
    case "/เสร็จ":
      const doneId = parseInt(args);
      const doneTask = TASKS.find(t => t.id === doneId);
      if (doneTask) {
        doneTask.done = true;
        doneTask.doneAt = new Date().toISOString();
        return sendAndReturn(chatId, `✅ เสร็จแล้ว: *${doneTask.title}*`, env);
      }
      return sendAndReturn(chatId, "❌ ไม่พบงานหมายเลขนี้", env);

    case "/delete":
    case "/ลบ":
      const delId = parseInt(args);
      const before = TASKS.length;
      TASKS = TASKS.filter(t => t.id !== delId);
      return sendAndReturn(chatId,
        TASKS.length < before ? `🗑 ลบงาน #${delId} แล้ว` : "❌ ไม่พบงานหมายเลขนี้",
        env
      );

    case "/urgent":
    case "/ด่วน":
      const urgId = parseInt(args);
      const urgTask = TASKS.find(t => t.id === urgId);
      if (urgTask) {
        urgTask.urgent = !urgTask.urgent;
        return sendAndReturn(chatId, `⚡ งาน #${urgId} ${urgTask.urgent ? "ตั้งเป็นด่วน" : "ยกเลิกด่วน"}แล้ว`, env);
      }
      return sendAndReturn(chatId, "❌ ไม่พบงาน", env);

    case "/clear":
      const count = TASKS.filter(t => t.done).length;
      TASKS = TASKS.filter(t => !t.done);
      return sendAndReturn(chatId, `🧹 ลบงานที่เสร็จแล้ว ${count} รายการ`, env);

    case "/help":
    case "/ช่วย":
      return sendAndReturn(chatId, HELP_TEXT, env);

    case "/newlead":
      if (!args) return sendAndReturn(chatId, "❌ กรุณาระบุรายละเอียด\nตัวอย่าง: /newlead Anna 3 bed villa Lamai 110k/mo", env);
      const lead = await extractPropertyLead(args, env);
      TASKS.unshift(lead);
      return sendAndReturn(chatId, formatLeadAdded(lead), env);

    default:
      return sendAndReturn(chatId, "❓ คำสั่งไม่ถูกต้อง พิมพ์ /help เพื่อดูคำสั่งทั้งหมด", env);
  }
}

// ─── AI FUNCTIONS ─────────────────────────────────────────────────────────────
async function detectWorkMessage(text, env) {
  // Quick keyword check first (faster + cheaper)
  // 🇹🇭 Thai keywords
  const thaiKeywords = [
    "ดู", "นัด", "จ่าย", "โอน", "ส่ง", "ติดต่อ", "ติดตาม", "ฝาก", "รับ",
    "ค่าเช่า", "โฉนด", "สัญญา", "เอกสาร", "นัดหมาย", "พบ", "ประชุม",
    "ตรวจ", "ซ่อม", "ลูกค้า", "บ้าน", "คอนโด", "ที่ดิน", "วิลล่า",
    "จอง", "ชำระ", "ค้าง", "หนี้", "ติดตาม", "รายงาน", "ประสาน"
  ];

  // 🇬🇧 English keywords
  const engKeywords = [
    "viewing", "payment", "transfer", "send", "client", "rent", "lease",
    "property", "villa", "house", "meeting", "contract", "document",
    "follow up", "followup", "deposit", "urgent", "asap", "deadline",
    "invoice", "receipt", "confirm", "appointment", "schedule", "book",
    "tenant", "landlord", "agent", "commission", "sign", "inspect"
  ];

  // 🇷🇺 Russian keywords
  const ruKeywords = [
    // Property & meetings
    "встреча", "показ", "осмотр", "аренда", "квартира", "дом", "вилла",
    "договор", "контракт", "документ", "оплата", "перевод", "задаток",
    // Communication & tasks
    "отправить", "позвонить", "написать", "связаться", "напомнить",
    "срочно", "важно", "клиент", "покупатель", "арендатор", "владелец",
    // Status words
    "подтвердить", "согласовать", "проверить", "оформить", "подписать",
    "ждет", "ожидает", "готов", "сделка", "задолженность", "долг",
    // Common short forms
    "звони", "пиши", "надо", "нужно", "должен", "должна"
  ];

  const lower = text.toLowerCase();
  return [...thaiKeywords, ...engKeywords, ...ruKeywords].some(k => lower.includes(k));
}

async function extractTask(text, source, from, env) {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        system: `You are a task extractor for a property management business in Koh Samui, Thailand.
The business communicates in Thai, English, and Russian.
Extract a task from the message. Return ONLY valid JSON, no other text:
{
  "title": "short task title — keep in original language or English",
  "detail": "brief detail",
  "due": "due date if mentioned, else empty string",
  "priority": "high|medium|low",
  "tag": "ลูกค้า|การเงิน|พร็อพเพอร์ตี้|แอดมิน|ดูพร็อพเพอร์ตี้|อื่นๆ"
}
Language rules:
- Thai message → respond in Thai
- Russian message → respond in Russian  
- English message → respond in English
If this is NOT a task, return: {"skip": true}`,
        messages: [{ role: "user", content: `Source: ${source}\nFrom: ${from}\nMessage: ${text}` }]
      })
    });

    const data = await response.json();
    const raw = data.content?.[0]?.text || "{}";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());

    if (parsed.skip) return null;

    return {
      id: TASK_ID++,
      title: parsed.title || text.slice(0, 60),
      detail: parsed.detail || "",
      due: parsed.due || "",
      priority: parsed.priority || "medium",
      tag: parsed.tag || "อื่นๆ",
      source: "Telegram",
      chatName: source,
      from,
      done: false,
      urgent: parsed.priority === "high",
      createdAt: new Date().toISOString(),
      rawMessage: text
    };
  } catch (err) {
    // Fallback: create basic task without AI
    return createTask(text, source, from, "medium");
  }
}

async function extractPropertyLead(text, env) {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        system: `Extract property lead info. Return ONLY JSON:
{"client":"name","beds":"3-4","budget":110000,"area":"Lamai","moveIn":"April","contract":"2 years","notes":"any other info"}`,
        messages: [{ role: "user", content: text }]
      })
    });

    const data = await response.json();
    const raw = data.content?.[0]?.text || "{}";
    const lead = JSON.parse(raw.replace(/```json|```/g, "").trim());

    return {
      id: TASK_ID++,
      title: `🏠 Lead: ${lead.client || "New Client"} — ${lead.beds || "?"} bed ฿${(lead.budget || 0).toLocaleString()}/mo`,
      detail: `ย่าน: ${lead.area || "-"} · เข้า: ${lead.moveIn || "-"} · สัญญา: ${lead.contract || "-"} · ${lead.notes || ""}`,
      due: "ASAP",
      priority: "high",
      tag: "ลูกค้า",
      source: "Telegram",
      done: false,
      urgent: true,
      createdAt: new Date().toISOString(),
      leadData: lead
    };
  } catch {
    return createTask(text, "Telegram", "Manual", "high");
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function createTask(title, source, from, priority) {
  return {
    id: TASK_ID++,
    title: title.slice(0, 100),
    detail: "",
    due: "",
    priority,
    tag: "อื่นๆ",
    source: "Telegram",
    chatName: source,
    from,
    done: false,
    urgent: priority === "high",
    createdAt: new Date().toISOString()
  };
}

function formatTaskAdded(task) {
  const p = task.priority === "high" ? "🔴" : task.priority === "medium" ? "🟡" : "🟢";
  return `✅ *บันทึกงานแล้ว #${task.id}*\n\n${p} ${task.title}\n${task.detail ? `📝 ${task.detail}\n` : ""}${task.due ? `🗓 ${task.due}\n` : ""}🏷 ${task.tag}\n\nพิมพ์ /tasks เพื่อดูทั้งหมด`;
}

function formatLeadAdded(task) {
  return `🏠 *บันทึก Lead แล้ว #${task.id}*\n\n${task.title}\n${task.detail}\n\n⚡ ตั้งเป็นงานด่วน\nพิมพ์ /tasks เพื่อดูทั้งหมด`;
}

function formatTaskList() {
  const pending = TASKS.filter(t => !t.done);
  const done = TASKS.filter(t => t.done);

  if (TASKS.length === 0) return "📭 ยังไม่มีงาน\nพิมพ์ /add [ชื่องาน] เพื่อเพิ่ม";

  let msg = `📋 *รายการงาน* (${pending.length} ค้างอยู่)\n\n`;

  // Urgent first
  const urgent = pending.filter(t => t.urgent);
  const normal = pending.filter(t => !t.urgent);

  if (urgent.length) {
    msg += "⚡ *ด่วน*\n";
    urgent.forEach(t => {
      msg += `• #${t.id} ${t.title}${t.due ? ` · ${t.due}` : ""}\n`;
    });
    msg += "\n";
  }

  if (normal.length) {
    msg += "📌 *ปกติ*\n";
    normal.slice(0, 10).forEach(t => {
      const p = t.priority === "high" ? "🔴" : t.priority === "medium" ? "🟡" : "🟢";
      msg += `${p} #${t.id} ${t.title}\n`;
    });
  }

  if (done.length) msg += `\n✅ เสร็จแล้ว ${done.length} รายการ`;

  msg += "\n\n_/done [#] · /urgent [#] · /add [งาน]_";
  return msg;
}

const HELP_TEXT = `🤖 *CHOWTO Bot — @allchathelpbot*
_Supports 🇹🇭 Thai · 🇬🇧 English · 🇷🇺 Russian_

*งาน / Tasks / Задачи*
/tasks — ดูรายการงาน · View tasks · Список задач
/add [text] — เพิ่มงาน · Add task · Добавить задачу
/done [#] — ทำเครื่องหมายเสร็จ · Mark done
/urgent [#] — ตั้งด่วน · Set urgent · Срочно
/delete [#] — ลบงาน · Delete task
/clear — ลบงานที่เสร็จ · Clear done tasks

*Property / Недвижимость*
/newlead [details] — เพิ่ม lead ลูกค้า
_Example: /newlead Anna villa 3 bed Lamai 110k_

*อื่นๆ / Other*
/help — แสดงคำสั่ง · Show commands

🔄 *Auto-capture* — บอทจับข้อความงานอัตโนมัติ 3 ภาษา!
_Автоматически распознаёт рабочие сообщения_`;

async function sendMessage(chatId, text, env) {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
  });
}

async function sendAndReturn(chatId, text, env) {
  await sendMessage(chatId, text, env);
  return new Response("OK");
}
