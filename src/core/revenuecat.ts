import { timingSafeEqual } from "node:crypto";
import type { EntitlementUpdate, PeriodType, Source } from "./types.js";

/** The subset of a RevenueCat webhook event this kit reads. */
export interface RevenueCatEvent {
  id: string;
  type: string;
  app_user_id: string;
  original_app_user_id?: string;
  product_id?: string | null;
  period_type?: "TRIAL" | "INTRO" | "NORMAL" | "PROMOTIONAL" | "PREPAID";
  expiration_at_ms?: number | null;
  event_timestamp_ms: number;
  store?: "APP_STORE" | "PLAY_STORE" | "STRIPE" | "PROMOTIONAL" | "MAC_APP_STORE" | "AMAZON";
  environment?: "SANDBOX" | "PRODUCTION";
  cancel_reason?: string;
  transferred_from?: string[];
  transferred_to?: string[];
}

export interface RevenueCatPayload {
  api_version?: string;
  event: RevenueCatEvent;
}

/**
 * RevenueCat signs nothing; it sends the Authorization header value you set
 * in the dashboard. Compare it in constant time.
 */
export function verifyRevenueCatAuth(header: string | null | undefined, expected: string): boolean {
  if (!header || !expected) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** App user IDs must be Supabase user ids. Anonymous RevenueCat ids mean logIn() was skipped. */
export function isSupabaseUserId(id: string | undefined): id is string {
  return !!id && UUID.test(id);
}

function storeToSource(store: RevenueCatEvent["store"]): Source | null {
  switch (store) {
    case "APP_STORE":
    case "MAC_APP_STORE":
      return "app_store";
    case "PLAY_STORE":
      return "play_store";
    case "PROMOTIONAL":
      return "promotional";
    default:
      // Stripe purchases are handled by our own Stripe webhook, not mirrored from RevenueCat.
      return null;
  }
}

function periodType(e: RevenueCatEvent): PeriodType {
  if (e.expiration_at_ms === null || e.expiration_at_ms === undefined) return "lifetime";
  switch (e.period_type) {
    case "TRIAL":
      return "trial";
    case "INTRO":
      return "intro";
    default:
      return "normal";
  }
}

export interface MapOptions {
  /** Drop sandbox events in production. */
  acceptSandbox: boolean;
}

export type MapResult =
  | { kind: "updates"; updates: EntitlementUpdate[] }
  | { kind: "ignored"; reason: string };

/**
 * Turn one RevenueCat event into the entitlement rows it changes.
 * Pure: no database, no network, so every case is unit-tested.
 */
export function mapRevenueCatEvent(e: RevenueCatEvent, opts: MapOptions): MapResult {
  if (e.type === "TEST") return { kind: "ignored", reason: "test event" };
  if (e.environment === "SANDBOX" && !opts.acceptSandbox) return { kind: "ignored", reason: "sandbox event" };

  const source = storeToSource(e.store);
  if (!source) return { kind: "ignored", reason: `store ${e.store ?? "unknown"} not handled here` };

  const at = e.event_timestamp_ms;
  const base = {
    source,
    productId: e.product_id ?? null,
    periodType: periodType(e),
    expiresAt: e.expiration_at_ms ?? null,
    lastEventAt: at,
  };

  if (e.type === "TRANSFER") {
    // Purchases moved between app user ids (for example a restore on a second account).
    const from = (e.transferred_from ?? []).filter(isSupabaseUserId);
    if (from.length === 0) return { kind: "ignored", reason: "transfer without Supabase user ids" };
    return {
      kind: "updates",
      updates: from.map((userId) => ({
        ...base,
        userId,
        status: "revoked",
        willRenew: false,
        billingIssue: false,
      })),
    };
  }

  if (!isSupabaseUserId(e.app_user_id)) {
    return { kind: "ignored", reason: `app_user_id ${e.app_user_id} is not a Supabase user id` };
  }
  const userId = e.app_user_id;

  switch (e.type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION":
    case "PRODUCT_CHANGE":
    case "SUBSCRIPTION_EXTENDED":
      return { kind: "updates", updates: [{ ...base, userId, status: "active", willRenew: true, billingIssue: false }] };

    case "NON_RENEWING_PURCHASE":
      return { kind: "updates", updates: [{ ...base, userId, status: "active", willRenew: false, billingIssue: false }] };

    case "CANCELLATION":
      // A refund through support ends access now. A normal cancel keeps access until expiry.
      if (e.cancel_reason === "CUSTOMER_SUPPORT") {
        return { kind: "updates", updates: [{ ...base, userId, status: "revoked", willRenew: false, billingIssue: false }] };
      }
      return { kind: "updates", updates: [{ ...base, userId, status: "active", willRenew: false, billingIssue: false }] };

    case "BILLING_ISSUE":
      return { kind: "updates", updates: [{ ...base, userId, status: "active", willRenew: true, billingIssue: true }] };

    case "EXPIRATION":
      return { kind: "updates", updates: [{ ...base, userId, status: "expired", willRenew: false, billingIssue: false }] };

    default:
      return { kind: "ignored", reason: `event type ${e.type} not handled` };
  }
}
