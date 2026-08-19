-- 20260819000067_pair_vehicle_single_owner_fix.sql
-- ══════════════════════════════════════════════════════════════════════════
-- #644 — PWA ARAÇ EŞLEŞTİRME PROD'DA ÖLÜYDÜ: RPC, 039'un CHECK KISITINI ÇİĞNİYOR
--
-- SAHA KANITI (2026-08-19, gerçek kullanıcı telefonu + Vercel runtime logu):
--   PWA:  "Sunucu şu an yanıt veremiyor (HTTP 500)."
--   log:  vehicle/link rpc: new row for relation "vehicles" violates check
--         constraint "vehicles_single_owner_type"   ·  POST /api/vehicle/link 500
--
-- KÖK: `pair_vehicle_to_user` (034) şirket üyesi kullanıcı eşleştirdiğinde
--      `owner_id` VE `company_id` alanlarını BİRLİKTE yazıyordu; 039 ise
--      "ikisi birden dolu olamaz" kısıtını eklemişti. Filo üyesi olan hiçbir
--      kullanıcı araç eşleştiremiyordu.
--
-- BU MIGRATION VERİ YAZMAZ — yalnız fonksiyonu değiştirir. Mevcut ihlal eden
-- satır varsa (hem owner_id hem company_id dolu) ona DOKUNULMAZ: veri
-- uzlaştırması ayrı bir karardır (039'un kendi disiplini).
-- ══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.pair_vehicle_to_user(
  p_code    text,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  /* Bireysel (şirketsiz) kullanıcı için ÜRÜN LİMİTİ. İstemciye sorulmaz,
     istemciden gelen sayıya GÜVENİLMEZ — burada sayılır. */
  c_individual_max constant integer := 3;

  v_vehicle        public.vehicles%ROWTYPE;
  v_code           text;
  v_company        uuid;
  v_owned_count    integer;
  v_already_paired boolean;
  v_role           text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;

  v_code := upper(trim(coalesce(p_code, '')));
  IF v_code !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE = 'P0001';
  END IF;

  /* EŞZAMANLILIK: aynı kullanıcının FARKLI araçlar için paralel iki isteği
     satır kilidiyle serileşmez (kilitler farklı satırlarda olur). Kullanıcı
     bazlı advisory kilit, limit sayımı ile yazmayı tek transaction içinde
     ATOMİK yapar → 3 araç sınırı yarışla aşılamaz. */
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- 2.1 Kod → araç. Önce GEÇİCİ kod (TTL), sonra KALICI pairing_code.
  SELECT v.* INTO v_vehicle
  FROM public.vehicle_linking_codes vlc
  JOIN public.vehicles v ON v.id = vlc.vehicle_id
  WHERE vlc.code = v_code
    AND vlc.expires_at > now()
  FOR UPDATE OF v
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_vehicle
    FROM public.vehicles
    WHERE upper(pairing_code) = v_code
    FOR UPDATE
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    -- Geçersiz · süresi dolmuş · zaten tüketilmiş (replay) — hepsi aynı cevap.
    RAISE EXCEPTION 'invalid_or_expired_code' USING ERRCODE = 'P0001';
  END IF;

  -- 2.2 ŞİRKET: yalnız SUNUCUDA doğrulanmış üyelikten. İstemci girdisi YOK.
  SELECT p.company_id INTO v_company
  FROM public.profiles p
  WHERE p.id = p_user_id;

  -- 2.3 SAHİPLİK KAPILARI — sessiz taşıma YASAK.
  IF v_vehicle.company_id IS NOT NULL
     AND (v_company IS NULL OR v_vehicle.company_id <> v_company) THEN
    -- Araç BAŞKA bir şirkete bağlı → cross-tenant claim reddedilir.
    RAISE EXCEPTION 'vehicle_belongs_to_another_company' USING ERRCODE = 'P0001';
  END IF;

  IF v_vehicle.owner_id IS NOT NULL AND v_vehicle.owner_id <> p_user_id THEN
    /* Araç başka bir kullanıcıya ait. TEK istisna: aynı DOĞRULANMIŞ şirket
       içindeki kullanıcı — bu durumda ERİŞİM verilir, SAHİPLİK DEĞİŞMEZ. */
    IF v_company IS NULL OR v_vehicle.company_id IS DISTINCT FROM v_company THEN
      RAISE EXCEPTION 'vehicle_owned_by_another_user' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 2.4 BİREYSEL LİMİT — yalnız şirket üyeliği OLMAYAN kullanıcıya uygulanır.
  v_already_paired := EXISTS (
    SELECT 1 FROM public.vehicle_pairings
    WHERE user_id = p_user_id AND vehicle_id = v_vehicle.id
  );

  /* #644: kapı artık KULLANICININ şirketine değil ARACIN şirketine bakar.
     Eskiden şirket üyesi olan kullanıcı limitten muaftı çünkü aracın şirket
     aracı OLACAĞI varsayılıyordu; artık eşleştirme şirket damgalamadığı için
     o varsayım geçersiz. */
  IF v_vehicle.company_id IS NULL AND NOT v_already_paired THEN
    /* Yalnız AKTİF bağlı bireysel araçlar sayılır: bağlantısı kaldırılan
       (owner_id temizlenen) veya silinen araç limite girmez. Aynı aracın
       tekrar eşleşmesi sayımı ARTIRMAZ (`id <> v_vehicle.id`). */
    SELECT count(*) INTO v_owned_count
    FROM public.vehicles
    WHERE owner_id = p_user_id
      AND company_id IS NULL
      AND id <> v_vehicle.id;

    IF v_owned_count >= c_individual_max THEN
      RAISE EXCEPTION 'individual_vehicle_limit_reached' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 2.5 ATOMİK YAZMALAR (aynı transaction — yarım pairing imkânsız)
  /* #644: `v_company` yalnız KAPILARDA kullanılır (cross-tenant reddi, aynı
     şirket içi erişim). Araç kaydına şirket damgası bu yoldan ASLA yazılmaz. */
  /* ── #644 · CHECK KISITINI YAPISAL OLARAK ÇİĞNEYEMEZ ────────────────────
   * SAHA (2026-08-19): PWA eşleştirmesi her denemede HTTP 500 veriyordu.
   * Vercel runtime logu sebebi birebir verdi:
   *     new row for relation "vehicles" violates check constraint
   *     "vehicles_single_owner_type"
   * 039 numaralı migration "araç AYNI ANDA hem bireysel (owner_id) hem şirket
   * (company_id) sahipli OLAMAZ" kısıtını eklemişti; bu RPC (034) ise şirket
   * üyesi bir kullanıcı eşleştirdiğinde İKİSİNİ BİRDEN yazıyordu. Sonuç:
   * **filo üyesi olan hiç kimse araç eşleştiremiyordu** — ürün sessizce ölüydü.
   * İki migration aynı gün yazılmış ama biri diğerinin kuralını görmemişti.
   *
   * YENİ KURAL (tek satırda kanıtlanabilir):
   *   · `company_id` bu yolda ASLA yazılmaz. PWA eşleştirmesi ürün kararı gereği
   *     aracı KULLANICI HESABINA bağlar (#631: "filo üyeliği gerekmez");
   *     filoya alma AYRI bir akıştır ve sessizce burada olmaz.
   *   · Araç zaten bir şirkete aitse `owner_id`ye DOKUNULMAZ → erişim verilir,
   *     sahiplik değişmez (rol zaten 'observer' hesaplanır).
   * Böylece `owner_id` ve `company_id` aynı anda dolu olamaz: kısıt ihlali
   * imkânsızdır, "geçici hata" değil. */
  UPDATE public.vehicles
  SET owner_id = CASE
                   WHEN company_id IS NULL THEN coalesce(owner_id, p_user_id)
                   ELSE owner_id
                 END
  WHERE id = v_vehicle.id
  RETURNING * INTO v_vehicle;

  v_role := CASE
    WHEN v_vehicle.owner_id = p_user_id THEN 'owner'
    ELSE 'observer'   -- aynı şirket içi ERİŞİM eşleşmesi (sahiplik değil)
  END;

  INSERT INTO public.vehicle_pairings (user_id, vehicle_id, role, company_id)
  VALUES (p_user_id, v_vehicle.id, v_role, v_vehicle.company_id)
  ON CONFLICT (user_id, vehicle_id) DO UPDATE
    SET role       = EXCLUDED.role,
        company_id = EXCLUDED.company_id;

  -- 2.6 KODU TÜKET (tek kullanım — replay kapalı)
  DELETE FROM public.vehicle_linking_codes WHERE vehicle_id = v_vehicle.id;

  RETURN jsonb_build_object(
    'vehicle_id',  v_vehicle.id,
    'name',        coalesce(v_vehicle.name, v_vehicle.device_name, 'Araç'),
    'device_id',   v_vehicle.device_id,
    'created_at',  v_vehicle.created_at,
    'company_id',  v_vehicle.company_id,
    'owner_id',    v_vehicle.owner_id,
    'role',        v_role,
    'is_individual', (v_vehicle.company_id IS NULL)
  );
END;
$function$;

-- Yetkiler 034'teki gibi KALIR (service_role dışında kimse çağıramaz).
REVOKE ALL ON FUNCTION public.pair_vehicle_to_user(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pair_vehicle_to_user(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.pair_vehicle_to_user(text, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.pair_vehicle_to_user(text, uuid) TO service_role;
