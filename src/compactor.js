export const TOKEN_PIECES = /[A-Za-z]+|\d+|[^\sA-Za-z\d]/g;

export function estimateTokens(text) {
  if (!text) return 0;
  if (typeof text !== 'string') text = JSON.stringify(text);
  let tokens = 0;
  for (const [piece] of text.matchAll(TOKEN_PIECES)) {
    const first = piece.charCodeAt(0);
    if (first >= 48 && first <= 57) tokens += piece.length / 2;
    else if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) {
      tokens += 1 + Math.floor((piece.length - 1) / 6);
    } else tokens += 0.9;
  }
  return Math.ceil(tokens);
}

export function normalizeMessages(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    // Try JSONL
    const lines = raw.trim().split('\n');
    const list = [];
    for (const line of lines) {
      try {
        list.push(JSON.parse(line));
      } catch {}
    }
    if (list.length > 0) return list;
  }
  return [];
}

export const PROTECTED_EXTENSIONS = [
  '.gd', '.tres', '.tscn', // Godot
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', // Web / Node
  '.py', '.pyi', // Python
  '.rs', // Rust
  '.go', // Go
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', // C/C++
  '.java', '.kt', '.swift', // Mobile / JVM
  '.json', '.toml', '.yaml', '.yml', '.xml', // Configs
  '.md', '.txt', '.sql', '.sh', '.zsh', '.bash', // Docs / Shell
  '.css', '.scss', '.html', '.vue', '.svelte' // Frontend
];

export const CODE_INSPECTION_TOOLS = new Set([
  'read_file', 'view_file', 'cat', 'head', 'tail', 'grep', 'grep_search',
  'find_by_name', 'list_dir', 'file_search', 'read_resource', 'fs_read'
]);

export function isProtectedCall(toolName, input) {
  const normTool = (toolName || '').toLowerCase();
  if (CODE_INSPECTION_TOOLS.has(normTool)) return true;

  const inputStr = typeof input === 'string' ? input : JSON.stringify(input || {});
  const lower = inputStr.toLowerCase();

  // Check if referencing source code files
  for (const ext of PROTECTED_EXTENSIONS) {
    if (lower.includes(ext)) {
      return true;
    }
  }

  // Check common code read commands inside bash
  if (normTool === 'bash' || normTool === 'exec_command' || normTool === 'execute_command') {
    if (/\b(cat|bat|less|head|tail|view_file|read_file|grep|rg|ag)\b/i.test(inputStr)) {
      for (const ext of PROTECTED_EXTENSIONS) {
        if (lower.includes(ext)) return true;
      }
    }
  }

  return false;
}

export function smartFormatPrunedText(originalText, headLines = 10, tailLines = 25) {
  if (!originalText || typeof originalText !== 'string') return '';
  const lines = originalText.split('\n');
  if (lines.length <= headLines + tailLines + 5) {
    return originalText;
  }

  const head = lines.slice(0, headLines).join('\n');
  const tail = lines.slice(-tailLines).join('\n');
  const omittedCount = lines.length - headLines - tailLines;

  return `${head}\n\n[... Jev Compactor: ${omittedCount} lines of repetitive runtime log/dump pruned to protect context window ...]\n\n${tail}`;
}

/**
 * Universal verbatim context compaction using Jev
 */
