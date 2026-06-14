#!/usr/bin/env node
// ============================================================================
// Vorim AI — MCP Server
// Exposes Vorim agent identity, permissions, audit, and trust operations
// as MCP tools for Claude, Cursor, VS Code, and any MCP-compatible client.
//
// Usage:
//   VORIM_API_KEY=agid_sk_live_... vorim-mcp-server
//
// Or configure in Claude Desktop:
//   {
//     "mcpServers": {
//       "vorim": {
//         "command": "npx",
//         "args": ["@vorim/mcp-server"],
//         "env": { "VORIM_API_KEY": "agid_sk_live_..." }
//       }
//     }
//   }
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// SECURITY: The MCP server uses a single process-wide Vorim API key
// taken from VORIM_API_KEY at startup. The stdio transport between
// the MCP host (e.g. Claude Desktop) and this process carries NO
// per-call auth — every tool call is attributed to the configured
// key. Two consequences:
//   1. Scope the key tightly. The key's scopes (audit:read,
//      audit:write, agent:write, etc.) determine which MCP tools
//      will actually work; a least-privilege scoped key reduces
//      blast radius if the host environment is compromised.
//   2. Do not share a key across MCP installations. Each user /
//      machine should mint its own key so revocation surgically
//      kills exactly one installation.
const API_KEY = process.env.VORIM_API_KEY || "";
const BASE_URL = (process.env.VORIM_BASE_URL || "https://api.vorim.ai").replace(/\/$/, "");

// The 7 canonical permission scopes (must match the API's VALID_SCOPES).
const SCOPE_ENUM = z.enum([
  "agent:read", "agent:write", "agent:execute", "agent:transact",
  "agent:communicate", "agent:delegate", "agent:elevate",
]);

if (!API_KEY) {
  console.error("Error: VORIM_API_KEY environment variable is required");
  process.exit(1);
}

// ─── HTTP Client ──────────────────────────────────────────────────────────

// Read the package version once so the User-Agent string and the
// MCP server's advertised version stay in sync with package.json.
//
// Caveats:
//   1. Bundlers (esbuild / webpack) that inline the source can break
//      the readFileSync path because import.meta.url no longer points
//      at the npm install layout. The fallback constant below is the
//      last-known version and MUST be bumped in lockstep with
//      package.json — there is NO CI assertion enforcing this today.
//   2. If readFileSync succeeds but JSON.parse fails (corrupt file),
//      we log a warning so operators see the silent drift rather
//      than discovering it via a User-Agent grep weeks later.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MCP_VERSION_FALLBACK = "1.1.10";

function readMcpVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (typeof pkg.version === "string") return pkg.version;
    // eslint-disable-next-line no-console
    console.warn(`[vorim-mcp-server] package.json missing version field — using fallback ${MCP_VERSION_FALLBACK}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[vorim-mcp-server] could not read package.json (${(err as Error).message ?? err}) — ` +
      `using fallback ${MCP_VERSION_FALLBACK}. If this is a bundled build, bump ` +
      `MCP_VERSION_FALLBACK in lockstep with the published package.`,
    );
  }
  return MCP_VERSION_FALLBACK;
}
const MCP_VERSION = readMcpVersion();

/**
 * URL-encode a user-supplied path segment. Agent ids, scopes, and
 * chain ids all reach the API via path interpolation; raw slashes or
 * other special characters from a misbehaving caller would otherwise
 * either escape the intended route or be sent verbatim.
 */
function encId(s: string): string {
  return encodeURIComponent(s);
}

