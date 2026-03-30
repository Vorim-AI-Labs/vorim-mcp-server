# Vorim AI — MCP Server

MCP (Model Context Protocol) server for [Vorim AI](https://vorim.ai) — the identity and trust layer for AI agents. Exposes 13 tools for agent registration, permission checks, audit logging, and trust verification.

Works with **Claude Desktop**, **Cursor**, **VS Code**, and any MCP-compatible AI client.

## Quick Start

```bash
npm install -g @vorim/mcp-server
```

Or run directly with npx:

```bash
VORIM_API_KEY=agid_sk_live_... npx @vorim/mcp-server
```

## Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vorim": {
      "command": "npx",
      "args": ["@vorim/mcp-server"],
      "env": {
        "VORIM_API_KEY": "agid_sk_live_..."
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "vorim": {
      "command": "npx",
      "args": ["@vorim/mcp-server"],
      "env": {
        "VORIM_API_KEY": "agid_sk_live_..."
      }
    }
  }
}
```

### VS Code

Add to your VS Code MCP settings with the same format.

## Get an API Key

1. Sign up at [vorim.ai](https://vorim.ai) (free)
2. Go to **Settings > API Keys**
3. Create a key with `agents:*`, `audit:*`, `trust:*` scopes

## Available Tools (13)

### Health
| Tool | Description |
|------|-------------|
| `vorim_ping` | Check API health and connectivity |

### Agent Identity
| Tool | Description |
|------|-------------|
| `vorim_register_agent` | Register a new agent with Ed25519 cryptographic identity |
| `vorim_get_agent` | Get agent details by ID |
| `vorim_list_agents` | List all agents with pagination and filtering |
| `vorim_update_agent` | Update agent metadata (name, description, status) |
| `vorim_revoke_agent` | Permanently revoke an agent |

### Permissions
| Tool | Description |
|------|-------------|
| `vorim_check_permission` | Check if agent has a permission scope (sub-5ms) |
| `vorim_grant_permission` | Grant a permission with optional expiry and rate limits |
| `vorim_list_permissions` | List all active permissions for an agent |
| `vorim_revoke_permission` | Revoke a specific permission scope |

### Audit
| Tool | Description |
|------|-------------|
| `vorim_emit_event` | Log an audit event for an agent action |
| `vorim_export_audit` | Export signed audit bundle with SHA-256 manifest |

### Trust
| Tool | Description |
|------|-------------|
| `vorim_verify_trust` | Verify agent trust score (public, no auth required) |

## Example Usage

Once configured, use natural language in Claude, Cursor, or any MCP client:

- *"Register an agent called invoice-processor with read and execute permissions"*
- *"Check if agent agid_acme_a1b2 has permission to execute"*
- *"Log a tool_call event for the agent: action=process_invoice, result=success"*
- *"What's the trust score for agent agid_acme_a1b2?"*
- *"Export the audit trail for the last 30 days"*
- *"Revoke agent agid_acme_a1b2"*

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VORIM_API_KEY` | Yes | — | Your Vorim API key (`agid_sk_live_...`) |
| `VORIM_BASE_URL` | No | `https://api.vorim.ai` | API base URL (override for self-hosted) |

## What is Vorim AI?

Vorim AI provides the identity and trust layer for autonomous AI agents:

- **Cryptographic Identity** — Ed25519 keypairs for every agent
- **Fine-Grained Permissions** — 7 scopes with time bounds and rate limits
- **Immutable Audit Trails** — SHA-256 signed export bundles for compliance
- **Trust Scoring** — 0-100 scores based on behavioural history
- **Compliance Ready** — EU AI Act, US Executive Order 14110, SOC 2, GDPR

## Links

- **Platform:** [vorim.ai](https://vorim.ai)
- **API Docs:** [vorim.ai/docs](https://vorim.ai/docs)
- **Protocol Spec:** [github.com/Kzino/vorim-protocol](https://github.com/Kzino/vorim-protocol)
- **TypeScript SDK:** [@vorim/sdk on npm](https://www.npmjs.com/package/@vorim/sdk)
- **Python SDK:** [vorim on PyPI](https://pypi.org/project/vorim/)
- **Agent Discovery:** [vorim.ai/.well-known/agent.json](https://vorim.ai/.well-known/agent.json)

## License

MIT — see [LICENSE](LICENSE) for details.

---

Built by [Vorim AI](https://vorim.ai)
