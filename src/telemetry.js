import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { estimateTokens } from './compactor.js';

const TELEMETRY_DIR = path.join(os.homedir(), '.local', 'share', 'universal-jev');
const TELEMETRY_FILE = path.join(TELEMETRY_DIR, 'telemetry.json');

function ensureDir() {
  if (!fs.existsSync(TELEMETRY_DIR)) {
    fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
  }
}

export function loadTelemetry() {
  try {
    ensureDir();
    if (!fs.existsSync(TELEMETRY_FILE)) {
      return {
        totalPruneEvents: 0,
        totalCharsSaved: 0,
        totalTokensSaved: 0,
        events: []
      };
    }
    const raw = fs.readFileSync(TELEMETRY_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {
      totalPruneEvents: 0,
      totalCharsSaved: 0,
      totalTokensSaved: 0,
      events: []
    };
  }
}

export function recordPruneEvent({ agent = 'unknown', command = '', originalChars = 0, prunedChars = 0 }) {
  try {
    ensureDir();
    const data = loadTelemetry();
    const charsSaved = Math.max(0, originalChars - prunedChars);
    const tokensSaved = Math.round(charsSaved / 3.8);
    const ratio = originalChars > 0 ? ((charsSaved / originalChars) * 100).toFixed(1) : '0';

    data.totalPruneEvents += 1;
    data.totalCharsSaved += charsSaved;
    data.totalTokensSaved += Math.max(0, tokensSaved);

    data.events.unshift({
      timestamp: new Date().toISOString(),
      agent,
      command: command.slice(0, 120),
      originalChars,
      prunedChars,
      charsSaved,
      tokensSaved: Math.max(0, tokensSaved),
      ratio: `${ratio}%`
    });

    // Keep last 100 events
    if (data.events.length > 100) {
      data.events = data.events.slice(0, 100);
    }

    fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    // Silently ignore telemetry write errors to never disrupt main flow
  }
}

export function renderStatsDashboard() {
  const data = loadTelemetry();
  const charsSaved = data.totalCharsSaved.toLocaleString();
  const tokensSaved = data.totalTokensSaved.toLocaleString();

  console.log('===============================================================');
  console.log('           Universal Jev Context Compactor Analytics           ');
  console.log('===============================================================');
  console.log(` Cumulative Pruning Events : ${data.totalPruneEvents}`);
  console.log(` Total Raw Chars Saved     : ${charsSaved} chars`);
  console.log(` Total Tokens Released     : ~${tokensSaved} tokens`);
  console.log('---------------------------------------------------------------');
  console.log(' Recent Pruning History (Top 10):');
  if (data.events.length === 0) {
    console.log('   (No pruning events recorded yet. Run a verbose build or test command)');
  } else {
    for (const e of data.events.slice(0, 10)) {
      const time = new Date(e.timestamp).toLocaleTimeString();
      const cmd = e.command || '[Large output]';
      console.log(` • [${time}] [${e.agent}] Saved ${e.tokensSaved} tok (${e.ratio}) | ${cmd}`);
    }
  }
  console.log('===============================================================');
}
