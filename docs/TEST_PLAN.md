# Sandbox test matrix

Run on real devices: an iPhone with a Sandbox Apple ID, an Android phone with a
licence-tester Google account, and the web app in Stripe test mode. After each
step check three things: the app, the website, and the `entitlements` row.

| # | Action | Expected row | App | Web |
|---|---|---|---|---|
| 1 | New user, iOS: start monthly trial | `app_store`, active, trial | Premium, "Manage in Settings > Apple ID" | Premium |
| 2 | Same user signs in on Android | unchanged | Premium, no paywall, "billed through Apple" | Premium |
| 3 | Cancel in iOS sandbox settings | active, will_renew false | Premium until expiry | Premium until expiry |
| 4 | Let sandbox period lapse | expired | Paywall, no trial copy | Paywall |
| 5 | New user, web: Stripe checkout with trial | `stripe`, active, trial | Premium on both phones, no paywall | Premium |
| 6 | Stripe test card that fails on renewal | active, billing_issue true | Premium plus "update your card" | Same |
| 7 | Android: buy annual | `play_store`, active | Premium | Premium |
| 8 | Refund the Play purchase from Play Console | revoked | Paywall | Paywall |
| 9 | Restore Purchases on iOS while signed in as a different user | old owner revoked (TRANSFER), new owner active | Premium on the new account only | Same |
| 10 | Replay the same webhook (RevenueCat "resend", `stripe events resend`) | no change, `webhook_events` shows one row | n/a | n/a |
| 11 | Deliver an older event after a newer one | `apply_entitlement` returns stale | n/a | n/a |
| 12 | Tap a magic link on each phone | opens the app, signed in | Signed in | n/a |
| 13 | Tap an expired magic link | n/a | Clear "link expired, send a new one" message | n/a |

Sandbox subscription periods are accelerated (a month renews in about five
minutes on iOS), which makes 3, 4 and 6 quick to observe.
