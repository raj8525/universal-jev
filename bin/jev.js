#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JevClient } from '../src/client.js';
import { decideChoice, decideNoul, decideScore, guardCommand } from '../src/primitives.js';
import { compactMessages, normalizeMessages } from '../src/compactor.js';

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
Universal TypeSafe Jev CLI (v1.0.0)
Cross-Agent Decision Primitives & Context Compactor

Usage:
  jev status                               Check provider connectivity & latency
  jev noul <question> [--state <text>]     Yes/No calibrated probability (0~1)
  jev choice <question> --criteria <opts>  Multi-choice decision (e.g. "a:desc,b:desc")
  jev score <question> --criteria <levels> Rubric scoring (e.g. "low,med,high")
  jev guard <command>                      Security & loop check for commands
  jev compact <file> [--out <file>]        Verbatim context compaction of transcript
  jev mcp                                  Run as Stdio MCP server
  `);
}

function getFlag(name) {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

async function main() {
  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'mcp') {
    await import('./mcp-server.js');
    return;
  }

  const client = new JevClient();

  if (command === 'status') {
    console.log(`Connecting to ${client.provider} (${client.baseUrl})...`);
    const start = Date.now();
    const res = await decideNoul(client, 'Ping test', 'Is the service operational?');
    const latency = Date.now() - start;
    console.log(`✓ Operational! Model: ${res.model} | Latency: ${latency}ms`);
    return;
  }

  if (command === 'noul') {
    const question = args[1];
    if (!question) {
      console.error('Error: Question required. e.g. jev noul "Is this an emergency?"');
      process.exit(1);
    }
    const state = getFlag('--state') || 'Current context evaluation';
    const res = await decideNoul(client, state, question);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (command === 'choice') {
    const question = args[1];
    const criteriaRaw = getFlag('--criteria');
    if (!question || !criteriaRaw) {
      console.error('Error: Question and --criteria required. e.g. --criteria "bug:Fix code,feat:Add feature"');
      process.exit(1);
    }
    const state = getFlag('--state') || 'Context evaluation';
    let criteria = {};
    if (criteriaRaw.startsWith('{')) {
      criteria = JSON.parse(criteriaRaw);
    } else {
      for (const pair of criteriaRaw.split(',')) {
        const [k, v] = pair.split(':');
        criteria[k.trim()] = (v || k).trim();
      }
    }
    const res = await decideChoice(client, state, question, criteria);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (command === 'score') {
    const question = args[1];
    const criteriaRaw = getFlag('--criteria');
    if (!question || !criteriaRaw) {
      console.error('Error: Question and --criteria required. e.g. --criteria "low,medium,high"');
      process.exit(1);
    }
    const state = getFlag('--state') || 'Context evaluation';
    const criteria = criteriaRaw.startsWith('[') ? JSON.parse(criteriaRaw) : criteriaRaw.split(',').map((s) => s.trim());
    const res = await decideScore(client, state, question, criteria);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (command === 'guard') {
    const cmd = args[1];
    if (!cmd) {
      console.error('Error: Command required. e.g. jev guard "rm -rf node_modules"');
      process.exit(1);
    }
    const context = getFlag('--context') || '';
    const res = await guardCommand(client, cmd, context);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (command === 'compact') {
    const filePath = args[1];
    if (!filePath || !existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }
    const content = readFileSync(filePath, 'utf-8');
    const msgs = normalizeMessages(content);
    if (!msgs || msgs.length === 0) {
      console.error('Error: Could not parse conversation messages from file');
      process.exit(1);
    }
    console.log(`Compacting ${msgs.length} messages using Jev...`);
    const res = await compactMessages(client, msgs);
    console.log(`\nReduction: ${(res.stats.reductionRatio * 100).toFixed(1)}%`);
    console.log(`Tokens: ${res.stats.beforeTokens} -> ${res.stats.afterTokens}`);
    console.log(`Decisions: ${res.stats.kept} kept, ${res.stats.truncated} truncated, ${res.stats.dropped} dropped`);

    const outPath = getFlag('--out');
    if (outPath) {
      writeFileSync(outPath, JSON.stringify(res.messages, null, 2));
      console.log(`Saved compacted messages to ${outPath}`);
    }
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
