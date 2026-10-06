// Recountix payment gateway webhook.
// Supports Razorpay signature verification and generic gateway payload capture.
// Required env:
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RAZORPAY_WEBHOOK_SECRET
// Optional env:
// PAYMENT_WEBHOOK_REQUIRE_SIGNATURE=true

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-razorpay-signature, x-razorpay-event-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacSha256(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function getRazorpayPayment(payload: any) {
  return payload?.payload?.payment?.entity || payload?.payment?.entity || payload?.payment || {};
}

function getPaymentLinkMatch(payment: any) {
  return {
    gateway_payment_id: payment?.id || "",
    gateway_order_id: payment?.order_id || "",
    gateway_link_id: payment?.payment_link_id || payment?.invoice_id || "",
    amount: Number(payment?.amount || 0) / 100,
    currency: payment?.currency || "INR",
    status: payment?.status || "",
    method: payment?.method || "gateway"
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") || "";
  const eventId = req.headers.get("x-razorpay-event-id") || crypto.randomUUID();
  const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "";
  const requireSignature = (Deno.env.get("PAYMENT_WEBHOOK_REQUIRE_SIGNATURE") || "true") !== "false";

  if (requireSignature) {
    if (!webhookSecret || !signature) {
      return new Response(JSON.stringify({ error: "missing_signature" }), { status: 401, headers: corsHeaders });
    }
    const expected = await hmacSha256(rawBody, webhookSecret);
    if (!safeEqual(expected, signature)) {
      return new Response(JSON.stringify({ error: "invalid_signature" }), { status: 401, headers: corsHeaders });
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (_err) {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: corsHeaders });
  }

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
  const serviceKey = (Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "server_not_configured" }), { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const eventName = payload?.event || "payment.webhook";
  const payment = getRazorpayPayment(payload);
  const match = getPaymentLinkMatch(payment);

  const { error: eventError } = await supabase
    .from("payment_webhook_events")
    .upsert({
      gateway: "razorpay",
      event_id: eventId,
      event_name: eventName,
      signature_valid: true,
      payload
    }, { onConflict: "gateway,event_id" });

  if (eventError && eventError.code !== "23505") {
    return new Response(JSON.stringify({ error: eventError.message }), { status: 500, headers: corsHeaders });
  }

  const paid = ["payment.captured", "payment_link.paid", "invoice.paid"].includes(eventName) || match.status === "captured";
  if (!paid) {
    return new Response(JSON.stringify({ ok: true, ignored: eventName }), { headers: corsHeaders });
  }

  let paymentLink: any = null;
  if (match.gateway_link_id) {
    const { data } = await supabase
      .from("payment_links")
      .select("*")
      .eq("gateway_link_id", match.gateway_link_id)
      .maybeSingle();
    paymentLink = data;
  }
  if (!paymentLink && match.gateway_order_id) {
    const { data } = await supabase
      .from("payment_links")
      .select("*")
      .eq("gateway_order_id", match.gateway_order_id)
      .maybeSingle();
    paymentLink = data;
  }
  if (!paymentLink) {
    return new Response(JSON.stringify({ ok: true, captured: true, matched: false }), { headers: corsHeaders });
  }

  const amount = match.amount || Number(paymentLink.amount || 0);
  const { data: recovery, error: recoveryError } = await supabase
    .from("recoveries")
    .insert({
      shop_id: paymentLink.shop_id,
      customer_id: paymentLink.customer_id,
      amount,
      recovery_date: new Date().toISOString().slice(0, 10),
      payment_mode: match.method || "gateway",
      gateway_payment_id: match.gateway_payment_id,
      gateway_order_id: match.gateway_order_id,
      remarks: "Auto-confirmed by payment webhook"
    })
    .select()
    .single();

  if (recoveryError) {
    return new Response(JSON.stringify({ error: recoveryError.message }), { status: 500, headers: corsHeaders });
  }

  await supabase
    .from("payment_links")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      recovery_id: recovery?.id || null,
      updated_at: new Date().toISOString()
    })
    .eq("id", paymentLink.id);

  await supabase.rpc("recalc_customer_aging", { p_customer_id: paymentLink.customer_id }).catch(() => null);

  return new Response(JSON.stringify({ ok: true, recovery_id: recovery?.id || null }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});
