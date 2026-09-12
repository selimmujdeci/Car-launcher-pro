# Arabam Cebimde — Account-Scoped Storage Registry

**Tarih:** 2026-07-29  
**Görev:** PWA-P1-004  
**Durum:** Foundation locally tested; production cleanup wiring yok  
**Canonical roadmap:** `docs/archive/ARABAM_CEBIMDE_PWA_ROADMAP.md`

Bu belge roadmap değildir. İstemci storage authority envanteri, registry
sözleşmesi ve sonraki purge/migration görevleri için canonical detay ekidir.

## 1. Doğrulanmış storage yüzeyleri

| Yüzey | Mevcut durum | Kanıt |
|---|---|---|
| localStorage | Aktif; credential, authority, private kayıt ve tercihler var | `website/src/lib/pairingService.ts:35-38`; `website/src/lib/criticalAuth.ts:8-14`; `website/src/components/pwa/RecordsPanel.tsx:22-67` |
| sessionStorage | Uygulama production yolunda kullanım bulunmadı | Repository `sessionStorage` taraması; yalnız registry adapter tipi eklendi |
| IndexedDB | Kullanım bulunmadı | Repository `indexedDB` taraması |
| Cache Storage | Kullanım bulunmadı | `website/public/sw.js:1-10`; `caches.open/match/delete` çağrısı yok |
| Service worker | Push/click çalıştırıyor; cache-stateless | `website/public/sw.js:1-10`, `20-79` |
| Zustand memory | Vehicle, notification, plan ve PIN dialog store'ları | `website/src/store/vehicleStore.ts:1,65`; `notificationStore.ts:1-35`; `planStore.ts:1-10`; `pinDialogStore.ts:1-11` |
| Module singleton memory | Fleet queue/orchestrator ve pending pairing store | `website/src/lib/offline/fleetOffline.ts:81-101`; `pendingPairingService.ts:67-81` |
| Native bridge | PWA client storage kullanımına dair doğrulanmış adapter yok | Repository PWA taraması; PhoneHub ayrı native trust sınırı |

Mevcut `localStorage` yardımcılarının önemli bölümü kota/parse hatasında fail-soft
davranıyor. Scanner ve verify-empty bu davranışı authority kabul etmez; storage
unavailable veya bozuk değer cleanup doğrulamasında fail-closed sonuçtur.

## 2. Registry modeli

Kod:

- `website/src/security/accountCleanup/storage/storageTypes.ts`
- `website/src/security/accountCleanup/storage/storageRegistry.ts`
- `website/src/security/accountCleanup/storage/knownStorageDescriptors.ts`

Registry:

- Scope, sensitivity, backend, cleanup policy, namespace version, owner
  requirements ve verify strategy taşır.
- En fazla 128 descriptor kabul eder.
- Duplicate ID/key, çakışan prefix pattern, future schema ve eksik ownership
  gereksinimini registration anında reddeder.
- Persistent browser backend üzerinde `SECRET` descriptor kabul etmez.
- Startup composition sonrasında freeze edilir.
- Testler ayrı instance kullanabilir; global mutable singleton yoktur.

Canonical production registry 18 descriptor içerir. Registry payload veya
secret taşımaz.

## 3. Scope ve sensitivity kararları

| Scope | Karar |
|---|---|
| `GLOBAL_DEVICE` | Yalnız allowlist'teki tema/dil/accessibility benzeri hesap-bağımsız tercihler |
| `ACCOUNT` | Account hash/owner zorunlu; logout ve switch cleanup kapsamı |
| `ACCOUNT_VEHICLE` | Account ve vehicle owner zorunlu |
| `ANONYMOUS_EPHEMERAL` | Positive bounded TTL zorunlu; remote authority veremez |
| `SECURITY_SYSTEM` | Cleanup ledger gibi boot güvenliği kayıtları; normal logout purge listesine girmez |

`SECRET` persistent browser storage yasaktır. Mevcut vehicle API key bu nedenle
production descriptor olarak meşrulaştırılmamış, scanner'ın bildiği kayıt dışı
security legacy key olarak tutulmuştur.

## 4. Kayıtlı descriptor'lar

