CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  slug TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description_ar TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  sale_mode TEXT NOT NULL CHECK (sale_mode IN ('SHARED_SLOT','PERSONAL','FULL_ACCOUNT','CODE','FILE','SERVICE','CUSTOM')),
  stock_mode TEXT NOT NULL CHECK (stock_mode IN ('SHARED_SLOT','ITEM','MANUAL','UNLIMITED')),
  delivery_mode TEXT NOT NULL DEFAULT 'AUTO' CHECK (delivery_mode IN ('AUTO','WAIT_CODE','MANUAL')),
  duration_days INTEGER,
  price_iqd BIGINT,
  price_usdt NUMERIC(18,8),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 5 CHECK (capacity > 0 AND capacity <= 100),
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  exhausted_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES inventory_groups(id) ON DELETE CASCADE,
  slot_name TEXT NOT NULL,
  encrypted_pin TEXT,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','RESERVED','SOLD','DISABLED')),
  reserved_until TIMESTAMPTZ,
  order_item_id UUID,
  access_expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id, slot_name)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  label TEXT,
  encrypted_payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','RESERVED','SOLD','DISABLED')),
  reserved_until TIMESTAMPTZ,
  order_item_id UUID,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number BIGSERIAL UNIQUE,
  public_token TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_contact TEXT NOT NULL,
  customer_telegram_id TEXT,
  locale TEXT NOT NULL DEFAULT 'ar',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','FULFILLED','MANUAL_REVIEW','CANCELLED','REFUNDED','EXPIRED')),
  currency TEXT NOT NULL,
  total_amount NUMERIC(18,8) NOT NULL,
  payment_provider TEXT NOT NULL,
  payment_reference TEXT,
  payment_url TEXT,
  ip_hash TEXT,
  fingerprint_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(18,8) NOT NULL,
  inventory_ref_type TEXT CHECK (inventory_ref_type IN ('SLOT','ITEM') OR inventory_ref_type IS NULL),
  inventory_ref_id UUID,
  fulfillment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (fulfillment_status IN ('PENDING','RESERVED','DELIVERED','WAIT_CODE','MANUAL','CANCELLED')),
  access_expires_at TIMESTAMPTZ,
  encrypted_delivery TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED',
  external_id TEXT,
  amount NUMERIC(18,8) NOT NULL,
  currency TEXT NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_events (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS abuse_events (
  id BIGSERIAL PRIMARY KEY,
  ip_hash TEXT,
  contact_hash TEXT,
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_groups_variant ON inventory_groups(variant_id, active, created_at);
CREATE INDEX IF NOT EXISTS idx_slots_available ON inventory_slots(status, reserved_until);
CREATE INDEX IF NOT EXISTS idx_items_available ON inventory_items(status, reserved_until);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_contact ON orders(customer_contact, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_external ON payments(provider, external_id);
CREATE INDEX IF NOT EXISTS idx_abuse_ip ON abuse_events(ip_hash, created_at DESC);

INSERT INTO categories (slug, name_ar, name_en, sort_order)
VALUES ('general', 'عام', 'General', 0)
ON CONFLICT (slug) DO NOTHING;
