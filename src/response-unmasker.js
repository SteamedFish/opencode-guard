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

// ---------------------------------------------------------------------------
// SSE-aware content-level restore
// ---------------------------------------------------------------------------

const SSE_DONE_PAYLOAD = '[DONE]';

/**
 * Split off the first complete line of `buf` (terminated by \n or \r\n).
 * Returns { line, raw, rest } where `raw` includes the terminator and `line`
 * does not, or null when no complete line is buffered yet. A trailing lone
 * \r is left in the buffer (it may be the first half of a \r\n split across
 * byte chunks).
 */
function takeLine(buf) {
  const nl = buf.indexOf('\n');
  if (nl === -1) return null;
  const end = nl > 0 && buf[nl - 1] === '\r' ? nl - 1 : nl;
  return { line: buf.slice(0, end), raw: buf.slice(0, nl + 1), rest: buf.slice(nl + 1) };
}

/**
 * Classify a complete SSE line. Only `data:` lines are buffered (they carry
 * the pending event's payload); everything else — comment keep-alives (`:`),
 * `event:`/`id:`/`retry:`, and unknown fields — is passed through immediately
 * so keep-alives are never delayed behind a partial event.
 */
function classifySseLine(line) {
  if (line.startsWith(':')) return { kind: 'passthrough' };
  const colon = line.indexOf(':');
  const field = colon === -1 ? line : line.slice(0, colon);
  if (field !== 'data') return { kind: 'passthrough' };
  let value = colon === -1 ? '' : line.slice(colon + 1);
  if (value.startsWith(' ')) value = value.slice(1); // SSE spec: strip one leading space
  return { kind: 'data', value };
}

/**
 * Byte-level whole-body transform for non-SSE textual responses
 * (application/json, text/*): decode, unmask, re-encode chunk by chunk.
 * This is the pre-SSE-aware behavior, kept unchanged for non-SSE bodies.
 */
