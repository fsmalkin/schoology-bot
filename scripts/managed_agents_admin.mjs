import "dotenv/config";
import { buildManagedAgentDefinition, buildManagedEnvironmentDefinition } from "../src/managed_agent_definitions.js";

const BASE_URL = String(process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
const API_KEY = String(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "").trim();
const BETA_HEADER = process.env.CLAUDE_MANAGED_AGENTS_BETA || "managed-agents-2026-04-01";
const ANTHROPIC_VERSION = "2023-06-01";

function usage() {
  console.error(
    [
      "Usage:",
      "  node -r dotenv/config scripts/managed_agents_admin.mjs render-agent [dev|prod]",
      "  node -r dotenv/config scripts/managed_agents_admin.mjs render-environment [dev|prod]",
      "  node -r dotenv/config scripts/managed_agents_admin.mjs create-agent [dev|prod]",
      "  node -r dotenv/config scripts/managed_agents_admin.mjs update-agent <agent_id> <version> [dev|prod]",
      "  node -r dotenv/config scripts/managed_agents_admin.mjs retrieve-agent <agent_id>",
      "  node -r dotenv/config scripts/managed_agents_admin.mjs list-agents",
      "  node -r dotenv/config scripts/managed_agents_admin.mjs create-memory-store <name> <description>",
      "  node -r dotenv/config scripts/managed_agents_admin.mjs list-memory-stores",
      "  node -r dotenv/config scripts/managed_agents_admin.mjs retrieve-memory-store <memory_store_id>",
      "  node -r dotenv/config scripts/managed_agents_admin.mjs create-memory <memory_store_id> <path> <content>",
      "  node -r dotenv/config scripts/managed_agents_admin.mjs list-memories <memory_store_id> [path_prefix]",
      "  node -r dotenv/config scripts/managed_agents_admin.mjs create-environment [dev|prod]",
      "  node -r dotenv/config scripts/managed_agents_admin.mjs retrieve-environment <environment_id>",
      "  node -r dotenv/config scripts/managed_agents_admin.mjs list-environments",
      "",
      "Example with local dev env:",
      "  node scripts/with_env.js .env.managed-dev node -r dotenv/config scripts/managed_agents_admin.mjs create-environment dev",
    ].join("\n")
  );
  process.exit(1);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function requireApiKey() {
  if (!API_KEY) {
    throw new Error("ANTHROPIC_API_KEY or CLAUDE_API_KEY is required in the selected env file.");
  }
}

async function apiRequest(method, path, body = null) {
  requireApiKey();
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-beta": BETA_HEADER,
      "x-api-key": API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    const detail = parsed?.error?.message || parsed?.message || text || response.statusText;
    throw new Error(`Claude API ${method} ${path} failed (${response.status}): ${detail}`);
  }
  return parsed || {};
}

function environmentFromArg(value) {
  const raw = String(value || "dev").trim().toLowerCase();
  if (raw !== "dev" && raw !== "prod") {
    throw new Error("Environment must be dev or prod.");
  }
  return raw;
}

function hintForCreatedResource(kind, result) {
  if (!result?.id) return;
  if (kind === "agent") {
    console.error(`\nSet this in your env file:\nCLAUDE_MANAGED_AGENT_ID=${result.id}`);
    if (Number.isFinite(Number(result.version))) {
      console.error(`# Current agent version: ${result.version}`);
    }
  }
  if (kind === "environment") {
    console.error(`\nSet this in your env file:\nCLAUDE_MANAGED_ENVIRONMENT_ID=${result.id}`);
  }
  if (kind === "memory-store") {
    console.error(`\nSet this in your env file:\nCLAUDE_MANAGED_MEMORY_STORE_ID=${result.id}`);
  }
}

async function main() {
  const [command, arg1, arg2, arg3] = process.argv.slice(2);
  if (!command) usage();

  switch (command) {
    case "render-agent": {
      printJson(buildManagedAgentDefinition({ environment: environmentFromArg(arg1) }));
      return;
    }
    case "render-environment": {
      printJson(buildManagedEnvironmentDefinition({ environment: environmentFromArg(arg1) }));
      return;
    }
    case "create-agent": {
      const result = await apiRequest(
        "POST",
        "/v1/agents",
        buildManagedAgentDefinition({ environment: environmentFromArg(arg1) })
      );
      printJson(result);
      hintForCreatedResource("agent", result);
      return;
    }
    case "update-agent": {
      if (!arg1 || !arg2) usage();
      const version = Number(arg2);
      if (!Number.isFinite(version) || version < 1) {
        throw new Error("update-agent requires the current numeric version.");
      }
      const payload = {
        ...buildManagedAgentDefinition({ environment: environmentFromArg(arg3) }),
        version,
      };
      const result = await apiRequest("POST", `/v1/agents/${encodeURIComponent(arg1)}`, payload);
      printJson(result);
      hintForCreatedResource("agent", result);
      return;
    }
    case "retrieve-agent": {
      if (!arg1) usage();
      printJson(await apiRequest("GET", `/v1/agents/${encodeURIComponent(arg1)}`));
      return;
    }
    case "list-agents": {
      printJson(await apiRequest("GET", "/v1/agents"));
      return;
    }
    case "create-memory-store": {
      if (!arg1 || !arg2) usage();
      const result = await apiRequest("POST", "/v1/memory_stores", {
        name: arg1,
        description: arg2,
      });
      printJson(result);
      hintForCreatedResource("memory-store", result);
      return;
    }
    case "list-memory-stores": {
      printJson(await apiRequest("GET", "/v1/memory_stores"));
      return;
    }
    case "retrieve-memory-store": {
      if (!arg1) usage();
      printJson(await apiRequest("GET", `/v1/memory_stores/${encodeURIComponent(arg1)}`));
      return;
    }
    case "create-memory": {
      if (!arg1 || !arg2 || !arg3) usage();
      printJson(
        await apiRequest("POST", `/v1/memory_stores/${encodeURIComponent(arg1)}/memories`, {
          path: arg2,
          content: arg3,
        })
      );
      return;
    }
    case "list-memories": {
      if (!arg1) usage();
      const prefix = arg2 || "/";
      printJson(
        await apiRequest(
          "GET",
          `/v1/memory_stores/${encodeURIComponent(arg1)}/memories?path_prefix=${encodeURIComponent(prefix)}`
        )
      );
      return;
    }
    case "create-environment": {
      const result = await apiRequest(
        "POST",
        "/v1/environments",
        buildManagedEnvironmentDefinition({ environment: environmentFromArg(arg1) })
      );
      printJson(result);
      hintForCreatedResource("environment", result);
      return;
    }
    case "retrieve-environment": {
      if (!arg1) usage();
      printJson(await apiRequest("GET", `/v1/environments/${encodeURIComponent(arg1)}`));
      return;
    }
    case "list-environments": {
      printJson(await apiRequest("GET", "/v1/environments"));
      return;
    }
    default:
      usage();
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
