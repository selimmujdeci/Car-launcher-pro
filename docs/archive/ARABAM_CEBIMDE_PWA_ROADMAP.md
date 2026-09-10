# Arabam Cebimde PWA — Canonical Roadmap ve İlerleme Kaydı

> Bu dosya Arabam Cebimde PWA geliştirmeleri için tek canonical roadmap ve
> ilerleme otoritesidir. Aynı plan başka bir dosyada paralel tutulmaz. Her
> atomik geliştirme görevi, kod ile birlikte bu dosyayı da güncellemeden
> tamamlanmış sayılmaz.

## Durum başlığı

| Alan | Değer |
|---|---|
| Son güncelleme tarihi | 2026-07-30 |
| Güncelleyen görev veya ajan | Codex — PWA-P1-008 auth storage authority closure |
| Aktif branch | `feat/fleet-offline-final-local-completion` |
| HEAD commit | `f89540c3b332cf0bfea897d8d22a1c2103f26889` |
| Aktif geliştirme paketi | PAKET P1 — Auth, Pairing, Ownership, Security ve Account Isolation |
| Aktif atomik görev | `PWA-P1-008 — Auth Storage Authority Closure` (`TESTED_LOCAL`) |
| Son tamamlanan görev | `PWA-P1-007 — Offline queue, ownership snapshot and pending pairing cleanup participants` |
| Sıradaki önerilen görev | PWA-P1-008 gerçek staging Supabase, iki sekmeli browser yarışı ve process-death doğrulaması; PWA-P1-009'a geçilmedi |
| Genel ilerleme yüzdesi | `%0` — tamamlanmış kabul kriteri kanıtı yok |
| Production readiness durumu | `NOT_READY` |
| Güvenlik kapısı durumu | `PRODUCTION_SECURITY_GATE: BLOCKED` |
| Gerçek cihaz doğrulama durumu | `NOT_STARTED` |
| Gerçek araç doğrulama durumu | `NOT_STARTED` |
| Bilinen engeller | Supabase target-bound revoke ve canonical logout wiring host testli fakat gerçek staging/iki sekme/process-death üzerinde doğrulanmadı; access-token JWT süre sonuna kadar geçerli kalabilir; PWA-P1-007 ownership/pending-pairing late-write ve cross-account purge bulguları açık; vehicle API key üretim/command yolu hâlâ localStorage kullanıyor; push/PhoneHub/Mavi cleanup eksik; paralel pairing otoriteleri; command TOCTOU ve EXECUTED/VERIFIED ayrımı açık |
| Deploy durumu | Yapılmadı |

Detaylı credential authority eki:
[`security/ARABAM_CEBIMDE_CREDENTIAL_AUTHORITY_INVENTORY.md`](security/ARABAM_CEBIMDE_CREDENTIAL_AUTHORITY_INVENTORY.md).

Logout/account-switch cleanup sözleşmesi:
[`security/ARABAM_CEBIMDE_LOGOUT_CLEANUP_CONTRACT.md`](security/ARABAM_CEBIMDE_LOGOUT_CLEANUP_CONTRACT.md).

Account-scoped storage registry eki:
[`security/ARABAM_CEBIMDE_ACCOUNT_STORAGE_REGISTRY.md`](security/ARABAM_CEBIMDE_ACCOUNT_STORAGE_REGISTRY.md).

## Belge kullanım kuralları

1. Bu dosya her Arabam Cebimde PWA atomik görevinde zorunlu olarak güncellenir.
2. Görev durumu yalnız repository, test, staging, cihaz ve araç kanıtının
   gerçekten desteklediği seviyeye yükseltilir.
3. Kod yazılmış fakat test edilmemişse `IMPLEMENTED_NOT_TESTED` kullanılır.
4. Unit test gerçek cihaz veya gerçek araç doğrulamasının yerine geçmez.
5. Roadmap güncellemesi ilgili kod değişikliğiyle aynı commit içinde yer alır.
6. Commit, migration veya deploy yapılmadıysa açıkça yazılır.
7. Mevcut audit bulguları çözülmeden kapalı gösterilmez.
8. Genel yüzde tahmin değildir; yalnız tamamlanan kabul kriterlerinden hesaplanır.

## Değişmez mimari prensipler

1. **Offline-First**
2. **Fail-Closed Truth**
3. **Zero-Trust Telemetry**
4. **Security and Privacy by Default**
5. **Evidence-First AI**
6. **Tek Otorite / Single Source of Truth**
7. **Capability-Aware UI**
8. **Backward Compatibility**
9. **Bounded Queue and Bounded Retry**
10. Gerçek araç kanıtı olmadan “doğrulandı” denmez.
11. Demo ve production yolları fiziksel olarak ayrılır.
12. `localStorage` içinde güvenlik credential'ı tutulmaz.
13. AI tahminleri kesin arıza olarak gösterilmez.
14. Her state `source`, `freshness`, `confidence` ve `verificationLevel` taşır.
15. Deploy, migration, push, APK/AAB veya production işlemi kullanıcı açıkça
    istemedikçe yapılmaz.

## Görev durum sözlüğü

- `NOT_STARTED`
- `ANALYZING`
- `BLOCKED`
- `IMPLEMENTING`
- `IMPLEMENTED_NOT_TESTED`
- `TESTED_LOCAL`
- `VALIDATED_STAGING`
- `VALIDATED_REAL_DEVICE`
- `VALIDATED_REAL_VEHICLE`
- `COMPLETED`
- `DEFERRED`

`COMPLETED`, görevin bütün zorunlu kabul kriterleri ile gereken staging, gerçek
cihaz ve gerçek araç doğrulamaları sağlandığında kullanılabilir.

## Ağırlık ve ilerleme hesabı

| Paket | Ağırlık | Tamamlanan kabul kriteri | Paket ilerlemesi | Genel katkı |
|---|---:|---:|---:|---:|
| P0 Truth Kernel | %15 | 0 | %0 | %0 |
| P1 Security/Ownership | %15 | 0 | %0 | %0 |
| P2 Commands/Verification | %15 | 0 | %0 | %0 |
| P3 Offline/PWA Platform | %10 | 0 | %0 | %0 |
| P4 Vehicle Memory/Digital Twin | %10 | 0 | %0 | %0 |
| P5 Diagnostics | %10 | 0 | %0 | %0 |
| P6 Trips/Cost/Maintenance | %7 | 0 | %0 | %0 |
| P7 OBD Power | %5 | 0 | %0 | %0 |
| P8 Mavi | %5 | 0 | %0 | %0 |
| P9 UX/Aile/Filo | %4 | 0 | %0 | %0 |
| P10 Test/Validation | %4 | 0 | %0 | %0 |
| **Toplam** | **%100** |  |  | **%0** |

Hesap:

```text
paket ilerlemesi =
  tamamlanmış zorunlu kabul kriteri / toplam zorunlu kabul kriteri

genel ilerleme =
  Σ(paket ağırlığı × paket ilerlemesi)
```

`IMPLEMENTED_NOT_TESTED` durumundaki kabul kriterleri tamamlanmış sayılmaz.

## Repository sınırları ve mevcut ürün gerçeği

- `website/`, Arabam Cebimde PWA ve authenticated web dashboard yüzeyidir.
- `src/` ile `android/app/`, ağırlıklı olarak CAROS PRO head-unit ürünüdür.
- `android/phonehub-companion/`, ayrı saf Android telefon companion foundation'ıdır;
  PWA'nın native wrapper'ı veya tamamlanmış Arabam Cebimde uygulaması değildir.
- `android/phonehub-protocol/`, head-unit ve telefon için paylaşılan bağlantı
  protokolü foundation'ıdır.
- Head-unit tarafındaki Mavi, Deep Scan, AI Core ve CAROS LAB bileşenlerinin
  bulunması, bunların PWA'da kullanılabilir olduğunu kanıtlamaz.
- `supabase/migrations/20260729000033...36` dosyaları çalışma ağacında vardır;
  uygulanmış canlı şema kanıtı yoktur.
- Roadmap oluşturulurken çalışma ağacı zaten yoğun biçimde modified/untracked
  durumdaydı. Mevcut değişiklikler otomatik olarak tamamlanmış kabul edilmez.

## Audit başlangıç özeti

### Doğrulanmış P0 engeller

| ID | Engel | Kanıt | Durum |
|---|---|---|---|
| SEC-01 | Remote-control API key localStorage'da | `website/src/lib/pairingService.ts`, `website/src/store/vehicleStore.ts` | `BLOCKED` |
| SEC-02 | PWA eski oturumsuz pairing yolunu kullanıyor | `website/src/app/api/pwa/pair/route.ts` → `pair_vehicle` | `BLOCKED` |
| SEC-03 | Authenticated pairing ayrı authority kullanıyor | `website/src/app/api/vehicle/link/route.ts` → `pair_vehicle_to_user` | `BLOCKED` |
| SEC-04 | Logout yerel credential/cache/queue cleanup yapmıyor | `Topbar.tsx`, `Sidebar.tsx`, `/api/auth/logout` | `BLOCKED` |
| CMD-01 | `completed`, fiziksel doğrulama olmadan başarı diline dönüşüyor | `RemoteCommandPanel.tsx`, `useCommandTracker.ts` | `BLOCKED` |
| CMD-02 | Kritik API-key komutunda PIN hash varlığı doğrulama sayılabiliyor | `/api/pwa/command/route.ts` | `BLOCKED` |
| TENANT-01 | Yeni RLS/RPC migration'larının uygulanmışlığı bilinmiyor | migration 033–036 untracked | `BLOCKED` |
| PUSH-01 | Notification deep-link same-origin allowlist'i yok | `website/public/sw.js` | `BLOCKED` |
| DEMO-01 | Demo ve production fallback'ları aynı çalışma yollarında | realtime, pairing, DTC, geofence command rotaları | `BLOCKED` |

### Mevcut çalışan veya korunacak foundation'lar

- Supabase Auth cookie/session foundation'ı.
- Yeni `pair_vehicle_to_user` RPC tasarımı ve server-side ownership çözümü.
- RPC'lerde `auth.uid()` ile admin/observer rol kontrolleri.
- Account namespace'li offline fleet queue.
- Queue için 500 kayıt sınırı, dedupe, TTL, bounded retry ve conflict durumları.
- Offline pairing'in doğrulanmadan “eşleşti” dememesi.
- Supabase telemetry/location realtime channel lifecycle foundation'ı.
- Command tablosunda nonce, TTL ve ara durumlar.
- PWA route-level lazy loading.
- Web Push ve service worker notification foundation'ı.
- PhoneHub shared protocol ve Android Keystore identity foundation'ı.
- Head-unit CAROS LAB ve evidence yaklaşımı.

### Audit sınırlamaları

- Bu bootstrap çalışmasında test çalıştırılmadı.
- Migration uygulanmadı ve canlı RLS/grant çıktıları alınmadı.
- Gerçek telefon, head-unit, ECU veya araç doğrulaması yapılmadı.
- Mevcut untracked testlerin yeşil olduğu varsayılmadı.
- Production environment'ta demo modunun açık olup olmadığı bilinmiyor.

---

# PAKET P0 — Truth Kernel

**Amaç:** Bütün araç gerçeklerini tek, kanıtlanabilir ve fail-closed modelden
üretmek.

## Canonical Signal Envelope

```ts
type SignalEnvelope<T> = {
  value: T | null;
  source: string;
  observedAt: number | null;
  receivedAt: number | null;
  freshness: "fresh" | "aging" | "stale" | "expired" | "unknown";
  confidence: number;
  verificationLevel:
    | "reported"
    | "transported"
    | "acknowledged"
    | "executed"
    | "independently_verified";
  failureCode?: string;
  rawEvidenceRef?: string;
  derivedBy?: string;
};
```

## Paket kapsamı

Canonical Vehicle Identity; `SelectedVehicleRepository`;
`VehicleConnectivityTruthService`; signal envelope; source/provenance;
telemetry ve GPS freshness; ignition known/on/off/unknown; backend, telefon,
head-unit, transport ve session connectivity; cached/last-known projection;
canonical failure codes; evidence references.

## Paket kabul kapıları

- [ ] `online | offline | alarm` canonical gerçek olmaktan çıkarıldı.
- [ ] Backend/channel bağlantısı araç online gerçeğinden ayrıldı.
- [ ] Cached veri canlı gösterilmiyor.
- [ ] Unknown state false/offline'a zorlanmıyor.
- [ ] Bütün ekranlar aynı selected-vehicle authority'sini kullanıyor.
- [ ] Aynı fiziksel araç tek canonical ID'ye çözülüyor.

## Atomik görevler

