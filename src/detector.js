import { mergeResults } from './ai-detector/merge.js';

export async function detectSensitiveData(text, patterns, aiDetector = null) {
  if (typeof text !== 'string' || !text) {
    return [];
  }

  const regexResults = [];
  const seen = new Set();
  
  for (const rule of (patterns.regex || [])) {
    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    let match;
    let lastIndex = -1;
    while ((match = regex.exec(text)) !== null) {
      const matchedText = match[0];

      if (match.index === lastIndex) {
        regex.lastIndex++;
        continue;
      }
      lastIndex = match.index;

      if (patterns.exclude?.has(matchedText)) continue;

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
    let pos = 0;
    while ((pos = text.indexOf(value, pos)) !== -1) {
      if (patterns.exclude?.has(value)) continue;
      
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
    } catch (err) {
      // AI detection failures are non-fatal
      if (process.env.OPENCODE_GUARD_DEBUG) {
        console.warn(`[opencode-guard] AI detection error: ${err.message}`);
      }
    }
  }
  
  // Merge regex and AI results
  return mergeResults(filtered, aiResults);
}
