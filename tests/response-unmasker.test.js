import { test } from 'node:test';
import assert from 'node:assert';
import { isJsonSafe, createJsonSafeSessionView, wrapResponse } from '../src/response-unmasker.js';
import { MaskSession } from '../src/session.js';
import { redactText } from '../src/engine.js';

function makeSession() {
  return new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
}

function addMapping(session, masked, original) {
  session.maskedToOriginal.set(masked, original);
  session.timestamps.set(masked, Date.now());
}

test('isJsonSafe returns true for plain text', () => {
  assert.strictEqual(isJsonSafe('ccbi@example.com'), true);
  assert.strictEqual(isJsonSafe('hello world'), true);
});

test('isJsonSafe returns false for quotes, backslashes, and control chars', () => {
  assert.strictEqual(isJsonSafe('pass"word'), false);
  assert.strictEqual(isJsonSafe('pass\\word'), false);
  assert.strictEqual(isJsonSafe('pass\nword'), false);
  assert.strictEqual(isJsonSafe('pass\tword'), false);
  assert.strictEqual(isJsonSafe('pass\x1fword'), false);
});

test('createJsonSafeSessionView hides non-JSON-safe originals', () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');
  addMapping(session, 'sk-Ab12Cd34Ef', 'pass"word\n123');

  const view = createJsonSafeSessionView(session);
  assert.strictEqual(view.lookupOriginal('u8ol4n@example.com'), 'ccbi@example.com');
  assert.strictEqual(view.lookupOriginal('sk-Ab12Cd34Ef'), undefined);
  assert.strictEqual(view.lookupOriginal('unknown'), undefined);
});

function sseResponse(body) {
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(body));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } }
  );
}

/** Serialize one chat.completion.chunk-like object into a complete SSE data event. */
function chunkEvent(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/** Extract the parsed JSON payloads of all non-[DONE] data events in `text`. */
function parseDataEvents(text) {
  const out = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''));
    if (dataLines.length === 0) continue;
    const payload = dataLines.join('\n');
    if (payload.trim() === '[DONE]') continue;
    out.push(JSON.parse(payload));
  }
  return out;
}

test('wrapResponse restores JSON-safe originals in SSE stream', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');
  addMapping(session, 'sk-Ab12Cd34Ef', 'pass"word\n123');

  const response = sseResponse(
    chunkEvent({
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'm',
      choices: [
        { index: 0, delta: { content: 'reply to u8ol4n@example.com key sk-Ab12Cd34Ef' }, finish_reason: null },
      ],
    })
  );
  const wrapped = wrapResponse(response, session);
  assert.ok(wrapped instanceof Response);
  assert.strictEqual(wrapped.status, response.status);
  assert.strictEqual(wrapped.headers.get('content-type'), 'text/event-stream');

  const text = await new Response(wrapped.body).text();
  assert.ok(text.includes('ccbi@example.com'), 'JSON-safe original restored');
  assert.ok(!text.includes('u8ol4n@example.com'), 'masked token replaced');
  assert.ok(text.includes('sk-Ab12Cd34Ef'), 'JSON-unsafe original stays masked');
  assert.ok(!text.includes('pass"word'), 'unsafe original not leaked');
});

test('wrapResponse handles multibyte characters split across chunks', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');

  const body = chunkEvent({ choices: [{ index: 0, delta: { content: 'hélö u8ol4n@example.com' } }] });
  const bytes = new TextEncoder().encode(body);
  const cut = bytes.indexOf(0xc3) + 1; // split mid-codepoint inside 'é'
  const response = new Response(
    new ReadableStream({
      async start(c) {
        c.enqueue(bytes.slice(0, cut));
        c.enqueue(bytes.slice(cut));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } }
  );

  const wrapped = wrapResponse(response, session);
  const text = await new Response(wrapped.body).text();
  assert.ok(text.includes('ccbi@example.com'));
  assert.ok(text.includes('hélö'));
});

test('wrapResponse returns null for missing body', () => {
  const session = makeSession();
  const response = new Response(null, { headers: { 'content-type': 'text/event-stream' } });
  assert.strictEqual(wrapResponse(response, session), null);
});

