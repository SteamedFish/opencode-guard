import { test } from 'node:test';
import assert from 'node:assert';
import { setupV2, createV2Handlers } from '../src/v2.js';
import { createGuardCore } from '../src/guard-core.js';
import { redactText } from '../src/engine.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFile, mkdir, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_CONFIG = {
  enabled: true,
  global_salt: 'test-salt-1234567890abcdef',
  patterns: { builtin: ['email'] },
};

async function createTempDir() {
  const dir = join(tmpdir(), `opencode-guard-v2-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function createTempConfig(dir, config) {
  await writeFile(join(dir, 'opencode-guard.config.json'), JSON.stringify(config));
}

async function cleanup(dir) {
  try {
    await unlink(join(dir, 'opencode-guard.config.json'));
    await rmdir(dir);
  } catch {}
}

function makeCtx(tempDir, { providerGet, mcpList } = {}) {
  const hooks = { session: {}, tool: {} };
  const ctx = {
    location: { directory: tempDir },
    provider: {
      get: providerGet ?? (async () => ({ data: { settings: { baseURL: 'https://api.example.com/v1' } } })),
    },
    mcp: { list: mcpList ?? (async () => ({ data: [{ name: 'web' }] })) },
    session: { hook: async (n, cb) => { hooks.session[n] = cb; } },
    tool: { hook: async (n, cb) => { hooks.tool[n] = cb; } },
  };
  return { ctx, hooks };
}

// Produce the masked value the plugin will compute for `text` (deterministic per salt)
async function maskedFor(tempDir, config, sessionID, text) {
  const core = await createGuardCore(tempDir);
  const session = core.getSession(sessionID);
  const result = await redactText(text, core.patterns, session, null);
  return result.text;
}

test('v2 context hook masks email in a text part', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, BASE_CONFIG);
  try {
    const { ctx, hooks } = makeCtx(tempDir);
    await setupV2(ctx);

    const event = {
      sessionID: 'sess-1',
      model: { providerID: 'openai', id: 'gpt-4' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Contact me at user@example.com please' }] }],
    };
    await hooks.session.context(event);

    assert.ok(!event.messages[0].content[0].text.includes('user@example.com'));
    assert.ok(event.messages[0].content[0].text.includes('@'));
  } finally {
    await cleanup(tempDir);
  }
});

test('v2 context hook masks tool-call input', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, BASE_CONFIG);
  try {
    const { ctx, hooks } = makeCtx(tempDir);
    await setupV2(ctx);

    const event = {
      sessionID: 'sess-1',
      model: { providerID: 'openai', id: 'gpt-4' },
      messages: [{
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'call-1', name: 'send_email', input: { to: 'user@example.com' } }],
      }],
    };
    await hooks.session.context(event);

    assert.ok(!event.messages[0].content[0].input.to.includes('user@example.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('v2 context hook skips masking when endpoint is excluded', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { ...BASE_CONFIG, exclude_llm_endpoints: ['api.example.com'] });
  try {
    const { ctx, hooks } = makeCtx(tempDir);
    await setupV2(ctx);

    const event = {
      sessionID: 'sess-1',
      model: { providerID: 'openai', id: 'gpt-4' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Contact me at user@example.com' }] }],
    };
    await hooks.session.context(event);

    assert.ok(event.messages[0].content[0].text.includes('user@example.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('v2 toolBefore restores originals for built-in tool', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, BASE_CONFIG);
  try {
    const { ctx, hooks } = makeCtx(tempDir);
    await setupV2(ctx);

    // Create the mapping in the plugin's session by masking through the hook
    await hooks.session.context({
      sessionID: 'sess-1',
      model: { providerID: 'openai', id: 'gpt-4' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'user@example.com' }] }],
    });
    const masked = await maskedFor(tempDir, BASE_CONFIG, 'sess-1', 'user@example.com');
    assert.ok(!masked.includes('user@example.com'));

    const event = { tool: 'read', sessionID: 'sess-1', input: { path: `/home/${masked}/file.txt` } };
    await hooks.tool['execute.before'](event);

    assert.ok(event.input.path.includes('user@example.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('v2 toolBefore masks args for external MCP tool', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, BASE_CONFIG);
  try {
    const { ctx, hooks } = makeCtx(tempDir);
    await setupV2(ctx);

    const event = { tool: 'web_search', sessionID: 'sess-1', input: { query: 'email user@example.com' } };
    await hooks.tool['execute.before'](event);

    assert.ok(!event.input.query.includes('user@example.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('v2 toolBefore restores args for excluded MCP server', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { ...BASE_CONFIG, exclude_mcp_servers: ['web'] });
  try {
    const config = { ...BASE_CONFIG, exclude_mcp_servers: ['web'] };
    const { ctx, hooks } = makeCtx(tempDir);
    await setupV2(ctx);

    await hooks.session.context({
      sessionID: 'sess-1',
      model: { providerID: 'openai', id: 'gpt-4' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'user@example.com' }] }],
    });
    const masked = await maskedFor(tempDir, config, 'sess-1', 'user@example.com');

    const event = { tool: 'web_search', sessionID: 'sess-1', input: { query: `find ${masked}` } };
    await hooks.tool['execute.before'](event);

    assert.ok(event.input.query.includes('user@example.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('v2 toolAfter masks result output', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, BASE_CONFIG);
  try {
    const { ctx, hooks } = makeCtx(tempDir);
    await setupV2(ctx);

    const event = {
      tool: 'read',
      sessionID: 'sess-1',
      status: 'completed',
      result: { output: 'found user@example.com in file' },
    };
    await hooks.tool['execute.after'](event);

    assert.ok(!event.result.output.includes('user@example.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('v2 http.response restores masked email in SSE stream', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, BASE_CONFIG);
  try {
    const { ctx, hooks } = makeCtx(tempDir);
    await setupV2(ctx);

    // Establish the mapping in the plugin's session first
    await hooks.session.context({
      sessionID: 'sess-1',
      model: { providerID: 'openai', id: 'gpt-4' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'user@example.com' }] }],
    });
    const masked = await maskedFor(tempDir, BASE_CONFIG, 'sess-1', 'user@example.com');
    const payload = `data: {"delta":"reply to ${masked}"}\n\n`;

    const response = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(payload));
          c.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } }
    );

    const event = { sessionID: 'sess-1', response };
    await hooks.session['http.response'](event);

    assert.notStrictEqual(event.response, response);
    const body = await new Response(event.response.body).text();
    assert.ok(body.includes('user@example.com'), `expected original in body, got: ${body}`);
  } finally {
    await cleanup(tempDir);
  }
});

test('v2 http.response does not restore JSON-unsafe originals but restores JSON-safe ones', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, BASE_CONFIG);
  try {
    const core = await createGuardCore(tempDir);
    const handlers = createV2Handlers(core, {
      providerGet: async () => ({ data: { settings: { baseURL: 'https://api.example.com/v1' } } }),
      mcpList: async () => ({ data: [{ name: 'web' }] }),
    });

    const session = core.getSession('sess-1');
    const safeMasked = await redactText('user@example.com', core.patterns, session, null);
    // Inject a JSON-unsafe original the way a credential masker would
    session.maskedToOriginal.set('sk-Ab12Cd34Ef', 'pass"word\n123');
    session.timestamps.set('sk-Ab12Cd34Ef', Date.now());

    const payload = `data: {"a":"${safeMasked.text}","b":"sk-Ab12Cd34Ef"}\n\n`;
    const response = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(payload));
          c.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } }
    );

    const event = { sessionID: 'sess-1', response };
    await handlers.httpResponse(event);

    const body = await new Response(event.response.body).text();
    assert.ok(body.includes('user@example.com'), 'JSON-safe original restored');
    assert.ok(body.includes('sk-Ab12Cd34Ef'), 'JSON-unsafe original stays masked');
    assert.ok(!body.includes('pass"word'), 'unsafe original not leaked');
  } finally {
    await cleanup(tempDir);
  }
});

test('v2 ws receive restores within one frame', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, BASE_CONFIG);
  try {
    const { ctx, hooks } = makeCtx(tempDir);
    await setupV2(ctx);

    await hooks.session.context({
      sessionID: 'sess-1',
      model: { providerID: 'openai', id: 'gpt-4' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'user@example.com' }] }],
    });
    const masked = await maskedFor(tempDir, BASE_CONFIG, 'sess-1', 'user@example.com');
    const event = { sessionID: 'sess-1', frame: `{"delta":"${masked}"}` };
    await hooks.session['experimental.ws.receive'](event);

    assert.ok(event.frame.includes('user@example.com'));
  } finally {
    await cleanup(tempDir);
  }
});

test('v2 setupV2 registers no hooks when config disabled', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { enabled: false, global_salt: 'x' });
  try {
    const { ctx, hooks } = makeCtx(tempDir);
    await setupV2(ctx);
    assert.strictEqual(Object.keys(hooks.session).length, 0);
    assert.strictEqual(Object.keys(hooks.tool).length, 0);
  } finally {
    await cleanup(tempDir);
  }
});

test('v2 setupV2 registers no hooks when global_salt missing', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { enabled: true });
  try {
    const { ctx, hooks } = makeCtx(tempDir);
    await setupV2(ctx);
    assert.strictEqual(Object.keys(hooks.session).length, 0);
    assert.strictEqual(Object.keys(hooks.tool).length, 0);
  } finally {
    await cleanup(tempDir);
  }
});

test('v2 default export exposes id, setup and server', async () => {
  const mod = await import('../src/index.js');
  assert.strictEqual(mod.default.id, 'opencode-guard');
  assert.strictEqual(typeof mod.default.setup, 'function');
  assert.strictEqual(typeof mod.default.server, 'function');
});

test('v2 setupV2 does not throw when experimental ws hooks are unavailable (debug on)', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { ...BASE_CONFIG, debug: true });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const ctx = {
      location: { directory: tempDir },
      provider: { get: async () => ({ data: { settings: {} } }) },
      mcp: { list: async () => ({ data: [] }) },
      session: {
        hook: async (name) => {
          if (name.startsWith('experimental.ws.')) throw new Error('unknown hook');
        },
      },
      tool: { hook: async () => {} },
    };
    await setupV2(ctx); // must not throw (H6)
    assert.ok(
      warnings.some((w) => w.includes('ws hooks unavailable')),
      'should warn via core.logger instead of crashing'
    );
  } finally {
    console.warn = originalWarn;
    await cleanup(tempDir);
  }
});

test('v2 maskRequest masks with ephemeral session when sessionID is missing', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, BASE_CONFIG);
  try {
    const core = await createGuardCore(tempDir);
    const handlers = createV2Handlers(core, {
      providerGet: async () => ({ data: { settings: { baseURL: 'https://api.example.com/v1' } } }),
      mcpList: async () => ({ data: [] }),
    });

    const event = {
      model: { providerID: 'openai', id: 'gpt-4' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'email ccbi@example.com please' }] }],
    };
    await handlers.maskRequest(event);

    assert.ok(
      !event.messages[0].content[0].text.includes('ccbi@example.com'),
      'request without sessionID must still be masked (fail closed)'
    );
  } finally {
    await cleanup(tempDir);
  }
});

test('v2 toolBefore does NOT exclude bare default tool names on external servers', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, BASE_CONFIG); // default exclude_mcp_tools includes bare run_job
  try {
    const { ctx, hooks } = makeCtx(tempDir, { mcpList: async () => ({ data: [{ name: 'external' }] }) });
    await setupV2(ctx);

    // Establish mapping in the plugin session
    await hooks.session.context({
      sessionID: 'sess-1',
      model: { providerID: 'openai', id: 'gpt-4' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'ccbi@example.com' }] }],
    });
    const masked = await maskedFor(tempDir, BASE_CONFIG, 'sess-1', 'ccbi@example.com');

    const event = { tool: 'external_run_job', sessionID: 'sess-1', input: { arg: masked } };
    await hooks.tool['execute.before'](event);

    assert.ok(
      !String(event.input.arg).includes('ccbi@example.com'),
      'external server must not get originals via bare default tool name (H9)'
    );
  } finally {
    await cleanup(tempDir);
  }
});

test('v2 toolBefore restores for excluded server tool and qualified entries', async () => {
  const tempDir = await createTempDir();
  const config = {
    ...BASE_CONFIG,
    exclude_mcp_servers: ['trusted'],
    exclude_mcp_tools: ['external/run_job'],
  };
  await createTempConfig(tempDir, config);
  try {
    const { ctx, hooks } = makeCtx(tempDir, { mcpList: async () => ({ data: [{ name: 'external' }] }) });
    await setupV2(ctx);

    await hooks.session.context({
      sessionID: 'sess-1',
      model: { providerID: 'openai', id: 'gpt-4' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'ccbi@example.com' }] }],
    });
    const masked = await maskedFor(tempDir, config, 'sess-1', 'ccbi@example.com');

    // Excluded server: bare run_job restores
    const ev1 = { tool: 'trusted_run_job', sessionID: 'sess-1', input: { arg: masked } };
    await hooks.tool['execute.before'](ev1);
    assert.strictEqual(ev1.input.arg, 'ccbi@example.com', 'excluded server tool should be restored');

    // Qualified "server/tool" entry restores on that server
    const ev2 = { tool: 'external_run_job', sessionID: 'sess-1', input: { arg: masked } };
    await hooks.tool['execute.before'](ev2);
    assert.strictEqual(ev2.input.arg, 'ccbi@example.com', 'qualified server/tool entry should restore');

    // Same tool name on a different server is NOT excluded
    const ev3 = { tool: 'other_run_job', sessionID: 'sess-1', input: { arg: masked } };
    await hooks.tool['execute.before'](ev3);
    // 'other' is not a connected MCP server and not excluded -> treated as built-in -> restored
    // so use a connected external server instead for the negative case
    const { ctx: ctx2, hooks: hooks2 } = makeCtx(tempDir, { mcpList: async () => ({ data: [{ name: 'other' }] }) });
    await setupV2(ctx2);
    await hooks2.session.context({
      sessionID: 'sess-1',
      model: { providerID: 'openai', id: 'gpt-4' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'ccbi@example.com' }] }],
    });
    await hooks2.tool['execute.before'](ev3);
    assert.ok(
      !String(ev3.input.arg).includes('ccbi@example.com'),
      'qualified entry must not leak to other servers'
    );
  } finally {
    await cleanup(tempDir);
  }
});

test('v2 resolveBaseUrl does not cache failures', async () => {
  const tempDir = await createTempDir();
  await createTempConfig(tempDir, { ...BASE_CONFIG, exclude_llm_endpoints: ['api.example.com'] });
  try {
    let calls = 0;
    const core = await createGuardCore(tempDir);
    const handlers = createV2Handlers(core, {
      providerGet: async () => {
        calls++;
        if (calls === 1) throw new Error('transient');
        return { data: { settings: { baseURL: 'https://api.example.com/v1' } } };
      },
      mcpList: async () => ({ data: [] }),
    });

    const mkEvent = () => ({
      sessionID: 'sess-1',
      model: { providerID: 'openai', id: 'gpt-4' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'ccbi@example.com' }] }],
    });

    const ev1 = mkEvent();
    await handlers.maskRequest(ev1);
    assert.ok(
      !ev1.messages[0].content[0].text.includes('ccbi@example.com'),
      'failed baseURL lookup must not disable masking'
    );

    const ev2 = mkEvent();
    await handlers.maskRequest(ev2);
    assert.strictEqual(calls, 2, 'failure must not be cached; provider queried again');
    assert.ok(
      ev2.messages[0].content[0].text.includes('ccbi@example.com'),
      'excluded endpoint applies once baseURL resolves'
    );
  } finally {
    await cleanup(tempDir);
  }
});
