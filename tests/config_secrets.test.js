import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "schoology-config-secret-"));
}

test("config reads Schoology credentials from *_FILE vars", async () => {
  const tempDir = makeTempDir();
  const userFile = path.join(tempDir, "user.txt");
  const passFile = path.join(tempDir, "pass.txt");
  fs.writeFileSync(userFile, "user@example.com\n", "utf8");
  fs.writeFileSync(passFile, "secret-pass\n", "utf8");

  const saved = {
    SCHOLOGY_USERNAME: process.env.SCHOLOGY_USERNAME,
    SCHOLOGY_PASSWORD: process.env.SCHOLOGY_PASSWORD,
    SCHOLOGY_USERNAME_FILE: process.env.SCHOLOGY_USERNAME_FILE,
    SCHOLOGY_PASSWORD_FILE: process.env.SCHOLOGY_PASSWORD_FILE,
  };

  process.env.SCHOLOGY_USERNAME = "";
  process.env.SCHOLOGY_PASSWORD = "";
  process.env.SCHOLOGY_USERNAME_FILE = userFile;
  process.env.SCHOLOGY_PASSWORD_FILE = passFile;
  const restore = (name, value) => {
    if (value === undefined) {
      delete process.env[name];
      return;
    }
    process.env[name] = value;
  };

  try {
    const mod = await import(`../src/config.js?filecreds=${Date.now()}`);
    const cfg = mod.getConfig();
    assert.equal(cfg.schoology.username, "user@example.com");
    assert.equal(cfg.schoology.password, "secret-pass");
  } finally {
    restore("SCHOLOGY_USERNAME", saved.SCHOLOGY_USERNAME);
    restore("SCHOLOGY_PASSWORD", saved.SCHOLOGY_PASSWORD);
    restore("SCHOLOGY_USERNAME_FILE", saved.SCHOLOGY_USERNAME_FILE);
    restore("SCHOLOGY_PASSWORD_FILE", saved.SCHOLOGY_PASSWORD_FILE);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
