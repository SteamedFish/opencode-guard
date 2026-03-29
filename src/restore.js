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
