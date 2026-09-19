#!/usr/bin/env node
/**
 * universal-jev-codex-hook
 * Native Codex (GPT-6) In-Flight Lifecycle Hook for Safe Context Optimization.
 *
 * Listens to Codex hook events (PreToolUse, PostToolUse, PreCompact) via STDIN,
 * protects source code from being truncated, and safely prunes massive transient
 * command dumps before they bloat GPT-6's turn history.
 */

import fs from 'node:fs';
import { isProtectedCall, smartFormatPrunedText } from '../src/compactor.js';
import { extractJevReceipt } from '../src/receipt.js';
import { JevClient } from '../src/client.js';
import { recordPruneEvent } from '../src/telemetry.js';

let jevClient = null;
function getClient() {
  if (!jevClient) {
    jevClient = new JevClient();
  }
  return jevClient;
}

const PRUNE_THRESHOLD_CHARS = 1200;

async function main() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf-8');
  } catch (err) {
    // Stdin empty or unavailable
    process.stdout.write('{}\n');
    process.exit(0);
  }

  if (!raw.trim()) {
    process.stdout.write('{}\n');
    process.exit(0);
  }

  let event = {};
  try {
    event = JSON.parse(raw);
  } catch (err) {
    // Non-JSON input
    process.stdout.write('{}\n');
    process.exit(0);
  }

  const eventName = event.hook_event_name || event.event_name || '';
  const toolName = event.tool_name || event.tool || '';
  const toolInput = event.tool_input || event.input || {};
  const toolResponse = event.tool_response || event.output || '';

  // 1. PreToolUse Hook: Ensure safety and compatibility
  if (eventName === 'PreToolUse') {
    // We allow normal execution without modifying the command string directly,
    // ensuring complete compatibility with RTK.
    process.stdout.write(JSON.stringify({ decision: 'approve' }) + '\n');
    process.exit(0);
  }

  // 2. PostToolUse Hook: Jev-Verified Receipt Dehydration with source code immunity
  if (eventName === 'PostToolUse' && typeof toolResponse === 'string') {
    // Zero-latency passthrough for small outputs
    if (toolResponse.length < PRUNE_THRESHOLD_CHARS) {
      process.stdout.write('{}\n');
      process.exit(0);
    }

    // Absolute code protection barrier (never prune project source code)
    if (isProtectedCall(toolName, toolInput, toolResponse)) {
      process.stdout.write('{}\n');
      process.exit(0);
    }

    try {
      const client = getClient();
      const receiptResult = await extractJevReceipt(client, {
        toolName,
        toolInput,
        output: toolResponse,
        thresholdChars: PRUNE_THRESHOLD_CHARS,
      });

      if (receiptResult && receiptResult.shouldPrune) {
        recordPruneEvent({
          agent: 'Codex(GPT-6)',
          command: typeof toolInput?.command === 'string' ? toolInput.command : toolName || 'Bash',
          originalChars: toolResponse.length,
          prunedChars: receiptResult.content.length,
        });

        const response = {
          updatedMCPToolOutput: receiptResult.content,
          additionalContext: `[Universal Jev] Output dehydrated into verified receipt (${receiptResult.charsSaved} chars saved) to protect GPT-6 context budget.`,
        };
        process.stdout.write(JSON.stringify(response) + '\n');
        process.exit(0);
      }
    } catch (auditErr) {
      // Fallback to mechanical compaction if receipt extraction encounters error
      const pruned = smartFormatPrunedText(toolResponse, 10, 30);
      if (pruned && pruned.length < toolResponse.length) {
        const response = {
          updatedMCPToolOutput: pruned,
          additionalContext: `[Universal Jev] Pruned ${toolResponse.length - pruned.length} chars of transient log output to protect GPT-6 context budget.`,
        };
        process.stdout.write(JSON.stringify(response) + '\n');
        process.exit(0);
      }
    }
  }
  // Default passthrough
  process.stdout.write('{}\n');
}

main().catch(() => {
  process.stdout.write('{}\n');
  process.exit(0);
});
