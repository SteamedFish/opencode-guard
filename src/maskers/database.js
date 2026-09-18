import { randomString } from '../utils.js';

const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-.';
const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Mask database connection string
 * Supports common formats: postgresql://, mysql://, mongodb://, redis://, etc.
 * @param {string} connString
 * @param {Function} rng
 * @returns {string}
 */
export function maskDatabaseConn(connString, rng) {
  // Pattern: protocol://username:password@host:port/database?params
  // Case-insensitive: isDatabaseConn() and the detector both use the `i` flag,
  // so mixed-case schemes (e.g. PostgreSQL://) must parse here too.
  const match = connString.match(/^([a-z+]+:\/\/)([^:]+):([^@]*)@(.+)$/i);
  if (!match) return connString;

  const [, protocol, username, password, rest] = match;
  const maskedUsername = randomString(rng, username.length, URL_SAFE);
  // Password might be empty
  const maskedPassword = password.length > 0
    ? randomString(rng, password.length, ALPHANUMERIC)
    : '';

  return `${protocol}${maskedUsername}:${maskedPassword}@${rest}`;
}

/**
 * Check if value is a database connection string with credentials
 * @param {string} value
 * @returns {boolean}
 */
export function isDatabaseConn(value) {
  // Common database protocols with credentials
  const dbProtocols = /^(postgresql|postgres|mysql|mongodb(\+srv)?|redis|mysql2|mariadb|sqlite|mssql|oracle):\/\//i;
  return dbProtocols.test(value) && /:[^@]*@/.test(value);
}
