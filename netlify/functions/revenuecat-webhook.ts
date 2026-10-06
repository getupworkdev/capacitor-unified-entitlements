import { mapRevenueCatEvent, verifyRevenueCatAuth, type RevenueCatPayload } from "../../src/core/revenuecat.js";
import { adminClient, applyUpdate, claimEvent, env, json, recordOutcome, releaseEvent } from "./_shared.js";

/**
 * POST /.netlify/functions/revenuecat-webhook
 * RevenueCat dashboard > Integrations > Webhooks:
 *   URL: https://<site>/.netlify/functions/revenuecat-webhook
 *   Authorization header: the value of REVENUECAT_WEBHOOK_AUTH
 *
 * Always answer 200 for events we deliberately ignore, otherwise RevenueCat
 * retries them for days. Answer 5xx only when a retry could succeed.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (!verifyRevenueCatAuth(req.headers.get("authorization"), env("REVENUECAT_WEBHOOK_AUTH"))) {
    return json(401, { error: "unauthorized" });
  }

  let payload: RevenueCatPayload;
  try {
    payload = (await req.json()) as RevenueCatPayload;
  } catch {
    return json(400, { error: "invalid json" });
  }
  const e = payload.event;
  if (!e?.id || !e.type) return json(400, { error: "missing event" });

  const db = adminClient();
  if (!(await claimEvent(db, "revenuecat", e.id, e.type))) return json(200, { duplicate: true });

  const mapped = mapRevenueCatEvent(e, { acceptSandbox: process.env.ACCEPT_SANDBOX === "true" });
  if (mapped.kind === "ignored") {
    await recordOutcome(db, "revenuecat", e.id, `ignored: ${mapped.reason}`);
    return json(200, { ignored: mapped.reason });
  }

  try {
    const results: string[] = [];
    for (const u of mapped.updates) results.push(await applyUpdate(db, u));
    await recordOutcome(db, "revenuecat", e.id, results.join(","));
    return json(200, { results });
  } catch (err) {
    await releaseEvent(db, "revenuecat", e.id);
    console.error("revenuecat webhook failed", e.id, err);
    return json(500, { error: "processing failed, retry" });
  }
};