| Kimlik | Başlık | Durum | Mevcut kanıt/not |
|---|---|---|---|
| PWA-P0-001 | Canonical Signal Envelope contract | `NOT_STARTED` | Mevcut `VehicleStatus` yalnız online/offline/alarm |
| PWA-P0-002 | VehicleConnectivityTruthService | `NOT_STARTED` | Online, son telemetry zamanına indirgenmiş |
| PWA-P0-003 | SelectedVehicleRepository | `NOT_STARTED` | PWA ilk online aracı, dashboard local state'i seçiyor |
| PWA-P0-004 | Canonical Vehicle Identity resolver | `NOT_STARTED` | PWA/Supabase/PhoneHub kimlikleri birleşik değil |
| PWA-P0-005 | Last-known projection ve failure codes | `NOT_STARTED` | Cache var, freshness/truth ayrımı yok |

---

# PAKET P1 — Auth, Pairing, Ownership, Security ve Account Isolation

**Amaç:** Araç erişimini authenticated kullanıcı, server ownership ve güvenli
cihaz kimliğine bağlamak.

## Paket kapsamı

Tek authenticated pairing authority; `pair_vehicle_to_user`; Supabase
Auth/RPC/RLS; code TTL/entropy/rate-limit; brute-force/replay koruması; device
binding; credential rotation/revocation; secure storage; atomik logout/account
switch cleanup; lost-phone revocation; company/role/cross-tenant enforcement;
observer read-only; multi-vehicle ownership; audit.

## Atomik logout cleanup contract

Logout sırasında aşağıdakilerin tamamı account-scoped ve fail-closed biçimde
temizlenmelidir:

- Vehicle credential
- Selected vehicle
- Vehicle, telemetry ve location cache
- Maintenance ve fuel cache
- Offline queue ve fleet snapshot
- Pending pairing
- Notification state
- Mavi conversation vehicle context
- Account-scoped encryption keys

## Paket kabul kapıları

- [ ] İki hesap arasında araç, konum, credential, queue veya cache sızıntısı yok.
- [ ] Remote-control credential localStorage'da değil.
- [ ] Ownership yalnız server RLS/RPC ile değişebiliyor.
- [ ] Logout yarım kalırsa fail-closed.
- [ ] Eski kullanıcı aracı yeni oturumda görünmüyor.
- [ ] Pairing replay, entropy, brute-force ve rate-limit testleri geçiyor.
- [ ] Cross-tenant ve observer staging testleri geçiyor.

## Atomik görevler

| Kimlik | Başlık | Durum | Mevcut kanıt/not |
|---|---|---|---|
| PWA-P1-001 | Credential ve pairing authority envanteri | `COMPLETED` | Authority/credential yaşam döngüsü, güvenlik bulguları ve migration öncesi sözleşme canonical ekte tamamlandı |
| PWA-P1-002 | Logout/account-switch cleanup contract | `COMPLETED` | Coordinator authority, ordering, namespace, boot gate, recovery ledger ve test matrisi canonical ekte tamamlandı; implementasyon yok |
| PWA-P1-003 | AccountCleanupCoordinator foundation | `COMPLETED` | State machine, durable metadata ledger, participant registry, senkron lockdown/generation ve foundation boot gate 29 unit test ve TypeScript kontrolüyle doğrulandı; runtime wiring ve gerçek purge yok |
| PWA-P1-004 | Account-scoped storage registry | `COMPLETED` | 18 descriptor, canonical namespace, bounded scanner ve VERIFY_EMPTY participant foundation'ı 31 yeni testle doğrulandı; purge/migration yok |
| PWA-P1-005 | Vehicle credential and local authority cleanup participant'ları | `COMPLETED` | API key/PIN/vehicle identity exact-key purge, real vehicle/command memory clear, verification ve lazy composition 35 yeni testle doğrulandı; logout wiring yok |
| PWA-P1-006 | Cleanup runtime lockdown wiring | `COMPLETED` | Lazy singleton ve fail-closed wiring; repository TypeScript geçti, dar realtime/cleanup 86/86 ve tam website suite 534/534 geçti; gerçek cihaz/process-death doğrulaması yapılmadı |
| PWA-P1-007 | Offline queue, ownership snapshot ve pending pairing cleanup participant'ları | `COMPLETED` | Üç deterministic participant + aggregate VERIFY_EMPTY production composition'a bağlı; dar 208/208, TypeScript PASS, tam suite 572/572; cihaz/process-death doğrulaması açık |
| PWA-P1-008 | Server Session Revoke Participants | `TESTED_LOCAL` | Singleton local `signOut` kaldırıldı; A cookie chunk-hash ownership snapshot’ına bağlı local purge ve canonical account-transition authority eklendi. Server-session 29/29, auth writer/server gate 8/8, logout/route 10/10, TypeScript ve ortak suite 704/704 geçti; gerçek staging/iki sekme/process-death doğrulanmadı |
| PWA-P1-009 | Push, PhoneHub and Mavi Cleanup Participants | `NOT_STARTED` | Provider/native binding ve account-scope revoke sözleşmeleri gerekli |
| PWA-P1-010 | Account-switch boot gate entegrasyonu | `BLOCKED` | Namespace registry ve tamamlanmış local cleanup composition gerekli |
| PWA-P1-011 | Tek authenticated pairing authority tasarımı | `BLOCKED` | Migration/staging authority kararı gerekiyor |
| PWA-P1-012 | Secure credential persistence ve device binding | `BLOCKED` | PWA/native ürün sınırı kararı gerekiyor |
| PWA-P1-013 | Pairing abuse protection | `NOT_STARTED` | Entropy/rate-limit/brute-force kanıtı yok |
| PWA-P1-014 | Cross-tenant/observer RLS validation | `BLOCKED` | Migration uygulanmış staging ortamı gerekli |
| PWA-P1-015 | Credential rotation, revocation ve lost-phone flow | `NOT_STARTED` | Canonical device/session ledger yok |

> PWA-P1-003 sonrası cleanup participant bağımlılıkları atomik hâle getirildi.
> Daha önceki eklerde geçen başlanmamış P1 kimlik önerileri bu tablo tarafından
> supersede edilir; güvenlik bulguları ve kapanış kapıları değişmez.

---

# PAKET P2 — Remote Commands, Capability Registry ve Verification

**Amaç:** Komutları destek kontrollü, idempotent, güvenli ve doğrulanabilir
çalıştırmak.

## Canonical komut durum makinesi

```text
QUEUED → SENT → ACKNOWLEDGED → EXECUTING → EXECUTED → VERIFIED

FAILED | REJECTED | UNSUPPORTED | EXPIRED | OFFLINE | UNKNOWN
```

`completed`, doğrudan EXECUTED veya VERIFIED sayılmaz. `VERIFIED` yalnız
bağımsız state readback veya fiziksel sonuç kanıtıyla üretilebilir.

## Hedef capability-aware komutlar

Kilit, kilit açma, korna, far, dörtlü, alarm, bagaj, camlar, sunroof, klima,
klima sıcaklığı, motor start/stop, koltuk/direksiyon ısıtma, rota, DTC
oku/temizle, voltaj, hız alarmı, geofence, servis modu, OBD güç modu, head-unit
reboot ve Deep Scan. Bir komut yalnız araç destekliyorsa UI'da sunulur.

## Paket kabul kapıları

- [ ] ACKNOWLEDGED, EXECUTED ve VERIFIED ayrı gösteriliyor.
- [ ] Yalnız VERIFIED sonucu “araç tarafından doğrulandı” deniyor.
- [ ] Stabil idempotency key duplicate tap/retry boyunca korunuyor.
- [ ] Offline, expired, rejected ve unsupported ayrılıyor.
- [ ] Kritik işlemlerde server-side re-auth/challenge var.
- [ ] `clear_dtc` kritik ve ignition-aware güvenlik gate'inden geçiyor.
- [ ] Immutable command ledger var.
- [ ] Kilit/kilit aç/kornanın gerçek araç doğrulama matrisi var.

## Atomik görevler

| Kimlik | Başlık | Durum | Mevcut kanıt/not |
|---|---|---|---|
| PWA-P2-001 | Command state contract ve UI truth dili | `NOT_STARTED` | `completed` başarı diline çevriliyor |
| PWA-P2-002 | Capability registry contract | `NOT_STARTED` | Araç destek kontrolü yok |
| PWA-P2-003 | Stable idempotency ve immutable ledger | `NOT_STARTED` | Nonce var; retry-stabil key/audit yok |
| PWA-P2-004 | Kritik komut re-auth/challenge | `BLOCKED` | PIN hash varlığı verification değil |
| PWA-P2-005 | Physical readback verifier | `BLOCKED` | Head-unit/araç protokol sözleşmesi gerekli |
| PWA-P2-006 | DTC clear safety gate | `NOT_STARTED` | Mevcut kritik komut listesinde değil |

---

# PAKET P3 — Realtime, Offline-First ve PWA Platformu

**Amaç:** Ağ kesintisi, process death ve update sırasında kontrollü çalışma.

## Paket kapsamı

Versioned app shell; offline startup; last-known state; freshness labels;
account-scoped queue; dedupe/TTL/backoff/conflict; process-death recovery;
service-worker safe update/rollback; background sync; offline mutation policy;
pending pairing; offline history/location; network quality; push lifecycle;
multi-device dedupe; notification history; safe same-origin deep links; quiet
hours; expired suppression.

## Paket kabul kapıları

- [ ] Uçak modunda app shell açılıyor.
- [ ] Cache canlı veri gibi gösterilmiyor.
- [ ] Bozuk SW update rollback edilebiliyor.
- [ ] Queue en fazla 500 kayıt ve restart sonrası devam ediyor.
- [ ] Account namespace korunuyor.
- [ ] Malicious notification URL açılamıyor.
- [ ] Offline komut başarı değil “bekliyor” olarak kalıyor.

## Atomik görevler

| Kimlik | Başlık | Durum | Mevcut kanıt/not |
|---|---|---|---|
| PWA-P3-001 | Versioned app-shell cache | `NOT_STARTED` | SW açıkça cache tutmuyor |
| PWA-P3-002 | Account-scoped general domain queue | `NOT_STARTED` | Fleet queue foundation'ı var |
| PWA-P3-003 | Safe SW update ve rollback | `NOT_STARTED` | `skipWaiting` doğrudan kullanılıyor |
| PWA-P3-004 | Notification URL allowlist | `NOT_STARTED` | Payload URL doğrudan açılıyor |
| PWA-P3-005 | Push token lifecycle ve dedupe ledger | `NOT_STARTED` | Push foundation var, lifecycle eksik |
| PWA-P3-006 | Offline history/location projections | `NOT_STARTED` | Parçalı localStorage verisi var |

---

# PAKET P4 — Vehicle Memory, Timeline ve Digital Twin

**Amaç:** Araç verisini canonical geçmiş ve tek dijital araç kimliğinde
birleştirmek.

## Canonical event minimum şeması

- `eventId`
- `vehicleId`
- `accountId`
- `companyId`
- `eventType`
- `schemaVersion`
- `source`
- `occurredAt`
- `ingestedAt`
- `confidence`
- `freshness`
- `verificationLevel`
- `payload`
- `evidenceRefs`
- `integrityHash`
- `supersedesEventId`
- `privacyClass`

## Paket kapsamı

Vehicle Event Store ve Timeline; telemetry, command, DTC, freeze-frame,
location, trip, fuel, maintenance, repair, ownership, device/ECU events;
attachments; integrity/version/supersession; Digital Twin registry; VIN; ECU
topology; supported PIDs; firmware; fingerprint; learned sleep profile;
component confidence; Vehicle Passport foundation.

## Paket kabul kapıları

- [ ] Yakıt/bakım yalnız localStorage'da değil.
- [ ] Kullanıcı girdisi, cihaz kanıtı ve AI tahmini ayrılıyor.
- [ ] Event ingest idempotent.
- [ ] PWA/Supabase/head-unit/PhoneHub tek vehicle identity'ye çözülüyor.
- [ ] Timeline offline görüntülenebiliyor.
- [ ] Event değişiklikleri audit ediliyor.

## Atomik görevler

| Kimlik | Başlık | Durum | Mevcut kanıt/not |
|---|---|---|---|
| PWA-P4-001 | Canonical vehicle event contract | `NOT_STARTED` | Veriler ayrı tablo ve ekranlarda |
| PWA-P4-002 | Idempotent event ingest/store | `NOT_STARTED` | Canonical store yok |
| PWA-P4-003 | Timeline projection/offline cache | `NOT_STARTED` | Timeline yok |
| PWA-P4-004 | Digital Twin identity registry | `NOT_STARTED` | VIN/ECU authority yok |
| PWA-P4-005 | Vehicle Passport foundation | `BLOCKED` | Identity/event/audit bağımlılıkları eksik |

