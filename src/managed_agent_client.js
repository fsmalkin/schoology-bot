const ANTHROPIC_VERSION = "2023-06-01";

function joinUrl(baseUrl, path) {
  const base = String(baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  return `${base}${path}`;
}

async function readJsonResponse(response) {
  const raw = await response.text();
  let parsed = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    const detail = parsed?.error?.message || parsed?.message || raw || response.statusText;
    throw new Error(`Claude Managed Agents API error ${response.status}: ${detail}`);
  }
  return parsed || {};
}

function parseSseBlock(block) {
  const lines = String(block || "").split(/\r?\n/);
  const data = [];
  let eventType = "";
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    const index = line.indexOf(":");
    const field = index === -1 ? line : line.slice(0, index);
    const value = index === -1 ? "" : line.slice(index + 1).replace(/^ /, "");
    if (field === "data") data.push(value);
    if (field === "event") eventType = value;
  }
  if (data.length === 0) return null;
  const raw = data.join("\n");
  if (raw === "[DONE]") return null;
  try {
    const parsed = JSON.parse(raw);
    if (eventType && parsed && typeof parsed === "object" && !parsed.event) {
      parsed.event = eventType;
    }
    return parsed;
  } catch {
    return { type: eventType || "message", data: raw };
  }
}

export async function* parseServerSentEvents(readable) {
  if (!readable) return;
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const parsed = parseSseBlock(block);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode();
    const parsed = parseSseBlock(buffer);
    if (parsed) yield parsed;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

export class ManagedAgentClient {
  constructor(config, { fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new Error("ManagedAgentClient requires fetch support.");
    }
    this.config = config;
    this.fetch = fetchImpl;
  }

  headers(extra = {}) {
    return {
      "content-type": "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-beta": this.config.betaHeader,
      "x-api-key": this.config.apiKey,
      ...extra,
    };
  }

  async createSession({ title, metadata, resources } = {}) {
    const body = {
      agent: this.config.agentId,
      environment_id: this.config.environmentId,
    };
    if (title) body.title = title;
    if (metadata && typeof metadata === "object") body.metadata = metadata;
    if (Array.isArray(resources) && resources.length > 0) body.resources = resources;

    const response = await this.fetch(joinUrl(this.config.baseUrl, "/v1/sessions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    return readJsonResponse(response);
  }

  async retrieveSession(sessionId) {
    const response = await this.fetch(
      joinUrl(this.config.baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}`),
      {
        method: "GET",
        headers: this.headers(),
      }
    );
    return readJsonResponse(response);
  }

  async sendEvents(sessionId, events) {
    const response = await this.fetch(
      joinUrl(this.config.baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/events`),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ events }),
      }
    );
    return readJsonResponse(response);
  }

  async *streamEvents(sessionId, { signal } = {}) {
    const response = await this.fetch(
      joinUrl(this.config.baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/events/stream`),
      {
        method: "GET",
        headers: this.headers({ accept: "text/event-stream" }),
        signal,
      }
    );
    if (!response.ok) {
      await readJsonResponse(response);
      return;
    }
    yield* parseServerSentEvents(response.body);
  }
}

export function createManagedAgentClient(config, options = {}) {
  return new ManagedAgentClient(config, options);
}
