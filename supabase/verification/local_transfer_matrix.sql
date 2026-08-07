-- =====================================================================
-- local_transfer_matrix.sql — ARAÇ SAHİPLİĞİ DEVRİ · GERÇEK SQL MATRİSİ.
--
-- `local_rls_matrix.sql` ile aynı izolasyon deseni: her deneme gerçek rol +
-- JWT claim ile koşar ve yan etkisi DAİMA geri alınır. Devir gibi durum
-- değiştiren akışlar ayrıca "kalıcı senaryo" bölümünde sırayla koşulur.
-- =====================================================================

\set ON_ERROR_STOP on

CREATE TEMP TABLE tmatrix (
  seq serial, adim text, beklenen text, gerceklesen text, detay text
);

/** Belirli kullanıcı kimliğiyle SQL koşar; sonucu sınıflandırır (yan etki KALICI). */
CREATE OR REPLACE FUNCTION pg_temp.act(
  p_uid uuid, p_adim text, p_beklenen text, p_sql text
) RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_msg text; v_actual text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE p_sql;
    RESET ROLE;
    v_actual := 'OK';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_msg := SQLERRM;
    v_actual := CASE
      WHEN SQLSTATE = '42501'                          THEN 'DENY_FUNCTION'
      WHEN v_msg ILIKE '%permission_denied%'           THEN 'DENY_PERMISSION'
      WHEN v_msg ILIKE '%not_company_admin%'           THEN 'DENY_NOT_ADMIN'
      WHEN v_msg ILIKE '%stale_client_revision%'       THEN 'DENY_REVISION'
      WHEN v_msg ILIKE '%duplicate_operation%'         THEN 'DENY_DUPLICATE'
      WHEN v_msg ILIKE '%pairing_code_expired%'        THEN 'DENY_EXPIRED'
      WHEN v_msg ILIKE '%target_user_not_found%'       THEN 'DENY_TARGET'
      WHEN v_msg ILIKE '%invalid_request%'             THEN 'DENY_INVALID'
      WHEN v_msg ILIKE '%vehicle_not_found%'           THEN 'DENY_NOT_FOUND'
      WHEN v_msg ILIKE '%unauthenticated%'             THEN 'DENY_AUTH'
      ELSE 'ERROR'
    END;
  END;

  INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
  VALUES (p_adim, p_beklenen, v_actual, left(COALESCE(v_msg,''), 100));
END;
$fn$;

-- Sabitler
\set ADMIN_ALFA  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set MEMBER_ALFA '''aaaaaaaa-0000-0000-0000-000000000002'''
\set OBS_ALFA    '''aaaaaaaa-0000-0000-0000-000000000003'''
\set ADMIN_BETA  '''bbbbbbbb-0000-0000-0000-000000000001'''
\set INDIV       '''cccccccc-0000-0000-0000-000000000001'''
\set INDIV2      '''cccccccc-0000-0000-0000-000000000002'''
\set CO_ALFA     '''11111111-1111-1111-1111-111111111111'''
\set CO_BETA     '''22222222-2222-2222-2222-222222222222'''
\set VEH_INDIV   '''dddd0003-0000-0000-0000-000000000003'''
\set VEH_ALFA    '''dddd0001-0000-0000-0000-000000000001'''
\set VEH_UNOWNED '''dddd0004-0000-0000-0000-000000000004'''

-- =====================================================================
-- A. YETKİ KAPILARI
-- =====================================================================

