import { appendFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
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
 * Debug file hardening:
 * - The file is truncated on logger init (fresh file per process start, so
 *   stale secrets from previous runs do not accumulate).
 * - New files are created with mode 0600 (owner-only read/write).
 * - Relative paths are rejected (file logging disabled with a warning) to
 *   avoid accidentally writing secrets into whatever the process CWD is.
 * - When file logging activates, an unconditional console.warn states the
 *   path and that the file contains plaintext secrets.
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
  let file = expandHome(debugFile);

  if (enabled && file && !isAbsolute(file)) {
    console.warn(
      `[opencode-guard] debug_file must be an absolute path (got "${debugFile}"); file logging disabled.`
    );
    file = '';
  }

  const fileEnabled = enabled && Boolean(file);

  // Write queue: truncates the file first, then serializes appends so the
  // initial truncate cannot wipe lines logged immediately after init.
  let queue = Promise.resolve();
  if (fileEnabled) {
    console.warn(
      `[opencode-guard] debug file logging ACTIVE: ${file} — this file contains PLAINTEXT SECRETS ` +
      '(masked→original mappings). It is truncated on startup and created with mode 0600. ' +
      'Delete it after debugging.'
    );
    queue = writeFile(file, '', { mode: 0o600 }).catch(() => {});
  }

  const write = (level, args) => {
    if (!enabled) return;
    try {
      const line = formatArgs(args);
      (level === 'warn' ? console.warn : console.log)(line);
      if (fileEnabled) {
        queue = queue
          .then(() => appendFile(file, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 }))
          .catch(() => {});
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