---

# PAKET P5 — Diagnostics ve Araç Sağlığı

**Amaç:** DTC ekranını evidence-aware sağlık merkezine dönüştürmek.

## Paket kapsamı

DTC oku/temizle/geçmiş; freeze frame; ECU list/topology; Deep Scan; voltaj,
motor sıcaklığı, DPF, turbo, şanzıman, soğutma, ABS/ESP; health/reliability;
Risk Radar; hidden fault; root-cause candidates; component life/forecast;
Repair Memory; mechanic-ready PDF; sharing ve evidence redaction.

## Paket kabul kapıları

- [ ] Demo/mock diagnostic production build path'ından ayrıldı.
- [ ] Her sonuç source/confidence/observedAt/evidenceRefs taşıyor.
- [ ] Stale sağlık verisi açıkça işaretleniyor.
- [ ] PDF ham veri/yorum/tahmini ayırıyor.
- [ ] DTC clear ignition ve security gate'inden geçiyor.
- [ ] Gerçek ECU/araç testleri kaydediliyor.

## Atomik görevler

| Kimlik | Başlık | Durum | Mevcut kanıt/not |
|---|---|---|---|
| PWA-P5-001 | Diagnostic evidence envelope | `NOT_STARTED` | PWA DTC/voltaj var, provenance zayıf |
| PWA-P5-002 | Demo/production diagnostic separation | `BLOCKED` | Demo DTC/random voltage aktif path'te |
| PWA-P5-003 | DTC history/freeze-frame/ECU projection | `NOT_STARTED` | PWA'da yok |
| PWA-P5-004 | Deep Scan mobile contract | `BLOCKED` | Head-unit entegrasyonu yok |
| PWA-P5-005 | Health score ve risk evidence rules | `NOT_STARTED` | Mobilde yok |
| PWA-P5-006 | Mechanic-ready report/redaction | `NOT_STARTED` | Canonical event/evidence bağımlılığı var |

---

# PAKET P6 — Trips, Maps, Cost ve Maintenance

**Amaç:** Kullanım, rota, bakım ve maliyet geçmişini provenance ile yönetmek.

## Paket kapsamı

Trip segmentation/history/replay; last park; vehicle navigation; live ve
last-known location; geofence; shared ETA; fuel-to-trip; consumption; gerçek
ve tahmini maliyet; fuel-price provenance; toll/parking/insurance/tax/tire/
service; mileage/date maintenance; audit; Trip Cost AI foundation.

## Paket kabul kapıları

- [ ] Live ve last-known location ayrılıyor.
- [ ] Manuel maliyet ile otomatik ölçüm ayrılıyor.
- [ ] Konum granular permission ile paylaşılıyor.
- [ ] Export/redaction var.
- [ ] Trip Cost AI veri yoksa sonuç uydurmuyor.

## Atomik görevler

| Kimlik | Başlık | Durum | Mevcut kanıt/not |
|---|---|---|---|
| PWA-P6-001 | Canonical location truth contract | `NOT_STARTED` | Harita var, freshness ayrımı yok |
| PWA-P6-002 | Trip segmentation ve history | `NOT_STARTED` | PWA'da yok |
| PWA-P6-003 | Fuel/cost provenance model | `NOT_STARTED` | Kayıtlar localStorage'da |
| PWA-P6-004 | Maintenance schedule/audit | `NOT_STARTED` | Basit local servis kaydı var |
| PWA-P6-005 | Trip Cost AI uncertainty contract | `BLOCKED` | Trip/fuel/price verisi eksik |

---

# PAKET P7 — OBD Güç Yönetimi ve Araç Gözetimi

**Amaç:** OBD çalışma biçimini aküyü koruyarak capability-aware yönetmek.

## Modlar

1. Battery Protection — varsayılan
2. Smart Surveillance
3. Continuous Surveillance

## Paket kapsamı

Capability; verified current mode; mode command/readback; offline settings;
override audit; low-voltage cutoff; sleep learning; wake/sleep profile; battery
history; vehicle-specific recommendation; warnings; emergency override;
background budget.

## Paket kabul kapıları

- [ ] Mode readback olmadan verified değil.
- [ ] Continuous Surveillance açık uyarı/onay olmadan etkinleşmiyor.
- [ ] Düşük voltaj fail-safe Battery Protection'a dönüyor.
- [ ] Araç bazlı sleep learning var.
- [ ] Akü tüketimi belirsizlikle gösteriliyor.

## Atomik görevler

| Kimlik | Başlık | Durum | Mevcut kanıt/not |
|---|---|---|---|
| PWA-P7-001 | OBD power capability/mode contract | `NOT_STARTED` | PWA özelliği yok |
| PWA-P7-002 | Mode command ve readback | `BLOCKED` | Head-unit capability/verification eksik |
| PWA-P7-003 | Low-voltage fail-safe policy | `NOT_STARTED` | Voltaj okuma foundation'ı var |
| PWA-P7-004 | Vehicle sleep learning model | `NOT_STARTED` | Mobil canonical history yok |

---

# PAKET P8 — Mavi Mobil Asistan

**Amaç:** Head-unit Mavi altyapısını PWA'ya evidence-first ve güvenli biçimde
taşımak.

## Kurallar

- Capability registry ve Action Registry zorunludur.
- Kritik komut açık confirmation ister.
- Araç belirsizliğinde kullanıcıdan seçim istenir.
- Verification olmadan “yapıldı” denmez.
- Evidence olmadan kesin mekanik teşhis konmaz.
- Offline cevap yalnız yerel, doğrulanmış ve freshness bilgili veriye dayanır.
- Tahmin, kullanıcı girdisi ve cihaz kanıtı ayrılır.

## Paket kabul kapıları

- [ ] Kilitle akışı confirmation/capability/ledger/verification'dan geçiyor.
- [ ] Multi-vehicle ambiguity yanlış araca komut üretemiyor.
- [ ] Cevap evidenceRefs ile izlenebilir.
- [ ] Veri yetersizse “bilinmiyor” diyor.
- [ ] Entegrasyon öncesi tamamlanmış mobil özellik gibi sunulmuyor.

## Atomik görevler

| Kimlik | Başlık | Durum | Mevcut kanıt/not |
|---|---|---|---|
| PWA-P8-001 | Mavi mobile boundary ve context contract | `NOT_STARTED` | Website'da gerçek Mavi entegrasyonu yok |
| PWA-P8-002 | Evidence-aware read-only queries | `BLOCKED` | Truth/Event Store bağımlılığı |
| PWA-P8-003 | Multi-vehicle ambiguity gate | `NOT_STARTED` | SelectedVehicle authority bağımlılığı |
| PWA-P8-004 | Action Registry/confirmation wiring | `BLOCKED` | Command verification bağımlılığı |
| PWA-P8-005 | Offline Mavi fallback | `BLOCKED` | Offline evidence store bağımlılığı |

---

# PAKET P9 — Premium PWA UX, Aile ve Filo

**Amaç:** Teknik dashboard yerine kolay, erişilebilir ve capability-aware araç
kontrol merkezi oluşturmak.

## Hedef bilgi mimarisi

**Alt menü:** Ana Sayfa, Kumanda, Harita, Sağlık, Mavi.

**Ana ekran:** araç/plaka; doğrulanmış bağlantı; son görülme; kontak; yakıt;
menzil; akü; kilit; son doğrulanmış konum; son yolculuk; yaklaşan bakım;
bekleyen komut; en fazla üç “Bugün dikkat et” kartı.

**Detaylar:** Yolculuklar, Geçmiş, Masraflar, Bakım, Raporlar, Aile, Filo, OBD,
Güvenlik, Ayarlar.

## UX kuralları

- 8–10 px metin yok; dynamic type destekli.
- Minimum dokunma alanı 48×48.
- Durum yalnız renkle anlatılmaz.
- Screen-reader semantics vardır.
- Loading, empty, error, stale, degraded ve partial ayrıdır.
- Desteklenmeyen özellik gösterilmez.
- Teknik DTC dili açıklanır.
- Progressive disclosure kullanılır.
- Büyük filo clustering, virtualization ve listener bütçesi kullanır.

## Aile ve filo kapsamı

Araç paylaşımı, süreli yetki, konum izni, emergency access, multi-driver,
unknown driver, correction/consent; filo list/map/driver/risk/maintenance/fuel/
fault; observer/member/admin; cross-tenant; offline queue ve conflict UI.

## Paket kabul kapıları

- [ ] Hedef ana bilgi mimarisi truth modelini doğru gösteriyor.
- [ ] Accessibility ve dynamic-type testleri geçiyor.
- [ ] Capability-aware görünürlük var.
- [ ] Aile sharing izin/süre/audit ile çalışıyor.
- [ ] Filo rolleri server-side doğrulanıyor.
- [ ] Büyük filo performans bütçesi karşılanıyor.

## Atomik görevler

| Kimlik | Başlık | Durum | Mevcut kanıt/not |
|---|---|---|---|
| PWA-P9-001 | Ana ekran information architecture | `NOT_STARTED` | Mevcut ekran stale/truth ayrımını taşımıyor |
| PWA-P9-002 | Accessibility baseline | `NOT_STARTED` | 8–10px metin ve renk-ağırlıklı states var |
| PWA-P9-003 | Capability-aware navigation | `NOT_STARTED` | Feature gate plan/capability ayrımı net değil |
| PWA-P9-004 | Family sharing/consent model | `NOT_STARTED` | Yok |
| PWA-P9-005 | Fleet UX hardening | `IMPLEMENTED_NOT_TESTED` | Yeni UI/hooks/tests untracked; test çalıştırılmadı |
| PWA-P9-006 | Large-fleet performance | `NOT_STARTED` | Clustering/virtualization kanıtı yok |

---

# PAKET P10 — Test, CI, SLO ve Gerçek Araç Doğrulaması

**Amaç:** Build alan değil; test, staging, cihaz ve araç kapıları bulunan
production adayı üretmek.

## Zorunlu CI kapıları

Website unit/integration; Supabase/RLS staging; cross-tenant; logout isolation;
pairing security; command states; mock-production guard; SW offline;
accessibility; security; lint; typecheck; build; E2E; performance budgets.

## SLO hedefleri

- Cold start p95 ≤ 2.5 saniye
- Warm start p95 ≤ 1 saniye
- Dashboard usable p95 ≤ 3 saniye
- Vehicle switch p95 ≤ 500 ms
- Realtime-to-UI p95 ≤ 1 saniye
- Command-to-ACK ve command-to-VERIFIED ayrı ölçülür
- Queue recovery ölçülür
- Background battery/network bütçesi ölçülür

## Gerçek cihaz/araç matrisi

Android 11–15; düşük cihaz; zayıf ağ; uçak modu; process kill; Doze;
background restriction; iki kullanıcı/şirket; observer/member/admin; lost
phone; account switch; revoke; head-unit/backend/telefon/araç offline; gerçek
DTC ve remote command; push multi-device; malicious deep link.

## Paket kabul kapıları

- [ ] Website test/lint/typecheck/build zorunlu CI gate.
- [ ] RLS/cross-tenant staging suite geçiyor.
- [ ] Offline/SW/a11y/security E2E geçiyor.
- [ ] SLO ölçümleri gerçek düşük cihazdan geliyor.
- [ ] Remote command gerçek araç matrisi tamamlanıyor.
- [ ] Gerçek cihaz/araç kanıtları release ledger'a bağlı.

## Atomik görevler

| Kimlik | Başlık | Durum | Mevcut kanıt/not |
|---|---|---|---|
| PWA-P10-001 | Website test script ve CI gate envanteri | `NOT_STARTED` | Website CI yalnız build; 9 test dosyası var |
| PWA-P10-002 | RLS/cross-tenant staging harness | `BLOCKED` | Staging/migration authority gerekli |
| PWA-P10-003 | PWA offline/SW E2E | `NOT_STARTED` | Offline shell yok |
| PWA-P10-004 | Accessibility CI gate | `NOT_STARTED` | Mevcut gate yok |
| PWA-P10-005 | SLO instrumentation ve budgets | `NOT_STARTED` | Ölçüm yok |
| PWA-P10-006 | Real-device/vehicle validation ledger | `NOT_STARTED` | PWA için doğrulama kaydı yok |
| PWA-TEST-001 | commandService Vitest hoisting repair | `COMPLETED` | `vi.hoisted` test fixture; hedef 12/12, ilgili 252/252, tüm website suite 357/357 ve TypeScript geçti |
| PWA-TEST-002 | Repository TypeScript Gate Repair | `COMPLETED` | Paralel oturumun `Array.from(MapIterator)` ve async sonrası `getState()` düzeltmeleri bu oturumda değiştirilmeden doğrulandı; TypeScript PASS, ilgili 86/86, tam suite 534/534 |