test('wrapResponse returns null for non-textual content types', () => {
  const session = makeSession();
  const response = new Response('binary', { headers: { 'content-type': 'application/octet-stream' } });
  assert.strictEqual(wrapResponse(response, session), null);
});

test('wrapResponse wraps JSON content type', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');

  const response = new Response('{"email":"u8ol4n@example.com"}', {
    headers: { 'content-type': 'application/json' },
  });
  const wrapped = wrapResponse(response, session);
  assert.ok(wrapped);
  const text = await new Response(wrapped.body).text();
  assert.strictEqual(text, '{"email":"ccbi@example.com"}');
});

test('createJsonSafeSessionView exposes only JSON-safe masked keys', () => {
  const session = makeSession();
  addMapping(session, 'masked-safe-token', 'plain-original');
  addMapping(session, 'masked-unsafe-token', 'pass"word\n123');

  const view = createJsonSafeSessionView(session);
  assert.deepStrictEqual(view.getMaskedKeys(), ['masked-safe-token']);
  assert.strictEqual(typeof view.getMaskedKeyFingerprint(), 'string');
});

test('wrapResponse removes content-length and content-encoding headers', async () => {
  const session = makeSession();
  addMapping(session, 'masked-token-123', 'restored');

  const response = new Response('{"key":"masked-token-123"}', {
    headers: {
      'content-type': 'application/json',
      'content-length': '26',
      'content-encoding': 'gzip',
    },
  });

  const wrapped = wrapResponse(response, session);
  assert.ok(wrapped);
  assert.strictEqual(wrapped.headers.get('content-length'), null);
  assert.strictEqual(wrapped.headers.get('content-encoding'), null);
  assert.strictEqual(wrapped.headers.get('content-type'), 'application/json');

  const text = await new Response(wrapped.body).text();
  assert.strictEqual(text, '{"key":"restored"}');
});

test('wrapResponse returns original response when body is already used', async () => {
  const session = makeSession();
  const response = new Response('{"a":1}', { headers: { 'content-type': 'application/json' } });
  await response.text(); // consumes the body

  assert.strictEqual(wrapResponse(response, session), response);
});

test('wrapResponse returns original response when body is locked', () => {
  const session = makeSession();
  const response = new Response('{"a":1}', { headers: { 'content-type': 'application/json' } });
  const reader = response.body.getReader();
  try {
    assert.strictEqual(wrapResponse(response, session), response);
  } finally {
    reader.releaseLock();
  }
});

test('wrapResponse restores masked UUID and MAC inside JSON strings', async () => {
  const session = makeSession();
  const maskedUuid = '9f8e7d6c-1111-2222-3333-444455556666';
  const originalUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const maskedMac = 'f0:de:bc:75:85:11';
  const originalMac = '00:1a:2b:cb:33:88';
  addMapping(session, maskedUuid, originalUuid);
  addMapping(session, maskedMac, originalMac);

  const response = sseResponse(
    chunkEvent({ choices: [{ index: 0, delta: { content: `id ${maskedUuid} mac ${maskedMac}` } }] })
  );
  const wrapped = wrapResponse(response, session);
  const text = await new Response(wrapped.body).text();

  assert.ok(text.includes(originalUuid), 'UUID restored');
  assert.ok(text.includes(originalMac), 'MAC restored');
  assert.ok(!text.includes(maskedUuid), 'masked UUID replaced');
  assert.ok(!text.includes(maskedMac), 'masked MAC replaced');
});

test('wrapResponse restores token split across chunks', async () => {
  const session = makeSession();
  addMapping(session, 'ghp_abc123def4567890', 'mysecrettoken');

  const body = chunkEvent({ choices: [{ index: 0, delta: { content: 'token ghp_abc123def4567890 ok' } }] });
  const bytes = new TextEncoder().encode(body);
  const cut = bytes.indexOf(49); // split inside the masked token (first '1')
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(bytes.slice(0, cut));
        c.enqueue(bytes.slice(cut));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } }
  );

  const wrapped = wrapResponse(response, session);
  const text = await new Response(wrapped.body).text();
  assert.ok(text.includes('mysecrettoken'), 'split token restored');
  assert.ok(!text.includes('ghp_abc123'), 'masked token replaced');
});

