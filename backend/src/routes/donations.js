import { Router } from 'express';
import { z } from 'zod';
import { billpay } from '../billpay.js';
import { paynow } from '../paynow.js';
import { store } from '../store.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const donationsRouter = Router();

const donationSchema = z.object({
  campaignCode: z.string().min(1),
  amount: z.number().positive().max(1_000_000),
  currency: z.enum(['USD', 'ZWL']).default('USD'),
  paymentRail: z.enum(['ecocash', 'onemoney', 'innbucks', 'zimswitch', 'visa', 'paypal']),
  donor: z
    .object({
      name: z.string().trim().min(1).optional(),
      email: z.string().email().optional(),
      phone: z.string().trim().optional(),
      anonymous: z.boolean().default(false),
      message: z.string().trim().max(500).optional(),
    })
    .default({ anonymous: false }),
});

const reverseSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

// POST /api/donations — create a donation
donationsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = donationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { campaignCode, amount, currency, paymentRail, donor } = parsed.data;

    const campaign = store.campaigns.byCode(campaignCode);
    if (!campaign) return res.status(404).json({ error: `Unknown campaign code: ${campaignCode}` });
    if (!campaign.enabled) return res.status(409).json({ error: 'Campaign is currently closed.' });
    if (campaign.currency !== currency) {
      return res.status(409).json({
        error: `Campaign is denominated in ${campaign.currency} but request was ${currency}.`,
      });
    }
    if (campaign.minAmount && amount < campaign.minAmount) {
      return res.status(400).json({ error: `Minimum donation for this campaign is ${campaign.minAmount} ${currency}.` });
    }

    const reference = billpay.billPayReference();
    const memberNumber = donor.email || `donor-${reference}@falcongiving.paynow.co.zw`;

    // 1. Record locally (Pending)
    const donation = store.donations.create({
      reference,
      campaignCode,
      amount,
      currency,
      donor,
      rail: paymentRail,
      memberNumber,
    });

    // 2. BillPay AUTH — validate + reserve
    const authResp = await billpay.process({
      action: 'AUTH',
      reference,
      memberNumber,
      products: [
        {
          Code: campaignCode,
          Quantity: 1,
          Price: amount,
          RequiresForexPayment: campaign.requiresForex === true,
        },
      ],
      totalAmount: amount,
    });

    if (authResp.Status !== 'Authorized') {
      donation.status = 'Failed';
      donation.failureNarration = authResp.Narration || 'AUTH was not authorized.';
      return res.status(502).json({
        error: 'BillPay AUTH failed.',
        narration: authResp.Narration,
        technicalNarration: authResp.TechnicalNarration,
      });
    }
    donation.status = 'Authorized';

    // 3. Initiate the donor-facing merchant transaction
    const merchant = await paynow.initiateTransaction({
      reference,
      amount,
      currency,
      donor,
      rail: paymentRail,
      description: `Gift to ${campaign.name} (${config.billerCode})`,
    });
    donation.paynow.redirectUrl = merchant.redirectUrl;
    donation.paynow.pollUrl = merchant.pollUrl;
    donation.paynow.instructions = merchant.instructions;

    // 4. In mock mode, fast-forward to PAY so the demo completes without
    //    a real merchant webhook. Production removes this block — the
    //    merchant webhook handler is the canonical trigger for PAY.
    if (billpay.mode === 'mock') {
      setTimeout(() => {
        completeDonation(reference).catch((e) => logger.error({ err: e, reference }, 'Auto-complete failed'));
      }, 1500);
    }

    res.status(201).json({
      reference,
      status: donation.status,
      billPayReference: reference,
      amount,
      currency,
      campaign: { code: campaign.code, name: campaign.name },
      paynow: {
        redirectUrl: merchant.redirectUrl,
        pollUrl: merchant.pollUrl,
        instructions: merchant.instructions,
        rail: paymentRail,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/donations/:reference — status inquiry
donationsRouter.get('/:reference', async (req, res, next) => {
  try {
    const local = store.donations.get(req.params.reference);
    if (!local) return res.status(404).json({ error: 'Unknown donation reference.' });

    // If terminal status, just return the local snapshot.
    if (local.status === 'Paid' || local.status === 'Failed' || local.status === 'Reversed') {
      return res.json(serializeDonation(local));
    }

    // Otherwise, ask BillPay.
    const statusResp = await billpay.process({ action: 'STATUS', reference: local.reference });
    local.status = statusResp.Status || local.status;
    res.json(serializeDonation(local));
  } catch (err) {
    next(err);
  }
});

// POST /api/donations/:reference/reverse
donationsRouter.post('/:reference/reverse', async (req, res, next) => {
  try {
    const parsed = reverseSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const local = store.donations.get(req.params.reference);
    if (!local) return res.status(404).json({ error: 'Unknown donation reference.' });

    const reverseRef = `RV-${local.reference}`;
    const resp = await billpay.reverse({ originalReference: local.reference, reference: reverseRef });
    if (resp.ErrorCode !== 0) {
      return res.status(502).json({
        error: 'BillPay reversal failed.',
        code: resp.ErrorCode,
        narration: resp.Narration,
      });
    }
    res.json({
      reference: local.reference,
      reversalReference: reverseRef,
      billpayReference: resp.BillpayReference,
      reason: parsed.data.reason ?? null,
      status: 'Reversed',
    });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────

export async function completeDonation(reference) {
  const local = store.donations.get(reference);
  if (!local) throw new Error(`Unknown donation: ${reference}`);
  if (local.status === 'Paid') return local;

  const payResp = await billpay.process({
    action: 'PAY',
    reference: local.reference,
    memberNumber: local.memberNumber,
    products: [
      {
        Code: local.campaignCode,
        Quantity: 1,
        Price: local.amount,
        RequiresForexPayment: store.campaigns.byCode(local.campaignCode)?.requiresForex === true,
      },
    ],
    totalAmount: local.amount,
    payerDetails: {
      ContactNumber: local.donor?.phone || null,
    },
  });

  if (payResp.Status !== 'Paid') {
    local.status = payResp.Status === 'BeingProcessed' ? 'BeingProcessed' : 'Failed';
    local.failureNarration = payResp.Narration;
    return local;
  }
  // PAY mock already updated the store + campaign stats; just echo.
  return local;
}

function serializeDonation(d) {
  const campaign = store.campaigns.byCode(d.campaignCode);
  return {
    reference: d.reference,
    status: d.status,
    amount: d.amount,
    currency: d.currency,
    rail: d.rail,
    campaign: campaign ? { code: campaign.code, name: campaign.name } : { code: d.campaignCode },
    donor: d.donor?.anonymous
      ? { anonymous: true }
      : { name: d.donor?.name, email: d.donor?.email, anonymous: false, message: d.donor?.message },
    createdAt: d.createdAt,
    paidAt: d.paidAt,
    billPayReference: d.billPayReference,
    billerPaymentReference: d.billerPaymentReference,
    walletDebitReference: d.walletDebitReference,
    vendorInvoiceReference: d.vendorInvoiceReference,
    vendorFiscalSignature: d.vendorFiscalSignature,
    vendorFiscalMetadata: d.vendorFiscalMetadata,
    paynow: d.paynow,
  };
}
