import type { EntitlementRow, EntitlementUpdate, Platform, Source } from "./types.js";

export interface Access {
  premium: boolean;
  /** Sources currently granting access, best first. */
  activeSources: Source[];
  /** Latest expiry across active sources; null if any active source never expires. */
  expiresAt: number | null;
  inTrial: boolean;
  billingIssue: boolean;
  /** Where the user manages the subscription that is granting access. */
  managedOn: Source | null;
}

const SOURCE_PRIORITY: Source[] = ["promotional", "app_store", "play_store", "stripe"];

/**
 * Collapse every source a user has into one answer. A user is premium if ANY
 * source is active and unexpired (plus an optional grace window for store
 * billing retries). This is the only function the UI should ask.
 */
export function resolveAccess(rows: EntitlementRow[], now: number, graceMs = 0): Access {
  const live = rows.filter(
    (r) => r.status === "active" && (r.expiresAt === null || r.expiresAt + graceMs > now),
  );
  live.sort((a, b) => {
    // Non-expiring first, then latest expiry, then source priority.
    if (a.expiresAt === null && b.expiresAt !== null) return -1;
    if (b.expiresAt === null && a.expiresAt !== null) return 1;
    if (a.expiresAt !== b.expiresAt) return (b.expiresAt ?? 0) - (a.expiresAt ?? 0);
    return SOURCE_PRIORITY.indexOf(a.source) - SOURCE_PRIORITY.indexOf(b.source);
  });

  const expiresAt = live.some((r) => r.expiresAt === null)
    ? null
    : live.reduce<number | null>((max, r) => (max === null || (r.expiresAt ?? 0) > max ? r.expiresAt : max), null);

  return {
    premium: live.length > 0,
    activeSources: live.map((r) => r.source),
    expiresAt: live.length ? expiresAt : null,
    inTrial: live.length > 0 && live.every((r) => r.periodType === "trial"),
    billingIssue: live.some((r) => r.billingIssue),
    managedOn: live[0]?.source ?? null,
  };
}

export type PaywallDecision =
  | { show: false; managedOn: Source }
  | { show: true; offerTrial: boolean };

/**
 * Whether to show the purchase screen. Any active source hides it on every
 * platform: someone paying through Stripe is never offered an Apple or Google
 * subscription on top, which is how double billing happens.
 * The trial is offered only to users who have never had any entitlement row.
 */
export function paywallDecision(access: Access, history: EntitlementRow[]): PaywallDecision {
  if (access.premium && access.managedOn) return { show: false, managedOn: access.managedOn };
  return { show: true, offerTrial: history.length === 0 };
}

/** Text for the "Manage subscription" row, so a user is pointed at the store that actually bills them. */
export function manageHint(access: Access, platform: Platform): string | null {
  switch (access.managedOn) {
    case null:
      return null;
    case "stripe":
      return "Your plan is billed on the web. Manage it from your account page on the website.";
    case "app_store":
      return platform === "ios"
        ? "Manage your plan in Settings > Apple ID > Subscriptions."
        : "Your plan is billed through Apple. Manage it on your iPhone in Settings > Apple ID > Subscriptions.";
    case "play_store":
      return platform === "android"
        ? "Manage your plan in Google Play > Payments & subscriptions."
        : "Your plan is billed through Google Play. Manage it in the Play Store app.";
    case "promotional":
      return "You have complimentary access.";
  }
}

export type ApplyResult = "applied" | "stale" | "unchanged";

/**
 * Decide whether an incoming update should overwrite the stored row.
 * Webhooks arrive late, twice, and out of order; the event timestamp wins.
 * The SQL function apply_entitlement() enforces the same rule in the database.
 */
export function shouldApply(existing: EntitlementRow | undefined, update: EntitlementUpdate): ApplyResult {
  if (!existing) return "applied";
  if (update.lastEventAt < existing.lastEventAt) return "stale";
  const same =
    existing.status === update.status &&
    existing.expiresAt === update.expiresAt &&
    existing.willRenew === update.willRenew &&
    existing.billingIssue === update.billingIssue &&
    existing.productId === update.productId &&
    existing.periodType === update.periodType;
  return same ? "unchanged" : "applied";
}
