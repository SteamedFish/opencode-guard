export function restoreText(text, session, debug = false) {
  if (typeof text !== 'string' || !text) {
    return text;
  }

  let result = text;
  for (const [masked, original] of session.maskedToOriginal) {
    if (result.includes(masked)) {
      if (debug) console.log(`[opencode-guard] restoreText: found masked "${masked}" -> "${original}"`);
      result = result.split(masked).join(original);
    }
  }

  return result;
}

export function restoreDeep(value, session, visited = new WeakSet(), debug = false) {
  if (typeof value === 'string') {
    const result = restoreText(value, session, debug);
    if (debug && result !== value) {
      console.log(`[opencode-guard] restoreDeep: restored "${value}" -> "${result}"`);
    }
    return result;
  }

  if (Array.isArray(value)) {
    if (visited.has(value)) {
      return value;
    }
    visited.add(value);
    for (let i = 0; i < value.length; i++) {
      value[i] = restoreDeep(value[i], session, visited, debug);
    }
    return value;
  }

  if (value && typeof value === 'object') {
    if (visited.has(value)) {
      return value;
    }
    visited.add(value);
    for (const key of Object.keys(value)) {
      value[key] = restoreDeep(value[key], session, visited, debug);
    }
    return value;
  }

  return value;
}