---

# Aktif atomik görev kaydı

### Görev Kimliği

PWA-P1-001

### Başlık

Credential ve pairing authority envanteri

### Durum

COMPLETED

### Amaç

Arabam Cebimde PWA'da araç erişimi veya remote-control yetkisi üreten, saklayan,
okuyan, aktaran, döndüren ve iptal eden bütün credential/pairing yollarını
kanıta dayalı olarak çıkarmak; tek authenticated authority tasarımından önce
korunacak ve kapatılacak sınırları belirlemek.

### Değişen dosyalar

- `docs/ARABAM_CEBIMDE_PWA_ROADMAP.md`
- `docs/security/ARABAM_CEBIMDE_CREDENTIAL_AUTHORITY_INVENTORY.md`

### Korunan mevcut davranışlar

- Uygulama kodu değiştirilmedi.
- Mevcut authenticated ve standalone PWA pairing yollarına dokunulmadı.
- Existing offline pending-pairing davranışı değiştirilmedi.
- Test expectation değiştirilmedi.

### Eklenen davranışlar

- Runtime davranışı eklenmedi.
- Canonical roadmap ve audit başlangıç kaydı eklendi.

### Güvenlik etkisi

- Doğrudan runtime etkisi yok.
- PWA API key'inin localStorage'da olması ve iki pairing authority bulunması
  güvenlik engeli olarak kaydedildi.

### Privacy etkisi

- Doğrudan runtime etkisi yok.
- Account-switch sırasında vehicle/location/cache sızıntısı riski kaydedildi.

### Offline etkisi

- Yok; yalnız mevcut queue ve pending-pairing foundation'ı belgelendi.

### Migration etkisi

- Var olan migration dosyaları incelendi; uygulanmadı.
- `20260729000033`–`20260729000036` için canlı şema kanıtı yok.

### Testler

- Komut: `npx vitest run --config vitest.config.ts` ile command, pairing,
  fleet, offline queue ve realtime lifecycle kapsamındaki 9 seçili dosya.
- Sonuç: 8 dosya geçti, 212 test geçti.
- `commandService.test.ts` import aşamasında 0 test ile başarısız:
  `ReferenceError: Cannot access 'mockSupabase' before initialization`
  (`commandService.test.ts:34`, hoisted `vi.mock` factory).
- Test expectation veya uygulama kodu değiştirilmedi.
- Staging SQL, gerçek cihaz ve gerçek araç testi yapılmadı.

### Gerçek cihaz doğrulaması

- Gerekli değil — bu görev envanter/contract görevidir.
- Durum: `NOT_STARTED`.

### Gerçek araç doğrulaması

- Gerekli değil — bu görev envanter/contract görevidir.
- Durum: `NOT_STARTED`.

### Bilinen sınırlar

- Production environment değişkenleri ve canlı Supabase grant/RLS durumu
  doğrulanmadı.
- Pairing code rate-limit/entropy davranışı canlı sistemde ölçülmedi.
- Mevcut çalışma ağacındaki ilgili dosyalar commit edilmemiş olabilir.
- Supabase cookie security flag'lerinin deploy edilmiş değerleri doğrulanmadı.
- Vehicle API key rotation/revoke ve lost-device server akışı bulunamadı.
- PhoneHub trust ile Supabase ownership arasında binding bulunamadı.
- `commandService.test.ts` mevcut mock-hoisting problemi nedeniyle çalışmadı.

### Kabul kriterleri

- [x] Standalone PWA pairing yolu belirlendi.
- [x] Authenticated pairing yolu belirlendi.
- [x] Credential yazma ve okuma noktaları belirlendi.
- [x] Logout cleanup eksikliği belirlendi.
- [x] Credential lifecycle veri akış diyagramı tamamlandı.
- [x] Kapatılacak/geçiş yapılacak API contract kararı verildi.
- [x] Secure persistence için PWA/native sınır sözleşmesi önerildi.
- [x] Envanter güvenlik test matrisiyle bağlandı.

### Commit

- Henüz commit edilmedi.

### Deploy

- Yapılmadı.

### Sonraki atomik görev

- `PWA-P1-002 — Logout/account-switch cleanup contract`

## Sıradaki görev seçimi

İlk uygulama görevi olarak `PWA-P1-001` seçildi. Bunun nedeni:

1. Remote-control credential ve pairing authority doğrudan P0 güvenlik kapısıdır.
2. Runtime koduna dokunmadan bütün yetki yollarını sabitlemek mümkündür.
3. Logout cleanup, secure storage ve authenticated pairing değişikliklerinin
   güvenli sınırını belirler.
4. Truth Kernel çalışması, eski hesaptan sızan vehicle/cache authority'si
   çözülmeden güvenilir biçimde bağlanamaz.

# Tamamlanan atomik görev kaydı — PWA-P1-002

### Görev Kimliği

PWA-P1-002

### Başlık

Logout/account-switch cleanup contract

### Durum

COMPLETED

### Amaç

Logout, account switch, session expiry/revoke, lost device ve yarım cleanup
durumları için atomik, idempotent ve fail-closed cleanup sözleşmesini belirlemek.

### Değişen dosyalar

- `docs/ARABAM_CEBIMDE_PWA_ROADMAP.md`
- `docs/security/ARABAM_CEBIMDE_LOGOUT_CLEANUP_CONTRACT.md`

### Korunan mevcut davranışlar

- Uygulama, logout route, storage, PhoneHub ve test kodu değiştirilmedi.
- Mevcut kullanıcı verisi silinmedi.
- Migration uygulanmadı.

### Eklenen davranışlar

- Runtime davranışı eklenmedi.
- Canonical coordinator, cleanup state machine, namespace, boot gate, ledger,
  native/push/Mavi sınırları ve test matrisi tasarlandı.

### Güvenlik etkisi

- Production etkisi yok; tasarım girdisidir.
- Local authority lockdown'ın server sign-out'tan önce gelmesi kararlaştırıldı.
- Partial cleanup durumunda dashboard/command mount edilmemesi sözleşmeye alındı.

### Privacy etkisi

- Account-private data sınıfları ve zorunlu purge kapsamı belirlendi.
- Yalnız allowlist'teki account-independent device preference'ların
  korunabileceği kararlaştırıldı.

### Offline etkisi

- Offline logout local olarak güvenli tamamlanır; server/device/push revoke
  persistent ledger'da takip edilir.
- Eski queue başka account ile hiçbir zaman drain edilmez.

### Migration etkisi

- Yok; migration oluşturulmadı veya uygulanmadı.

### Testler

- Bu görevde test çalıştırılmadı; yalnız mevcut repository durumu ve PWA-P1-001
  test kanıtı kullanıldı.
- PWA-P1-001'de 8/9 dosya ve 212 test geçmişti.
- `commandService.test.ts`, hoisted `vi.mock` nedeniyle import aşamasında
  başarısız ve 0 test çalıştırıyor.
- `PWA-TEST-001 — commandService Vitest hoisting repair`, command/credential
  migration öncesi zorunlu test altyapısı işi olarak kaydedildi.

### Gerçek cihaz doğrulaması

- Gerekli değil — bu görev sözleşme/tasarım görevidir.
- Durum: `NOT_STARTED`.

### Gerçek araç doğrulaması

- Gerekli değil — bu görev sözleşme/tasarım görevidir.
- Durum: `NOT_STARTED`.

### Bilinen sınırlar

- Cleanup coordinator ve participant wiring henüz yok.
- Supabase per-device/global revoke politikası bilinmiyor.
- PhoneHub cloud binding/revoke endpoint'i yok.
- Push provider revoke semantics canlı sistemde doğrulanmadı.
- Future IndexedDB/Cache Storage registry implementasyonu yok.

### Kabul kriterleri

- [x] Cleanup envanteri veri sınıfları ve mevcut davranışlarla tamamlandı.
- [x] LEVEL 1/2/3 cleanup seviyeleri tanımlandı.
- [x] Cleanup state machine ve ordering kararı verildi.
- [x] Account namespace ve senaryo sözleşmesi tamamlandı.
- [x] Boot security gate sonuçları tanımlandı.
- [x] Bounded, secret içermeyen cleanup ledger tasarlandı.
- [x] PhoneHub, push ve Mavi cleanup kararları verildi.
- [x] Unit/integration/security/real-device test matrisi oluşturuldu.
- [x] commandService test altyapısı engeli ve ayrı görev kaydedildi.
- [x] Sonraki atomik görev repository bağımlılıklarına göre seçildi.

### Commit

- Henüz commit edilmedi.

### Deploy

- Yapılmadı.

### Sonraki atomik görev

- `PWA-P1-003 — AccountCleanupCoordinator foundation`

# Tamamlanan atomik görev kaydı — PWA-P1-003

### Görev Kimliği

PWA-P1-003

### Başlık

AccountCleanupCoordinator foundation

### Durum

COMPLETED

Bu durum yalnız foundation kabul kriterlerinin local testlerle tamamlandığını
ifade eder. Production cleanup, gerçek purge, logout/boot wiring ve security
gate tamamlanmış değildir.

### Amaç

Tek cleanup otoritesi için explicit state machine, durable marker/ledger,
deterministic participant registry, senkron local lockdown, cleanup generation,
idempotent/concurrent execution ve process-death/boot recovery temelini kurmak.

### Değişen dosyalar

- `website/src/security/accountCleanup/cleanupTypes.ts`
- `website/src/security/accountCleanup/cleanupStateMachine.ts`
- `website/src/security/accountCleanup/cleanupLedger.ts`
- `website/src/security/accountCleanup/cleanupParticipantRegistry.ts`
- `website/src/security/accountCleanup/cleanupLockdown.ts`
- `website/src/security/accountCleanup/cleanupBootGate.ts`
- `website/src/security/accountCleanup/AccountCleanupCoordinator.ts`
- `website/src/security/accountCleanup/index.ts`
- `website/src/__tests__/accountCleanupFoundation.test.ts`
- `docs/security/ARABAM_CEBIMDE_LOGOUT_CLEANUP_CONTRACT.md`
- `docs/ARABAM_CEBIMDE_PWA_ROADMAP.md`

### Korunan mevcut davranışlar

- Mevcut logout API/UI, Supabase `signOut`, auth listener, dashboard, realtime,
  queue scheduler ve command dispatch akışları değiştirilmedi.
- Gerçek storage, credential, PhoneHub trust, push ve Mavi verisi silinmedi.
- `commandService.test.ts` hoisting problemi değiştirilmedi.

### Eklenen davranışlar

- Geçiş tablosuyla sınırlandırılmış cleanup state machine eklendi.
- Secret içermeyen, versioned `caros:security:account-cleanup:v1` metadata
  ledger'ı ve yedi günlük completed-retention politikası eklendi.
- En fazla 64 participant, unique ID ve stabil priority/registration sırası
  uygulayan registry eklendi.
- Cleanup isteğinde ilk `await` öncesinde lockdown ve generation artışı eklendi.
- Aynı aktif cleanup için aynı Promise paylaşımı; farklı paralel cleanup yerine
  aktif isteğe katılma davranışı eklendi.
- Her faz için kayıtlı participant ve `VERIFY_EMPTY` verifier zorunlu kılındı;
  boş registry veya placeholder ile `COMPLETED` üretilemez.
- Corrupt/future-schema ledger ve yarım cleanup için foundation boot gate
  fail-closed sonuçları eklendi.

### Güvenlik etkisi

- Foundation API'leri eski async generation'ı reddeder ve aktif cleanup
  sırasında account activation'ı kapatır.
- Runtime entegrasyonu yapılmadığı için mevcut production ekran ve command
  akışlarında henüz güvenlik iyileşmesi yoktur.
- `PRODUCTION_SECURITY_GATE: BLOCKED` kalır.

### Privacy etkisi

- Ledger doğrulayıcısı raw token, API key, PIN hash, pairing code ve raw account
  ID alanlarını kabul etmez.
- `previousAccountId` yalnız injectable SHA-256 hash sonucu olarak ledger'a
  yazılabilir.

### Offline etkisi

- localStorage tabanlı durable marker ve recovery API foundation'ı process-death
  sonrası devam için hazırdır.
- Gerçek offline queue purge/resume participant'ı henüz yoktur.

### Migration etkisi

- Yok; migration oluşturulmadı veya uygulanmadı.

### Testler

- `npx vitest run --config vitest.config.ts src/__tests__/accountCleanupFoundation.test.ts`
  → 1 dosya, 29/29 test geçti.
- İlgili pairing, fleet, offline queue ve realtime regresyon koşumu
  → 9 dosya, 247/247 test geçti.
