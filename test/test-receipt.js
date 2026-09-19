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

  console.log('ALL RECEIPT EXTRACTOR TESTS PASSED! ✓');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