| ID | Backend | Scope | Sensitivity | Fiziksel key/pattern | Cleanup |
|---|---|---|---|---|---|
| cleanup-ledger | localStorage | SECURITY_SYSTEM | OPERATIONAL | `caros:security:account-cleanup:v1` | externally managed |
| critical-pin-hash | localStorage | ACCOUNT | AUTHORITY | `caros_critical_pin_hash` | logout/switch/reset |
| paired-vehicle-authority | localStorage | ACCOUNT_VEHICLE | AUTHORITY | `caros_pair_vehicle_id`, name, plate | logout/switch/reset |
| fleet-offline-queue | localStorage | ACCOUNT | AUTHORITY | `caros.fleet.queue.*` | logout/switch/reset |
| ownership-snapshot | localStorage | ACCOUNT | AUTHORITY | `caros.fleet.snapshot.*` | logout/switch/reset |
| pending-pairing | localStorage | ACCOUNT | AUTHORITY | `caros.fleet.pairing.*` | logout/switch/reset/expiry |
| parking-location | localStorage | ACCOUNT_VEHICLE | PRIVATE | `caros_parking_spot` | logout/switch |
| fuel-log | localStorage | ACCOUNT_VEHICLE | PRIVATE | `caros_fuel_log` | logout/switch |
| maintenance-log | localStorage | ACCOUNT_VEHICLE | PRIVATE | `caros_service_log` | logout/switch |
| push-subscription | localStorage | ACCOUNT | AUTHORITY | `clp_push_sub` | logout/switch/reset |
| speed-alert | localStorage | ACCOUNT_VEHICLE | PRIVATE | `caros_speed_alert` | logout/switch |
| device-theme | localStorage | GLOBAL_DEVICE | PREFERENCE | `caros-theme`, `pwa-theme`, `caros-theme-studio` | retain |
| vehicle-memory-store | memory | ACCOUNT_VEHICLE | PRIVATE | custom verifier | managed/purge |
| notification-memory-store | memory | ACCOUNT_VEHICLE | PRIVATE | custom verifier | managed/purge |
| realtime-memory-context | memory | ACCOUNT | AUTHORITY | custom verifier | managed/purge |
| fleet-queue-memory-context | memory | ACCOUNT | AUTHORITY | custom verifier | managed/purge |
| command-memory-context | memory | ACCOUNT_VEHICLE | AUTHORITY | custom verifier | managed/purge |
| mavi-memory-context | memory | ACCOUNT_VEHICLE | PRIVATE | future custom adapter | managed/purge |

Mavi için persistent mobile storage bulunmadı. Memory descriptor bir
tamamlanmış Mavi entegrasyonu iddiası değil; gelecek adapter'ın registry dışında
kalmasını engelleyen fail-closed kayıt noktasıdır.

## 5. Legacy key haritası

| Legacy key | Dosya kanıtı | Veri | Mevcut scope | Hedef scope | Risk | Hedef | Karar |
|---|---|---|---|---|---|---|---|
| `caros_pair_api_key` | `pairingService.ts:4,36,46,72`; `vehicleStore.ts:37-74` | Remote API key | Global origin | ACCOUNT_VEHICLE/secure authority | P0 SECRET, XSS/account switch | secure native/server session | `MIGRATE_TO_NAMESPACED` + browser'dan kaldır |
| `caros_critical_pin_hash` | `criticalAuth.ts:4-14` | PIN hash | Global origin | ACCOUNT authority | Cross-account/reuse | critical-pin-hash | `PURGE_ON_NEXT_LOGOUT` |
| `caros_pair_vehicle_id` | `pairingService.ts:3,35,45`; `vehicleStore.ts:73` | Selected/paired vehicle | Global origin | ACCOUNT_VEHICLE | Owner bilinmiyor | paired-vehicle-authority | `MIGRATE_TO_NAMESPACED` |
| `caros_pair_vehicle_name/plate` | `pairingService.ts:5-6,37-38,51-52` | Vehicle metadata | Global origin | ACCOUNT_VEHICLE | Privacy/stale state | paired-vehicle-authority | `MIGRATE_TO_NAMESPACED` |
| `caros.fleet.queue.<user>` | `offline/storage.ts:40-68` | Offline mutations | User suffix | ACCOUNT | Raw ID, fail-soft I/O | fleet-offline-queue | `MIGRATE_TO_NAMESPACED` |
| `caros.fleet.queue.corrupt.<user>` | `offline/storage.ts:77` | Corrupt queue quarantine | User suffix | ACCOUNT | Private payload retention | fleet-offline-queue | `PURGE_ON_NEXT_LOGOUT` |
| `caros.fleet.snapshot.<user>` | `ownershipSnapshot.ts:112-159` | Ownership/roles | User suffix | ACCOUNT | Offline authority | ownership-snapshot | `MIGRATE_TO_NAMESPACED` |
| `caros.fleet.pairing.<user>` | `offlinePairing.ts:136-170` | Pending pairing | User suffix | ACCOUNT/ephemeral | Encrypted code, no canonical TTL key | pending-pairing | `MIGRATE_TO_NAMESPACED` |
| `caros_fuel_log` | `RecordsPanel.tsx:18-28` | Fuel history | Global origin | ACCOUNT_VEHICLE | Cross-account private data | fuel-log | `MIGRATE_TO_NAMESPACED` |
| `caros_service_log` | `RecordsPanel.tsx:39-67` | Maintenance | Global origin | ACCOUNT_VEHICLE | Cross-account private data | maintenance-log | `MIGRATE_TO_NAMESPACED` |
| `caros_parking_spot` | `VehicleMapView.tsx:15-29` | Exact location | Global origin | ACCOUNT_VEHICLE | Privacy high | parking-location | `MIGRATE_TO_NAMESPACED` |
| `clp_push_sub` | `pushEngine.ts:26,78,88` | Push subscription | Global origin | ACCOUNT | Old account delivery | push-subscription | `MIGRATE_TO_NAMESPACED` |
| `caros_speed_alert` | `MobileCarControl.tsx:596-617` | Vehicle alert | Global origin | ACCOUNT_VEHICLE | Wrong vehicle config | speed-alert | `MIGRATE_TO_NAMESPACED` |
| `caros-theme` | `ThemeToggle.tsx:31`; `app/layout.tsx:23` | Theme | Device | GLOBAL_DEVICE | Low | device-theme | `KEEP_AS_GLOBAL` |
| `pwa-theme` | `(pwa)/kumanda/page.tsx:32-39` | PWA theme | Device | GLOBAL_DEVICE | Duplicate preference | device-theme | `KEEP_AS_GLOBAL`/later merge |
| `caros-theme-studio` | `ThemeStudio.tsx:64-73` | Theme tokens | Device | GLOBAL_DEVICE | Custom content integrity | device-theme | `KEEP_AS_GLOBAL` |

