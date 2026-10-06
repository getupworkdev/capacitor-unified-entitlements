import { mapStripeEvent, verifyStripeSignature, type StripeEvent } from "../../src/core/stripe.js";
import { adminClient, applyUpdate, claimEvent, env, json, recordOutcome, releaseEvent } from "./_shared.js";

/**
 * POST /.netlify/functions/stripe-webhook
 * Stripe dashboard > Developers > Webhooks, events:
 *   customer.subscription.created / updated / deleted / paused / resumed
 *
 * If the existing web app already has a Stripe webhook, this does not replace
 * it: add the entitlement write to the existing handler, or point a second
 * endpoint here. Either way the signature is checked over the raw body.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const raw = await req.text(); // raw bytes, never JSON.parse then stringify before verifying
  const ok = verifyStripeSignature(
    raw,
    req.headers.get("stripe-signature"),
    env("STRIPE_WEBHOOK_SECRET"),
    Math.floor(Date.now() / 1000),
  );
  if (!ok) return json(400, { error: "bad signature" });

  const evt = JSON.parse(raw) as StripeEvent;
  const db = adminClient();
  if (!(await claimEvent(db, "stripe", evt.id, evt.type))) return json(200, { duplicate: true });

  const mapped = mapStripeEvent(evt);
  if (mapped.kind === "ignored") {
    await recordOutcome(db, "stripe", evt.id, `ignored: ${mapped.reason}`);
    return json(200, { ignored: mapped.reason });
  }
  try {
    const result = await applyUpdate(db, mapped.update);
    await recordOutcome(db, "stripe", evt.id, result);
    return json(200, { result });
  } catch (err) {
    await releaseEvent(db, "stripe", evt.id);
    console.error("stripe webhook failed", evt.id, err);
    return json(500, { error: "processing failed, retry" });
  }
};