- `npx tsc --noEmit` → geçti.
- İlk sandbox koşumu child-process `EPERM` nedeniyle başlayamadı; aynı komut
  izinli çalışma ortamında başarıyla tamamlandı.
- `npx vitest run --config vitest.config.ts src/__tests__/commandService.test.ts`
  → import aşamasında `mockSupabase` initialization öncesi erişim; 1 dosya
  başarısız, 0 test. Bilinen hoisted `vi.mock` engeli değiştirilmedi;
  `PWA-TEST-001` hâlâ command/credential wiring öncesi gate'tir.

### Gerçek cihaz doğrulaması

- Gerekli değil — foundation saf unit testlerle doğrulandı.
- Runtime boot/process-kill entegrasyonu sonrası gerçek cihaz testi gerekecek.

### Gerçek araç doğrulaması

- Gerekli değil — bu görev araç komutu veya araç state'i çalıştırmaz.

### Bilinen sınırlar

- Coordinator için production singleton/composition root henüz yok.
- Application boot veya mevcut logout akışına wiring yapılmadı.
- Registry production'da boş başlar; gerçek domain participant'ları yoktur.
- Namespace/ownership/credential bütünlük kontrolleri boot gate'te
  `NOT_IMPLEMENTED` kapsamındadır.
- Browser storage quota/disabled-mode ve gerçek process-kill cihaz kanıtı yok.
- Gerçek Supabase signOut, push/device revoke ve native trust işlemi yok.

### Kabul kriterleri

- [x] Cleanup reason/state/failure modelleri typed.
- [x] Geçerli ve geçersiz state transition'ları testli.
- [x] Versioned durable metadata ledger parse/schema hatasında fail-closed.
- [x] Lockdown senkron ve generation cleanup başlangıcında artıyor.
- [x] Late generation reddediliyor.
- [x] Participant ID/ordering/bound kuralları testli.
- [x] Aynı anda tek cleanup ve idempotent retry/recovery foundation'ı testli.
- [x] Retryable, blocking ve verify failure başarıya çevrilmiyor.
- [x] `VERIFY_EMPTY` olmadan `COMPLETED` üretilemiyor.
- [x] Process-death recovery ve completed no-op testli.
- [x] Foundation boot gate active/corrupt ledger'ı güvenli sonuçlandırıyor.
- [x] Roadmap ve cleanup contract implementation note güncellendi.
- [ ] Gerçek store/credential/queue participant'ları bağlı.
- [ ] Runtime boot ve logout wiring tamamlandı.
- [ ] Gerçek cihaz process-kill doğrulaması yapıldı.

### Commit

- Henüz commit edilmedi.

### Deploy

- Yapılmadı.

### Sonraki atomik görev

- `PWA-P1-004 — Account-scoped storage registry`

### Seçim gerekçesi

Coordinator domain key'lerini doğrudan bilmemelidir. Vehicle credential veya
offline queue participant'ları yazılmadan önce bütün account-scoped
localStorage/memory/IndexedDB/Cache/SW alanlarını bounded ve doğrulanabilir tek
registry altında tanımlamak, yanlış hesaba purge veya eksik `VERIFY_EMPTY`
sonucunu önleyen en küçük güvenli adımdır. `PWA-TEST-001` credential/command
wiring başlamadan ayrıca tamamlanmalıdır.

# Tamamlanan atomik görev kaydı — PWA-P1-004

### Görev Kimliği

PWA-P1-004

### Başlık

Account-scoped storage registry

### Durum

COMPLETED

Bu durum yalnız registry/scanner/verify foundation kabul kriterlerinin locally
tested olduğunu ifade eder. Gerçek purge, migration ve runtime logout wiring yok.

### Amaç

Account/vehicle/security-sensitive persistent ve memory storage alanlarını
bounded, versioned, frozen ve doğrulanabilir tek registry altında tanımlamak;
legacy veya account-mismatch kayıtları fail-closed bulacak yüzeyi oluşturmak.

### Değişen dosyalar

- `website/src/security/accountCleanup/storage/storageTypes.ts`
- `website/src/security/accountCleanup/storage/storageRegistry.ts`
- `website/src/security/accountCleanup/storage/storageNamespace.ts`
- `website/src/security/accountCleanup/storage/knownStorageDescriptors.ts`
- `website/src/security/accountCleanup/storage/storageScanner.ts`
- `website/src/security/accountCleanup/storage/storageVerifier.ts`
- `website/src/security/accountCleanup/storage/index.ts`
- `website/src/security/accountCleanup/index.ts`
- `website/src/__tests__/accountStorageRegistry.test.ts`
- `docs/security/ARABAM_CEBIMDE_ACCOUNT_STORAGE_REGISTRY.md`
- `docs/ARABAM_CEBIMDE_PWA_ROADMAP.md`

### Eklenen davranışlar

- 128 kayıt limitli, deterministic ve freeze edilebilir registry eklendi.
- Canonical account/account-vehicle/anonymous namespace build/parse/ownership
  doğrulaması eklendi.
- 256 key ile bounded local/session storage scanner eklendi.
- Production registry 18 evidence-backed descriptor ile oluşturuldu.
- `AccountScopedStorageVerificationParticipant` cleanup `VERIFY_EMPTY` fazına
  bağlanabilir hale geldi.
- Persistent browser `SECRET`, `userId:null`, duplicate key/pattern, future
  schema ve eksik owner contract registration anında reddediliyor.

### Bulunan storage yüzeyleri

- localStorage aktif ve security/private/authority/preference verileri karışık.
- sessionStorage ve IndexedDB production kullanımı bulunmadı.
- Service worker push/click çalıştırıyor; Cache Storage kullanmıyor.
- Zustand vehicle/notification ve module singleton queue/realtime/command
  context'leri memory registry kapsamına alındı.

### Legacy key özeti

- Kayıt dışı browser SECRET: `caros_pair_api_key`.
- Authority: `caros_critical_pin_hash`, paired vehicle key'leri,
  `caros.fleet.queue.*`, `caros.fleet.snapshot.*`,
  `caros.fleet.pairing.*`, `clp_push_sub`.
- Private owner-less: fuel, service, parking ve speed alert key'leri.
- Allowlisted device preference: `caros-theme`, `pwa-theme`,
  `caros-theme-studio`.

### Güvenlik etkisi

- Registry dışı bilinen API key ve suspicious CAROS key verify-empty başarısını
  engeller.
- Corrupt storage, unavailable storage, namespace mismatch ve eksik custom
  memory verifier fail-closed sonuç üretir.
- Runtime composition/purge bağlı olmadığı için production gate blokludur.

### Offline etkisi

- Fleet queue/snapshot/pending pairing persistent alanları ve memory singleton'ı
  canonical cleanup envanterine alındı.
- Veri silinmedi, queue formatı/migration davranışı değiştirilmedi.

### Migration etkisi

- Migration gerektiren legacy key'ler belgelendi; migration oluşturulmadı veya
  uygulanmadı.

### Testler

- Registry testi: 31/31 geçti.
- Registry + cleanup foundation: 2 dosya, 60/60 geçti.
- İlgili regresyon: 10 dosyada 274 test geçti, 4 test başarısız.
  Başarısızlıkların tamamı görev kapsamı dışındaki
  `fleetMembershipFoundation.test.ts` statik beklentilerinin mevcut
  `20260729000035_fleet_membership_foundation.sql` içeriğiyle uyuşmamasıdır
  (`pg_get_constraintdef LIKE` beklentileri ve `DROP TABLE` metin kontrolü).
  Registry/cleanup testlerinde başarısızlık yok; migration ve expectation
  değiştirilmedi.
- `npx tsc --noEmit`: geçti.
- `commandService.test.ts`: bilinen hoisted `vi.mock` nedeniyle import aşamasında
  başarısız, 0 test; bu görevde değiştirilmedi.

### Gerçek cihaz doğrulaması

- Yapılmadı. Browser quota/private mode/backup/process-death doğrulaması
  participant wiring sonrasında gerekir.

### Gerçek araç doğrulaması

- Gerekli değil; registry araç komutu çalıştırmaz.

### Bilinen sınırlar

- `caros_pair_api_key` güvenli descriptor olarak kaydedilmedi; scanner tarafından
  kayıt dışı SECRET engeli olmaya devam ediyor.
- Legacy key'ler canonical namespace'e migrate edilmedi.
- Memory custom reset/verifier adapter'ları bağlı değil.
- Supabase SDK session storage/provider contract kapsam dışı ve doğrulanmadı.
- Cache/IndexedDB yokluğu yalnız mevcut source kanıtıdır.
- Ownership snapshot payload owner doğrulaması sonraki participant kapsamıdır.

### Kabul kriterleri

- [x] Persistent ve memory storage envanteri çıkarıldı.
- [x] Scope/sensitivity/cleanup/owner modelini taşıyan registry eklendi.
- [x] Duplicate, overlap, SECRET persistence ve owner validation testli.
- [x] Canonical environment-separated namespace testli.
- [x] Bounded scanner payload loglamadan legacy/suspicious/corrupt kayıt buluyor.
- [x] Verify-empty global preference ve cleanup ledger exemption'ı uyguluyor.
- [x] Registry invalid/unavailable/private/authority durumunda fail-closed.
- [x] Coordinator VERIFY_EMPTY participant entegrasyonu test composition'da geçti.
- [x] Service worker'ın mevcut cache-stateless davranışı source testiyle doğrulandı.
- [x] Detay eki ve canonical roadmap güncellendi.
- [ ] Gerçek legacy purge/migration yapıldı.
- [ ] Runtime logout/boot composition bağlandı.

### Commit

- Henüz commit edilmedi.

### Deploy

- Yapılmadı.

### Sonraki atomik görev

- `PWA-TEST-001 — commandService Vitest hoisting repair`

### Seçim gerekçesi

PWA-P1-005 vehicle API key/PIN/selected-vehicle authority participant'larını
command authorization yoluna dokunmadan güvenle doğrulayamaz: mevcut
`commandService.test.ts` import aşamasında çökmekte ve 0 test çalıştırmaktadır.
Önce küçük, davranış değiştirmeyen test infrastructure gate'i onarılmalıdır.

# Tamamlanan atomik görev kaydı — PWA-TEST-001

### Görev Kimliği

PWA-TEST-001

### Başlık

commandService Vitest hoisting repair

### Durum

COMPLETED

### Kök neden

- `website/src/__tests__/commandService.test.ts:24-36` içindeki
  `mockSupabase`, normal ESM module initialization sırasında oluşturuluyordu.
- `vi.mock` factory importların önüne hoist edildiği için factory
  `mockSupabase` TDZ'deyken erişiyor ve dosya import aşamasında çöküyordu.
- Test mock'u güncel production yüzeyindeki `auth.getSession`, `rpc` ve
  `.gte(...)` üzerinde await edilen online-query sonucunu da eksik
  modelliyordu.

### Değişen dosyalar

- `website/src/__tests__/commandService.test.ts`
- `docs/ARABAM_CEBIMDE_PWA_ROADMAP.md`

### Seçilen mock stratejisi

- Supabase/channel fixture'ı `vi.hoisted` içinde oluşturuldu.
- Mock factory yalnız hoisted `mocks.supabase` nesnesine bağlandı.
- Top-level `beforeEach`, call history'yi temizliyor ve bütün default
  implementation'ları deterministik yeniden kuruyor.
- `afterEach`, fake timer sızıntısını önlemek için real timer'a dönüyor.
- Select chain `.gte(...)` sonucunu production çağrı zinciriyle aynı noktada
  döndürüyor.

### Test expectation

- Hiçbir `expect` değişmedi, gevşetilmedi, silinmedi veya skip edilmedi.
- Test sayısı korunarak 12 test gerçekten toplandı.

### Test sonuçları

- Hedef:
  `npx vitest run --config vitest.config.ts src/__tests__/commandService.test.ts`
  → 1 dosya, 12/12 geçti.
- İlgili command/cleanup/storage/pairing/realtime/fleet-offline grubu
  → 10 dosya, 252/252 geçti.
- Tüm website suite:
  `npx vitest run --config vitest.config.ts`
  → 15 dosya, 357/357 geçti.
- `npx tsc --noEmit` → geçti.
- `website/package.json` içinde lint script'i yok; lint çalıştırılmadı.

### Fleet migration regression durumu

PWA-P1-004 sırasında ölçülen dört `fleetMembershipFoundation.test.ts`
başarısızlığı bu son tüm-suite koşumunda tekrarlanmadı; dosya 15/15 suite içinde
geçti. Bu görev migration 035 veya ilgili expectation'ları değiştirmedi.
Dolayısıyla o tarihte önerilen fleet-migration expectation görevi açılmadı.
`PWA-TEST-002` kimliği daha sonra repository TypeScript gate repair için
canonical olarak kullanıldı.

