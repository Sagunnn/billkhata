export const APP_NAME = 'BillKhata';

export const CATEGORIES = [
  'Food & Dining',
  'Groceries',
  'Medicine',
  'Utilities & Telecom',
  'Transport',
  'Retail/Shopping',
  'Business Expense',
  'Government/Public',
  'Other',
];

// Bills the IRD program does not accept (business purchases, government bodies,
// phone/internet/electricity, vehicles/transport, air tickets).
export const EXCLUDED_CATEGORIES = [
  'Utilities & Telecom',
  'Transport',
  'Business Expense',
  'Government/Public',
];

export const PAYMENT = {
  CASH: 'Cash',
  DIGITAL: 'Digital QR / Card',
  CBMS: 'CBMS Big Mart',
};
export const PAYMENT_METHODS = [PAYMENT.CASH, PAYMENT.DIGITAL, PAYMENT.CBMS];

export const IRD_STATUS = {
  NOT_APPLIED: 'Not Applied',
  APPLIED: 'Applied - Coupon Saved',
  AUTO: 'Auto-Entered via QR',
  INELIGIBLE: 'Ineligible',
};
export const IRD_STATUSES = Object.values(IRD_STATUS);

// prize.ird.gov.np rejects amounts below NPR 100.00 ("must be at least NPR 100.00"),
// so a bill of exactly Rs. 100 is accepted.
export const IRD_MIN_AMOUNT = 100;
export const IRD_PORTAL_URL = 'https://prize.ird.gov.np';

export const REGIONS = { NEPAL: 'Nepal', INTL: 'International' };

export const OCR_ENGINES = { TESSERACT: 'tesseract', VISION: 'vision' };
export const VISION_PROVIDERS = {
  gemini: { label: 'Google Gemini', defaultModel: 'gemini-2.5-flash', keyHint: 'AIza…' },
  openai: { label: 'OpenAI', defaultModel: 'gpt-4.1-mini', keyHint: 'sk-…' },
  anthropic: { label: 'Anthropic Claude', defaultModel: 'claude-opus-5-5', keyHint: 'sk-ant-…' },
};

export const MAX_IMAGE_BYTES = 300 * 1024;