// ---------------------------------------------------------------------------
// SSE-aware content-level restore
// ---------------------------------------------------------------------------

test('wrapResponse restores masked email split across two SSE events', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');

  const half1 = 'u8ol4n@ex';
  const ev1 = chunkEvent({ id: 'c', created: 1, model: 'm', choices: [{ index: 0, delta: { content: `echo: ${half1}` } }] });
  const ev2 = chunkEvent({ id: 'c', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'ample.comabcdef' } }] });
  const done = 'data: [DONE]\n\n';

  const wrapped = wrapResponse(sseResponse(ev1 + ev2 + done), session);
  const text = await new Response(wrapped.body).text();

  assert.ok(text.includes('ccbi@example.com'), 'split masked email restored');
  assert.ok(text.includes('ccbi@example.comabcdef'), 'trailing suffix after the split key emitted intact');
  assert.ok(!text.includes(half1), 'no residual masked fragment in final output');
  assert.ok(text.endsWith(done), '[DONE] passes through byte-identical');

  // The held-back half was truncated from event 1 (hold-back), surfaced in event 2.
  const events = parseDataEvents(text);
  assert.strictEqual(events[0].choices[0].delta.content, 'echo: ');
  assert.strictEqual(events[1].choices[0].delta.content, 'ccbi@example.comabcdef');
});

test('wrapResponse restores single-event content and passes unmodified events through byte-identical', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');

  const hit = chunkEvent({ id: 'c', choices: [{ index: 0, delta: { content: 'mail u8ol4n@example.com' } }] });
  const wrapped = wrapResponse(sseResponse(hit + 'data: [DONE]\n\n'), session);
  const text = await new Response(wrapped.body).text();
  assert.ok(text.includes('mail ccbi@example.com'), 'single-event content restore');
  assert.ok(!text.includes('u8ol4n@example.com'));
});

test('wrapResponse passes a fully unmodified SSE stream through byte-identical', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');

  const body =
    chunkEvent({ id: 'c', choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] }) +
    chunkEvent({ id: 'c', choices: [{ index: 0, delta: { content: 'The answer is 42' } }] }) +
    chunkEvent({ id: 'c', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) +
    'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4}}\n\n' +
    'data: [DONE]\n\n';

  const wrapped = wrapResponse(sseResponse(body), session);
  const text = await new Response(wrapped.body).text();
  assert.strictEqual(text, body, 'raw bytes equal input when nothing is restored or held back');
});

test('wrapResponse restores reasoning_content', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');

  const ev = chunkEvent({
    choices: [{ index: 0, delta: { reasoning_content: 'the user mail is u8ol4n@example.com, hmm' } }],
  });
  const wrapped = wrapResponse(sseResponse(ev + 'data: [DONE]\n\n'), session);
  const text = await new Response(wrapped.body).text();

  assert.ok(text.includes('the user mail is ccbi@example.com, hmm'), 'reasoning_content restored');
  assert.ok(!text.includes('u8ol4n@example.com'), 'masked value replaced');
});

test('wrapResponse restores tool_calls arguments split across fragments', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');

  const ev1 = chunkEvent({
    id: 'c',
    created: 1,
    model: 'm',
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, id: 'call_1', type: 'function', function: { name: 'send_mail', arguments: '{"email": "u8ol4n@ex' } },
          ],
        },
      },
    ],
  });
  const ev2 = chunkEvent({
    id: 'c',
    created: 1,
    model: 'm',
    choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'ample.com"}' } }] } }],
  });

  const wrapped = wrapResponse(sseResponse(ev1 + ev2 + 'data: [DONE]\n\n'), session);
  const text = await new Response(wrapped.body).text();

  const fragments = [];
  for (const obj of parseDataEvents(text)) {
    for (const choice of obj.choices || []) {
      for (const tc of choice.delta?.tool_calls || []) {
        if (typeof tc.function?.arguments === 'string') fragments.push(tc.function.arguments);
      }
    }
  }
  assert.deepStrictEqual(fragments.length, 2, 'both fragments emitted, none dropped');
  const joined = fragments.join('');
  assert.deepStrictEqual(
    JSON.parse(joined),
    { email: 'ccbi@example.com' },
    'emitted fragments concatenate to valid restored JSON'
  );
  assert.ok(!text.includes('u8ol4n@example.com'), 'no residual masked value');
});

