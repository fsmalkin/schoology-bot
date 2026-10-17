import { createCurrentTermSummaryTool, currentTermSummaryToolDefinition } from "./adapter.js";

export const MCP_PROTOCOL_VERSION = "2025-11-25";
export const MAX_MCP_REQUEST_BYTES = 16 * 1024;
export const MAX_MCP_RESPONSE_BYTES = 49 * 1024;
const encoder = new TextEncoder();

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value, keys) {
  return record(value) && Object.keys(value).every(key => keys.includes(key));
}

function text(value, limit = 128) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit;
}

function requestId(value) {
  return (typeof value === "string" && value.length <= 128) || Number.isSafeInteger(value);
}

function response(body, status = 200, extraHeaders = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function failure(status, code, message, id = null, headers) {
  return response({ jsonrpc: "2.0", id, error: { code, message } }, status, headers);
}

function success(id, result) {
  const body = { jsonrpc: "2.0", id, result };
  return encoder.encode(JSON.stringify(body)).length <= MAX_MCP_RESPONSE_BYTES
    ? response(body)
    : failure(500, -32603, "Internal error", id);
}

function acceptsJsonAndEvents(value) {
  const types = (value || "").split(",").filter(entry => {
    const quality = entry.match(/;\s*q\s*=\s*([0-9.]+)/i);
    return !quality || Number(quality[1]) > 0;
  }).map(entry => entry.split(";", 1)[0].trim().toLowerCase());
  return types.includes("application/json") && types.includes("text/event-stream");
}

async function readMessage(request) {
  const declared = request.headers.get("content-length");
  if (declared !== null && !/^\d+$/.test(declared)) return { invalidLength: true };
  if (declared !== null && Number(declared) > MAX_MCP_REQUEST_BYTES) {
    try { await request.body?.cancel(); } catch {}
    return { tooLarge: true };
  }
  if (!request.body) return { invalid: true };
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        try { await reader.cancel(); } catch {}
        return { invalid: true };
      }
      length += value.byteLength;
      if (length > MAX_MCP_REQUEST_BYTES) {
        try { await reader.cancel(); } catch {}
        return { tooLarge: true };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { message: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { invalid: true };
  } finally {
    reader.releaseLock();
  }
}

function allowedOriginSet(origins) {
  return new Set(origins.map(origin => {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) {
      throw new TypeError("Allowed origins must be exact HTTPS origins.");
    }
    return origin;
  }));
}

function metaParams(params, keys = []) {
  return onlyKeys(params, [...keys, "_meta"]) && (params._meta === undefined || record(params._meta));
}

