-- ─────────────────────────────────────────────────────────────────────────────
-- SUPPORT-READ-1 — Destek raporu okuma kapısı (secret-token'lı, least-privilege)
--
-- AMAÇ: Destek/mühendis, gönderilen "Tanı Gönder" raporlarını (support_snapshot)
--   okuyabilsin — AMA super_admin oturumu/şifresi taşımadan. get_recent_diagnostics
--   super_admin JWT ister (masaüstünde admin şifresi tutmak = fazla yetki). Bu RPC
--   yalnız support_snapshot döndürür ve GİZLİ TOKEN ile kapılıdır.
--
-- GÜVENLİK (senin SUPABASE kurallarına uygun):
--   • Token DB'de yalnız BCRYPT HASH olarak saklanır (support_reader_secret) —
--     tablo anon/authenticated'e KAPALI (RLS enable + policy YOK; yalnız service_role).
--   • Fonksiyon SECURITY DEFINER: token doğruysa yalnız support_snapshot satırlarını
--     döndürür; yanlışsa exception. Tüm DB'yi AÇMAZ (get_recent_diagnostics gibi geniş
--     tip kümesi değil — SADECE support_snapshot).
--   • Token sızsa bile hasar = maskelenmiş destek raporlarını okumak (yazma/silme YOK).
--   • Payload zaten yazım anında PII-sanitize (remoteLogService) — ek sızıntı yok.
--
-- KULLANIM (token'ı SEN, Supabase SQL editöründe ayarla — sohbete yazma):
--   insert into public.support_reader_secret(id, secret_hash)
--   values (1, crypt('SENIN_GUCLU_TOKENIN', gen_salt('bf')))
--   on conflict (id) do update set secret_hash = excluded.secret_hash;
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Gizli token deposu (yalnız HASH; anon/auth ERİŞEMEZ) ─────────────────────
CREATE TABLE IF NOT EXISTS public.support_reader_secret (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  secret_hash text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_reader_secret ENABLE ROW LEVEL SECURITY;
-- anon/authenticated'e HİÇBİR grant YOK (token hash'i asla okunamaz). RLS + policy-yok
-- = deny-all; yalnız service_role yönetir. SECURITY DEFINER fonksiyonu sahip olarak okur.
REVOKE ALL ON public.support_reader_secret FROM anon, authenticated;
GRANT ALL ON public.support_reader_secret TO service_role;

-- ── Okuma fonksiyonu — token-kapılı, YALNIZ support_snapshot ─────────────────
CREATE OR REPLACE FUNCTION public.get_support_reports(
  p_secret text,
  p_limit  integer DEFAULT 5
)
RETURNS TABLE (
  id         uuid,
  vehicle_id text,
  type       text,
  metadata   jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
-- pgcrypto (crypt/gen_salt) Supabase'de 'extensions' şemasında → search_path'e ekle.
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Token doğrulama (bcrypt). Hash yoksa veya eşleşmezse erişim yok.
  IF NOT EXISTS (
    SELECT 1 FROM public.support_reader_secret s
    WHERE s.id = 1 AND s.secret_hash = crypt(p_secret, s.secret_hash)
  ) THEN
    RAISE EXCEPTION 'get_support_reports: yetkisiz — geçersiz token'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT e.id, e.vehicle_id::text, e.type, e.metadata, e.created_at
  FROM public.vehicle_events e
  WHERE e.type = 'support_snapshot'          -- SADECE destek raporları (geniş açık değil)
  ORDER BY e.created_at DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 5), 1), 50);
END;
$function$;

-- anon çağırabilsin (frontend anon key ile REST/rpc) — ama gövde token ister.
GRANT EXECUTE ON FUNCTION public.get_support_reports(text, integer) TO anon, authenticated;

-- ── Doğrulama (salt-okuma) ───────────────────────────────────────────────────
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_support_reports' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'SUPPORT-READ-1: get_support_reports SECURITY DEFINER değil';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_support_reports'
      AND pg_get_functiondef(p.oid) LIKE '%crypt(p_secret%'
  ) THEN
    RAISE EXCEPTION 'SUPPORT-READ-1: token guard (crypt) eklenmemiş';
  END IF;

  -- support_reader_secret anon'a AÇIK OLMAMALI
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_name = 'support_reader_secret' AND grantee IN ('anon','authenticated')
  ) THEN
    RAISE EXCEPTION 'SUPPORT-READ-1: support_reader_secret anon/authenticated''e AÇIK — kapatın';
  END IF;

  RAISE NOTICE 'SUPPORT-READ-1: get_support_reports token-guard OK, secret tablo kapalı OK';
END;
$verify$;
