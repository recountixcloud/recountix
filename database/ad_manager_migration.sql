-- Recountix Rc.0.05 Ad Manager
CREATE TABLE IF NOT EXISTS public.ads (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), title TEXT NOT NULL, description TEXT DEFAULT '', image_url TEXT, link_url TEXT, cta_text TEXT DEFAULT 'Learn More', target_type TEXT NOT NULL DEFAULT 'all' CHECK (target_type IN ('all','shop')), target_shop_id UUID REFERENCES public.shops(id) ON DELETE CASCADE, start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), end_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'), is_active BOOLEAN NOT NULL DEFAULT true, clicks INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ads_public_read" ON public.ads;
DROP POLICY IF EXISTS "ads_public_manage" ON public.ads;
REVOKE ALL ON TABLE public.ads FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.increment_ad_click(ad_id UUID) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp
AS $ UPDATE public.ads SET clicks=clicks+1 WHERE id=ad_id; $;
REVOKE ALL ON FUNCTION public.increment_ad_click(UUID) FROM PUBLIC, anon, authenticated;
