import { mergeResults } from './ai-detector/merge.js';

export async function detectSensitiveData(text, patterns, aiDetector = null) {
  if (typeof text !== 'string' || !text) {
    return [];
  }

  const regexResults = [];
  const seen = new Set();
  
  for (const rule of (patterns.regex || [])) {
    const regex = rule.regex;
    // Regexes are per-config singletons used synchronously here; reset state
    // instead of rebuilding a fresh RegExp per call.
    regex.lastIndex = 0;
    // Case-insensitive rules need a case-insensitive exclude check; precompute
    // the lowercased view once per rule instead of per match.
    let excludeLower = null;
    if (regex.ignoreCase && patterns.exclude?.size) {
      excludeLower = new Set([...patterns.exclude].map(e => e.toLowerCase()));
    }
    let match;
    while ((match = regex.exec(text)) !== null) {
      const matchedText = match[0];

      // Zero-width matches must never be recorded; advance to avoid an
      // infinite loop on patterns like /a*/g.
      if (matchedText.length === 0) {
        regex.lastIndex++;
        continue;
      }

      if (patterns.exclude?.has(matchedText)) continue;
      if (excludeLower?.has(matchedText.toLowerCase())) continue;

      const key = `${match.index}-${match.index + matchedText.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        regexResults.push({
          start: match.index,
          end: match.index + matchedText.length,
          text: matchedText,
          category: rule.category,
          maskAs: rule.maskAs,
        });
      }
    }
  }
  
  for (const keyword of (patterns.keywords || [])) {
    const value = keyword.value;
    // Excluded keywords must be skipped before scanning; checking inside the
    // loop without advancing `pos` would loop forever.
    if (patterns.exclude?.has(value)) continue;
    let pos = 0;
    while ((pos = text.indexOf(value, pos)) !== -1) {
      const key = `${pos}-${pos + value.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        regexResults.push({
          start: pos,
          end: pos + value.length,
          text: value,
          category: keyword.category,
          maskAs: keyword.maskAs,
        });
      }
      pos += value.length;
    }
  }
  
  regexResults.sort((a, b) => a.start - b.start);
  
  const filtered = [];
  for (const result of regexResults) {
    let overlaps = false;
    for (const existing of filtered) {
      if (result.start < existing.end && result.end > existing.start) {
        if (result.end - result.start > existing.end - existing.start) {
          filtered[filtered.indexOf(existing)] = result;
        }
        overlaps = true;
        break;
      }
    }
    if (!overlaps) filtered.push(result);
  }
  
  // Run AI detection if available
  let aiResults = [];
  if (aiDetector) {
    try {
      aiResults = await aiDetector.detect(text);
      if (aiResults.length > 0 && process.env.OPENCODE_GUARD_DEBUG) {
        console.log(`[opencode-guard] AI detection found ${aiResults.length} sensitive value(s)`);
      }
    } catch (err) {
      if (process.env.OPENCODE_GUARD_DEBUG) {
        console.warn(`[opencode-guard] AI detection error: ${err.message}`);
      }
    }
  }

  return mergeResults(filtered, aiResults);
}
