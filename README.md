# universal-jev

Universal TypeSafe Jev Runtime Plugin, MCP Server & Autonomous Browser Engine for Coding Agents (Codex, Pi, DSH, OpenCode, Antigravity).

## Core Capabilities

1. **Jev-Verified Receipt Extraction (95%+ Token Savings)**:
   - Evaluates lengthy terminal outputs (builds, tests, linters) using TypeSafe Jev System 1.
   - Dehydrates passing logs into high-confidence verified receipts with 100% transparency to LLMs.
   - Isolates failure/error traces while pruning routine output.
   - Absolute source code protection barrier: project source code is never modified or pruned.

2. **Universal 2-Tier Browser Engine (`jev-ultrafast` × `browser-use`)**:
   - **Tier 1 (`jev-ultrafast`)**: Sub-second indexed DOM decisions via TypeSafe Jev System 1 (zero vision LLM overhead).
   - **Tier 2 (`browser-use` Fallback)**: Automatically falls back to full multimodal semantic snapshots and visual reasoning when encountering CAPTCHAs, complex canvas, or blocked states.
   - **Zero User Disruption**: Always creates a fresh, isolated Ego Lite TaskSpace, leaving your personal tabs untouched.
   - **Instant Cleanup**: Space is guaranteed to be closed and destroyed immediately upon task completion in a `finally` block.

3. **Verbatim Context Compaction & Auto Image Dehydration**:
   - Compresses bloated conversation history while preserving user instructions 100% verbatim.
   - Automatically dehydrates images after 3 model turns, liberating up to 90% vision token budget.

4. **Fast Decision Primitives**:
   - Millisecond multi-choice classification (`Choice`), boolean hypothesis probability (`Noul`), rubric evaluation (`Score`), and security guardrails (`Guard`).

---

## Install

Requires Node.js 20+.

```bash
git clone https://github.com/raj8525/universal-jev.git ~/.agents/plugins/universal-jev
cd ~/.agents/plugins/universal-jev
./install.sh
```

Set your API key (Official TypeSafe API or OpenRouter fallback):

```bash
export TYPESAFE_API_KEY="apikey_..."
# or fallback:
export OPENROUTER_API_KEY="sk-or-v1-..."
```

---

## Usage

### 1. CLI

```bash
# Check provider connectivity and latency
jev status

# Autonomous 2-Tier browser task (jev-ultrafast -> browser-use fallback)
jev browse https://example.com "Verify page title and confirm done"
# or directly via:
ego-browse https://www.google.com/travel/flights "Find one-way flights from Zurich to London on Sep 20"

# Boolean verification (Noul)
jev noul "Is this an emergency?" --state "Database CPU 100%"

# Categorization (Choice)
jev choice "Department" --criteria "infra:Server down,billing:Payment issue" --state "Service timeout"

# Rubric score
jev score "Severity" --criteria "low,medium,high" --state "SyntaxError in script"

# Command safety guard
jev guard "rm -rf /"

# View token savings telemetry
jev stats

# Compact conversation transcript
jev compact transcript.json --out compacted.json
```

### 2. MCP Server & In-Flight Hooks

The installer automatically configures:
- **Codex (GPT-6)** via `universal-jev-codex-hook`
- **Pi Agent** via `pi-extension.ts`
- **Antigravity / OpenCode / Claude Code** via `universal-jev-mcp`

Available MCP tools:
- `jev_receipt`: Dehydrate long tool outputs into verified receipts
- `jev_compact`: Verbatim conversation compaction
- `jev_decide_choice`: Millisecond multi-option classification
- `jev_decide_noul`: Calibrated true probability ($0.0 \sim 1.0$)
- `jev_decide_score`: Ordered rubric scoring
- `jev_guard`: Pre-execution command security audit
- `jev_status`: Provider ping & health check

---

## License

MIT