DO $$
DECLARE v_rev bigint;
BEGIN
  SELECT revision INTO v_rev FROM public.vehicles WHERE id='dddd0003-0000-0000-0000-000000000003';

  -- A1. Sahibi OLMAYAN kullanıcı devir BAŞLATAMAZ.
  PERFORM pg_temp.act('cccccccc-0000-0000-0000-000000000002'::uuid,
    'yabancı kullanıcı devir başlatır', 'DENY_PERMISSION',
    format('SELECT public.start_vehicle_transfer(''dddd0003-0000-0000-0000-000000000003''::uuid,''INDIVIDUAL'',''cccccccc-0000-0000-0000-000000000002''::uuid,''idem-yabanci-1'',%s)', v_rev));

  -- A2. Şirket aracını MEMBER devredemez.
  SELECT revision INTO v_rev FROM public.vehicles WHERE id='dddd0001-0000-0000-0000-000000000001';
  PERFORM pg_temp.act('aaaaaaaa-0000-0000-0000-000000000002'::uuid,
    'member şirket aracını devreder', 'DENY_PERMISSION',
    format('SELECT public.start_vehicle_transfer(''dddd0001-0000-0000-0000-000000000001''::uuid,''INDIVIDUAL'',''cccccccc-0000-0000-0000-000000000002''::uuid,''idem-member-1'',%s)', v_rev));

  -- A3. Observer devredemez.
  PERFORM pg_temp.act('aaaaaaaa-0000-0000-0000-000000000003'::uuid,
    'observer şirket aracını devreder', 'DENY_PERMISSION',
    format('SELECT public.start_vehicle_transfer(''dddd0001-0000-0000-0000-000000000001''::uuid,''INDIVIDUAL'',''cccccccc-0000-0000-0000-000000000002''::uuid,''idem-obs-1'',%s)', v_rev));

  -- A4. BAŞKA şirketin admini devredemez (cross-tenant).
  PERFORM pg_temp.act('bbbbbbbb-0000-0000-0000-000000000001'::uuid,
    'başka şirket admini devreder', 'DENY_PERMISSION',
    format('SELECT public.start_vehicle_transfer(''dddd0001-0000-0000-0000-000000000001''::uuid,''COMPANY'',''22222222-2222-2222-2222-222222222222''::uuid,''idem-beta-1'',%s)', v_rev));

  -- A5. SAHİPSİZ araç devredilemez.
  SELECT revision INTO v_rev FROM public.vehicles WHERE id='dddd0004-0000-0000-0000-000000000004';
  PERFORM pg_temp.act('aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'sahipsiz araç devredilir', 'DENY_PERMISSION',
    format('SELECT public.start_vehicle_transfer(''dddd0004-0000-0000-0000-000000000004''::uuid,''INDIVIDUAL'',''cccccccc-0000-0000-0000-000000000002''::uuid,''idem-unowned-1'',%s)', v_rev));

  -- A6. Var olmayan hedef reddedilir.
  SELECT revision INTO v_rev FROM public.vehicles WHERE id='dddd0003-0000-0000-0000-000000000003';
  PERFORM pg_temp.act('cccccccc-0000-0000-0000-000000000001'::uuid,
    'var olmayan hedefe devir', 'DENY_TARGET',
    format('SELECT public.start_vehicle_transfer(''dddd0003-0000-0000-0000-000000000003''::uuid,''INDIVIDUAL'',''99999999-9999-9999-9999-999999999999''::uuid,''idem-hedefyok-1'',%s)', v_rev));

  -- A7. KENDİNE devir anlamsızdır.
  PERFORM pg_temp.act('cccccccc-0000-0000-0000-000000000001'::uuid,
    'kendine devir', 'DENY_INVALID',
    format('SELECT public.start_vehicle_transfer(''dddd0003-0000-0000-0000-000000000003''::uuid,''INDIVIDUAL'',''cccccccc-0000-0000-0000-000000000001''::uuid,''idem-kendine-1'',%s)', v_rev));

  -- A8. YANLIŞ revizyon fail-closed reddedilir.
  PERFORM pg_temp.act('cccccccc-0000-0000-0000-000000000001'::uuid,
    'bayat revizyonla devir', 'DENY_REVISION',
    format('SELECT public.start_vehicle_transfer(''dddd0003-0000-0000-0000-000000000003''::uuid,''INDIVIDUAL'',''cccccccc-0000-0000-0000-000000000002''::uuid,''idem-bayat-1'',%s)', v_rev + 99));
END $$;

-- =====================================================================
-- B. KALICI SENARYO — bireysel → bireysel devir (uçtan uca)
-- =====================================================================

DO $$
DECLARE
  v_rev bigint;
  v_tid uuid;
  v_owner uuid;
  v_pairings int;
  v_pending_cmd int;
