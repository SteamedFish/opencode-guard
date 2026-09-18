import { test } from 'node:test';
import assert from 'node:assert';
import { isJsonSafe, createJsonSafeSessionView, wrapResponse } from '../src/response-unmasker.js';
import { MaskSession } from '../src/session.js';

function makeSession() {
  return new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
}

function addMapping(session, masked, original) {
  session.maskedToOriginal.set(masked, original);
  session.timestamps.set(masked, Date.now());
}

test('isJsonSafe returns true for plain text', () => {
  assert.strictEqual(isJsonSafe('user@example.com'), true);
  assert.strictEqual(isJsonSafe('hello world'), true);
});

test('isJsonSafe returns false for quotes, backslashes, and control chars', () => {
  assert.strictEqual(isJsonSafe('pass"word'), false);
  assert.strictEqual(isJsonSafe('pass\\word'), false);
  assert.strictEqual(isJsonSafe('pass\nword'), false);
  assert.strictEqual(isJsonSafe('pass\tword'), false);
  assert.strictEqual(isJsonSafe('password'), false);
});

test('createJsonSafeSessionView hides non-JSON-safe originals', () => {
  const session = makeSession();
  addMapping(session, 'user42@example.com', 'user@example.com');
  addMapping(session, 'sk-Ab12Cd34Ef', 'pass"word\n123');

  const view = createJsonSafeSessionView(session);
  assert.strictEqual(view.lookupOriginal('user42@example.com'), 'user@example.com');
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

test('wrapResponse restores JSON-safe originals in SSE stream', async () => {
  const session = makeSession();
  addMapping(session, 'user42@example.com', 'user@example.com');
  addMapping(session, 'sk-Ab12Cd34Ef', 'pass"word\n123');

  const response = sseResponse('data: {"delta":"reply to user42@example.com","key":"sk-Ab12Cd34Ef"}\n\n');
  const wrapped = wrapResponse(response, session);
  assert.ok(wrapped instanceof Response);
  assert.strictEqual(wrapped.status, response.status);
  assert.strictEqual(wrapped.headers.get('content-type'), 'text/event-stream');

  const text = await new Response(wrapped.body).text();
  assert.ok(text.includes('user@example.com'), 'JSON-safe original restored');
  assert.ok(!text.includes('user42@example.com'), 'masked token replaced');
  assert.ok(text.includes('sk-Ab12Cd34Ef'), 'JSON-unsafe original stays masked');
  assert.ok(!text.includes('pass"word'), 'unsafe original not leaked');
});

test('wrapResponse handles multibyte characters split across chunks', async () => {
  const session = makeSession();
  addMapping(session, 'user42@example.com', 'user@example.com');

  const bytes = new TextEncoder().encode('data: {"delta":"hélö user42@example.com"}\n\n');
  const response = new Response(
    new ReadableStream({
      async start(c) {
        // split mid-codepoint
        c.enqueue(bytes.slice(0, 12));
        c.enqueue(bytes.slice(12));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } }
  );

  const wrapped = wrapResponse(response, session);
  const text = await new Response(wrapped.body).text();
  assert.ok(text.includes('user@example.com'));
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
  addMapping(session, 'user42@example.com', 'user@example.com');

  const response = new Response('{"email":"user42@example.com"}', {
    headers: { 'content-type': 'application/json' },
  });
  const wrapped = wrapResponse(response, session);
  assert.ok(wrapped);
  const text = await new Response(wrapped.body).text();
  assert.strictEqual(text, '{"email":"user@example.com"}');
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
  const maskedMac = 'f0:de:bc:9a:78:56';
  const originalMac = '00:1a:2b:3c:4d:5e';
  addMapping(session, maskedUuid, originalUuid);
  addMapping(session, maskedMac, originalMac);

  const response = sseResponse(`data: {"id":"${maskedUuid}","mac":"${maskedMac}"}\n\n`);
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

  const body = 'data: {"delta":"token ghp_abc123def4567890 ok"}\n\n';
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