async function vorimRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${BASE_URL}/v1${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": `vorim-mcp-server/${MCP_VERSION}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Hand out clearer error messages for the common cases an MCP user
  // will see. Auth: the API key is wrong or revoked. Scope: the key
  // is missing the scope this route requires (e.g. audit:write).
  if (response.status === 401) {
    throw new Error("Vorim API key is invalid, revoked, or expired. Check VORIM_API_KEY.");
  }
  if (response.status === 403) {
    const j = await response.json().catch(() => ({})) as Record<string, unknown>;
    const err = j.error as Record<string, unknown> | undefined;
    const code = err?.code as string | undefined;
    if (code === "INSUFFICIENT_SCOPE") {
      throw new Error(
        (err?.message as string) ||
        "Vorim API key is missing the scope required for this operation. Mint a new key with the required scope and update VORIM_API_KEY.",
      );
    }
    throw new Error((err?.message as string) || "Vorim API rejected with 403");
  }

  // Be defensive about non-JSON 5xx bodies (nginx 502, gateway HTML).
  // Without this, response.json() throws "Unexpected token <" and the
  // user sees an unhelpful parser error.
  let json: Record<string, unknown>;
  try {
    json = await response.json() as Record<string, unknown>;
  } catch {
    if (!response.ok) {
      throw new Error(`Vorim API returned HTTP ${response.status} (non-JSON response — check upstream gateway)`);
    }
    throw new Error("Vorim API returned a non-JSON success response");
  }

  if (!response.ok) {
    const err = json.error as Record<string, unknown> | undefined;
    throw new Error(err?.message as string || `HTTP ${response.status}`);
  }

  return json.data;
}

async function vorimGet(path: string): Promise<unknown> {
  return vorimRequest("GET", path);
}

// List endpoints return { data, meta } and vorimRequest unwraps to data,
// dropping pagination meta. For list tools, fetch the full envelope so the
// caller can paginate (page/total/total_pages).
async function vorimGetEnvelope(path: string): Promise<{ data: unknown; meta?: unknown }> {
  const response = await fetch(`${BASE_URL}/v1${path}`, {
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "User-Agent": `vorim-mcp-server/${MCP_VERSION}`,
    },
  });
  if (!response.ok) {
    const j = await response.json().catch(() => ({})) as Record<string, unknown>;
    const err = j.error as Record<string, unknown> | undefined;
    throw new Error((err?.message as string) || `HTTP ${response.status}`);
  }
  const json = await response.json() as Record<string, unknown>;
  return { data: json.data, meta: json.meta };
}

async function vorimPost(path: string, body: unknown): Promise<unknown> {
  return vorimRequest("POST", path, body);
}

async function vorimPatch(path: string, body: unknown): Promise<unknown> {
  return vorimRequest("PATCH", path, body);
}

async function vorimDelete(path: string): Promise<unknown> {
  return vorimRequest("DELETE", path);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function text(data: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

// ─── MCP Server ───────────────────────────────────────────────────────────

const server = new McpServer({
  name: "vorim",
  version: MCP_VERSION,
});

// ─── Health ───────────────────────────────────────────────────────────────

server.registerTool(
  "vorim_ping",
  {
    description: "Check Vorim AI API health and connectivity. Returns status, version, and service health.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const response = await fetch(`${BASE_URL}/health`, {
      headers: { "User-Agent": `vorim-mcp-server/${MCP_VERSION}` },
    });
    if (!response.ok) {
      throw new Error(`Vorim API health endpoint returned HTTP ${response.status}`);
    }
    try {
      const data = await response.json();
      return text(data);
    } catch {
      throw new Error(`Vorim API returned a non-JSON health response (status ${response.status}); check upstream gateway`);
    }
  },
);

// ─── Agent Identity ───────────────────────────────────────────────────────

server.registerTool(
  "vorim_register_agent",
  {
    description: "Register a new AI agent with Vorim. Returns the agent identity (Ed25519 keypair, agent_id, trust score). The private key is shown once — store it securely.",
    inputSchema: {
      name: z.string().describe("Human-readable agent name"),
      description: z.string().optional().describe("Purpose or function of the agent"),
      capabilities: z.array(z.string()).describe("List of agent capabilities (e.g. ['search', 'write', 'calculate'])"),
      scopes: z.array(z.string()).describe("Permission scopes to grant (e.g. ['agent:read', 'agent:execute']). Available: agent:read, agent:write, agent:execute, agent:transact, agent:communicate, agent:delegate, agent:elevate"),
    },
  },
  async ({ name, description, capabilities, scopes }) => {
    const result = await vorimPost("/agents", { name, description, capabilities, scopes });
    return text(result);
  },
);

