-- ============================================================
-- Recountix - Supabase Schema
-- Multi-tenant (3 jewellery shops + Super Admin)
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- SHOPS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,          -- short code e.g. VO, RJ, GJ
    contact_number TEXT,
    email TEXT,
    address TEXT,
    logo_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- USERS
-- role: 'super_admin' | 'admin' | 'user'
-- shop_id NULL only for super_admin
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,             -- plain for simplicity (match original app)
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('super_admin', 'admin', 'user')),
    shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
    display_name TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- CUSTOMERS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    father TEXT DEFAULT '',
    mobile TEXT NOT NULL,
    alt_mobile TEXT DEFAULT '',
    village TEXT DEFAULT '',
    taluka TEXT DEFAULT '',
    district TEXT DEFAULT '',
    address TEXT DEFAULT '',
    aadhaar TEXT DEFAULT '',
    pan TEXT DEFAULT '',
    bill NUMERIC(14,2) DEFAULT 0,
    down_payment NUMERIC(14,2) DEFAULT 0,
    outstanding NUMERIC(14,2) DEFAULT 0,
    executive TEXT DEFAULT '',
    followup DATE,
    status TEXT DEFAULT 'Active',
    priority TEXT DEFAULT 'Low',
    remarks TEXT DEFAULT '',
    photo_url TEXT,
    aadhaar_photo_url TEXT,
    pan_photo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_shop ON customers(shop_id);
CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile);
CREATE INDEX IF NOT EXISTS idx_customers_followup ON customers(followup);

-- ------------------------------------------------------------
-- RECOVERIES
-- ------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_recoveries_shop ON recoveries(shop_id);
CREATE INDEX IF NOT EXISTS idx_recoveries_customer ON recoveries(customer_id);
CREATE INDEX IF NOT EXISTS idx_recoveries_date ON recoveries(recovery_date);

-- ------------------------------------------------------------
-- SETTINGS (per shop)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- SEED: 3 Jewellery Shops
-- ------------------------------------------------------------
INSERT INTO shops (id, name, code, contact_number, email, address) VALUES
    ('a1111111-1111-1111-1111-111111111111', 'Recountix', 'VO', '9876543210', 'info@vrundavan.com', 'Mehsana, Gujarat'),
    ('b2222222-2222-2222-2222-222222222222', 'Raj Jewellers', 'RJ', '9876500001', 'info@rajjewellers.com', 'Ahmedabad, Gujarat'),
    ('c3333333-3333-3333-3333-333333333333', 'Golden Palace Jewellers', 'GP', '9876500002', 'info@goldenpalace.com', 'Surat, Gujarat')
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------
-- SEED: Super Admin + Shop Admins
-- Default password for all: 1234
-- ------------------------------------------------------------
INSERT INTO users (username, password, role, shop_id, display_name) VALUES
    ('superadmin', '1234', 'super_admin', NULL, 'Super Administrator'),
    ('admin', '1234', 'admin', 'a1111111-1111-1111-1111-111111111111', 'VO Admin'),
    ('vo_user', '1234', 'user', 'a1111111-1111-1111-1111-111111111111', 'VO Staff'),
    ('rj_admin', '1234', 'admin', 'b2222222-2222-2222-2222-222222222222', 'RJ Admin'),
    ('gp_admin', '1234', 'admin', 'c3333333-3333-3333-3333-333333333333', 'GP Admin')
ON CONFLICT (username) DO NOTHING;

-- Settings for each shop
INSERT INTO settings (shop_id, company_name, phone, email, address) VALUES
    ('a1111111-1111-1111-1111-111111111111', 'Recountix', '9876543210', 'info@vrundavan.com', 'Mehsana, Gujarat'),
    ('b2222222-2222-2222-2222-222222222222', 'Raj Jewellers', '9876500001', 'info@rajjewellers.com', 'Ahmedabad, Gujarat'),
    ('c3333333-3333-3333-3333-333333333333', 'Golden Palace Jewellers', '9876500002', 'info@goldenpalace.com', 'Surat, Gujarat')
ON CONFLICT (shop_id) DO NOTHING;

-- ------------------------------------------------------------
-- RLS (optional hardening – enable if desired)
-- With custom auth + anon key, client filters by shop_id.
-- Uncomment below if you later move to Supabase Auth.
-- ------------------------------------------------------------
/*
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- For anon/authenticated full access during development (tighten later)
DROP POLICY IF EXISTS "Allow all for anon" ON public.shops;
REVOKE ALL ON TABLE public.shops FROM anon, authenticated;
DROP POLICY IF EXISTS "Allow all for anon" ON public.users;
REVOKE ALL ON TABLE public.users FROM anon, authenticated;
DROP POLICY IF EXISTS "Allow all for anon" ON public.customers;
REVOKE ALL ON TABLE public.customers FROM anon, authenticated;
DROP POLICY IF EXISTS "Allow all for anon" ON public.recoveries;
REVOKE ALL ON TABLE public.recoveries FROM anon, authenticated;
DROP POLICY IF EXISTS "Allow all for anon" ON public.settings;
REVOKE ALL ON TABLE public.settings FROM anon, authenticated;
*/

-- Allow public read/write for now (GitHub Pages + anon key)
-- In production, enable RLS + proper policies or use Supabase Auth.
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_all_shops" ON public.shops;
REVOKE ALL ON TABLE public.shops FROM anon, authenticated;
DROP POLICY IF EXISTS "public_all_users" ON public.users;
REVOKE ALL ON TABLE public.users FROM anon, authenticated;
DROP POLICY IF EXISTS "public_all_customers" ON public.customers;
REVOKE ALL ON TABLE public.customers FROM anon, authenticated;
DROP POLICY IF EXISTS "public_all_recoveries" ON public.recoveries;
REVOKE ALL ON TABLE public.recoveries FROM anon, authenticated;
DROP POLICY IF EXISTS "public_all_settings" ON public.settings;
REVOKE ALL ON TABLE public.settings FROM anon, authenticated;

-- Done
SELECT 'Schema + seed applied successfully' AS status;
