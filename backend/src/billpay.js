import axios from 'axios';
import { config } from './config.js';
import { store } from './store.js';

/**
 * BillPay Vendor API client (per v1.33 spec).
 *
 * - In `live` mode: HTTP basic auth against config.billpay.baseUrl.
 * - In `mock` mode: short-circuits with realistic responses from the
 *   in-memory store so the demo runs without real credentials.
 *
 * Method names mirror the spec endpoints for grep-ability.
 */
function buildLiveClient() {
  return axios.create({
    baseURL: config.billpay.baseUrl,
    timeout: 60_000,
    auth: {
      username: config.billpay.user,
      password: config.billpay.pass,
    },
    headers: { 'Content-Type': 'application/json' },
  });
}

const live = config.billpay.mode === 'live' ? buildLiveClient() : null;

function billPayReference(billerCode = config.billerCode) {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${billerCode}-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}`;
}

// ────────────────────────────────────────────────────────────
// Read endpoints
// ────────────────────────────────────────────────────────────

async function listBillers(billerCodes) {
  if (live) {
    const url = billerCodes?.length
      ? `/api/payment/ListBillers?billerCodes=${billerCodes.join(',')}`
      : `/api/payment/ListBillers`;
    const { data } = await live.get(url);
    return data;
  }
  // Mock: synthesize a single Falcon biller from the seed.
  const products = store.campaigns.list().map((c) => ({
    Code: c.code,
    Name: c.name,
    Description: c.description,
    Price: c.priceFixed ?? null,
    Department: null,
    RequiresForex: c.requiresForex,
    ReturnsVouchers: false,
    IconUrl: c.iconUrl,
    LogoUrl: c.logoUrl,
    PrePurchaseInstructions: null,
    PostPurchaseInstructions: c.postPurchaseInstructions ?? null,
    AmountFieldLabel: 'Donation amount',
    AmountFieldDesc: 'How much would you like to give?',
    MinAmount: c.minAmount ?? 1,
    MaxAmount: c.maxAmount ?? null,
    NewProduct: false,
    InvoiceTitle: `${c.name} — donation`,
    Enabled: c.enabled,
    AuthAmountMandated: c.priceFixed ? true : null,
    AllowSpecifyQuantity: false,
    MetadataFields: [],
  }));
  return [{
    Code: config.billerCode,
    Name: 'Falcon College',
    Description: 'Old Hawks Fund — institutional giving by use case.',
    IconUrl: 'https://falcongiving.paynow.co.zw/crest.svg',
    LogoUrl: 'https://falcongiving.paynow.co.zw/wordmark.svg',
    ReferencePrefix: config.billerCode,
    Enabled: true,
    MemberNumberFieldDesc: 'Use your alumni email — receipts are sent here.',
    MemberNumberFieldLabel: 'Email address',
    MemberNumberFieldRegex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
    AllowMultipleProductsPerPayment: false,
    MetaTitle: 'Falcon College — Old Hawks Fund',
    MetaDescription: 'A programmable giving initiative on Paynow rails.',
    Products: products,
    VendorMustInvoicePayments: true,
  }];
}

async function getTargetStats({ billerCode = config.billerCode, currency = config.defaultCurrency } = {}) {
  if (live) {
    const { data } = await live.get(
      `/api/payment/TargetStats?billercode=${billerCode}&currency=${currency}`
    );
    return data;
  }
  // Mock — sum across all campaigns for the biller-level stat.
  const campaigns = store.campaigns.list().filter((c) => c.currency === currency);
  return {
    TargetAmount: campaigns.reduce((s, c) => s + c.goal, 0),
    TargetUnits: campaigns.length,
    TargetAchievedSinceDate: '2026-01-01T00:00:00Z',
    TargetAchievedAmount: campaigns.reduce((s, c) => s + c.raised, 0),
    TargetAchievedUnits: 0,
    PayerCount: campaigns.reduce((s, c) => s + c.donors, 0),
  };
}

async function getFeed({ billerCode = config.billerCode, currency = config.defaultCurrency, before } = {}) {
  if (live) {
    const q = new URLSearchParams({ billercode: billerCode, currency });
    if (before) q.set('before', String(before));
    const { data } = await live.get(`/api/payment/feed?${q}`);
    return data;
  }
  // Mock — return last 20 from store, ignoring `before` for simplicity.
  return store.feed.list().slice(0, 20).map((entry) => ({
    Date: entry.date,
    MemberNumber: entry.memberNumber,
    Amount: entry.amount,
    MetaData: [
      { Key: 'ProductCode', Value: entry.productCode },
      { Key: 'ProductName', Value: entry.productName },
      { Key: 'DonorDisplayName', Value: entry.donorDisplayName },
    ],
  }));
}

async function getMember({ billerCode = config.billerCode, memberNumber }) {
  if (live) {
    const { data } = await live.get(
      `/api/payment/member?billerCode=${billerCode}&memberNumber=${encodeURIComponent(memberNumber)}`
    );
    return data;
  }
  return {
    ResultCode: 1,
    Narration: '',
    TechnicalNarration: '',
    AuthData: {
      MemberName: memberNumber.split('@')[0] || 'Donor',
      AccountDetails: { Type: 'Old Hawk' },
      AccountBalances: {},
    },
  };
}

// ────────────────────────────────────────────────────────────
// Payment lifecycle (AUTH / PAY / STATUS / RETRY)
// ────────────────────────────────────────────────────────────

async function process({ action, reference, memberNumber, products, totalAmount, payerDetails }) {
  const payload = {
    Action: action,
    BillerCode: config.billerCode,
    Reference: reference,
    MemberNumber: memberNumber,
    Products: products,
    TotalAmount: totalAmount,
    PayerDetails: payerDetails,
  };

  if (live) {
    const { data } = await live.post('/api/payment/process', payload);
    return data;
  }

  // ── mock ─────────────────────────────────────────────────
  // STATUS doesn't carry products — handle it before product lookup.
  if (action === 'STATUS') {
    const donation = store.donations.get(reference);
    if (!donation) {
      return { Action: 'Status', Reference: reference, Status: 'Failed', Narration: 'Unknown reference.' };
    }
    return {
      Action: 'Status',
      BillerCode: config.billerCode,
      Reference: reference,
      Status: donation.status,
      TotalAmount: donation.amount,
      BillPayReference: donation.billPayReference || null,
      BillerPaymentReference: donation.billerPaymentReference || null,
      Currency: donation.currency,
    };
  }

  const campaign = products?.[0] ? store.campaigns.byCode(products[0].Code) : null;
  if (!campaign) {
    return {
      Action: action,
      BillerCode: config.billerCode,
      Reference: reference,
      Status: 'Failed',
      Narration: 'Unknown product on this biller.',
      TechnicalNarration: `Product ${products?.[0]?.Code} not found in mock store.`,
    };
  }

  const billerPaymentReference = `BPR-${Date.now()}`;

  if (action === 'AUTH') {
    return {
      Action: 'Auth',
      BillerCode: config.billerCode,
      Reference: reference,
      MemberNumber: memberNumber,
      Products: products.map((p) => ({
        ...p,
        Name: campaign.name,
        Price: totalAmount,
      })),
      TotalAmount: totalAmount,
      Status: 'Authorized',
      MemberName: memberNumber.split('@')[0] || 'Donor',
      BillPayReference: reference,
      AuthData: {
        MemberName: memberNumber.split('@')[0] || 'Donor',
        AccountDetails: { Campaign: campaign.name },
      },
    };
  }

  if (action === 'PAY') {
    // commit to store
    const donation = store.donations.get(reference);
    if (donation) {
      donation.status = 'Paid';
      donation.paidAt = new Date().toISOString();
      donation.billPayReference = reference;
      donation.billerPaymentReference = billerPaymentReference;
      donation.walletDebitReference = `D${Math.floor(Math.random() * 100000)}`;
      donation.vendorInvoiceReference = `INV-${Date.now()}`;
      donation.vendorFiscalSignature = 'mock-fiscal-signature';
      donation.vendorFiscalMetadata = 'mock-fiscal-metadata';
      store.campaigns.recordDonation(campaign.code, totalAmount, {
        donorDisplayName: donation.donor?.anonymous ? 'Anonymous' : donation.donor?.name || 'An Old Hawk',
        memberNumber,
      });
    }

    return {
      Action: 'Pay',
      BillerCode: config.billerCode,
      Reference: reference,
      MemberNumber: memberNumber,
      Products: products.map((p) => ({ ...p, Name: campaign.name })),
      TotalAmount: totalAmount,
      Status: 'Paid',
      MemberName: memberNumber.split('@')[0] || 'Donor',
      BillerPaymentReference: billerPaymentReference,
      BillPayReference: reference,
      Currency: campaign.currency,
      WalletDebitReference: `D${Math.floor(Math.random() * 100000)}`,
      WalletBalanceAfterDebit: 100000 - totalAmount,
      VendorInvoiceReference: `INV-${Date.now()}`,
      VendorFiscalSignature: 'mock-fiscal-signature',
      VendorFiscalMetadata: 'mock-fiscal-metadata',
      AuthData: {
        MemberName: memberNumber.split('@')[0] || 'Donor',
        AccountDetails: { Campaign: campaign.name },
      },
      PaymentData: {
        DisplayData: {
          Campaign: campaign.name,
          Acknowledgement: 'Thank you. Sic itur ad astra.',
        },
        ReceiptHtml: [],
        ReceiptSmses: [],
      },
    };
  }

  if (action === 'STATUS') {
    const donation = store.donations.get(reference);
    if (!donation) {
      return { Action: 'Status', Reference: reference, Status: 'Failed', Narration: 'Unknown reference.' };
    }
    return {
      Action: 'Status',
      BillerCode: config.billerCode,
      Reference: reference,
      Status: donation.status,
      TotalAmount: donation.amount,
      BillPayReference: donation.billPayReference || null,
      BillerPaymentReference: donation.billerPaymentReference || null,
      Currency: donation.currency,
    };
  }

  return { Action: action, Reference: reference, Status: 'Failed', Narration: 'Unsupported action in mock.' };
}

// ────────────────────────────────────────────────────────────
// Reversals
// ────────────────────────────────────────────────────────────

async function reverse({ originalReference, reference }) {
  if (live) {
    const { data } = await live.post('/api/payment/reverse', { OriginalReference: originalReference, Reference: reference });
    return data;
  }
  const donation = store.donations.get(originalReference);
  if (!donation) {
    return { OriginalReference: originalReference, Reference: reference, ErrorCode: 1, Narration: 'Original payment not found.' };
  }
  if (donation.status === 'Reversed') {
    return { OriginalReference: originalReference, Reference: reference, ErrorCode: 5, Narration: 'Original payment is already refunded.' };
  }
  donation.status = 'Reversed';
  donation.reversedAt = new Date().toISOString();
  donation.reversalReference = reference;
  return {
    OriginalReference: originalReference,
    Reference: reference,
    ErrorCode: 0,
    Narration: '',
    TechnicalNarration: '',
    BillpayReference: `R-${config.billerCode}-${Date.now()}`,
    BillerReference: `RVR-${Date.now()}`,
  };
}

export const billpay = {
  mode: config.billpay.mode,
  listBillers,
  getTargetStats,
  getFeed,
  getMember,
  process,
  reverse,
  billPayReference,
};
