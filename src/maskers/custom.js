import { randomString } from '../utils.js';

const CHAR_SETS = {
  alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  numeric: '0123456789',
  hex: '0123456789abcdef',
  hex_upper: '0123456789ABCDEF',
  alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
};

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';

/**
 * Create a custom masker from config
 * @param {Object} config
 * @returns {Function} - (value, rng) => maskedValue
 */
export function createCustomMasker(config) {
  const type = config?.type || 'pattern_preserving';

  switch (type) {
    case 'prefixed_token':
      return createPrefixedTokenMasker(config);
    case 'pattern_preserving':
      return createPatternPreservingMasker(config);
    case 'fixed_length':
      return createFixedLengthMasker(config);
    case 'regex':
      return createRegexMasker(config);
    default:
      throw new Error(`Unknown custom masker type: ${type}`);
  }
}

function createPrefixedTokenMasker(config) {
  const prefix = config.prefix || '';
  const suffixChars = CHAR_SETS[config.suffix_chars] || CHAR_SETS.alphanumeric;

  return (value, rng) => {
    const actualSuffixLength = Math.max(0, value.length - prefix.length);
    const suffix = randomString(rng, actualSuffixLength, suffixChars);
    return `${prefix}${suffix}`;
  };
}

function createPatternPreservingMasker(config) {
  const charSets = config.char_sets || { uppercase: true, lowercase: true, digits: true };

  const getCharSet = (char) => {
    if (/[a-z]/.test(char) && charSets.lowercase) return CHAR_SETS.lower;
    if (/[A-Z]/.test(char) && charSets.uppercase) return CHAR_SETS.upper;
    if (/[0-9]/.test(char) && charSets.digits) return CHAR_SETS.numeric;
    if (charSets.special && charSets.special.includes(char)) return null;
    return CHAR_SETS.alphanumeric;
  };

  return (value, rng) => {
    return Array.from(value).map(char => {
      const charSet = getCharSet(char);
      if (charSet === null) return char;
      return randomString(rng, 1, charSet);
    }).join('');
  };
}

function createFixedLengthMasker(config) {
  const length = config.length || 16;
  const prefix = config.prefix || '';
  const chars = CHAR_SETS[config.chars] || CHAR_SETS.alphanumeric;
  const suffixLength = Math.max(0, length - prefix.length);

  return (value, rng) => {
    const suffix = randomString(rng, suffixLength, chars);
    return `${prefix}${suffix}`;
  };
}

function createRegexMasker(config) {
  // Validate the pattern at init time and fail with a clear config error
  // (including the offending pattern) instead of an opaque SyntaxError
  let pattern;
  try {
    pattern = new RegExp(config.pattern);
  } catch (err) {
    throw new Error(`Invalid regex pattern for custom masker (type: 'regex'): ${JSON.stringify(config.pattern)} — ${err.message}`);
  }
  const replaceGroups = config.replace_groups || [1];
  const maskChar = config.mask_char || '*';

  return (value, rng) => {
    return value.replace(pattern, (match, ...rest) => {
      // With named capture groups the callback gets an extra trailing
      // `groups` object: (match, ...captures, offset, string, groups?).
      // Pop it off so capture-group indexing below stays correct.
      if (rest.length > 0 && typeof rest[rest.length - 1] === 'object' && rest[rest.length - 1] !== null) {
        rest.pop();
      }
      // rest is now [capture1..captureN, offset, string]
      const captures = rest.slice(0, -2);

      // Rebuild the match left-to-right, masking the configured groups by
      // their position inside the match. The cursor advances past EVERY
      // located group (masked or not) so that when several groups share
      // identical text, each is found at its own position.
      let result = '';
      let cursor = 0;
      for (let i = 0; i < captures.length; i++) {
        const group = captures[i];
        // Unmatched optional groups are undefined - nothing to locate
        if (group === undefined || group === '') continue;
        const idx = match.indexOf(group, cursor);
        if (idx === -1) continue; // defensive: cannot locate group text
        if (replaceGroups.includes(i + 1)) {
          result += match.slice(cursor, idx) + maskChar.repeat(group.length);
        } else {
          result += match.slice(cursor, idx + group.length);
        }
        cursor = idx + group.length;
      }
      result += match.slice(cursor);
      return result;
    });
  };
}

/**
 * Registry for custom maskers loaded from config
 */
export class CustomMaskerRegistry {
  constructor() {
    this.maskers = new Map();
  }

  /**
   * Register a custom masker
   * @param {string} name
   * @param {Function} masker - (value, rng) => maskedValue
   */
  register(name, masker) {
    this.maskers.set(name, masker);
  }

  /**
   * Get a masker by name
   * @param {string} name
   * @returns {Function|undefined}
   */
  get(name) {
    return this.maskers.get(name);
  }

  /**
   * Check if a masker exists
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this.maskers.has(name);
  }

  /**
   * Load maskers from config object
   * @param {Object} config - { name: { type, ...options } }
   */
  loadFromConfig(config) {
    for (const [name, maskerConfig] of Object.entries(config)) {
      const masker = createCustomMasker(maskerConfig);
      this.register(name, masker);
    }
  }

  /**
   * Get all registered masker names
   * @returns {string[]}
   */
  getNames() {
    return Array.from(this.maskers.keys());
  }

  /**
   * Clear all registered maskers
   */
  clear() {
    this.maskers.clear();
  }
}
