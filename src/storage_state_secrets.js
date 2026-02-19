import crypto from "crypto";
import fs from "fs";
import path from "path";

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function normalizeBase64(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function decodeBase64Utf8(value, label) {
  const normalized = normalizeBase64(value);
  if (!normalized) {
    throw new Error(`${label} is empty.`);
  }
  try {
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch (err) {
    throw new Error(`Failed to decode ${label} as base64: ${err?.message || err}`);
  }
}

function keyFromSecret(secret) {
  const raw = String(secret || "").trim();
  if (!raw) {
    throw new Error("STORAGE_STATE_ENC_KEY is required for encrypted storage state.");
  }
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

function parseEncryptedPayload(blob) {
  const decoded = decodeBase64Utf8(blob, "STORAGE_STATE_ENC_B64");
  let payload = null;
  try {
    payload = JSON.parse(decoded);
  } catch (err) {
    throw new Error("Encrypted storage state payload must be JSON.");
  }
  if (!payload || payload.v !== 1) {
    throw new Error("Encrypted storage state payload version is not supported.");
  }
  if (!payload.iv || !payload.tag || !payload.data) {
    throw new Error("Encrypted storage state payload is missing iv/tag/data.");
  }
  return payload;
}

export function decryptStorageStateBlob(blob, secret) {
  const payload = parseEncryptedPayload(blob);
  const key = keyFromSecret(secret);
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(payload.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(payload.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return plain;
  } catch (err) {
    throw new Error(`Failed to decrypt storage state: ${err?.message || err}`);
  }
}

export function encryptStorageStateBlob(plainText, secret) {
  const text = String(plainText || "");
  if (!text.trim()) {
    throw new Error("Storage state content is empty.");
  }
  const key = keyFromSecret(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function validateStorageStateJson(text, sourceLabel) {
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${sourceLabel} did not decode to valid JSON storage state.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${sourceLabel} must decode to a JSON object.`);
  }
  return JSON.stringify(parsed);
}

export function materializeStorageStateFromSecrets(config) {
  const plainBlob = config?.auth?.storageStateB64 || "";
  const encryptedBlob = config?.auth?.storageStateEncB64 || "";
  const storagePath = config?.paths?.storagePath;
  if (!storagePath) {
    throw new Error("Missing STORAGE_PATH configuration.");
  }

  if (!plainBlob && !encryptedBlob) {
    return { ok: true, written: false, source: null, path: storagePath };
  }

  let decoded = "";
  let source = "";
  if (encryptedBlob) {
    decoded = decryptStorageStateBlob(encryptedBlob, config?.auth?.storageStateEncKey || "");
    source = "encrypted";
  } else {
    decoded = decodeBase64Utf8(plainBlob, "STORAGE_STATE_B64");
    source = "base64";
  }

  const normalized = validateStorageStateJson(decoded, source === "encrypted" ? "STORAGE_STATE_ENC_B64" : "STORAGE_STATE_B64");
  const resolvedPath = path.resolve(storagePath);
  ensureDir(path.dirname(resolvedPath));
  fs.writeFileSync(resolvedPath, normalized, "utf8");
  return { ok: true, written: true, source, path: resolvedPath };
}
