import { config } from './config.js';

/**
 * Paynow merchant API client (the donor-facing rails).
 *
 * This is a STUB. The actual Paynow merchant API is a different
 * product from BillPay. When wiring this up for production, either:
 *
 *   (a) drop in the official `paynow` SDK
 *       (`npm i paynow`, then `new Paynow(integrationId, integrationKey)`,
 *        `paynow.send(payment)` for cards / `paynow.sendMobile(payment, phone, method)`
 *        for mobile money), or
 *
 *   (b) call the HTTP API directly with `axios.post('https://www.paynow.co.zw/interface/initiatetransaction', …)`
 *       — see Paynow's merchant API docs.
 *
 * For the demo, this just synthesises plausible response shapes so
 * the broker can be exercised end-to-end without external services.
 */

const RAIL_TO_METHOD = {
  ecocash: 'ecocash',
  onemoney: 'onemoney',
  innbucks: 'innbucks',
  zimswitch: 'zimswitch',
  visa: 'card',
  paypal: 'paypal',
};

async function initiateTransaction({ reference, amount, currency, donor, rail, description }) {
  const method = RAIL_TO_METHOD[rail] || 'card';

  if (config.paynow.integrationId && config.paynow.integrationKey && config.nodeEnv === 'production') {
    // ─── live path (intentionally unimplemented — wire the real SDK here) ───
    throw new Error(
      'Live Paynow merchant initiation is not implemented in this reference broker. ' +
      'Drop in the `paynow` SDK or call /interface/initiatetransaction directly.'
    );
  }

  // ─── stub ───────────────────────────────────────────────────────────────
  const stubGuid = cryptoLikeId();
  return {
    success: true,
    method,
    hash: `mock-hash-${stubGuid}`,
    redirectUrl: `https://www.paynow.co.zw/Payment/Link/?q=${stubGuid}`,
    pollUrl: `https://www.paynow.co.zw/Interface/CheckPayment/?guid=${stubGuid}`,
    reference,
    amount,
    currency,
    description,
    payerEmail: donor?.email || null,
    payerPhone: donor?.phone || null,
    instructions:
      method === 'ecocash' || method === 'onemoney' || method === 'innbucks'
        ? `Approve the prompt on your ${rail} phone to confirm.`
        : 'You will be redirected to Paynow to complete payment.',
  };
}

async function checkPaymentStatus({ pollUrl }) {
  // Demo: pretend the donor immediately paid.
  return { paid: true, status: 'Paid', pollUrl };
}

function cryptoLikeId() {
  return [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const paynow = {
  initiateTransaction,
  checkPaymentStatus,
};
