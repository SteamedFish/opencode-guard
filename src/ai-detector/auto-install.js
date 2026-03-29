import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default cache location for models
// Transformers.js uses HuggingFace hub cache, defaults to ~/.cache/huggingface
export const DEFAULT_MODEL_CACHE_DIR = process.env.HF_HOME || 
  join(process.env.HOME || process.env.USERPROFILE || '.', '.cache', 'huggingface');

/**
 * Get the plugin's node_modules directory
 * This is where we'll install optional dependencies
 */
function getPluginNodeModules() {
  // Go up from src/ai-detector/ to project root
  const projectRoot = join(__dirname, '..', '..', '..');
  return join(projectRoot, 'node_modules');
}

/**
 * Check if a package is available (installed)
 */
export async function isPackageAvailable(packageName) {
  try {
    await import(packageName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-install a package using npm
 * 
 * @param {string} packageName - Package to install
 * @param {Object} options - Installation options
 * @param {boolean} options.save - Whether to save to package.json (default: false)
 * @param {boolean} options.global - Whether to install globally (default: false)
 * @param {string} options.cwd - Working directory for installation
 * @returns {Promise<boolean>} - Whether installation succeeded
 */
export async function autoInstallPackage(packageName, options = {}) {
  const { save = false, global = false, cwd = process.cwd() } = options;
  
  try {
    console.log(`[opencode-guard] Auto-installing ${packageName}...`);
    
    const args = ['install', packageName];
    if (!save) args.push('--no-save');
    if (global) args.push('--global');
    
    // Use --legacy-peer-deps to avoid peer dependency conflicts
    args.push('--legacy-peer-deps');
    
    execSync(`npm ${args.join(' ')}`, {
      cwd,
      stdio: 'pipe', // Suppress output unless there's an error
      timeout: 120000, // 2 minute timeout
      env: {
        ...process.env,
        npm_config_loglevel: 'error', // Only show errors
      }
    });
    
    console.log(`[opencode-guard] Successfully installed ${packageName}`);
    return true;
  } catch (err) {
    console.warn(`[opencode-guard] Failed to auto-install ${packageName}: ${err.message}`);
    return false;
  }
}

/**
 * Ensure a package is available, auto-installing if necessary and enabled
 * 
 * @param {string} packageName - Package to ensure
 * @param {Object} options - Options
 * @param {boolean} options.autoInstall - Whether to auto-install if missing
 * @param {string} options.cwd - Working directory for installation
 * @returns {Promise<boolean>} - Whether package is available
 */
export async function ensurePackage(packageName, options = {}) {
  const { autoInstall = false, cwd = process.cwd() } = options;
  
  // First check if already available
  if (await isPackageAvailable(packageName)) {
    return true;
  }
  
  // If auto-install is disabled, just return false
  if (!autoInstall) {
    return false;
  }
  
  // Try to auto-install
  const installed = await autoInstallPackage(packageName, { cwd });
  
  // Check again if it's now available
  if (installed) {
    return await isPackageAvailable(packageName);
  }
  
  return false;
}

/**
 * Get model cache info for display
 */
export function getModelCacheInfo() {
  return {
    directory: DEFAULT_MODEL_CACHE_DIR,
    envVar: 'HF_HOME',
    note: 'Models are downloaded automatically on first use by @xenova/transformers'
  };
}
