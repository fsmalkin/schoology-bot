import twilio from "twilio";

function trimToLimit(text, limit) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const out = [];
  for (const line of lines) {
    const candidate = out.length === 0 ? line : `${out.join("\n")}\n${line}`;
    if (candidate.length > limit) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

export function buildSmsText(text, limit = 1400) {
  const normalized = String(text || "").trim();
  if (!normalized) return "";
  return trimToLimit(normalized, limit);
}

export async function sendSummarySms(config, text) {
  const client = twilio(config.twilio.accountSid, config.twilio.authToken);
  const body = buildSmsText(text);

  const basePayload = { body };
  if (config.twilio.messagingServiceSid) {
    basePayload.messagingServiceSid = config.twilio.messagingServiceSid;
  } else {
    basePayload.from = config.twilio.from;
  }

  const results = [];
  for (const to of config.twilio.to) {
    const message = await client.messages.create({
      ...basePayload,
      to,
    });
    results.push(message.sid);
  }

  return results;
}
