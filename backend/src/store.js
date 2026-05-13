/**
 * In-memory store. Production would replace this with Postgres
 * (one table per: campaigns, donations, donor_wall, webhook_events).
 * The shapes here are stable — the routes don't know it's in memory.
 */

import { config } from './config.js';

const campaignsByCode = new Map();
const donationsByReference = new Map();
const donorWall = []; // newest first

function seedFalcon() {
  const seed = [
    {
      code: 'CHAPEL',
      name: 'Chapel Window Restoration',
      category: 'Capital · Heritage',
      description:
        'Six decades of southern African light have lifted the cobalt and rose pigments from the 1962 panels behind the altar. Master glazier Pieter du Toit has quoted a full restoration to be completed by Speech Day 2026.',
      raised: 48200,
      goal: 60000,
      donors: 312,
      currency: 'USD',
      priceFixed: null,
      requiresForex: false,
      enabled: true,
      iconUrl: null,
      logoUrl: null,
      postPurchaseInstructions:
        'A photographic update on the restoration will be sent quarterly to all donors.',
      minAmount: 5,
      maxAmount: null,
    },
    {
      code: 'BURSARY',
      name: 'Hawks Bursary Fund — 2026 Intake',
      category: 'Bursary · Access',
      description:
        'Twelve full bursaries for boys from Matabeleland whose families cannot meet fees. Three are already named for masters past; the rest await an alumni name on the brass plate.',
      raised: 96500,
      goal: 150000,
      donors: 208,
      currency: 'USD',
      priceFixed: null,
      requiresForex: false,
      enabled: true,
      iconUrl: null,
      logoUrl: null,
      postPurchaseInstructions: null,
      minAmount: 10,
      maxAmount: null,
    },
    {
      code: 'XV',
      name: 'First XV Rugby — Tour to Stellenbosch',
      category: 'Sport · Tour',
      description:
        'Two weeks of fixtures against South African schools through July. Transport, kit, and accommodation for thirty boys plus management.',
      raised: 8400,
      goal: 20000,
      donors: 61,
      currency: 'USD',
      priceFixed: null,
      requiresForex: false,
      enabled: true,
      iconUrl: null,
      logoUrl: null,
      postPurchaseInstructions: null,
      minAmount: 5,
      maxAmount: null,
    },
    {
      code: 'LIBRARY',
      name: 'The Library — Heritage Texts Acquisition',
      category: 'Library · Academic',
      description:
        "Twenty-four titles of southern African colonial history, settler diaries, and African nationalist writing — to balance the library's lineage and give context to a Falcon's reading.",
      raised: 13650,
      goal: 15000,
      donors: 94,
      currency: 'USD',
      priceFixed: null,
      requiresForex: false,
      enabled: true,
      iconUrl: null,
      logoUrl: null,
      postPurchaseInstructions: null,
      minAmount: 5,
      maxAmount: null,
    },
    {
      code: 'BEIT',
      name: 'The Beit House Common Room',
      category: 'Boarding · Refit',
      description:
        'Refit and re-roof of the prep-room block. New leather, new desks, a quiet renewal of the room where most Falcons remember themselves growing up.',
      raised: 7000,
      goal: 25000,
      donors: 38,
      currency: 'USD',
      priceFixed: null,
      requiresForex: false,
      enabled: true,
      iconUrl: null,
      logoUrl: null,
      postPurchaseInstructions: null,
      minAmount: 5,
      maxAmount: null,
    },
    {
      code: 'LAB',
      name: 'Science Block — Lab Equipment',
      category: 'Academic · Equipment',
      description:
        'Microscopes, glassware, a working spectrometer. Resources to teach an A-level practical that holds up to a university entrance exam.',
      raised: 22000,
      goal: 40000,
      donors: 147,
      currency: 'USD',
      priceFixed: null,
      requiresForex: false,
      enabled: true,
      iconUrl: null,
      logoUrl: null,
      postPurchaseInstructions: null,
      minAmount: 5,
      maxAmount: null,
    },
  ];
  for (const c of seed) campaignsByCode.set(c.code, c);
}

function seedDonorWall() {
  const initial = [
    { donor: "Andrew M. ('94)", amount: 250, productCode: 'CHAPEL' },
    { donor: 'Anonymous', amount: 50, productCode: 'BURSARY' },
    { donor: 'The Beit Family', amount: 1000, productCode: 'BEIT' },
    { donor: "P. Mhlanga ('07)", amount: 100, productCode: 'XV' },
    { donor: 'An Old Hawk', amount: 500, productCode: 'LIBRARY' },
    { donor: "T. Nyemudzo ('11)", amount: 75, productCode: 'LAB' },
    { donor: "R. Coltart ('82)", amount: 1500, productCode: 'CHAPEL' },
    { donor: 'Anonymous', amount: 200, productCode: 'BURSARY' },
    { donor: "S. Mthembu ('99)", amount: 125, productCode: 'LIBRARY' },
    { donor: "G. Ndoro ('15)", amount: 60, productCode: 'XV' },
  ];
  const now = Date.now();
  initial.forEach((e, i) => {
    const c = campaignsByCode.get(e.productCode);
    donorWall.push({
      date: new Date(now - i * 1000 * 60 * 30).toISOString(),
      memberNumber: `member-${i}@example.com`,
      amount: e.amount,
      productCode: e.productCode,
      productName: c?.name || e.productCode,
      donorDisplayName: e.donor,
    });
  });
}

seedFalcon();
seedDonorWall();

export const store = {
  campaigns: {
    list() {
      return Array.from(campaignsByCode.values());
    },
    byCode(code) {
      return campaignsByCode.get(code) || null;
    },
    recordDonation(code, amount, { donorDisplayName, memberNumber }) {
      const c = campaignsByCode.get(code);
      if (!c) return;
      c.raised += amount;
      c.donors += 1;
      donorWall.unshift({
        date: new Date().toISOString(),
        memberNumber,
        amount,
        productCode: code,
        productName: c.name,
        donorDisplayName,
      });
      // cap donor wall length
      if (donorWall.length > 200) donorWall.length = 200;
    },
    statsFor(code) {
      const c = campaignsByCode.get(code);
      if (!c) return null;
      return {
        code: c.code,
        currency: c.currency,
        goal: c.goal,
        raised: c.raised,
        donors: c.donors,
        percent: c.goal > 0 ? Math.min(100, Math.round((c.raised / c.goal) * 100)) : 0,
        remainingDays: 42, // demo-only; real impl would store deadlines
      };
    },
  },

  donations: {
    create({ reference, campaignCode, amount, currency, donor, rail, memberNumber }) {
      const record = {
        reference,
        campaignCode,
        amount,
        currency,
        donor,
        rail,
        memberNumber,
        status: 'Pending',
        createdAt: new Date().toISOString(),
        paidAt: null,
        billPayReference: null,
        billerPaymentReference: null,
        walletDebitReference: null,
        vendorInvoiceReference: null,
        vendorFiscalSignature: null,
        vendorFiscalMetadata: null,
        paynow: { redirectUrl: null, pollUrl: null },
      };
      donationsByReference.set(reference, record);
      return record;
    },
    get(reference) {
      return donationsByReference.get(reference) || null;
    },
    setStatus(reference, status) {
      const d = donationsByReference.get(reference);
      if (d) d.status = status;
    },
  },

  feed: {
    list() {
      return donorWall.slice();
    },
  },

  meta: {
    billerCode: config.billerCode,
  },
};
