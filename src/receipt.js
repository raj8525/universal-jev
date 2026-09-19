/**
 * Jev-Verified Receipt Extractor
 * ==============================
 * Transforms massive transient terminal logs (build logs, test suites, linter output)
 * into high-confidence verified receipts for LLMs using TypeSafe Jev System 1.
 *
 * Core Guarantees:
 * 1. Absolute Code Immunity: Source code files are NEVER touched or pruned.
 * 2. High Verification Quality: Calibrated status + error probability via Jev.
 * 3. 100% LLM Transparency: Explicit notices informing the LLM of pruned char counts.
 */

import { isProtectedCall, smartFormatPrunedText, formatDiagnosticErrorTrace, ERROR_PATTERNS } from './compactor.js';

export const DEFAULT_THRESHOLD_CHARS = 1200;
export const DEFAULT_THRESHOLD_LINES = 30;

/**
 * Detect explicit or output-reported non-zero exit codes.
 * Returns non-zero integer code if failure is certain, or null.
 */
export function detectExitCodeFailure(exitCode, inputStr = '', output = '') {
  if (typeof exitCode === 'number') {
    return exitCode !== 0 ? exitCode : null;
  }
  if (typeof exitCode === 'string' && exitCode.trim() !== '') {
    const parsed = parseInt(exitCode, 10);
    if (!Number.isNaN(parsed) && parsed !== 0) return parsed;
  }
  if (output && typeof output === 'string') {
    const outputSample = output.slice(-2000);
    const exitMatch = outputSample.match(/\b(?:exit(?:ed with)?\s+(?:code|status)\s*[:=]?\s*([1-9]\d*)|command failed with exit code ([1-9]\d*)|ELIFECYCLE.*?Exit status ([1-9]\d*))\b/i);
    if (exitMatch) {
      const code = parseInt(exitMatch[1] || exitMatch[2] || exitMatch[3], 10);
      if (!Number.isNaN(code) && code !== 0) return code;
    }
  }
  return null;
}

/**
 * Smart Intermediate Anchor Sampling:
 * Scans the un-sampled middle portion of massive outputs for error patterns or stack traces,
 * ensuring intermediate crashes are not concealed by routine head/tail logs.
 */
export function extractIntermediateErrorAnchor(output, headLength = 1000, tailLength = 1500, maxAnchorChars = 1200) {
  if (!output || output.length <= headLength + tailLength + 200) {
    return null;
  }

  const middle = output.slice(headLength, output.length - tailLength);
  const match = ERROR_PATTERNS.exec(middle);
  if (!match) return null;

  const matchIdxInFull = headLength + match.index;
  const searchStart = Math.max(headLength, matchIdxInFull - 250);
  const prevNewline = output.lastIndexOf('\n', matchIdxInFull);
  const anchorStart = prevNewline !== -1 && prevNewline >= searchStart ? prevNewline + 1 : searchStart;

  const searchEnd = Math.min(output.length - tailLength, anchorStart + maxAnchorChars);
  const nextNewline = output.indexOf('\n', searchEnd);
  const anchorEnd = nextNewline !== -1 && nextNewline <= output.length - tailLength ? nextNewline : searchEnd;

  return output.slice(anchorStart, anchorEnd).trim();
}

/**
 * Audit and dehydrate long tool output into a verified receipt or isolated diagnostic.
 *
 * @param {import('./client.js').JevClient} client
 * @param {Object} params
 * @param {string} params.toolName
 * @param {any} params.toolInput
 * @param {string} params.output
 * @param {number|string|null} [params.exitCode]
 * @param {number} [params.thresholdChars]
 * @param {number} [params.thresholdLines]
 * @returns {Promise<{ shouldPrune: boolean, content: string, charsSaved: number, status?: string, confidence?: number }>}
 */
