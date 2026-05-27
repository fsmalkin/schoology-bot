import "dotenv/config";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}

const url = `https://api.telegram.org/bot${token}/getUpdates`;

try {
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) {
    console.error("Telegram API error:", data);
    process.exit(1);
  }

  const seen = new Set();
  for (const update of data.result || []) {
    const msg = update.message || update.edited_message || update.channel_post;
    if (!msg || !msg.chat) continue;
    const chatId = String(msg.chat.id);
    const threadId = msg.message_thread_id ? String(msg.message_thread_id) : "";
    const seenKey = threadId ? `${chatId}:thread:${threadId}` : chatId;
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);
    const name = [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(" ");
    const label = msg.chat.username ? `@${msg.chat.username}` : name || msg.chat.title || "";
    const thread = threadId ? ` thread_id=${threadId}` : "";
    console.log(`chat_id=${chatId}${thread} ${label}`.trim());
  }

  if (seen.size === 0) {
    console.log("No recent chats found. Send a message to your bot, then retry.");
  }
} catch (err) {
  console.error("Failed to fetch updates:", err.message || err);
  process.exit(1);
}
