/**
 * Mask IPv4 address - keep /16 prefix, mask host portion
 * Preserves network category (private/public) while masking host
 * @param {string} ip
 * @param {Function} rng
 * @returns {string}
 */
export function maskIPv4(ip, rng) {
  const parts = ip.split('.');
  if (parts.length !== 4) return ip;
  
  // Keep first two octets (/16 network prefix), mask last two (host)
  const maskedOctet3 = rng(0, 255);
  const maskedOctet4 = rng(1, 254);
  
  return `${parts[0]}.${parts[1]}.${maskedOctet3}.${maskedOctet4}`;
}

/**
 * Mask IPv6 address - keep /64 prefix, mask interface ID
 * Preserves network prefix while masking host identifier
 * @param {string} ip
 * @param {Function} rng
 * @returns {string}
 */
export function maskIPv6(ip, rng) {
  if (!ip.includes('::')) {
    // No compression - split normally
    const groups = ip.split(':');
    if (groups.length !== 8) return ip;
    
    const maskedInterfaceId = [];
    for (let i = 0; i < 4; i++) {
      const value = rng(0, 65535);
      maskedInterfaceId.push(value.toString(16).padStart(4, '0'));
    }
    
    return `${groups.slice(0, 4).join(':')}:${maskedInterfaceId.join(':')}`;
  }
  
  // Handle compressed notation (::)
  const [left, right] = ip.split('::');
  const leftGroups = left ? left.split(':') : [];
  const rightGroups = right ? right.split(':') : [];
  const missingGroups = 8 - leftGroups.length - rightGroups.length;
  
  // Keep the prefix groups as-is (preserve original formatting)
  const maskedInterfaceId = [];
  for (let i = 0; i < 4; i++) {
    const value = rng(0, 65535);
    maskedInterfaceId.push(value.toString(16).padStart(4, '0'));
  }
  
  // Combine: keep original left groups, add masked interface ID
  return `${leftGroups.join(':')}:${maskedInterfaceId.join(':')}`;
}

/**
 * Expand compressed IPv6 to full 8-group format
 * @param {string} ip
 * @returns {string}
 */
function expandIPv6(ip) {
  if (!ip.includes('::')) {
    // Already expanded or no compression
    return ip.split(':').map(g => g.padStart(4, '0')).join(':');
  }
  
  const [left, right] = ip.split('::');
  const leftGroups = left ? left.split(':') : [];
  const rightGroups = right ? right.split(':') : [];
  const missingGroups = 8 - leftGroups.length - rightGroups.length;
  
  const middleGroups = Array(missingGroups).fill('0000');
  const allGroups = [...leftGroups, ...middleGroups, ...rightGroups];
  
  return allGroups.map(g => g.padStart(4, '0')).join(':');
}

/**
 * Check if value is IPv4
 * @param {string} value
 * @returns {boolean}
 */
export function isIPv4(value) {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  
  return parts.every(part => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && String(num) === part;
  });
}

/**
 * Check if value is IPv6
 * @param {string} value
 * @returns {boolean}
 */
export function isIPv6(value) {
  // Must contain at least one colon and only hex digits/colons (and possibly % for zone)
  if (!value.includes(':')) return false;
  // Reject if it looks like IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) return false;
  
  // Basic IPv6 validation - simplified pattern
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$|^(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}$|^(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}$|^(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}$|^[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}$|^:(?::[0-9a-fA-F]{1,4}){1,7}$|^::$/;
  return ipv6Regex.test(value);
}