### commandService kapsamı

Mevcut testler authenticated insert/route flow, online/offline queued sonucu,
RLS error, coordinate validation, TTL expiry, terminal realtime cleanup ve
navigation intent üretimini doğrular.

Mevcut testler API-key fallback, Bearer header/body nonce/TTL, critical RPC/PIN
semantics, empty response, network failure, duplicate dispatch, unsupported
command, server-side re-auth, EXECUTED/VERIFIED ayrımı veya physical execution
truth'ünü doğrulamaz.

### Güvenlik etkisi

- Mevcut command davranışı yeniden regresyon-test edilebilir hale geldi.
- Testlerin geçmesi API-key yolunun güvenli, PIN hash'in server re-auth veya
  `completed` durumunun VERIFIED olduğu anlamına gelmez.
- `PRODUCTION_SECURITY_GATE: BLOCKED` kalır.

### Production davranışı

- Değişmedi; `website/src/lib/commandService.ts` ve production dosyaları
  değiştirilmedi.

### Migration etkisi

- Yok; migration oluşturulmadı veya uygulanmadı.

### Gerçek cihaz/araç doğrulaması

- Gerekli değil; test infrastructure görevidir.

### Commit

- Henüz commit edilmedi.

### Deploy

- Yapılmadı.

### Sonraki atomik görev

- `PWA-P1-005 — Vehicle credential and local authority cleanup participants`

# Tamamlanan atomik görev kaydı — PWA-P1-005

### Görev Kimliği

PWA-P1-005

### Başlık

Vehicle credential and local authority cleanup participants

### Durum

COMPLETED

Bu yalnız scoped vehicle local authority participant'larının implementasyon ve
local test kabul kriterlerinin tamamlandığını gösterir. Gerçek logout, offline
authority cleanup ve production security gate tamamlanmış değildir.

### Değişen dosyalar

- `website/src/security/accountCleanup/vehicleCleanupParticipants.ts`
- `website/src/security/accountCleanup/vehicleAuthorityRuntime.ts`
- `website/src/security/accountCleanup/createAccountCleanupRuntime.ts`
- `website/src/security/accountCleanup/index.ts`
- `website/src/store/vehicleStore.ts`
- `website/src/store/pinDialogStore.ts`
- `website/src/hooks/useRealtime.ts`
- `website/src/hooks/useCommandTracker.ts`
- `website/src/__tests__/vehicleAuthorityCleanup.test.ts`
- `docs/security/ARABAM_CEBIMDE_LOGOUT_CLEANUP_CONTRACT.md`
- `docs/security/ARABAM_CEBIMDE_ACCOUNT_STORAGE_REGISTRY.md`
- `docs/ARABAM_CEBIMDE_PWA_ROADMAP.md`

### Eklenen participant'lar

- `VehicleCredentialCleanupParticipant` — `LOCAL_SECRET_PURGE`, priority 10.
- `VehicleIdentityStorageCleanupParticipant` — `LOCAL_PRIVATE_DATA_PURGE`,
  priority 10.
- `VehicleMemoryAuthorityCleanupParticipant` — `LOCAL_PRIVATE_DATA_PURGE`,
  priority 20.
- `VehicleAuthorityVerificationParticipant` — `VERIFY_EMPTY`, priority 10.

### Temizlenen persistent authority

- `caros_pair_api_key`
- `caros_critical_pin_hash`
- `caros_pair_vehicle_id`
- `caros_pair_vehicle_name`
- `caros_pair_vehicle_plate`

Exact bounded key seti kullanılır; `localStorage.clear()` veya wildcard purge
yoktur. Tema ve bilinmeyen CAROS key'leri participant tarafından silinmez.

### Temizlenen memory authority

- Vehicle Zustand list/cache, connection state, loading/error ve render throttle.
- Critical PIN dialog prompt/resolver state.
- Registered command tracker phase/result/subscription handles.

### Verification ve idempotency

- Clear sonrasında her persistent key yeniden kontrol edilir.
- Vehicle store, PIN dialog ve command tracker registry gerçek empty verifier
  sağlar.
- Eksik key seti, remove/read exception, storage unavailable, memory residue ve
  generation mismatch blocking failure'dır.
- Yok key `ALREADY_EMPTY`; recovery rerun güvenli ve idempotenttir.
- Web Storage için transaction iddiası yok; completed step yalnız clear +
  verify sonrasında coordinator tarafından yazılır.

### Late-event koruması

- Local hydrate ve Supabase vehicle fetch generation capture eder.
- Vehicle store yazıları lockdown sırasında reddedilir.
- Realtime callback'leri engine kurulurken capture edilen generation ile
  doğrulanır.
- Command dispatch/callback/timeout generation ve lockdown kontrolü taşır.
- Command tracker handle registry cleanup sırasında local phase/result ve
  subscriptions state'ini temizler.

Dashboard protected mount henüz lockdown state'ine bağlı değildir. Bu nedenle
runtime UI gate tamamlanmış gösterilmez.

### Composition

`createVehicleCleanupComposition` gerçek participant ve account-scoped storage
verifier'ı lazy, SSR-safe registry içinde oluşturur. Module import/factory
construction storage okumaz. Factory coordinator oluşturmaz ve logout çağırmaz.
Offline/ownership/pairing ve diğer memory verifier'ları eksik olduğundan tam
production cleanup başarı composition'ı henüz yoktur.

### Testler

- Yeni participant testleri: 35/35 geçti.
- PWA-TEST-001 commandService: 12/12 geçti.
- İlgili regresyon grubu: 11 dosya, 287/287 geçti.
- Tüm website suite: 18 dosya, 433/433 geçti.
- `npx tsc --noEmit`: geçti.
- Test expectation değiştirilmedi.

### Güvenlik etkisi

- Logout/switch coordinator ileride bağlandığında API key/PIN/vehicle authority
  gerçek clear ve verify kapısından geçebilecek.
- API-key fallback üretim/okuma/command yolu hâlâ mevcuttur; secure storage veya
  rotation migration yapılmadı.
- `caros_pair_api_key` scanner'da dangerous/unregistered SECRET kalır.
- `PRODUCTION_SECURITY_GATE: BLOCKED`.

### Offline etkisi

- Offline queue, ownership snapshot ve pending pairing değiştirilmedi veya
  temizlenmedi.
- Vehicle cache late-write guard güvenlik amacıyla eklendi.

### Migration etkisi

- Yok; migration oluşturulmadı veya uygulanmadı.

### Gerçek cihaz/araç doğrulaması

- Gerçek cihaz yapılmadı.
- Gerçek araç gerekli değil; hiçbir remote command çalıştırılmadı.

### Bilinen sınırlar

- Gerçek logout/coordinator wiring yok.
- Dashboard boot/protected mount lockdown gate yok.
- Offline queue/ownership/pending pairing participant'ları yok.
- Notification/Mavi/PhoneHub/push cleanup yok.
- API key browser storage'dan kalıcı olarak kaldırılmadı.
- Browser exception/process-kill gerçek cihazda doğrulanmadı.

### Commit

- Henüz commit edilmedi.

### Deploy

- Yapılmadı.

### Sonraki atomik görev

- `PWA-P1-006 — Cleanup runtime lockdown wiring`

### Seçim gerekçesi

Vehicle/realtime/command write guard'ları mevcut olsa da protected dashboard
cleanup başlar başlamaz mount edilmeye devam edebilir ve eski state'i participant
clear tamamlanana kadar render edebilir. Offline authority participant'larından
önce boot/dashboard/command yüzeyini merkezi lockdown state'ine bağlamak en küçük
P0 güvenlik adımıdır. Eksik local participant'lar nedeniyle auth logout wiring
henüz güvenli değildir.

### Görev Kimliği

PWA-P1-006

### Başlık

Cleanup runtime lockdown wiring

### Durum

COMPLETED

Vitest ve repository-wide TypeScript kabul kapıları yeşildir. Gerçek
cihaz/browser process-death doğrulaması yapılmadı; production security gate
`BLOCKED` kalır.

### Değişen dosyalar

- `website/src/security/accountCleanup/accountCleanupRuntime.ts`
- `website/src/security/accountCleanup/useAccountCleanupRuntime.ts`
- `website/src/security/accountCleanup/index.ts`
- `website/src/components/security/AccountCleanupBootGate.tsx`
- `website/src/app/dashboard/layout.tsx`
- `website/src/lib/commandService.ts`
- `website/src/hooks/useRealtime.ts`
- `website/src/hooks/useFleet.ts`
- `website/src/lib/fleet/errors.ts`
- `website/src/lib/pairingService.ts`
- `website/src/components/pwa/PairingScreen.tsx`
- `website/public/sw.js`
- `website/src/__tests__/accountCleanupRuntime.test.ts`
- `website/src/__tests__/accountCleanupBootGate.test.tsx`
- `website/src/__tests__/commandService.test.ts`
- `website/src/__tests__/realtimeVehiclePairingLifecycle.test.ts`
- `docs/security/ARABAM_CEBIMDE_LOGOUT_CLEANUP_CONTRACT.md`
- `docs/ARABAM_CEBIMDE_PWA_ROADMAP.md`

### Eklenen davranışlar

- Browser-lazy tek production runtime; import/SSR sırasında storage okunmaz.
- Immutable React snapshot, bounded listener registry ve listener hata izolasyonu.
- Server snapshot ve runtime/factory hataları fail-closed.
- Dashboard children yalnız `SAFE_TO_START` durumunda gerçekten mount edilir.
- Pending cleanup için tek bounded otomatik recovery denemesi ve güvenli retry UI.
- Command insert/API-key fallback ile status subscription lockdown sırasında
  başlamaz.
- Realtime subscription lockdown sırasında başlamaz; aktif kanal kapanır ve
  unlock tek başına eski hesaba resubscribe etmez.
- Fleet refresh/mutation/queue drain generation doğrulaması olmadan başlamaz;
  lockdown state'i memory görünümünü temizler, queue verisini silmez.
- Pairing continuation ve QR/offline claim devamı canonical runtime tarafından
  reddedilir.
- Push notification URL aynı-origin `/dashboard` allowlist'ine indirilir;
  query/hash içindeki eski account/vehicle context taşınmaz.
- Website içinde gerçek mobil Mavi provider/mount bulunmadı; bu yüzey
  `NOT_PRESENT/NOT_WIRED` olarak bırakıldı.

### Güvenlik etkisi

- UI gizleme yerine protected children ve side-effect başlangıçları kapatıldı.
- Cleanup generation eski realtime/queue/command callback'leri için authority
  sınırı olmaya devam eder.
- Runtime unavailable/corrupt/future-schema/partial cleanup SAFE kabul edilmez.
- Production security gate kapanmadı; logout ve eksik purge/revoke katmanları
  hâlâ açık kapıdır.

### Offline etkisi

- Offline queue içeriği bu görevde silinmedi.
- Lockdown sırasında queue drain ve yeni fleet mutation durur.
- Pending pairing verisi silinmedi; yalnız continuation kilitlendi.

### Testler

- `npx vitest run --config vitest.config.ts`: 22 dosya, 534/534 geçti.
- Yeni runtime/boot gate testleri: 23 test.
- `commandService`: 14/14 geçti; önceki 12 expectation korunup iki lockdown
  testi eklendi.
- Realtime lifecycle/lockdown: 23/23 geçti.
- Cleanup foundation, storage registry ve vehicle cleanup regresyonları geçti.
- `npx tsc --noEmit`: geçti.
- Dar realtime/cleanup regresyon grubu: 4 dosya, 86/86 geçti.
- TS2802, `pendingByKey.values()` iterator'ının `Array.from(...)` ile aynı
  insertion-order semantiğinde materialize edilmesiyle giderildi.
- TS2367, `await fetchSnapshot` sonrasında lifecycle state'in `getState()`
  üzerinden yeniden okunmasıyla giderildi; `stop()` yarışı korunur.
- Hedef realtime authority dosyası ve testi paralel oturum tarafından
  değiştirilmişti; bu oturum bunları sahiplenmedi veya yeniden değiştirmedi.

### Bilinen sınırlar

- Gerçek logout/coordinator wiring yapılmadı.
- Offline queue, ownership snapshot ve pending pairing purge/verify yok.
- Server session/device/push revoke yok.
- Push subscription/topic cleanup yok.
- Mavi PWA mount ve cleanup participant yok.
- Account namespace/ownership boot doğrulaması foundation kapsamının dışında.
- Gerçek cihaz process-death/hydration doğrulaması yapılmadı.

### Kabul kriterleri

