# OTA v1 — Mimari ve Operasyon Kılavuzu

> CarOS Pro cihaz-içi güncelleme sistemi. 7 commit'lik seri:
> `3f9b456` version truth · `a04ff42` schema · `8a60066` publish ·
> `3b11e82` download · `6740d44` install gate · `ca97374` orchestration ·
> (bu commit) telemetry loop.

---

## 1. Mimari

```
[Geliştirici]                         [Supabase]                        [Cihaz / K24]
release:bump → release:apk            ota_releases (draft→active)       otaUpdateService (boot + 6h poll)
      │                                    ▲      │ anon+RLS                   │
      └─ ota:publish ──────────────────────┘      │ yalnız status='active'     │
         (SHA-256 + Storage upload)               ▼                            ▼
                                      Storage: ota_apks (private) ──► downloadOtaApk (native)
                                                                       streaming SHA-256 + .tmp→.apk
RolloutCenter (admin)                                                          │
  status active/paused ◄── circuit breaker                                     ▼
        ▲                                                              installOtaApk (native)
        │                                                              paket/sürüm/imza ön-kontrol
getRolloutHealth ◄── vehicle_events ◄── ota_event (success/fail) ◄── sistem kurulum diyaloğu
                                                                       (KULLANICI ONAYI — sessiz yok)
```

**Katmanlar:**
- **Sürüm gerçeği:** `version.properties` tek kaynak → gradle (`versionCode`) + vite define (`VITE_APP_VERSION*`) + runtime `getAppVersionInfo` (PackageManager — drift imkânsız).
- **Veri modeli:** `ota_releases` (`20260610000018`) + `ota_apks` private bucket (`20260610000019`). Cihaz anon key + RLS ile yalnız `status='active'` görür.
- **Cihaz akışı:** `otaUpdateService.ts` durum makinesi: `idle → checking → available → downloading → verified → install_prompted → installed_waiting_reboot | failed`.
- **Park kapısı:** hız > 0 iken indirme/kurulum başlamaz (sürücü dikkati).

## 2. Publish Süreci (runbook)

```bash
# 1. Sürüm artır (version.properties tek kaynak)
npm run release:bump [x.y.z]

# 2. Release APK üret (key.properties imzası şart)
npm run release:apk

# 3. Önizleme (hiçbir şey yüklemez, service role istemez)
npm run ota:publish -- --apk android/app/build/outputs/apk/release/app-release.apk --dry-run

# 4. Gerçek publish (env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — YALNIZ publish makinesi)
npm run ota:publish -- --apk <path> --channel internal
```

- Kayıt **draft** doğar; cihazlar göremez. Storage path deterministik:
  `releases/v{VERSION_NAME}/caros-pro-v{VERSION_CODE}.apk`.
- Aynı sürüm İKİ KEZ yüklenemez (storage 409 + `version_code` UNIQUE) —
  yayınlanmış artefakt değiştirilemez; düzeltme = yeni versionCode.

## 3. Rollout Süreci — internal → pilot → production

1. **Aktive et (super_admin):** `ota_releases.status = 'active'` (`channel='internal'`).
2. **internal:** ekip cihazları (`ota-channel` cihaz-yerel ayarı `internal`). En az 1 tam döngü: indir → kur → boot → `ota_success` eventi görüldü mü?
3. **pilot:** `--channel pilot` ile aynı APK'yı pilot kanalına publish et (veya satırın kanalını güncelle). `getRolloutHealth` stabilite < 60 → **İLERLEME DURDURULUR** (RolloutCenter circuit breaker).
4. **production:** pilot temizse production kanalına. Sorun anında: `status='paused'` → cihazlar yeni sürümü ANINDA görmez olur (RLS).

## 4. Rollback Yaklaşımı

**Gerçek downgrade YOK ve OLAMAZ:** root'suz Android, `versionCode` düşürmeyi
kurulum düzeyinde reddeder; install gate de `ERR_DOWNGRADE` ile erken keser.
Strateji **forward-fix**tir:
- Kötü sürümü `status='paused'`/`'revoked'` yap (yayılma durur).
- Eski/düzeltilmiş kodu **yeni versionCode** ile publish et.
- `rollout_plans.rollback_to` alanı forward-fix sürümünü İŞARET EDER (belge alanı).

## 5. Güvenlik Modeli

| Katman | Mekanizma |
|--------|-----------|
| Erişim | private bucket + anon-key (RLS yalnız okuma); **service_role cihaza ASLA inmez** (yalnız publish env) |
| Bütünlük | `ota_releases.sha256` ↔ native streaming SHA-256; mismatch → tmp silinir |
| Köken | APK imza sertifikası SHA-256 seti kurulu uygulamayla AYNI olmalı (install gate, sistem diyaloğundan önce) |
| Kimlik | `packageName` eşitliği + `versionCode` artışı zorunlu |
| Dosya | fileName regex + canonical path containment (files/ota dışına çıkış imkânsız) |
| Kurulum | SESSİZ KURULUM YOK — her zaman Android sistem diyaloğu (kullanıcı onayı) |
| Sürüş | park kapısı: hız > 0 → OTA bekler |

## 6. Telemetri / Circuit Breaker Beslemesi

- `ota_success {versionCode, versionName}` — boot reconcile'da hedef sürüme
  ulaşıldığında, **sürüm başına bir kez** (safeStorage dedup, reboot dayanıklı).
- `ota_fail {errorCode, versionCode}` — her `failed` geçişinde, **aynı
  (errorCode, versionCode) çifti bir kez** (spam engeli).
- Taşıyıcı: `pushVehicleEvent('ota_event', …)` → `push_vehicle_event` RPC →
  `connectivityService` at-least-once kuyruğu → `vehicle_events` tablosu.
- Admin: `superadmin.service.getRolloutHealth` aynı `vehicle_events`
  tablosundan beslenir (bugün `system_health.appVersion` ile; `ota_event`
  satırları breaker'ın gelecekteki OTA-özel metriği için hazır).

## 7. K24 Saha Doğrulama Adımları

> Tamamı **cihazda doğrulanmadı** durumunda — ilk K24 oturumunda sırayla:

1. **Migration deploy:** `supabase db push` → DO bloklarının NOTICE çıktıları (GRANT/RLS/policy PASS).
2. **Publish:** gerçek APK ile `ota:publish --channel internal` → dashboard'da draft satır + Storage objesi.
3. **Aktivasyon:** `status='active'` → cihaz Settings kartında "Yeni sürüm hazır".
4. **İndirme:** progress aktığını ve `files/ota/*.apk` oluştuğunu doğrula; **hash-mismatch testi**: sha256 kolonunu boz → `ERR_HASH` + tmp silinmiş olmalı.
5. **İzin:** ilk "Kur" → bilinmeyen-kaynak ayar ekranı AÇILIYOR MU? (**en büyük ROM riski** — açılmıyorsa OTA v1 stratejisi USB/servis kurulumuna daralır, sözleşmeye öyle yazılır).
6. **Kurulum diyaloğu:** sistem ekranı + onay → uygulama kapanır.
7. **Reboot/yeniden açılış:** launcher (HOME default) otomatik geri geldi mi?
8. **Sürüm teyidi:** Settings → Hakkında / `getAppVersionInfo` yeni versionCode.
9. **ota_success:** `vehicle_events`'te `ota_event/ota_success` satırı + RolloutCenter health'te sürüm görünürlüğü.
10. **Park kapısı:** araç hareketliyken kartın kilitli olduğunu doğrula.
