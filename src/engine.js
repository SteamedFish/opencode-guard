import { detectSensitiveData } from './detector.js';

export async function redactText(text, patterns, session, aiDetector = null) {
  if (typeof text !== 'string' || !text) {
    return { text, count: 0 };
  }
  
  const matches = await detectSensitiveData(text, patterns, aiDetector);
  if (matches.length === 0) {
    return { text, count: 0 };
  }
  
  let result = text;
  let count = 0;
  
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const masked = session.getOrCreateMasked(match.text, match.category, match.maskAs);
    result = result.slice(0, match.start) + masked + result.slice(match.end);
    count++;
  }
  
  return { text: result, count };
}

export async function redactDeep(value, patterns, session, aiDetector = null, visited = new WeakSet()) {
  if (typeof value === 'string') {
    const result = await redactText(value, patterns, session, aiDetector);
    return result.text;
  }

  if (Array.isArray(value)) {
    if (visited.has(value)) {
      return value;
    }
    visited.add(value);
    for (let i = 0; i < value.length; i++) {
      value[i] = await redactDeep(value[i], patterns, session, aiDetector, visited);
    }
    return value;
  }

  if (value && typeof value === 'object') {
    if (visited.has(value)) {
      return value;
    }
    visited.add(value);
    for (const key of Object.keys(value)) {
      value[key] = await redactDeep(value[key], patterns, session, aiDetector, visited);
    }
    return value;
  }

  return value;
}
