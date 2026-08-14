# Şema Sapma Raporu — `supabase/migrations` ↔ Prod (`Carospro`)

**Tarih:** 2026-08-14
**Kapsam:** migration zincirinin sıfırdan uygulanabilirliği + prod şemasıyla karşılaştırma
**Prod erişimi:** **YALNIZ OKUMA.** Supabase Management API `/v1/projects/{ref}/database/query`
`read_only: true` ile çağrıldı — sunucu bağlantıyı `supabase_read_only_user` rolüne
düşürür, yani yazma **yapısal olarak imkânsızdı**. Ek olarak yerel araç
(`scratchpad/prod-read.ps1`) SQL'i `SELECT`/`WITH` ile başlamıyorsa veya yazma anahtar
kelimesi içeriyorsa çalıştırmayı reddeden bir kapı taşır. **Prod'a hiçbir yazma yapılmadı.
fleetval stack'ine dokunulmadı.**

---

## 1. Asıl bulgu — bu depoda İKİ migration zinciri var ve ikisi de aynı veritabanına uygulanmış

Prod'un `supabase_migrations.schema_migrations` defteri **12 kayıt** içerir:

| Kayıt | Kaynak dizin |
|---|---|
| `001_init` · `002_remote_commands` · `20260424000009_command_bus` · `20260424000100_individual_mode` · `20260424000200_command_acks` · `20260424000300_command_ack` · `20260425000001_linking_codes` · `20260426000001_data_retention` · `20260426000002_pin_hardening` · `20260426000003_vehicle_push` | **`website/supabase/migrations`** (10 kayıt) |
| `20260610000021_vehicle_events_superadmin_read` · `20260610000022_voice_diag_log_type` | `supabase/migrations` (2 kayıt) |

**Yani prod'un TABANI website zincirinden gelir; kök zincir (`supabase/migrations`) onun
ÜZERİNE, defter tutulmadan, elle uygulanmıştır.**

Kanıtlar (hepsi ölçüldü, varsayılmadı):

- Prod'da `users` · `memberships` · `tasks` · `events` · `vehicle_users` tabloları **YOK** —
  bunları kök zincirin ilk dört migration'ı yaratır. Yani o dördü **hiç uygulanmamış**.
- Prod'da `membership_role` · `vehicle_status` · `fuel_type` · `task_status` · `task_priority`
  enum tipleri **YOK** (tek enum: `command_status`). Kök `initial_schema` bu beşini yaratır.
- Prod'un `vehicles` tablosu website `001_init.sql`'in imzasını taşır: `name NOT NULL`,
  `api_key_hash`, `pairing_code`, `settings`, `owner_id`, `fuel_type **text**`,
  `status **text**` — kök zincirin `vehicles`'ı ise enum tipli ve `name` kolonsuzdur.

### 1.1 `vehicles.owner_id` nereden geliyor? (soru 2'nin cevabı)

- **Prod'da VAR:** `uuid`, nullable, `vehicles_owner_id_fkey → auth.users(id) ON DELETE SET NULL`,
  `idx_vehicles_owner_id` indeksi.
- **Yaratan:** `website/supabase/migrations/001_init.sql:30` (ve `:98` idempotent ALTER).
- **Kök zincirde:** hiçbir migration yaratmaz — ama `20260426_sentry_mode.sql` ona RLS
  politikası kurar. Zincirin 11. adımda kırılmasının sebebi budur.
- Bu bir "elle müdahale" değil, **başka bir migration dizininin ürünüdür**.

---

## 2. Ölçülen sapmalar ve yazılan düzeltici migration'lar

Yöntem: temiz bir Postgres'e **yalnız Supabase'in hazır sağladıkları** (roller · `auth` ·
`storage` · `supabase_realtime` publication · varsayılan ayrıcalıklar) kurulup kök zincir
baştan sona uygulandı; her kırılma tek tek ölçüldü, düzeltildi, tekrar koşuldu.

