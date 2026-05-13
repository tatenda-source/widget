import 'dotenv/config';

function required(name, fallback) {
  const v = process.env[name];
  if (v == null || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  corsOrigin: process.env.CORS_ORIGIN || '*',

  billerCode: required('BILLER_CODE', 'FAL'),
  defaultCurrency: required('DEFAULT_CURRENCY', 'USD'),

  billpay: {
    mode: (process.env.BILLPAY_MODE || 'mock').toLowerCase(),
    baseUrl: process.env.BILLPAY_BASE_URL || 'https://billpay.paynow.co.zw',
    user: process.env.BILLPAY_USER || '',
    pass: process.env.BILLPAY_PASS || '',
  },

  paynow: {
    integrationId: process.env.PAYNOW_INTEGRATION_ID || '',
    integrationKey: process.env.PAYNOW_INTEGRATION_KEY || '',
    resultUrl: process.env.PAYNOW_RESULT_URL || 'http://localhost:4000/api/webhooks/paynow-merchant',
    returnUrl: process.env.PAYNOW_RETURN_URL || 'http://localhost:4173/?status=return',
  },

  webhooks: {
    billpayBearer: process.env.BILLPAY_WEBHOOK_BEARER || '',
  },
};

if (config.billpay.mode !== 'mock' && config.billpay.mode !== 'live') {
  throw new Error(`BILLPAY_MODE must be 'mock' or 'live' — got '${config.billpay.mode}'`);
}
