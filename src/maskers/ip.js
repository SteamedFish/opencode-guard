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
 * Preserves network prefix while masking host identifier.
 * Compressed (::) notation is expanded first; the output is always
 * emitted in full 8-group form so it is guaranteed to be a valid,
 * parseable IPv6 address.
 * @param {string} ip
 * @param {Function} rng
 * @returns {string}
 */
export function maskIPv6(ip, rng) {
  const randomGroup = () => rng(0, 65535).toString(16).padStart(4, '0');

  let groups;
  if (!ip.includes('::')) {
    // No compression - split normally
    groups = ip.split(':');
    if (groups.length !== 8) return ip;
  } else {
    // Handle compressed notation (::): expand to 8 groups
    const [left, right] = ip.split('::');
    // A second '::' or no right side at all means malformed input
    if (right === undefined || right.includes('::')) return ip;

    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const missingGroups = 8 - leftGroups.length - rightGroups.length;
    if (missingGroups < 0) return ip; // malformed: too many explicit groups

    groups = [...leftGroups, ...Array(missingGroups).fill('0000'), ...rightGroups];
  }

  // Keep the /64 prefix (first 4 groups, original formatting preserved),
  // randomize the interface ID (last 4 groups)
  const maskedInterfaceId = [];
  for (let i = 0; i < 4; i++) {
    maskedInterfaceId.push(randomGroup());
  }

  return `${groups.slice(0, 4).join(':')}:${maskedInterfaceId.join(':')}`;
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