BEGIN
  SELECT revision INTO v_rev FROM public.vehicles WHERE id='dddd0003-0000-0000-0000-000000000003';

  -- B1. Gerçek sahip devri başlatır.
  PERFORM pg_temp.act('cccccccc-0000-0000-0000-000000000001'::uuid,
    'B1 sahip devri başlatır', 'OK',
    format('SELECT public.start_vehicle_transfer(''dddd0003-0000-0000-0000-000000000003''::uuid,''INDIVIDUAL'',''cccccccc-0000-0000-0000-000000000002''::uuid,''idem-gercek-1'',%s)', v_rev));

  SELECT id INTO v_tid FROM public.vehicle_ownership_transfers
   WHERE idempotency_key='idem-gercek-1';

  -- B2. AYNI araç için ikinci aktif transfer AÇILAMAZ (yarış koruması).
  PERFORM pg_temp.act('cccccccc-0000-0000-0000-000000000001'::uuid,
    'B2 ikinci aktif transfer', 'DENY_DUPLICATE',
    format('SELECT public.start_vehicle_transfer(''dddd0003-0000-0000-0000-000000000003''::uuid,''COMPANY'',''11111111-1111-1111-1111-111111111111''::uuid,''idem-ikinci-1'',%s)', v_rev));

  -- B3. İDEMPOTENCY: aynı anahtar aynı transferi döndürür, YENİSİNİ açmaz.
  PERFORM pg_temp.act('cccccccc-0000-0000-0000-000000000001'::uuid,
    'B3 aynı idempotency anahtarı', 'OK',
    format('SELECT public.start_vehicle_transfer(''dddd0003-0000-0000-0000-000000000003''::uuid,''INDIVIDUAL'',''cccccccc-0000-0000-0000-000000000002''::uuid,''idem-gercek-1'',%s)', v_rev));

  INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
  SELECT 'B3b tek transfer kaydı', '1', count(*)::text, ''
    FROM public.vehicle_ownership_transfers WHERE vehicle_id='dddd0003-0000-0000-0000-000000000003';

  -- B4. YANLIŞ kişi kabul edemez.
  PERFORM pg_temp.act('aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'B4 yetkisiz kabul', 'DENY_PERMISSION',
    format('SELECT public.accept_vehicle_transfer(%L::uuid)', v_tid));

  -- B5. Gönderen kendi transferini kabul edemez.
  PERFORM pg_temp.act('cccccccc-0000-0000-0000-000000000001'::uuid,
    'B5 gönderen kendi transferini kabul eder', 'DENY_PERMISSION',
    format('SELECT public.accept_vehicle_transfer(%L::uuid)', v_tid));

  -- B6. HEDEF kabul eder → devir tamamlanır.
  PERFORM pg_temp.act('cccccccc-0000-0000-0000-000000000002'::uuid,
    'B6 hedef kabul eder', 'OK',
    format('SELECT public.accept_vehicle_transfer(%L::uuid)', v_tid));

  -- B7. Sahiplik GERÇEKTEN değişti mi.
  SELECT owner_id INTO v_owner FROM public.vehicles WHERE id='dddd0003-0000-0000-0000-000000000003';
  INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
  VALUES ('B7 yeni sahip', 'cccccccc-0000-0000-0000-000000000002', COALESCE(v_owner::text,'NULL'), '');

  -- B8. ESKİ sahibin eşleştirmesi KALDI mı (kalmamalı).
  SELECT count(*) INTO v_pairings FROM public.vehicle_pairings
   WHERE vehicle_id='dddd0003-0000-0000-0000-000000000003'
     AND user_id='cccccccc-0000-0000-0000-000000000001';
  INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
  VALUES ('B8 eski sahip eşleştirmesi', '0', v_pairings::text, '');

  -- B9. YENİ sahibin eşleştirmesi kuruldu mu.
  SELECT count(*) INTO v_pairings FROM public.vehicle_pairings
   WHERE vehicle_id='dddd0003-0000-0000-0000-000000000003'
     AND user_id='cccccccc-0000-0000-0000-000000000002';
  INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
  VALUES ('B9 yeni sahip eşleştirmesi', '1', v_pairings::text, '');

  -- B10. İDEMPOTENT KABUL: tekrar kabul hata VERMEZ, tekrar UYGULAMAZ.
  PERFORM pg_temp.act('cccccccc-0000-0000-0000-000000000002'::uuid,
    'B10 tekrar kabul (idempotent)', 'OK',
    format('SELECT public.accept_vehicle_transfer(%L::uuid)', v_tid));

  -- B11. Devir sonrası ESKİ sahip aracı GÖREMEZ.
  PERFORM pg_temp.act('cccccccc-0000-0000-0000-000000000001'::uuid,
    'B11 eski sahip aracı günceller', 'OK',
    'UPDATE public.vehicles SET name=''geri aldım'' WHERE id=''dddd0003-0000-0000-0000-000000000003''');

  INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
  SELECT 'B11b eski sahip adı değiştirebildi mi', 'hayır',
         CASE WHEN name = 'geri aldım' THEN 'EVET(🔴)' ELSE 'hayır' END, ''
    FROM public.vehicles WHERE id='dddd0003-0000-0000-0000-000000000003';

  -- B12. Bekleyen komutlar iptal edildi mi.
  SELECT count(*) INTO v_pending_cmd FROM public.vehicle_commands
   WHERE vehicle_id='dddd0003-0000-0000-0000-000000000003' AND status='pending';
  INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
  VALUES ('B12 bekleyen komut', '0', v_pending_cmd::text, '');

  -- B13. Devir sonrası revizyon ARTTI mı (optimistic concurrency çalışıyor).
  SELECT revision INTO v_rev FROM public.vehicles WHERE id='dddd0003-0000-0000-0000-000000000003';
  INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
  VALUES ('B13 revizyon arttı', 'evet', CASE WHEN v_rev > 0 THEN 'evet' ELSE 'hayır' END, v_rev::text);
