-- ============================================================
-- Recountix - Super Admin Module Migration
-- Adds: license/plan fields on shops + subscriptions table
-- Safe to run multiple times (IF NOT EXISTS / ON CONFLICT guards)
-- Run AFTER database/supabase_schema.sql
-- ============================================================

-- ------------------------------------------------------------
-- SHOPS: license / plan fields
-- ------------------------------------------------------------
ALTER TABLE shops ADD COLUMN IF NOT EXISTS plan_name TEXT DEFAULT 'Basic';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS license_expiry DATE;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS max_users INT DEFAULT 5;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';

-- ------------------------------------------------------------
-- SUBSCRIPTIONS (one active history per shop, renewals add rows)
-- status: 'active' | 'expiring' | 'expired' | 'cancelled'
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    plan_name TEXT NOT NULL DEFAULT 'Basic',
    amount NUMERIC(12,2) DEFAULT 0,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expiring','expired','cancelled')),
    remarks TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_shop ON subscriptions(shop_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_end ON subscriptions(end_date);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscriptions FROM anon, authenticated;

-- ------------------------------------------------------------
-- AUDIT LOG (who changed what)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    username TEXT,
    action TEXT NOT NULL,          -- e.g. 'shop.create', 'shop.deactivate', 'subscription.renew'
    entity_type TEXT,              -- e.g. 'shop', 'subscription', 'customer'
    entity_id TEXT,
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_shop ON audit_log(shop_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.audit_log FROM anon, authenticated;

-- ------------------------------------------------------------
-- SEED: give existing 3 shops a 1-year subscription + license_expiry
-- ------------------------------------------------------------
UPDATE shops SET license_expiry = (CURRENT_DATE + INTERVAL '1 year')::date, plan_name = 'Standard'
WHERE license_expiry IS NULL;

INSERT INTO subscriptions (shop_id, plan_name, amount, start_date, end_date, status)
SELECT id, 'Standard', 5000, CURRENT_DATE, (CURRENT_DATE + INTERVAL '1 year')::date, 'active'
FROM shops s
WHERE NOT EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.shop_id = s.id);

SELECT 'Super Admin migration applied successfully' AS status;
