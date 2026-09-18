import { appendFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';

/**
 * Expand a leading `~` to the user's home directory. Non-string or empty
 * input returns an empty string.
 *
 * @param {string} p - Path, possibly starting with `~`
 * @returns {string} Expanded path
 */
function expandHome(p) {
  if (typeof p !== 'string' || !p) return '';
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    return join(homedir(), p.slice(1));
  }
  return p;
}

/**
 * Format log arguments into a single line, similar to how console joins
 * multiple arguments: strings are used as-is and joined with spaces,
 * non-strings are inspected.
 *
 * @param {Array<*>} args - Log arguments
 * @returns {string} Formatted line (no trailing newline)
 */
function formatArgs(args) {
  return args
    .map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 3, breakLength: Infinity })))
    .join(' ');
}

/**
 * Create a debug logger that mirrors console output and (optionally)
 * appends the same lines to a debug file with ISO timestamps.
 *
 * File appends are fire-and-forget: any write failure (unwritable path,
 * full disk, etc.) is silently swallowed and must never break the plugin.
 *
 * @param {Object} [options]
 * @param {boolean} [options.debug=false] - Mirror console.log/warn
 * @param {string} [options.debugFile=''] - Optional log file path (used only when debug is on)
 * @returns {{ enabled: boolean, fileEnabled: boolean, debugFile: string, log: Function, warn: Function }}
 */
export function createLogger({ debug = false, debugFile = '' } = {}) {
  const enabled = Boolean(debug);
  const file = expandHome(debugFile);
  const fileEnabled = enabled && Boolean(file);

  const write = (level, args) => {
    if (!enabled) return;
    try {
      const line = formatArgs(args);
      (level === 'warn' ? console.warn : console.log)(line);
      if (fileEnabled) {
        appendFile(file, `${new Date().toISOString()} ${line}\n`).catch(() => {});
      }
    } catch {
      // Logging must never throw
    }
  };

  return {
    enabled,
    fileEnabled,
    debugFile: file,
    log: (...args) => write('log', args),
    warn: (...args) => write('warn', args),
  };
}
