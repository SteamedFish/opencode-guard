export class StreamingUnmasker {
  constructor(session, options = {}) {
    this.session = session;
    this.maxMaskedLength = options.maxMaskedLength || 128;
    // Generic pattern that catches most masked tokens (API keys, emails, IPs, etc.)
    // This matches: sk-xxx, ghp_xxx, AWS keys, and email addresses
    this.maskedPattern = options.maskedPattern || /(?:sk-|ghp_|gho_|ghu_|ghs_|ghr_|AKIA|ASIA)[A-Za-z0-9_-]+|(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?|(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|:(?::[0-9a-fA-F]{1,4}){1,7}|::|[^\s@]+@[^\s@]+\.[^\s@]+/g;
    this.buffer = '';
    this.closed = false;
  }

  transform(chunk) {
    if (this.closed) {
      throw new Error('StreamingUnmasker already closed');
    }

    const bufferBeforeChunk = this.buffer.length;
    this.buffer += chunk;

    const originalBufferLength = this.buffer.length;
    const matches = [...this.buffer.matchAll(this.maskedPattern)];
    let processedBuffer = this.buffer;
    let rightmostMatchInfo = null;

    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      const masked = match[0];
      const original = this.session.lookupOriginal(masked);

      if (original) {
        const isContinuation = match.index === 0 && bufferBeforeChunk > 0;
        if (!isContinuation && (!rightmostMatchInfo || match.index > rightmostMatchInfo.start)) {
          rightmostMatchInfo = {
            start: match.index,
            endInOriginal: match.index + masked.length,
            replacementLength: original.length
          };
        }
        processedBuffer = processedBuffer.slice(0, match.index) + original + processedBuffer.slice(match.index + masked.length);
      }
    }

    if (rightmostMatchInfo) {
      const adjustedEnd = rightmostMatchInfo.start + rightmostMatchInfo.replacementLength;
      const trailingLength = originalBufferLength - rightmostMatchInfo.endInOriginal;
      const splitPoint = adjustedEnd + trailingLength;
      const output = processedBuffer.slice(0, splitPoint);
      this.buffer = processedBuffer.slice(splitPoint);
      return output;
    }

    // Check for partial token at end of buffer (could be split across chunks)
    const partialMatchStart = this.buffer.search(/(?:sk-|ghp_|gho_|ghu_|ghs_|ghr_|AKIA|ASIA)[A-Za-z0-9_-]*$|\d{1,3}(?:\.\d{1,3})*\.?$|(?:[0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{0,4}:?$|[^\s@]+@[^\s@]*\.?[^\s@]*$/);
    const hasPartialMatch = partialMatchStart >= 0 && this.buffer.slice(partialMatchStart).length < this.maxMaskedLength;

    if (hasPartialMatch) {
      const output = processedBuffer.slice(0, partialMatchStart);
      this.buffer = processedBuffer.slice(partialMatchStart);
      return output;
    }

    const output = processedBuffer;
    this.buffer = '';
    return output;
  }

  flush() {
    if (this.closed) {
      return '';
    }

    this.closed = true;

    let result = this.buffer;
    const matches = [...result.matchAll(this.maskedPattern)];

    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      const masked = match[0];
      const original = this.session.lookupOriginal(masked);
      
      if (original) {
        result = result.slice(0, match.index) + original + result.slice(match.index + masked.length);
      }
    }

    this.buffer = '';
    return result;
  }

  isClosed() {
    return this.closed;
  }
}

export function createStreamingUnmasker(session, options = {}) {
  return new StreamingUnmasker(session, options);
}
