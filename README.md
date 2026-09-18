# universal-jev

Universal TypeSafe Jev Runtime Plugin & MCP Server for Coding Agents (Codex, Pi, DSH, OpenCode, Antigravity).

## Purpose

- **Verbatim Context Compaction**: Prune stale tool outputs while keeping conversation messages 100% verbatim.
- **Fast Decision Primitives**: Millisecond choice classification, true/false verification (Noul), rubric scoring, and command guardrails via Jev.

## Install

Requires Node.js 20+.

```bash
git clone https://github.com/raj8525/universal-jev.git ~/.agents/plugins/universal-jev
cd ~/.agents/plugins/universal-jev
./install.sh
```

Set your API key (OpenRouter or TypeSafe):

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
# or
export TYPESAFE_API_KEY="ts-..."
```

## Usage

### 1. CLI

```bash
# Check status
jev status

# Boolean verification (Noul)
jev noul "Is this an emergency?" --state "Database CPU 100%"

# Categorization (Choice)
jev choice "Department" --criteria "infra:Server down,billing:Payment issue" --state "Service timeout"

# Rubric score
jev score "Severity" --criteria "low,medium,high" --state "SyntaxError in script"

# Command safety guard
jev guard "rm -rf /"

# Compact conversation transcript
jev compact transcript.json --out compacted.json
```

### 2. MCP Server

The installer automatically registers `universal-jev-mcp` with installed agents.

Manual configuration:

```json
{
  "mcpServers": {
    "jev": {
      "command": "node",
      "args": ["/path/to/universal-jev/bin/mcp-server.js"]
    }
  }
}
```

Available MCP tools:
- `jev_compact`
- `jev_decide_choice`
- `jev_decide_noul`
- `jev_decide_score`
- `jev_guard`
- `jev_status`

## License

MIT