## 6. Canonical namespace contract

```text
caros:<environment>:<accountHash>:<domain>:v<schemaVersion>
caros:<environment>:<accountHash>:<vehicleId>:<domain>:v<schemaVersion>
caros:<environment>:anonymous:<installationId>:<domain>:v<schemaVersion>
```

- `accountHash`, raw email veya raw account ID değildir; deterministic opaque
  SHA-256/base64url benzeri segment olmalıdır.
- Environment yalnız `production`, `development`, `test`.
- Domain allowlist karakterleri `[a-z][a-z0-9-]`.
- Empty/whitespace/`null`/`undefined`/`anonymous` authenticated owner olarak
  reddedilir.
- Vehicle ID normalize edilmiş opaque segment olmalıdır.
- Schema version positive ve zorunludur.
- Parse edilemeyen, environment/future-schema mismatch namespace fail-closed.

Hash üretimi registry'nin görevi değildir. Hash collision/version algoritması
PWA-P1-005 migration contract'ında sabitlenmelidir.

## 7. Known-storage scanner

`scanKnownClientStorage`:

- En fazla 256 key enumerates.
- Yalnız registry key/pattern'leri, `caros*`, `clp_*`, `pwa-*` ve bilinen
  security legacy key'leriyle sınırlıdır.
- Payload raporlamaz; yalnız key, backend, descriptor ID ve failure code taşır.
- JSON parse hatasını corrupted olarak raporlar.
- Storage enumeration/read hatasını typed unavailable olarak raporlar.
- Legacy account suffix ile active account uyuşmazlığını bildirir.
- `caros_pair_api_key` bulunduğunda `UNREGISTERED_KNOWN_KEY` üretir.

Scanner bütün origin storage'ını security scanner gibi taramaz; bu bilinçli
bounded sınırdır.

## 8. Verify-empty ve coordinator entegrasyonu

`AccountScopedStorageVerificationParticipant`, `VERIFY_EMPTY` fazındadır.

Başarı için:

- Registry valid ve boş olmayan bir descriptor seti olmalı.
- Bütün cleanup-scope `CUSTOM` descriptor'ların verifier'ı kayıtlı olmalı.
- Account/private/authority persistent key kalmamalı.
- Kayıt dışı bilinen veya suspicious CAROS key olmamalı.
- Corrupt değer ve namespace mismatch olmamalı.
- Storage erişilebilir olmalı.

`GLOBAL_DEVICE` allowlist ve cleanup ledger kendi başına failure değildir.
Canonical production composition oluşturulmadı: gerçek memory verifier ve purge
participant'ları olmadan participant production logout'a bağlanırsa fail eder.
Bu istenen fail-closed davranıştır.