| # | Sapma (ölçülen hata) | Kök sebep | Düzeltici |
|---|---|---|---|
| D1 | `20260426_sentry_mode.sql` → `42703 column "owner_id" does not exist` | `vehicles.owner_id` website zincirinden gelir | **065-P1** `20260425000000_prod_baseline_alignment_p1.sql` |
| D2 | `20260427000011` → `42725 function name "public.update_command_status" is not unique` | 006 `(text,uuid,text,timestamptz)`, 011 farklı imzayla `CREATE OR REPLACE` → iki fonksiyon; 011'in niteliksiz `GRANT`'i belirsiz kalır. Prod'da tek imza vardır | **065-P1** (eski imzayı düşürür) |
| D3 | `20260427000012` → `cannot alter type of a column used in a policy definition` | 012 önce `ALTER TYPE`, sonra `DROP POLICY` yapar — sıra yanlış | **065-P2** `20260427000000_vehicle_events_policy_prep.sql` |
| D4 | `20260427000012` → `42P13 cannot change return type of existing function` | 003 `push_vehicle_event … RETURNS jsonb`, 012 aynı imzayı `RETURNS uuid` ister. Prod'da yalnız uuid sürümü vardır | **065-P1** (yalnız `jsonb` dönüşlüyü, guard ile) |
| D5 | 012 `vehicle_id`'yi `uuid` yapar; **prod'da `text`'tir** | 012 canlıya hiç uygulanmadı; 025/026 RPC'leri `::text` ile yazar → yeni ortamda RPC çalışma anında patlardı | **065-P3** `20260428000000_vehicle_events_text_restore.sql` |
| D6 | `20260702000024` → `column "api_key_hash" does not exist` | website `001_init` kolonu | **065-P1** |
| D7 | `20260729000033` → `033 ÖN KONTROL: beklenen kolonlar eksik. Bulunan: {}` | `public.profiles` ve `vehicle_locations.company_id` website zincirinden gelir | **065-P4** `20260728000000_prod_baseline_alignment_p2.sql` |
| D8 | `20260729000033` → `033 SON KONTROL: company_id index kayboldu` | `idx_vehicle_loc_company` website zincirinden gelir | **065-P4** |
| D9 | `20260730000045` → `column "lat" does not exist` | `vehicle_telemetry.lat/lng/is_online` website zincirinden gelir | **065-P4** |
| D10 | `20260730000049` → `049 HATA: presence dogrudan yazilabiliyor (RPC disi)` | **Supabase'in varsayılan ayrıcalıkları.** Prod `pg_default_acl` ölçüldü: public şemadaki her yeni tablo `anon`+`authenticated`'a `arwdDxtm` ile açılır. 049 `authenticated`'ı REVOKE etmez, sonra kendi fail-closed denetiminde buna takılır. Yerel doğrulama fixture'ı (`local_baseline_fixture.sql`) `ALTER DEFAULT PRIVILEGES` kurmadığı için **doğrulama ortamı gerçek Supabase'den sapmıştı** | **065-P5** `20260729000040_default_privileges_narrowing.sql` |
| D11 | `supabase db reset` → `23505 duplicate key … Key (version)=(20260426) already exists` | `20260426_sentry_mode.sql` ve `20260426_sentry_storage_policies.sql` **aynı sürüm numarasına** çözülür (CLI ilk alt çizgiye kadarki sayıyı sürüm sayar) | Dosya adı değişimi: `20260426_sentry_storage_policies.sql` → `20260426000001_…` (**içerik DEĞİŞMEDİ**) |

**D11 önemlidir:** bu kusur yalnız gerçek Supabase CLI ile görülür. Yani zincir, D1
düzeltilse bile CLI ile **hiçbir zaman** uygulanamıyordu.

### 2.1 Düzeltici migration'ların prod güvenliği (ölçüldü)

