import { detectSensitiveData } from './detector.js';

export async function redactText(text, patterns, session) {
  if (typeof text !== 'string' || !text) {
    return { text, count: 0 };
  }
  
  const matches = await detectSensitiveData(text, patterns);
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

export async function redactDeep(value, patterns, session) {
  if (typeof value === 'string') {
    const result = await redactText(value, patterns, session);
    return result.text;
  }
  
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = await redactDeep(value[i], patterns, session);
    }
    return value;
  }
  
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      value[key] = await redactDeep(value[key], patterns, session);
    }
    return value;
  }
  
  return value;
}
