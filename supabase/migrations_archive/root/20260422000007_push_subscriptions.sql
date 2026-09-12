-- Migration 007: push_subscriptions — Browser Push API abonelik deposu
-- Depends on: 20260421000000_initial_schema.sql

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        REFERENCES auth.users (id) ON DELETE CASCADE,
  endpoint     text        NOT NULL UNIQUE,
  subscription jsonb       NOT NULL,            -- full PushSubscription JSON
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subs_user_idx ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Kullanıcı yalnızca kendi aboneliklerini yönetebilir
CREATE POLICY "user_manage_own_subs"
  ON public.push_subscriptions
  FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Anon upsert (araç bağlantısı olmadan da bildirim aboneliği olabilir)
-- Endpoint unique constraint idempotent upsert sağlar.
