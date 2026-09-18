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
  // Game Dev & Shaders
  '.gd', '.tres', '.tscn', '.gdshader', '.shader', '.hlsl', '.glsl', '.wgsl', '.frag', '.vert',
  // Web & Node / TypeScript
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.html', '.css', '.scss', '.sass', '.less',
  // Systems & Native
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx', '.rs', '.go', '.zig', '.odin', '.nim',
  // JVM & Mobile
  '.java', '.kt', '.kts', '.scala', '.swift', '.m', '.mm', '.dart',
  // .NET & Windows
  '.cs', '.fs', '.vb', '.csproj', '.sln',
  // Dynamic & Scripting
  '.py', '.pyi', '.rb', '.rake', '.php', '.lua', '.pl', '.pm', '.sh', '.bash', '.zsh', '.fish', '.bat', '.cmd', '.ps1',
  // Data & Configs & Markup
  '.json', '.jsonc', '.json5', '.toml', '.yaml', '.yml', '.xml', '.ini', '.conf', '.env', '.dockerfile',
  '.md', '.markdown', '.rst', '.txt', '.sql', '.graphql', '.gql', '.proto',
  // Assembly & Low-level
  '.asm', '.s', '.wat', '.wast'
];

export const CODE_INSPECTION_TOOLS = new Set([
  'read_file', 'view_file', 'cat', 'head', 'tail', 'grep', 'grep_search',
  'find_by_name', 'list_dir', 'file_search', 'read_resource', 'fs_read'
]);

export const CODE_CONTENT_HEURISTICS = [
  /^#!\s*\/(usr\/|bin\/)/m, // Shebang
  /^\s*(import|from\s+\w+\s+import|require\s*\(|package\s+|using\s+|#include\s+)/m, // Imports
  /^\s*(func\s+|def\s+|fn\s+|pub\s+fn\s+|class\s+|struct\s+|interface\s+|enum\s+|namespace\s+)/m, // Declarations
  /^\s*(extends\s+|class_name\s+|@export|@onready)/m, // Godot
  /^\s*<\?php/m, // PHP
  /^\s*<!DOCTYPE\s+html>/im, // HTML
  /^\s*SELECT\s+.*\s+FROM\s+/im // SQL
];

export function hasCodeSignature(text) {
  if (!text || typeof text !== 'string') return false;
  // Inspect the first 2000 characters
  const sample = text.slice(0, 2000);
  for (const pattern of CODE_CONTENT_HEURISTICS) {
    if (pattern.test(sample)) return true;
  }
  return false;
}

export function isProtectedCall(toolName, input, output = '') {
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

  // Content-based heuristic: if output has code signatures, protect it
  if (output && typeof output === 'string' && hasCodeSignature(output)) {
    return true;
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
export async function compactMessages(client, rawMessages, options = {}) {
  const preserveRecent = options.preserveRecent ?? 8;
  const imageDehydration = dehydrateImages(rawMessages, options.minImageRounds ?? 3);
  const messages = imageDehydration.messages;

  if (!messages || messages.length <= preserveRecent + 1) {
    const beforeTokens = estimateTokens(JSON.stringify(rawMessages));
    const afterTokens = estimateTokens(JSON.stringify(messages));
    return {
      messages,
      decisions: [],
      stats: {
        beforeTokens,
        afterTokens,
        reductionRatio: beforeTokens > 0 ? (beforeTokens - afterTokens) / beforeTokens : 0,
        kept: 0,
        truncated: 0,
        dropped: 0,
        pinned: messages.length,
        dehydratedImages: imageDehydration.dehydratedCount,
        imageTokensSaved: imageDehydration.tokensSaved,
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

  const beforeTokens = estimateTokens(JSON.stringify(rawMessages));
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
      dehydratedImages: imageDehydration.dehydratedCount,
      imageTokensSaved: imageDehydration.tokensSaved,
    },
  };
}

/**
 * 历史图片脱水机制 (Image Payload Eviction)
 * 当用户发送的 Base64 图片已经被模型回答过指定轮数（默认 >= 3 轮）之后，
 * 自动将其超大 Base64 载荷替换为轻量标记文本，释放海量上下文预算。
 * 
 * @param {Array} messages 消息列表
 * @param {number} minRoundsThreshold 触发脱水的后续回答轮数门槛（默认 3 轮）
 * @returns {{ messages: Array, dehydratedCount: number, charsSaved: number, tokensSaved: number }}
 */
export function dehydrateImages(messages, minRoundsThreshold = 3) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages, dehydratedCount: 0, charsSaved: 0, tokensSaved: 0 };
  }

  let dehydratedCount = 0;
  let charsSaved = 0;
  let modified = false;

  // Clone messages
  const cloned = messages.map((m) => {
    if (!m) return m;
    if (Array.isArray(m.content)) {
      return { ...m, content: m.content.map((p) => ({ ...p })) };
    }
    return { ...m };
  });

  for (let i = 0; i < cloned.length; i++) {
    const msg = cloned[i];
    if (msg.role !== 'user' || !Array.isArray(msg.content)) {
      continue;
    }

    // Check if this message has any image parts
    const hasImages = msg.content.some((p) => {
      if (p.type === 'image' && (p.data || (p.source && p.source.data))) return true;
      if (p.type === 'image_url' && p.image_url) return true;
      return false;
    });

    if (!hasImages) continue;

    // Count how many assistant messages have occurred AFTER this user message
    let assistantRoundsAfter = 0;
    for (let j = i + 1; j < cloned.length; j++) {
      if (cloned[j].role === 'assistant') {
        assistantRoundsAfter++;
      }
    }

    // Only dehydrate if model has answered at least minRoundsThreshold turns after this image
    if (assistantRoundsAfter < minRoundsThreshold) {
      continue;
    }

    // Dehydrate the image parts in this message
    for (let pIdx = 0; pIdx < msg.content.length; pIdx++) {
      const part = msg.content[pIdx];
      let imgDataLen = 0;

      if (part.type === 'image') {
        if (typeof part.data === 'string') {
          imgDataLen = part.data.length;
        } else if (part.source && typeof part.source.data === 'string') {
          imgDataLen = part.source.data.length;
        }
      } else if (part.type === 'image_url' && part.image_url) {
        const url = typeof part.image_url === 'string' ? part.image_url : part.image_url.url;
        if (typeof url === 'string') {
          imgDataLen = url.length;
        }
      }

      // Only dehydrate large images (> 1000 chars)
      if (imgDataLen > 1000) {
        dehydratedCount++;
        charsSaved += imgDataLen;
        modified = true;
        const estTokens = Math.round(imgDataLen / 4);
        msg.content[pIdx] = {
          type: 'text',
          text: `[系统说明: 原始图片 Base64 载荷已在前期跨越 ${assistantRoundsAfter} 轮交互后由 Universal Jev 自动脱水，已释放约 ${estTokens.toLocaleString()} tokens 预算，前期模型的视觉解析结论仍完整保留在上下文中]`
        };
      }
    }
  }

  const tokensSaved = Math.round(charsSaved / 4);
  return {
    messages: modified ? cloned : messages,
    dehydratedCount,
    charsSaved,
    tokensSaved,
  };
}