## 9. Account mismatch kuralları

- Active B iken canonical/legacy A namespace: `NAMESPACE_MISMATCH`.
- Owner taşımayan legacy selected vehicle/fuel/location: cleanup sırasında
  non-empty private kayıt; owner tahmini yapılmaz.
- `userId:null` veya owner-less private canonical namespace: parser/build
  reddeder.
- Queue/snapshot/pairing suffix active account ile uyuşmazsa fail.
- Environment veya schema mismatch güvenli kabul edilmez.
- Selected vehicle ↔ server ownership doğrulaması bu görevde yapılmaz; PWA-P1-005
  participant ve sonraki boot gate kapsamıdır.

## 10. Service worker ve future storage kararı

Mevcut `public/sw.js` cache API kullanmıyor ve kaynakta “no caches; stateless”
contract'ı var. Bu nedenle CACHE_STORAGE/SERVICE_WORKER production descriptor
oluşturulmadı. Bu kalıcı varsayım değildir: gelecekte `caches.open`, Workbox,
IndexedDB veya native secure storage ekleyen görev registry descriptor ve
verifier eklemeden tamamlanamaz.

## 11. Mevcut boşluklar ve planned migrations

1. Vehicle API key browser localStorage'dan kaldırılmadı.
2. Legacy owner-less key'ler canonical namespace'e taşınmadı.
3. Memory custom verifier/reset adapter'ları bağlı değil.
4. Supabase session browser SDK storage detayları bu registry tarafından
   yönetilmiyor; provider contract doğrulaması gerekir.
5. Browser backup/restore, quota ve private-mode gerçek cihaz davranışı yok.
6. Ownership snapshot içeriği scanner tarafından owner-match parse edilmez;
   yalnız key namespace bütünlüğü ve JSON integrity kontrol edilir.
7. Anonymous installation ID authority ve TTL marker implementasyonu yok.
8. Cache/IndexedDB yokluğu yalnız mevcut repository source kanıtıdır.

## 12. Sonraki görev

`PWA-TEST-001 — commandService Vitest hoisting repair`

Sonraki security implementation görevi
`PWA-P1-005 — Vehicle credential and local authority cleanup participants`
olacaktır. Vehicle API key command authorization tarafından okunduğu ve
`commandService.test.ts` import aşamasında 0 test çalıştırdığı için önce küçük,
davranış değiştirmeyen test altyapısı gate'i onarılmalıdır.

Migration uygulanmadı. Gerçek veri silinmedi. Logout wiring yapılmadı.
Commit/push/deploy/APK/AAB işlemi yapılmadı.

## 13. Test kanıtı

- `accountStorageRegistry.test.ts`: 31/31 geçti.
- Registry + PWA-P1-003 cleanup foundation: 2 dosya, 60/60 geçti.
- TypeScript `npx tsc --noEmit`: geçti.
- İlgili geniş regresyon: 274 test geçti; görev kapsamı dışındaki
  `fleetMembershipFoundation.test.ts` içinde mevcut migration 035 metniyle
  uyuşmayan 4 statik beklenti başarısız oldu. Migration/test değiştirilmedi.
- `commandService.test.ts`: hoisted `vi.mock`/`mockSupabase` initialization
  hatasıyla import aşamasında kaldı, 0 test çalıştı.

## 14. PWA-P1-005 participant binding update

`critical-pin-hash`, `paired-vehicle-authority` ve
`vehicle-memory-store` descriptor'ları artık gerçek clear/verify
participant'larına sahiptir. Command memory context, runtime handle registry ile
cleanup sırasında clear/verify edilir.

`caros_pair_api_key` bilinçli olarak production descriptor'a dönüştürülmedi:
persistent browser SECRET onaylanamaz. `VehicleCredentialCleanupParticipant`
exact key'i temizler; known-storage scanner key kalırsa
`UNREGISTERED_KNOWN_KEY` üretmeye devam eder. Hedef karar hâlâ browser
storage'dan `REMOVE`/secure authority migration'dır.

Factory: `website/src/security/accountCleanup/createAccountCleanupRuntime.ts`.
Storage erişimi module import veya factory construction sırasında yapılmaz;
participant çalıştığında lazy adapter üzerinden çözülür.

PWA-P1-005 doğrulaması:

- Yeni participant testleri 35/35 geçti.
- İlgili regresyon grubu 287/287 geçti.
- Tüm website suite 433/433 geçti.
- TypeScript geçti.

Legacy key migration ve gerçek logout wiring yapılmadı.
