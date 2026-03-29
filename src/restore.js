export function restoreText(text, session) {
  if (typeof text !== 'string' || !text) {
    return text;
  }
  
  const delimiters = /([\s\n\r\t\[\]{}(),;:'"`<>|&!@#$%^*+=~?/\\]+)/;
  const parts = text.split(delimiters);
  
  for (let i = 0; i < parts.length; i++) {
    const original = session.lookupOriginal(parts[i]);
    if (original !== undefined) {
      parts[i] = original;
    }
  }
  
  return parts.join('');
}

export function restoreDeep(value, session) {
  if (typeof value === 'string') {
    return restoreText(value, session);
  }
  
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = restoreDeep(value[i], session);
    }
    return value;
  }
  
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      value[key] = restoreDeep(value[key], session);
    }
    return value;
  }
  
  return value;
}
