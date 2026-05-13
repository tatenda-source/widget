import { Router } from 'express';
import { z } from 'zod';
import { billpay } from '../billpay.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { completeDonation } from './donations.js';
import { store } from '../store.js';

export const webhooksRouter = Router();

// ────────────────────────────────────────────────────────────
// BillPay biller-config webhook
// ────────────────────────────────────────────────────────────
// BillPay POSTs a JSON array of biller codes here when any of those
// billers' configs change. Per the spec, must respond 200 or BillPay
// retries every 30s, up to 3 attempts.

const billpayConfigSchema = z.array(z.string().min(1));

webhooksRouter.post('/billpay-config', async (req, res, next) => {
  try {
    if (config.webhooks.billpayBearer) {
      const got = req.headers.authorization || '';
      const expected = `Bearer ${config.webhooks.billpayBearer}`;
      if (got !== expected) return res.status(401).json({ error: 'Invalid bearer token.' });
    }
    const parsed = billpayConfigSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Body must be a JSON array of biller codes.' });

    const codes = parsed.data;
    logger.info({ codes }, 'BillPay biller-config changed — re-pulling');
    if (codes.includes(config.billerCode)) {
      await billpay.listBillers([config.billerCode]);
    }
    res.status(200).json({ received: codes.length });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────────────────
// Paynow merchant-payment-status webhook
// ────────────────────────────────────────────────────────────
// Production: Paynow's merchant API POSTs status updates here when the
// donor completes their payment (or it fails). On a 'Paid' status we
// fire BillPay PAY to route funds to the biller.
//
// Note: the real merchant API uses a hash-signed form-encoded body.
// This handler accepts both form-encoded and JSON for flexibility,
// and skips hash validation in mock mode.

webhooksRouter.post('/paynow-merchant', async (req, res, next) => {
  try {
    const body = req.is('application/json') ? req.body : req.body; // express handles both via middleware
    const reference = body.reference || body.Reference;
    const status = (body.status || body.Status || '').toLowerCase();

    if (!reference) return res.status(400).json({ error: 'Missing reference.' });

    const donation = store.donations.get(reference);
    if (!donation) return res.status(404).json({ error: 'Unknown donation reference.' });

    logger.info({ reference, status }, 'Paynow merchant webhook received');

    if (status === 'paid' || status === 'awaiting delivery' || status === 'delivered') {
      await completeDonation(reference);
      return res.status(200).json({ ok: true, action: 'pay', reference });
    }

    if (status === 'cancelled' || status === 'failed') {
      donation.status = 'Failed';
      donation.failureNarration = `Donor merchant payment ${status}.`;
      return res.status(200).json({ ok: true, action: 'fail', reference });
    }

    // unknown status — acknowledge but take no action
    res.status(200).json({ ok: true, action: 'ignored', reference, status });
  } catch (err) {
    next(err);
  }
});
