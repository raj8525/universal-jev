import assert from 'node:assert';
import { JevClient } from '../src/client.js';
import { extractJevReceipt } from '../src/receipt.js';

async function runTests() {
  console.log('=== Running Jev Receipt Extractor Tests ===');
  const client = new JevClient();

  // Test 1: Source code immunity
  console.log('Test 1: Verifying code protection barrier...');
  const pythonCode = `
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

` + '# line padding\n'.repeat(50);
  const codeResult = await extractJevReceipt(client, {
    toolName: 'view_file',
    toolInput: { file: 'fib.py' },
    output: pythonCode,
  });
  assert.strictEqual(codeResult.shouldPrune, false, 'Source code must never be pruned!');
  console.log('✓ Code protection barrier passed.');

  // Test 2: Clean build / test output
  console.log('Test 2: Verifying clean test output receipt extraction...');
  let passingLogs = '> vitest run\n\n';
  for (let i = 1; i <= 50; i++) {
    passingLogs += ` ✓ test/module_${i}.test.ts (${i * 2} tests passed) 12ms\n`;
  }
  passingLogs += '\nTest Files  50 passed (50)\nTests  250 passed (250)\nDuration  1.85s\n';

  const receiptResult = await extractJevReceipt(client, {
    toolName: 'run_command',
    toolInput: { command: 'npm test' },
    output: passingLogs,
  });

  assert.strictEqual(receiptResult.shouldPrune, true, 'Passing logs must be pruned!');
  assert(receiptResult.content.includes('[Jev Verified Receipt ✓]'), 'Must contain Verified Receipt header!');
  assert(receiptResult.content.includes('SUCCESS'), 'Must indicate SUCCESS!');
  assert(receiptResult.content.includes('Context Guard Notice'), 'Must inform LLM with Context Guard Notice!');
  assert(receiptResult.charsSaved > 1000, 'Must save massive characters!');
  console.log('✓ Clean test output verified receipt successfully generated:');
  console.log('--- RECEIPT SNIPPET ---');
  console.log(receiptResult.content);
  console.log('-----------------------');
  console.log(`Chars saved: ${receiptResult.charsSaved} (${((receiptResult.charsSaved / passingLogs.length) * 100).toFixed(1)}% reduction)\n`);

  // Test 3: Failure output
  console.log('Test 3: Verifying failure diagnostic extraction...');
  let failingLogs = '> cargo build\n   Compiling app v0.1.0\n';
  for (let i = 1; i <= 35; i++) {
    failingLogs += `   Compiling dep_${i} v1.0.0\n`;
  }
  failingLogs += `
error[E0432]: unresolved import \`crate::missing::Module\`
  --> src/main.rs:18:5
   |
18 | use crate::missing::Module;
   |     ^^^^^^^^^^^^^^^^^^^^^^ no \`Module\` in \`missing\`

error: aborting due to 1 previous error
error: could not compile \`app\`
`;

  const failureResult = await extractJevReceipt(client, {
    toolName: 'run_command',
    toolInput: { command: 'cargo build' },
    output: failingLogs,
  });

  assert.strictEqual(failureResult.shouldPrune, true, 'Failing logs should be pruned!');
  assert(failureResult.content.includes('[Jev Diagnostic Warning ⚠️]'), 'Must contain Diagnostic Warning header!');
  assert(failureResult.content.includes('unresolved import'), 'Must retain the actual error message!');
  console.log('✓ Failure diagnostic successfully generated:');
  console.log('--- DIAGNOSTIC SNIPPET ---');
  console.log(failureResult.content);
  console.log('--------------------------\n');

  // Test 4: Unified Diff / Patch Immunity
  console.log('Test 4: Verifying Unified Diff & Patch immunity...');
  const gitDiffOutput = [
    'diff --git a/src/server.ts b/src/server.ts',
    'index 1234567..89abcdef 100644',
    '--- a/src/server.ts',
    '+++ b/src/server.ts',
    '@@ -15,6 +15,12 @@ export class HttpServer {',
    '+  private securityToken: string;',
    '+  constructor(token: string) {',
    '+    this.securityToken = token;',
    '+  }',
  ].join('\n') + '\n+  // Context padding\n'.repeat(40);

  const diffResult = await extractJevReceipt(client, {
    toolName: 'run_command',
    toolInput: { command: 'git diff HEAD~1' },
    output: gitDiffOutput,
  });
  assert.strictEqual(diffResult.shouldPrune, false, 'Git Diffs must NEVER be pruned!');
  console.log('✓ Unified Diff absolute immunity verified.');

  // Test 5: Exit-Code Fast-Path
  console.log('Test 5: Verifying Exit-Code Fast-Path...');
  const fastPathLogs = 'Starting runner...\n' + 'Processing task item...\n'.repeat(40) + 'Failed on step 32\n';
  const fastPathResult = await extractJevReceipt(client, {
    toolName: 'bash',
    toolInput: { command: 'make build' },
    output: fastPathLogs,
    exitCode: 2,
  });
  assert.strictEqual(fastPathResult.shouldPrune, true, 'Non-zero exit code must be pruned into diagnostic!');
  assert.strictEqual(fastPathResult.status, 'failure', 'Must immediately register as failure!');
  assert.strictEqual(fastPathResult.confidence, 1.0, 'Must have 1.0 deterministic confidence!');
  assert(fastPathResult.content.includes('Exit Code: 2'), 'Must mention Exit Code: 2!');
  console.log('✓ Exit-Code Fast-Path verified (0ms LLM roundtrip).');

  // Test 6: Smart Anchor Sampling for Intermediate Error (e.g. Godot/Blender headless run)
  console.log('Test 6: Verifying Smart Anchor Sampling for intermediate errors...');
  let godotHeadlessLogs = 'Godot Engine v4.3.stable.official (c) 2007-present Juan Linietsky, Ariel Manzur.\n';
  for (let i = 1; i <= 40; i++) {
    godotHeadlessLogs += `[ResourceLoader] Loading resource res://assets/model_${i}.tres (OK)\n`;
  }
  godotHeadlessLogs += `
SCRIPT ERROR: Parse Error: Identifier "CharacterBody3D" is not defined in this scope.
          at: GDScript::reload (res://scripts/player.gd:42)
ERROR: Failed to instantiate scene "res://scenes/main.tscn".
`;
  for (let i = 1; i <= 40; i++) {
    godotHeadlessLogs += `[RenderingServer] Routine render pass ${i} clean.\n`;
  }
  godotHeadlessLogs += 'Orphan StringName: 12\nOrphan Resources: 3\n';

  const middleErrorResult = await extractJevReceipt(client, {
    toolName: 'run_command',
    toolInput: { command: 'godot --headless --path . -s tests/run.gd' },
    output: godotHeadlessLogs,
  });

  assert.strictEqual(middleErrorResult.shouldPrune, true, 'Middle error logs must be pruned!');
  assert(middleErrorResult.content.includes('[Jev Diagnostic Warning ⚠️]'), 'Must be flagged as diagnostic warning!');
  assert(middleErrorResult.content.includes('SCRIPT ERROR'), 'Must isolate the middle script error!');
  assert(middleErrorResult.content.includes('player.gd:42'), 'Must preserve the exact file and line of the error!');
  console.log('✓ Smart Anchor Sampling caught intermediate error in middle of 90+ lines.');

  // Test 7: Runtime execution with script arguments (e.g. python3 run.py)
  console.log('Test 7: Verifying runtime script execution allows receipt pruning...');
  let pythonRunLogs = 'Running data pipeline...\n';
  for (let i = 1; i <= 50; i++) {
    pythonRunLogs += `Processed batch ${i}/50: 1000 records loaded, loss=0.012\n`;
  }
  pythonRunLogs += 'Pipeline completed successfully in 4.2s.\n';

  const pythonResult = await extractJevReceipt(client, {
    toolName: 'run_command',
    toolInput: { command: 'python3 train_pipeline.py --epochs 50' },
    output: pythonRunLogs,
  });
  assert.strictEqual(pythonResult.shouldPrune, true, 'Passing python execution output must be dehydrated into receipt!');
  assert(pythonResult.content.includes('[Jev Verified Receipt ✓]'), 'Must generate Verified Receipt!');
  console.log('✓ Runtime execution with .py argument successfully generates receipt.');

  console.log('\nALL 7 RECEIPT EXTRACTOR TESTS PASSED! ✓');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
