// Recountix reminder queue materializer.
// This function only creates internal reminder_queue rows inside Supabase.
// It requires a cron secret and a single shop_id; it does not send customer/debt data externally.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-recountix-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const cronSecret = Deno.env.get("RECOUNTIX_CRON_SECRET") || "";
  if (!cronSecret) {
    return new Response(JSON.stringify({ error: "cron_secret_not_configured" }), { status: 500, headers: corsHeaders });
  }
  if (req.headers.get("x-recountix-cron-secret") !== cronSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const supabaseUrl = (Deno.env.get("PROJECT_URL") || Deno.env.get("SUPABASE_URL") || "https://niroqvhpyrwulzwiyctl.supabase.co").trim();
  const serviceKey = (Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim().replace(/[^A-Za-z0-9._-]/g, "");
  if (!supabaseUrl || !serviceKey || !serviceKey.startsWith("eyJ")) {
    return new Response(JSON.stringify({ error: "server_not_configured_or_invalid_service_key" }), { status: 500, headers: corsHeaders });
  }

  const body = await req.json().catch(() => ({}));
  const shopId = String(body.shop_id || "").trim();
  if (!shopId) {
    return new Response(JSON.stringify({ error: "shop_id_required" }), { status: 400, headers: corsHeaders });
  }

  const channel = String(body.channel || "whatsapp").trim() || "whatsapp";
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await supabase.rpc("app_enqueue_due_reminders", {
    p_shop_id: shopId,
    p_channel: channel
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ ok: true, shop_id: shopId, channel, queued: Number(data || 0) }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});
