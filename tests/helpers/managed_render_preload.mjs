import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const protectedPaths = new Set([
  process.env.ANTHROPIC_API_KEY_FILE, process.env.CLAUDE_API_KEY_FILE,
].filter(Boolean));
const readFileSync = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  if (protectedPaths.has(String(path))) {
    process.stderr.write("MANAGED-RENDER-SECRET-FILE-READ-BLOCKED\n");
    throw new Error("MANAGED-RENDER-SECRET-FILE-READ-BLOCKED");
  }
  return readFileSync.call(this, path, ...args);
};
syncBuiltinESMExports();

globalThis.fetch = async (url, options) => {
  if (process.env.SCHOOLOGY_RENDER_API_CONTROL !== "1") {
    throw new Error("MANAGED-RENDER-NETWORK-BLOCKED");
  }
  return {
    ok: true,
    text: async () => JSON.stringify({
      data: [],
      control: {
        url, method: options.method,
        expectedKey: options.headers["x-api-key"] === "offline-test-key",
        beta: options.headers["anthropic-beta"],
        version: options.headers["anthropic-version"],
      },
    }),
  };
};
