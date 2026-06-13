# Vorim AI — MCP Server

[![npm version](https://img.shields.io/npm/v/@vorim/mcp-server.svg)](https://www.npmjs.com/package/@vorim/mcp-server)
[![smithery badge](https://smithery.ai/badge/vorimai/vorim)](https://smithery.ai/servers/vorimai/vorim)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> Give every AI agent its own cryptographic identity, scoped permissions, and a tamper-evident audit trail — directly from Claude Desktop, Cursor, or any MCP-compatible client.

## What is Vorim AI?

Vorim AI is the identity and trust layer for autonomous AI agents. It gives each agent its own Ed25519 keypair, time-bounded scoped permissions, hash-linked audit events, and a publicly verifiable trust score — so when an agent does something, you can prove who acted, what they were allowed to do, and what happened.

The protocol underneath (VAIP) is open, MIT-licensed, and submitted to IETF as `draft-nyantakyi-vaip-agent-identity-01`.

This package is the **MCP (Model Context Protocol) server** that exposes 17 Vorim tools to any MCP-compatible AI client.

Works with **Claude Desktop**, **Cursor**, **VS Code**, and any other MCP client.

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

1. Sign up at [vorim.ai](https://vorim.ai) (free, no credit card)
2. Go to **Settings > API Keys**
3. Create a key with `agents:*`, `audit:*`, `trust:*` scopes

## Available Tools (17)

### Health
| Tool | Description |
|------|-------------|
| `vorim_ping` | Check API health and connectivity |

### Agent Identity
| Tool | Description |
|------|-------------|
| `vorim_register_agent` | Register a new agent with Ed25519 cryptographic identity |
| `vorim_register_ephemeral` | Register a `did:key` ephemeral agent with TTL |
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

### Credential Delegation
| Tool | Description |
|------|-------------|
| `vorim_delegate_credential` | Delegate OAuth credentials to an agent |
| `vorim_request_token` | Agent requests a short-lived access token |
| `vorim_list_delegations` | List active credential delegations |

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
- *"Delegate my GitHub OAuth token to this agent for 24 hours"*
- *"Revoke agent agid_acme_a1b2"*

## Why Use Vorim AI

- **Cryptographic identity** — Ed25519 keypairs for every agent. Not a shared service account.
- **Fine-grained permissions** — 7 scopes with time bounds and rate limits, sub-5ms checks.
- **Tamper-evident audit trails** — SHA-256 hash-linked events, signed export bundles for compliance.
- **Public trust scoring** — anyone can verify any agent without auth (no shared secrets).
- **Open protocol** — VAIP submitted to IETF, MIT-licensed, freely implementable.
- **Compliance-ready** — EU AI Act, US Executive Order 14110, SOC 2, GDPR.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VORIM_API_KEY` | Yes | — | Your Vorim API key (`agid_sk_live_...`) |
| `VORIM_BASE_URL` | No | `https://api.vorim.ai` | API base URL (override for self-hosted) |

## Links

- **Platform:** [vorim.ai](https://vorim.ai)
- **API Docs:** [vorim.ai/docs](https://vorim.ai/docs)
- **Protocol Spec (VAIP):** [github.com/Vorim-AI-Labs/vorim-protocol](https://github.com/Vorim-AI-Labs/vorim-protocol)
- **TypeScript SDK:** [@vorim/sdk on npm](https://www.npmjs.com/package/@vorim/sdk)
- **Python SDK:** [vorim on PyPI](https://pypi.org/project/vorim/)
- **OpenClaw Skill:** [Vorim-AI-Labs/vorim-openclaw-skill](https://github.com/Vorim-AI-Labs/vorim-openclaw-skill)
- **Agent Discovery:** [vorim.ai/.well-known/agent.json](https://vorim.ai/.well-known/agent.json)

## License

MIT — see [LICENSE](LICENSE) for details.

---

Built by [Vorim AI](https://vorim.ai). Questions or feedback: [kwame@vorim.ai](mailto:kwame@vorim.ai).
