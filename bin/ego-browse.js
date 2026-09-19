#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BROWSER_RUNNER_PATH = join(__dirname, '..', 'src', 'browser.js');

const args = process.argv.slice(2);

if (args.length < 2 || args.includes('-h') || args.includes('--help')) {
  console.log(`
Universal Jev Browser CLI (2-Tier Engine)
=========================================
Usage:
  ego-browse <url> <goal> [--max-steps <N>]

Pipeline:
  1. Creates isolated Ego Lite TaskSpace (User tabs untouched)
  2. Runs Tier 1: jev-ultrafast (Sub-second DOM index + TypeSafe Jev System 1)
  3. If blocked / complex: Auto-falls back to Tier 2: browser-use (Full semantic snapshot + screenshot)
  4. Always closes and destroys the newly created space immediately upon completion

Examples:
  ego-browse https://example.com "Verify page title and confirm done"
  ego-browse https://www.google.com/travel/flights "Find one-way flights from Zurich to London on Sep 20"
`);
  process.exit(0);
}

const url = args[0];
const goal = args[1];
const maxStepsIdx = args.indexOf('--max-steps');
const maxSteps = maxStepsIdx !== -1 ? parseInt(args[maxStepsIdx + 1], 10) : 15;

const runnerCode = `
import { runUnifiedBrowserTask } from ${JSON.stringify(BROWSER_RUNNER_PATH)};

const result = await runUnifiedBrowserTask({
  taskSpaceFn: taskSpace,
  url: ${JSON.stringify(url)},
  goal: ${JSON.stringify(goal)},
  maxSteps: ${maxSteps},
  autoClose: true,
  logger: console.log,
});

console.log('\\n[FINAL_RESULT]');
console.log(JSON.stringify(result, null, 2));
`;

const proc = spawn('/Users/yangyu/.local/bin/ego-browser', ['nodejs'], {
  stdio: ['pipe', 'inherit', 'inherit'],
});

proc.stdin.write(runnerCode);
proc.stdin.end();

proc.on('close', (code) => {
  process.exit(code || 0);
});
