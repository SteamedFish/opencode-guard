export function restoreText(text, session) {
  if (typeof text !== 'string' || !text) {
    return text;
  }

  let result = text;
  for (const [masked, original] of session.maskedToOriginal) {
    result = result.split(masked).join(original);
  }

  return result;
}

export function restoreDeep(value, session, visited = new WeakSet()) {
  if (typeof value === 'string') {
    return restoreText(value, session);
  }

  if (Array.isArray(value)) {
    if (visited.has(value)) {
      return value;
    }
    visited.add(value);
    for (let i = 0; i < value.length; i++) {
      value[i] = restoreDeep(value[i], session, visited);
    }
    return value;
  }

  if (value && typeof value === 'object') {
    if (visited.has(value)) {
      return value;
    }
    visited.add(value);
    for (const key of Object.keys(value)) {
      value[key] = restoreDeep(value[key], session, visited);
    }
    return value;
  }

  return value;
}