export async function compactMessages(client, messages, options = {}) {
  const keepThreshold = options.keepThreshold ?? 0.5;
  const preserveRecent = options.preserveRecentMessages ?? 4;
  const truncateHeadChars = options.truncateHeadChars ?? 250;

  if (!messages || messages.length <= preserveRecent + 1) {
    return {
      messages,
      decisions: [],
      stats: {
        beforeTokens: estimateTokens(JSON.stringify(messages)),
        afterTokens: estimateTokens(JSON.stringify(messages)),
        reductionRatio: 0,
        kept: 0,
        truncated: 0,
        dropped: 0,
        pinned: messages.length,
      },
    };
  }

  // Identify tool calls and tool results across message formats (OpenAI, Anthropic, Gemini)
  // Tool call: { id, tool, input, callMsgIndex, resultMsgIndex, resultText, pinned }
  const calls = [];
  const total = messages.length;

  for (let i = 0; i < total; i++) {
    const msg = messages[i];
    const isPinned = i === 0 || i >= total - preserveRecent;

      const toolUses = msg.toolUses || msg.tool_calls || [];
      for (const tu of toolUses) {
        const callId = tu.tool_use_id || tu.id;
        const toolName = tu.tool || tu.function?.name || 'tool';
        const input = tu.input || tu.function?.arguments || {};

        // Find matching result in subsequent messages
        let resultText = '';
        let resultIndex = -1;
        for (let j = i; j < total; j++) {
          const candidate = messages[j];
          const results = candidate.toolResults || [];
          const match = results.find(
            (r) => (r.tool_use_id || r.id) === callId
          );
          if (match) {
            resultText = typeof match.text === 'string' ? match.text : JSON.stringify(match);
            resultIndex = j;
            break;
          }
          if (candidate.role === 'tool' && candidate.tool_call_id === callId) {
            resultText = typeof candidate.content === 'string' ? candidate.content : JSON.stringify(candidate.content);
            resultIndex = j;
            break;
          }
        }

        const isCodeProtected = isProtectedCall(toolName, input);

        calls.push({
          id: `t${calls.length + 1}`,
          rawId: callId,
          tool: toolName,
          input,
          callMsgIndex: i,
          resultMsgIndex: resultIndex,
          resultLength: resultText.length,
          resultText,
          pinned: isPinned || isCodeProtected || (resultIndex >= 0 && resultIndex >= total - preserveRecent),
        });
      }
    }

    const candidateCalls = calls.filter((c) => !c.pinned && c.resultLength > 100);

  if (candidateCalls.length === 0) {
    const tokens = estimateTokens(JSON.stringify(messages));
    return {
      messages,
      decisions: [],
      stats: {
        beforeTokens: tokens,
        afterTokens: tokens,
        reductionRatio: 0,
        kept: calls.length,
        truncated: 0,
        dropped: 0,
        pinned: calls.length,
      },
    };
  }

  // Build compact State for Jev
  const stateSummary = candidateCalls.map((c) => ({
    id: c.id,
    tool: c.tool,
    input: typeof c.input === 'string' ? c.input.slice(0, 100) : JSON.stringify(c.input).slice(0, 100),
    outputChars: c.resultLength,
  }));

  const questions = {};
  for (const c of candidateCalls) {
    questions[`call_${c.id}`] = {
      type: 'noul',
      instructions: `Tool call ${c.id} (${c.tool}) must remain in conversation history (knowing this tool was called is critical for next actions).`,
    };
    questions[`result_${c.id}`] = {
      type: 'noul',
      instructions: `The full verbatim output (${c.resultLength} chars) of tool call ${c.id} (${c.tool}) is strictly necessary and cannot be truncated.`,
    };
  }

  const jevRes = await client.decide(
    {
      context: 'Pruning old tool call execution outputs from conversation history while keeping messages verbatim.',
      candidateToolCalls: stateSummary,
    },
    questions
  );

  const decisions = [];
  const actionMap = new Map();

  for (const c of candidateCalls) {
    const keepCallProb = jevRes.answers[`call_${c.id}`]?.noul ?? 0.5;
    const keepResultProb = jevRes.answers[`result_${c.id}`]?.noul ?? 0.5;

    let action = 'keep';
    if (keepResultProb >= keepThreshold) {
      action = 'keep';
    } else if (keepCallProb >= keepThreshold) {
      action = 'truncate';
    } else {
      action = 'drop';
    }

    decisions.push({
      id: c.id,
      rawId: c.rawId,
      tool: c.tool,
      keepCallProb,
      keepResultProb,
      action,
    });
    actionMap.set(c.rawId, action);
  }

  // Deep clone and apply decisions
  let cloned = JSON.parse(JSON.stringify(messages));
  let truncatedCount = 0;
  let droppedCount = 0;
  let keptCount = 0;

  // 1. Process messages and their tool calls/results
  cloned = cloned.filter((msg) => {
    // Drop standalone OpenAI tool result message
    if (msg.role === 'tool' && msg.tool_call_id) {
      const act = actionMap.get(msg.tool_call_id);
      if (act === 'drop') {
        droppedCount++;
        return false;
      }
      if (act === 'truncate') {
        truncatedCount++;
        const orig = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        msg.content = smartFormatPrunedText(orig);
        return true;
      }
      keptCount++;
      return true;
    }
    return true;
  });

  for (const msg of cloned) {
    // Anthropic style toolResults
    if (msg.toolResults && Array.isArray(msg.toolResults)) {
      msg.toolResults = msg.toolResults.filter((r) => {
        const act = actionMap.get(r.tool_use_id || r.id);
        if (!act || act === 'keep') {
          keptCount++;
          return true;
        }
        if (act === 'truncate') {
          truncatedCount++;
          const orig = r.text || '';
          r.text = smartFormatPrunedText(orig);
          return true;
        }
        if (act === 'drop') {
          droppedCount++;
          return false;
        }
        return true;
      });
    }

    // OpenAI style tool_calls removal if dropped
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      msg.tool_calls = msg.tool_calls.filter((tc) => {
        const act = actionMap.get(tc.id);
        if (act === 'drop') {
          return false;
        }
        return true;
      });
    }

    // Anthropic style toolUses removal if dropped
    if (msg.toolUses && Array.isArray(msg.toolUses)) {
      msg.toolUses = msg.toolUses.filter((tu) => {
        const act = actionMap.get(tu.tool_use_id || tu.id);
        if (act === 'drop') {
          return false;
        }
        return true;
      });
    }
  }

  // Remove empty assistant messages that lost all tool calls and had no text
  cloned = cloned.filter((msg) => {
    if (msg.role === 'assistant') {
      const hasContent = Boolean(msg.content || msg.text);
      const hasCalls = (msg.tool_calls && msg.tool_calls.length > 0) || (msg.toolUses && msg.toolUses.length > 0);
      if (!hasContent && !hasCalls) return false;
    }
    return true;
  });

  const beforeTokens = estimateTokens(JSON.stringify(messages));
  const afterTokens = estimateTokens(JSON.stringify(cloned));
  const reductionRatio = beforeTokens > 0 ? (beforeTokens - afterTokens) / beforeTokens : 0;

  return {
    messages: cloned,
    decisions,
    stats: {
      beforeTokens,

      afterTokens,
      reductionRatio: Math.max(0, reductionRatio),
      kept: keptCount,
      truncated: truncatedCount,
      dropped: droppedCount,
      pinned: calls.filter((c) => c.pinned).length,
    },
  };
}