- [x] Tek lazy ve SSR-safe production runtime.
- [x] React snapshot/subscription ve fail-closed server snapshot.
- [x] Dashboard yalnız SAFE_TO_START durumunda mount.
- [x] Command/realtime/fleet/pairing canonical lockdown wiring.
- [x] Push protected route allowlist ve eski context suppression.
- [x] Mavi mount yokluğu repository kanıtıyla N/A.
- [x] Runtime/boot/command/realtime regresyon testleri.
- [x] Repository-wide TypeScript temiz.
- [x] Logout wiring yapılmadığı kaydedildi.
- [x] Production security gate BLOCKED.

### Commit

- Henüz commit edilmedi.

### Deploy

- Yapılmadı.

### Migration etkisi

- Yok; migration oluşturulmadı veya uygulanmadı.

### Gerçek cihaz doğrulaması

- Gerekli; yapılmadı.

### Gerçek araç doğrulaması

- Gerekli değil; araç komutu çalıştırılmadı.

### Sonraki atomik görev

- `PWA-P1-007 — Offline queue, ownership snapshot and pending pairing cleanup participants`

### Görev Kimliği

PWA-P1-007

### Başlık

Offline queue, ownership snapshot and pending pairing cleanup participants

### Durum

COMPLETED

Host seviyesinde implementasyon, TypeScript ve Vitest kapıları tamamlandı.
Gerçek cihaz/browser process-death doğrulaması yapılmadı; production security
gate `BLOCKED` kalır.

### Değişen dosyalar

- `website/src/lib/offline/fleetOffline.ts`
- `website/src/lib/offline/pendingPairingService.ts`
- `website/src/security/accountCleanup/offlineAuthorityCleanupParticipants.ts`
- `website/src/security/accountCleanup/createAccountCleanupRuntime.ts`
- `website/src/security/accountCleanup/index.ts`
- `website/src/__tests__/offlineAuthorityCleanup.test.ts`
- `website/src/__tests__/vehicleAuthorityCleanup.test.ts`
- `docs/security/ARABAM_CEBIMDE_LOGOUT_CLEANUP_CONTRACT.md`
- `docs/DEVICE_VALIDATION_LEDGER.md`
- `docs/CAROS_PRO_VIZYONU.md`
- `docs/ARABAM_CEBIMDE_PWA_ROADMAP.md`

### Eklenen davranışlar

- Offline queue, ownership snapshot ve pending pairing için ayrı,
  deterministic `QUEUE_AND_SNAPSHOT_PURGE` participant'ları eklendi.
- Her participant `prepare → cleanup → verifyEmpty` akışını, cleanup
  generation doğrulamasını, idempotent tekrar çalıştırmayı ve fail-closed
  storage hata davranışını uygular.
- Queue orchestrator önce durdurulur; memory singleton'ları ve bütün kanıtlı
  `caros.fleet.queue.*`, `caros.fleet.snapshot.*`,
  `caros.fleet.pairing.*` persistent namespace'leri exact prefix sınırında
  temizlenir.
- Pending pairing verification, persistent kayıtların yanında store/namespace
  singleton'ını ve in-flight continuation setini de denetler.
- Aggregate `OfflineAuthorityVerificationParticipant`, üç authority alanından
  herhangi biri kalırsa `VERIFY_EMPTY` fazını blocking failure ile kapatır.
- Production cleanup composition bu participant'ları secret/private purge
  fazlarından sonra ve genel storage verifier'dan önce sabit sırada bağlar.

### Korunan mevcut davranışlar

- Normal queue enqueue/drain/retry/conflict algoritmaları değiştirilmedi.
- Ownership hesaplama ve pairing continuation davranışları cleanup dışında
  değiştirilmedi.
- Tema ve diğer global cihaz tercihleri korunur; bilinmeyen CAROS key'leri
  wildcard ile silinmez.
- Gerçek logout çağrısı coordinator'a bağlanmadı.

### Güvenlik etkisi

- Eski hesaba ait queue, ownership snapshot ve pending pairing authority'si
  coordinator recovery sırasında gerçek clear + verify kapısından geçebilir.
- Storage erişilemezse, generation değişirse veya residual authority bulunursa
  cleanup başarı üretemez.
- Server session revoke, logout wiring, API-key migration ve diğer zorunlu
  participant'lar eksik olduğundan `PRODUCTION_SECURITY_GATE: BLOCKED`.

### Offline etkisi

- Cleanup istendiğinde yalnız account authority namespace'leri temizlenir.
- Web Storage çoklu key silme işlemi transaction değildir; yarım silme ledger
  recovery ile idempotent yeniden çalıştırılır ve verify geçmeden tamamlanmaz.
- IndexedDB veya Cache Storage üzerinde bu üç authority için mevcut production
  persistence yolu bulunmadı.

### Testler

- Dar cleanup/offline regresyonu: 8 dosya, 208/208 geçti.
- Yeni participant testleri: 15/15 geçti.
- `npx tsc --noEmit`: geçti.
- `npx vitest run --config vitest.config.ts`: 24 dosya, 572/572 geçti.
- Testler shared working tree üzerinde koştu; başarısız test yoktur.

### Bilinen sınırlar

- Gerçek logout/coordinator wiring yapılmadı.
- Supabase server-session revoke participant'ı yok.
- Push, Mavi ve PhoneHub cleanup participant'ları yok.
- Gerçek cihazda A hesabı → cleanup/process kill → B hesabı izolasyonu
  doğrulanmadı; doğrulama kütüğü #183 açıktır.

### Kabul kriterleri

- [x] Offline queue persistent ve memory authority clear + verify.
- [x] Ownership snapshot persistent authority clear + verify.
- [x] Pending pairing persistent, singleton ve in-flight authority clear + verify.
- [x] Idempotent, retry-safe ve generation-safe participant akışı.
- [x] Production composition ve aggregate VERIFY_EMPTY entegrasyonu.
- [x] TypeScript ve tüm website Vitest suite geçti.
- [x] Logout wiring yapılmadığı kaydedildi.
- [x] Production security gate BLOCKED.

### Commit

- Henüz commit edilmedi.

### Deploy

- Yapılmadı.

### Migration etkisi

- Yok; migration oluşturulmadı veya uygulanmadı.

### Gerçek cihaz doğrulaması

- Gerekli; yapılmadı. `docs/DEVICE_VALIDATION_LEDGER.md` #183.

### Gerçek araç doğrulaması

- Gerekli değil; araç komutu çalıştırılmadı.

### Sonraki atomik görev

- `PWA-P1-008 — Server Session Revoke Participants`

### Görev Kimliği

PWA-P1-008

### Başlık

Server Session Revoke Participants — Gap Closure

### Durum

TESTED_LOCAL

Bağımsız review açıkları host seviyesinde kapatıldı ve görev `TESTED_LOCAL`
kaldı. Gerçek provider/browser process-death doğrulaması yapılmadığı için
`COMPLETED` denmedi.

### Auth modeli

- Tek auth provider Supabase Auth’tur.
- Browser ve server `@supabase/ssr` client’ları aynı chunked cookie session’ını
  kullanır; özel server session tablosu bulunmadı.
- `website/node_modules`, lockfile ile hizalandı: `@supabase/ssr` 0.12.0,
  `@supabase/supabase-js` ve `@supabase/auth-js` 2.110.1. Varsayılan sign-out
  kapsamı `global`dır.
  Participant diğer cihazları kapatmamak için açıkça `scope: 'local'` kullanır.
- Resmi local sign-out mevcut refresh token’ı server’da revoke eder ve browser
  session/cookie materyalini kaldırır. Mevcut access-token JWT anında revoke
  edilemez ve expiry’ye kadar geçerli olabilir.
- Vehicle API-key authority Supabase session’dan bağımsızdır ve değiştirilmedi.

### Değişen dosyalar

- `website/src/security/accountCleanup/serverSessionCleanupParticipants.ts`
- `website/src/security/accountCleanup/authSessionMutationLock.ts`
- `website/src/security/accountCleanup/canonicalLogout.ts`
- `website/src/app/api/auth/revoke-session/route.ts`
- `website/src/app/api/auth/logout/route.ts`
- `website/src/security/accountCleanup/authSessionGenerationGuard.ts`
- `website/src/security/accountCleanup/authCleanupMarker.ts`
- `website/src/security/accountCleanup/AccountCleanupCoordinator.ts`
- `website/src/security/accountCleanup/accountCleanupRuntime.ts`
- `website/src/security/accountCleanup/createAccountCleanupRuntime.ts`
- `website/src/security/accountCleanup/index.ts`
- `website/src/hooks/useSessionUser.ts`
- `website/src/components/layout/Sidebar.tsx`
- `website/src/app/login/page.tsx`
- `website/src/app/register/page.tsx`
- `website/src/app/reset-password/page.tsx`
- `website/src/app/auth/hash-callback/page.tsx`
- `website/src/app/auth/callback/route.ts`
- `website/src/middleware.ts`
- `website/src/lib/supabaseBrowser.ts`
- `website/src/__tests__/serverSessionCleanup.test.ts`
- `website/src/__tests__/targetedSessionRevokeRoute.test.ts`
- `website/src/__tests__/canonicalLogout.test.ts`
- `website/src/__tests__/canonicalLogoutUiWiring.test.tsx`
- `website/src/__tests__/authSessionWriterIntegration.test.tsx`
- `website/src/__tests__/authCleanupServerGate.test.ts`
- `website/src/__tests__/vehicleAuthorityCleanup.test.ts`
- `docs/security/ARABAM_CEBIMDE_LOGOUT_CLEANUP_CONTRACT.md`
- `docs/DEVICE_VALIDATION_LEDGER.md`
- `docs/CAROS_PRO_VIZYONU.md`
- `docs/ARABAM_CEBIMDE_PWA_ROADMAP.md`

### Eklenen davranışlar

- `ServerSessionRevokeParticipant`, `SERVER_SESSION_REVOKE` fazına production
  composition içinde bağlandı.
- Prepare aşaması user ID ve yalnız bellekte tutulan access-token SHA-256
  fingerprint'i üretir; raw token/session payload ledger veya log yüzeyine
  taşınmaz. Revoke öncesi current identity yeniden okunur; Account A hazırlanıp
  Account B aktif olmuşsa B revoke edilmeden blocking mismatch üretilir.
- Browser singleton `signOut()` hedef otorite değildir. İzole server route,
  prepare sırasında yalnız bellekte tutulan A access tokenını Supabase
  `auth.admin.signOut(jwt, 'local')` çağrısına açık hedef olarak verir. Local
  A-session temizliği artık singleton `signOut()` çağırmaz. Prepare anında
  chunk adları + SHA-256 değer hash'lerinden bounded ownership snapshot alınır;
  local purge yalnız current user/token fingerprint ve bütün cookie chunk
  snapshot'ı hâlâ A ile birebir eşleşiyorsa exact-name siler. Account B veya
  belirsiz ownership hiçbir artifact silmeden blocking mismatch üretir.
- Topbar ve Sidebar tek `requestCanonicalLogout()` action'ını kullanır.
  Coordinator blocking/retryable sonuç verirse fallback `signOut`, paralel
  `resetOfflineState` veya navigation çalışmaz. Double-submit aynı promise/
  transaction'ı paylaşır. Eski `/api/auth/logout` doğrudan çağrısı 409
  `CANONICAL_CLEANUP_REQUIRED` ile bypass'ı reddeder.
- `useSessionUser` artık `resetOfflineState()` veya
  `retainOnlyAccountOfflineState()` çağırmaz. Same-account refresh ve initial
  hydration cleanup başlatmaz; Account A→B olayı B state'ini uygulamadan
  `requestCanonicalAccountTransition(A)` üzerinden aynı coordinator authority'sine
  gider. Lockdown içindeki SIGNED_OUT/recovery callback'i ikinci transaction
  oluşturmaz.
- Network ve timeout hataları retryable kalır; ledger recovery aynı revoke’u
  idempotent tekrarlar. Provider/config/storage ve hesap uyuşmazlığı blockingdir.
- `ServerSessionVerificationParticipant` her `clear/verifyEmpty` çağrısında
  singleton client, `isSingleton:false` fresh client, Supabase cookie chunk'ları
  ve pending auth operasyonlarını yeniden denetler; cached boolean kullanmaz.
- Recovery, ledger'da `VERIFY_EMPTY` tamamlanmış görünse bile completion öncesi
  bütün verifier'ları yeniden çalıştırır ve participant context'ini yeni aktif
  lockdown generation'ıyla hizalar.
- Ortak auth-operation guard; hook, Sidebar, login/register, reset-password,
  hash callback ve runtime hydration yazımlarına bağlandı. Cookie marker
  middleware ve server auth callback restore'unu cleanup sırasında reddeder.

### Testler

