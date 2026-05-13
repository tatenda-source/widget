# Falcon College Giving Widget — Project Context

## What we're building

A donation widget that lets **Falcon College alumni** contribute to specific institutional use cases (Old Hawks campaigns) using **Paynow billpay infrastructure**. Think GoFundMe-style transparency and progress tracking, but routed through the existing Paynow merchant rails Zimbabwean payers already trust — Ecocash, OneMoney, Innbucks, Zimswitch, Visa/Mastercard.

The widget is the wedge. The bigger story is **Paynow for Schools**: a programmable giving and fees layer that any Zimbabwean institution can plug into without standing up their own merchant account, donor CRM, or finance ops.

## Why Falcon

- Founded 1954, Esigodini — one of Zimbabwe's most established boys' boarding schools with a deep diaspora alumni base in SA, UK, AU, US.
- Diaspora alumni are the highest-LTV donor segment in Zim education and are currently underserved by clunky bank-wire / Western Union flows. Most institutions still email a PDF with bank details.
- Falcon already has named campaigns the alumni network rallies around — chapel, scholarship, sports, capital projects. The use cases are well understood; only the rails are missing.
- The crest, motto ("Sic Itur Ad Astra"), and house identities give us strong editorial material to make the widget feel like Falcon, not like a fintech form.

## Demo intent

This is a **multimedia artifact** — a single polished, self-contained page that doubles as:

1. A **working interactive demo** of the donation widget (campaign selection → amount → payment method → confirmation).
2. A **pitch surface** for "Paynow for Schools" — sections that explain the why, the platform thinking, and the unit economics.
3. A **screen-recordable / screenshottable** asset — every section composes as a standalone frame for a deck, social post, or short video walkthrough.

One file, no build step. Open `index.html`, share the link, or screen-record it. That's the deliverable.

## Folder layout

```
widget/
├── context.md          ← this file
├── index.html          ← the demo page + embedded widget
└── (later)
    ├── widget.html     ← standalone embeddable widget if we extract
    └── assets/         ← any heavier media we add later
```

## Design direction

- **Aesthetic**: editorial heritage, not fintech. Cream paper, deep maroon, antique gold. Newspaper-grade typography. The widget should feel like it belongs on a school crest, not a SaaS dashboard.
- **Type**: Fraunces (display serif, variable) + Geist (body) + Geist Mono (data/numbers). Explicitly avoiding Inter / Roboto / Space Grotesk.
- **Palette**: ink `#1A0F0A`, paper `#F5EDDB`, maroon `#5E1A1A`, gold `#B8924A`, cream `#FAF6EE`.
- **Motion**: subtle. Progress bars animate on scroll, numbers count up, no bouncy spring nonsense.
- **Voice**: institutional, confident, slightly old-world. "Endow. Restore. Equip." not "Easily donate today!"

## Widget functional spec

- Campaign picker (6 active campaigns visible, one featured).
- Amount selector: preset chips ($25, $50, $100, $250, $500, $1000) + custom field, USD-denominated.
- Donor identity: name + email, or anonymous toggle. Optional message of support.
- Payment rail picker mirroring Paynow's actual surface: Ecocash, OneMoney, Innbucks, Zimswitch, Visa/Mastercard.
- Confirmation step showing the Paynow handoff (no real money — this is a demo).
- Success state with thank-you, receipt download stub, and "share to alumni network" CTA.

State is held in vanilla JS on a single page. No backend in this iteration — the Paynow integration is **simulated** with realistic copy and a fake redirect flow. The hooks for the real `paynow-sdk` initiation are stubbed where they'd live.

## Paynow for Schools — the pitch beats

The demo carries these talking points so the page works as a leave-behind:

1. **One merchant, many use cases** — schools don't need to set up separate accounts per campaign. Paynow already holds the merchant relationship; we just expose programmable use-case routing.
2. **Diaspora-friendly** — card rails for offshore alumni, mobile money for in-country, all in one widget.
3. **Transparent ledger** — every campaign shows raised / goal / donor count in real time. Trust beats fundraising appeals.
4. **Low ops overhead** — receipts, donor lists, and CSV exports are automated. School bursar doesn't manage spreadsheets.
5. **Embeddable anywhere** — schools paste one `<script>` tag onto their existing site (no rebuild needed).

