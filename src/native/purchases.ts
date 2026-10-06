import { Capacitor } from "@capacitor/core";
import { Purchases, PURCHASES_ERROR_CODE, type PurchasesPackage } from "@revenuecat/purchases-capacitor";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * RevenueCat on the native shells only. On the web the existing Stripe
 * checkout stays exactly as it is.
 *
 * The rule that makes one entitlement possible: RevenueCat's app user id IS
 * the Supabase user id. Configure after login, logIn on every account switch,
 * logOut on sign-out. Never let a purchase happen under an anonymous id.
 */
export async function initPurchases(supabase: SupabaseClient, keys: { ios: string; android: string }) {
  if (!Capacitor.isNativePlatform()) return;
  const apiKey = Capacitor.getPlatform() === "ios" ? keys.ios : keys.android;

  const { data } = await supabase.auth.getSession();
  await Purchases.configure({ apiKey, appUserID: data.session?.user.id ?? null });

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN" && session) await Purchases.logIn({ appUserID: session.user.id });
    if (event === "SIGNED_OUT") await Purchases.logOut().catch(() => undefined); // logOut throws if already anonymous
  });
}

export async function getPackages(): Promise<PurchasesPackage[]> {
  const offerings = await Purchases.getOfferings();
  return offerings.current?.availablePackages ?? [];
}

export type PurchaseOutcome = "purchased" | "cancelled" | "pending" | "failed";

/**
 * Buy, then wait for the server entitlement. The store receipt unlocks the
 * device immediately, but the Supabase row (written by the webhook) is what
 * unlocks the web and the other platform, so the app reads that.
 */
export async function purchase(
  pkg: PurchasesPackage,
  supabase: SupabaseClient,
  waitMs = 15_000,
): Promise<PurchaseOutcome> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Sign in before purchasing so the purchase is tied to the account.");

  try {
    await Purchases.purchasePackage({ aPackage: pkg });
  } catch (err: unknown) {
    const e = err as { code?: string; userCancelled?: boolean };
    if (e.userCancelled || e.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return "cancelled";
    if (e.code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return "pending"; // Ask to Buy, slow cards
    return "failed";
  }
  return (await waitForPremium(supabase, waitMs)) ? "purchased" : "pending";
}

/** Restore Purchases button, required by App Review. */
export async function restore(supabase: SupabaseClient): Promise<boolean> {
  await Purchases.restorePurchases();
  return waitForPremium(supabase, 10_000);
}

async function waitForPremium(supabase: SupabaseClient, waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const { data } = await supabase.from("my_access").select("premium").single();
    if (data?.premium) return true;
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return false;
}
