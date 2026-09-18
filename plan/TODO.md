# TODO

## Tracked follow-ups

### v2 stream restore: non-OpenAI SSE shapes (from Gate 3 review, 2026-09-19)

`src/response-unmasker.js` SSE-aware restore only handles OpenAI
`chat.completion.chunk` events. Anthropic-native SSE shapes
(`content_block_delta` / `text_delta` / `input_json_delta`) pass through
verbatim — fail-safe but NOT restored (functional regression vs the old
byte-level path, which restored single-event values in any JSON field).

Fix direction (per Gate 3): add a per-shape field table mapping provider
shapes to (text field path, arguments field path), e.g. `delta.text`,
`delta.partial_json`, `delta.thinking`; reuse the same persistent
StreamingUnmasker keying per (shape, index).

Also noted: mask-all-occurrences for AI offset binding is still
`TODO(fail-closed)` in `src/ai-detector/providers/local.js` (duplicate
occurrences of the same entity value in one text: only the first is masked).
