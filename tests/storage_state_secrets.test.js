import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  decryptStorageStateBlob,
  encryptStorageStateBlob,
  materializeStorageStateFromSecrets,
} from "../src/storage_state_secrets.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "schoology-storage-secret-"));
}

test("encryptStorageStateBlob round-trips with decryptStorageStateBlob", () => {
  const source = JSON.stringify({ cookies: [{ name: "session", value: "abc" }] });
  const blob = encryptStorageStateBlob(source, "test-key-123");
  const decoded = decryptStorageStateBlob(blob, "test-key-123");
  assert.equal(JSON.stringify(JSON.parse(decoded)), source);
});

test("materializeStorageStateFromSecrets writes plain base64 payload", () => {
  const tempDir = makeTempDir();
  const storagePath = path.join(tempDir, "storage.json");
  const payload = Buffer.from(JSON.stringify({ cookies: [], origins: [] }), "utf8").toString("base64");
  const result = materializeStorageStateFromSecrets({
    auth: {
      storageStateB64: payload,
      storageStateEncB64: "",
      storageStateEncKey: "",
    },
    paths: { storagePath },
  });
  assert.equal(result.ok, true);
  assert.equal(result.written, true);
  assert.equal(result.source, "base64");
  const parsed = JSON.parse(fs.readFileSync(storagePath, "utf8"));
  assert.deepEqual(parsed, { cookies: [], origins: [] });
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("materializeStorageStateFromSecrets writes encrypted payload", () => {
  const tempDir = makeTempDir();
  const storagePath = path.join(tempDir, "storage.json");
  const source = JSON.stringify({ cookies: [{ name: "s", value: "1" }] });
  const encrypted = encryptStorageStateBlob(source, "enc-key");
  const result = materializeStorageStateFromSecrets({
    auth: {
      storageStateB64: "",
      storageStateEncB64: encrypted,
      storageStateEncKey: "enc-key",
    },
    paths: { storagePath },
  });
  assert.equal(result.ok, true);
  assert.equal(result.source, "encrypted");
  const parsed = JSON.parse(fs.readFileSync(storagePath, "utf8"));
  assert.deepEqual(parsed, { cookies: [{ name: "s", value: "1" }] });
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("materializeStorageStateFromSecrets fails when encrypted key is missing", () => {
  const encrypted = encryptStorageStateBlob(JSON.stringify({ cookies: [] }), "abc");
  assert.throws(
    () =>
      materializeStorageStateFromSecrets({
        auth: {
          storageStateB64: "",
          storageStateEncB64: encrypted,
          storageStateEncKey: "",
        },
        paths: { storagePath: path.join(process.cwd(), "data", "temp-storage.json") },
      }),
    /STORAGE_STATE_ENC_KEY is required/i
  );
});
