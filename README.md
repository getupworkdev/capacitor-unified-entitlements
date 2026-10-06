# capacitor-unified-entitlements

One subscription, three places to pay for it. A web app that already sells a
Stripe subscription gets native iOS and Android apps through Capacitor, with
Apple and Google billing through RevenueCat, and a user who pays anywhere is
unlocked everywhere they sign in.

```
Stripe (web)  ──webhook──┐
App Store     ──┐        ├──► Supabase: entitlements ──► my_access.premium ──► app, web, both stores
Google Play   ──┴─ RevenueCat ──webhook──┘
```

The design rule: **RevenueCat's app user id is the Supabase user id**, and the
app only ever asks one question, `select premium from my_access`.

## What is in it

| Path | What it does |
|---|---|
| `supabase/migrations/…_entitlements.sql` | `entitlements` (one row per user per source), `webhook_events` (idempotency), `my_access` view, `apply_entitlement()` that refuses out-of-order events. RLS: users read their own rows, nobody but the service role writes. |
| `netlify/functions/stripe-webhook.ts` | Verifies `Stripe-Signature` over the raw body, records the event once, maps subscription status to the entitlement. Releases the claim on failure so Stripe's retry is processed. |
| `netlify/functions/revenuecat-webhook.ts` | Checks the Authorization header, maps App Store and Play events (purchase, renewal, cancel, refund, billing issue, expiry, transfer). |
| `src/core/` | Pure logic, no SDKs: `resolveAccess`, `paywallDecision`, `manageHint`, the two event mappers, Stripe signature check, magic-link URL parsing. Everything here is unit-tested. |
| `src/native/purchases.ts` | RevenueCat on the native shells: configure with the Supabase user, `logIn`/`logOut` on auth changes, purchase, restore, then wait for the server entitlement. |
| `src/native/deeplinks.ts` | Magic links that open the app: handles both PKCE `?code=` and implicit `#access_token=` callbacks and expired-link errors. |
| `public/.well-known/` | `apple-app-site-association` and `assetlinks.json` templates, plus `_headers` so Netlify serves them as JSON. |
| `docs/` | App Review notes (guideline 4.2 and 3.1), the sandbox test matrix, and a handover template. |

## Cases it handles on purpose

- **Paying on the web, opening the iPhone app.** Premium immediately, no paywall, and the settings row says the plan is billed on the web. No path to a second, overlapping Apple subscription.
- **Cancel vs refund.** A normal cancel keeps access until the period ends. A refund through store support ends it now.
- **Card failing.** Stripe `past_due` and store `BILLING_ISSUE` keep access and set `billing_issue` so the app can nudge.
- **Webhooks arriving twice or out of order.** The event id is recorded once; an older event never overwrites newer state (enforced in SQL, not only in code).
- **Restoring on a different account.** RevenueCat `TRANSFER` revokes the previous owner instead of leaving two accounts unlocked.
- **Purchases before login.** Refused in the app, and anonymous RevenueCat ids are ignored by the webhook.
- **Sandbox purchases in production.** Ignored unless `ACCEPT_SANDBOX=true`.

## Run it

```bash
npm ci
npm test        # 28 tests
npm run lint    # strict TypeScript, including the native adapters
```

The SQL was run against PostgreSQL 16 with a stub `auth` schema: first event
applied, older event reported `stale`, a second user's row invisible under
RLS, and both a direct insert and a direct `apply_entitlement()` call from the
`authenticated` role refused.

## Wiring it into an existing app

1. Apply the migration (`supabase db push`).
2. At Stripe checkout, add `subscription_data: { metadata: { supabase_user_id: user.id } }`. Existing subscribers need a one-off backfill of that metadata.
3. Deploy the two functions, set the env vars from `.env.example`, register both webhook URLs.
4. In RevenueCat, create one entitlement (for example `premium`) and attach the App Store and Play products.
5. In the app: `initPurchases()` and `listenForAuthLinks()` at startup, then gate features on `my_access.premium`.
6. Fill in the two `.well-known` files with the real Team ID, bundle id, package name and the **Play App Signing** SHA-256.

## Not covered

- Store product setup, tax forms and banking: done in App Store Connect and Play Console by the account owner.
- Showing a web purchase link inside the iOS app. Apple's rules for that vary by region and change; the safe default here is to not show one.
- Free trial eligibility is decided by Apple and Google per store account. `offerTrial` only controls the paywall copy.

## License

MIT
