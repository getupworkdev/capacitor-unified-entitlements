import { describe, expect, it } from "vitest";
import { manageHint, paywallDecision, resolveAccess, shouldApply, type EntitlementRow } from "../src/index.js";

const NOW = Date.UTC(2026, 9, 6);
const DAY = 86_400_000;
const U = "6f1c2a0e-1111-4222-8333-944455556666";

const row = (over: Partial<EntitlementRow>): EntitlementRow => ({
  userId: U,
  source: "stripe",
  productId: "price_monthly",
  status: "active",
  periodType: "normal",
  expiresAt: NOW + 10 * DAY,
  willRenew: true,
  billingIssue: false,
  lastEventAt: NOW - DAY,
  ...over,
});

describe("resolveAccess", () => {
  it("is premium when any single source is active", () => {
    const a = resolveAccess([row({ source: "stripe", status: "expired", expiresAt: NOW - DAY }), row({ source: "app_store" })], NOW);
    expect(a.premium).toBe(true);
    expect(a.activeSources).toEqual(["app_store"]);
    expect(a.managedOn).toBe("app_store");
  });

  it("treats a cancelled-but-paid-through subscription as active until expiry", () => {
    expect(resolveAccess([row({ willRenew: false })], NOW).premium).toBe(true);
    expect(resolveAccess([row({ willRenew: false, expiresAt: NOW - 1 })], NOW).premium).toBe(false);
  });

  it("ends access immediately on revoke (refund or transfer)", () => {
    expect(resolveAccess([row({ status: "revoked" })], NOW).premium).toBe(false);
  });

  it("applies a grace window only when asked", () => {
    const r = [row({ expiresAt: NOW - DAY })];
    expect(resolveAccess(r, NOW).premium).toBe(false);
    expect(resolveAccess(r, NOW, 3 * DAY).premium).toBe(true);
  });

  it("reports lifetime as non-expiring and prefers it", () => {
    const a = resolveAccess([row({ source: "stripe" }), row({ source: "play_store", expiresAt: null, periodType: "lifetime" })], NOW);
    expect(a.expiresAt).toBeNull();
    expect(a.managedOn).toBe("play_store");
  });

  it("flags trial and billing issues", () => {
    expect(resolveAccess([row({ periodType: "trial" })], NOW).inTrial).toBe(true);
    expect(resolveAccess([row({ periodType: "trial" }), row({ source: "app_store" })], NOW).inTrial).toBe(false);
    expect(resolveAccess([row({ billingIssue: true })], NOW).billingIssue).toBe(true);
  });

  it("is not premium with no rows", () => {
    expect(resolveAccess([], NOW)).toMatchObject({ premium: false, managedOn: null, expiresAt: null });
  });
});

describe("paywallDecision", () => {
  it("never offers an in-app purchase to someone already paying on the web", () => {
    const rows = [row({ source: "stripe" })];
    expect(paywallDecision(resolveAccess(rows, NOW), rows)).toEqual({ show: false, managedOn: "stripe" });
  });

  it("offers the trial copy only to users with no history", () => {
    expect(paywallDecision(resolveAccess([], NOW), [])).toEqual({ show: true, offerTrial: true });
    const lapsed = [row({ status: "expired", expiresAt: NOW - DAY })];
    expect(paywallDecision(resolveAccess(lapsed, NOW), lapsed)).toEqual({ show: true, offerTrial: false });
  });
});

describe("manageHint", () => {
  it("points the user at the store that actually bills them", () => {
    const apple = resolveAccess([row({ source: "app_store" })], NOW);
    expect(manageHint(apple, "android")).toContain("billed through Apple");
    expect(manageHint(apple, "ios")).toContain("Settings > Apple ID");
    expect(manageHint(resolveAccess([row({})], NOW), "ios")).toContain("billed on the web");
  });
});

describe("shouldApply", () => {
  it("drops events older than the stored state", () => {
    const stored = row({ lastEventAt: NOW });
    expect(shouldApply(stored, row({ status: "expired", lastEventAt: NOW - 1 }))).toBe("stale");
    expect(shouldApply(stored, row({ status: "expired", lastEventAt: NOW + 1 }))).toBe("applied");
    expect(shouldApply(stored, row({ lastEventAt: NOW + 1 }))).toBe("unchanged");
    expect(shouldApply(undefined, stored)).toBe("applied");
  });
});