// authorizeRequest receives only trusted server context, never parsed model
// input or identity headers. It must authenticate/authorize each invocation
// and return a principal-bound, current-term read capability for this request.
export function createCurrentTermMcpHandler({
  authorizeRequest,
  allowedOrigins = [],
  now = () => new Date(),
  timeZone = "America/New_York",
} = {}) {
  const origins = allowedOriginSet(allowedOrigins);
  return async function handleMcp(request, trustedHostContext) {
    let id = null;
    try {
      const url = new URL(request.url);
      if (url.pathname !== "/mcp" || url.search || url.hash) return failure(404, -32600, "Not found");
      const origin = request.headers.get("origin");
      if (origin !== null && !origins.has(origin)) return failure(403, -32000, "Forbidden");
      if (request.method !== "POST") return failure(405, -32600, "Method not allowed", null, { Allow: "POST" });
      if (!acceptsJsonAndEvents(request.headers.get("accept"))) return failure(406, -32600, "Unsupported response media types");
      const contentType = request.headers.get("content-type") || "";
      if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) return failure(415, -32600, "Unsupported media type");
      const charset = contentType.match(/;\s*charset\s*=\s*"?([^";\s]+)/i);
      if (charset && charset[1].toLowerCase() !== "utf-8") return failure(415, -32600, "Unsupported media type");

      if (typeof authorizeRequest !== "function") return failure(401, -32000, "Unauthorized");
      let binding;
      try { binding = await authorizeRequest(trustedHostContext); }
      catch { return failure(403, -32000, "Forbidden"); }
      if (binding === null || binding === undefined) return failure(401, -32000, "Unauthorized");
      // Capture this request's reader before consuming its body. Never retain a
      // binding, principal or reader in factory/global/session state.
      const principalId = binding.principalId;
      const providerReader = binding.readCurrentTermSnapshot;
      const studentId = binding.authorizedScope?.studentId;
      const currentTermId = binding.authorizedScope?.currentTermId;
      if (!text(principalId) || !text(studentId) || !text(currentTermId, 80) || typeof providerReader !== "function") {
        return failure(403, -32000, "Forbidden");
      }

      const parsed = await readMessage(request);
      if (parsed.tooLarge) return failure(413, -32600, "Request too large");
      if (parsed.invalidLength) return failure(400, -32600, "Invalid request length");
      if (parsed.invalid) return failure(400, -32700, "Parse error");
      const message = parsed.message;
      if (!onlyKeys(message, ["jsonrpc", "id", "method", "params"]) || message.jsonrpc !== "2.0" || !text(message.method)) {
        return failure(400, -32600, "Invalid request");
      }
      const hasId = Object.hasOwn(message, "id");
      if (hasId && !requestId(message.id)) return failure(400, -32600, "Invalid request");
      id = hasId ? message.id : null;
      const version = request.headers.get("mcp-protocol-version");
      if ((version !== null && version !== MCP_PROTOCOL_VERSION) || (version === null && message.method !== "initialize")) {
        return failure(400, -32600, "Unsupported protocol version", id);
      }
      const params = message.params === undefined ? {} : message.params;
      if (!record(params)) return failure(400, -32602, "Invalid params", id);

      if (!hasId) {
        // Notifications never execute tools or read source data. No JSON-RPC
        // response is emitted; accepted initialized/cancelled notifications
        // have no per-session state to modify in this handler.
        return response(null, 202);
      }
      if (message.method === "initialize") {
        if (!metaParams(params, ["protocolVersion", "capabilities", "clientInfo"]) ||
            !text(params.protocolVersion, 32) || !record(params.capabilities) || !record(params.clientInfo) ||
            !text(params.clientInfo.name) || !text(params.clientInfo.version)) {
          return failure(400, -32602, "Invalid params", id);
        }
        return success(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "schoology-current-term", version: "0.1.0" },
        });
      }
      if (message.method === "ping" || message.method === "tools/list") {
        if (!metaParams(params)) return failure(400, -32602, "Invalid params", id);
        return success(id, message.method === "ping" ? {} : { tools: [currentTermSummaryToolDefinition] });
      }
      if (message.method === "tools/call") {
        if (!metaParams(params, ["name", "arguments"]) || !text(params.name)) return failure(400, -32602, "Invalid params", id);
        if (params.arguments !== undefined && !record(params.arguments)) return failure(400, -32602, "Invalid params", id);
        if (params.name !== currentTermSummaryToolDefinition.name) return failure(400, -32602, "Unknown tool", id);
        const readCurrentTermSnapshot = async () => {
          const input = await providerReader();
          const scope = input?.sourceScope;
          // Compare independently supplied host authorization and provider
          // declarations. Consistency is not proof of observed live identity;
          // the trusted host/provider must establish that outside this module.
          if (!record(scope) || scope.principalId !== principalId || scope.studentId !== studentId ||
              scope.currentTermId !== currentTermId || input.currentTerm?.id !== currentTermId) return null;
          return input;
        };
        const tool = createCurrentTermSummaryTool({ readCurrentTermSnapshot, now, timeZone });
        return success(id, await tool.call(params.arguments));
      }
      return failure(400, -32601, "Method not found", id);
    } catch {
      return failure(500, -32603, "Internal error", id);
    }
  };
}
