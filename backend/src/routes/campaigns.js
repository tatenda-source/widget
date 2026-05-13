import { Router } from 'express';
import { billpay } from '../billpay.js';
import { store } from '../store.js';
import { config } from '../config.js';

export const campaignsRouter = Router();

/**
 * Shape a BillPay Product (or seeded campaign) into the form the
 * widget expects. Keeps the widget naive about BillPay terminology.
 */
function toWidgetCampaign(c) {
  return {
    code: c.code,
    name: c.name,
    category: c.category,
    description: c.description,
    raised: c.raised,
    goal: c.goal,
    donors: c.donors,
    percent: c.goal > 0 ? Math.min(100, Math.round((c.raised / c.goal) * 100)) : 0,
    currency: c.currency,
    minAmount: c.minAmount,
    maxAmount: c.maxAmount,
    requiresForex: c.requiresForex,
    enabled: c.enabled,
  };
}

// GET /api/campaigns
campaignsRouter.get('/', async (req, res, next) => {
  try {
    // We rely on the store as source of truth for stats (because
    // BillPay's TargetStats is biller-level, not product-level —
    // see context.md's "How this maps to BillPay" section).
    //
    // BillPay's ListBillers is still called to keep the in-memory
    // product catalogue in sync with whatever ops have provisioned.
    await billpay.listBillers([config.billerCode]);
    const campaigns = store.campaigns.list().map(toWidgetCampaign);
    res.json({ billerCode: config.billerCode, currency: config.defaultCurrency, campaigns });
  } catch (err) {
    next(err);
  }
});

// GET /api/campaigns/:code
campaignsRouter.get('/:code', (req, res) => {
  const c = store.campaigns.byCode(req.params.code);
  if (!c) return res.status(404).json({ error: 'Unknown campaign code.' });
  res.json(toWidgetCampaign(c));
});

// GET /api/campaigns/:code/stats — per-campaign progress
campaignsRouter.get('/:code/stats', (req, res) => {
  const stats = store.campaigns.statsFor(req.params.code);
  if (!stats) return res.status(404).json({ error: 'Unknown campaign code.' });
  res.json(stats);
});

// GET /api/campaigns/stats/total — biller-level TargetStats
campaignsRouter.get('/-/total', async (req, res, next) => {
  try {
    const currency = (req.query.currency || config.defaultCurrency).toString();
    const stats = await billpay.getTargetStats({ currency });
    res.json({
      currency,
      targetAmount: stats.TargetAmount,
      achievedAmount: stats.TargetAchievedAmount,
      payerCount: stats.PayerCount,
      percent:
        stats.TargetAmount > 0
          ? Math.min(100, Math.round((stats.TargetAchievedAmount / stats.TargetAmount) * 100))
          : 0,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/campaigns/:code/feed — recent donors filtered to the campaign
campaignsRouter.get('/:code/feed', async (req, res, next) => {
  try {
    const c = store.campaigns.byCode(req.params.code);
    if (!c) return res.status(404).json({ error: 'Unknown campaign code.' });

    const feed = await billpay.getFeed({ currency: c.currency });
    const filtered = feed
      .filter((e) =>
        (e.MetaData || []).some((m) => m.Key === 'ProductCode' && m.Value === c.code)
      )
      .map(reshapeFeedEntry);

    res.json({ campaignCode: c.code, entries: filtered });
  } catch (err) {
    next(err);
  }
});

// GET /api/feed — biller-wide donor wall
campaignsRouter.get('/-/feed', async (req, res, next) => {
  try {
    const currency = (req.query.currency || config.defaultCurrency).toString();
    const feed = await billpay.getFeed({ currency });
    res.json({ entries: feed.map(reshapeFeedEntry) });
  } catch (err) {
    next(err);
  }
});

function reshapeFeedEntry(e) {
  const meta = Object.fromEntries((e.MetaData || []).map((m) => [m.Key, m.Value]));
  return {
    date: e.Date,
    amount: e.Amount,
    donor: meta.DonorDisplayName || 'An Old Hawk',
    productCode: meta.ProductCode,
    productName: meta.ProductName,
  };
}