test('wrapResponse handles CRLF line endings', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');

  const plain = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'plain text' } }] })}`;
  const hit = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'mail u8ol4n@example.com' } }] })}`;
  const body = `${plain}\r\n\r\n${hit}\r\n\r\ndata: [DONE]\r\n\r\n`;

  const wrapped = wrapResponse(sseResponse(body), session);
  const text = await new Response(wrapped.body).text();

  assert.ok(text.includes(`${plain}\r\n\r\n`), 'unmodified CRLF event passes through byte-identical');
  assert.ok(text.includes('mail ccbi@example.com'), 'CRLF event restored');
  assert.ok(text.endsWith('data: [DONE]\r\n\r\n'), '[DONE] byte-identical with CRLF');
});

test('wrapResponse passes SSE keep-alive comments through immediately', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let openGate;
  const gate = new Promise((resolve) => {
    openGate = resolve;
  });
  const response = new Response(
    new ReadableStream({
      async start(c) {
        c.enqueue(enc.encode(': keep-alive\n\n'));
        await gate; // hold the rest of the stream until the test allows it
        c.enqueue(enc.encode(chunkEvent({ choices: [{ index: 0, delta: { content: 'hi u8ol4n@example.com' } }] })));
        c.enqueue(enc.encode('data: [DONE]\n\n'));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } }
  );

  const wrapped = wrapResponse(response, session);
  const reader = wrapped.body.getReader();

  // The comment must arrive BEFORE the gate opens — never buffered.
  const first = await reader.read();
  assert.ok(dec.decode(first.value).includes('keep-alive'), 'comment emitted before stream end');

  openGate();
  let rest = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += dec.decode(value);
  }
  assert.ok(rest.includes('hi ccbi@example.com'), 'post-gate event restored');
  assert.ok(rest.endsWith('data: [DONE]\n\n'), '[DONE] byte-identical');
});

test('wrapResponse merges held-back remainder into the finish chunk when [DONE] is missing', async () => {
  const session = makeSession();
  addMapping(session, 'ghp_abc123def456', 'tok-secret-value');

  const ev1 = chunkEvent({ id: 'c', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'see ghp_abc123' } }] });
  const finish = chunkEvent({ id: 'c', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });

  // Stream ends without [DONE].
  const wrapped = wrapResponse(sseResponse(ev1 + finish), session);
  const text = await new Response(wrapped.body).text();

  assert.ok(text.includes('ghp_abc123'), 'held-back bytes surface, no byte loss');
  const events = parseDataEvents(text);
  assert.strictEqual(events.length, 2, 'remainder merged into the finish chunk, no synthetic chunk needed');
  assert.strictEqual(events[1].choices[0].finish_reason, 'stop');
  assert.strictEqual(events[1].choices[0].delta.content, 'ghp_abc123', 'remainder merged verbatim into finish chunk delta');
});

test('wrapResponse flushes never-completing held-back remainder into a synthetic chunk before [DONE]', async () => {
  const session = makeSession();
  addMapping(session, 'ghp_abc123def456', 'tok-secret-value');

  const ev1 = chunkEvent({ id: 'chatcmpl-9', created: 7, model: 'm', choices: [{ index: 0, delta: { content: 'see ghp_abc123' } }] });
  const done = 'data: [DONE]\n\n';

  const wrapped = wrapResponse(sseResponse(ev1 + done), session);
  const text = await new Response(wrapped.body).text();

  assert.ok(text.endsWith(done), '[DONE] byte-identical and last');
  assert.ok(text.includes('ghp_abc123'), 'held-back remainder flushed verbatim, no byte loss');

  const blocks = text.split('\n\n').filter(Boolean);
  assert.strictEqual(blocks.length, 3, 're-serialized event, synthetic chunk, [DONE]');
  const synth = JSON.parse(blocks[1].slice('data: '.length));
  assert.strictEqual(synth.id, 'chatcmpl-9', 'synthetic chunk cloned from last seen chunk');
  assert.strictEqual(synth.created, 7);
  assert.strictEqual(synth.model, 'm');
  assert.strictEqual(synth.choices[0].delta.content, 'ghp_abc123', 'remainder emitted verbatim (never completed)');
  assert.strictEqual(synth.choices[0].finish_reason, null);
});

