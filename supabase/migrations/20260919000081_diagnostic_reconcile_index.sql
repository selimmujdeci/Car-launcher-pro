-- ════════════════════════════════════════════════════════════════════
-- 081 — read_dtc uzlaştırma indeksi (F5.3B writer için)
-- ════════════════════════════════════════════════════════════════════
--
-- ⚠️ HAZIRLANDI, UYGULANMADI. 077 · 078 · 079 · 080 da uygulanmadı ve bu
--    dosya onların HİÇBİRİNE dokunmaz. 080 DEĞİŞTİRİLMEDİ — eksik olan tek
--    şey bir indeksti, o da ayrı migration olarak eklendi.
--
-- ── NEDEN ───────────────────────────────────────────────────────────
-- F5.3B writer'ı periyodik olarak şunu sorar:
--   "terminal durumdaki, sonucu yazılmış `read_dtc` komutları hangileri?"
--
-- Production'da `vehicle_commands` üzerinde SADECE iki indeks var
--   · idx_vcmd_ttl            (ttl)
--   · idx_vcmd_vehicle_status (vehicle_id, status)
-- İkisi de bu erişim desenini karşılamaz: writer ARAÇ BAZLI değil, TÜR +
-- ZAMAN bazlı tarar. İndekssiz her tur tam tablo taraması olurdu.
--
-- ── NEDEN KISMİ (PARTIAL) İNDEKS ────────────────────────────────────
-- `read_dtc` komutları toplam komutların ÇOK KÜÇÜK bir azınlığıdır
-- (kullanıcı tetikler, nadirdir; production'da tamamlanmış sayısı şu an 0).
-- Kısmi indeks yalnız o satırları kapsar → indeks küçük kalır ve `lock`,
-- `unlock`, `theme_change` gibi SICAK yazma yollarına yük BİNDİRMEZ.
--
-- `finished_at IS NOT NULL` koşulu da bilinçlidir: writer yalnız SONUCU
-- YAZILMIŞ komutlarla ilgilenir; uçuştaki satırlar indekse hiç girmez.
--
-- ── SIRA: ARTAN (ASC) ───────────────────────────────────────────────
-- Writer EN ESKİ kalıcılaşmamış satırdan başlar. Sebep: `vehicle_commands`
-- 14 GÜN sonra siliniyor (`_retention_days('vehicle_commands',14)`) —
-- retention'a EN YAKIN olan satır en aciliyetlidir. En yeniden başlamak,
-- yoğun bir turda en eski satırı retention'a kaptırabilirdi.
--
-- ── NE YAPMAZ ───────────────────────────────────────────────────────
-- · Veri DEĞİŞTİRMEZ · kısıt EKLEMEZ · RLS'e DOKUNMAZ.
-- · Yeni tablo/kolon YOK.
--
-- GERİ ALINABİLİRLİK: `DROP INDEX` ile tam geri alınır.
-- ════════════════════════════════════════════════════════════════════

-- İDEMPOTENT: varsa no-op.
--
-- NOT: `CONCURRENTLY` KULLANILMADI — migration bir transaction içinde koşar
-- ve `CREATE INDEX CONCURRENTLY` transaction içinde ÇALIŞMAZ. Kısmi indeks
-- çok küçük olduğu için kilit süresi ihmal edilebilir. Tablo büyükse
-- uygulama sırasında elle `CONCURRENTLY` tercih edilebilir.
CREATE INDEX IF NOT EXISTS vehicle_commands_dtc_reconcile_idx
  ON public.vehicle_commands (finished_at ASC)
  WHERE type = 'read_dtc' AND finished_at IS NOT NULL;

-- ── DOĞRULAMA ───────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF to_regclass('public.vehicle_commands_dtc_reconcile_idx') IS NULL THEN
    RAISE EXCEPTION '081 DÜŞTÜ: uzlaştırma indeksi oluşmadı';
  END IF;

  /* İndeksin GERÇEKTEN kısmi olduğunu doğrula: koşulsuz bir indeks sıcak
     yazma yoluna gereksiz yük bindirirdi. */
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'vehicle_commands_dtc_reconcile_idx'
      AND i.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION '081 DOĞRULAMA DÜŞTÜ: indeks kısmi değil';
  END IF;

  RAISE NOTICE '081 OK: read_dtc uzlaştırma indeksi kuruldu (kısmi)';
END $verify$;