- Server-session gap/race testleri: 29/29 geçti.
- Auth callback entegrasyonu ve server marker kapıları: 8/8 geçti.
- Target-bound route + canonical logout/action/UI dar grubu: 3 dosya, 10/10 geçti.
- Ortak working tree tam website suite: 34 dosya, 704/704 geçti.
- `npx tsc --noEmit`: geçti.
- `git diff --check`: geçti.

### Bilinen sınırlar

- Supabase production/staging üzerinde gerçek refresh-token revoke ve browser
  restart sonrası restore reddi, gerçek iki sekmeli mutation lock ve process
  death ölçülmedi.
- Eski access-token JWT expiry’ye kadar korumalı endpoint tarafından kabul
  edilebilir; bu provider’ın açık sınırıdır.
- Auth cleanup için ayrı CAROS LAB salt-okunur gözlem yüzeyi henüz yoktur;
  özellik bu nedenle saha/ürün doğrulanmış sayılmaz.
- Push, PhoneHub, Mavi ve device binding revoke eksiktir.
- PWA-P1-007 ownership snapshot late-write, pending pairing old-store/
  credential late-write ve cross-account purge kararları bu görevde
  değiştirilmedi; açık kalır.

### Kabul kriterleri

- [x] Canonical Supabase cookie-session modeli repository ve SDK kaynağından kanıtlandı.
- [x] Current-session revoke ve verification participant’ları composition’a bağlı.
- [x] Immutable target token server primitive’ine bağlandı; post-check A→B
  bariyeri ve timeout sonrası late provider mutation B korunarak test edildi.
- [x] Topbar/Sidebar canonical coordinator action'ına bağlandı; blocking failure,
  double-submit, güvenli navigation ve doğrudan logout API bypass reddi test edildi.
- [x] Fresh-client/cookie/pending-operation doğrulaması ve recovery final
  reverify test edildi.
- [x] Same-process ve restart-benzeri recovery generation senaryoları test edildi.
- [x] Late auth callback reddi ve cleanup sonrası Account B kabulü gerçek hook
  callback entegrasyonuyla test edildi.
- [x] Dar regresyon ve tam Vitest suite geçti.
- [x] Repository-wide TypeScript ve `git diff --check` kapıları geçti.
- [ ] Gerçek Supabase/browser revoke ve process-death doğrulandı.
- [ ] CAROS LAB salt-okunur auth cleanup gözlemi eklendi.

### Commit

- Henüz commit edilmedi.

### Deploy

- Yapılmadı.

### Migration etkisi

- Yok; migration oluşturulmadı veya uygulanmadı.

### Gerçek cihaz doğrulaması

- Gerekli; yapılmadı. `docs/DEVICE_VALIDATION_LEDGER.md` #184.

### Sonraki atomik görev

- PWA-P1-008 gerçek staging Supabase + browser process-death doğrulaması.
  Bu gap-closure görevinde PWA-P1-009'a geçilmedi.

## Production güvenlik kapısı

`PRODUCTION_SECURITY_GATE: BLOCKED`

| Zorunlu kapı | Durum | Kanıt/not |
|---|---|---|
| API key localStorage'dan kaldırıldı | Açık | Hâlâ localStorage kullanılıyor |
| Tek authenticated pairing authority | Açık | `/api/pwa/pair` ve `/api/vehicle/link` paralel |
| Logout/account-switch atomik cleanup | Açık | Üretim wiring yok |
| Kritik komut server-side challenge | Açık | PIN hash varlığı yeterli olabiliyor |
| EXECUTED ve VERIFIED ayrımı | Açık | `completed` başarı diline dönüşüyor |
| Cross-tenant RLS testi | Açık | Migration/staging doğrulanmadı |
| Pairing abuse testi | Açık | Kanıt yok |
| Notification deep-link allowlist | Kısmi | SW aynı-origin dashboard allowlist kullanıyor; push token/topic account revoke ve client intent ownership doğrulaması eksik |
| Account-scoped secure persistence | Açık | localStorage parçalı persistence |
| Demo/production hard separation | Açık | Aynı çalışma yollarında fallback var |

## Bilinen engeller ve karar gerektiren noktalar

1. PWA-only secure storage ile ayrı native companion vault arasındaki ürün sınırı.
2. Standalone, login gerektirmeyen kullanımın korunup korunmayacağı.
3. Migration 033–036 için canonical migration history ve staging uygulama sırası.
4. Head-unit'in command ACK/EXECUTED/physical readback contract'ı.
5. PhoneHub identity ile Supabase vehicle identity eşleme otoritesi.
6. Production demo-mode kapatma mekanizması.
7. Gerçek cihaz/araç validation ortamı ve sorumlusu.

## Değişiklik günlüğü

### 2026-07-29 — PWA-P1-002 tamamlandı

- Bütün local/session/native/push/Mavi cleanup yüzeyleri sınıflandırıldı.
- Seçenek A kararlaştırıldı: durable marker ve local lockdown → local
  secret/private/queue purge → tracked server/device/push revoke → verify empty.
- `AccountCleanupCoordinator`, account namespace, boot gate ve bounded cleanup
  ledger canonical sözleşmeye alındı.
- Normal logout'ta PhoneHub device identity'nin korunması; shared cihazda trust
  karantinası; lost-device halinde revoke/delete kararlaştırıldı.
- Cleanup test matrisi ve `PWA-TEST-001` test altyapısı engeli kaydedildi.
- Sonraki görev `PWA-P1-003 — AccountCleanupCoordinator foundation` seçildi;
  `PWA-TEST-001` command/credential migration öncesi zorunlu ara gate'tir.
- Görev `COMPLETED`; cleanup implementasyonu yok, genel ilerleme `%0` ve
  production security gate `BLOCKED`.
- Kod/test davranışı değiştirilmedi; commit/push/deploy yapılmadı; migration
  uygulanmadı.

### 2026-07-29 — PWA-P1-001 tamamlandı

- Oturumsuz/authenticated pairing, pending offline pairing, Supabase session,
  API-key/authenticated command, fleet authority ve PhoneHub trust yolları
  satır kanıtlarıyla çıkarıldı.
- Credential yaşam döngüleri, mevcut ve hedef veri akışları ile tek-authority
  kararları `security/ARABAM_CEBIMDE_CREDENTIAL_AUTHORITY_INVENTORY.md` ekine
  kaydedildi.
- 10 güvenlik bulgusu ve migration öncesi pairing/credential/command
  sözleşmeleri oluşturuldu.
- Seçili testlerde 8/9 dosya ve 212 test geçti; `commandService.test.ts`
  mevcut hoisted-mock hatası nedeniyle import aşamasında başarısız oldu.
- Görev `COMPLETED` yapıldı; bu durum production güvenlik kapılarından hiçbirini
  kapatmaz ve genel paket kabul yüzdesini artırmaz.
- Aktif atomik görev `PWA-P1-002` olarak güncellendi.
- Kod davranışı değiştirilmedi; commit/push/deploy yapılmadı; migration
  uygulanmadı.

### 2026-07-29 — Canonical roadmap bootstrap

- Bu dosya tek Arabam Cebimde PWA roadmap otoritesi olarak oluşturuldu.
- Bağımsız audit bulguları P0–P10 paketlerine eşlendi.
- Tamamlanmış kabul kriteri kanıtı olmadığı için genel ilerleme `%0` başlatıldı.
- Mevcut foundation'lar korunacak altyapı olarak kaydedildi; tamamlanmış ürün
  özelliği sayılmadı.
- `PWA-P1-001` ilk aktif atomik görev olarak `ANALYZING` durumuna alındı.
- Kod davranışı değiştirilmedi.
- Test çalıştırılmadı.
- Commit/push/deploy yapılmadı.
- Migration uygulanmadı.
## PWA-P1-008 Final P1 Gap Closure — 2026-07-30

Durum: `TESTED_LOCAL` (staging/gerçek çoklu sekme/process-death yok).

- Supabase auth cookie compare+delete işlemi, kurulu auth-js'in kullandığı
  `lock:<storageKey>` Web Lock adı altında tek kritik bölüme alındı. Lock yoksa
  işlem cookie silmez ve fail-closed döner.
- Logout hedefi ilk `await` öncesinde immutable account ID + SHA-256 session
  fingerprint olarak yakalanır; runtime initialization sonrasında yeniden
  session seçilmez.
- Aktif cleanup artık reason, önceki hesap, hedef hesap ve fingerprint metadata'sı
  taşır. A→B sürerken A→C isteği aynı Promise'i yanlışlıkla paylaşmaz.
- Coordinator ledger/context hedef session fingerprint'ini yalnız hash olarak
  taşır; server-session participant prepare edilen session ile bunu doğrular.
- Kanıt: server-session `30/30`, auth writer/server gate `8/8`, targeted revoke
  route `3/3`, ortak website Vitest `730/730`, TypeScript PASS,
  `git diff --check` PASS.
- `PRODUCTION_SECURITY_GATE: BLOCKED`. Gerçek staging abort, iki sekme Web Locks,
  process-death/already-revoked provider davranışı ve önceki P1-007 açıkları
  doğrulanmadı. Logout dışındaki kapsam PWA-P1-009'a taşınmadı.
## PWA-P1-008 Final Security Architecture Closure — 2026-07-30

Durum: `TESTED_LOCAL`; `PRODUCTION_SECURITY_GATE: BLOCKED`.

## PWA-P1-008 Auth Storage Authority Closure — 2026-07-30

Durum: `TESTED_LOCAL`; `PRODUCTION_SECURITY_GATE: BLOCKED`.

- Uygulama kaynaklı password, signup, OAuth, OTP, `setSession` ve `updateUser`
  yazımları `canonicalAuthMutations.ts` içindeki tek authority üzerinden
  `withAuthSessionMutationLock` ile serialize edilir.
- Kilit adı gerçek Supabase auth cookie/storage prefix'inden türetilir; production
  ortamında Web Locks bulunmazsa mutation fail-closed olur.
- `signInAnonymously` repository'de kullanılmıyor; canonical wrapper dışında
  doğrudan session writer çağrılarını reddeden bounded source-inventory testi vardır.
- Gerçek `auth-js` `signInWithPassword` ve session döndüren `signUp` yolları fake
  HTTP provider ile çalıştırıldı; cleanup kilidi bırakılmadan cookie yazılmadığı
  doğrulandı. Singleton ve fresh client session-save işlemleri aynı authority
  altında serialize edildi.
- Auth-önce yarışında gerçek Account B cookie yazımı Account A snapshot'ını
  bozdu; cleanup `OWNERSHIP_MISMATCH` üretti ve B artifact'ını silmedi.
- Yeni suite `authStorageAuthority.test.ts`: 6/6 PASS. Website tam suite:
  37 dosya, 748/748 PASS. `npx tsc --noEmit` ve `git diff --check`: PASS.
- PKCE callback server-side session exchange/`Set-Cookie` otoritesi olmaktan
  çıkarıldı; code exchange browser canonical auth-mutation authority'ye taşındı.
  Protected-route middleware read-only auth client kullanır ve response cookie
  yenilemez. Gerçek iki-sekme ve ağ zamanlaması staging validation borcudur.
- Gerçek Chrome/WebView, iki sekme, staging HTTP ve process-death doğrulaması
  yapılmadı. Commit, push, deploy ve migration yapılmadı.
- PWA-P1-009'a geçilmedi.

- Production singleton ve fresh `createBrowserClient` örneklerine auth-js
  `LockFunc` sözleşmesiyle aynı canonical Web Locks adapter'ı enjekte edildi.
  Cleanup da aynı `lock:<storageKey>` authority'sini kullanır. Web Locks yoksa
  auth/cleanup lockless devam etmez.
- Cleanup ledger schema v2 oldu. Account hedefli v2 kayıt account hash +
  session fingerprint'i birlikte zorunlu taşır. Aktif fingerprint'siz v1 kayıt
  `LEGACY_TARGET_UNVERIFIABLE` olarak karantinaya alınır; participant çalışmaz,
  terminal success yazılmaz ve lockdown korunur.
- Cookie temizliği atomik transaction olarak sunulmaz. Her exact chunk öncesi
  kalan snapshot, her delete sonrasında kalan set tekrar doğrulanır.
  Kısmi mutation `SERVER_SESSION_COOKIE_PARTIAL_CLEANUP` ile blocking sonuçtur;
  sonraki farklı-account chunk'ı silinmez.
- Host kanıtı: lock wiring/sıralama, ters sıralama, lock yokluğu, v1 A1→A2 ve
  A→B quarantine, ikinci chunk hatası ve chunk-arası B replacement testleri.
  Gerçek staging/browser/multi-tab/process-death kanıtı hâlâ yoktur.