test('wrapResponse passes malformed JSON and non-chunk events through unchanged', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');

  const bad = 'data: {not json}\n\n';
  const err = 'data: {"error":{"message":"boom"}}\n\n';
  const nonChunk = 'data: {"delta":{"content":"u8ol4n@example.com"}}\n\n';
  const done = 'data: [DONE]\n\n';

  const wrapped = wrapResponse(sseResponse(bad + err + nonChunk + done), session);
  const text = await new Response(wrapped.body).text();
  assert.strictEqual(text, bad + err + nonChunk + done, 'unparseable / non-chunk events pass through verbatim');
});

// ---------------------------------------------------------------------------
// SSE-aware content-level restore - Anthropic Messages API stream shapes
// ---------------------------------------------------------------------------

/** Anthropic content_block_delta carrying a text_delta. */
function anthText(index, text) {
  return `data: ${JSON.stringify({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } })}\n\n`;
}

/** Anthropic content_block_delta carrying an input_json_delta (tool args). */
function anthJson(index, partialJson) {
  return `data: ${JSON.stringify({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: partialJson } })}\n\n`;
}

/** Anthropic content_block_delta carrying a thinking_delta. */
function anthThinking(index, thinking) {
  return `data: ${JSON.stringify({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } })}\n\n`;
}

/** All content_block_delta payloads in `text`, flattened per block index. */
function anthDeltaTexts(text, prop) {
  const out = new Map();
  for (const obj of parseDataEvents(text)) {
    if (obj.type !== 'content_block_delta' || !obj.delta) continue;
    if (typeof obj.delta[prop] !== 'string') continue;
    out.set(obj.index, (out.get(obj.index) ?? '') + obj.delta[prop]);
  }
  return out;
}

test('wrapResponse restores Anthropic text_delta in a single event', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');

  const ev = anthText(0, 'reply to u8ol4n@example.com');
  const wrapped = wrapResponse(sseResponse(ev), session);
  const text = await new Response(wrapped.body).text();

  assert.ok(text.includes('reply to ccbi@example.com'), 'text_delta restored');
  assert.ok(!text.includes('u8ol4n@example.com'), 'masked value replaced');
});

test('wrapResponse restores Anthropic text_delta split across events', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');

  const ev1 = anthText(0, 'echo: u8ol4n@ex');
  const ev2 = anthText(0, 'ample.com rest');
  const wrapped = wrapResponse(sseResponse(ev1 + ev2 + 'data: [DONE]\n\n'), session);
  const text = await new Response(wrapped.body).text();

  const perIndex = anthDeltaTexts(text, 'text');
  assert.strictEqual(perIndex.get(0), 'echo: ccbi@example.com rest', 'split value restored across events');
  assert.ok(!text.includes('u8ol4n@example.com'), 'no residual masked value');
  const events = parseDataEvents(text);
  assert.strictEqual(events[0].delta.text, 'echo: ', 'first event truncated by hold-back');
  assert.strictEqual(events[0].delta.type, 'text_delta', 'delta type preserved');
});

test('wrapResponse restores Anthropic input_json_delta arguments split across fragments', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');

  const ev1 = anthJson(1, '{"email":"u8ol4n@ex');
  const ev2 = anthJson(1, 'ample.com"}');
  const stop = `data: ${JSON.stringify({ type: 'content_block_stop', index: 1 })}\n\n`;
  const wrapped = wrapResponse(sseResponse(ev1 + ev2 + stop), session);
  const text = await new Response(wrapped.body).text();

  const joined = [...anthDeltaTexts(text, 'partial_json').values()].join('');
  assert.deepStrictEqual(JSON.parse(joined), { email: 'ccbi@example.com' }, 'fragments concatenate to restored JSON');
  assert.ok(!text.includes('u8ol4n@example.com'), 'no residual masked value');
});

