import { AIProvider } from './base.js';
import { ensurePackage } from '../auto-install.js';

const PACKAGE_NAME = '@huggingface/transformers';

/**
 * Build a whitespace-stripped view of `text` plus a map back to original
 * offsets. Used to locate entity spans whose detokenization altered
 * whitespace (e.g. sentencepiece dropping spaces: "Maple Hollow Drive" may
 * come back as "MapleHollow Drive").
 *
 * @param {string} text
 * @returns {{ stripped: string, origIndex: number[] }} stripped text and a
 *   map from stripped index to original index
 */
function buildStrippedView(text) {
  const chars = [];
  const origIndex = [];
  for (let i = 0; i < text.length; i++) {
    if (!/\s/.test(text[i])) {
      chars.push(text[i]);
      origIndex.push(i);
    }
  }
  return { stripped: chars.join(''), origIndex };
}

/**
 * Find `word` in the whitespace-stripped view (case-insensitive), at or after
 * original offset `from`. Returns the original [start, end) span covering the
 * match (including any interior whitespace), or null.
 *
 * @param {{ stripped: string, origIndex: number[] }} view
 * @param {string} word
 * @param {number} from - Minimum original offset (left-to-right invariant)
 * @returns {{ start: number, end: number } | null}
 */
function findStripped(view, word, from) {
  const needle = word.replace(/\s+/g, '').toLowerCase();
  if (!needle) return null;
  const haystack = view.stripped.toLowerCase();
  let pos = haystack.indexOf(needle);
  while (pos !== -1) {
    const start = view.origIndex[pos];
    const end = view.origIndex[pos + needle.length - 1] + 1;
    if (start >= from) return { start, end };
    pos = haystack.indexOf(needle, pos + 1);
  }
  return null;
}

export class LocalAIProvider extends AIProvider {
  constructor(config = {}) {
    super(config);
    this.pipeline = null;
    // Default: official ONNX conversion of Piiranha PII detector (the previous
    // default SoelMgd/bert-pii-detection ships no ONNX weights and cannot load
    // in Transformers.js at all).
    this.modelName = config.model || config.localModel || 'onnx-community/piiranha-v1-detect-personal-information-ONNX';
    this.autoInstall = config.autoInstallDeps || false;
    this.logger = config.logger || null;
    this.initialized = false;
    this.installAttempted = false;
  }

  async isAvailable() {
    try {
      await import(PACKAGE_NAME);
      return true;
    } catch {
      // Package not installed
      return false;
    }
  }

  async initialize() {
    if (this.initialized) return;
    
    // Try to ensure package is available (with auto-install if enabled)
    const packageAvailable = await ensurePackage(PACKAGE_NAME, {
      autoInstall: this.autoInstall && !this.installAttempted
    });
    
    this.installAttempted = true;
    
    if (!packageAvailable) {
      throw new Error(
        `${PACKAGE_NAME} is not installed. ` +
        `Install it with: npm install ${PACKAGE_NAME}\n` +
        `Or enable auto_install_deps in your config.`
      );
    }
    
    // Re-check availability after potential auto-install to verify module loads
    const canImport = await this.isAvailable();
    if (!canImport) {
      throw new Error(
        `${PACKAGE_NAME} was installed but cannot be loaded. ` +
        `Try restarting OpenCode.`
      );
    }
    
    try {
      const { pipeline, env } = await import(PACKAGE_NAME);
      // Standard HuggingFace mirror env var (same convention as huggingface_hub).
      // Useful where huggingface.co is unreachable; transformers.js v2 does not
      // read it natively, so apply it explicitly.
      if (process.env.HF_ENDPOINT) {
        env.remoteHost = process.env.HF_ENDPOINT.replace(/\/?$/, '/');
      }
      this.pipeline = await pipeline(
        'token-classification',
        this.modelName,
        { dtype: 'q8' }
      );
      
      this.initialized = true;
    } catch (err) {
      console.warn(`[opencode-guard] Failed to load local AI model: ${err.message}`);
      throw err;
    }
  }

  async detect(text) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Transformers.js (v2 and v3 alike) never populates char offsets
      // (start/end) on token-classification output, so aggregate tokens into
      // entity spans and resolve offsets by locating the decoded span text in
      // the original string ourselves.
      const results = await this.pipeline(text, { aggregation_strategy: 'simple' });

