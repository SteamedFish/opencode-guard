# TODO

## Tracked follow-ups

### AI detection: mask-all-occurrences for duplicate flagged values
`src/ai-detector/providers/local.js` binds detected spans strictly
left-to-right (`TODO(fail-closed)` in `detect()`). When the model flags one of
several identical occurrences of a value, only the first-bound occurrence is
masked. Masking all occurrences of the flagged value (an engine change) would
close the residual leak. Noted during the 2026-09-19 Gate 3 review; the v2
non-OpenAI SSE shape item from the same review was fixed on 2026-09-19.
