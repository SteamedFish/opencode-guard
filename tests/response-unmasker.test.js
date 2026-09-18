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
