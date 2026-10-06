import { describe, expect, it } from "vitest";
import {
  mapRevenueCatEvent,
  mapStripeEvent,
  signStripePayload,
  verifyRevenueCatAuth,
  verifyStripeSignature,
  type RevenueCatEvent,
  type StripeEvent,
} from "../src/index.js";

const U = "6f1c2a0e-1111-4222-8333-944455556666";
const U2 = "0a9b8c7d-2222-4333-8444-955566667777";
const T = 1_791_300_000_000;

const rc = (over: Partial<RevenueCatEvent>): RevenueCatEvent => ({
  id: "evt_1",
  type: "INITIAL_PURCHASE",
  app_user_id: U,
  product_id: "premium_monthly",
  period_type: "NORMAL",
  expiration_at_ms: T + 30 * 86_400_000,
  event_timestamp_ms: T,
  store: "APP_STORE",
  environment: "PRODUCTION",
  ...over,
});
const opts = { acceptSandbox: false };
const first = (e: RevenueCatEvent) => {
  const r = mapRevenueCatEvent(e, opts);
  if (r.kind !== "updates") throw new Error(`expected updates, got ${r.reason}`);
  return r.updates[0]!;
};

describe("RevenueCat mapping", () => {
  it("maps a trial purchase on iOS", () => {
    expect(first(rc({ period_type: "TRIAL" }))).toMatchObject({
      userId: U,
      source: "app_store",
      status: "active",
      periodType: "trial",
      willRenew: true,
    });
  });

  it("keeps access after a normal cancel, revokes after a support refund", () => {
    expect(first(rc({ type: "CANCELLATION", cancel_reason: "UNSUBSCRIBE" }))).toMatchObject({ status: "active", willRenew: false });
    expect(first(rc({ type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT" }))).toMatchObject({ status: "revoked" });
  });

  it("flags billing issues without cutting access, expires on EXPIRATION", () => {
    expect(first(rc({ type: "BILLING_ISSUE", store: "PLAY_STORE" }))).toMatchObject({ source: "play_store", status: "active", billingIssue: true });
    expect(first(rc({ type: "EXPIRATION" }))).toMatchObject({ status: "expired" });
  });

  it("treats a non-renewing purchase without expiry as lifetime", () => {
    expect(first(rc({ type: "NON_RENEWING_PURCHASE", expiration_at_ms: null }))).toMatchObject({
      periodType: "lifetime",
      expiresAt: null,
      willRenew: false,
    });
  });

  it("revokes the old owner on TRANSFER", () => {
    const r = mapRevenueCatEvent(rc({ type: "TRANSFER", transferred_from: [U2, "$RCAnonymousID:abc"], transferred_to: [U] }), opts);
    expect(r.kind === "updates" && r.updates.map((u) => [u.userId, u.status])).toEqual([[U2, "revoked"]]);
  });

  it("ignores anonymous ids, sandbox in production, test events and Stripe-store events", () => {
    expect(mapRevenueCatEvent(rc({ app_user_id: "$RCAnonymousID:123" }), opts).kind).toBe("ignored");
    expect(mapRevenueCatEvent(rc({ environment: "SANDBOX" }), opts).kind).toBe("ignored");
    expect(mapRevenueCatEvent(rc({ environment: "SANDBOX" }), { acceptSandbox: true }).kind).toBe("updates");
    expect(mapRevenueCatEvent(rc({ type: "TEST" }), opts).kind).toBe("ignored");
    expect(mapRevenueCatEvent(rc({ store: "STRIPE" }), opts).kind).toBe("ignored");
  });

  it("checks the Authorization header in constant time", () => {
    expect(verifyRevenueCatAuth("Bearer s3cret", "Bearer s3cret")).toBe(true);
    expect(verifyRevenueCatAuth("Bearer wrong!", "Bearer s3cret")).toBe(false);
    expect(verifyRevenueCatAuth(null, "Bearer s3cret")).toBe(false);
  });
});

describe("Stripe", () => {
  const secret = "whsec_test";
  const now = 1_791_300_000;

  it("verifies a signature over the raw body and rejects re-serialised JSON", () => {
    const raw = '{"id":"evt_1","type":"customer.subscription.updated"}';
    const header = signStripePayload(raw, secret, now);
    expect(verifyStripeSignature(raw, header, secret, now)).toBe(true);
    expect(verifyStripeSignature(JSON.stringify(JSON.parse(raw), null, 2), header, secret, now)).toBe(false);
  });

  it("rejects old timestamps, wrong secrets and malformed headers", () => {
    const raw = "{}";
    expect(verifyStripeSignature(raw, signStripePayload(raw, secret, now - 1000), secret, now)).toBe(false);
    expect(verifyStripeSignature(raw, signStripePayload(raw, "other", now), secret, now)).toBe(false);
    expect(verifyStripeSignature(raw, "garbage", secret, now)).toBe(false);
    expect(verifyStripeSignature(raw, `t=${now},v1=zz`, secret, now)).toBe(false);
  });

  const evt = (status: StripeEvent["data"]["object"]["status"], over: Partial<StripeEvent> = {}, cancelAtEnd = false): StripeEvent => ({
    id: "evt_s",
    type: "customer.subscription.updated",
    created: now,
    data: {
      object: {
        id: "sub_1",
        status,
        cancel_at_period_end: cancelAtEnd,
        metadata: { supabase_user_id: U },
        items: { data: [{ current_period_end: now + 2_592_000, price: { id: "price_gbp_5" } }] },
      },
    },
    ...over,
  });

  it("maps trialing, active, past_due and cancel-at-period-end", () => {
    const ok = (e: StripeEvent) => {
      const r = mapStripeEvent(e);
      if (r.kind !== "update") throw new Error(r.reason);
      return r.update;
    };
    expect(ok(evt("trialing"))).toMatchObject({ status: "active", periodType: "trial", source: "stripe", willRenew: true });
    expect(ok(evt("past_due"))).toMatchObject({ status: "active", billingIssue: true });
    expect(ok(evt("active", {}, true))).toMatchObject({ status: "active", willRenew: false });
    expect(ok(evt("canceled"))).toMatchObject({ status: "expired" });
    expect(ok(evt("active", { type: "customer.subscription.deleted" }))).toMatchObject({ status: "expired" });
    expect(ok(evt("active")).expiresAt).toBe((now + 2_592_000) * 1000);
  });

  it("ignores subscriptions without the Supabase user id and unrelated events", () => {
    const e = evt("active");
    e.data.object.metadata = {};
    expect(mapStripeEvent(e).kind).toBe("ignored");
    expect(mapStripeEvent(evt("active", { type: "invoice.paid" })).kind).toBe("ignored");
    expect(mapStripeEvent(evt("incomplete")).kind).toBe("ignored");
  });
});