test('wrapResponse keeps a hold-back-truncated Anthropic partial_json field (empty, never dropped)', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');

  // Fragment ends exactly on a key prefix: everything is held back, so the
  // emitted partial_json is '' but the field must still be present.
  const ev = anthJson(0, 'u8ol4n@exam');
  const wrapped = wrapResponse(sseResponse(ev), session);
  const text = await new Response(wrapped.body).text();

  const events = parseDataEvents(text);
  assert.strictEqual(events.length, 2, 're-serialized truncated event + synthetic remainder event');
  assert.ok('partial_json' in events[0].delta, 'field present');
  assert.strictEqual(events[0].delta.partial_json, '');
  assert.strictEqual(events[0].delta.type, 'input_json_delta');
  assert.strictEqual(events[1].type, 'content_block_delta');
  assert.strictEqual(events[1].delta.partial_json, 'u8ol4n@exam', 'never-completing remainder surfaces verbatim');
  assert.strictEqual([...anthDeltaTexts(text, 'partial_json').values()].join(''), 'u8ol4n@exam');
});

test('wrapResponse restores Anthropic thinking_delta', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');

  const ev = anthThinking(0, 'the user mail is u8ol4n@example.com, hmm');
  const wrapped = wrapResponse(sseResponse(ev), session);
  const text = await new Response(wrapped.body).text();

  assert.ok(text.includes('the user mail is ccbi@example.com, hmm'), 'thinking_delta restored');
  assert.ok(!text.includes('u8ol4n@example.com'), 'masked value replaced');
});

test('wrapResponse restores Anthropic content_block_start text and tool_use name', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');
  addMapping(session, 'masked_tool_name', 'real_tool_name');

  const textStart = `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'mail u8ol4n@example.com' } })}\n\n`;
  const toolStart = `data: ${JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'masked_tool_name', input: {} } })}\n\n`;
  const wrapped = wrapResponse(sseResponse(textStart + toolStart), session);
  const text = await new Response(wrapped.body).text();

  assert.ok(text.includes('mail ccbi@example.com'), 'content_block_start text restored');
  assert.ok(text.includes('real_tool_name'), 'tool_use name one-shot restore');
  assert.ok(!text.includes('u8ol4n@example.com'));
  assert.ok(!text.includes('masked_tool_name'));
});

test('wrapResponse flushes Anthropic hold-back remainder before content_block_stop', async () => {
  const session = makeSession();
  addMapping(session, 'ghp_abc123def456', 'tok-secret-value');

  const ev1 = anthText(0, 'see ghp_abc123');
  const stop = `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`;
  const wrapped = wrapResponse(sseResponse(ev1 + stop), session);
  const text = await new Response(wrapped.body).text();

  assert.ok(text.includes('ghp_abc123'), 'held-back remainder surfaces, no byte loss');
  const parsed = parseDataEvents(text);
  assert.strictEqual(parsed.length, 3, 're-serialized delta, synthetic delta, stop');
  assert.strictEqual(parsed[1].type, 'content_block_delta');
  assert.strictEqual(parsed[1].delta.type, 'text_delta');
  assert.strictEqual(parsed[1].delta.text, 'ghp_abc123', 'remainder emitted verbatim (never completed)');
  assert.strictEqual(parsed[1].index, 0);
  assert.strictEqual(parsed[2].type, 'content_block_stop', 'stop event follows the synthetic delta');
  assert.strictEqual([...anthDeltaTexts(text, 'text').values()].join(''), 'see ghp_abc123');
});

