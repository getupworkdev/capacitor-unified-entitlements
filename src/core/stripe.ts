import { createHmac, timingSafeEqual } from "node:crypto";
import type { EntitlementUpdate } from "./types.js";

/**
 * Verify a Stripe-Signature header without the Stripe SDK.
 * Header looks like: t=1700000000,v1=hex,v1=hex
 * The signed payload is `${t}.${rawBody}`. The raw body must be the exact
 * bytes Stripe sent: parsing and re-serialising the JSON breaks the check.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isFinite(t) || sigs.length === 0) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return sigs.some((s) => {
    if (!/^[0-9a-f]+$/i.test(s)) return false;
    const got = Buffer.from(s, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** Test helper and local tooling: produce a valid header. */
export function signStripePayload(rawBody: string, secret: string, t: number): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** The subset of a Stripe subscription object this kit reads. */
export interface StripeSubscription {
  id: string;
  status: "trialing" | "active" | "past_due" | "unpaid" | "canceled" | "incomplete" | "incomplete_expired" | "paused";
  cancel_at_period_end: boolean;
  /** Older API versions put the period here; newer ones put it on each item. */
  current_period_end?: number;
  trial_end?: number | null;
  metadata?: Record<string, string>;
  items?: { data: Array<{ current_period_end?: number; price?: { id: string } }> };
}

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: StripeSubscription };
}

const HANDLED = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

export type StripeMapResult = { kind: "update"; update: EntitlementUpdate } | { kind: "ignored"; reason: string };

/**
 * Map a subscription event to the user's Stripe entitlement row.
 * The Supabase user id travels in subscription metadata, set at checkout:
 *   subscription_data: { metadata: { supabase_user_id: user.id } }
 */
export function mapStripeEvent(evt: StripeEvent): StripeMapResult {
  if (!HANDLED.has(evt.type)) return { kind: "ignored", reason: `event ${evt.type} not handled` };
  const sub = evt.data.object;
  const userId = sub.metadata?.supabase_user_id;
  if (!userId) return { kind: "ignored", reason: `subscription ${sub.id} has no supabase_user_id metadata` };

  const periodEnd = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
  const expiresAt = periodEnd ? periodEnd * 1000 : null;
  const productId = sub.items?.data?.[0]?.price?.id ?? null;

  let status: EntitlementUpdate["status"];
  let billingIssue = false;
  switch (sub.status) {
    case "trialing":
    case "active":
      status = "active";
      break;
    case "past_due":
      // Stripe is retrying the card. Keep access, flag it so the app can nudge.
      status = "active";
      billingIssue = true;
      break;
    case "paused":
    case "unpaid":
    case "canceled":
    case "incomplete_expired":
      status = "expired";
      break;
    case "incomplete":
      return { kind: "ignored", reason: "first payment not completed yet" };
  }
  if (evt.type === "customer.subscription.deleted") status = "expired";

  return {
    kind: "update",
    update: {
      userId,
      source: "stripe",
      productId,
      status,
      periodType: sub.status === "trialing" ? "trial" : "normal",
      expiresAt,
      willRenew: status === "active" && !sub.cancel_at_period_end,
      billingIssue,
      lastEventAt: evt.created * 1000,
    },
  };
}
