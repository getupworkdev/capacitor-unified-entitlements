# Handover: building, releasing and managing subscriptions

## Build

```bash
npm ci
npm run build            # web build into dist/
npx cap sync             # copies dist/ and plugins into ios/ and android/
npx cap open ios         # Xcode: Product > Archive > Distribute > App Store Connect
npx cap open android     # Android Studio: Build > Generate Signed Bundle (AAB)
```

Version numbers: bump `CFBundleShortVersionString` / build number in Xcode and
`versionName` / `versionCode` in `android/app/build.gradle` for every upload.

## When a change needs a store release

| Change | Store release? |
|---|---|
| UI, copy, logic in the web code | Yes, the web build is bundled in the binary |
| Netlify functions, Supabase schema | No |
| New Capacitor plugin, permission or native setting | Yes |
| New subscription product or price | No release, but the product must be approved in the store first |

## Subscriptions

- Products and prices: App Store Connect > Subscriptions, Play Console > Monetize > Subscriptions.
- Map new products to the `premium` entitlement in RevenueCat; no code change needed.
- Refunds: Apple handles its own; Play and Stripe refunds can be issued from their consoles. The webhooks update access automatically.
- Comp access for a user: insert a `promotional` row in `entitlements` (or grant a promotional entitlement in RevenueCat).

## Secrets

All server secrets live in Netlify environment variables. The app bundle only
contains the Supabase anon key and the two RevenueCat public SDK keys.

## Accounts and keys

Apple Developer, App Store Connect, Play Console, RevenueCat, Stripe, Supabase
and Netlify stay owned by the company. The Android upload key and its
password are stored by the company; Play App Signing holds the release key.