      const resolved = [];
      // Resolve spans strictly left-to-right and never rebind to an earlier
      // occurrence: masking the wrong instance would leak the flagged one.
      // TODO(fail-closed): when the model flags one of several identical
      // occurrences, masking all occurrences of that value (engine change)
      // would close the residual leak; left-to-right binding alone can bind
      // the wrong duplicate.
      let searchFrom = 0;
      // Lazily-built whitespace-stripped view for the detokenization fallback
      // (models may alter whitespace, e.g. "Maple Hollow" -> "MapleHollow").
      let strippedView = null;
      for (const entity of results) {
        const group = entity.entity_group ?? entity.entity;
        const word = (entity.word ?? '').trim();
        if (!word) continue;

        let start = text.indexOf(word, searchFrom);
        let end = start === -1 ? -1 : start + word.length;

        if (start === -1) {
          strippedView = strippedView ?? buildStrippedView(text);
          const hit = findStripped(strippedView, word, searchFrom);
          if (hit) {
            start = hit.start;
            end = hit.end;
          }
        }

        if (start === -1) {
          // Cannot mask what we cannot locate — drop (with observability).
          this.logger?.warn?.(`[opencode-guard] AI-detected span not locatable in text, dropped: ${JSON.stringify(word)}`);
          continue;
        }
        searchFrom = end;

        resolved.push({
          type: this._mapEntityType(group),
          value: text.slice(start, end),
          confidence: entity.score,
          start,
          end
        });
      }
      return resolved;
    } catch (err) {
      console.warn(`[opencode-guard] AI detection failed: ${err.message}`);
      return [];
    }
  }

  _mapEntityType(hfType) {
    const typeMap = {
      'B-PER': 'PERSON', 'I-PER': 'PERSON',
      'B-ORG': 'ORGANIZATION', 'I-ORG': 'ORGANIZATION',
      'B-LOC': 'LOCATION', 'I-LOC': 'LOCATION',
      'B-MISC': 'MISC', 'I-MISC': 'MISC',
      'PER': 'PERSON', 'ORG': 'ORGANIZATION',
      'LOC': 'LOCATION', 'MISC': 'MISC',
      
      // PasteProof PII Detector
      'B-VUL_JXM': 'CREDENTIAL', 'I-VUL_JXM': 'CREDENTIAL',
      'VUL_JXM': 'CREDENTIAL',
      'B-EMAIL': 'EMAIL', 'I-EMAIL': 'EMAIL',
      'EMAIL': 'EMAIL',
      'B-CREDIT_CARD': 'CREDIT_CARD', 'I-CREDIT_CARD': 'CREDIT_CARD',
      'CREDIT_CARD': 'CREDIT_CARD',
      'B-PHONE_NUM': 'PHONE', 'I-PHONE_NUM': 'PHONE',
      'PHONE_NUM': 'PHONE',
      'B-ACCOUNT_NUM': 'ACCOUNT', 'I-ACCOUNT_NUM': 'ACCOUNT',
      'ACCOUNT_NUM': 'ACCOUNT',
      'B-API_KEY': 'API_KEY', 'I-API_KEY': 'API_KEY',
      'API_KEY': 'API_KEY',
      
      // Piiranha
      'B-PASSWORD': 'PASSWORD', 'I-PASSWORD': 'PASSWORD',
      'PASSWORD': 'PASSWORD',
      'B-USERNAME': 'USERNAME', 'I-USERNAME': 'USERNAME',
      'USERNAME': 'USERNAME',
      'B-CREDITCARDNUMBER': 'CREDIT_CARD', 'I-CREDITCARDNUMBER': 'CREDIT_CARD',
      'CREDITCARDNUMBER': 'CREDIT_CARD',
      'B-SOCIALNUM': 'SSN', 'I-SOCIALNUM': 'SSN',
      'SOCIALNUM': 'SSN',
      'B-DRIVERLICENSENUM': 'DRIVER_LICENSE', 'I-DRIVERLICENSENUM': 'DRIVER_LICENSE',
      'DRIVERLICENSENUM': 'DRIVER_LICENSE',
      'B-IDCARDNUM': 'ID_CARD', 'I-IDCARDNUM': 'ID_CARD',
      'IDCARDNUM': 'ID_CARD',
      'B-TAXNUM': 'TAX_ID', 'I-TAXNUM': 'TAX_ID',
      'TAXNUM': 'TAX_ID',
      'B-GIVENNAME': 'PERSON', 'I-GIVENNAME': 'PERSON',
      'GIVENNAME': 'PERSON',
      'B-SURNAME': 'PERSON', 'I-SURNAME': 'PERSON',
      'SURNAME': 'PERSON',
      'B-TELEPHONENUM': 'PHONE', 'I-TELEPHONENUM': 'PHONE',
      'TELEPHONENUM': 'PHONE',
      'B-STREET': 'STREET_ADDRESS', 'I-STREET': 'STREET_ADDRESS',
      'STREET': 'STREET_ADDRESS',
      'B-CITY': 'CITY', 'I-CITY': 'CITY',
      'CITY': 'CITY',
      'B-BUILDINGNUM': 'BUILDING_NUMBER', 'I-BUILDINGNUM': 'BUILDING_NUMBER',
      'BUILDINGNUM': 'BUILDING_NUMBER',
      'B-ZIPCODE': 'ZIPCODE', 'I-ZIPCODE': 'ZIPCODE',
      'ZIPCODE': 'ZIPCODE',
      'B-ACCOUNTNUM': 'ACCOUNT', 'I-ACCOUNTNUM': 'ACCOUNT',
      'ACCOUNTNUM': 'ACCOUNT',
      'B-DATEOFBIRTH': 'DATE_OF_BIRTH', 'I-DATEOFBIRTH': 'DATE_OF_BIRTH',
      'DATEOFBIRTH': 'DATE_OF_BIRTH',
      
      // AI4Privacy / SoelMgd PII categories (56 entity types)
      // (PASSWORD/USERNAME/EMAIL/CREDIT_CARD/CITY/API_KEY already mapped above)
      'B-PHONE': 'PHONE', 'I-PHONE': 'PHONE',
      'PHONE': 'PHONE',
      'B-IP_ADDRESS': 'IP_ADDRESS', 'I-IP_ADDRESS': 'IP_ADDRESS',
      'IP_ADDRESS': 'IP_ADDRESS',
      'B-MAC_ADDRESS': 'MAC_ADDRESS', 'I-MAC_ADDRESS': 'MAC_ADDRESS',
      'MAC_ADDRESS': 'MAC_ADDRESS',
      'B-URL': 'URL', 'I-URL': 'URL',
      'URL': 'URL',
      'B-BANK_ACCOUNT': 'BANK_ACCOUNT', 'I-BANK_ACCOUNT': 'BANK_ACCOUNT',
      'BANK_ACCOUNT': 'BANK_ACCOUNT',
      'B-SSN': 'SSN', 'I-SSN': 'SSN',
      'SSN': 'SSN',
      'B-DATE_OF_BIRTH': 'DATE_OF_BIRTH', 'I-DATE_OF_BIRTH': 'DATE_OF_BIRTH',
      'DATE_OF_BIRTH': 'DATE_OF_BIRTH',
      'B-ADDRESS': 'ADDRESS', 'I-ADDRESS': 'ADDRESS',
      'ADDRESS': 'ADDRESS',
      'B-ZIP_CODE': 'ZIPCODE', 'I-ZIP_CODE': 'ZIPCODE',
      'ZIP_CODE': 'ZIPCODE',
      'B-COUNTRY': 'COUNTRY', 'I-COUNTRY': 'COUNTRY',
      'COUNTRY': 'COUNTRY',
      'B-SECRET_KEY': 'SECRET_KEY', 'I-SECRET_KEY': 'SECRET_KEY',
      'SECRET_KEY': 'SECRET_KEY',
      'B-ACCESS_TOKEN': 'ACCESS_TOKEN', 'I-ACCESS_TOKEN': 'ACCESS_TOKEN',
      'ACCESS_TOKEN': 'ACCESS_TOKEN',
      'B-AUTH_TOKEN': 'AUTH_TOKEN', 'I-AUTH_TOKEN': 'AUTH_TOKEN',
      'AUTH_TOKEN': 'AUTH_TOKEN'
    };
    
    return typeMap[hfType] || 'UNKNOWN';
  }
}
