import { StreamingUnmasker } from './streaming-unmasker.js';

// Same token patterns as the default StreamingUnmasker, but the email
// character classes exclude quotes, backslashes, and control characters so
// that masked tokens embedded in JSON/SSE frames (e.g. ..."user@example.com"} )
// are matched exactly instead of greedily swallowing the trailing `"`.
export const JSON_STREAM_MASKED_PATTERN = /(?:sk-|ghp_|gho_|ghu_|ghs_|ghr_|AKIA|ASIA)[A-Za-z0-9_-]+|(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?|(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|:(?::[0-9a-fA-F]{1,4}){1,7}|::|[^\s@"\\\x00-\x1f]+@[^\s@"\\\x00-\x1f]+\.[^\s@"\\\x00-\x1f]+/g;

/**
 * Check whether a restored original is safe to embed in a raw JSON / SSE
 * stream. Values containing quotes, backslashes, or control characters would
 * corrupt the frame if substituted verbatim, so they stay masked.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isJsonSafe(text) {
  if (typeof text !== 'string') return false;
  return !/["\\\x00-\x1f]/.test(text);
}

/**
 * Create a JSON-safe view over a mask session. Like session.lookupOriginal,
 * but returns undefined for originals that are not safe to embed in raw
 * JSON/SSE streams.
 *
 * @param {Object} session - MaskSession
 * @returns {{ lookupOriginal(masked: string): string|undefined }}
 */
export function createJsonSafeSessionView(session) {
  return {
    lookupOriginal(masked) {
      const original = session.lookupOriginal(masked);
      if (original === undefined) return undefined;
      return isJsonSafe(original) ? original : undefined;
    },
  };
}

/**
 * Wrap a provider HTTP response so its body is unmasked as it streams out.
 *
 * Returns null (no wrapping) when there is no body or the content type does
 * not look textual (JSON, SSE, or text/*). Otherwise returns a new Response
 * whose body pipes the original through a TransformStream that decodes,
 * unmasks, and re-encodes chunk by chunk.
 *
 * @param {Response} response
 * @param {Object} session - MaskSession
 * @returns {Response|null}
 */
export function wrapResponse(response, session) {
  if (!response || !response.body) return null;

  const contentType = response.headers?.get?.('content-type') || '';
  if (!/json|event-stream|^text\//i.test(contentType)) return null;

  const unmasker = new StreamingUnmasker(createJsonSafeSessionView(session), {
    maskedPattern: JSON_STREAM_MASKED_PATTERN,
  });
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const transform = new TransformStream({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      if (text) controller.enqueue(encoder.encode(unmasker.transform(text)));
    },
    flush(controller) {
      let tail = decoder.decode();
      tail += unmasker.flush();
      if (tail) controller.enqueue(encoder.encode(tail));
    },
  });

  return new Response(response.body.pipeThrough(transform), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