END $$;

-- =====================================================================
-- C. SÜRE DOLUMU
-- =====================================================================

DO $$
DECLARE v_rev bigint; v_tid uuid;
BEGIN
  SELECT revision INTO v_rev FROM public.vehicles WHERE id='dddd0001-0000-0000-0000-000000000001';

  PERFORM pg_temp.act('aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'C1 admin şirket aracını devreder', 'OK',
    format('SELECT public.start_vehicle_transfer(''dddd0001-0000-0000-0000-000000000001''::uuid,''INDIVIDUAL'',''cccccccc-0000-0000-0000-000000000001''::uuid,''idem-sure-1'',%s)', v_rev));

  SELECT id INTO v_tid FROM public.vehicle_ownership_transfers WHERE idempotency_key='idem-sure-1';

  -- Süreyi geçmişe çek (zaman yolculuğu yerine doğrudan veri).
  UPDATE public.vehicle_ownership_transfers SET expires_at = now() - interval '1 minute'
   WHERE id = v_tid;

  PERFORM pg_temp.act('cccccccc-0000-0000-0000-000000000001'::uuid,
    'C2 süresi dolmuş transferi kabul', 'DENY_EXPIRED',
    format('SELECT public.accept_vehicle_transfer(%L::uuid)', v_tid));

  -- C3. Kabul yolu durumu DEĞİŞTİREMEZ (exception transaction'ı geri alır).
  -- Bu bilinçlidir; temizlik başlatma ve bakım yollarında yapılır.
  INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
  SELECT 'C3 kabul sonrası durum', 'PENDING', status, 'exception rollback'
    FROM public.vehicle_ownership_transfers WHERE id = v_tid;

  -- Süresi dolan transfer araç sahipliğini DEĞİŞTİRMEDİ.
  INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
  SELECT 'C4 sahiplik değişmedi', '11111111-1111-1111-1111-111111111111',
         COALESCE(company_id::text,'NULL'), ''
    FROM public.vehicles WHERE id='dddd0001-0000-0000-0000-000000000001';

  -- C5. BAKIM fonksiyonu süresi dolanı EXPIRED yapar (kalıcı).
  PERFORM public.expire_vehicle_transfers();
  INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
  SELECT 'C5 bakım sonrası EXPIRED', 'EXPIRED', status, COALESCE(failure_code,'')
    FROM public.vehicle_ownership_transfers WHERE id = v_tid;

  -- C6. Ölü PENDING kayıt aracı KİLİTLEMEZ — yeni devir açılabilir.
  SELECT revision INTO v_rev FROM public.vehicles WHERE id='dddd0001-0000-0000-0000-000000000001';
  PERFORM pg_temp.act('aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'C6 süre dolduktan sonra yeni devir', 'OK',
    format('SELECT public.start_vehicle_transfer(''dddd0001-0000-0000-0000-000000000001''::uuid,''INDIVIDUAL'',''cccccccc-0000-0000-0000-000000000001''::uuid,''idem-sure-2'',%s)', v_rev));

  -- Sonraki bölüme temiz başlamak için bu transferi iptal et.
  UPDATE public.vehicle_ownership_transfers SET status='CANCELLED', cancelled_at=now()
   WHERE idempotency_key='idem-sure-2';
END $$;

-- =====================================================================
-- D. ARAÇ ARADA DEĞİŞİRSE (revizyon yarışı)
-- =====================================================================

DO $$
DECLARE v_rev bigint; v_tid uuid;
BEGIN
  SELECT revision INTO v_rev FROM public.vehicles WHERE id='dddd0001-0000-0000-0000-000000000001';

  PERFORM pg_temp.act('aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'D1 devir başlatılır', 'OK',
    format('SELECT public.start_vehicle_transfer(''dddd0001-0000-0000-0000-000000000001''::uuid,''INDIVIDUAL'',''cccccccc-0000-0000-0000-000000000001''::uuid,''idem-yaris-1'',%s)', v_rev));

  SELECT id INTO v_tid FROM public.vehicle_ownership_transfers WHERE idempotency_key='idem-yaris-1';

  -- Araç arada değişti (başka bir yoldan isim güncellendi → revizyon arttı).
  UPDATE public.vehicles SET name='arada değişti' WHERE id='dddd0001-0000-0000-0000-000000000001';

  PERFORM pg_temp.act('cccccccc-0000-0000-0000-000000000001'::uuid,
    'D2 araç değişmişken kabul', 'DENY_REVISION',
    format('SELECT public.accept_vehicle_transfer(%L::uuid)', v_tid));

  -- D3. Kayıt PENDING KALIR (exception transaction'ı geri alır ve ürün
  -- açısından devir kalıcı olarak ölmemelidir — yeniden denenebilir).
  INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
  SELECT 'D3 revizyon reddi sonrası durum', 'PENDING', status, COALESCE(failure_code,'')
    FROM public.vehicle_ownership_transfers WHERE id = v_tid;

  -- D3b. Gönderen iptal edip GÜNCEL revizyonla yeniden başlatabilir.
  PERFORM pg_temp.act('aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'D3b gönderen iptal eder', 'OK',
    format('SELECT public.cancel_vehicle_transfer(%L::uuid)', v_tid));

  SELECT revision INTO v_rev FROM public.vehicles WHERE id='dddd0001-0000-0000-0000-000000000001';
  PERFORM pg_temp.act('aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'D3c güncel revizyonla yeniden başlatılır', 'OK',
    format('SELECT public.start_vehicle_transfer(''dddd0001-0000-0000-0000-000000000001''::uuid,''INDIVIDUAL'',''cccccccc-0000-0000-0000-000000000001''::uuid,''idem-yaris-2'',%s)', v_rev));

  UPDATE public.vehicle_ownership_transfers SET status='CANCELLED', cancelled_at=now()
   WHERE idempotency_key='idem-yaris-2';

  -- Sahiplik DEĞİŞMEDİ.
  INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
  SELECT 'D4 sahiplik korundu', '11111111-1111-1111-1111-111111111111',
         COALESCE(company_id::text,'NULL'), ''
    FROM public.vehicles WHERE id='dddd0001-0000-0000-0000-000000000001';
END $$;

-- =====================================================================
-- E. ŞİRKET HEDEFİ — kabul yetkisi admin'de
-- =====================================================================

DO $$
DECLARE v_rev bigint; v_tid uuid;
BEGIN
  SELECT revision INTO v_rev FROM public.vehicles WHERE id='dddd0003-0000-0000-0000-000000000003';

  PERFORM pg_temp.act('cccccccc-0000-0000-0000-000000000002'::uuid,
    'E1 bireysel → şirket devri başlatılır', 'OK',
    format('SELECT public.start_vehicle_transfer(''dddd0003-0000-0000-0000-000000000003''::uuid,''COMPANY'',''11111111-1111-1111-1111-111111111111''::uuid,''idem-sirket-1'',%s)', v_rev));

  SELECT id INTO v_tid FROM public.vehicle_ownership_transfers WHERE idempotency_key='idem-sirket-1';

  -- E2. Hedef şirketin MEMBER'ı kabul EDEMEZ.
  PERFORM pg_temp.act('aaaaaaaa-0000-0000-0000-000000000002'::uuid,
    'E2 member kabul eder', 'DENY_NOT_ADMIN',
    format('SELECT public.accept_vehicle_transfer(%L::uuid)', v_tid));

  -- E3. BAŞKA şirketin admini kabul EDEMEZ.
  PERFORM pg_temp.act('bbbbbbbb-0000-0000-0000-000000000001'::uuid,
    'E3 başka şirket admini kabul eder', 'DENY_NOT_ADMIN',
    format('SELECT public.accept_vehicle_transfer(%L::uuid)', v_tid));

  -- E4. Hedef şirketin admini kabul EDER.
  PERFORM pg_temp.act('aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'E4 hedef şirket admini kabul eder', 'OK',
    format('SELECT public.accept_vehicle_transfer(%L::uuid)', v_tid));

  INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
  SELECT 'E5 araç şirkete geçti', '11111111-1111-1111-1111-111111111111',
         COALESCE(company_id::text,'NULL'),
         'owner_id=' || COALESCE(owner_id::text,'NULL')
    FROM public.vehicles WHERE id='dddd0003-0000-0000-0000-000000000003';

  -- E6. Şirkete geçen araçta bireysel sahip KALMAMALI (tek sahiplik türü).
  INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
  SELECT 'E6 owner_id temizlendi', 'NULL', COALESCE(owner_id::text,'NULL'), ''
    FROM public.vehicles WHERE id='dddd0003-0000-0000-0000-000000000003';
END $$;

-- =====================================================================
-- F. ANON KAPISI
-- =====================================================================

DO $$
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    SET LOCAL ROLE anon;
    PERFORM public.list_vehicle_transfers();
    RESET ROLE;
    INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
    VALUES ('F1 anon transfer listeler', 'DENY_FUNCTION', '🔴 OK (SIZINTI)', '');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
    VALUES ('F1 anon transfer listeler', 'DENY_FUNCTION',
            CASE WHEN SQLSTATE='42501' THEN 'DENY_FUNCTION' ELSE 'ERROR' END, SQLERRM);
  END;

  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    SET LOCAL ROLE anon;
    PERFORM public.start_vehicle_transfer(
      'dddd0001-0000-0000-0000-000000000001'::uuid,'INDIVIDUAL',
      'cccccccc-0000-0000-0000-000000000001'::uuid,'idem-anon-1',0);
    RESET ROLE;
    INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
    VALUES ('F2 anon devir başlatır', 'DENY_FUNCTION', '🔴 OK (SIZINTI)', '');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
    VALUES ('F2 anon devir başlatır', 'DENY_FUNCTION',
            CASE WHEN SQLSTATE='42501' THEN 'DENY_FUNCTION' ELSE 'ERROR' END, SQLERRM);
  END;

  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    SET LOCAL ROLE anon;
    PERFORM count(*) FROM public.vehicle_ownership_transfers;
    RESET ROLE;
    INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
    VALUES ('F3 anon transfer tablosunu okur', 'DENY_GRANT', '🔴 OK (SIZINTI)', '');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO tmatrix (adim, beklenen, gerceklesen, detay)
    VALUES ('F3 anon transfer tablosunu okur', 'DENY_GRANT',
            CASE WHEN SQLSTATE='42501' THEN 'DENY_GRANT' ELSE 'ERROR' END, SQLERRM);
  END;
END $$;

-- =====================================================================
-- SONUÇ
-- =====================================================================

\echo ''
\echo '== TRANSFER MATRİSİ =='
SELECT CASE WHEN gerceklesen = beklenen THEN 'PASS' ELSE '🔴 FAIL' END AS s,
       adim, beklenen, gerceklesen, detay
FROM tmatrix ORDER BY seq;

\echo ''
\echo '== ÖZET =='
SELECT count(*) FILTER (WHERE gerceklesen = beklenen)  AS pass,
       count(*) FILTER (WHERE gerceklesen <> beklenen) AS fail,
       count(*) AS toplam
FROM tmatrix;

\echo ''
\echo '== 🔴 DÜŞENLER (boş olmalı) =='
SELECT adim, beklenen, gerceklesen, detay FROM tmatrix
WHERE gerceklesen <> beklenen ORDER BY seq;
