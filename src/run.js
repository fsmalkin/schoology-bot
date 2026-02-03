import { runOnce, runScrape, runSend } from "./tasks.js";

const mode = (process.argv[2] || "once").toLowerCase();

async function main() {
  if (mode === "scrape") {
    await runScrape();
    return;
  }
  if (mode === "send") {
    await runSend();
    return;
  }
  if (mode === "once") {
    await runOnce();
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
