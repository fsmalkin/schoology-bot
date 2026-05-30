import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildManagedAgentsConfig, readEnvValue } from "../src/config.js";

function tempSecret(value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schoology-secret-file-"));
  const file = path.join(dir, "secret");
  fs.writeFileSync(file, value, "utf8");
  return { dir, file };
}

test("readEnvValue prefers direct env values over file-backed secrets", () => {
  const { dir, file } = tempSecret("from-file\n");
  try {
    assert.equal(
      readEnvValue("SCHOLOGY_PASSWORD", "", {
        SCHOLOGY_PASSWORD: "from-env",
        SCHOLOGY_PASSWORD_FILE: file,
      }),
      "from-env"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readEnvValue reads NAME_FILE when direct env is empty", () => {
  const { dir, file } = tempSecret("from-file\n");
  try {
    assert.equal(
      readEnvValue("SCHOLOGY_PASSWORD", "", {
        SCHOLOGY_PASSWORD: "",
        SCHOLOGY_PASSWORD_FILE: file,
      }),
      "from-file"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readEnvValue falls back when secret file is missing", () => {
  assert.equal(
    readEnvValue("SCHOLOGY_PASSWORD", "fallback", {
      SCHOLOGY_PASSWORD_FILE: path.join(os.tmpdir(), "missing-schoology-secret"),
    }),
    "fallback"
  );
});

test("managed agents config accepts file-backed Anthropic key", () => {
  const { dir, file } = tempSecret("anthropic-file-key\n");
  try {
    const config = buildManagedAgentsConfig({
      MANAGED_AGENTS_ENABLED: "1",
      ANTHROPIC_API_KEY_FILE: file,
      CLAUDE_MANAGED_AGENT_ID: "agent_123",
      CLAUDE_MANAGED_ENVIRONMENT_ID: "env_123",
    });

    assert.equal(config.apiKey, "anthropic-file-key");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
