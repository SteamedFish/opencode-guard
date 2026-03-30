import { test } from 'node:test';
import assert from 'node:assert';
import { OpenCodeGuard } from '../src/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFile, mkdir, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to create temp config
async function createTempConfig(dir, config) {
  const configPath = join(dir, 'opencode-guard.config.json');
  await writeFile(configPath, JSON.stringify(config));
  return configPath;
}

// Helper to create temp directory
async function createTempDir() {
  const dir = join(tmpdir(), `opencode-guard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// Helper to cleanup
async function cleanup(dir) {
  try {
    await unlink(join(dir, 'opencode-guard.config.json'));
    await rmdir(dir);
  } catch {}
}

test('OpenCodeGuard returns empty object when disabled', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { enabled: false, global_salt: 'test' });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    assert.strictEqual(typeof plugin, 'object');
    assert.strictEqual(Object.keys(plugin).length, 0);
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard returns empty object when config has no global_salt', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { enabled: true });

  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    assert.strictEqual(typeof plugin, 'object');
    assert.strictEqual(Object.keys(plugin).length, 0);
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard returns empty object when no global_salt', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { enabled: true });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    assert.strictEqual(typeof plugin, 'object');
    assert.strictEqual(Object.keys(plugin).length, 0);
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard returns plugin hooks when enabled', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    assert.strictEqual(typeof plugin, 'object');
    assert.ok(plugin['experimental.chat.messages.transform']);
    assert.ok(plugin['experimental.text.complete']);
    assert.ok(plugin['experimental.text.chunk']);
    assert.ok(plugin['experimental.stream.end']);
    assert.ok(plugin['mcp.tool.call.before']);
    assert.ok(plugin['mcp.tool.call.after']);
    assert.ok(plugin['tool.execute.before']);
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard experimental.chat.messages.transform masks email in text parts', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'text',
          text: 'Contact me at user@example.com'
        }]
      }]
    };
    
    await transform({}, output);
    
    assert.ok(!output.messages[0].parts[0].text.includes('user@example.com'));
    assert.ok(output.messages[0].parts[0].text.includes('@example.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard transform skips messages with no parts', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' }
        // No parts array
      }]
    };
    
    // Should not throw
    await transform({}, output);
    assert.strictEqual(output.messages.length, 1);
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard transform skips empty messages array', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = { messages: [] };
    
    // Should not throw
    await transform({}, output);
    assert.deepStrictEqual(output.messages, []);
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard transform handles reasoning parts', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'reasoning',
          text: 'The user email is admin@company.com'
        }]
      }]
    };
    
    await transform({}, output);
    
    assert.ok(!output.messages[0].parts[0].text.includes('admin@company.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard transform skips ignored parts', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const originalText = 'Contact admin@company.com';
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'text',
          text: originalText,
          ignored: true
        }]
      }]
    };
    
    await transform({}, output);
    
    // Should not be masked
    assert.strictEqual(output.messages[0].parts[0].text, originalText);
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard transform masks tool input', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'tool',
          state: {
            input: { email: 'user@example.com' }
          }
        }]
      }]
    };
    
    await transform({}, output);
    
    assert.ok(!output.messages[0].parts[0].state.input.email.includes('user@example.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard transform masks tool output when completed', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'tool',
          state: {
            status: 'completed',
            output: 'Result sent to admin@company.com'
          }
        }]
      }]
    };
    
    await transform({}, output);
    
    assert.ok(!output.messages[0].parts[0].state.output.includes('admin@company.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard transform masks tool error', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'tool',
          state: {
            status: 'error',
            error: 'Failed to send to admin@company.com'
          }
        }]
      }]
    };
    
    await transform({}, output);
    
    assert.ok(!output.messages[0].parts[0].state.error.includes('admin@company.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard transform skips excluded endpoints', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] },
    exclude_llm_endpoints: ['localhost:8080']
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const originalText = 'Contact admin@company.com';
    const output = {
      messages: [{
        info: { sessionID: 'test-session', endpoint: 'http://localhost:8080/api' },
        parts: [{
          type: 'text',
          text: originalText
        }]
      }]
    };
    
    await transform({}, output);
    
    // Should not be masked due to excluded endpoint
    assert.strictEqual(output.messages[0].parts[0].text, originalText);
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard experimental.text.complete restores masked values', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    const complete = plugin['experimental.text.complete'];
    
    // First mask
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'text',
          text: 'Contact user@example.com'
        }]
      }]
    };
    await transform({}, output);
    const maskedText = output.messages[0].parts[0].text;
    
    // Then restore
    const completeOutput = { text: `Response: ${maskedText}` };
    await complete({ sessionID: 'test-session' }, completeOutput);
    
    assert.ok(completeOutput.text.includes('user@example.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard experimental.text.complete handles non-string output', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const complete = plugin['experimental.text.complete'];
    
    // Should not throw with null output
    await complete({ sessionID: 'test-session' }, null);
    
    // Should not throw with non-string text
    await complete({ sessionID: 'test-session' }, { text: 123 });
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard mcp.tool.call.before restores masked args for excluded servers', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, {
    enabled: true,
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] },
    exclude_mcp_servers: ['local-server']
  });

  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transformHook = plugin['experimental.chat.messages.transform'];
    const beforeHook = plugin['mcp.tool.call.before'];

    // First, create a session by processing a message (this creates the mapping)
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'text',
          text: 'Contact user@example.com for help'
        }]
      }]
    };
    await transformHook({}, output);

    // The email should now be masked in the message
    const maskedEmail = output.messages[0].parts[0].text.match(/[\w._-]+@example\.com/)[0];
    assert.ok(maskedEmail !== 'user@example.com', 'Email should be masked');

    // Now simulate MCP tool call with the masked email in args (excluded/local server)
    const mcpOutput = { args: { email: maskedEmail } };
    await beforeHook({ sessionID: 'test-session', serverName: 'local-server' }, mcpOutput);

    // The args should be restored to original for excluded servers
    assert.strictEqual(mcpOutput.args.email, 'user@example.com', 'Args should be restored for excluded servers');
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard mcp.tool.call.before skips excluded servers', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] },
    exclude_mcp_servers: ['excluded-server']
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const beforeHook = plugin['mcp.tool.call.before'];
    
    const originalEmail = 'user@example.com';
    const output = { args: { email: originalEmail } };
    await beforeHook({ sessionID: 'test-session', serverName: 'excluded-server' }, output);
    
    // Should not be masked
    assert.strictEqual(output.args.email, originalEmail);
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard mcp.tool.call.after masks result', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, {
    enabled: true,
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });

  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const afterHook = plugin['mcp.tool.call.after'];

    // Simulate tool result containing sensitive data
    const afterOutput = { result: { email: 'user@example.com' } };
    await afterHook({ sessionID: 'test-session' }, afterOutput);

    // Result should be masked to prevent leaking secrets to LLM
    assert.ok(afterOutput.result.email !== 'user@example.com', 'Result should be masked');
    assert.ok(afterOutput.result.email.includes('@example.com'), 'Domain should be preserved');
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard tool.execute.before restores args', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const beforeHook = plugin['mcp.tool.call.before'];
    const executeHook = plugin['tool.execute.before'];
    
    // First mask via mcp before hook
    const mcpOutput = { args: { email: 'user@example.com' } };
    await beforeHook({ sessionID: 'test-session' }, mcpOutput);
    const maskedEmail = mcpOutput.args.email;
    
    // Then restore via execute hook
    const executeOutput = { args: { email: maskedEmail } };
    await executeHook({ sessionID: 'test-session' }, executeOutput);
    
    assert.strictEqual(executeOutput.args.email, 'user@example.com');
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard streaming unmasker works end-to-end', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    const chunk = plugin['experimental.text.chunk'];
    const streamEnd = plugin['experimental.stream.end'];
    
    // First mask
    const output = {
      messages: [{
        info: { sessionID: 'stream-test' },
        parts: [{
          type: 'text',
          text: 'Email: user@example.com'
        }]
      }]
    };
    await transform({}, output);
    const maskedText = output.messages[0].parts[0].text;
    
    // Then stream restore
    const chunkOutput = { text: maskedText };
    await chunk({ sessionID: 'stream-test' }, chunkOutput);
    
    assert.ok(chunkOutput.text.includes('user@example.com'));
    
    // Clean up
    await streamEnd({ sessionID: 'stream-test' });
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard sessions are isolated', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    const complete = plugin['experimental.text.complete'];
    
    // Mask in session 1
    const output1 = {
      messages: [{
        info: { sessionID: 'session-1' },
        parts: [{ type: 'text', text: 'Email: user1@example.com' }]
      }]
    };
    await transform({}, output1);
    const masked1 = output1.messages[0].parts[0].text;
    
    // Mask in session 2
    const output2 = {
      messages: [{
        info: { sessionID: 'session-2' },
        parts: [{ type: 'text', text: 'Email: user2@example.com' }]
      }]
    };
    await transform({}, output2);
    const masked2 = output2.messages[0].parts[0].text;
    
    // Restore session 1
    const completeOutput = { text: masked1 };
    await complete({ sessionID: 'session-1' }, completeOutput);
    assert.ok(completeOutput.text.includes('user1@example.com'));
    assert.ok(!completeOutput.text.includes('user2@example.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard handles sessionID from parts array', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: {},  // No sessionID here
        parts: [{
          type: 'text',
          text: 'Email: user@example.com',
          sessionID: 'parts-session'  // sessionID in parts
        }]
      }]
    };
    
    await transform({}, output);
    
    // Should have masked
    assert.ok(!output.messages[0].parts[0].text.includes('user@example.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard handles null/undefined sessionID gracefully', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: {},  // No sessionID
        parts: [{
          type: 'text',
          text: 'Email: user@example.com'
        }]
      }]
    };
    
    // Should not throw
    await transform({}, output);
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard debug mode logs messages', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] },
    debug: true
  });
  
  const originalDebug = process.env.OPENCODE_GUARD_DEBUG;
  process.env.OPENCODE_GUARD_DEBUG = '1';
  
  try {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    
    await OpenCodeGuard({ directory: tempDir });
    
    console.log = originalLog;
    
    // Should have logged config info
    assert.ok(logs.some(log => log.includes('opencode-guard')));
  } finally {
    process.env.OPENCODE_GUARD_DEBUG = originalDebug;
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard handles multiple patterns', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email', 'uuid', 'ipv4'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'text',
          text: 'Email: user@example.com, UUID: 550e8400-e29b-41d4-a716-446655440000, IP: 192.168.1.100'
        }]
      }]
    };
    
    await transform({}, output);
    
    // All should be masked
    assert.ok(!output.messages[0].parts[0].text.includes('user@example.com'));
    assert.ok(!output.messages[0].parts[0].text.includes('550e8400-e29b-41d4-a716-446655440000'));
    assert.ok(!output.messages[0].parts[0].text.includes('192.168.1.100'));
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard handles custom patterns', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: {
      regex: [
        { pattern: 'SECRET_[A-Z]{3,}', category: 'SECRET', mask_as: 'pattern' }
      ]
    }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'text',
          text: 'Token: SECRET_ABC123'
        }]
      }]
    };
    
    await transform({}, output);
    
    assert.ok(!output.messages[0].parts[0].text.includes('SECRET_ABC123'));
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard handles keywords', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: {
      keywords: [
        { value: 'INTERNAL_TOKEN', category: 'TOKEN', mask_as: 'pattern' }
      ]
    }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'text',
          text: 'Use INTERNAL_TOKEN for auth'
        }]
      }]
    };
    
    await transform({}, output);
    
    assert.ok(!output.messages[0].parts[0].text.includes('INTERNAL_TOKEN'));
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard handles exclude patterns', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: {
      regex: [
        { pattern: 'token_[a-z]+', category: 'TOKEN', mask_as: 'pattern' }
      ],
      exclude: ['token_public']
    }
  });

  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'text',
          text: 'Private: token_secret, Public: token_public'
        }]
      }]
    };
    
    await transform({}, output);
    
    // token_secret should be masked, token_public should not
    assert.ok(!output.messages[0].parts[0].text.includes('token_secret'));
    assert.ok(output.messages[0].parts[0].text.includes('token_public'));
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard handles deeply nested objects in tool state', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'tool',
          state: {
            input: {
              level1: {
                level2: {
                  level3: {
                    email: 'deep@example.com'
                  }
                }
              }
            }
          }
        }]
      }]
    };
    
    await transform({}, output);
    
    assert.ok(!output.messages[0].parts[0].state.input.level1.level2.level3.email.includes('deep@example.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard handles arrays in tool state', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'tool',
          state: {
            input: {
              emails: ['user1@example.com', 'user2@example.com']
            }
          }
        }]
      }]
    };
    
    await transform({}, output);
    
    assert.ok(!output.messages[0].parts[0].state.input.emails[0].includes('user1@example.com'));
    assert.ok(!output.messages[0].parts[0].state.input.emails[1].includes('user2@example.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard handles tool state with null values', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'tool',
          state: {
            input: {
              email: 'user@example.com',
              other: null,
              another: undefined
            }
          }
        }]
      }]
    };
    
    // Should not throw
    await transform({}, output);
    
    assert.ok(!output.messages[0].parts[0].state.input.email.includes('user@example.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard handles tool state without input', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'tool',
          state: {
            // No input property
            status: 'completed',
            output: 'done'
          }
        }]
      }]
    };
    
    // Should not throw
    await transform({}, output);
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard handles tool state without status', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'tool',
          state: {
            input: { email: 'user@example.com' }
            // No status property
          }
        }]
      }]
    };
    
    // Should not throw and should mask input
    await transform({}, output);
    assert.ok(!output.messages[0].parts[0].state.input.email.includes('user@example.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard handles non-object state', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'tool',
          state: 'invalid-state'  // Not an object
        }]
      }]
    };
    
    // Should not throw
    await transform({}, output);
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard handles part without type', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          // No type property
          text: 'Email: user@example.com'
        }]
      }]
    };
    
    // Should not throw
    await transform({}, output);
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard experimental.stream.end cleans up unmasker', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    const chunk = plugin['experimental.text.chunk'];
    const streamEnd = plugin['experimental.stream.end'];
    
    // First mask
    const output = {
      messages: [{
        info: { sessionID: 'cleanup-test' },
        parts: [{
          type: 'text',
          text: 'Email: user@example.com'
        }]
      }]
    };
    await transform({}, output);
    
    // Use streaming
    const chunkOutput = { text: output.messages[0].parts[0].text };
    await chunk({ sessionID: 'cleanup-test' }, chunkOutput);
    
    // Clean up
    await streamEnd({ sessionID: 'cleanup-test' });
    
    // Should be able to create new streaming session with same ID
    const chunkOutput2 = { text: 'test' };
    await chunk({ sessionID: 'cleanup-test' }, chunkOutput2);
    
    // Should work without error
    assert.ok(typeof chunkOutput2.text === 'string');
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard experimental.stream.end handles missing sessionID', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const streamEnd = plugin['experimental.stream.end'];
    
    // Should not throw with missing sessionID
    await streamEnd({});
    await streamEnd(null);
    await streamEnd(undefined);
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard handles partial endpoint match in exclusion', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: { builtin: ['email'] },
    exclude_llm_endpoints: ['localhost']  // Partial match
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const originalText = 'Contact admin@company.com';
    const output = {
      messages: [{
        info: { sessionID: 'test-session', endpoint: 'http://localhost:3000/api' },
        parts: [{
          type: 'text',
          text: originalText
        }]
      }]
    };
    
    await transform({}, output);
    
    // Should be excluded (localhost is contained in endpoint)
    assert.strictEqual(output.messages[0].parts[0].text, originalText);
  } finally {
    await cleanup(tempDir);
  }
});

test('OpenCodeGuard handles custom maskers', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { 
    enabled: true, 
    global_salt: 'test-salt-1234567890abcdef',
    patterns: {
      regex: [
        { pattern: 'MYAPP_[A-Z0-9]{10}', category: 'MYAPP_TOKEN', mask_as: 'my_custom_masker' }
      ]
    },
    custom_maskers: {
      my_custom_masker: {
        type: 'prefixed_token',
        prefix: 'MYAPP_',
        suffix_length: 10,
        suffix_chars: 'alphanumeric'
      }
    }
  });
  
  try {
    const plugin = await OpenCodeGuard({ directory: tempDir });
    const transform = plugin['experimental.chat.messages.transform'];
    
    const output = {
      messages: [{
        info: { sessionID: 'test-session' },
        parts: [{
          type: 'text',
          text: 'Token: MYAPP_ABC123XYZ0'
        }]
      }]
    };
    
    await transform({}, output);
    
    assert.ok(!output.messages[0].parts[0].text.includes('MYAPP_ABC123XYZ0'));
    assert.ok(output.messages[0].parts[0].text.startsWith('Token: MYAPP_'));
  } finally {
    await cleanup(tempDir);
  }
});
