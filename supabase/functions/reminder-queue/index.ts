// Recountix reminder queue materializer.
// This function only creates internal reminder_queue rows inside Supabase.
// It does not send customer/debt data to any external provider.

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
  if (cronSecret && req.headers.get("x-recountix-cron-secret") !== cronSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "server_not_configured" }), { status: 500, headers: corsHeaders });
  }

  const body = await req.json().catch(() => ({}));
  const channel = body.channel || "whatsapp";
  const shopId = body.shop_id || null;
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const shopQuery = supabase.from("shops").select("id").eq("is_active", true);
  const { data: shops, error: shopError } = shopId
    ? await shopQuery.eq("id", shopId)
    : await shopQuery;

  if (shopError) {
    return new Response(JSON.stringify({ error: shopError.message }), { status: 500, headers: corsHeaders });
  }

  const results = [];
  for (const shop of shops || []) {
    const { data, error } = await supabase.rpc("app_enqueue_due_reminders", {
      p_shop_id: shop.id,
      p_channel: channel
    });
    results.push({ shop_id: shop.id, queued: Number(data || 0), error: error?.message || null });
  }

  return new Response(JSON.stringify({ ok: true, channel, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});
