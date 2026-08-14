# Arşivlenmiş Migration'lar — BASELINE SQUASH ile devre dışı (2026-08-14)

Bu klasördeki dosyalar **artık uygulanmaz**. İçerdikleri her şey
`supabase/migrations/00000000000000_prod_baseline.sql` içinde, **production'ın
gerçek hâliyle** yer alır.

## Neden arşivlendi

Bu depoda **iki ayrı migration dizini** aynı production veritabanını yönetiyordu:

| Dizin | Prod defterindeki kayıt |
|---|---|
| `website/supabase/migrations` | **10** (001_init · 002_remote_commands · command_bus · individual_mode · command_acks · command_ack · linking_codes · data_retention · pin_hardening · vehicle_push) |
| `supabase/migrations` (kök) | **2** (20260610000021 · 20260610000022) |

Yani prod'un **tabanı website zinciriydi**; kök zincir onun üzerine defter
tutulmadan elle uygulanmıştı. Bunun üç somut sonucu vardı:

1. **Sürüm çakışması** — kök `20260424000009_user_trial.sql` ile website
   `20260424000009_command_bus.sql` **aynı sürüm numarasına** çözülüyordu; prod
   defterinde bu sürüm `command_bus` olarak kayıtlıydı → CLI `user_trial`'ı
   *uygulanmış sayıp atlıyordu*.
2. **Deftersiz taban** — `20260421000000_initial_schema.sql` prod defterinde yoktu
   ama yarattığı nesnelerin bir kısmı prod'da vardı → `db push` `companies zaten
   var` ile düşüyordu.
3. **Ters varsayımlar** — kök zincirin ilk dört migration'ı `users`/`memberships`/
   `tasks` + 5 enum'lu bir dünya kuruyor; prod ise `profiles` + text kolonlu
   website dünyasında. İkisi aynı veritabanında **uzlaşamaz**.

## Ne yapıldı

Prod'un kataloğu salt-okunur okundu (Management API `read_only:true`) ve
**tek bir baseline squash** üretildi. Prod'un migration defteri bu baseline'a
hizalandı (eski 12 kayıt `supabase_migrations.schema_migrations_backup_20260814`
tablosuna yedeklendi, sonra silindi). Baseline **prod'da çalıştırılmadı** — prod
zaten o durumdaydı; yalnız `applied` olarak işaretlendi.

Baseline'ın prod'un birebir kopyasını ürettiği **ölçüldü**: temiz bir Supabase
stack'ine uygulanıp katalog karşılaştırması yapıldı → **969/969 anahtar aynı**
(Türkçe tanımlayıcılar bayt düzeyinde doğrulandı).

## Bu dosyalara ne olacak

- **Silinmediler**: tarihsel kayıt ve kök-neden incelemesi için burada duruyorlar.
- **Asla yeniden uygulanmazlar**: `supabase/migrations` dizininde değiller.
- Yeni bir ortam kurulurken tek doğru yol: `00000000000000_prod_baseline.sql` +
  ondan sonraki migration'lar.

## Klasörler

- `root/` — eski `supabase/migrations` zincirinin baseline'a giren kısmı
  (`20260421000000` … `20260714000033`) + bu turdan önce yazılan ve baseline
  tarafından gereksiz kılınan düzeltici migration'lar (`065-P1…P4`).
- `website/` — `website/supabase/migrations` zincirinin tamamı.

Ayrıntılı sapma analizi: `docs/db/SCHEMA_DRIFT_REPORT_20260814.md`
Uygulama kaydı: `docs/DEVICE_VALIDATION_LEDGER.md` #582 ve #583.
