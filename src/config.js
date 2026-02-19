import "dotenv/config";
import fs from "fs";
import path from "path";

function env(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") return fallback;
  const trimmed = String(value).trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function boolEnv(name, fallback = false) {
  const raw = env(name, "");
  if (raw === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(raw.toLowerCase());
}

function numEnv(name, fallback) {
  const raw = env(name, "");
  if (raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function listEnv(name) {
  const raw = env(name, "");
  if (raw === "") return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function envOrFile(name, fileName, fallback = "") {
  const direct = env(name, "");
  if (direct !== "") return direct;

  const filePathRaw = env(fileName, "");
  if (filePathRaw === "") return fallback;

  const resolvedPath = path.resolve(filePathRaw);
  try {
    const loaded = fs.readFileSync(resolvedPath, "utf8").trim();
    if (!loaded) {
      throw new Error("file is empty");
    }
    return loaded;
  } catch (err) {
    throw new Error(`Failed to read ${fileName} at ${resolvedPath}: ${err?.message || err}`);
  }
}

function buildConfig() {
  const cwd = process.cwd();
  const dataDir = env("DATA_DIR", path.join(cwd, "data"));

  return {
    schoology: {
      loginUrl: env("SCHOLOGY_LOGIN_URL", "https://bcps.schoology.com/login"),
      gradesUrl: env(
        "SCHOLOGY_GRADES_URL",
        "https://bcps.schoology.com/grades/grades"
      ),
      username: envOrFile("SCHOLOGY_USERNAME", "SCHOLOGY_USERNAME_FILE"),
      password: envOrFile("SCHOLOGY_PASSWORD", "SCHOLOGY_PASSWORD_FILE"),
      studentName: env("STUDENT_NAME", ""),
      idp: env("SCHOLOGY_IDP", "auto"),
      ssoSchool: env("SCHOLOGY_SSO_SCHOOL", "Baltimore County Public Schools"),
    },
    auth: {
      usernameFile: env("SCHOLOGY_USERNAME_FILE"),
      passwordFile: env("SCHOLOGY_PASSWORD_FILE"),
      storageStateB64: envOrFile("STORAGE_STATE_B64", "STORAGE_STATE_B64_FILE"),
      storageStateEncB64: envOrFile("STORAGE_STATE_ENC_B64", "STORAGE_STATE_ENC_B64_FILE"),
      storageStateEncKey: env("STORAGE_STATE_ENC_KEY"),
    },
    scrape: {
      detailFallbackEnabled: boolEnv("SCRAPE_DETAIL_FALLBACK_ENABLED", true),
      detailFallbackMax: numEnv("SCRAPE_DETAIL_FALLBACK_MAX", 12),
    },
    schedule: {
      timezone: env("TIMEZONE", "America/New_York"),
      scrapeCron: env("SCRAPE_CRON", "0 6 * * *"),
      sendCron: env("SEND_CRON", "0 7 * * *"),
      reminderCron: env("REMINDER_CRON", "*/1 * * * *"),
    },
    email: {
      from: env("EMAIL_FROM"),
      to: env("EMAIL_TO"),
      host: env("SMTP_HOST"),
      port: numEnv("SMTP_PORT", 587),
      user: env("SMTP_USER"),
      pass: env("SMTP_PASS"),
      secure: boolEnv("SMTP_SECURE", false),
    },
    twilio: {
      accountSid: env("TWILIO_ACCOUNT_SID"),
      authToken: env("TWILIO_AUTH_TOKEN"),
      from: env("TWILIO_FROM"),
      messagingServiceSid: env("TWILIO_MESSAGING_SERVICE_SID"),
      to: listEnv("TWILIO_TO"),
    },
    telegram: {
      botToken: env("TELEGRAM_BOT_TOKEN"),
      chatIds: listEnv("TELEGRAM_CHAT_IDS"),
    },
    github: {
      repo: env("GITHUB_REPO"),
      token: env("GITHUB_TOKEN"),
      labels: listEnv("GITHUB_LABELS"),
    },
    openai: {
      apiKey: env("OPENAI_API_KEY"),
      model: env("OPENAI_MODEL", "gpt-5.2"),
      reasoningEffort: env("OPENAI_REASONING_EFFORT", "high"),
      maxOutputTokens: numEnv("OPENAI_MAX_OUTPUT_TOKENS", 2000),
      compactAfterTurns: numEnv("OPENAI_COMPACT_AFTER_TURNS", 20),
      capabilityGuard: boolEnv("OPENAI_CAPABILITY_GUARD", true),
      dbMemoryEnabled: boolEnv("OPENAI_DB_MEMORY_ENABLED", true),
    },
    autoIgnore: {
      enabled: boolEnv("AUTO_IGNORE_ENABLED", true),
      oldDays: numEnv("AUTO_IGNORE_OLD_DAYS", 120),
      keywords: listEnv("AUTO_IGNORE_KEYWORDS").length
        ? listEnv("AUTO_IGNORE_KEYWORDS")
        : ["practice", "not for grade", "non-graded", "participation", "optional"],
    },
    autoUpcoming: {
      enabled: boolEnv("AUTO_UPCOMING_ENABLED", true),
      days: numEnv("AUTO_UPCOMING_DAYS", 7),
      remindHour: numEnv("AUTO_UPCOMING_REMIND_HOUR", 16),
      remindMinute: numEnv("AUTO_UPCOMING_REMIND_MINUTE", 0),
    },
    reminders: {
      autoCancelResolvedAssignmentReminders: boolEnv(
        "AUTO_CANCEL_RESOLVED_ASSIGNMENT_REMINDERS",
        true
      ),
    },
    delivery: {
      channel: env("DELIVERY_CHANNEL", "auto"),
    },
    liveChecks: {
      enabled: boolEnv("LIVE_CHECK_ENABLED", false),
      cron: env("LIVE_CHECK_CRON", "0 5 * * *"),
      chatIds: listEnv("LIVE_CHECK_CHAT_IDS"),
    },
    dashboard: {
      port: numEnv("DASHBOARD_PORT", 8787),
    },
    runtime: {
      stack: env("RUNTIME_STACK", "legacy").toLowerCase(),
    },
    debug: {
      dump: boolEnv("DEBUG_DUMP", false),
    },
    paths: {
      dataDir,
      statePath: env("STATE_PATH", path.join(dataDir, "state.json")),
      storagePath: env("STORAGE_PATH", path.join(dataDir, "storage.json")),
      debugHtmlPath: env("DEBUG_HTML_PATH", path.join(dataDir, "debug.html")),
      debugScreenshotPath: env("DEBUG_SCREENSHOT_PATH", path.join(dataDir, "debug.png")),
      agentDbPath: env("AGENT_DB_PATH", path.join(dataDir, "agent.db")),
      bugLogPath: env("BUG_LOG_PATH", path.join(dataDir, "bugs.log")),
    },
  };
}

export function getConfig() {
  return buildConfig();
}

export function validateCredentials() {
  const config = getConfig();
  const hasUser = Boolean(config.schoology.username);
  const hasPass = Boolean(config.schoology.password);
  if (hasUser && hasPass) return;

  const hasBootstrapState = Boolean(config.auth.storageStateB64 || config.auth.storageStateEncB64);
  if (hasBootstrapState) return;

  throw new Error(
    "Missing Schoology credentials. Set SCHOLOGY_USERNAME/SCHOLOGY_PASSWORD (or *_FILE), or provide STORAGE_STATE_B64/STORAGE_STATE_ENC_B64."
  );
}

export function validateEmailConfig() {
  const config = getConfig();
  const missing = [];
  if (!config.email.from) missing.push("EMAIL_FROM");
  if (!config.email.to) missing.push("EMAIL_TO");
  if (!config.email.host) missing.push("SMTP_HOST");
  if (!config.email.port) missing.push("SMTP_PORT");
  if (!config.email.user) missing.push("SMTP_USER");
  if (!config.email.pass) missing.push("SMTP_PASS");
  if (missing.length > 0) {
    throw new Error(`Missing email config in .env: ${missing.join(", ")}`);
  }
}

export function validateTwilioConfig() {
  const config = getConfig();
  const missing = [];
  if (!config.twilio.accountSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!config.twilio.authToken) missing.push("TWILIO_AUTH_TOKEN");
  if (!config.twilio.from && !config.twilio.messagingServiceSid) {
    missing.push("TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID");
  }
  if (!config.twilio.to || config.twilio.to.length === 0) missing.push("TWILIO_TO");
  if (missing.length > 0) {
    throw new Error(`Missing Twilio config in .env: ${missing.join(", ")}`);
  }
}

export function validateTelegramConfig() {
  const config = getConfig();
  const missing = [];
  if (!config.telegram.botToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (!config.telegram.chatIds || config.telegram.chatIds.length === 0) {
    missing.push("TELEGRAM_CHAT_IDS");
  }
  if (missing.length > 0) {
    throw new Error(`Missing Telegram config in .env: ${missing.join(", ")}`);
  }
}

export function validateOpenAIConfig() {
  const config = getConfig();
  if (!config.openai.apiKey) {
    throw new Error("Missing OPENAI_API_KEY in .env");
  }
}

export function resolveDeliveryChannels(configValue) {
  const channel = (configValue.delivery.channel || "auto").toLowerCase();
  if (channel === "email") return ["email"];
  if (channel === "twilio" || channel === "sms") return ["twilio"];
  if (channel === "telegram" || channel === "tg") return ["telegram"];
  if (channel === "both") return ["twilio", "email"];

  const telegramReady =
    configValue.telegram.botToken &&
    configValue.telegram.chatIds &&
    configValue.telegram.chatIds.length > 0;
  const twilioReady =
    configValue.twilio.accountSid &&
    configValue.twilio.authToken &&
    (configValue.twilio.from || configValue.twilio.messagingServiceSid) &&
    configValue.twilio.to &&
    configValue.twilio.to.length > 0;

  if (telegramReady) return ["telegram"];
  return twilioReady ? ["twilio"] : ["email"];
}
