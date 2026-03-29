import { sanitizeCategory } from './utils.js';

const BUILTIN = new Map([
  ['email', { pattern: String.raw`[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}`, flags: 'i', category: 'EMAIL', maskAs: 'email' }],
  ['phone', { pattern: String.raw`(?<!\d)1[3-9]\d{9}(?!\d)`, flags: '', category: 'PHONE', maskAs: 'pattern' }],
  ['china_phone', { pattern: String.raw`(?<!\d)1[3-9]\d{9}(?!\d)`, flags: '', category: 'CHINA_PHONE', maskAs: 'pattern' }],
  ['china_id', { pattern: String.raw`(?<!\d)\d{17}[\dXx](?!\d)`, flags: '', category: 'CHINA_ID', maskAs: 'pattern' }],
  ['uuid', { pattern: String.raw`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}`, flags: '', category: 'UUID', maskAs: 'uuid' }],
  ['ipv4', { pattern: String.raw`(?:\d{1,3}\.){3}\d{1,3}`, flags: '', category: 'IPV4', maskAs: 'ipv4' }],
  ['ipv6', { pattern: String.raw`(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|:(?::[0-9a-fA-F]{1,4}){1,7}|::`, flags: 'i', category: 'IPV6', maskAs: 'ipv6' }],
  ['mac', { pattern: String.raw`(?:[0-9a-f]{2}:){5}[0-9a-f]{2}`, flags: 'i', category: 'MAC', maskAs: 'mac_address' }],
  ['basic_auth_url', { pattern: String.raw`https?:\/\/[^:]+:[^@]+@[^\s]+`, flags: 'i', category: 'BASIC_AUTH_URL', maskAs: 'basic_auth_url' }],
  ['basic_auth_header', { pattern: String.raw`Basic\s+[A-Za-z0-9+/]{20,}=*`, flags: 'i', category: 'BASIC_AUTH_HEADER', maskAs: 'basic_auth_header' }],
  ['db_connection', { pattern: String.raw`(?:postgres|postgresql|mysql|mongodb|redis|amqp|mqtt|ldap):\/\/[^:]+:[^@]+@[^\s]+`, flags: 'i', category: 'DB_CONNECTION', maskAs: 'db_connection' }],
  ['db_connection_srv', { pattern: String.raw`mongodb\+srv:\/\/[^\s]+`, flags: 'i', category: 'DB_CONNECTION', maskAs: 'db_connection' }],
  ['generic_credential', { pattern: String.raw`(?:api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret|auth[_-]?token|master[_-]?key|private[_-]?key|signing[_-]?key|encryption[_-]?key|webhook[_-]?secret|database[_-]?url|connection[_-]?string)\s*[:=]\s*\S{8,}`, flags: 'i', category: 'GENERIC_CREDENTIAL', maskAs: 'generic_credential' }],
  ['password', { pattern: String.raw`(?:password|passwd|pwd)\s*[:=]\s*\S{8,}`, flags: 'i', category: 'PASSWORD', maskAs: 'password' }],
]);

export function buildPatternSet(patterns) {
  const raw = patterns && typeof patterns === 'object' ? patterns : {};
  
  const keywords = (raw.keywords || [])
    .map(k => {
      if (!k || typeof k !== 'object') return null;
      const value = String(k.value ?? '').trim();
      if (!value) return null;
      return {
        value,
        category: sanitizeCategory(k.category),
        maskAs: k.mask_as || 'pattern',
      };
    })
    .filter(Boolean);
  
  const regex = [];
  
  for (const r of (raw.regex || [])) {
    if (!r || typeof r !== 'object') continue;
    const pattern = String(r.pattern ?? '').trim();
    if (!pattern) continue;
    try {
      const flags = String(r.flags || '');
      regex.push({
        regex: new RegExp(pattern, flags.includes('g') ? flags : flags + 'g'),
        category: sanitizeCategory(r.category),
        maskAs: r.mask_as || 'pattern',
        pattern,
        flags,
      });
    } catch { }
  }
  
  for (const name of (raw.builtin || [])) {
    const builtin = BUILTIN.get(String(name).trim());
    if (builtin) {
      regex.push({
        regex: new RegExp(builtin.pattern, builtin.flags),
        category: builtin.category,
        maskAs: builtin.maskAs,
        pattern: builtin.pattern,
        flags: builtin.flags,
      });
    }
  }
  
  const exclude = new Set((raw.exclude || []).map(e => String(e)));
  
  return { keywords, regex, exclude };
}
