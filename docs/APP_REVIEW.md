# Getting a wrapped web app through App Review

## Guideline 4.2 (minimum functionality)

A Capacitor app that only loads the website is rejected under 4.2 ("your app
provides a limited user experience as it is not sufficiently different from a
mobile browsing experience"). What reviewers respond to is the app using the
device, not more screens. Checklist:

- [ ] Bundled build. The app ships its own HTML/JS in the binary. Never `server.url` pointing at the live site in a release build.
- [ ] Native permissions with clear purpose strings: microphone (`NSMicrophoneUsageDescription`) for voice notes, notifications for reminders.
- [ ] Push notifications that do something useful (training reminders) and an in-app setting to change them.
- [ ] Native sign-in flow: magic link opens the app (Universal Links), not Safari.
- [ ] Native paywall with StoreKit products, restore button, links to Terms and Privacy.
- [ ] Haptics on key actions, safe-area insets respected, no browser chrome, no pinch-zoom on inputs.
- [ ] Works offline gracefully: a clear message instead of a blank WebView.
- [ ] No links that send the user to the website to do something the app should do.

## Guideline 3.1 (payments)

- Digital subscriptions bought **inside** the iOS app must use in-app purchase. That is what RevenueCat provides.
- A user who already subscribed on the web may use that subscription in the app (3.1.3(b), multiplatform services), **as long as the same subscription is also offered via IAP in the app**. Both are true here.
- Do not mention the cheaper web price, or link to web checkout, from inside the iOS app unless you have checked the current regional rules and entitlements for that.
- Subscription paywall must state price, period, trial length and that it auto-renews, plus Terms of Use (EULA) and Privacy Policy links.

## Reviewer notes template

```
Sign-in: the app uses email magic links. To review without email access,
use the demo account below; it signs in with a one-time code instead.

Demo account: reviewer@example.app
Code: provided in the App Review Information "Notes" field

Subscription: "Premium" (monthly, 7-day free trial). Use a Sandbox Apple ID.
Restore Purchases: Settings > Subscription > Restore.
Microphone: used only to record training voice notes (Journal > New entry > mic).
Notifications: training reminders, configurable in Settings > Reminders.
```

Magic-link-only apps are a common rejection cause because the reviewer cannot
receive the email. Give them a demo path that works without an inbox.
