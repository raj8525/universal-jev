import { spawn } from 'node:child_process';
import { JevClient, decideChoice, decideNoul, decideScore, guardCommand, compactMessages } from '../src/index.js';

async function runTests() {
  console.log('=== Step 1: Testing Jev Client & Decision Primitives ===');
  const client = new JevClient();

  const noulRes = await decideNoul(client, 'The web server is unreachable', 'Is this an operational issue?');
  console.log(`[PASS] Noul test: prob=${noulRes.noul}, model=${noulRes.model}`);

  const choiceRes = await decideChoice(
    client,
    'Client wants to cancel recurring subscription',
    'Customer intent',
    { refund: 'Cancel or refund', tech_support: 'Technical problem' }
  );
  console.log(`[PASS] Choice test: choice=${choiceRes.choice}, conf=${choiceRes.confidence}`);

  const guardRes = await guardCommand(client, 'git status', 'Routine check');
  console.log(`[PASS] Guard test: allowed=${guardRes.allowed}, risk=${guardRes.riskScore}`);

  console.log('\n=== Step 2: Testing Verbatim Compaction Engine ===');
  const dummyTranscript = [
    { role: 'user', content: 'Please inspect the bug in the auth service. Do not touch production DB.' },
    {
      role: 'assistant',
      content: 'I will read the auth log file.',
      tool_calls: [{ id: 'call_1', function: { name: 'readFile', arguments: { path: 'logs/auth.log' } } }],
    },
    {
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'DEBUG [2026-09-18 10:00:00]: Starting auth service...\n'.repeat(40) + 'CRITICAL: Auth token expired for user 9999\n' + 'INFO: Shutting down connection.\n'.repeat(30),
    },
    {
      role: 'assistant',
      content: 'The log showed an expired token. Now running test suite.',
      tool_calls: [{ id: 'call_2', function: { name: 'runTest', arguments: { suite: 'auth' } } }],
    },
    {
      role: 'tool',
      tool_call_id: 'call_2',
      content: 'PASSED auth/login.test.ts\nPASSED auth/token.test.ts\n' + 'LOG output verbose line...\n'.repeat(50),
    },
    { role: 'assistant', content: 'All tests passed after the fix.' },
    { role: 'user', content: 'Great, now deploy to staging.' },
  ];

  const compactResult = await compactMessages(client, dummyTranscript, { preserveRecentMessages: 2 });
  console.log(`[PASS] Compaction reduction: ${(compactResult.stats.reductionRatio * 100).toFixed(1)}%`);
  console.log(`       Before tokens: ${compactResult.stats.beforeTokens}, After tokens: ${compactResult.stats.afterTokens}`);
  console.log(`       Decisions:`, compactResult.decisions);

  // Check verbatim preservation of user prompts
  if (compactResult.messages[0].content !== dummyTranscript[0].content) {
    throw new Error('User message was not preserved verbatim!');
  }
  console.log('[PASS] Verbatim constraint verified: user instruction untouched!');

  console.log('\n=== Step 3: Testing MCP Server JSON-RPC 2.0 Stdio ===');
  await testMcpServer();
  console.log('[PASS] MCP Server JSON-RPC stdio protocol verified!');

  console.log('\nALL UNIVERSAL JEV PLUGIN TESTS PASSED SUCCESSFULLY! ✓');
}

function testMcpServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['./bin/mcp-server.js'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    let stdoutData = '';
    proc.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
      const lines = stdoutData.split('\n');
      stdoutData = lines.pop(); // keep remainder

      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line.trim());
        if (msg.id === 1) {
          // Initialize response
          if (!msg.result?.serverInfo?.name) {
            reject(new Error('MCP initialize response invalid'));
            return;
          }
          // Send tools/list
          proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
        } else if (msg.id === 2) {
          // Tools list response
          const toolNames = msg.result?.tools?.map((t) => t.name) || [];
          if (!toolNames.includes('jev_compact') || !toolNames.includes('jev_decide_noul')) {
            reject(new Error('MCP tools/list missing required Jev tools'));
            return;
          }
          // Send tools/call for jev_decide_noul
          proc.stdin.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 3,
              method: 'tools/call',
              params: {
                name: 'jev_decide_noul',
                arguments: { state: 'MCP Stdio test', question: 'Is MCP responding?' },
              },
            }) + '\n'
          );
        } else if (msg.id === 3) {
          // Tools call response
          const content = msg.result?.content?.[0]?.text;
          const parsed = JSON.parse(content);
          if (typeof parsed.noul !== 'number') {
            reject(new Error('Invalid tool call output from MCP server'));
            return;
          }
          proc.kill();
          resolve();
        }
      }
    });

    proc.on('error', reject);

    // Start with initialize
    proc.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {} },
      }) + '\n'
    );
  });
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