test('wrapResponse flushes Anthropic remainders before message_stop and at stream end', async () => {
  const session = makeSession();
  addMapping(session, 'ghp_abc123def456', 'tok-secret-value');

  const beforeStop = anthText(0, 'x ghp_abc123') + `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
  let text = await new Response(
    wrapResponse(sseResponse(beforeStop), session).body
  ).text();
  let parsed = parseDataEvents(text);
  assert.strictEqual(parsed[parsed.length - 2].type, 'content_block_delta', 'synthetic delta before message_stop');
  assert.strictEqual(parsed[parsed.length - 2].delta.text, 'ghp_abc123');
  assert.strictEqual(parsed[parsed.length - 1].type, 'message_stop');

  // Stream ends with no message_stop at all: flush() must still emit an
  // Anthropic-shaped synthetic event (never an OpenAI-shaped chunk).
  const session2 = makeSession();
  addMapping(session2, 'ghp_abc123def456', 'tok-secret-value');
  text = await new Response(wrapResponse(sseResponse(anthText(0, 'x ghp_abc123')), session2).body).text();
  parsed = parseDataEvents(text);
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[1].type, 'content_block_delta', 'synthetic Anthropic event at stream end');
  assert.strictEqual(parsed[1].delta.type, 'text_delta');
  assert.strictEqual(parsed[1].delta.text, 'ghp_abc123');
  assert.ok(!text.includes('"choices"'), 'no OpenAI-shaped synthetic chunk for an Anthropic stream');
});

test('wrapResponse flushes only the stopping Anthropic block', async () => {
  const session = makeSession();
  addMapping(session, 'ghp_abc123def456', 'tok-secret-value');

  const block0 = anthText(0, 'x ghp_abc123'); // held back
  const block1 = anthText(1, 'plain text'); // emitted immediately
  const stop0 = `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`;
  const stop1 = `data: ${JSON.stringify({ type: 'content_block_stop', index: 1 })}\n\n`;
  const wrapped = wrapResponse(sseResponse(block0 + block1 + stop0 + stop1), session);
  const text = await new Response(wrapped.body).text();

  const synthetics = parseDataEvents(text).filter((o) => o.type === 'content_block_delta' && o.delta.text === 'ghp_abc123');
  assert.strictEqual(synthetics.length, 1, 'only block 0 had a remainder to flush');
  assert.strictEqual(synthetics[0].index, 0);
  assert.strictEqual([...anthDeltaTexts(text, 'text').values()].join('|'), 'x ghp_abc123|plain text');
});

test('wrapResponse passes a fully unmodified Anthropic stream through byte-identical', async () => {
  const session = makeSession();
  addMapping(session, 'u8ol4n@example.com', 'ccbi@example.com');

  const body =
    `data: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_1', content: [] } })}\n\n` +
    `: ping keep-alive\n\n` +
    `data: ${JSON.stringify({ type: 'ping' })}\n\n` +
    `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n` +
    anthText(0, 'The answer is 42') +
    `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n` +
    `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } })}\n\n` +
    `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`;

  const wrapped = wrapResponse(sseResponse(body), session);
  const text = await new Response(wrapped.body).text();
  assert.strictEqual(text, body, 'raw bytes equal input when nothing is restored or held back');
});

test('wrapResponse round-trips a real masked reply through an Anthropic text stream', async () => {
  const session = makeSession();
  const patterns = {
    regex: [{ regex: /\S+@\S+\.\S+/g, category: 'EMAIL', maskAs: 'email' }],
    keywords: [],
    exclude: new Set(),
  };
  const reply = 'Sure, your email john@example.com is now on file.';
  const { text: masked } = await redactText(reply, patterns, session);
  assert.notStrictEqual(masked, reply, 'reply was actually masked');

  // Split the masked reply into three deltas, deliberately cutting inside the
  // masked email so a naive byte-level restore could not see the whole key.
  const token = masked.match(/\S+@\S+\.\S+/)[0];
  const cut = masked.indexOf(token) + Math.floor(token.length / 2);
  const parts = [masked.slice(0, cut), masked.slice(cut, cut + 5), masked.slice(cut + 5)];
  const body = parts.map((p) => anthText(0, p)).join('') + `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`;

  const wrapped = wrapResponse(sseResponse(body), session);
  const text = await new Response(wrapped.body).text();
  const joined = [...anthDeltaTexts(text, 'text').values()].join('');

  assert.strictEqual(joined, reply, 'streamed text restores to the original reply');
  assert.ok(!text.includes(token), 'no residual masked token');
});
