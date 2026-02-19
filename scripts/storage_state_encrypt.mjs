import fs from "fs";
import path from "path";
import { encryptStorageStateBlob } from "../src/storage_state_secrets.js";

function parseArgs(argv) {
  const args = { input: "", output: "", key: "" };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--input" && argv[i + 1]) {
      args.input = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--output" && argv[i + 1]) {
      args.output = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--key" && argv[i + 1]) {
      args.key = argv[i + 1];
      i += 1;
      continue;
    }
  }
  return args;
}

function usage() {
  console.error("Usage:");
  console.error("  node scripts/storage_state_encrypt.mjs --input data/storage.json [--output data/storage_state.enc.b64] [--key <passphrase>]");
}

const opts = parseArgs(process.argv);
if (!opts.input) {
  usage();
  process.exit(1);
}

const key = String(opts.key || process.env.STORAGE_STATE_ENC_KEY || "").trim();
if (!key) {
  console.error("Missing encryption key. Pass --key or set STORAGE_STATE_ENC_KEY.");
  process.exit(1);
}

const inputPath = path.resolve(opts.input);
if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

let inputJson = "";
try {
  const raw = fs.readFileSync(inputPath, "utf8");
  inputJson = JSON.stringify(JSON.parse(raw));
} catch (err) {
  console.error(`Failed to read/parse storage state JSON: ${err?.message || err}`);
  process.exit(1);
}

let blob = "";
try {
  blob = encryptStorageStateBlob(inputJson, key);
} catch (err) {
  console.error(`Failed to encrypt storage state: ${err?.message || err}`);
  process.exit(1);
}

if (opts.output) {
  const outPath = path.resolve(opts.output);
  fs.writeFileSync(outPath, `${blob}\n`, "utf8");
  console.log(`Wrote encrypted storage blob to ${outPath}`);
}

console.log("Set these in .env (or secret files):");
console.log("STORAGE_STATE_ENC_B64=<base64-payload>");
console.log("STORAGE_STATE_ENC_KEY=<your-passphrase>");
if (!opts.output) {
  console.log("");
  console.log(blob);
}
