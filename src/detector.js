export async function detectSensitiveData(text, patterns, options = {}) {
  const results = [];
  const seen = new Set();
  
  for (const rule of (patterns.regex || [])) {
    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      const matchedText = match[0];
      if (patterns.exclude?.has(matchedText)) continue;
      
      const key = `${match.index}-${match.index + matchedText.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
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
        results.push({
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
  
  results.sort((a, b) => a.start - b.start);
  
  const filtered = [];
  for (const result of results) {
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
  
  return filtered;
}
