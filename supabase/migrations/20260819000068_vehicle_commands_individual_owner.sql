-- 20260819000068_vehicle_commands_individual_owner.sql
-- ══════════════════════════════════════════════════════════════════════════
-- #645 — "ARACA GÖNDER" PROD'DA HİÇ ÇALIŞMAMIŞ: `vehicle_commands.company_id`
--        NOT NULL, ama onu dolduran HİÇBİR yazıcı yok.
--
-- SAHA KANITI (2026-08-19, kullanıcı telefonu, #644 sonrası araç eşleşti):
--   Tema Stüdyo → ARACA GÖNDER →
--   `null value in column "company_id" of relation "vehicle_commands"
--    violates not-null constraint`
--
-- PROD ÖLÇÜMÜ (Management API):
--   · `vehicle_commands` satır sayısı: **0**
--   · `company_id` dolu satır: **0**
--   · kolonu dolduran trigger: **YOK** (yalnız updated_at ve critical-pin trigger'ı)
--   · istemci INSERT'i `company_id` GÖNDERMİYOR (`lib/commandService.ts`)
--   Yani kolon NOT NULL olduğu andan beri bu özellik ölü; "bazen çalışıyordu"
--   değil, HİÇ çalışmadı.
--
-- NEDEN ŞİMDİ GÖRÜNDÜ: #644 ile PWA eşleştirmesi aracı BİREYSEL bağlıyor
-- (şirket damgalamıyor). Bireysel araçta şirket kavramı YOKTUR → `company_id`
-- NULL olmak ZORUNDA. NOT NULL kısıtı "her araç bir şirkete aittir" varsayımının
-- kalıntısıdır ve ürün kararıyla (#631) çelişir.
--
-- İZOLASYON ZAYIFLAMAZ: `vehicle_commands` politikalarının HEPSİ permissive'dir
-- (ölçüldü) ve yazma kapısı `commands: gonderebilir` →
-- `(is_vehicle_owner(vehicle_id) OR is_paired(auth.uid(), vehicle_id)) AND ttl > now()`
-- yani erişim SAHİPLİK/EŞLEŞMEDEN gelir, şirket kolonundan DEĞİL. Eski
-- "Company Isolation for Commands" politikası zaten bireysel kullanıcıda
-- (profiles.company_id NULL) hiçbir satırla eşleşmiyordu.
--
-- VERİ YAZILMAZ (tablo zaten boş). Kolon KALDIRILMAZ: filo akışında anlamlıdır,
-- yalnız ZORUNLULUĞU kalkar.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vehicle_commands
  ALTER COLUMN company_id DROP NOT NULL;

COMMENT ON COLUMN public.vehicle_commands.company_id IS
  'Filo aracıysa şirket; BİREYSEL araçta NULL (#645). NULL = "şirketi yok", '
  '"bilinmiyor" DEĞİL. Erişim kontrolü sahiplik/eşleşme politikalarındadır.';
