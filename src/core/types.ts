/** Where a subscription was bought. One row per user per source. */
export type Source = "stripe" | "app_store" | "play_store" | "promotional";

export type EntitlementStatus =
  | "active" // paid or in trial, renewing or not
  | "expired" // period ended
  | "revoked"; // refunded or transferred away: access ends immediately

export type PeriodType = "trial" | "intro" | "normal" | "lifetime";

/** Mirrors one row of public.entitlements. Times are epoch milliseconds. */
export interface EntitlementRow {
  userId: string;
  source: Source;
  productId: string | null;
  status: EntitlementStatus;
  periodType: PeriodType;
  /** null means non-expiring (lifetime or promotional without end). */
  expiresAt: number | null;
  willRenew: boolean;
  billingIssue: boolean;
  /** Timestamp of the provider event that produced this state. Used to drop out-of-order webhooks. */
  lastEventAt: number;
}

/** A change a webhook wants to apply. Same shape as a row. */
export type EntitlementUpdate = EntitlementRow;

export type Platform = "web" | "ios" | "android";