function createByteTransform(session, decoder, encoder) {
  const unmasker = new StreamingUnmasker(createJsonSafeSessionView(session), {
    maskedPattern: JSON_STREAM_MASKED_PATTERN,
  });

  return new TransformStream({
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
}

/**
 * SSE-aware transform: parse-always, passthrough-when-unmodified.
 *
 * Incoming text is buffered into SSE events (blank-line terminated; \n and
 * \r\n tolerated; a multi-`data:`-line event's payload is the concatenation
 * of its data values per the SSE spec). Comment keep-alives and
 * event:/id:/retry:/unknown field lines pass through immediately.
 *
 * Two provider stream shapes are restored at the content-field level; every
 * restorable field is fed through a persistent StreamingUnmasker so masked
 * values SPLIT ACROSS EVENTS still restore.
 *
 * OpenAI chat.completion.chunk (non-empty `choices` array):
 *  - choice.delta.content           -> one unmasker per choice.index
 *  - choice.delta.reasoning_content -> a SEPARATE unmasker per choice.index
 *    (reasoning models echo user input)
 *  - choice.delta.tool_calls[j].function.arguments -> one unmasker per
 *    (choiceIndex, toolCall.index) over the concatenated fragments; the
 *    emitted value may be '' (hold-back truncation) and the field is never
 *    dropped
 *  - tool_calls[j].function.name -> one-shot transform+flush (names arrive
 *    complete in a single chunk)
 *
 * Anthropic Messages API stream (`type`-tagged events; the per-shape field
 * table is ANTHROPIC_DELTA_FIELDS):
 *  - content_block_delta.delta.text / .partial_json / .thinking -> one
 *    unmasker per (block index, field) over the concatenated fragments; the
 *    emitted value may be '' (hold-back truncation) and the field is never
 *    dropped
 *  - content_block_start.content_block.text / .thinking -> the SAME
 *    persistent unmasker as the block's deltas (one logical stream)
 *  - content_block_start.content_block.name -> one-shot transform+flush
 *    (tool_use names arrive complete in the start event)
 *  - content_block_stop flushes that block's unmaskers; remainders are
 *    injected as synthetic content_block_delta events BEFORE the stop event
 *  - message_delta / message_stop flush ALL remaining block unmaskers the
 *    same way (there is no [DONE] in this shape)
 *
 * Events where no field changed are emitted as their ORIGINAL raw bytes;
 * only modified events are re-serialized via JSON.stringify. Events with
 * `choices: []` (usage chunks), unparseable data, error events, ping /
 * message_start, unknown `type`s, and any non-chunk JSON pass through
 * verbatim.
 *
 * Hold-back byte-loss invariant: bytes held back by an unmasker at the end
 * of event N surface later — completed+restored in a later event of the same
 * stream, merged into the choice's finish_reason chunk (content +
 * finish_reason in one chunk is legal), or, when no finish chunk arrives,
 * injected as ONE synthetic chunk cloned from the last seen chunk (same
 * id/model/created, finish_reason: null) BEFORE [DONE] or at stream end.
 * [DONE] itself always passes through byte-identical.
 *
 * Fail-safe: any internal error emits whatever raw bytes are pending (plus
 * flushed unmasker remainders) and falls back to dumb byte passthrough for
 * the rest of the stream — masked values stay masked, and the transform
 * never throws.
 */
function createSseTransform(session, decoder, encoder) {
  const view = createJsonSafeSessionView(session);
  const unmaskerOptions = { maskedPattern: JSON_STREAM_MASKED_PATTERN };

  let lineBuffer = ''; // partial line (no terminator yet)
  let dataRaw = ''; // raw bytes of the pending event's data lines (incl. terminators)
  let dataValues = []; // extracted data values of the pending event
  let broken = false; // fail-safe dumb passthrough after an internal error
  let lastChunkTemplate = null; // structuredClone of the last parsed chunk

  const contentUnmaskers = new Map(); // choiceIndex -> StreamingUnmasker
  const reasoningUnmaskers = new Map(); // choiceIndex -> StreamingUnmasker
  const toolArgUnmaskers = new Map(); // `${choiceIndex}:${toolCallIndex}` -> StreamingUnmasker
  const anthropicUnmaskers = new Map(); // `${blockIndex}:${fieldKey}` -> StreamingUnmasker

  /**
   * Per-shape field table for Anthropic Messages API content_block_delta
   * events: streamed text lives in one of these delta fields (the OpenAI
   * analogs are delta.content, tool_calls[].function.arguments, and
   * delta.reasoning_content). `key` scopes the persistent unmasker per
   * (block index, field); `deltaType` rebuilds synthetic delta events when
   * held-back remainders are flushed at block/message/stream end.
   */
  const ANTHROPIC_DELTA_FIELDS = [
    { prop: 'text', key: 'text', deltaType: 'text_delta' },
    { prop: 'partial_json', key: 'args', deltaType: 'input_json_delta' },
    { prop: 'thinking', key: 'thinking', deltaType: 'thinking_delta' },
  ];

  function lazyUnmasker(map, key) {
    let u = map.get(key);
    if (!u) {
      u = new StreamingUnmasker(view, unmaskerOptions);
      map.set(key, u);
    }
    return u;
  }

  function takeFlushed(map, key) {
    const u = map.get(key);
    if (!u) return '';
    map.delete(key);
    return u.flush();
  }

  /**
   * Best-effort drain of every unmasker as plain text. Only used on the
   * broken/fail-safe path, where held-back bytes must still surface.
   */
  function flushAllText() {
    let out = '';
    for (const map of [contentUnmaskers, reasoningUnmaskers, toolArgUnmaskers, anthropicUnmaskers]) {
      for (const [, u] of map) {
        try {
          out += u.flush();
        } catch {
          /* best effort */
        }
      }
      map.clear();
    }
    return out;
  }

  /**
   * Flush every pending unmasker and group the remainders by choice index.
   * Clears all unmasker maps. Returns a Map (possibly empty).
   */
  function flushAllRemainders() {
    const grouped = new Map(); // choiceIdx -> { content, reasoning, toolArgs: [{tcIdx, rem}] }
    const ensure = (idx) => {
      let g = grouped.get(idx);
      if (!g) {
        g = { content: '', reasoning: '', toolArgs: [] };
        grouped.set(idx, g);
      }
      return g;
    };
    for (const [idx, u] of contentUnmaskers) {
      const rem = u.flush();
      if (rem) ensure(idx).content = rem;
    }
    contentUnmaskers.clear();
    for (const [idx, u] of reasoningUnmaskers) {
      const rem = u.flush();
      if (rem) ensure(idx).reasoning = rem;
    }
    reasoningUnmaskers.clear();
    for (const [key, u] of toolArgUnmaskers) {
      const rem = u.flush();
      if (rem) {
        const sep = key.indexOf(':');
        ensure(Number(key.slice(0, sep))).toolArgs.push({ tcIdx: Number(key.slice(sep + 1)), rem });
      }
    }
    toolArgUnmaskers.clear();
    return grouped;
  }

  /**
   * Build ONE synthetic chunk carrying flushed remainders, cloned from the
   * last seen chunk (same id/model/created, finish_reason: null). Returns
   * null when there is nothing to emit.
   */
  function buildSyntheticChunk(grouped) {
    if (!grouped || grouped.size === 0) return null;
    const base = lastChunkTemplate ? structuredClone(lastChunkTemplate) : {};
    delete base.usage;
    const choices = [];
    for (const [idx, parts] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
      const delta = {};
      if (parts.content) delta.content = parts.content;
      if (parts.reasoning) delta.reasoning_content = parts.reasoning;
      if (parts.toolArgs.length > 0) {
        delta.tool_calls = parts.toolArgs.map(({ tcIdx, rem }) => ({
          index: tcIdx,
          function: { arguments: rem },
        }));
      }
      choices.push({ index: idx, delta, finish_reason: null });
    }
    base.choices = choices;
    return base;
  }

  /**
   * Flush every pending unmasker (both stream shapes) and emit the remainders
   * as synthetic events: an OpenAI-shaped chunk for OpenAI unmaskers, then
   * content_block_delta events for Anthropic ones. Used before [DONE] and at
   * stream end, where the shape of what is pending decides what is emitted.
   */
  function emitRemainders(enqueue) {
    const synth = buildSyntheticChunk(flushAllRemainders());
    if (synth) enqueue(`data: ${JSON.stringify(synth)}\n\n`);
    for (const ev of flushAnthropicRemainders()) enqueue(`data: ${JSON.stringify(ev)}\n\n`);
  }

  /**
   * Feed one choice's delta fields through their persistent unmaskers.
   * Mutates `delta`; returns true when any field's output differed from its
   * input (restore hit or hold-back truncation).
   */
  function processDelta(delta, idx) {
    let modified = false;
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      const out = lazyUnmasker(contentUnmaskers, idx).transform(delta.content);
      if (out !== delta.content) {
        delta.content = out;
        modified = true;
      }
    }
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
      const out = lazyUnmasker(reasoningUnmaskers, idx).transform(delta.reasoning_content);
      if (out !== delta.reasoning_content) {
        delta.reasoning_content = out;
        modified = true;
      }
    }
    if (Array.isArray(delta.tool_calls)) {
      for (let pos = 0; pos < delta.tool_calls.length; pos++) {
        const tc = delta.tool_calls[pos];
        if (!tc || typeof tc !== 'object') continue;
        const fn = tc.function;
        if (!fn || typeof fn !== 'object') continue;
        const tcIdx = typeof tc.index === 'number' ? tc.index : pos;
        if (typeof fn.arguments === 'string') {
          const out = lazyUnmasker(toolArgUnmaskers, `${idx}:${tcIdx}`).transform(fn.arguments);
          if (out !== fn.arguments) {
            fn.arguments = out; // may be '' — the field is never dropped
            modified = true;
          }
        }
        if (typeof fn.name === 'string' && fn.name.length > 0) {
          // One-shot: names arrive complete in a single chunk.
          const u = new StreamingUnmasker(view, unmaskerOptions);
          const out = u.transform(fn.name) + u.flush();
          if (out !== fn.name) {
            fn.name = out;
            modified = true;
          }
        }
      }
    }
    return modified;
  }

  /**
   * Feed one Anthropic content_block_delta's restorable fields through their
   * persistent unmaskers (keyed per block index + field). Mutates `delta`;
   * returns true when any field's output differed from its input (restore hit
   * or hold-back truncation).
   */
  function processAnthropicDelta(delta, index) {
    let modified = false;
    for (const { prop, key } of ANTHROPIC_DELTA_FIELDS) {
      if (typeof delta[prop] !== 'string' || delta[prop].length === 0) continue;
      const out = lazyUnmasker(anthropicUnmaskers, `${index}:${key}`).transform(delta[prop]);
      if (out !== delta[prop]) {
        delta[prop] = out; // may be '' — the field is never dropped
        modified = true;
      }
    }
    return modified;
  }

  /**
   * Feed one Anthropic content_block_start's restorable fields. `text` /
   * `thinking` share the persistent unmasker of that block's deltas (one
   * logical stream); `name` (tool_use) arrives complete and is a one-shot
   * transform+flush. Mutates `contentBlock`; returns true when modified.
   */
  function processAnthropicBlockStart(contentBlock, index) {
    let modified = false;
    for (const { prop, key } of ANTHROPIC_DELTA_FIELDS) {
      if (typeof contentBlock[prop] !== 'string' || contentBlock[prop].length === 0) continue;
      const out = lazyUnmasker(anthropicUnmaskers, `${index}:${key}`).transform(contentBlock[prop]);
      if (out !== contentBlock[prop]) {
        contentBlock[prop] = out;
        modified = true;
      }
    }
    if (typeof contentBlock.name === 'string' && contentBlock.name.length > 0) {
      // One-shot: tool_use names arrive complete in the start event.
      const u = new StreamingUnmasker(view, unmaskerOptions);
      const out = u.transform(contentBlock.name) + u.flush();
      if (out !== contentBlock.name) {
        contentBlock.name = out;
        modified = true;
      }
    }
    return modified;
  }

  /**
   * Flush Anthropic block unmaskers and build synthetic content_block_delta
   * events carrying their held-back remainders. With `index` given, flushes
   * only that block; otherwise flushes every block. Clears the flushed
   * entries. Returns the synthetic events (possibly empty), ordered by block
   * index.
   */
  function flushAnthropicRemainders(index) {
    const events = [];
    for (const key of [...anthropicUnmaskers.keys()]) {
      const sep = key.indexOf(':');
      const idx = Number(key.slice(0, sep));
      if (index !== undefined && idx !== index) continue;
      const field = ANTHROPIC_DELTA_FIELDS.find((f) => f.key === key.slice(sep + 1));
      const rem = takeFlushed(anthropicUnmaskers, key);
      if (!rem || !field) continue;
      events.push({
        type: 'content_block_delta',
        index: idx,
        delta: { type: field.deltaType, [field.prop]: rem },
      });
    }
    events.sort((a, b) => a.index - b.index);
    return events;
  }

  /**
   * A finish_reason arrived for choice `idx`: flush that choice's unmaskers
   * and merge the remainders into the finish chunk's delta (content and
   * finish_reason in one chunk is legal). Mutates `choice`; returns true when
   * anything was merged.
   */
  function flushChoiceRemainders(choice, idx) {
    const contentRem = takeFlushed(contentUnmaskers, idx);
    const reasoningRem = takeFlushed(reasoningUnmaskers, idx);
    const toolRems = [];
    for (const key of [...toolArgUnmaskers.keys()]) {
      const sep = key.indexOf(':');
      if (Number(key.slice(0, sep)) !== idx) continue;
      const rem = takeFlushed(toolArgUnmaskers, key);
      if (rem) toolRems.push({ tcIdx: Number(key.slice(sep + 1)), rem });
    }
    if (!contentRem && !reasoningRem && toolRems.length === 0) return false;

    if (!choice.delta || typeof choice.delta !== 'object') choice.delta = {};
    const delta = choice.delta;
    if (contentRem) {
      delta.content = (typeof delta.content === 'string' ? delta.content : '') + contentRem;
    }
    if (reasoningRem) {
      delta.reasoning_content =
        (typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '') + reasoningRem;
    }
    if (toolRems.length > 0) {
      if (!Array.isArray(delta.tool_calls)) delta.tool_calls = [];
      for (const { tcIdx, rem } of toolRems) {
        let tc = delta.tool_calls.find(
          (t) => t && typeof t === 'object' && typeof t.index === 'number' && t.index === tcIdx
        );
        if (!tc) {
          tc = { index: tcIdx, function: {} };
          delta.tool_calls.push(tc);
        }
        if (!tc.function || typeof tc.function !== 'object') tc.function = {};
        tc.function.arguments =
          (typeof tc.function.arguments === 'string' ? tc.function.arguments : '') + rem;
      }
    }
    return true;
  }

  /**
   * Handle one parsed non-OpenAI chunk event. Recognized Anthropic Messages
   * API shapes are restored/flushed; the event's ORIGINAL raw bytes are
   * re-emitted unless a field changed (then the object is re-serialized).
   * Returns true when the event matched a known Anthropic shape (i.e. it was
   * emitted here), false when the caller should pass it through verbatim.
   */
  function handleAnthropicEvent(obj, raw, enqueue) {
    const type = obj.type;
    if (typeof type !== 'string') return false;

    if (
      type === 'content_block_delta' &&
      typeof obj.index === 'number' &&
      obj.delta &&
      typeof obj.delta === 'object'
    ) {
      const modified = processAnthropicDelta(obj.delta, obj.index);
      enqueue(modified ? `data: ${JSON.stringify(obj)}\n\n` : raw);
      return true;
    }
    if (
      type === 'content_block_start' &&
      typeof obj.index === 'number' &&
      obj.content_block &&
      typeof obj.content_block === 'object'
    ) {
      const modified = processAnthropicBlockStart(obj.content_block, obj.index);
      enqueue(modified ? `data: ${JSON.stringify(obj)}\n\n` : raw);
      return true;
    }
    if (type === 'content_block_stop' && typeof obj.index === 'number') {
      for (const ev of flushAnthropicRemainders(obj.index)) enqueue(`data: ${JSON.stringify(ev)}\n\n`);
      enqueue(raw);
      return true;
    }
    if (type === 'message_delta' || type === 'message_stop') {
      for (const ev of flushAnthropicRemainders()) enqueue(`data: ${JSON.stringify(ev)}\n\n`);
      enqueue(raw);
      return true;
    }
    return false;
  }

  /**
   * Dispatch one complete data event. `blankRaw` is the event's terminating
   * blank line (raw, including its own line terminator).
   */
  function dispatchEvent(enqueue, blankRaw) {
    const payload = dataValues.join('\n');
    const raw = dataRaw + blankRaw;
    dataRaw = '';
    dataValues = [];
    try {
      if (payload.trim() === SSE_DONE_PAYLOAD) {
        // Flush all pending unmaskers; inject remainders BEFORE [DONE], then
        // pass [DONE] through byte-identical.
        emitRemainders(enqueue);
        enqueue(raw);
        return;
      }
      let obj;
      try {
        obj = JSON.parse(payload);
      } catch {
        enqueue(raw); // unparseable data: verbatim
        return;
      }
      if (!obj || typeof obj !== 'object') {
        enqueue(raw); // unparseable-ish JSON (null/primitive): verbatim
        return;
      }
      if (!Array.isArray(obj.choices) || obj.choices.length === 0) {
        if (handleAnthropicEvent(obj, raw, enqueue)) return;
        enqueue(raw); // non-chunk JSON / error events / usage chunks: verbatim
        return;
      }
      // JSON.parse output is always structuredClone-able.
      lastChunkTemplate = structuredClone(obj);
      let modified = false;
      for (let pos = 0; pos < obj.choices.length; pos++) {
        const choice = obj.choices[pos];
        if (!choice || typeof choice !== 'object') continue;
        const idx = typeof choice.index === 'number' ? choice.index : pos;
        if (choice.delta && typeof choice.delta === 'object') {
          if (processDelta(choice.delta, idx)) modified = true;
        }
        if (choice.finish_reason != null) {
          if (flushChoiceRemainders(choice, idx)) modified = true;
        }
      }
      // Passthrough-when-unmodified: untouched events keep their original raw
      // bytes; only modified events are re-serialized.
      enqueue(modified ? `data: ${JSON.stringify(obj)}\n\n` : raw);
    } catch (err) {
      // Fail-safe: emit pending raw bytes plus flushed remainders, then fall
      // back to dumb byte passthrough for the rest of the stream.
      broken = true;
      console.warn('[opencode-guard] SSE event restore failed; falling back to byte passthrough:', err);
      try {
        enqueue(raw + flushAllText());
      } catch {
        /* best effort */
      }
    }
  }

  /**
   * Feed decoded text into the SSE event parser. Complete data events are
   * dispatched at blank lines; comment/meta lines pass through immediately.
   */
  function feed(text, enqueue) {
    lineBuffer += text;
    for (;;) {
      const taken = takeLine(lineBuffer);
      if (!taken) return;
      lineBuffer = taken.rest;
      if (taken.line === '') {
        if (dataValues.length === 0) {
          enqueue(taken.raw); // bare event boundary (after comments/meta lines)
        } else {
          dispatchEvent(enqueue, taken.raw);
        }
      } else {
        const cls = classifySseLine(taken.line);
        if (cls.kind === 'data') {
          dataRaw += taken.raw;
          dataValues.push(cls.value);
        } else {
          enqueue(taken.raw); // comment keep-alive / event: / id: / retry: / unknown
        }
      }
    }
  }

  return new TransformStream({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      if (!text) return;
      const enqueue = (s) => {
        if (s) controller.enqueue(encoder.encode(s));
      };
      if (broken) {
        enqueue(text);
        return;
      }
      try {
        feed(text, enqueue);
      } catch (err) {
        broken = true;
        console.warn('[opencode-guard] SSE restore failed; falling back to byte passthrough:', err);
        try {
          enqueue(dataRaw + lineBuffer + flushAllText());
        } catch {
          /* best effort */
        }
        dataRaw = '';
        dataValues = [];
        lineBuffer = '';
      }
    },
    flush(controller) {
      const enqueue = (s) => {
        if (s) controller.enqueue(encoder.encode(s));
      };
      try {
        const tail = decoder.decode();
        if (broken) {
          enqueue(dataRaw + lineBuffer + tail + flushAllText());
          return;
        }
        if (tail) feed(tail, enqueue);
        // Drain: a final partial event that did not end cleanly (partial line
        // or data lines without a blank-line terminator) goes out verbatim.
        enqueue(dataRaw + lineBuffer);
        dataRaw = '';
        dataValues = [];
        lineBuffer = '';
        // Stream ended without [DONE]: flush all unmaskers and inject any
        // remainders as one synthetic chunk (OpenAI shape) and/or
        // content_block_delta events (Anthropic shape).
        emitRemainders(enqueue);
      } catch (err) {
        console.warn('[opencode-guard] SSE restore flush failed:', err);
      }
    },
  });
}

/**
 * Wrap a provider HTTP response so its body is unmasked as it streams out.
 *
 * Returns null (no wrapping) when there is no body or the content type does
 * not look textual (JSON, SSE, or text/*). Returns the ORIGINAL response
 * unchanged when the body has already been consumed or locked by another
 * reader (wrapping would throw). Otherwise returns a new Response whose body
 * pipes the original through a TransformStream.
 *
 * For `text/event-stream` bodies the transform is SSE-aware (see
 * createSseTransform): it parses events and restores at the content-field
 * level so masked values split across SSE event boundaries still restore.
 * For other textual bodies it decodes, unmasks, and re-encodes the raw byte
 * stream chunk by chunk.
 *
 * Caveat: SSE events that are actually modified go through
 * JSON.parse/stringify, so >2^53 integer fields in THOSE events would lose
 * precision (accepted; chunk fields are small in practice). Unmodified
 * events keep their original raw bytes.
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

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const transform = /^text\/event-stream/i.test(contentType)
    ? createSseTransform(session, decoder, encoder)
    : createByteTransform(session, decoder, encoder);

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');

  return new Response(response.body.pipeThrough(transform), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
