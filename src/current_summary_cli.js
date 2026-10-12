import { createReadStream } from "node:fs";
import { buildCurrentSummary, CurrentSnapshotError } from "./current_summary.js";

const USAGE = "Usage: npm run summary:current -- --stdin | --snapshot <current-snapshot.json>";
const MAX_INPUT_BYTES = 1024 * 1024;

async function readSnapshot(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_INPUT_BYTES) throw new CurrentSnapshotError("The current snapshot exceeds the 1 MiB input limit.");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new CurrentSnapshotError("The current snapshot must be valid UTF-8 JSON.");
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  let stream;
  if (args.length === 1 && args[0] === "--stdin") stream = process.stdin;
  else if (args.length === 2 && args[0] === "--snapshot" && args[1]) stream = createReadStream(args[1]);
  else throw new CurrentSnapshotError(USAGE);
  const result = buildCurrentSummary(await readSnapshot(stream));
  process.stdout.write(`${result.summaryText}\n`);
}

main().catch(error => {
  // Never echo input, config, raw filesystem errors or secret-bearing stacks.
  process.stderr.write(`${error instanceof CurrentSnapshotError ? error.message : "Could not read the supplied current snapshot."}\n`);
  process.exitCode = 2;
});
