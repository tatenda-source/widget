# Falcon Giving — Broker

Node + Express broker between the Falcon Giving widget and Paynow BillPay. This is the reference implementation that the "Paynow for Schools" pitch describes: a thin server that holds the BillPay vendor credentials, proxies the read endpoints (`TargetStats`, `Feed`, `ListBillers`) to the widget, and orchestrates the donor's payment through Paynow's regular merchant rails before pushing settled funds onto the chosen biller product via BillPay `AUTH` + `PAY`.

```
[widget / iframe / school site]
            │
            ▼
   [this broker — Express]
            │
   ┌────────┴─────────┐
   ▼                  ▼
[Paynow merchant]   [BillPay Vendor API]
 (donor's rail)     (route to biller)
```

## Run it

```bash
cp .env.example .env       # mock mode by default — no real creds needed
npm install
npm run dev                # http://localhost:4000
```

Mock mode is the default and is what you want for the demo. Live mode requires real BillPay vendor credentials provisioned by Paynow support.

## Endpoints

### Public (called by the widget)

| Method | Path                              | Purpose                                                                       |
|--------|-----------------------------------|-------------------------------------------------------------------------------|
| GET    | `/api/health`                     | Liveness + which mode (mock/live) is active.                                  |
| GET    | `/api/campaigns`                  | All open Falcon campaigns. Shapes BillPay `ListBillers` → widget-ready JSON.  |
| GET    | `/api/campaigns/:code`            | A single campaign with full detail.                                           |
| GET    | `/api/campaigns/:code/stats`      | Raised / goal / donor count / percent. Backed by BillPay `TargetStats`.       |
| GET    | `/api/campaigns/:code/feed`       | Recent donors for the campaign. Backed by BillPay `Feed`.                     |
| POST   | `/api/donations`                  | Create a donation — runs AUTH against BillPay, returns a Paynow init URL.     |
| GET    | `/api/donations/:reference`       | Donation status. Maps to BillPay `STATUS` action.                             |
| POST   | `/api/donations/:reference/reverse` | Reverse a donation (rare — Falcon biller likely won't support it).          |

### Webhook receivers

| Method | Path                              | Purpose                                                                       |
|--------|-----------------------------------|-------------------------------------------------------------------------------|
| POST   | `/api/webhooks/billpay-config`    | BillPay pings here when biller config changes. Bearer-token authenticated.    |
| POST   | `/api/webhooks/paynow-merchant`   | Paynow pings here when the donor's merchant payment succeeds → triggers PAY.  |

## Request shapes

### `POST /api/donations`

```json
{
  "campaignCode": "CHAPEL",
  "amount": 100,
  "currency": "USD",
  "paymentRail": "ecocash",
  "donor": {
    "name": "Andrew M.",
    "email": "andrew@example.com",
    "anonymous": false,
    "message": "Class of 1994, in memory of Mr Harvey.",
    "phone": "+263772000000"
  }
}
```

Response (201):

```json
{
  "reference": "FAL-260513090832888",
  "status": "Authorized",
  "billPayReference": "FAL-260513090832888",
  "amount": 100,
  "currency": "USD",
  "campaign": { "code": "CHAPEL", "name": "Chapel Window Restoration" },
  "paynow": {
    "redirectUrl": "https://www.paynow.co.zw/Payment/Link/?q=...",
    "pollUrl": "https://www.paynow.co.zw/Interface/CheckPayment/?guid=..."
  }
}
```

In mock mode the redirect/poll URLs are placeholders; the donation auto-completes after a short delay so the widget can demo the success state.

## How a donation flows through the broker

1. Widget POSTs to `/api/donations` with the donor's choice of campaign, amount, and rail.
2. Broker validates input with zod, then sends a BillPay **AUTH** request to reserve the slot on the Falcon biller for that campaign-product.
3. On AUTH success, broker initiates a Paynow merchant transaction for the donor's payment rail. Donor is redirected to (or polls) Paynow.
4. Donor pays via Ecocash / OneMoney / card / etc. Paynow sends a webhook to `/api/webhooks/paynow-merchant`.
5. On that webhook, broker calls BillPay **PAY** to route the now-settled funds to Falcon under the chosen product.
6. Broker captures `BillPayReference`, `WalletDebitReference`, `VendorInvoiceReference`, `VendorFiscalSignature`. Widget polls `/api/donations/:ref` and surfaces the receipt.

Steps 2–5 are the production path. In **mock mode**, steps 2–5 are collapsed into a single in-memory transition so the demo runs without external services. The code paths are still separate so the live wiring is a search-and-replace away.

## What's stubbed vs real

- **BillPay client** — fully wired to hit the real API in `live` mode (basic auth, all endpoints from the v1.33 spec). In `mock` mode it returns realistic shapes from an in-memory store seeded with the same six Falcon campaigns the widget uses.
- **Paynow merchant client** — stubbed. The merchant API is a separate Paynow product from BillPay; once you wire the actual `paynow-sdk` (or call the merchant HTTP API directly) the only change is in `src/paynow.js`.
- **Persistence** — in-memory `Map`s. Survives the request lifecycle, not a process restart. Production would be Postgres with the same data shapes (one table per: campaigns, donations, donor-wall entries, webhook events).
- **Auth** — none on the public endpoints. The widget is intentionally anonymous-friendly. Production would add rate-limiting and CAPTCHA / BotID on `POST /api/donations`.

## Hooking the widget up

The widget is currently self-contained (the `setTimeout` in `index.html` simulates the handoff). To wire it to this broker, replace the `cta-step2` click handler so it calls `POST /api/donations`, then polls `GET /api/donations/:ref` until status is `Paid`. That swap is intentionally a follow-up — keeping the demo widget purely client-side means it always works as a standalone artifact.
