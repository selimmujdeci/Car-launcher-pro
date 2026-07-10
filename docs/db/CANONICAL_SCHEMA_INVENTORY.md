# CAROS PRO — Canonical Supabase Schema Inventory (PR-SQL-1)

> **Kapsam:** Yalnız **analiz + envanter**. Bu belge hiçbir production DB değişikliği
> içermez, hiçbir SQL production'a uygulanmamıştır. Recovery migration'ları ayrı PR'larda
> (PR-SQL-2..5) üretilecektir. Bu PR = **PR-SQL-1: envanter + kanonik kaynak kararı +
> doğrulama tooling**.
>
> **Snapshot tarihi:** 2026-07-09 (introspection: `docs-local/db-truth/`, **gitignore'lu — commit edilmez**).

---

## 0. Kullanılan gerçek kaynaklar

| Kaynak | Konum | Not |
|--------|-------|-----|
| Kod Supabase çağrıları | `src/**`, `website/src/**`, `website/app/**` | `.from()`, `.rpc()`, `.channel()`, REST `rpc/…` |
| Kök migration seti | `supabase/migrations/` | 28 dosya |
| Website migration seti | `website/supabase/migrations/` | 12 dosya |
| Canlı introspection | `docs-local/db-truth/*.json` | tablolar, kolonlar, RLS, policies, grants, RPC, row counts, schema_migrations |

---

## 1. Canlı DB anlık görüntüsü

### 1.1 Public tablolar (21) — hepsinde RLS **açık**

`audit_logs`, `command_logs`, `companies`, `feature_flags`, `key_beams`, `notifications`,
`ota_releases`, `profiles`, `rollout_plans`, `route_commands`, `runtime_policies`,
`telemetry_events`, `vehicle_commands`, `vehicle_events`, `vehicle_geofences`,
`vehicle_linking_codes`, `vehicle_locations`, `vehicle_pairings`, `vehicle_push_tokens`,
`vehicle_telemetry`, `vehicles`.

### 1.2 Satır sayıları (veri olan tablolar)

| Tablo | Satır | | Tablo | Satır |
|-------|------:|-|-------|------:|
| vehicle_events | 4026 | | vehicle_geofences | 1 |
| audit_logs | 167 | | key_beams | 1 |
| vehicles | 85 | | vehicle_pairings | 1 |
| vehicle_telemetry | 19 | | (diğer 13 tablo) | 0 |

### 1.3 Canlı RPC'ler (26)

`auth_company_id`, `cleanup_expired_linking_codes`, `cleanup_old_telemetry`,
`cleanup_vehicle_log_events`, `consume_key_beam`, `delete_geofence_zone`,
`expire_stale_commands`, `fn_enforce_critical_pin`, `fn_set_updated_at`,
`get_geofence_zones`, `get_my_plan`, `get_recent_diagnostics`, `handle_new_user`,
`increment_command_retry`, `is_paired`, `is_vehicle_owner`, `pair_vehicle`,
`pair_vehicle_by_code`, `push_geofence_zone`, `push_vehicle_event`, `refresh_linking_code`,
`register_push_token`, `register_vehicle`, `set_vehicle_pin`, `submit_key_beam`,
`update_command_status`, `verify_and_send_critical_command`.

---

## 2. 🔴 KRİTİK: Migration-geçmişi ayrışması (kanonik kaynak sorununun kökü)

Canlı DB'nin `supabase_migrations.schema_migrations` geçmişi (12 kayıt):

```
001 init · 002 remote_commands · 20260424000009 command_bus · 20260424000100 individual_mode
20260424000200 command_acks · 20260424000300 command_ack · 20260425000001 linking_codes
20260426000001 data_retention · 20260426000002 pin_hardening · 20260426000003 vehicle_push
20260610000021 vehicle_events_superadmin_read · 20260610000022 voice_diag_log_type
```

**Sonuç:**
- Canlı DB **çoğunlukla `website/supabase/migrations/` seti** (001…20260430) ile kuruldu; kök setten yalnız **2 dosya** (`…021`, `…022`) geçmişte kayıtlı.
- Kök `supabase/migrations/` setindeki **diğer 26 migration'ın büyük kısmı `schema_migrations`'da YOK** — ama bazı ürettikleri yapılar canlıda **var** (aşağıda "out-of-band").
- Bu, "kanonik kaynak" kararının merkezidir → bkz. `CANONICAL_SOURCE_DECISION.md`.

**Out-of-band uygulanmış (canlıda var, history'de kayıtsız) kök migration örnekleri:**

| Kök migration | Ürettiği (canlıda var) | Kanıt |
|---------------|------------------------|-------|
| `…023_key_beam` | `key_beams` tablo + `submit/consume_key_beam` RPC | tablo var (1 satır), RPC var |
| `…025/029_get_recent_diagnostics` | `get_recent_diagnostics` RPC | RPC var; `docs-local/db-truth/_mig029_apply.sql` |
| `…028_vehicle_geofences` | `vehicle_geofences` + geofence RPC'ler | tablo var (1 satır) |
| `…026_fix_push_vehicle_event_text` | `push_vehicle_event` (vehicle_id TEXT) | RPC var, vehicle_id=text |

> Memory teyidi: "Migration 025/026 history'ye yazılmadı" + Management API apply script'leri.

---

## 3. Aşama 1 — Uygulama → DB kullanım matrisi

### 3.1 In-car + admin (`src/**`) `.from()` tabloları

| Tablo | Kod | Canlı DB | Sınıf |
|-------|:---:|:--------:|-------|
| vehicle_events | ✓(13) | ✓ | kod+DB+migration(website/root) |
| feature_flags | ✓(9) | ✓ | kod+DB, kök migration YOK → **out-of-band** |
| memberships | ✓(8) | ✗ | **kod var, DB YOK** (company-member özelliği) |
| rollout_plans | ✓(6) | ✓ | kod+DB (ota_release_registry) |
| vehicles | ✓(5) | ✓ | kod+DB |
| audit_logs | ✓(5) | ✓ | kod+DB, kök migration YOK → **out-of-band** |
| vehicle_commands | ✓(4) | ✓ | kod+DB |
| radar_reports | ✓(4) | ✗ | **kod var, DB YOK** (topluluk radar) |
| companies | ✓(4) | ✓ | kod+DB |
| runtime_policies | ✓(3) | ✓ | kod+DB, kök migration YOK → **out-of-band** |
| users | ✓(2) | ✗(public) | muhtemelen `auth.users`/`profiles` — **isim doğrulanmalı** |
| system_configs | ✓(2) | ✗ | **kod var, DB YOK** → ölü kod adayı |
| sentry_clips | ✓(2) | ✗ | **kod var, DB YOK** (sentry_mode migration'da; canlıda değil) |
| raw_community_events | ✓(2) | ✗ | **kod var, DB YOK** (community_events migration'da) |
| vehicle_geofences | ✓(1) | ✓ | kod+DB → **out-of-band** |
| remote_commands | ✓(1) | ✗ | canlıda `route_commands`/`vehicle_commands` var → **isim drift'i** |
| ota_releases | ✓(1) | ✓ | kod+DB |

### 3.2 Website PWA (`website/src`, `website/app`) `.from()` tabloları

| Tablo | Canlı DB | Not |
|-------|:--------:|-----|
| vehicles, vehicle_commands, vehicle_telemetry, vehicle_pairings, vehicle_locations, vehicle_events, route_commands | ✓ | uyumlu |
| vehicle_linking_codes | ✓ | uyumlu |
| **push_subscriptions** | ✗ | canlıda `vehicle_push_tokens` → **isim drift'i** (kök migration 007 vs website vehicle_push) |
| **linking_codes** | ✗ | canlıda `vehicle_linking_codes` → **isim drift'i** |

### 3.3 RPC kullanım matrisi

| Kod RPC | Canlı | Sınıf |
|---------|:-----:|-------|
| push_vehicle_event, register_vehicle, register_push_token, get_geofence_zones, get_recent_diagnostics, increment_command_retry, submit_key_beam, pair_vehicle, get_my_plan, cleanup_old_telemetry | ✓ | kod+DB |
| **remove_member** | ✗ | **kod var, RPC YOK** (memberships) |
| **link_vehicle** | ✗ | **kod var, RPC YOK** |
| **add_member_by_email** | ✗ | **kod var, RPC YOK** (memberships) |

### 3.4 Realtime + storage

- Realtime kanalları: `sa-live-vehicle-events`, `sa-mobile-critical` (superadmin panel) → `vehicle_events` / `vehicle_commands` üzerinden.
- Storage: sentry/dashcam klip storage policy migration'ları var (`…sentry_storage_policies`, `…ota_storage_policies`); kod `.storage.from()` doğrudan literalle taranınca eşleşme çıkmadı → **ayrı doğrulama** gerek (dinamik bucket adı olabilir).

---

## 4. Aşama 5 — Güvenlik bulguları

### 4.1 🔴 anon FULL grant (defense-in-depth başarısızlığı)

**21 tablonun 19'unda `anon` = `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE`** (tam yetki).
Yalnız **kilitli 2 tablo:** `key_beams` (yalnız service_role), `vehicle_geofences` (anon yalnız SELECT).

- RLS her tabloda açık olduğundan pratik erişim policy'lerle sınırlanıyor; ANCAK anon'un
  audit_logs/profiles/vehicles/companies üzerinde `DELETE/UPDATE/TRUNCATE` **GRANT**'ı olması,
  herhangi bir policy yanlış yapılandırıldığında (ör. permissive `USING(true)`) tam sızıntı riski.
- **Öneri (PR-SQL-4):** anon grant'larını gerçek ihtiyaca indir (çoğu tabloda anon erişimi
  hiç gerekmez → `REVOKE ALL FROM anon`; frontend'in gerçekten anon-key ile okuduğu tablolarda
  yalnız `SELECT`). Kaynak: Supabase varsayılan-anon-grant tuzağı (public şemada otomatik grant).

### 4.2 feature_flags / runtime_policies — anon `USING(true)`

| Tablo | anon policy | Değerlendirme |
|-------|-------------|---------------|
| feature_flags | `anon_read_flags` SELECT `USING(true)` | **tüm** flag'ler (disabled/internal dahil) anon'a görünür |
| runtime_policies | `anon_read_policies` SELECT `USING(true)` | aynı — tüm policy satırları anon'a açık |

- **Öneri:** `USING(true)` yerine **public/enabled scope**'a daralt (ör. `USING (enabled = true)`
  veya `USING (scope = 'public')`). Kolon yoksa önce ekle. Yazma policy'si anon'da yok (iyi).

### 4.3 audit_logs

- Policy'ler superadmin (app_metadata.role) tabanlı — anon permissive policy YOK (iyi).
- Ancak anon FULL **grant** var → 4.1 kapsamında daraltılmalı (167 satır adli kayıt; anon DELETE/TRUNCATE grant'ı kabul edilemez).

---

## 5. Aşama 6 — Tip / FK / Index bulguları

### 5.1 `vehicle_id` tip envanteri

| Tablo | vehicle_id | vehicles.id ile FK-uyumlu? |
|-------|-----------|:--:|
| vehicle_events | **text** | ❌ (vehicles.id=uuid) |
| vehicle_geofences | **text** (ayrıca `id`=text!) | ❌ |
| command_logs, notifications, route_commands, telemetry_events, vehicle_commands, vehicle_linking_codes, vehicle_locations, vehicle_pairings, vehicle_push_tokens, vehicle_telemetry | uuid | ✅ |

- `vehicles.id`, `companies.id`, `vehicle_events.id`, `vehicle_locations.id`, `vehicle_telemetry.id` = **uuid**.
- `vehicle_geofences.id` = **text** (PK text — aykırı).

### 5.2 Risk

- `vehicle_events.vehicle_id = text` (4026 satır) + RLS policy'de `vehicle_id IN (SELECT vehicles.id::text …)`
  → **cast** kaynaklı olası **index suppression** + `vehicles(id)` FK **kurulamıyor**.
- **Bu PR'da destructive tip dönüşümü YOK.** vehicle_events/vehicle_geofences için ayrı
  migration + preflight (satır sayısı, geçersiz uuid kontrolü, downtime penceresi) planı = **PR-SQL-5**.

### 5.3 created_at / updated_at eksikleri (tespit — düzeltme PR-SQL-5)

- `updated_at` eksik: audit_logs, command_logs, companies, key_beams, notifications, ota_releases, profiles, rollout_plans, route_commands, telemetry_events, vehicle_events, vehicle_linking_codes, vehicle_locations, vehicle_telemetry
- `created_at` eksik: runtime_policies, vehicle_pairings, vehicle_telemetry

---

## 6. Ölü kod adayları (otomatik tablo ÜRETME — önce doğrula)

| Aday | Neden | Karar önerisi |
|------|-------|---------------|
| `system_configs` | kodda `.from()` var, canlıda yok, aktif akış kanıtı zayıf | **ölü kod adayı** — kullanım izini doğrula, yoksa kod temizliği (ayrı PR) |
| `raw_community_events` | community_events migration'da; canlıda yok | topluluk özelliği pasif olabilir — doğrula |
| `sentry_clips` | sentry_mode migration'da; canlıda yok | Sentry klip yükleme akışı canlıda kullanılıyor mu? doğrula |
| `radar_reports` | topluluk radar; canlıda yok | radarCommunityService gerçekten yazıyor mu? doğrula |
| `memberships` + `remove_member`/`add_member_by_email`/`link_vehicle` | admin company-member özelliği; canlıda hiçbiri yok | özellik canlı mı yoksa yarım mı? doğrula |
| `remote_commands` (isim) | canlıda `route_commands`/`vehicle_commands` | kod **isim drift'i** — tablo değil kod düzeltmesi olabilir |
| `push_subscriptions` / `linking_codes` (website) | canlıda `vehicle_push_tokens`/`vehicle_linking_codes` | **isim drift'i** — kod/website hizalama |

> **Kural:** Hiçbiri bu PR'da tablo olarak OLUŞTURULMAZ. Her biri PR-SQL-3'te "gerçekten
> kullanılıyor + gerekli" kanıtıyla ya migration'a alınır ya da ölü-kod temizliğine yönlendirilir.

---

## 7. Sınıflandırma özeti (Aşama 1 kategorileri)

| Kategori | Örnekler |
|----------|----------|
| Kod var + DB var + migration var | vehicle_events, vehicles, vehicle_commands, companies, ota_releases, rollout_plans |
| Kod var + DB var + (kök) migration YOK (out-of-band) | feature_flags, runtime_policies, audit_logs, vehicle_geofences, key_beams |
| Kod var + DB YOK + migration var | sentry_clips, raw_community_events, push_subscriptions(isim) |
| Kod var + DB YOK + migration YOK | memberships, radar_reports, system_configs, remote_commands(isim) |
| DB var + kod kullanıyor | (yukarıdaki tümü) |
| DB var + kod kullanmıyor (bu tarama) | command_logs, notifications, telemetry_events (doğrulanmalı) |
| RPC canlıda var + (kök) migration YOK | get_recent_diagnostics, geofence RPC'ler, key_beam RPC'ler |
| Policy/grant/RLS eksik | anon full-grant 19 tablo; feature_flags/runtime_policies USING(true) |
| Kolon/FK/index/tip uyuşmazlığı | vehicle_events.vehicle_id=text, vehicle_geofences.id/vehicle_id=text |

---

## 8. Sonraki PR'lar (bu PR'da YAPILMAZ)

- **PR-SQL-2:** out-of-band yapıların (feature_flags, runtime_policies, audit_logs, key_beams, vehicle_geofences, ilgili RPC'ler) idempotent kanonik migration'ları (`CREATE … IF NOT EXISTS`).
- **PR-SQL-3:** kodda gerekli+kanıtlı ama DB'de olmayan yapılar (doğrulama sonrası).
- **PR-SQL-4:** RLS/grant/policy hardening (anon full-grant daraltma, USING(true) scope).
- **PR-SQL-5:** UUID/FK/index/performans + created_at/updated_at (preflight'lı, non-destructive).

Hiçbiri production'a uygulanmaz; her migration `supabase/verification/verify_canonical_schema.sql`
ile salt-okuma doğrulanır ve shadow/local DB'de test edilir.
