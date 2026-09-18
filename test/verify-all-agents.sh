#!/usr/bin/env bash
set -e

echo "================================================================"
echo "    Universal TypeSafe Jev Multi-Agent Integration Verification  "
echo "================================================================"

PASSED=0
TOTAL=5

echo ""
echo "[1/5] Testing Universal Core & CLI..."
jev status
jev guard "ls -la" > /dev/null
echo "✓ Universal Jev Core & CLI operational!"
PASSED=$((PASSED+1))

echo ""
echo "[2/5] Verifying OpenCode MCP Integration..."
opencode mcp list > /tmp/opencode_verify.txt 2>&1 || true
if grep -E "jev.*connected" /tmp/opencode_verify.txt > /dev/null; then
  echo "✓ OpenCode: $(grep -E 'jev.*connected' /tmp/opencode_verify.txt | tr -d '\r')"
  PASSED=$((PASSED+1))
else
  echo "✗ OpenCode check failed"
fi

echo ""
echo "[3/5] Verifying Codex MCP Integration..."
CODEX_CHECK=$(codex mcp list 2>&1 | grep -E '^jev[[:space:]]+.*enabled' || true)
if [[ -n "$CODEX_CHECK" ]]; then
  echo "✓ Codex: $CODEX_CHECK"
  PASSED=$((PASSED+1))
else
  echo "✗ Codex check failed"
fi

echo ""
echo "[4/5] Verifying Antigravity (AGY) MCP Integration..."
AGY_CHECK=$(agy mcp list 2>&1 | grep -E '^jev[[:space:]]+stdio[[:space:]]+enabled' || true)
if [[ -n "$AGY_CHECK" ]]; then
  echo "✓ Antigravity: $AGY_CHECK"
  PASSED=$((PASSED+1))
else
  echo "✗ Antigravity check failed"
fi

echo ""
echo "[5/5] Verifying Pi MCP & Skill Integration..."
PI_CONFIG_CHECK=$(test -f "$HOME/.pi/agent/mcp.json" && grep -q '"jev"' "$HOME/.pi/agent/mcp.json" && echo "mcp.json verified" || true)
PI_SKILL_CHECK=$(test -L "$HOME/.pi/agent/skills/typesafe-ai" && echo "skill link verified" || true)
if [[ -n "$PI_CONFIG_CHECK" && -n "$PI_SKILL_CHECK" ]]; then
  echo "✓ Pi: $PI_CONFIG_CHECK & $PI_SKILL_CHECK"
  PASSED=$((PASSED+1))
else
  echo "✗ Pi check failed"
fi

echo ""
echo "================================================================"
echo "    Result: $PASSED / $TOTAL Agents Integration Tests Passed!    "
echo "================================================================"
