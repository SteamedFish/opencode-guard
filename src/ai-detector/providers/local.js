import { AIProvider } from './base.js';

export class LocalAIProvider extends AIProvider {
  constructor(config = {}) {
    super(config);
    this.pipeline = null;
    // Default to PII-specific model instead of general NER or sentiment model
    this.modelName = config.model || 'joneauxedgar/pasteproof-pii-detector-v2';
    this.initialized = false;
  }

  async isAvailable() {
    try {
      await import('@xenova/transformers');
      return true;
    } catch {
      return false;
    }
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      const { pipeline } = await import('@xenova/transformers');
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
    // Map HuggingFace entity types to our standardized types
    // Supports both PII-specific models (PasteProof, Piiranha) and general NER models
    const typeMap = {
      // General NER models
      'B-PER': 'PERSON', 'I-PER': 'PERSON',
      'B-ORG': 'ORGANIZATION', 'I-ORG': 'ORGANIZATION',
      'B-LOC': 'LOCATION', 'I-LOC': 'LOCATION',
      'B-MISC': 'MISC', 'I-MISC': 'MISC',
      'PER': 'PERSON', 'ORG': 'ORGANIZATION',
      'LOC': 'LOCATION', 'MISC': 'MISC',
      
      // PasteProof PII Detector (joneauxedgar/pasteproof-pii-detector-v2)
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
      
      // Piiranha (iiiorg/piiranha-v1-detect-personal-information)
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
      'DATEOFBIRTH': 'DATE_OF_BIRTH'
    };
    
    return typeMap[hfType] || 'UNKNOWN';
  }
}