server.registerTool(
  "vorim_get_agent",
  {
    description: "Get details of a specific agent by agent_id. Returns name, status, trust score, capabilities, permissions, and metadata.",
    inputSchema: {
      agent_id: z.string().describe("The agent identifier (e.g. agid_acme_a1b2c3d4)"),
    },
  },
  async ({ agent_id }) => {
    const result = await vorimGet(`/agents/${encId(agent_id)}`);
    return text(result);
  },
);

server.registerTool(
  "vorim_list_agents",
  {
    description: "List all agents in the organisation. Supports pagination and filtering by status.",
    inputSchema: {
      page: z.number().optional().describe("Page number (default 1)"),
      per_page: z.number().optional().describe("Items per page (default 20)"),
      status: z.string().optional().describe("Filter by status: active, suspended, revoked"),
    },
  },
  async ({ page, per_page, status }) => {
    const params = new URLSearchParams();
    if (page) params.set("page", String(page));
    if (per_page) params.set("per_page", String(per_page));
    if (status) params.set("status", status);
    const qs = params.toString();
    const { data, meta } = await vorimGetEnvelope(`/agents${qs ? "?" + qs : ""}`);
    return text({ agents: data, meta });
  },
);

server.registerTool(
  "vorim_update_agent",
  {
    description: "Update an agent's metadata (name, description, status).",
    inputSchema: {
      agent_id: z.string().describe("The agent identifier"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      status: z.enum(["pending", "active", "suspended", "revoked", "expired"]).optional()
        .describe("New status"),
      // capabilities are set at registration only; the update API does not
      // change them, so the field is intentionally omitted.
    },
  },
  async ({ agent_id, ...updates }) => {
    const body = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
    const result = await vorimPatch(`/agents/${encId(agent_id)}`, body);
    return text(result);
  },
);

server.registerTool(
  "vorim_revoke_agent",
  {
    description: "Permanently revoke an agent. This cannot be undone. The agent's identity will be deactivated and its trust score set to 0.",
    inputSchema: {
      agent_id: z.string().describe("The agent identifier to revoke"),
    },
    annotations: { destructiveHint: true, idempotentHint: true, readOnlyHint: false },
  },
  async ({ agent_id }) => {
    const result = await vorimDelete(`/agents/${encId(agent_id)}`);
    return text(result);
  },
);

// ─── Permissions ──────────────────────────────────────────────────────────

server.registerTool(
  "vorim_check_permission",
  {
    description: "Check if an agent has a specific permission scope. Returns allowed (boolean), reason if denied, and remaining quota. Sub-5ms via Redis cache.",
    inputSchema: {
      agent_id: z.string().describe("The agent identifier"),
      scope: SCOPE_ENUM.describe("Permission scope to check"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ agent_id, scope }) => {
    const result = await vorimPost(`/agents/${encId(agent_id)}/permissions/verify`, { scope });
    return text(result);
  },
);

server.registerTool(
  "vorim_grant_permission",
  {
    description: "Grant a permission scope to an agent. Optionally set expiry and rate limits.",
    inputSchema: {
      agent_id: z.string().describe("The agent identifier"),
      scope: SCOPE_ENUM.describe("Permission scope to grant"),
      valid_until: z.string().optional().describe("Expiry timestamp (ISO 8601)"),
      rate_limit_max: z.number().optional().describe("Maximum uses per window"),
      rate_limit_window: z.string().optional().describe("Rate limit window: 1m, 1h, or 1d"),
    },
  },
  async ({ agent_id, scope, valid_until, rate_limit_max, rate_limit_window }) => {
    const body: Record<string, unknown> = { scope };
    if (valid_until) body.valid_until = valid_until;
    if (rate_limit_max && rate_limit_window) {
      body.rate_limit = { max: rate_limit_max, window: rate_limit_window };
    }
    const result = await vorimPost(`/agents/${encId(agent_id)}/permissions`, body);
    return text(result);
  },
);

server.registerTool(
  "vorim_list_permissions",
  {
    description: "List all active permissions for an agent.",
    inputSchema: {
      agent_id: z.string().describe("The agent identifier"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ agent_id }) => {
    const result = await vorimGet(`/agents/${encId(agent_id)}/permissions`);
    return text(result);
  },
);

server.registerTool(
  "vorim_revoke_permission",
  {
    description: "Revoke a specific permission scope from an agent.",
    inputSchema: {
      agent_id: z.string().describe("The agent identifier"),
      scope: SCOPE_ENUM.describe("Permission scope to revoke"),
    },
    annotations: { destructiveHint: true, idempotentHint: true, readOnlyHint: false },
  },
  async ({ agent_id, scope }) => {
    const result = await vorimDelete(`/agents/${encId(agent_id)}/permissions/${encId(scope)}`);
    return text(result);
  },
);

// ─── Audit ────────────────────────────────────────────────────────────────

server.registerTool(
  "vorim_emit_event",
  {
    description: "Log an audit event for an agent action. Every agent action should be logged for compliance and traceability. NOTE: events emitted via the MCP server are sent unsigned because the MCP server does not hold the agent's private key. For tamper-evident audit trails sign client-side via @vorim/sdk before emit.",
    inputSchema: {
      agent_id: z.string().describe("The agent that performed the action"),
      event_type: z.enum(["tool_call", "api_request", "message_sent", "permission_change", "status_change", "key_rotation", "login", "export"])
        .describe("Event category"),
      action: z.string().describe("What the agent did (e.g. 'search_documents', 'send_email')"),
      result: z.enum(["success", "denied", "error"]).describe("Outcome"),
      resource: z.string().optional().describe("Target resource identifier"),
      permission: z.enum(["agent:read", "agent:write", "agent:execute", "agent:transact", "agent:communicate", "agent:delegate", "agent:elevate"])
        .optional().describe("Permission scope used"),
      latency_ms: z.number().optional().describe("Execution time in milliseconds"),
      error_code: z.string().optional().describe("Error code if result is 'error'"),
    },
  },
  async ({ agent_id, event_type, action, result, resource, permission, latency_ms, error_code }) => {
    const event: Record<string, unknown> = { agent_id, event_type, action, result };
    if (resource) event.resource = resource;
    if (permission) event.permission = permission;
    if (latency_ms) event.latency_ms = latency_ms;
    if (error_code) event.error_code = error_code;
    const data = await vorimPost("/audit/events", { events: [event] });
    return text(data);
  },
);

server.registerTool(
  "vorim_export_audit",
  {
    description: "Export a signed audit bundle for a date range. Returns events with a SHA-256 manifest for tamper-proof verification. Window must be <= 90 days; the server returns 400 if from > to or the range exceeds the cap. The returned bundle has up to 1,000,000 events; if truncated, the response carries `truncated: true` and the caller should re-export a narrower window.",
    inputSchema: {
      from: z.string().describe("Start date in ISO 8601 (e.g. 2026-06-01T00:00:00Z)"),
      to: z.string().describe("End date in ISO 8601 (must be on or after `from`; window <= 90 days)"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ from, to }) => {
    const result = await vorimPost("/audit/export", { from, to });
    return text(result);
  },
);

// ─── Trust ────────────────────────────────────────────────────────────────

server.registerTool(
  "vorim_verify_trust",
  {
    description: "Verify an agent's identity and trust score. Public endpoint — no authentication required. Returns trust score (0-100), status, active scopes, and key fingerprint.",
    inputSchema: {
      agent_id: z.string().describe("The agent identifier to verify"),
    },
  },
  async ({ agent_id }) => {
    const response = await fetch(`${BASE_URL}/v1/trust/verify/${encId(agent_id)}`, {
      headers: { "User-Agent": `vorim-mcp-server/${MCP_VERSION}` },
    });
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Agent ${agent_id} is not registered with Vorim`);
      }
      throw new Error(`Vorim trust endpoint returned HTTP ${response.status}`);
    }
    let json: Record<string, unknown>;
    try {
      json = await response.json() as Record<string, unknown>;
    } catch {
      throw new Error(`Vorim trust endpoint returned a non-JSON response (status ${response.status})`);
    }
    return text(json.data || json);
  },
);

// ─── Ephemeral Agents ────────────────────────────────────────────────────

server.registerTool(
  "vorim_register_ephemeral",
  {
    description: "Register an ephemeral agent with a did:key identity. Short-lived agents that auto-expire. Returns agent_id, did:key, and keypair.",
    inputSchema: {
      capabilities: z.array(z.string()).describe("List of agent capabilities (e.g. ['search', 'write'])"),
      scopes: z.array(z.string()).describe("Permission scopes to grant (e.g. ['agent:read', 'agent:execute'])"),
      ttl_seconds: z.number().optional().describe("Time-to-live in seconds before the agent auto-expires"),
    },
  },
  async ({ capabilities, scopes, ttl_seconds }) => {
    const body: Record<string, unknown> = { capabilities, scopes };
    if (ttl_seconds) body.ttl_seconds = ttl_seconds;
    const result = await vorimPost("/agents/ephemeral", body);
    return text(result);
  },
);

// ─── Credential Delegation ──────────────────────────────────────────────

server.registerTool(
  "vorim_delegate_credential",
  {
    description: "Delegate a credential to an agent. Creates a scoped delegation with optional rate limits and expiry.",
    inputSchema: {
      connection_id: z.string().describe("The connection or credential identifier to delegate"),
      agent_id: z.string().describe("The agent receiving the delegation"),
      scopes_delegated: z.array(z.string()).describe("Scopes to delegate (e.g. ['read', 'write'])"),
      max_requests_per_hr: z.number().optional().describe("Maximum requests per hour for this delegation"),
      valid_until: z.string().optional().describe("Expiry timestamp (ISO 8601)"),
    },
  },
  async ({ connection_id, agent_id, scopes_delegated, max_requests_per_hr, valid_until }) => {
    const body: Record<string, unknown> = { connection_id, agent_id, scopes_delegated };
    if (max_requests_per_hr) body.max_requests_per_hr = max_requests_per_hr;
    if (valid_until) body.valid_until = valid_until;
    const result = await vorimPost("/credentials/delegations", body);
    return text(result);
  },
);

server.registerTool(
  "vorim_request_token",
  {
    description: "Request a short-lived access token for an agent. Returns a scoped token for the specified provider.",
    inputSchema: {
      agent_id: z.string().describe("The agent requesting the token"),
      scope: z.string().describe("Permission scope for the token"),
      provider_id: z.string().optional().describe("Target provider identifier"),
    },
  },
  async ({ agent_id, scope, provider_id }) => {
    const body: Record<string, unknown> = { agent_id, scope };
    if (provider_id) body.provider_id = provider_id;
    const result = await vorimPost("/credentials/token", body);
    return text(result);
  },
);

server.registerTool(
  "vorim_list_delegations",
  {
    description: "List credential delegations. Optionally filter by agent_id to see delegations for a specific agent.",
    inputSchema: {
      agent_id: z.string().optional().describe("Filter delegations by agent identifier"),
    },
  },
  async ({ agent_id }) => {
    const params = new URLSearchParams();
    if (agent_id) params.set("agent_id", agent_id);
    const qs = params.toString();
    const result = await vorimGet(`/credentials/delegations${qs ? "?" + qs : ""}`);
    return text(result);
  },
);

// ─── Start ────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Vorim MCP Server running — connected via stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
