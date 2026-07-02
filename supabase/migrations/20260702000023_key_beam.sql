-- =====================================================================
-- Car Launcher Pro — QR Key Beam
-- Migration 023: key_beams tablosu + submit_key_beam / consume_key_beam RPC'leri
--
-- AMAÇ:
--   Telefondan araca API anahtarı (ör. Gemini) güvenli aktarımı. Araç QR
--   üretir (kod + tek kullanımlık AES-256-GCM anahtarı — anahtar URL
--   fragment'ında, SUNUCUYA HİÇ GİTMEZ). Telefon köprü sayfası API key'i
--   o anahtarla şifreler, yalnızca CIPHERTEXT'i buraya yazar. Araç poll
--   edip kendi RAM'indeki anahtarla çözer. Supabase asla düz metin
--   anahtar görmez (zero-plaintext).
--
--   Bu tabloya doğrudan erişim YOKTUR — yalnızca SECURITY DEFINER RPC'ler
--   üzerinden (defense-in-depth: RLS "deny" policy + GRANT sınırlı).
--
-- CLAUDE.md SUPABASE kuralları: GRANT + RLS + policy + verification burada.
-- =====================================================================

-- ── 1. Tablo ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.key_beams (
  code        text        PRIMARY KEY,
  ciphertext  text        NOT NULL,
  iv          text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

-- Süresi dolmuş satırları hızlı bulmak için (opportunistic cleanup).
CREATE INDEX IF NOT EXISTS key_beams_expires_at_idx ON public.key_beams (expires_at);

-- ── 2. GRANT ─────────────────────────────────────────────────────────
-- Doğrudan tablo erişimi anon/authenticated'e verilmez — RPC'ler
-- SECURITY DEFINER olduğu için tablo GRANT'ına ihtiyaç duymaz. Yine de
-- checklist gereği açıkça beyan edilir (service_role tam yetkili).
GRANT ALL ON public.key_beams TO service_role;

-- ── 3. RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.key_beams ENABLE ROW LEVEL SECURITY;

-- Hiçbir rol için permissive policy yok → RLS varsayılan DENY.
-- Tüm gerçek erişim submit_key_beam / consume_key_beam RPC'leri üzerinden
-- (SECURITY DEFINER, RLS bypass) yapılır. Açık "deny" policy'si, yanlışlıkla
-- ileride bir GRANT eklenirse bile doğrudan erişimi engeller (defense-in-depth).
DROP POLICY IF EXISTS "no_direct_access" ON public.key_beams;
CREATE POLICY "no_direct_access" ON public.key_beams
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── 4. RPC: submit_key_beam ─────────────────────────────────────────
-- Telefon köprü sayfası çağırır (anon). Kod + şifreli veri yazılır (upsert —
-- kullanıcı yanlış key girip tekrar denerse aynı kod üzerine yazılabilir).
-- Basit format/boyut doğrulaması: blob deposu / kötüye kullanım engeli.
CREATE OR REPLACE FUNCTION public.submit_key_beam(
  p_code       text,
  p_ciphertext text,
  p_iv         text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_code IS NULL OR p_code !~ '^[A-Z0-9]{6,10}$' THEN
    RAISE EXCEPTION 'Geçersiz kod formatı';
  END IF;
  IF p_ciphertext IS NULL OR length(p_ciphertext) = 0 OR length(p_ciphertext) > 4000 THEN
    RAISE EXCEPTION 'Geçersiz ciphertext';
  END IF;
  IF p_iv IS NULL OR length(p_iv) = 0 OR length(p_iv) > 100 THEN
    RAISE EXCEPTION 'Geçersiz iv';
  END IF;

  -- Opportunistic cleanup — süresi dolmuş satırları at (cron gerektirmez).
  DELETE FROM public.key_beams WHERE expires_at < now();

  INSERT INTO public.key_beams (code, ciphertext, iv, created_at, expires_at)
  VALUES (p_code, p_ciphertext, p_iv, now(), now() + interval '5 minutes')
  ON CONFLICT (code) DO UPDATE SET
    ciphertext = EXCLUDED.ciphertext,
    iv         = EXCLUDED.iv,
    created_at = now(),
    expires_at = now() + interval '5 minutes';

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL     ON FUNCTION public.submit_key_beam(text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_key_beam(text, text, text) TO anon, authenticated;

-- ── 5. RPC: consume_key_beam ────────────────────────────────────────
-- Araç poll eder (anon). Bulunursa satır ATOMİK olarak silinir (DELETE
-- ... RETURNING) → tek kullanımlık garanti, eşzamanlı poll'larda dahi
-- yalnızca ilk çağrı veriyi alır.
CREATE OR REPLACE FUNCTION public.consume_key_beam(
  p_code text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ciphertext text;
  v_iv         text;
BEGIN
  DELETE FROM public.key_beams
  WHERE code = p_code AND expires_at > now()
  RETURNING ciphertext, iv INTO v_ciphertext, v_iv;

  IF v_ciphertext IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object('found', true, 'ciphertext', v_ciphertext, 'iv', v_iv);
END;
$$;

REVOKE ALL     ON FUNCTION public.consume_key_beam(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.consume_key_beam(text) TO anon, authenticated;

-- ── 6. Doğrulama (CLAUDE.md zorunlu) ────────────────────────────────
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_name = 'key_beams';
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'key_beams';
-- SELECT policyname, roles, cmd FROM pg_policies WHERE tablename = 'key_beams';
-- SELECT routine_name, grantee, privilege_type FROM information_schema.routine_privileges
--   WHERE routine_name IN ('submit_key_beam','consume_key_beam');
