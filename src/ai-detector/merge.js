/**
 * Merge and deduplicate detection results from regex and AI
 * Conflict resolution: prefer longer matches, then higher confidence
 */

/**
 * @typedef {Object} DetectionResult
 * @property {number} start
 * @property {number} end
 * @property {string} text
 * @property {string} category
 * @property {string} maskAs
 * @property {number} [confidence] - AI confidence 0-1
 * @property {string} [source] - 'regex' or 'ai'
 */

/**
 * Merge two result sets, removing overlaps
 * @param {DetectionResult[]} regexResults
 * @param {DetectionResult[]} aiResults
 * @returns {DetectionResult[]}
 */
export function mergeResults(regexResults, aiResults) {
  // Tag sources
  const taggedRegex = regexResults.map(r => ({ ...r, source: 'regex', confidence: r.confidence ?? 1.0 }));
  const taggedAI = aiResults.map(r => ({ ...r, source: 'ai' }));
  
  // Combine and sort by start position
  const all = [...taggedRegex, ...taggedAI].sort((a, b) => a.start - b.start);
  
  const merged = [];
  
  for (const result of all) {
    let overlaps = false;
    
    for (let i = 0; i < merged.length; i++) {
      const existing = merged[i];
      
      // Check for overlap
      if (result.start < existing.end && result.end > existing.start) {
        const resultLen = result.end - result.start;
        const existingLen = existing.end - existing.start;
        
        // Prefer longer match, then higher confidence
        if (resultLen > existingLen || 
            (resultLen === existingLen && result.confidence > existing.confidence)) {
          merged[i] = result;
        }
        overlaps = true;
        break;
      }
    }
    
    if (!overlaps) {
      merged.push(result);
    }
  }
  
  return merged.sort((a, b) => a.start - b.start);
}