## What this demo deliberately does NOT do

- No real Paynow API calls. The redirect is mocked.
- No persistence — refresh resets state. The donor wall is illustrative.
- No multi-tenant config UI. We're selling the *concept* to Falcon-style institutions; the platform admin is a later conversation.
- No auth. Alumni shouldn't have to log in to donate.

## How this maps to the existing BillPay Vendor API

This is the part that makes the pitch a no-build, not a roadmap: every primitive the widget assumes already exists in Paynow BillPay today (per the v1.33 Vendor API doc).

| Widget concept | BillPay primitive |
|---|---|
| Falcon as an institution | A **Biller** (e.g. `BillerCode = FAL`) |
| Chapel Restoration, Bursary Fund, etc. | A **Product** under the Falcon biller (one per campaign) |
| Donor-chosen amount on a free-priced campaign | Product type `AA` (no fixed price, donor picks) |
| Fixed-target campaign (e.g. tour cost) | Product type `AM` (full payment required, balance returned in AUTH) |
| Progress bar — raised / goal / donor count | `GET /api/payment/TargetStats?billercode=FAL&currency=USD` |
| Donor wall ticker | `GET /api/payment/feed?billercode=FAL&currency=USD` (requires `AllowFeed` on biller) |
| Two-step Continue → Confirm flow | The mandatory **AUTH → PAY** lifecycle on `POST /api/payment/process` |
| "Initiating secure handoff" simulated wait | Real AUTH/PAY can timeout — STATUS polling at 120s, then 180s |
| Receipt details on success | `BillPayReference`, `WalletDebitReference`, `BillerPaymentReference` |
| Bursar's auto-receipted invoice | `VendorInvoiceReference` + `VendorFiscalSignature` (CloudESD-backed, fiscally compliant under ZW VAT law) |
| Per-school logo / colours / motto | Theming layer in the embed; BillPay already returns `IconUrl`, `LogoUrl`, `MetaTitle`, `MetaDescription` per biller and per product |
| Webhook-pinged biller config refresh | BillPay POSTs `[bill codes]` to a vendor URL; vendor re-pulls via `ListBillers?billerCodes=...` |

**Key implication:** "Paynow for Schools" isn't a new product to build — it's a thin, opinionated client over rails that already run thousands of merchant transactions a day. The work is the embed + the school-side onboarding flow, not the payment infrastructure.

**Donor → Falcon money path:**
1. Donor uses the widget on `falcongiving.paynow.co.zw` (or embedded on Falcon's own site).
2. Widget collects amount + rail + identity, sends donor through the **regular Paynow merchant flow** (Ecocash / Visa / etc.) — this is the part donors already trust.
3. Settled funds land in the schools-platform **vendor wallet**.
4. Widget's broker calls **BillPay AUTH then PAY** to route those funds to Falcon under the selected campaign product.
5. Success response surfaces `BillPayReference` + auto-generated fiscal invoice; donor sees their receipt, campaign's `TargetStats` ticks up, next `Feed` pull surfaces them on the donor wall.

The widget itself never holds money — Paynow's vendor wallet does, BillPay routes it, and reconciliation is automatic via the references above.

## Next steps after the demo lands

1. Pitch deck pull from the same visual system (frontend-design carryover).
2. Provision Falcon as a real BillPay biller in the test environment with 6 products (one per campaign).
3. Stand up a thin broker service that holds vendor BillPay credentials, proxies `TargetStats` + `Feed` to the widget, and wraps `Auth` + `Pay` after the merchant-side debit succeeds.
4. Replace the simulated handoff in `index.html` with real calls to that broker; keep all visual / interaction logic.
5. Bursar dashboard for product creation, target setting, and reconciliation reporting (probably wraps `ListPayments` + `TargetStats`).
6. Per-school theming as a config object passed to the embed script.
