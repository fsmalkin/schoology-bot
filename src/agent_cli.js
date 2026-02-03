import "dotenv/config";
import { runAgentMessage } from "./agent.js";

const text = process.argv.slice(2).join(" ").trim();
if (!text) {
  console.error('Usage: npm run agent:cli -- "your message"');
  process.exit(1);
}

try {
  const reply = await runAgentMessage({ chatId: "local-cli", text });
  console.log(reply);
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
}
