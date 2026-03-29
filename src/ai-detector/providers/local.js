import { AIProvider } from './base.js';
import { ensurePackage } from '../auto-install.js';

const PACKAGE_NAME = '@xenova/transformers';

export class LocalAIProvider extends AIProvider {
  constructor(config = {}) {
    super(config);
    this.pipeline = null;
    this.modelName = config.model || config.localModel || 'SoelMgd/bert-pii-detection';
    this.autoInstall = config.autoInstallDeps || false;
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
      const { pipeline } = await import(PACKAGE_NAME);
      this.pipeline = await pipeline(
        'token-classification',
        this.modelName,
        { quantized: true }
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
      const results = await this.pipeline(text);
      
      return results.map(entity => ({
        type: this._mapEntityType(entity.entity),
        value: entity.word,
        confidence: entity.score,
        start: entity.start,
        end: entity.end
      }));
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
      'B-PASSWORD': 'PASSWORD', 'I-PASSWORD': 'PASSWORD',
      'PASSWORD': 'PASSWORD',
      'B-USERNAME': 'USERNAME', 'I-USERNAME': 'USERNAME',
      'USERNAME': 'USERNAME',
      'B-EMAIL': 'EMAIL', 'I-EMAIL': 'EMAIL',
      'EMAIL': 'EMAIL',
      'B-PHONE': 'PHONE', 'I-PHONE': 'PHONE',
      'PHONE': 'PHONE',
      'B-IP_ADDRESS': 'IP_ADDRESS', 'I-IP_ADDRESS': 'IP_ADDRESS',
      'IP_ADDRESS': 'IP_ADDRESS',
      'B-MAC_ADDRESS': 'MAC_ADDRESS', 'I-MAC_ADDRESS': 'MAC_ADDRESS',
      'MAC_ADDRESS': 'MAC_ADDRESS',
      'B-URL': 'URL', 'I-URL': 'URL',
      'URL': 'URL',
      'B-CREDIT_CARD': 'CREDIT_CARD', 'I-CREDIT_CARD': 'CREDIT_CARD',
      'CREDIT_CARD': 'CREDIT_CARD',
      'B-BANK_ACCOUNT': 'BANK_ACCOUNT', 'I-BANK_ACCOUNT': 'BANK_ACCOUNT',
      'BANK_ACCOUNT': 'BANK_ACCOUNT',
      'B-SSN': 'SSN', 'I-SSN': 'SSN',
      'SSN': 'SSN',
      'B-DATE_OF_BIRTH': 'DATE_OF_BIRTH', 'I-DATE_OF_BIRTH': 'DATE_OF_BIRTH',
      'DATE_OF_BIRTH': 'DATE_OF_BIRTH',
      'B-ADDRESS': 'ADDRESS', 'I-ADDRESS': 'ADDRESS',
      'ADDRESS': 'ADDRESS',
      'B-CITY': 'CITY', 'I-CITY': 'CITY',
      'CITY': 'CITY',
      'B-ZIP_CODE': 'ZIPCODE', 'I-ZIP_CODE': 'ZIPCODE',
      'ZIP_CODE': 'ZIPCODE',
      'B-COUNTRY': 'COUNTRY', 'I-COUNTRY': 'COUNTRY',
      'COUNTRY': 'COUNTRY',
      'B-API_KEY': 'API_KEY', 'I-API_KEY': 'API_KEY',
      'API_KEY': 'API_KEY',
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
