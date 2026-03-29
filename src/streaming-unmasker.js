export class StreamingUnmasker {
  constructor(session, options = {}) {
    this.session = session;
    this.maxMaskedLength = options.maxMaskedLength || 128;
    this.maskedPattern = options.maskedPattern || /msk-[a-z0-9]{16,64}/g;
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

    const partialMatchStart = this.buffer.search(/msk-[a-z0-9]*$/);
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
