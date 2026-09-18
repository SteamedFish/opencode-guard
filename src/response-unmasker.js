import { StreamingUnmasker } from './streaming-unmasker.js';

// LEGACY fallback pattern for StreamingUnmasker, kept for API compatibility
// (imported by v2.js). It is only used when the session exposes no masked-key
// source; all in-repo callers pass sessions/views that do, so matching is
// driven by the session's actual masked keys instead. Character classes
// exclude quotes, backslashes, and control characters so that masked tokens
// embedded in JSON/SSE frames are matched exactly.
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
 * Also exposes the masked-key source used by StreamingUnmasker's key-driven
 * matching:
 *  - getMaskedKeys() lists only keys whose ORIGINALS are JSON-safe (unsafe
 *    ones can never be substituted, so including them would just bloat the
 *    matcher) AND whose own bytes are JSON-safe (a masked key containing a
 *    quote/backslash/control char only ever appears escaped inside JSON
 *    strings, so it can never match the raw stream verbatim).
 *  - getMaskedKeyFingerprint() mirrors StreamingUnmasker's cache-invalidation
 *    heuristic over the underlying map.
 *
 * @param {Object} session - MaskSession
 * @returns {{ lookupOriginal(masked: string): string|undefined,
 *             getMaskedKeys(): string[],
 *             getMaskedKeyFingerprint(): string }}
 */
export function createJsonSafeSessionView(session) {
  return {
    lookupOriginal(masked) {
      const original = session.lookupOriginal(masked);
      if (original === undefined) return undefined;
      return isJsonSafe(original) ? original : undefined;
    },
    getMaskedKeys() {
      const keys = [];
      for (const [masked, original] of session.maskedToOriginal) {
        if (isJsonSafe(original) && isJsonSafe(masked)) keys.push(masked);
      }
      return keys;
    },
    getMaskedKeyFingerprint() {
      const map = session.maskedToOriginal;
      let total = 0;
      let first;
      let last;
      for (const k of map.keys()) {
        if (first === undefined) first = k;
        last = k;
        total += k.length;
      }
      return `${map.size}:${total}:${first ?? ''}:${last ?? ''}`;
    },
  };
}

/**
 * Wrap a provider HTTP response so its body is unmasked as it streams out.
 *
 * Returns null (no wrapping) when there is no body or the content type does
 * not look textual (JSON, SSE, or text/*). Returns the ORIGINAL response
 * unchanged when the body has already been consumed or locked by another
 * reader (wrapping would throw). Otherwise returns a new Response whose body
 * pipes the original through a TransformStream that decodes, unmasks, and
 * re-encodes chunk by chunk.
 *
 * Headers are cloned with `content-length` and `content-encoding` removed:
 * unmasking changes the body length (stale content-length would truncate or
 * hang the client) and this transform cannot pass through a content-encoded
 * (e.g. gzip) body it has not decoded.
 *
 * @param {Response} response
 * @param {Object} session - MaskSession
 * @returns {Response|null}
 */
export function wrapResponse(response, session) {
  if (!response || !response.body) return null;

  const contentType = response.headers?.get?.('content-type') || '';
  if (!/json|event-stream|^text\//i.test(contentType)) return null;

  if (response.bodyUsed || response.body.locked) {
    // Cannot tee/pipe a consumed or locked body; leave the stream untouched
    // (values stay masked — fail-safe) instead of throwing.
    console.debug('[opencode-guard] wrapResponse: response body already used or locked, returning original response');
    return response;
  }

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

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');

  return new Response(response.body.pipeThrough(transform), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