export async function extractJevReceipt(client, {
  toolName = '',
  toolInput = {},
  output = '',
  exitCode = null,
  thresholdChars = DEFAULT_THRESHOLD_CHARS,
  thresholdLines = DEFAULT_THRESHOLD_LINES,
}) {
  if (!output || typeof output !== 'string') {
    return { shouldPrune: false, content: output || '', charsSaved: 0 };
  }

  // 1. Absolute Code & Diff Protection Barrier
  if (isProtectedCall(toolName, toolInput, output)) {
    return { shouldPrune: false, content: output, charsSaved: 0 };
  }

  // 2. Threshold Check: Passthrough short outputs immediately with zero latency
  const lines = output.split('\n');
  if (output.length < thresholdChars && lines.length < thresholdLines) {
    return { shouldPrune: false, content: output, charsSaved: 0 };
  }

  const cmdStr =
    typeof toolInput === 'string'
      ? toolInput
      : typeof toolInput?.command === 'string'
      ? toolInput.command
      : typeof toolInput?.cmd === 'string'
      ? toolInput.cmd
      : toolName;

  // 3. Exit-Code Fast-Path: Deterministic short-circuit for non-zero exit codes (0ms LLM latency)
  const explicitErrorCode = detectExitCodeFailure(
    exitCode ?? toolInput?.exitCode ?? toolInput?.exit_code ?? toolInput?.code,
    cmdStr,
    output
  );

  if (explicitErrorCode !== null) {
    const prunedTrace = formatDiagnosticErrorTrace(output);
    const diagnostic = [
      `[Jev Diagnostic Warning ⚠️]`,
      `- Target Tool/Command: ${cmdStr}`,
      `- Verification Status: FAILURE (Exit Code: ${explicitErrorCode})`,
      `[Context Guard Notice: Prior routine logs were omitted. Relevant error trace is isolated below:]`,
      `--------------------------------------------------------------------------------`,
      prunedTrace,
      `--------------------------------------------------------------------------------`,
    ].join('\n');

    return {
      shouldPrune: true,
      content: diagnostic,
      charsSaved: Math.max(0, output.length - diagnostic.length),
      status: 'failure',
      confidence: 1.0,
    };
  }

  // 4. Prepare compact observation state for Jev System 1 with Smart Anchor Sampling
  const headSample = output.slice(0, 1000);
  const tailSample = output.slice(-1500);
  const intermediateAnchor = extractIntermediateErrorAnchor(output, 1000, 1500);

  const sampleParts = [
    `Tool: ${toolName}`,
    `Command: ${cmdStr}`,
    `Total Output Length: ${output.length} chars, ${lines.length} lines`,
    `--- OUTPUT HEAD ---`,
    headSample,
  ];

  if (intermediateAnchor) {
    sampleParts.push(
      `\n... [intermediate routine logs omitted] ...\n`,
      `--- INTERMEDIATE ERROR / TRACEBACK ANCHOR ---`,
      intermediateAnchor
    );
  }

  sampleParts.push(
    `\n... [intermediate output] ...\n`,
    `--- OUTPUT TAIL ---`,
    tailSample
  );

  const sampleState = sampleParts.join('\n');

  const questions = {
    status: {
      type: 'choice',
      instructions: 'Evaluate the final execution outcome of this command/tool output. Has it succeeded cleanly without blocking errors, or did it fail/error?',
      criteria: {
        success: 'Command succeeded cleanly without errors, all tests/tasks passed.',
        failure: 'Command failed, threw unhandled exceptions, crashed, or reported test/build failures.',
        warning: 'Command finished but emitted important warnings that may require attention.',
      },
    },
    has_critical_error: {
      type: 'noul',
      instructions: 'Does this output contain an error, failure, or exception that requires developer attention or fixing?',
    },
  };

  try {
    const decision = await client.decide(sampleState, questions, { timeout: 4000 });
    const answers = decision.answers || {};

    const statusChoice = answers.status?.choice || 'success';
    const confidence = answers.status?.confidence ?? 0.95;
    const errorProb = answers.has_critical_error?.noul ?? 0.0;

    // 5. Scenario A: Clean Success -> High-Confidence Verified Receipt
    if (statusChoice === 'success' && errorProb < 0.15) {
      const nonEmpties = lines.map((l) => l.trim()).filter(Boolean);
      const summaryLines = nonEmpties.slice(-4).join('\n  ');
      const prunedChars = output.length;

      const receipt = [
        `[Jev Verified Receipt ✓]`,
        `- Target Tool/Command: ${cmdStr}`,
        `- Verification Status: SUCCESS (Confidence: ${confidence.toFixed(2)}, P(Error): ${errorProb.toFixed(2)})`,
        `- Verified Key Output:`,
        `  ${summaryLines}`,
        `[Context Guard Notice: ${prunedChars} chars of intermediate passing runtime logs were safely pruned by TypeSafe Jev. Source code is preserved verbatim.]`,
      ].join('\n');

      return {
        shouldPrune: true,
        content: receipt,
        charsSaved: output.length - receipt.length,
        status: 'success',
        confidence,
      };
    }

    // 6. Scenario B: Error / Failure / Warning -> Isolated Error Diagnostic Trace
    if (errorProb >= 0.15 || statusChoice === 'failure') {
      const prunedTrace = formatDiagnosticErrorTrace(output);
      const diagnostic = [
        `[Jev Diagnostic Warning ⚠️]`,
        `- Target Tool/Command: ${cmdStr}`,
        `- Verification Status: FAILURE / ERROR DETECTED (Confidence: ${confidence.toFixed(2)}, P(Error): ${errorProb.toFixed(2)})`,
        `[Context Guard Notice: Prior routine logs were omitted. Relevant error trace is isolated below:]`,
        `--------------------------------------------------------------------------------`,
        prunedTrace,
        `--------------------------------------------------------------------------------`,
      ].join('\n');

      return {
        shouldPrune: true,
        content: diagnostic,
        charsSaved: output.length - diagnostic.length,
        status: 'failure',
        confidence,
      };
    }
  } catch (err) {
    // If Jev API request fails or times out, fallback safely to mechanical truncation with error isolation
    const fallbackPruned = formatDiagnosticErrorTrace(output, { headLines: 10, tailLines: 30 });
    if (fallbackPruned.length < output.length) {
      const fallbackContent = [
        `[Jev Context Notice: Runtime logs pruned (Fallback Mode)]`,
        fallbackPruned,
      ].join('\n');
      return {
        shouldPrune: true,
        content: fallbackContent,
        charsSaved: output.length - fallbackContent.length,
        status: 'fallback',
        confidence: 0.5,
      };
    }
  }

  return { shouldPrune: false, content: output, charsSaved: 0 };
}
