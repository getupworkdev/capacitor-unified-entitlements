import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EntitlementUpdate } from "../../src/core/types.js";

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

/** Service-role client. Lives only in serverless functions, never in the app bundle. */
export function adminClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Record the delivery first. If the event id is already there, this delivery
 * is a retry and nothing else runs.
 */
export async function claimEvent(
  db: SupabaseClient,
  provider: "stripe" | "revenuecat",
  eventId: string,
  eventType: string,
): Promise<boolean> {
  const { error } = await db.from("webhook_events").insert({ provider, event_id: eventId, event_type: eventType });
  if (!error) return true;
  if (error.code === "23505") return false; // unique violation: already processed
  throw error;
}

/**
 * Undo a claim when processing fails, so the provider's retry is processed
 * instead of being mistaken for a duplicate.
 */
export async function releaseEvent(db: SupabaseClient, provider: string, eventId: string) {
  await db.from("webhook_events").delete().match({ provider, event_id: eventId });
}

export async function recordOutcome(db: SupabaseClient, provider: string, eventId: string, outcome: string) {
  await db.from("webhook_events").update({ outcome }).match({ provider, event_id: eventId });
}

export async function applyUpdate(db: SupabaseClient, u: EntitlementUpdate): Promise<string> {
  const { data, error } = await db.rpc("apply_entitlement", {
    p_user_id: u.userId,
    p_source: u.source,
    p_product_id: u.productId,
    p_status: u.status,
    p_period_type: u.periodType,
    p_expires_at: u.expiresAt === null ? null : new Date(u.expiresAt).toISOString(),
    p_will_renew: u.willRenew,
    p_billing_issue: u.billingIssue,
    p_last_event_at: new Date(u.lastEventAt).toISOString(),
  });
  if (error) throw error;
  return data as string;
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
