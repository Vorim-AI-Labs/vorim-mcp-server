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
const API_KEY = process.env.VORIM_API_KEY || "";
const BASE_URL = (process.env.VORIM_BASE_URL || "https://api.vorim.ai").replace(/\/$/, "");
if (!API_KEY) {
    console.error("Error: VORIM_API_KEY environment variable is required");
    process.exit(1);
}
// ─── HTTP Client ──────────────────────────────────────────────────────────
async function vorimRequest(method, path, body) {
    const response = await fetch(`${BASE_URL}/v1${path}`, {
        method,
        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
            "User-Agent": "vorim-mcp-server/1.0.0",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json();
    if (!response.ok) {
        const err = json.error;
        throw new Error(err?.message || `HTTP ${response.status}`);
    }
    return json.data;
}
async function vorimGet(path) {
    return vorimRequest("GET", path);
}
async function vorimPost(path, body) {
    return vorimRequest("POST", path, body);
}
async function vorimPatch(path, body) {
    return vorimRequest("PATCH", path, body);
}
async function vorimDelete(path) {
    return vorimRequest("DELETE", path);
}
// ─── Helpers ──────────────────────────────────────────────────────────────
function text(data) {
    return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
// ─── MCP Server ───────────────────────────────────────────────────────────
const server = new McpServer({
    name: "vorim",
    version: "1.0.0",
});
// ─── Health ───────────────────────────────────────────────────────────────
server.registerTool("vorim_ping", {
    description: "Check Vorim AI API health and connectivity. Returns status, version, and service health.",
    inputSchema: {},
}, async () => {
    const response = await fetch(`${BASE_URL}/health`, {
        headers: { "User-Agent": "vorim-mcp-server/1.0.0" },
    });
    const data = await response.json();
    return text(data);
});
// ─── Agent Identity ───────────────────────────────────────────────────────
server.registerTool("vorim_register_agent", {
    description: "Register a new AI agent with Vorim. Returns the agent identity (Ed25519 keypair, agent_id, trust score). The private key is shown once — store it securely.",
    inputSchema: {
        name: z.string().describe("Human-readable agent name"),
        description: z.string().optional().describe("Purpose or function of the agent"),
        capabilities: z.array(z.string()).describe("List of agent capabilities (e.g. ['search', 'write', 'calculate'])"),
        scopes: z.array(z.string()).describe("Permission scopes to grant (e.g. ['agent:read', 'agent:execute']). Available: agent:read, agent:write, agent:execute, agent:transact, agent:communicate, agent:delegate, agent:elevate"),
    },
}, async ({ name, description, capabilities, scopes }) => {
    const result = await vorimPost("/agents", { name, description, capabilities, scopes });
    return text(result);
});
server.registerTool("vorim_get_agent", {
    description: "Get details of a specific agent by agent_id. Returns name, status, trust score, capabilities, permissions, and metadata.",
    inputSchema: {
        agent_id: z.string().describe("The agent identifier (e.g. agid_acme_a1b2c3d4)"),
    },
}, async ({ agent_id }) => {
    const result = await vorimGet(`/agents/${agent_id}`);
    return text(result);
});
server.registerTool("vorim_list_agents", {
    description: "List all agents in the organisation. Supports pagination and filtering by status.",
    inputSchema: {
        page: z.number().optional().describe("Page number (default 1)"),
        per_page: z.number().optional().describe("Items per page (default 20)"),
        status: z.string().optional().describe("Filter by status: active, suspended, revoked"),
    },
}, async ({ page, per_page, status }) => {
    const params = new URLSearchParams();
    if (page)
        params.set("page", String(page));
    if (per_page)
        params.set("per_page", String(per_page));
    if (status)
        params.set("status", status);
    const qs = params.toString();
    const result = await vorimGet(`/agents${qs ? "?" + qs : ""}`);
    return text(result);
});
server.registerTool("vorim_update_agent", {
    description: "Update an agent's metadata (name, description, status, capabilities).",
    inputSchema: {
        agent_id: z.string().describe("The agent identifier"),
        name: z.string().optional().describe("New name"),
        description: z.string().optional().describe("New description"),
        status: z.string().optional().describe("New status: active, suspended"),
        capabilities: z.array(z.string()).optional().describe("New capabilities list"),
    },
}, async ({ agent_id, ...updates }) => {
    const body = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
    const result = await vorimPatch(`/agents/${agent_id}`, body);
    return text(result);
});
server.registerTool("vorim_revoke_agent", {
    description: "Permanently revoke an agent. This cannot be undone. The agent's identity will be deactivated and its trust score set to 0.",
    inputSchema: {
        agent_id: z.string().describe("The agent identifier to revoke"),
    },
}, async ({ agent_id }) => {
    const result = await vorimDelete(`/agents/${agent_id}`);
    return text(result);
});
// ─── Permissions ──────────────────────────────────────────────────────────
server.registerTool("vorim_check_permission", {
    description: "Check if an agent has a specific permission scope. Returns allowed (boolean), reason if denied, and remaining quota. Sub-5ms via Redis cache.",
    inputSchema: {
        agent_id: z.string().describe("The agent identifier"),
        scope: z.string().describe("Permission scope to check (e.g. agent:read, agent:execute)"),
    },
}, async ({ agent_id, scope }) => {
    const result = await vorimPost(`/agents/${agent_id}/permissions/verify`, { scope });
    return text(result);
});
server.registerTool("vorim_grant_permission", {
    description: "Grant a permission scope to an agent. Optionally set expiry and rate limits.",
    inputSchema: {
        agent_id: z.string().describe("The agent identifier"),
        scope: z.string().describe("Permission scope to grant"),
        valid_until: z.string().optional().describe("Expiry timestamp (ISO 8601)"),
        rate_limit_max: z.number().optional().describe("Maximum uses per window"),
        rate_limit_window: z.string().optional().describe("Rate limit window: 1m, 1h, or 1d"),
    },
}, async ({ agent_id, scope, valid_until, rate_limit_max, rate_limit_window }) => {
    const body = { scope };
    if (valid_until)
        body.valid_until = valid_until;
    if (rate_limit_max && rate_limit_window) {
        body.rate_limit = { max: rate_limit_max, window: rate_limit_window };
    }
    const result = await vorimPost(`/agents/${agent_id}/permissions`, body);
    return text(result);
});
server.registerTool("vorim_list_permissions", {
    description: "List all active permissions for an agent.",
    inputSchema: {
        agent_id: z.string().describe("The agent identifier"),
    },
}, async ({ agent_id }) => {
    const result = await vorimGet(`/agents/${agent_id}/permissions`);
    return text(result);
});
server.registerTool("vorim_revoke_permission", {
    description: "Revoke a specific permission scope from an agent.",
    inputSchema: {
        agent_id: z.string().describe("The agent identifier"),
        scope: z.string().describe("Permission scope to revoke"),
    },
}, async ({ agent_id, scope }) => {
    const result = await vorimDelete(`/agents/${agent_id}/permissions/${scope}`);
    return text(result);
});
// ─── Audit ────────────────────────────────────────────────────────────────
server.registerTool("vorim_emit_event", {
    description: "Log an audit event for an agent action. Every agent action should be logged for compliance and traceability.",
    inputSchema: {
        agent_id: z.string().describe("The agent that performed the action"),
        event_type: z.string().describe("Event category: tool_call, api_request, message_sent, permission_change, status_change"),
        action: z.string().describe("What the agent did (e.g. 'search_documents', 'send_email')"),
        result: z.string().describe("Outcome: success, denied, or error"),
        resource: z.string().optional().describe("Target resource identifier"),
        permission: z.string().optional().describe("Permission scope used"),
        latency_ms: z.number().optional().describe("Execution time in milliseconds"),
        error_code: z.string().optional().describe("Error code if result is 'error'"),
    },
}, async ({ agent_id, event_type, action, result, resource, permission, latency_ms, error_code }) => {
    const event = { agent_id, event_type, action, result };
    if (resource)
        event.resource = resource;
    if (permission)
        event.permission = permission;
    if (latency_ms)
        event.latency_ms = latency_ms;
    if (error_code)
        event.error_code = error_code;
    const data = await vorimPost("/audit/events", { events: [event] });
    return text(data);
});
server.registerTool("vorim_export_audit", {
    description: "Export a signed audit bundle for a date range. Returns events with a SHA-256 manifest for tamper-proof verification.",
    inputSchema: {
        from: z.string().describe("Start date (ISO 8601)"),
        to: z.string().describe("End date (ISO 8601)"),
    },
}, async ({ from, to }) => {
    const result = await vorimPost("/audit/export", { from, to });
    return text(result);
});
// ─── Trust ────────────────────────────────────────────────────────────────
server.registerTool("vorim_verify_trust", {
    description: "Verify an agent's identity and trust score. Public endpoint — no authentication required. Returns trust score (0-100), status, active scopes, and key fingerprint.",
    inputSchema: {
        agent_id: z.string().describe("The agent identifier to verify"),
    },
}, async ({ agent_id }) => {
    const response = await fetch(`${BASE_URL}/v1/trust/verify/${agent_id}`, {
        headers: { "User-Agent": "vorim-mcp-server/1.0.0" },
    });
    const json = await response.json();
    return text(json.data || json);
});
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
