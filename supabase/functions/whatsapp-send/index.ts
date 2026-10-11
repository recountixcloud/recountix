// Recountix official WhatsApp Business Cloud API sender.
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID.
// Optional: WHATSAPP_GRAPH_API_VERSION (defaults to v23.0).
// Request body never accepts provider credentials. It validates the Recountix session token first.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  const accessToken = (Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "").trim();
  const phoneNumberId = (Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "").trim();
  const graphVersion = (Deno.env.get("WHATSAPP_GRAPH_API_VERSION") || "v23.0").trim();

  if (!supabaseUrl || !serviceKey || !accessToken || !phoneNumberId) {
    return json({ error: "whatsapp_api_not_configured", detail: "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID as Edge Function secrets." }, 503);
  }

  const body = await req.json().catch(() => ({}));
  const sessionToken = String(body.session_token || "").trim();
  const to = String(body.to || "").replace(/\D/g, "");
  const customerName = String(body.customer_name || "").trim().slice(0, 120);
  const outstanding = String(body.outstanding || "").trim().slice(0, 80);
  const companyName = String(body.company_name || "").trim().slice(0, 120);

  if (!sessionToken) return json({ error: "secure_session_required" }, 401);
  if (to.length < 11 || to.length > 15) return json({ error: "invalid_recipient_phone" }, 400);
  if (!customerName || !outstanding || !companyName) return json({ error: "template_variables_required" }, 400);
  if (!/^[A-Za-z0-9_]{1,512}$/.test(phoneNumberId)) return json({ error: "invalid_phone_number_id_secret" }, 500);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: session, error: sessionError } = await supabase.rpc("app_validate_session", { p_token: sessionToken });
  if (sessionError || !session || session.valid !== true) return json({ error: "invalid_or_expired_session" }, 401);

  const templateName = (Deno.env.get("WHATSAPP_TEMPLATE_NAME") || "recountix_payment_reminder").trim();
  const templateLanguage = (Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE") || "en").trim();
  if (!/^[a-zA-Z0-9_]{1,512}$/.test(templateName) || !/^[a-zA-Z_]{2,10}(-[a-zA-Z0-9]{2,10})?$/.test(templateLanguage)) {
    return json({ error: "invalid_template_configuration" }, 500);
  }

  const endpoint = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;
  let providerResponse: Response;
  try {
    providerResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLanguage },
          components: [{
            type: "body",
            parameters: [
              { type: "text", text: customerName },
              { type: "text", text: outstanding },
              { type: "text", text: companyName }
            ]
          }]
        }
      })
    });
  } catch (_) {
    return json({ error: "whatsapp_provider_unreachable" }, 502);
  }

  const result = await providerResponse.json().catch(() => ({}));
  if (!providerResponse.ok) {
    // Do not return the request headers, access token, or any secrets.
    return json({
      error: "whatsapp_provider_rejected_message",
      provider_status: providerResponse.status,
      detail: result?.error?.message || "Meta rejected the message. Check sender setup, template approval and template variables."
    }, 502);
  }

  return json({ ok: true, message_id: result?.messages?.[0]?.id || null, status: "accepted" });
});
