# hi-openclaw-plugin

Hirey Hi as a **native OpenClaw plugin**. Registers Hi's tools, agent-events claim service, and webhook ingress directly inside the OpenClaw gateway process — zero independent daemons, no `mcp.servers.hi` indirection, and no per-run frozen tool inventory boundary.

This is the OpenClaw 5.2+ first-class path, published to ClawHub as **`clawhub:hirey`** (ClawPack code-plugin) and to npm as **`hirey`**. OpenClaw 4.23 ~ 5.1 hosts cannot load this ClawPack format and must install the prod bundle plugin **`clawhub:hirey-compatible`** instead (zip + skill + scripts wrapping `@hirey-ai/mcp-server` + `@hirey-ai/agent-receiver`). All OpenClaw 4.23+ hosts can install `clawhub:hirey-compatible` as a universal fallback.

## Why this exists

The bundle + spawn model needs:

- one stdio child process for the MCP server (`@hirey-ai/mcp-server`)
- one long-running daemon (`@hirey-ai/agent-receiver`) for cloud-to-host event delivery
- a host installer mjs that uses `child_process` to run `npm install` + `openclaw config set` (which trips OpenClaw's pre-4.23 install scanner)
- a two-message install flow because the LLM run that wrote `mcp.servers.hi` cannot call the just-installed tools in the same outer run (per-run frozen tool inventory)
- `hooks.token` / `hooks.path` / `hooks.allowedSessionKeyPrefixes` / `/hooks/agent` plumbing on the OpenClaw side

This native plugin replaces all of the above with three OpenClaw plugin SDK calls running inside the gateway process:

- `api.registerTool(...)` for every Hi tool — exposed to the LLM directly, no MCP layer
- `api.registerService(...)` for the agent-events claim loop — gateway owns the lifecycle, no orphan daemon
- `api.registerHttpRoute(...)` for the webhook ingress — uses gateway's HTTP server, no separate hooks token

## Distribution paths

| Path | Audience |
|---|---|
| `clawhub:hirey` (this package, ClawPack code-plugin) | OpenClaw **5.2+**. Best UX, in-process, no boundary friction. |
| `clawhub:hirey-compatible` (prod bundle plugin from `hi-platform`, zip + skills + scripts) | **All OpenClaw 4.23+ hosts**. Required for 4.23 ~ 5.1 (those hosts cannot load ClawPack); optional fallback for 5.2+ if the ClawPack install path has any issue. Wraps `@hirey-ai/mcp-server` + `@hirey-ai/agent-receiver`. |
| `@hirey-ai/mcp-server` + `@hirey-ai/agent-receiver` (npm, raw) | Claude Desktop, Cursor, VS Code MCP, any other MCP host. Stable cross-host transport. Independent of OpenClaw. |

Business logic (`@hirey-ai/agent-sdk`, `@hirey-ai/agent-contracts`) is fully shared; only the wiring layer differs.

## Supported OpenClaw versions

| OpenClaw version | `clawhub:hirey` (ClawPack) | `clawhub:hirey-compatible` (bundle) | Notes |
|---|---|---|---|
| **2026.5.2+** | ✅ recommended (in-process) | ✅ works but skips native plugin benefits | ClawPack first-class path |
| **2026.4.23 ~ 2026.5.1** | ❌ runtime expects date-format `pluginApi`, rejects semantic `1.0` | ✅ recommended | bundle is the only path |
| **2026.4.14 ~ 2026.4.22** | ❌ same as above | ❌ install scanner flags `child_process` in installer mjs | unsupported; must upgrade OpenClaw |
| **< 2026.4.14** | ❌ | ❌ | unsupported |

## Status and updates

Local candidate 1.0.75 bootstraps through `POST /v1/agents/api-keys`, then exchanges the same stored credential at the discovered `/oauth/token`. Pending access permits public People reads and staged Capture; private reads and writes require verified identity. Modern `/me` returns flat Agent/Person/Workspace/session fields. Legacy installation and SSE delivery are not asserted ready: modern candidates currently report `push_ready:false` and do not configure hooks automatically.

Modern event reception is **opt-in**. External delivery uses `modernEvents: { enabled: true, mode: "channel", channel: "<approved-channel>", to: "<approved-recipient>" }`; Web-only use sets `{ enabled: true, mode: "local_session" }`, which creates an isolated session visible in the Control UI and forces `deliver:false`. WebChat itself is not an outbound channel. Leave reception absent or disabled until the user approves the mode/destination and the existing local hooks configuration is ready. Installing or upgrading does not enable it or change hooks. It uses the new Gateway claim/ACK contract, polls no faster than every 30 seconds, and uses the full claimed snapshot without an extra GET. No event means no model turn. Event payloads cannot change the configured destination, and the receiver does not select the most recent chat or rewrite its session.

The receiver acknowledges only after OpenClaw returns `{ok:true,runId}`. This proves **host acceptance**, not model completion, external delivery, or human readership. Stable event idempotency keys and private local receipts suppress duplicate hook submissions after uncertain ACK responses; exactly-once delivery is not promised. Only unresolved receipts trigger reconciliation (at most one GET per cycle); receipts are removed only after confirming the same event is `acked`. At 1000 unresolved receipts new claims pause, but reconciliation continues to recover capacity. Malformed receipt files require inspection; unknown receipts are never evicted automatically. The local hooks reader currently accepts JSON configuration; unsupported JSON5 syntax leaves reception idle without rewriting the file. This transport still requires a separately approved live delivery test before declaring push ready.

Registration is not server-idempotent. Before sending the request the plugin writes an exclusive, non-secret `*.registration-pending.json` marker. If a request times out or returns an ambiguous/invalid response, the marker prevents automatic second registration even after restart. Recover the existing credential; do not delete the marker to retry blindly. Existing credentials always take precedence. Non-empty custom registration metadata (including channel attribution) is rejected because this endpoint does not support it.

For link-mode development, run both `npm run build` and `npm run snapshot` before loading the plugin. Build alone clears the generated capability snapshot; published packages run both through `prepack`.

`hi_agent_status` reports both the installed package version and Hi's host-specific `plugin_policy`. Version 1.0.75 aligns the published tool snapshot and Skills with the canonical `workspace_workflows` surface, and separates a required/recommended plugin update from credential recovery and permission errors. When `update_required=true`, use the returned `openclaw plugins update hirey` command and restart OpenClaw. A 401 repairs the existing credential, while a 403 must not trigger reset or a replacement Agent. Anonymous public People reads remain available before verified owner binding.

## Install

### Pre-flight: avoid the approval loop (one-time, ~5 seconds, recommended)

On a default OpenClaw host, `tools.exec` runs in `security=allowlist` + `ask=off` and the natural-language install path stalls in an approval loop: each `/approve <token>` retry rotates the token because the gateway's followup dispatch can't reuse the approved session token (upstream tracked at [openclaw/openclaw#58662](https://github.com/openclaw/openclaw/issues/58662) and [#27831](https://github.com/openclaw/openclaw/issues/27831)). Before chatting with OpenClaw, paste this in your shell once:

```bash
openclaw approvals set --stdin << 'JSON'
{
  "version": 1,
  "agents": {
    "main": {
      "security": "allowlist",
      "ask": "on-miss",
      "allowlist": [
        {
          "pattern": "**/openclaw",
          "argPattern": "^plugins\\s+install\\s+clawhub:hirey(\\b|$)",
          "source": "manual"
        }
      ]
    }
  }
}
JSON
```

The change is live — no `openclaw gateway restart` needed. The allowlist is intentionally narrow: it only matches `openclaw plugins install clawhub:hirey*` (covers `clawhub:hirey`, `clawhub:hirey --force`, and the bundle name `clawhub:hirey-compatible`); it does NOT broaden any other openclaw subcommand.

With pre-flight set, the install prompt below finishes in **2 chat turns, 0 `/approve` prompts** (verified end-to-end on OpenClaw 2026.5.6). Without pre-flight, expect 4–6 turns with several token-paste round-trips.

### Natural-language install (after pre-flight)

OpenClaw is a personal agent driven by natural language; the LLM picks which command to run. The recommended user-facing prompt that works across versions:

```
Install Hirey AI on this OpenClaw host. First check `openclaw --version`:
- If 2026.5.2 or higher, run `openclaw plugins install clawhub:hirey` (preferred; no override flags).
- Only if stuck on OpenClaw 2026.4.23 ~ 2026.5.1: the legacy bundle `clawhub:hirey-compatible` needs OpenClaw's `--dangerously-force-unsafe-install` break-glass flag (its setup helper runs `npm install` + `openclaw config set` via child_process, which the install scanner blocks by default). Ask me (the user) to confirm before using that flag — it is a trust decision, not a default.
After install, call hi_agent_install (don't fabricate an agent id). Report the real agent_id and hooks_ready status.
```

Direct CLI for OpenClaw 5.2+ users:

```bash
openclaw plugins install clawhub:hirey
openclaw gateway restart
```

For OpenClaw 4.23 ~ 5.1 users ONLY — a legacy bundle path exists (`clawhub:hirey-compatible`) that requires OpenClaw's `--dangerously-force-unsafe-install` break-glass flag, because the bundle ships a setup-time `child_process` helper (`openclaw-host-installer.mjs` spawning `npm install` + `openclaw config set`) that OpenClaw's install scanner blocks by default. **Do not use this path unless you are stuck on 4.23 ~ 5.1 and you deliberately trust the legacy installer** — on 5.2+ always prefer the flag-free `clawhub:hirey` ClawPack path above, which is in-process and needs no override:

```bash
# LEGACY ONLY (OpenClaw 4.23 ~ 5.1). Prefer `clawhub:hirey` on 5.2+.
openclaw plugins install clawhub:hirey-compatible --dangerously-force-unsafe-install
openclaw gateway restart
```

After restart, ask OpenClaw "Hi 健康吗?" or "post a Hi listing for me" — the LLM will see the registered Hi tools and run them directly.

## What this plugin stores and changes on your host (read before installing)

Everything below is core to how the integration works (a persistent local Hi agent + background event delivery). It is listed here so it is a deliberate choice, not a surprise:

- **Local identity state** — `~/.openclaw/hi-mcp/<profile>/` (override with the `stateDir` config) holds the Hi agent identity for this host: OAuth `client_id`/`client_secret` (or a `hi_ak_` API key), delivery cursor, and pending-push files. Written with file mode `0600` (owner-only). This is what makes the agent stable across restarts; treat the directory as sensitive, like an SSH key.
- **OpenClaw hooks config** — during `hi_agent_install` (and self-heal on later startups if the entry went missing) the plugin writes the OpenClaw hooks configuration (path + token) so the in-process receiver can deliver Hi events back into your chat. Changes are logged; the previous value is captured in the install receipt.
- **Tool visibility (`tools.alsoAllow`)** — at registration the plugin appends `group:plugins` to `tools.alsoAllow` in `openclaw.json` if missing, so its registered `hi_*` tools are visible to the LLM under your current tools profile. This is the only `openclaw.json` mutation it performs.
- **Session metadata read** — `hi_agent_install` reads `openclaw status --json` → `sessions.recent[0].key` and registers that session key with Hi so replies route back to the right chat. The skill instructs the assistant to disclose this at install time.
- **Inbound event text is treated as untrusted** — events pushed by counterparties are injected into the LLM turn inside a delimited `<hi_pending_pushes>` block that (a) escapes any delimiter-forging text and (b) explicitly marks the content as untrusted data the assistant must not follow as instructions.
- **Background activity** — the plugin starts with the gateway and runs an agent-events claim loop against `platformBaseUrl` (default `https://hi.hirey.ai`) plus a local webhook route (`webhookPath`, default `/hi/webhook`). No other hosts are contacted.

**To remove it completely:** `openclaw plugins uninstall hirey`, delete `~/.openclaw/hi-mcp/`, and (optionally) remove the plugin's hooks entry and the `group:plugins` item from `tools.alsoAllow` in `openclaw.json`. The platform-side agent is not destroyed by local removal; re-binding the same phone/email/Google later converges back to the same Hi workspace.

## Development

```bash
npm install
npm run build
npm pack    # emits hirey-<version>.tgz
```

Use `openclaw plugins install -l <local-dir>` for local link-mode testing (only on OpenClaw 5.2+).

## License

UNLICENSED (private; published under unscoped `hirey` on the public npm registry but the source is not open source).