En riskli adım, `push_vehicle_event(text,text,jsonb)` aşırı-yüklemesini düşürmektir:
**prod'da aynı imza CANLIDIR** (yalnız dönüş tipi `uuid`). Koşulsuz bir `DROP FUNCTION IF
EXISTS` canlı RPC'yi silerdi. Bu yüzden düşürme, dönüş tipi `jsonb` ise çalışan bir guard
içindedir.

Prod-benzeri bir veritabanı kurulup (prod'un gerçek `vehicles` · `vehicle_events` ·
iki canlı RPC'si ile) P1/P2/P3 uygulandı. Ölçülen sonuç:

```
push_vehicle_event imza sayısı=1  dönüş=uuid     ← canlı RPC KORUNDU
update_command_status imza sayısı=1              ← canlı RPC KORUNDU
vehicle_events politika sayısı=2                 ← canlı politikalar KORUNDU
vehicle_id tipi=text                             ← değişmedi
065-P2: NO-OP (prod/website tabanlı ortam — 012 dünyası değil)
```

---

## 3. Doğrulama sonuçları

### 3.1 Temiz Postgres 17 + Supabase preamble
70/70 migration **hatasız** uygulandı (`TOPLAM DÜŞEN: 0`).

### 3.2 GERÇEK Supabase stack (`supabase start`, izole proje `carosverify`, kaydırılmış portlar)
Supabase CLI **70 migration'ın tamamını** uyguladı; `schema_migrations` = **70 kayıt**,
son iki kayıt `20260814000063` ve `20260814000064`. Gerçek `auth` · `storage` ·
`anon/authenticated/service_role` rolleri ve gerçek varsayılan ayrıcalıklarla.

### 3.3 Tam doğrulama betiği — `supabase/verification/local_chain_full_verify.sql`
Gerçek Supabase stack'inde **25/25 PASS**:

- **A · Zincir bütünlüğü 6/6** — owner_id+FK · api_key_hash · tek imzalı RPC'ler ·
  `vehicle_events` prod gerçeğiyle aynı (text · FK yok · 2 politika) · baseline nesneleri ·
  varsayılan ayrıcalık daraltması doğru (SELECT var, INSERT yok).
- **B · Migration 063 → 8/8** — `result` kolonu var · NULLABLE + varsayılansız · beş yeni tip
  kabul · eski dokuz tip korundu · `ecu_flash` hâlâ `23514` ile reddediliyor · yeni satırda
  `result` gerçekten NULL · jsonb yazıldı/okundu · `/api/pwa/dtc-result` rotasının birebir
  sorgusu çalıştı (eskiden `42703`).
- **C · GRANT/RLS/POLICY 4/4** — iki tabloda RLS açık · **anon = 0 ayrıcalık** ·
  `authenticated` 4/4 · `service_role` tam · `vfl_access` + `vsr_access` politikaları.
- **D · Gerçek RLS davranışı 7/7** — `SET LOCAL ROLE authenticated` + JWT taklidi altında:
  sahip yazdı (odometer **NULL**, sahte 0 yok) · aynı `client_ref` **23505** ile engellendi ·
  yabancı yazma **42501** ile reddedildi · yabancı **0 satır** gördü · sahip kendi kaydını
  gördü · servis kaydı NULL odometre ile yazıldı · sahip kendi kaydını sildi.

> **Ölçüm dürüstlüğü notu:** D bloğunun ilk sürümü `SET LOCAL`'ı transaction dışında
> kullanıyordu (`WARNING: SET LOCAL can only be used in transaction blocks`) — yani yazma
> **superuser** olarak koşmuş ve RLS **bypass** edilmişti; test yeşildi ama hiçbir şey
> kanıtlamıyordu. Betiğe `current_user <> 'authenticated'` ise **durduran** bir kapı eklendi
> ve ölçüm tekrarlandı.

### 3.4 Yanlışlama (kontrollü negatif test)
`20260425000000_prod_baseline_alignment_p1.sql` geçici olarak çıkarıldı → `supabase db reset`
**tekrar** `20260426_sentry_mode.sql`'de düştü (owner_id politikası). Dosya geri konunca
zincir yeniden 064'e kadar temiz geçti. Yani düzeltmenin etkisi ölçülmüştür, tesadüf değildir.

---

## 4. KAPANMAYAN sapmalar (bilinçli, kayıtlı)

Bunlar zinciri kırmaz; **prod'da olup kök zincirin ürettiği şemada olmayan** (veya tersi)
yüzeylerdir. Sahibi website zinciridir; kök zincire kopyalanmaları ayrı bir karardır.

| Ayrışma | Yön |
|---|---|
| `notifications` · `telemetry_events` · `route_commands` · `command_logs` · `vehicle_push_tokens` | prod'da VAR, kök zincirde YOK |
| `users` · `memberships` · `tasks` · `events` · `vehicle_users` · `push_subscriptions` · `raw_community_events` | kök zincirde VAR, prod'da YOK |
| `vehicles`: `name` · `driver_name` · `odometer_km` · `settings` · `updated_at` · `critical_pin_hash` · `vin` · `license_plate` | prod'da VAR, kök zincirde YOK |
| `vehicles`: `driver_id` · `linking_code` · `linking_code_expires_at` | kök zincirde VAR, prod'da YOK |
| `vehicles`: `fuel_type`/`status` **enum** (kök) ↔ **text** (prod); `year` int2↔int4; `ins_expiry` date↔text; `speed` int4↔float4 | tip ayrışması |
| `companies`: `slug NOT NULL UNIQUE` · `logo_url` · `is_active` | kök zincirde VAR, prod'da YOK |
| `vehicle_commands`: `company_id` · `issuer_id` · `sender_id` · `created_by` · `error_message` · `critical_auth_verified` · `updated_at` (prod) ↔ `user_id` · `error_reason` · `accepted_at` · `executed_at` · `finished_at` (kök) | iki yönlü |
| `vehicle_telemetry`: prod PK `id` + `UNIQUE(vehicle_id)` + aralık CHECK'leri ↔ kök PK `vehicle_id` | yapı ayrışması |
| `update_command_status` gövdesi: prod `api_key_hash`+sha256 ve `error_message` yazar; kök 011 `api_key` ve `error_reason` yazar | **aynı ad, farklı davranış** |

---

## 5. Prod'a uygulama — HÂLÂ MÜMKÜN DEĞİL (ayrı iş)

Bu tur zinciri **yeni bir ortamda sıfırdan kurulabilir** hâle getirdi. Prod'a `supabase db push`
ise **hâlâ mümkün değildir** ve sebebi bu turun konusu değildir:

1. **Sürüm çakışması:** kök `20260424000009_user_trial.sql` ile website
   `20260424000009_command_bus.sql` **aynı sürüm numarasını** taşır. Prod defterinde bu sürüm
   `command_bus` olarak kayıtlıdır → CLI `user_trial`'ı **uygulanmış sayıp atlar**.
2. **Taban çakışması:** `20260421000000_initial_schema.sql` prod defterinde yok → push onu
   uygulamaya çalışır → `create table companies` **zaten var** hatasıyla düşer.
3. **064'ün ön koşulu:** `user_can_access_vehicle()` `public.vehicle_users` tablosuna dayanır;
   bu tablo kök `20260421000003`'ün ürünüdür ve **prod'da YOKTUR** → 064 prod'da fail-closed durur.
   (Prod'un sahiplik modeli `owner_id` + `vehicle_pairings`'tir.)

**Önerilen yol (ayrı iş olarak açılmalı):** prod'un gerçek şemasından tek bir *baseline squash*
migration üretip (`supabase db dump --schema-only`), iki dizini tek zincirde birleştirmek ve
prod defterini `supabase migration repair` ile bu baseline'a hizalamak. Bu, geri alınamaz bir
işlemdir ve kendi runbook'unu hak eder.

---

## 6. Üretilen/değişen dosyalar

**Yeni migration'lar (mevcut hiçbir migration'ın içeriği değiştirilmedi):**
- `supabase/migrations/20260425000000_prod_baseline_alignment_p1.sql`
- `supabase/migrations/20260427000000_vehicle_events_policy_prep.sql`
- `supabase/migrations/20260428000000_vehicle_events_text_restore.sql`
- `supabase/migrations/20260728000000_prod_baseline_alignment_p2.sql`
- `supabase/migrations/20260729000040_default_privileges_narrowing.sql`

**Yeniden adlandırma (içerik aynı):**
- `20260426_sentry_storage_policies.sql` → `20260426000001_sentry_storage_policies.sql`

**Doğrulama:**
- `supabase/verification/local_chain_full_verify.sql` (yeni — gerçek zincir şemasında koşar;
  mevcut `local_063_*`/`local_064_*` betikleri kendi minimal fixture'ını kurar ve
  `DROP TABLE vehicle_commands CASCADE` yapar, bu yüzden tam zincir üzerinde kullanılamaz)
