# Migration History Çözümü — Production `vdpcdhrdmsacftrietzq`

**Tarih:** 2026-07-29 · **Yöntem:** salt-okunur production envanteri (`BEGIN READ ONLY`)
**Durum:** ÇÖZÜM BELİRLENDİ — **UYGULANMADI** (production'a yazılmadı)

---

## 1. Problem

Production migration geçmişi (`supabase_migrations.schema_migrations`) **12 satır** içeriyor ve
en yenisi `20260610000022`. Ancak repoda **iki ayrı migration zinciri** var:

| Zincir | Konum | Dosya |
|---|---|---:|
| Website | `website/supabase/migrations/` | 12 |
| Kök | `supabase/migrations/` | 36 |

Production geçmişindeki 12 kaydın **10'u website zincirinden**, **2'si kök zincirden**
(`20260610000021`, `20260610000022`) geliyor. Yani geçmiş **karışık** ve hiçbir zinciri
tam temsil etmiyor.

---

## 2. Kesin sınıflandırma (nesne varlığı ile kanıtlandı)

Kök zincirdeki `20260610000022` sonrası her migration için, oluşturduğu nesnenin
production'da var olup olmadığı tek tek ölçüldü.

### 2.1 `ZATEN_UYGULANMIŞ_BANT_DIŞI` — 11 migration

Nesneleri production'da **VAR**, geçmişte **YOK**. SQL editöründen elle uygulanmışlar.

| Version | Ad | Doğrulanan nesne | Prod |
|---|---|---|---|
| `20260702000023` | key_beam | `key_beams` tablosu, `submit_key_beam`, `consume_key_beam` | VAR |
| `20260702000024` | fix_push_vehicle_event_api_key | `push_vehicle_event` | VAR |
| `20260706000025` | get_recent_diagnostics | `get_recent_diagnostics` | VAR |
| `20260706000026` | fix_push_vehicle_event_text_vehicle_id | gövdede `v_vehicle_id::text` | VAR |
| `20260706000027` | push_vehicle_event_cap_64k | gövdede `65536` | VAR |
| `20260706000028` | vehicle_geofences | `vehicle_geofences` + 3 RPC | VAR |
| `20260709000029` | secure_get_recent_diagnostics | `plpgsql` + `super_admin` guard | VAR |
| `20260710000030` | canonical_feature_flags | `feature_flags` | VAR |
| `20260710000031` | canonical_runtime_policies | `runtime_policies` | VAR |
| `20260710000032` | canonical_audit_logs | `audit_logs` | VAR |
| `20260714000033` | support_reports_reader | `support_reader_secret`, `get_support_reports` | VAR |

### 2.2 `UYGULANMAMIŞ` — 4 migration

| Version | Ad | Kanıt |
|---|---|---|
| `20260729000033` | enable_individual_ownership_schema | `profiles.company_id` ve `vehicle_locations.company_id` hâlâ **NOT NULL** |
| `20260729000034` | pairing_company_and_owner_gps | `pair_vehicle_to_user` **YOK**, `vehicle_pairings.company_id` **YOK** |
| `20260729000035` | fleet_membership_foundation | `create_company` / `add_company_member` / `on_auth_user_created` **YOK** |
| `20260729000036` | fleet_management_rpcs | `current_membership` / `update_company` / `delete_company` / `update_member_role` / `remove_company_member` / `assign_vehicle_to_company` / `remove_vehicle_from_company` / `list_company_members` / `list_company_vehicles` **YOK** |

### 2.3 Geçmişten eski dosyalar (`20260421…20260610000020`)

Kök zincirde 15 dosya var ve geçmişte kayıtlı değiller. Ancak hepsi remote'un en yeni
sürümünden (`20260610000022`) **eski** olduğu için Supabase CLI bunları varsayılan
`db push` sırasında **atlar** (uygulanması için açıkça `--include-all` gerekir).
**`--include-all` KULLANILMAMALIDIR.**

---

## 3. Neden düz `supabase db push` PATLAR

`db push` remote'un en yeni sürümünden yeni olan **13 dosyayı** (023→035) uygulamaya çalışır.
Bunların 11'i zaten uygulanmış. Çoğu `IF NOT EXISTS` / `CREATE OR REPLACE` ile idempotent
olsa da **`CREATE POLICY`'nin `IF NOT EXISTS` biçimi PostgreSQL'de YOKTUR** ve bu politikaların
production'da var olduğu ölçüldü:

| Tablo | Politika |
|---|---|
| `key_beams` | `no_direct_access` |
| `vehicle_geofences` | `superadmin_select_vehicle_geofences` |
| `feature_flags` | `anon_read_flags`, `superadmin_all_flags` |
| `runtime_policies` | `anon_read_policies`, `superadmin_all_policies` |
| `audit_logs` | `superadmin_read_audit`, `superadmin_write_audit` |

→ İlk politika oluşturan migration (`20260702000023_key_beam`) **`42710 duplicate_object`**
ile düşer ve push yarıda kalır. Bu **kanıtlanmış** bir rollout blokerdir.

---

## 4. Seçilen çözüm: HISTORY REPAIR (şema değişikliği YOK)

`supabase migration repair --status applied <version>` **yalnız**
`supabase_migrations.schema_migrations` tablosuna satır ekler. Hiçbir DDL çalıştırmaz,
hiçbir veri değiştirmez. Zaten uygulanmış 11 migration için doğru ve en düşük riskli araçtır.

### 4.1 Uygulanacak komutlar (HENÜZ ÇALIŞTIRILMADI)

```bash
# Hedef doğrulaması — ref production olmalı
cat supabase/.temp/project-ref     # beklenen: vdpcdhrdmsacftrietzq

supabase migration repair --linked --status applied \
  20260702000023 20260702000024 20260706000025 20260706000026 \
  20260706000027 20260706000028 20260709000029 20260710000030 \
  20260710000031 20260710000032 20260714000033
```

### 4.2 Repair sonrası doğrulama (salt-okunur)

```sql
-- 11 satır eklenmiş olmalı, toplam 23
SELECT count(*) FROM supabase_migrations.schema_migrations;

-- Bekleyen yalnız 033/034/035 olmalı
SELECT version FROM supabase_migrations.schema_migrations
 WHERE version >= '20260702000023' ORDER BY version;
```

### 4.3 Ardından push

```bash
supabase db push --linked          # --include-all KULLANMA
```

Uygulanacaklar: `20260729000033` → `20260729000034` → `20260729000035` → `20260729000036` (bu sırayla).

---

## 5. Sıralama zorunluluğu

```
033 (NOT NULL kaldır) → 034 (pairing + GPS) → 035 (profil + filo üyeliği) → 036 (filo yönetim RPC'leri)
```

- **033 önce olmalı:** `profiles.company_id` NOT NULL iken 035'in bireysel profil
  backfill'i (`company_id = NULL`) çalışamaz. 035 bunu fail-closed ön kontrolle şart koşar.
- **035, 034'ten sonra:** 034'ün `pair_vehicle_to_user` sözleşmesine dokunmaz ama `pair_vehicle`
  yetkisini daraltır; sırası 034'ten sonra olmalıdır ki iki eşleştirme yolu aynı anda tanımlı olsun.
- **036 en son:** 035'in kurduğu `profiles.company_id` + `profiles.role` + `companies`
  üzerine yazma/okuma RPC'leri ekler. 035 uygulanmadan 036'nın `current_membership()`
  ve `assign_vehicle_to_company()` fonksiyonları **var olmayan sütun/tabloya** bakar.
  036 yalnız **fonksiyon** ekler — hiçbir tabloyu DROP/ALTER etmez, mevcut RLS
  politikalarını yeniden yazmaz (kilit: `fleetSqlAndLab.test.ts`).

---

## 5.1 Staging doğrulama paketi (push SONRASI, production'da DEĞİL)

`supabase/verification/validate_035_036_staging.sql` — tek dosyada 14 kontrol.

- **HEDEF KAPISI:** dosya başında veritabanı adı kontrolü var; production'a karşı
  çalıştırılırsa `RAISE EXCEPTION` ile **kendini durdurur**.
- Kontroller: (1) `auth.users` INSERT → profil oluşur · (2) profilsiz kullanıcı
  backfill · (3) duplicate profil oluşmaz · (4) varsayılan rol `individual` ·
  (5) `company_id` NULL güvenli · (6) `create_company` kurucuyu admin yapar ·
  (7) ikinci şirket reddedilir · (8) `add_company_member` yalnız admin ·
  (9) cross-company üyelik reddedilir · (10) anon hiçbir filo RPC'sini
  çalıştıramaz · (11) `pair_vehicle` anon+authenticated'a kapalı ·
  (12) `service_role` `pair_vehicle` çağırabilir (`/api/pwa/pair` kırılmasın) ·
  (13) son admin + kendi-rol koruması · (14) sahipsiz araç filoya atanamaz.
- Her kontrol düşerse `RAISE EXCEPTION` ile **durur**; sonunda
  `=== TÜM KONTROLLER GEÇTİ (14/14) ===` yazar.
- ⚠️ **Bu dosya HENÜZ ÇALIŞTIRILMADI.** Staging'de push sonrası çalıştırılmalıdır.

---

## 5.2 STAGING SONUÇLARI (2026-07-29 — GERÇEKTEN KOŞULDU)

Hedef: `azvmrbjaxiwz…` (staging). Production'a **hiçbir yazma yapılmadı**;
her komut önce `STAGING_CONFIRMATION` = URL-ref eşitliğini doğrulayan bir
fail-closed kapıdan geçti.

**Staging başlangıç durumu (ölçüldü):** şema bant-dışı yüklü (22 tablo),
`supabase_migrations.schema_migrations` **YOK**, `auth.users = 0`.
033 + 034 etkileri **zaten mevcut**; 035 ve 036 **uygulanmamıştı**;
`pair_vehicle` **anon'a AÇIKTI**.

> ⚠️ Bu yüzden staging'de anlamlı bir `db push`/history-repair provası
> YAPILAMADI (geçmiş tablosu yok, şema elle yüklenmiş). Doğrulanan şey
> **migration SQL'lerinin kendisidir**, CLI history mekanizması değil.
> History repair adımı hâlâ **provasız** — bkz. §7.

### 🔴 BULUNAN P0 — bant-dışı `profiles_role_check`

İlk doğrulama koşusu **DÜŞTÜ**:

```
ERROR: new row for relation "profiles" violates check constraint "profiles_role_check"
CONTEXT: PL/pgSQL function handle_new_user() ...
```

Depoda **hiçbir migration dosyasında bulunmayan**, elle/dashboard üzerinden
eklenmiş dar bir kısıt vardı: `CHECK (role IN ('admin','member'))`.
Postgres tüm CHECK'leri AND'ler → 035 yeni `profiles_role_allowed` kısıtını
eklese bile `role='individual'` **YAZILAMIYORDU**. Sonuç:

- `handle_new_user` her yeni kayıtta patlıyor → **auth signup TAMAMEN KIRIK**,
- 035'in profil backfill'i abort ediyor → **migration production'da DÜŞERDİ**.

**ONARIM (035 içinde):** yeni kısıt eklenirken, `role`a bakan ve `'individual'`
İÇERMEYEN eski kısıtlar hedefli şekilde kaldırılır (kör silme YOK; yeni kısıt
eskisinin üst kümesidir → güvenlik gevşemez) + **fail-closed öz-test** eklendi:
`individual` hâlâ reddediliyorsa migration `RAISE EXCEPTION` ile DURUR.
Kilitler: `website/src/__tests__/fleetMembershipFoundation.test.ts` (6 yeni kilit).

### Doğrulama sonuçları

| Koşu | Sonuç |
|---|---|
| `validate_035_036_staging.sql` | **14/14 GEÇTİ** (ROLLBACK ile kalıntı bırakmaz) |
| 035 + 036 yeniden uygulama (idempotency) | **temiz** — hata yok, yan etki yok |
| Gerçek auth uçtan uca (GoTrue + PostgREST, 41 kontrol) | **41/41 GEÇTİ** |
| `resolveActor` + CAROS LAB snapshot verisi (15 kontrol) | **15/15 GEÇTİ** |
| Kalıntı | `auth.users=0 · profiles=0 · companies=0 · vehicles=0` |

**Güvenlik son durumu (staging'de doğrulandı):**
`pair_vehicle` → anon **false** · authenticated **false** · service_role **true**.
`public.profiles` üzerinde kalan tek rol kısıtı: `profiles_role_allowed`.

### Sunucunun GERÇEKTEN döndürdüğü hata kodları (sürüklenme kontrolü)

`already_member_of_company` · `user_belongs_to_another_company` ·
`not_company_admin` · `cannot_modify_self_role` · `last_admin_protected` ·
`target_user_not_found` · `invalid_role` · `invalid_company_name` ·
`vehicle_in_another_company` · `vehicle_owned_by_another_user` · `no_company`

Bunların conflict'e eşlenenleri `conflictEngine.toConflictCode()` ile **birebir
uyuşuyor**. Eşlenmeyenler (`last_admin_protected`, `cannot_modify_self_role`,
`invalid_*`, `no_company`) conflict DEĞİL, kalıcı iş kuralı reddidir →
`PERMANENT_FAILED` (4xx retryable değil, sonsuz retry YOK). Bu koşuda
**bekleyen işlemler ekranının hata NEDENİNİ hiç göstermediği** bulundu ve
düzeltildi (`fleet/pending/page.tsx` + 6 kilit).

---

## 6. Geri alma

- **Repair geri alma:** eklenen satırlar `DELETE FROM supabase_migrations.schema_migrations
  WHERE version IN (...)` ile geri alınır — şema etkilenmez.
- **033 geri alma:** `docs/db/ROLLBACK_20260729_individual_ownership.md`
- **034/035 geri alma:** fonksiyonlar `DROP FUNCTION`; `vehicle_pairings.company_id`
  kolonu `DROP COLUMN`. 035'in profil backfill'i **geri alınmamalıdır** (profil satırı
  olmaması zaten kusurdu).
- **036 geri alma:** yalnız `DROP FUNCTION` (9 fonksiyon) — şema/veri etkilenmez.
  ⚠️ Geri alınırsa `/api/company/*` rotalarının **tamamı** çalışmaz duruma gelir;
  filo ekranları `server_error` gösterir (fail-closed, veri kaybı YOK).

---

## 7. Yapılmayanlar (bilinçli)

- Repair **çalıştırılmadı**
- `db push` **çalıştırılmadı**
- Production'a **hiçbir yazma yapılmadı**
- `validate_035_036_staging.sql` **staging'de çalıştırıldı → 14/14** (production'da DEĞİL)
- **History repair PROVASIZ:** staging'de `schema_migrations` tablosu olmadığı
  için §4.1 repair komutları ve `db push` akışı denenemedi. Production'da ilk
  kez çalışacaklar — bu, kalan en büyük risktir.
- `--include-all` **önerilmiyor** (15 eski dosyayı yeniden uygulamaya kalkar)
- İki zincirin (`website/` ve kök) birleştirilmesi bu görevin kapsamı dışında —
  ayrı bir temizlik PR'ı gerektirir ve rollout'u bloke etmez.
