-- ============================================================
-- FIX: Missing columns on shops (and related tables)
-- Error: Could not find the 'code' column of 'shops' in the schema cache
-- Run this ONCE in Supabase → SQL Editor → Run
-- Safe to run multiple times
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Ensure shops table exists (minimal)
CREATE TABLE IF NOT EXISTS shops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add ALL expected columns if missing
ALTER TABLE shops ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS contact_number TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS plan_name TEXT DEFAULT 'Basic';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS license_expiry DATE;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS max_users INT DEFAULT 5;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Unique code (ignore if already exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'shops_code_key'
    ) THEN
        -- Fill empty codes first so unique index can apply
        UPDATE shops SET code = 'SH' || substr(replace(id::text, '-', ''), 1, 6)
        WHERE code IS NULL OR trim(code) = '';
        ALTER TABLE shops ALTER COLUMN code SET NOT NULL;
        ALTER TABLE shops ADD CONSTRAINT shops_code_key UNIQUE (code);
    END IF;
EXCEPTION WHEN others THEN
    RAISE NOTICE 'code unique constraint skipped: %', SQLERRM;
END $$;

-- Users table safety
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
    display_name TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Settings
CREATE TABLE IF NOT EXISTS settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID UNIQUE REFERENCES shops(id) ON DELETE CASCADE,
    company_name TEXT,
    software_name TEXT DEFAULT 'Recountix',
    phone TEXT,
    email TEXT,
    address TEXT,
    logo_data_url TEXT,
    recovery_email TEXT,
    extra JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    plan_name TEXT NOT NULL DEFAULT 'Basic',
    amount NUMERIC(12,2) DEFAULT 0,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    remarks TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    username TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customers / recoveries minimal ensure
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    outstanding NUMERIC(14,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS father TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS alt_mobile TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS village TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS taluka TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS district TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS aadhaar TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pan TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bill NUMERIC(14,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS down_payment NUMERIC(14,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS outstanding NUMERIC(14,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS executive TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS followup DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Active';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'Low';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS remarks TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS recoveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    amount NUMERIC(14,2) NOT NULL,
    recovery_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_mode TEXT DEFAULT 'Cash',
    receipt_no TEXT DEFAULT '',
    collected_by TEXT DEFAULT '',
    remarks TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS open policies (anon key + GitHub Pages)
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shops FROM anon, authenticated;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.users FROM anon, authenticated;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customers FROM anon, authenticated;
ALTER TABLE public.recoveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.recoveries FROM anon, authenticated;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.settings FROM anon, authenticated;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscriptions FROM anon, authenticated;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.audit_log FROM anon, authenticated;

-- Reload PostgREST schema cache (Supabase)
NOTIFY pgrst, 'reload schema';

SELECT 'FIX applied – shops.code and related columns ready' AS status;
