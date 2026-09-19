#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/.local/bin"

echo "========================================================"
echo "    Installing Universal TypeSafe Jev Plugin / MCP      "
echo "========================================================"

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js (v20+) is required. Please install Node.js first."
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "Warning: Node.js version is $NODE_VERSION. Version 20+ is recommended."
fi

# 2. Link CLI and MCP binaries
mkdir -p "$BIN_DIR"
chmod +x "$DIR/bin/jev.js" "$DIR/bin/mcp-server.js" "$DIR/bin/codex-hook.js" "$DIR/bin/ego-browse.js"
ln -sf "$DIR/bin/jev.js" "$BIN_DIR/jev"
ln -sf "$DIR/bin/mcp-server.js" "$BIN_DIR/universal-jev-mcp"
ln -sf "$DIR/bin/codex-hook.js" "$BIN_DIR/universal-jev-codex-hook"
ln -sf "$DIR/bin/ego-browse.js" "$BIN_DIR/ego-browse"
echo "✓ Installed CLI to $BIN_DIR/jev"
echo "✓ Installed Unified Browser CLI to $BIN_DIR/ego-browse"
echo "✓ Installed MCP Server to $BIN_DIR/universal-jev-mcp"
echo "✓ Installed Codex Hook to $BIN_DIR/universal-jev-codex-hook"

# 3. Auto-configure installed Agents
echo ""
echo "Detecting and configuring installed Agents..."

# 3.1 OpenCode
if [ -f "$HOME/.config/opencode/opencode.json" ]; then
  if grep -q '"jev"' "$HOME/.config/opencode/opencode.json"; then
    echo "✓ OpenCode: already configured"
  else
    node -e '
      const fs = require("fs");
      const path = process.env.HOME + "/.config/opencode/opencode.json";
      try {
        const data = JSON.parse(fs.readFileSync(path, "utf-8"));
        data.mcp = data.mcp || {};
        data.mcp.jev = {
          command: ["node", process.env.HOME + "/.local/bin/universal-jev-mcp"],
          enabled: true,
          type: "local"
        };
        fs.writeFileSync(path, JSON.stringify(data, null, 2));
        console.log("✓ OpenCode: registered jev MCP server");
      } catch (e) {
        console.log("! OpenCode: could not auto-update json: " + e.message);
      }
    '
  fi
fi

# 3.2 Codex
if [ -f "$HOME/.codex/config.toml" ]; then
  if grep -q '\[mcp_servers\.jev\]' "$HOME/.codex/config.toml"; then
    echo "✓ Codex: already configured"
  else
    cat << EOF >> "$HOME/.codex/config.toml"

[mcp_servers.jev]
command = "$BIN_DIR/universal-jev-mcp"
args = []
startup_timeout_sec = 60
EOF
    echo "✓ Codex: registered jev MCP server"
  fi
fi

# 3.3 Antigravity (AGY / Gemini)
mkdir -p "$HOME/.gemini/config"
if [ -f "$HOME/.gemini/config/mcp_config.json" ]; then
  if grep -q '"jev"' "$HOME/.gemini/config/mcp_config.json"; then
    echo "✓ Antigravity: already configured"
  else
    node -e '
      const fs = require("fs");
      const path = process.env.HOME + "/.gemini/config/mcp_config.json";
      try {
        const text = fs.readFileSync(path, "utf-8").trim();
        const data = text ? JSON.parse(text) : { mcpServers: {} };
        data.mcpServers = data.mcpServers || {};
        data.mcpServers.jev = {
          command: process.env.HOME + "/.local/bin/universal-jev-mcp",
          args: []
        };
        fs.writeFileSync(path, JSON.stringify(data, null, 2));
        console.log("✓ Antigravity: registered jev MCP server");
      } catch (e) {
        console.log("! Antigravity: could not auto-update json: " + e.message);
      }
    '
  fi
else
  cat << EOF > "$HOME/.gemini/config/mcp_config.json"
{
  "mcpServers": {
    "jev": {
      "command": "$BIN_DIR/universal-jev-mcp",
      "args": []
    }
  }
}
EOF
  echo "✓ Antigravity: created mcp_config.json"
fi

# 3.4 Pi / Universal .agents
mkdir -p "$HOME/.agents"
if [ ! -f "$HOME/.agents/mcp.json" ]; then
  cat << EOF > "$HOME/.agents/mcp.json"
{
  "mcpServers": {
    "jev": {
      "command": "$BIN_DIR/universal-jev-mcp",
      "args": []
    }
  }
}
EOF
  echo "✓ Pi / .agents: created mcp.json"
fi

echo ""
echo "========================================================"
echo "Installation complete! To verify, run:"
echo "  export OPENROUTER_API_KEY='sk-or-v1-...'"
echo "  jev status"
echo "========================================================"
