#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { JevClient } from '../src/client.js';
import { decideChoice, decideNoul, decideScore, guardCommand } from '../src/primitives.js';
import { compactMessages, normalizeMessages } from '../src/compactor.js';
import { extractJevReceipt } from '../src/receipt.js';
import { recordPruneEvent } from '../src/telemetry.js';


let client = null;
function getClient() {
  if (!client) {
    client = new JevClient();
  }
  return client;
}

const TOOLS = [
  {
    name: 'jev_compact',
    description:
      'Verbatim context compaction: prunes old verbose tool results while preserving conversation messages 100% verbatim.',
    inputSchema: {
      type: 'object',
      properties: {
        messages: {
          type: 'array',
          description: 'Array of conversation message objects',
        },
        rawJson: {
          type: 'string',
          description: 'Raw JSON or JSONL transcript string',
        },
        truncateHeadChars: {
          type: 'number',
          description: 'Chars of output retained before omission note (default 250)',
        },
      },
    },
  },
  {
    name: 'jev_decide_choice',
    description:
      'Fast, calibrated multi-option classification with confidence and relative probabilities.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', description: 'Context or text to classify' },
        question: { type: 'string', description: 'Classification instruction or question' },
        criteria: {
          type: 'object',
          description: 'Mapping of option key to description',
        },
      },
      required: ['state', 'question', 'criteria'],
    },
  },
  {
    name: 'jev_decide_noul',
    description:
      'Calibrated boolean verification (Noul) returning true probability between 0.0 and 1.0.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', description: 'Context or assertion to verify' },
        question: { type: 'string', description: 'Yes/No verification question' },
      },
      required: ['state', 'question'],
    },
  },
  {
    name: 'jev_decide_score',
    description:
      'Calibrated rubric scoring across ordered levels (e.g. 0 to 3 severity/quality).',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', description: 'Context to evaluate' },
        question: { type: 'string', description: 'Scoring goal or metric' },
        criteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'Rubric descriptions in ascending order',
        },
      },
      required: ['state', 'question', 'criteria'],
    },
  },
  {
    name: 'jev_guard',
    description:
      'Security and loop-detection guardrail before running risky commands or tool calls.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command line or tool action to audit' },
        context: { type: 'string', description: 'Working directory or intent context' },
      },
      required: ['command'],
    },
  },
  {
    name: 'jev_status',
    description: 'Check Jev provider connectivity, model availability, and response latency.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'jev_receipt',
    description:
      'Audit and dehydrate long terminal or tool output into a verified receipt or isolated diagnostic with 100% LLM transparency.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command or tool name executed' },
        output: { type: 'string', description: 'Raw long terminal or tool output to dehydrate' },
        thresholdChars: { type: 'number', description: 'Threshold chars to trigger dehydration (default 1200)' },
      },
      required: ['output'],
    },
  },
];

async function handleToolCall(name, args) {
  const c = getClient();
  switch (name) {
    case 'jev_receipt': {
      return await extractJevReceipt(c, {
        toolName: args.command || 'terminal',
        toolInput: { command: args.command || 'terminal' },
        output: args.output,
        thresholdChars: args.thresholdChars || 1200,
      });
    }
    case 'jev_compact': {
      let msgs = args.messages;
      if (!msgs && args.rawJson) {
        msgs = normalizeMessages(args.rawJson);
      }
      if (!msgs || !Array.isArray(msgs)) {
        throw new Error('jev_compact requires either "messages" array or valid "rawJson"');
      }
      const result = await compactMessages(c, msgs, {
        truncateHeadChars: args.truncateHeadChars ?? 250,
      });
      if (result && result.stats) {
        const charsSaved = Math.max(0, (result.stats.beforeTokens - result.stats.afterTokens) * 4);
        recordPruneEvent({
          agent: args.agent || 'Antigravity/MCP',
          command: `jev_compact (${result.stats.dropped} dropped, ${result.stats.truncated} truncated)`,
          originalChars: result.stats.beforeTokens * 4,
          prunedChars: result.stats.afterTokens * 4,
        });
      }
      return result;
    }
    case 'jev_decide_choice': {
      return await decideChoice(c, args.state, args.question, args.criteria);
    }
    case 'jev_decide_noul': {
      return await decideNoul(c, args.state, args.question);
    }
    case 'jev_decide_score': {
      return await decideScore(c, args.state, args.question, args.criteria);
    }
    case 'jev_guard': {
      return await guardCommand(c, args.command, args.context || '');
    }
    case 'jev_status': {
      const start = Date.now();
      const ping = await decideNoul(c, 'Universal Jev Ping', 'Is system operational?');
      const latencyMs = Date.now() - start;
      return {
        status: 'healthy',
        provider: c.provider,
        model: ping.model,
        latencyMs,
        testResult: ping,
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function sendResponse(response) {
  process.stdout.write(JSON.stringify(response) + '\n');
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (err) {
    sendResponse({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
    return;
  }

  const { id, method, params } = msg;

  try {
    if (method === 'initialize') {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'universal-jev-mcp',
            version: '1.0.0',
          },
        },
      });
    } else if (method === 'notifications/initialized') {
      // acknowledgement, no response required
    } else if (method === 'ping') {
      sendResponse({ jsonrpc: '2.0', id, result: {} });
    } else if (method === 'tools/list') {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      });
    } else if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const resultData = await handleToolCall(toolName, toolArgs);
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(resultData, null, 2),
            },
          ],
        },
      });
    } else {
      if (id !== undefined && id !== null) {
        sendResponse({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
      }
    }
  } catch (err) {
    if (id !== undefined && id !== null) {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        },
      });
    }
  }
});
