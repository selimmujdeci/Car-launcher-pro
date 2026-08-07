# Arabam Cebimde — Logout ve Account-Switch Cleanup Contract

**Görev:** `PWA-P1-002`  
**Tarih:** 2026-07-29  
**Branch:** `feat/caros-lab-phase-a1`  
**HEAD:** `f89540c3b332cf0bfea897d8d22a1c2103f26889`  
**Canonical roadmap:** [`../ARABAM_CEBIMDE_PWA_ROADMAP.md`](../ARABAM_CEBIMDE_PWA_ROADMAP.md)  
**Authority envanteri:** [`ARABAM_CEBIMDE_CREDENTIAL_AUTHORITY_INVENTORY.md`](ARABAM_CEBIMDE_CREDENTIAL_AUTHORITY_INVENTORY.md)  
**Kapsam:** Tasarım ve test sözleşmesi; production cleanup implementasyonu yok.

## 1. Güvenlik invarianti

Bir session sona erdiğinde veya aktif hesap değiştiğinde önceki hesaba ait
credential, authority, private data veya pending operation:

- ekranda gösterilemez,
- browser/native API tarafından okunamaz,
- remote command için kullanılamaz,
- queue üzerinden senkronize edilemez,
- pairing'e devam edemez,
- push deep-link veya Mavi context'i üzerinden yeniden etkinleşemez.

Bu koşul kanıtlanamıyorsa dashboard ve command yüzeyleri mount edilmez.

## 2. Repository'deki mevcut durum

Mevcut logout yalnız server-side Supabase `signOut` çağırır; UI hemen login'e
yönlenir:

- `website/src/app/api/auth/logout/route.ts:4-9`
- `website/src/components/layout/Topbar.tsx:31-34`
- `website/src/components/layout/Sidebar.tsx:137-140`

Yerel araç credential'ını silen ayrı helper vardır, fakat logout'a bağlı
değildir:

- `website/src/lib/pairingService.ts:57-61`

Vehicle store auth olmadan local credential yükler ve Supabase/RLS boş
döndüğünde eski local aracı bilinçli olarak korur:

- `website/src/store/vehicleStore.ts:50,73-98,102-107`
- `website/src/hooks/useRealtime.ts:39-43`

Session listener yalnız user ID state'ini değiştirir; global cleanup coordinator
değildir:

- `website/src/hooks/useSessionUser.ts:28-39`

Bu kanıtlar, server sign-out'ın tek başına güvenli logout olmadığını ve local
lockdown'ın ilk adım olması gerektiğini gösterir.

## 3. Cleanup envanteri

Durum hücreleri mevcut davranışı gösterir: `VAR`, `YOK`, `KISMİ` veya
`DOĞRULANMADI`.

| Cleanup ID | Veri/Credential | Sınıf | Kaynak dosya | Storage | Account-scoped mı | Logout | Account switch | Session expiry | Lost phone | Temizleme yöntemi | Başarısızlık davranışı |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CLN-001 | Supabase access/refresh session | `SECRET` | `supabaseBrowser.ts`, `supabaseServer.ts` | SSR cookie/SDK | Evet | VAR: yalnız signOut | YOK | SDK davranışı; app cleanup YOK | Remote revoke DOĞRULANMADI | Server `signOut` + cookie verify | Session şüpheliyse AUTH_REQUIRED; command kapalı |
| CLN-002 | Vehicle API key | `SECRET` | `pairingService.ts:2-7,33-38` | localStorage | Hayır; tek global key | YOK | YOK | YOK | YOK | Exact key purge; sonraki migration'da server revoke | Purge doğrulanana kadar blocking lockdown |
| CLN-003 | Client PIN hash | `SECRET` | `criticalAuth.ts:4-15` | localStorage | Hayır | YOK | YOK | YOK | YOK | Exact key purge | Command kapalı; SECURITY_RESET_REQUIRED |
| CLN-004 | Vehicle identity/name/plate | `AUTHORITY` | `pairingService.ts:2-7`, `vehicleStore.ts:38-42` | localStorage + Zustand memory | Hayır | KISMİ helper, logout wiring YOK | YOK | YOK | YOK | Exact keys + in-memory reset | Eski araç render edilmez |
| CLN-005 | Selected vehicle | `AUTHORITY` | `kumanda/page.tsx:44-46`, dashboard component state | Derived/component memory | Hayır | YOK | YOK | YOK | YOK | Store/component invalidation; canonical repository sonra | Dashboard mount edilmez |
| CLN-006 | Vehicle list/live store | `PRIVATE_DATA` | `vehicleStore.ts:46-69` | Zustand memory | Hayır | YOK | YOK | YOK | YOK | Atomic store reset, timers/listeners stop | LOCAL_LOCKDOWN view |
| CLN-007 | Realtime subscriptions/render throttle | `OPERATIONAL_CACHE` | `useRealtime.ts:39-81`, `realtimeEngine.ts` | Memory/channels/module map | Hayır | Component cleanup kısmi | Race doğrulanmadı | Race doğrulanmadı | Uygulanamaz | Unsubscribe, generation invalidate, throttle map clear | Late events drop edilir |
| CLN-008 | Ownership snapshot | `AUTHORITY` | `ownershipSnapshot.ts:114-159` | user-keyed localStorage | Evet | clear helper var, wiring YOK | YOK | TTL var | YOK | Previous-account exact namespace purge | Snapshot okunamaz; boot mismatch |
| CLN-009 | Fleet/company/role state | `AUTHORITY` | `useFleet.ts:66-86,88-157` | React memory + snapshot | Evet | YOK | Hook user değişimi kısmi | Snapshot fallback | YOK | Hook reset + snapshot purge | Capability false/empty |
| CLN-010 | Offline fleet mutation queue | `AUTHORITY` | `domainQueue.ts`, `storage.ts`, `useFleet.ts` | account-keyed localStorage | Evet | clear API var, wiring YOK | Namespace var | Devam eder | YOK | Queue stop, exact namespace purge/quarantine | Asla başka account ile drain edilmez |
| CLN-011 | Retry/conflict/dead-letter metadata | `OPERATIONAL_CACHE` | `offline/types.ts`, `domainQueue.ts` | Queue record içinde | Evet | YOK | Namespace var | Kalıcı | YOK | Queue ile aynı purge | Sync engellenir |
| CLN-012 | Pending pairing | `AUTHORITY` | `offlinePairing.ts:139-245`, `PairingScreen.tsx:187-199` | encrypted localStorage | Kısmi; `null` olabilir | all-clear helper var, wiring YOK | YOK | TTL var | YOK | Account + anonymous pending purge | Pairing resume edilmez |
| CLN-013 | Pairing cipher material | `SECRET` | `offlinePairing.ts:65-137` | Derived/runtime + encrypted payload | Scope tasarımı yetersiz | YOK | YOK | YOK | YOK | Crypto context destroy + encrypted record purge | Decrypt/sync yasak |
| CLN-014 | Parking location | `PRIVATE_DATA` | `VehicleMapView.tsx:15-29` | global localStorage | Hayır | YOK | YOK | YOK | YOK | Exact key purge | Konum gösterilmez |
| CLN-015 | Telemetry/location last-known | `PRIVATE_DATA` | `vehicleStore.ts:80-97,142-159` | Memory; local vehicle projection | Hayır | YOK | YOK | YOK | YOK | Vehicle store reset | Stale değer render edilmez |
| CLN-016 | Fuel records | `PRIVATE_DATA` | `RecordsPanel.tsx:18-28` | global localStorage | Hayır | YOK | YOK | YOK | YOK | Exact key purge | Kayıtlar görünmez |
| CLN-017 | Maintenance/service record | `PRIVATE_DATA` | `RecordsPanel.tsx:43-67` | global localStorage | Hayır | YOK | YOK | YOK | YOK | Exact key purge | Kayıt görünmez |
| CLN-018 | DTC/read result | `PRIVATE_DATA` | `DiagnosticsPanel.tsx` | Component memory/API response | Hayır | Component unmount | Race doğrulanmadı | YOK | YOK | Abort request + state reset | Late response discard |
| CLN-019 | Command UI state/status listener | `AUTHORITY` | `useCommandTracker.ts`, `commandService.ts:230+` | Component memory + realtime | Hayır | Component unmount kısmi | Race doğrulanmadı | YOK | YOK | Lock dispatch, unsubscribe, generation invalidate | Pending command yeni account'a taşınmaz |
| CLN-020 | Server command history/queue | `PRIVATE_DATA` | `vehicle_commands` migrations | Supabase DB | Account/vehicle ilişkili | Silinmez; erişim revoke gerekir | RLS ile ayrılmalı | RLS | Device revoke gerekir | Local değil; server auth/RLS revoke | Yeni account okuyamaz/işletemez |
| CLN-021 | Speed alert | `PRIVATE_DATA` | `MobileCarControl.tsx:596-617` | global localStorage | Hayır | YOK | YOK | YOK | YOK | Exact key purge veya account namespace | Eski alert kullanılmaz |
| CLN-022 | Geofence events/settings | `PRIVATE_DATA` | `GeofenceAlertsPanel.tsx`, Supabase geofence | Component/DB | Vehicle/account | Component unmount | RLS beklenir | RLS | Revoke gerekir | Memory clear + server access revoke | Eski event gösterilmez |
| CLN-023 | Push subscription record | `AUTHORITY` | `pushEngine.ts:26,63-88` | Supabase veya localStorage fallback | Kullanıcıyla ilişkilendirilmeye çalışılır | unregister API var, logout wiring YOK | YOK | YOK | Server revoke DOĞRULANMADI | Local disable + tracked server unsubscribe | Push UI/context quarantine |
| CLN-024 | Browser PushSubscription/device token | `AUTHORITY` | `pushEngine.ts` | Browser push service | Device + server association | YOK | YOK | YOK | YOK | Browser unsubscribe + server token revoke | Pending revoke ledger |
| CLN-025 | In-app notification/unread state | `PRIVATE_DATA` | `notificationStore.ts` | Zustand memory | Hayır | YOK | YOK | YOK | YOK | Store reset | Badge/notification list empty |
| CLN-026 | Notification deep-link context | `AUTHORITY` | `public/sw.js:40-88` | Notification payload/SW | Hayır | YOK | YOK | YOK | YOK | Close account-tagged notifications; route gate | Deep-link dashboard açamaz |
| CLN-027 | Theme preference | `USER_PREFERENCE` | `ThemeToggle.tsx:8-31`, PWA page | localStorage | Cihaz tercihi olabilir | Korunabilir | Korunabilir | Korunabilir | Security reset politikasına göre | Ayrı device namespace | Hassas değil |
| CLN-028 | Theme Studio vehicle config | `PRIVATE_DATA` | `ThemeStudio.tsx:62-73` | global localStorage | Hayır | YOK | YOK | YOK | YOK | Purge; ileride account/vehicle namespace | Eski vehicle config gösterilmez |
| CLN-029 | Mavi conversation/vehicle/action context | `PRIVATE_DATA`/`AUTHORITY` | PWA'da canonical store bulunmadı | UNKNOWN | UNKNOWN | YOK | YOK | YOK | YOK | Gelecek registry'nin mandatory reset port'u | Mavi mount/action kapalı |
| CLN-030 | Mavi voice/transcript/evidence caches | `PRIVATE_DATA` | PWA entegrasyonu yok | UNKNOWN | UNKNOWN | YOK | YOK | YOK | YOK | Future cleanup participant | Veri yokluğu doğrulanmadan start yok |
| CLN-031 | PhoneHub private identity | `SECRET` | `CompanionIdentitySigner.kt:29-39,113-144` | AndroidKeyStore | Device-scoped | Normal logout'ta silinmez kararı | Shared mode policy | Session'dan bağımsız | Security reset'te delete | Native bridge/server revoke orchestration | Cloud command binding kaldırılır |
| CLN-032 | PhoneHub peer fingerprint | `AUTHORITY` | `CompanionTrustStore.kt:26-102` | SharedPreferences | Device/peer | Personal logout'ta karantina/binding detach | Shared device'ta karantina | Session'dan bağımsız | Forget/revoke | Native trust quarantine/forget | PhoneHub app messages kapalı |
| CLN-033 | PhoneHub live session keys | `SECRET` | `LinkSession.java` | Process memory | Connection-scoped | Link close | Link close | Cloud session event ile close | Link close | Native session dispose | Trafik durur |
| CLN-034 | Service worker app cache | `PUBLIC_CACHE` | `public/sw.js:10` | Yok; SW stateless | Hayır | N/A | N/A | N/A | N/A | Gelecekte account-private response cache yasak | Private cache bulunursa blocking |
| CLN-035 | Browser Cache Storage/IndexedDB/sessionStorage | `OPERATIONAL_CACHE` | Aktif PWA uygulamasında kullanım bulunmadı | Şu an doğrulanmış private store yok | UNKNOWN | N/A | N/A | N/A | N/A | VERIFY_EMPTY discovery taraması; future registry | Beklenmeyen private store → STORAGE_CORRUPTED |
| CLN-036 | Cleanup ledger/marker | `OPERATIONAL_CACHE` | Bu sözleşmeyle öneriliyor | local persistent metadata | Account hash/reason | Korunur, bounded | Korunur | Korunur | Audit retention | Coordinator yönetir | Boot gate recovery |

## 4. Cleanup seviyeleri

### LEVEL 1 — Session Logout

Normal kullanıcı çıkışı:

1. Hemen local authority lockdown.
2. Secret, authority ve private account data purge.
3. Queue/pending operation stop ve purge.
4. Supabase session revoke.
5. Push association revoke.
6. Empty verification.
7. Device preferences yalnız allowlist ile korunur.

PhoneHub device identity korunur; cloud remote-control binding ayrılır ve
PhoneHub session en azından command yetkisi bakımından karantinaya alınır.

### LEVEL 2 — Account Switch

LEVEL 1'in bütün adımları zorunludur. Ek kurallar:

- B login/session activation, A `VERIFY_EMPTY` tamamlanmadan kabul edilmez.
- A queue'su B credential/session ile hiçbir zaman drain edilmez.
- B namespace ve encryption context cleanup coordinator tarafından ancak
  `COMPLETED` sonrasında aktive edilir.
- A tekrar login olursa server'dan yeniden authority kurulur; eski local
  namespace otomatik canlandırılmaz.

### LEVEL 3 — Security Reset / Lost Phone

LEVEL 1+2'ye ek olarak:

- Bütün Supabase device/session'ları revoke.
- Account↔device↔vehicle binding revoke.
- Remote-control machine credential rotation.
- Push token/subscription server revoke.
- PhoneHub trust forget ve private identity delete/recreate.
- Bütün local private data wipe.
- Security audit event.
- Yeniden login, device binding ve pairing zorunlu.

Network yoksa cihaz tarafı LOCAL_LOCKDOWN ve wipe tamamlanır; server revoke
başka güvenilir cihaz/server kanalından talep edilir. Kayıp cihazın kendisindeki
offline ledger tek başına lost-phone çözümü değildir.

## 5. Canonical coordinator kararı

Canonical authority, PWA application boot katmanında tek
`AccountCleanupCoordinator` olacaktır. UI, auth listener, session expiry,
account switch, push veya Mavi doğrudan storage silmez; coordinator'a typed
reason ile istek verir.

Coordinator:

- tek aktif cleanup generation'ı tutar,
- bütün participant'ları kayıtlı portlardan çağırır,
- command/realtime/push/Mavi için synchronous lockdown sinyali üretir,
- persistent ledger/marker ile process-death recovery sağlar,
- yeni account activation'a tek izin veren authority'dir.

Server-side `/api/auth/logout` yalnız bir participant'tır; coordinator değildir.
Native PhoneHub ayrı participant/bridge'tir.

Önerilen arayüz:

```ts
type CleanupReason =
  | "logout"
  | "account_switch"
  | "session_expired"
  | "session_revoked"
  | "lost_device"
  | "security_reset";

type CleanupParticipant = {
  id: string;
  classes: Array<
    "SECRET" | "AUTHORITY" | "PRIVATE_DATA" | "OPERATIONAL_CACHE"
  >;
  lockdown(generation: string): void;
  purge(context: CleanupContext): Promise<void>;
  verifyEmpty(context: CleanupContext): Promise<VerifyResult>;
};
```

## 6. Cleanup durum makinesi

```text
IDLE
  ↓
REQUESTED
  ↓  ledger marker durable
LOCAL_LOCKDOWN
  ↓  synchronous: command/UI/realtime/Mavi generation invalidated
LOCAL_SECRET_PURGE
  ↓
LOCAL_PRIVATE_DATA_PURGE
  ↓
QUEUE_AND_SNAPSHOT_PURGE
  ↓
SERVER_SESSION_REVOKE
  ↓
DEVICE_AND_PUSH_REVOKE
  ↓
VERIFY_EMPTY
  ↓
COMPLETED
```

Hatalar:

```text
FAILED_RETRYABLE
FAILED_BLOCKING
PARTIAL_CLEANUP
RECOVERY_REQUIRED
```

Kurallar:

- `REQUESTED` marker durable olmadan purge başlamaz.
- `LOCAL_LOCKDOWN` senkrondur; ilk await'ten önce command dispatch ve eski
  state render'ını keser.
- Her adım idempotenttir; “key yok” başarıdır.
- Participant late async response'ları cleanup generation mismatch ile atar.
- Process kill sonrası boot, son tamamlanan adımdan tekrar başlar.
- Her retry bütün gerekli earlier invariants'i yeniden doğrular.
- Kullanıcıya `COMPLETED` öncesi “çıkış tamamlandı” denmez.
- `VERIFY_EMPTY` yalnız helper dönüşüne güvenmez; storage ve memory registry
  üzerinde gerçek negatif kontroller yapar.

## 7. Ordering kararı

**Seçim: Seçenek A**

```text
Local lockdown
→ Local secret/private cleanup
→ Queue/snapshot cleanup
→ Server session revoke
→ Device/push revoke
→ Verification
```

Gerekçe:

- Ağ yokken server sign-out beklenirse local API key kullanılabilir kalır.
- Mevcut vehicleStore local credential'ı auth olmadan yükler.
- Supabase boş liste eski local aracı silmez.
- Server sign-out listener'ı ile UI redirect yarışı local cleanup'ı garanti
  etmez.
- Local lockdown ilk adım olduğunda sign-out başarısız olsa bile eski session
  PWA içinde command üretemez.
- Server revoke best-effort değildir: ledger'da takip edilen zorunlu iştir.

Hata politikası:

| Hata | Davranış |
|---|---|
| Server sign-out ağ hatası | Local logout sürer; ledger `FAILED_RETRYABLE`; AUTH_REQUIRED ekranı, command kapalı; revoke sonraki ağda devam |
| Local secret purge hatası | `FAILED_BLOCKING`; dashboard/login-as-new-account kapalı; SECURITY_RESET_REQUIRED |
| Private cache purge hatası | `PARTIAL_CLEANUP`; eski state mount edilmez; recovery/wipe |
| Process death | Marker nedeniyle boot `CLEANUP_RECOVERY_REQUIRED` |
| Session listener late event | Cleanup generation daha yüksekse event account activate edemez |
| Realtime late update | Generation mismatch ile drop |
| Queue drain yarışı | Lockdown queue scheduler'ı önce durdurur |

## 8. Namespace sözleşmesi

Canonical format:

```text
caros:<environment>:acct:<accountHash>:<domain>:v<schemaVersion>
caros:<environment>:anon:<installationId>:<domain>:v<schemaVersion>
```

Kurallar:

1. Private production namespace'te `userId:null`, `undefined`, boş string veya
   raw email kullanılamaz.
2. `accountHash`, server user ID'nin environment-scoped, one-way türevidir;
   authorization girdisi değildir.
3. Anonymous namespace yalnız TTL'li, remote authority vermeyen pending claim
   ve public preference tutabilir.
4. Queue item `accountId/accountHash`, `vehicleId`, schema version ve
   idempotency key taşımadan işlenmez.
5. Ownership snapshot payload account identity ile doğrulanır.
6. Eski schema namespace'i explicit migration allowlist'inde değilse purge edilir.
7. Active namespace yalnız coordinator boot gate tarafından set edilir.

### Senaryo kararları

| Senaryo | Karar |
|---|---|
| User A logout | A namespace purge/crypto destroy; server revoke ledger; anonymous safe gate |
| User B login | A cleanup `COMPLETED` olmadan B activate edilmez |
| User A tekrar login | Yeni namespace context; server'dan yeniden hydrate |
| Session expiry | `session_expired` cleanup; local lockdown; AUTH_REQUIRED |
| Offline logout | Local purge tamamlanır; server revoke pending; command kapalı |
| Anonymous pairing | `anon:<installationId>`; 60 sn TTL; authority/vehicle secret yok |
| Mid-cleanup process death | Durable marker; boot recovery; dashboard mount yok |
| App update/eski namespace | Schema migration allowlist veya purge |
| Corrupted storage | Parse edilmez; quarantine/purge; `STORAGE_CORRUPTED` |
| Missing accountId | Authenticated private operation reddedilir |
| Mismatched accountId | `NAMESPACE_MISMATCH`; security cleanup |

## 9. Boot security gate

Dashboard, realtime, remote command, queue scheduler, push deep-link consumer ve
Mavi mount edilmeden önce `AccountBootSecurityGate` çalışır.

Kontroller:

- Cleanup marker/ledger incomplete mı?
- Partial/blocking failure var mı?
- Session account ile active namespace eşleşiyor mu?
- Selected vehicle aktif account'ın verified ownership snapshot'ında mı?
- Queue item'larının tamamı aktif account ve vehicle scope'unda mı?
- Yasak localStorage secret key'leri var mı?
- Pending pairing account/anonymous policy ve TTL'e uygun mu?
- Encryption context açılabilir ve doğru account'a mı ait?
- PhoneHub binding account/vehicle ownership version'ıyla eşleşiyor mu?
- Beklenmeyen Cache Storage/IndexedDB/private namespace var mı?

Sonuçlar:

| Sonuç | UI/işlem |
|---|---|
| `SAFE_TO_START` | İlgili account yüzeyleri mount edilebilir |
| `AUTH_REQUIRED` | Login; local vehicle/cache gösterilmez |
| `CLEANUP_RECOVERY_REQUIRED` | Güvenli recovery ekranı; yalnız retry/reset |
| `NAMESPACE_MISMATCH` | Lockdown + security cleanup |
| `SECURITY_RESET_REQUIRED` | Full local wipe/re-pair akışı |
| `STORAGE_CORRUPTED` | Quarantine, bounded recovery veya wipe |

Boot gate “loading” ekranı değildir; güvenlik authority'sidir. Safe sonucu
olmadan child component mount edilmez.

## 10. Cleanup hata ledger'ı

```ts
type CleanupLedgerEntry = {
  cleanupId: string;
  requestedAt: number;
  reason:
    | "logout"
    | "account_switch"
    | "session_expired"
    | "session_revoked"
    | "lost_device"
    | "security_reset";
  previousAccountHash?: string;
  state: string;
  completedSteps: string[];
  failedStep?: string;
  failureCode?: string;
  retryCount: number;
  lastAttemptAt: number;
  completedAt?: number;
  schemaVersion: number;
};
```

Ek sözleşme:

- Raw user ID, vehicle ID, token, storage payload veya error stack yazılmaz.
- En fazla 20 kayıt; blocking/incomplete marker ayrı tek current record.
- Retry maksimum 10 otomatik deneme, exponential bounded backoff; kullanıcı
  retry ayrıca mümkündür.
- Completed kayıtlar en fazla 7 gün tutulur; security audit server'a
  gönderilmişse local kopya daha erken silinebilir.
- `FAILED_BLOCKING`, `PARTIAL_CLEANUP` ve `RECOVERY_REQUIRED` boot gate'i bloke eder.
- Ledger private data cleanup'tan sonra da recovery için kalır; yalnız
  non-secret operational metadata içerir.

## 11. PhoneHub ve native sınırı

Kimlikler ayrıdır:

| Kavram | Authority | Normal logout |
|---|---|---|
| Device identity | Android Keystore key | Silinmez |
| User identity | Supabase session | Revoke edilir |
| Vehicle ownership | Server RPC/RLS | Local cache kaldırılır; ownership DB geçmişi silinmez |
| Peer trust | Fingerprint trust store | Moda göre korunur/karantina |
| Session trust | Live encrypted PhoneHub session | Command capability kapanır; shared/security reset'te close |
| Remote-control authorization | Server ownership + future device binding | Her logout'ta kaldırılır |

### Personal Device

- Normal logout Android Keystore identity'yi silmez.
- Peer fingerprint korunabilir, ancak cloud account binding detach edilir ve
  tekrar login/ownership verification olmadan remote-control kullanılamaz.
- Live PhoneHub telemetry'nin login ekranına sızması engellenir.

### Shared Device

- Account switch'te peer trust aktif kullanımdan karantinaya alınır.
- Live PhoneHub session kapatılır.
- Yeni account aynı vehicle ownership'i ve device binding'i kanıtlamadan trust
  reuse edemez.

### Lost or Compromised Device

- Server device binding ve bütün sessions revoke.
- Push token revoke.
- Remote credential rotate.
- Erişilebilen cihazda trust forget + identity delete; erişilemiyorsa server
  fingerprint denylist/ownership version değişimi gerekir.
- Yeniden pairing zorunlu.

Repository'de cloud ownership↔PhoneHub fingerprint binding bulunmadığı için
bu orchestration implementasyonu sonraki görevlerde tasarlanmalıdır.

## 12. Push cleanup

| Veri | LEVEL 1 | LEVEL 2 | LEVEL 3 |
|---|---|---|---|
| In-app notification/unread | Memory reset | Reset before B | Wipe |
| Vehicle/company topic | Server unlink | A unlink tamamlanmadan B subscribe yok | Revoke all |
| Browser PushSubscription | Tercihe göre korunabilir ama account association kaldırılır | Token rebind yalnız server ACK sonrası | Browser unsubscribe |
| Local subscription fallback | Purge | Purge | Purge |
| Preferences | Account-scoped olan purge; device-only allowlist | B yeniden hydrate | Wipe |
| Displayed notifications | A account tag ile close | Close before B | Close all |
| Deep-link context | Invalidate generation | A context reddedilir | Clear |

Ağ yoksa `push_revoke` ledger participant'ı `FAILED_RETRYABLE` kalır. Local
subscription context hemen karantinaya alınır; push event gelse dahi active
account/event binding doğrulanmadan gösterilmez veya deep-link edilmez.

Kanıt:

- Push local fallback: `website/src/lib/pushEngine.ts:26,63-88`.
- SW URL/context: `website/public/sw.js:40-88`.

## 13. Mavi cleanup

PWA'da canonical Mavi store henüz bulunmadığından her gelecek Mavi modülü
mandatory cleanup participant olmak zorundadır.

Logout/account switch'te purge:

- Conversation history
- Selected vehicle/context
- Pending action ve confirmation token
- Tool result/evidence cache
- Draft command intent
- Voice session ve local transcript
- User-specific memory/preferences

Korunabilir:

- Yalnız account bağımsız dil, ses erişilebilirlik ve tema tercihi; explicit
  device-preference allowlist'inde olmalıdır.

Fail-closed:

- Mavi cleanup participant kayıtlı/verified değilse Mavi mount edilmez.
- Late tool/voice result generation mismatch ile atılır.
- Pending critical action cleanup başında iptal edilir.

## 14. VERIFY_EMPTY sözleşmesi

Verification aşağıdakilerin tümünü kontrol eder:

1. Yasak exact localStorage key'leri (`caros_pair_api_key`,
   `caros_critical_pin_hash` vb.) yok.
2. Previous account namespace prefix'i yok.
3. Vehicle/fleet/notification/Mavi in-memory store'ları empty/locked.
4. Realtime ve command subscriptions previous generation için kapalı.
5. Queue scheduler previous account için stopped ve storage empty/quarantined.
6. Pending pairing previous account/invalid anon namespace'te yok.
7. Browser session account beklenen sonuçla eşleşiyor.
8. Cache Storage/IndexedDB registry'de account-private entry yok.
9. Push local association previous account'a bağlı değil.
10. Native bridge previous account için remote-control capability bildirmiyor.

Bir participant verification sağlayamıyorsa “başarılı varsayılmaz”;
`FAILED_BLOCKING` veya açıkça tanımlı `UNKNOWN_PARTICIPANT` üretir.

## 15. Test matrisi

### Unit

- Adımların tam ordering'i.
- İlk await öncesi synchronous lockdown.
- Aynı cleanup ID ve farklı duplicate request idempotency.
- Exact secret purge.
- Account namespace purge; device preference preserve allowlist.
- Queue/retry/conflict/dead-letter purge.
- `verifyEmpty` pozitif ve negatif sonuçları.
- Her participant adımında partial failure.
- Bounded retry ve terminal blocking.
- Marker recovery.
- Session/namespace mismatch.
- `null`, empty, malformed account ID rejection.
- Late realtime/command/Mavi generation drop.

### Integration

- A login → pair → logout → B login.
- A offline queue → logout → B login; A item B ile sync olmaz.
- Logout sırasında ağ kesilmesi.
- Her state'te process kill ve restart.
- Açık dashboard'da session expiry/revoke.
- Revoked token ve eski API key ile remote command.
- Pending pairing sırasında logout.
- Push unsubscribe ağ yokken ledger recovery.
- Mavi pending command sırasında logout.
- Corrupt localStorage/IndexedDB.
- Stale SW/private response cache.
- Logout ile realtime update yarışı.

### Security

- Eski API key replay.
- Eski queue replay.
- Selected vehicle injection.
- Cross-account prefix enumeration/read.
- PIN hash reuse.
- Eski notification deep-link context.
- A logout/B login race.
- Paralel çoklu logout request.
- Logout sırasında auth state listener re-entry.
- Storage purge failure sonrası dashboard bypass denemesi.
- PhoneHub trusted peer ile cloud binding mismatch.

### Real device

- Android process kill/browser force-stop.
- Offline logout ve sonradan network recovery.
- Shared-device A→B switch.
- Logout sonrası push.
- PWA reinstall.
- OS backup/storage restore.
- PhoneHub live session sırasında logout/switch.
- Lost-device server revoke sonrası eski cihazın command denemesi.

Gerçek araç doğrulaması cleanup contract görevi için gerekli değildir; command
revoke ve PhoneHub binding implementasyonu sonrasında gerekecektir.

## 16. commandService test altyapısı engeli

PWA-P1-001'de:

- `commandService.test.ts` import aşamasında başarısız oldu.
- `vi.mock` factory hoisting nedeniyle `mockSupabase` initialization öncesi
  okunuyor.
- 0 command service testi çalıştı.
- Bu dosya production command davranışını kanıtlamıyor.

Cleanup coordinator foundation, commandService'in iç implementasyonunu
değiştirmeden ve participant interface testleriyle başlayabilir. Ancak
credential/command migration olan PWA-P1-003 ve PWA-P2 çalışmalarından önce
command authorization regression gate'i çalışır hale gelmelidir.

Önerilen ayrı küçük görev:

`PWA-TEST-001 — commandService Vitest hoisting repair`

## 17. Zorunlu tasarım kararları

| # | Karar | Sonuç |
|---:|---|---|
| 1 | Canonical coordinator | PWA boot/application katmanında tek `AccountCleanupCoordinator` |
| 2 | Cleanup sırası | Durable marker → local lockdown → local secret/private/queue purge → server revoke → device/push revoke → verify |
| 3 | Supabase signOut | Local purge ve queue stop sonrasında, tracked mandatory server step |
| 4 | Yeni login | Cleanup `COMPLETED` olmadan account activation yok |
| 5 | `userId:null` | Authenticated private namespace'te yasak; yalnız TTL'li authority vermeyen anon claim |
| 6 | Offline logout | Local logout tamamlanır; server revoke ledger pending; command/dashboard kapalı |
| 7 | Process death | Durable ledger/marker; boot recovery kaldığı yerden/idempotent tekrar |
| 8 | PhoneHub identity | Normal personal logout'ta silinmez; cloud binding detach. Shared'da trust quarantine; lost-device'ta delete/revoke |
| 9 | Push offline revoke | Local quarantine + bounded persistent pending revoke |
| 10 | Verify storage | localStorage, memory stores, subscriptions, registered IDB/Cache, SW/push ve native capability |
| 11 | Partial cleanup UI | `CLEANUP_RECOVERY_REQUIRED`/`SECURITY_RESET_REQUIRED`; dashboard ve command mount yok |
| 12 | Account switch API | Aynı coordinator, `reason=account_switch`; ayrı bypass API yok |

### UNKNOWN kalan noktalar

- Supabase'in deployment cookie flag değerleri: canlı response/header kanıtı
  gerekir.
- Global/per-device session revoke API politikası: backend auth yönetim
  sözleşmesi gerekir.
- PhoneHub server denylist/binding endpoint'i: repository'de yok.
- Push provider token invalidation semantics: canlı provider/backend kanıtı gerekir.
- PWA gelecekte IndexedDB/Cache Storage kullanırsa registry uygulaması:
  implementasyon tasarımı gerekir.

## 18. Sonraki görev kararı

**Seçim: `PWA-P1-003 — AccountCleanupCoordinator foundation`.**

Gerekçe:

- Coordinator foundation commandService mock'una bağlı değildir.
- İlk foundation işi state machine, ledger, participant registry ve boot
  lockdown contract'ını ayrı saf birimlerle kurabilir.
- Davranışsal credential/command migration'a henüz girmez.
- `PWA-TEST-001` zorunlu ara gate olarak PWA-P1-003 tamamlandıktan hemen sonra,
  command authorization veya credential migration başlamadan çalışılmalıdır.

Önerilen sıra:

```text
PWA-P1-003 AccountCleanupCoordinator foundation
→ PWA-TEST-001 commandService Vitest hoisting repair
→ cleanup participant wiring / credential migration
```

## 19. Görev durumu

`PWA-P1-002: COMPLETED`

Bu yalnız cleanup contract ve test tasarımının tamamlandığı anlamına gelir.
Cleanup implementasyonu yoktur; production security gate blokludur.

Kod değiştirilmedi. Test expectation değiştirilmedi. Commit/push/deploy
yapılmadı. Migration uygulanmadı.

## 20. PWA-P1-003 implementation note — 2026-07-29

Sözleşmenin foundation katmanı aşağıdaki modüllerle uygulandı:

- `website/src/security/accountCleanup/AccountCleanupCoordinator.ts`
- `website/src/security/accountCleanup/cleanupStateMachine.ts`
- `website/src/security/accountCleanup/cleanupLedger.ts`
- `website/src/security/accountCleanup/cleanupParticipantRegistry.ts`
- `website/src/security/accountCleanup/cleanupLockdown.ts`
- `website/src/security/accountCleanup/cleanupBootGate.ts`

Uygulama sözleşmenin ordering kararını korur: cleanup request ile senkron local
lockdown/generation artışı başlar; durable `REQUESTED` marker yazılır; fazlar
deterministic ve sequential çalışır; `VERIFY_EMPTY` tamamlanmadan `COMPLETED`
üretilemez. Ledger yalnız secret içermeyen metadata kabul eder; parse veya schema
hatası fail-closed sonuçtur.

Foundation bilinçli olarak production composition root'a, mevcut logout
çağrısına veya dashboard boot'una bağlanmadı. Bunun nedeni gerçek
store/credential/queue participant'larının henüz bulunmaması ve placeholder
başarıyla logout'u tamamlanmış gösterme riskidir. Registry her cleanup fazında
participant ve `VERIFY_EMPTY` verifier bulunmadığında blocking failure üretir.
No-op server revoke participant production path'ına eklenmedi.

Foundation boot gate yalnız cleanup marker, ledger integrity, lockdown ve
recovery durumlarını kontrol eder. Namespace, ownership, encryption context,
PhoneHub binding ve storage registry kontrolleri açıkça implementation dışıdır;
bu boşluklar güvenli boot kanıtı sayılmaz.

Doğrulama:

- 29/29 AccountCleanup foundation unit testi geçti.
- İlgili regresyon koşumunda 9 dosya ve 247/247 test geçti.
- TypeScript `--noEmit` kontrolü geçti.
- `commandService.test.ts` ayrı koşumda bilinen hoisted mock hatasıyla import
  aşamasında kaldı ve 0 test çalıştırdı; foundation testlerinden bağımsızdır.
- Gerçek cihaz/process-death ve runtime logout testi yapılmadı.

Sözleşmeden güvenlik anlamı taşıyan bir sapma yoktur. Production security gate
blokludur. Sonraki görev `PWA-P1-004 — Account-scoped storage registry` olarak
seçilmiştir.

## 21. PWA-P1-005 implementation note — 2026-07-29

Vehicle local authority için gerçek participant'lar eklendi:

- `VehicleCredentialCleanupParticipant` — `LOCAL_SECRET_PURGE`
- `VehicleIdentityStorageCleanupParticipant` — `LOCAL_PRIVATE_DATA_PURGE`
- `VehicleMemoryAuthorityCleanupParticipant` — `LOCAL_PRIVATE_DATA_PURGE`
- `VehicleAuthorityVerificationParticipant` — `VERIFY_EMPTY`

Temizlenen persistent key'ler:

- `caros_pair_api_key`
- `caros_critical_pin_hash`
- `caros_pair_vehicle_id`
- `caros_pair_vehicle_name`
- `caros_pair_vehicle_plate`

Temizlenen memory authority:

- Zustand vehicle list/cache, connection status, loading/error state ve render
  throttle cache
- Açık critical PIN dialog/confirmation resolver
- Kayıtlı `useCommandTracker` phase/result/subscription context'leri

Web Storage çoklu key silme işlemi transaction değildir. Participant bütün
bounded key setini best-effort silmeye devam eder, ardından her key'i yeniden
okuyarak doğrular. Bir remove/read hatası veya kalan/partial identity state
blocking failure'dır. Aynı participant process-death recovery sırasında güvenle
tekrar çalışabilir.

Vehicle local hydrate, Supabase fetch sonucu, realtime callback ve command
callback/timeout yollarına cleanup generation/lockdown kontrolleri eklendi.
Cleanup öncesi capture edilmiş async sonuç yeni generation'a yazamaz. Bu
koruma production kodunda aktiftir; ancak dashboard protected mount henüz
lockdown state'ine bağlı değildir.

`createVehicleCleanupComposition` gerçek participant'ları ve
`AccountScopedStorageVerificationParticipant`ı güvenli, lazy ve SSR-safe bir
registry composition altında toplar. Factory coordinator oluşturmaz ve logout
çağırmaz. Eksik offline/ownership/pairing ve diğer memory verifier'ları nedeniyle
tam production cleanup başarı path'i hâlâ kapalıdır.

API-key command fallback kaldırılmadı veya rotate edilmedi; yalnız logout/switch
cleanup kapsamına alındı. `caros_pair_api_key` registry scanner'da persistent
SECRET ve `UNREGISTERED_KNOWN_KEY` olarak kalır.

Doğrulama: 35/35 yeni unit test, ilgili 287/287 regresyon, tüm website suite
433/433 ve TypeScript geçti. Gerçek logout wiring, migration, deploy ve gerçek
cihaz doğrulaması yapılmadı. Production security gate blokludur.
## Implementation note — PWA-P1-006 runtime lockdown wiring (2026-07-29)

- `accountCleanupRuntime.ts`, browser'da lazy tek coordinator/composition
  instance'ı ve read-only React snapshot sağlar.
- SSR/server snapshot `CHECKING` + locked durumundadır; runtime/factory,
  corrupted ledger ve recovery hataları protected UI'ı açmaz.
- `AccountCleanupBootGate`, dashboard children'ı yalnız `SAFE_TO_START` iken
  mount eder; checking/recovery/blocking durumlarında minimal güvenli ekran
  gösterir.
- Command, realtime, fleet queue scheduler ve pairing continuation aynı
  canonical capability policy'sini kullanır.
- Push click hedefi aynı-origin dashboard allowlist'ine indirgenir ve eski
  query/hash account/vehicle context'i taşınmaz.
- Website/PWA tarafında gerçek Mavi provider/mount bulunmadığından Mavi runtime
  wiring `NOT_PRESENT/NOT_WIRED` durumundadır.
- Runtime otomatik recovery yalnız bir bounded deneme yapar. Eksik
  queue/ownership/pending-pairing/server/device participant'ları nedeniyle
  recovery başarı kanıtı üretemez ve fail-closed kalır.
- Gerçek logout çağrısı coordinator'a bağlanmadı. Queue/ownership/pending
  pairing purge, Supabase signOut, push unsubscribe, Mavi ve PhoneHub cleanup
  sonraki atomik görevlerdir.
- Vitest 21 dosya/501 test geçti. Repository TypeScript kontrolü, bu görevin
  değiştirmediği `realtimeSyncAuthority.ts:201,485` hataları nedeniyle kırmızıdır;
  bu nedenle roadmap durumu `TESTED_LOCAL`, production gate `BLOCKED` kalır.

## Implementation note — PWA-P1-007 offline authority cleanup (2026-07-29)

- `OfflineQueueCleanupParticipant`, `OwnershipSnapshotCleanupParticipant` ve
  `PendingPairingCleanupParticipant` production composition'a
  `QUEUE_AND_SNAPSHOT_PURGE` fazında deterministic sırayla bağlandı.
- Participant sözleşmesi `prepare → cleanup → verifyEmpty` akışını uygular.
  Prepare aşaması queue orchestrator/pairing continuation çalışmasını durdurur;
  cleanup memory singleton'larını ve kanıtlı persistent namespace'leri temizler;
  verify aşaması kalan authority'yi fail-closed reddeder.
- Temizlenen bounded namespace'ler `caros.fleet.queue.*`,
  `caros.fleet.snapshot.*` ve `caros.fleet.pairing.*` ile sınırlıdır.
  `localStorage.clear()` veya genel `caros*` wildcard silme kullanılmaz.
- Pending pairing verification, persistent storage yanında runtime store,
  namespace ve in-flight continuation setini de doğrular.
- `OfflineAuthorityVerificationParticipant`, üç alanı tek `VERIFY_EMPTY`
  kapısında yeniden doğrular. Storage erişilemezliği, generation mismatch,
  cleanup hatası veya residual authority blocking failure üretir.
- Web Storage çoklu key silme işlemi atomik değildir. Yarım cleanup,
  durable ledger recovery sırasında idempotent tekrar çalışır; verify tamamlanmadan
  coordinator `COMPLETED` üretemez.
- IndexedDB ve Cache Storage üzerinde bu üç authority için aktif production
  persistence bulunmadı.
- Dar regresyon 208/208, repository TypeScript ve tam website suite 572/572
  geçti. Gerçek cihaz/process-death izolasyonu doğrulanmadı; kütük #183 açıktır.
- Gerçek logout wiring, Supabase server revoke, push/Mavi/PhoneHub cleanup ve
  API-key migration bu görevin dışındadır. Production security gate blokludur.

## Implementation note — PWA-P1-008 server session revoke (2026-07-29)

- Canonical auth, `@supabase/ssr` browser/server client’larının paylaştığı cookie
  tabanlı Supabase Auth session’ıdır. Custom server session tablosu bulunmadı.
- Kurulu `@supabase/auth-js` 2.110.1 varsayılan olarak global sign-out yapar.
  `ServerSessionRevokeParticipant`, diğer cihazları etkilememek için resmi
  `signOut({ scope: 'local' })` çağrısını kullanır.
- Participant, session varlığını ve bounded user ID’yi prepare eder; access token,
  refresh token, cookie veya session payload’ını ledger/log yüzeyine taşımaz.
  `previousAccountHash` yoksa veya aktif session farklı hesaba aitse revoke
  başlamadan fail-closed durur.
- Network/timeout retryable, provider/config/storage/account uyuşmazlığı blocking
  sınıflandırılır. Ledger recovery idempotent tekrar dener; verify tamamlanmadan
  coordinator completion üretmez.
- Ayrı `ServerSessionVerificationParticipant`, browser client session’ının boş
  olduğunu doğrular. Auth generation guard, cleanup sırasında/gecikmeli gelen
  `getUser` ve `onAuthStateChange` sonucunu reddeder.
- Supabase local sign-out refresh token’ı revoke eder ve local session’ı kaldırır;
  access-token JWT ise expiry’ye kadar geçerli olabilir. Provider’ın bağımsız
  revoke-introspection endpoint’i bulunmadığından gerçek server revoke host
  mock’uyla tam kanıtlanamaz.
- 17 yeni test ve dar 156/156 ile tam 644/644 Vitest, repository TypeScript ve
  `git diff --check` geçti. Gerçek provider, browser restart/process-death ve
  CAROS LAB auth cleanup gözlemi yapılmadı; görev `TESTED_LOCAL`, production
  gate `BLOCKED` kalır.

### Gap-closure notu

- Revoke hedefi artık prepare anındaki `{userId, sessionFingerprint}` immutable
  operation context'idir. Fingerprint raw token değildir ve ledger/log'a
  yazılmaz. Revoke çağrısından hemen önce current identity yeniden okunur;
  uyuşmazlıkta yeni oturuma `signOut` çağrılmaz.
- Final verification cached sonuç kullanmaz. Her çağrı singleton session,
  `isSingleton:false` fresh browser client restore'u, Supabase auth cookie
  chunk'ları ve pending auth mutation registry'sini yeniden kontrol eder.
- `VERIFY_EMPTY` durable bir gerçek değil, point-in-time kanıttır. Recovery,
  ledger'da bu faz tamamlanmış görünse dahi `COMPLETED` öncesi tüm verifier'ları
  yeniden çalıştırır. Recovery context generation'ı aktif lockdown generation'ı
  ile yeniden sabitlenir.
- Cleanup marker cookie'si server middleware ve auth callback tarafından
  fail-closed okunur. Browser auth yazımları ortak operation/generation guard
  kullanır; eski promise/callback reddedilir, doğrulanmış cleanup sonrası yeni
  generation'daki Account B callback'i aynı mount üzerinde kabul edilebilir.
- SDK abort desteği varsayılmadı. Timeout sonrası provider promise'i ledger'ı
  tamamlayamaz. Revoke artık browser singleton yerine prepare edilen A access
  tokenını açıkça hedefleyen izole server primitive’inde çalıştığı için geç
  sonuç Account B browser session/cookie durumuna yazamaz; lockdown/recovery
  devam eder.
- Dependency ağacı lockfile ile hizalandı ve test edilen sürümler
  `@supabase/ssr 0.12.0`, `@supabase/supabase-js 2.110.1`,
  `@supabase/auth-js 2.110.1` oldu.
- Host kanıtı: server-session 25/25, auth-writer/server-gate integration 5/5,
  dar auth/cleanup 71/71 ve ortak website suite 657/657; TypeScript geçti.
  Gerçek staging provider ve browser process-death ölçümü yapılmadığından durum
  `TESTED_LOCAL`, `PRODUCTION_SECURITY_GATE: BLOCKED` kalır.

### Final acceptance gap-closure notu (2026-07-30)

- Supabase auth-js 2.110.1 kaynağındaki gerçek
  `GoTrueAdminApi.signOut(jwt, scope)` yüzeyi kullanıldı. `/api/auth/revoke-session`
  bearer ile taşınan immutable hedef A tokenını doğrular ve izole, kalıcılığı
  kapalı client üzerinden yalnız `scope:local` hedefli revoke yapar. Route
  browser cookie/session mutasyonu üretmez ve service-role kullanmaz.
- Browser auth mutation'ları aynı cross-tab Web Locks adı altında serialize
  edilir. Participant, A kimliğini kilit içinde tekrar doğrular; hedefli server
  revoke sonrası sinyal timeout değilse A'nın local session'ını temizler.
  Timeout sonrası geç server sonucu yalnız A hedefini etkileyebilir ve B'nin
  local cookie/token state'ine dokunamaz.
- Topbar ve Sidebar artık tek `requestCanonicalLogout()` transaction'ını
  kullanır. Blocking cleanup sonucu fallback sign-out veya navigation üretmez;
  eşzamanlı çift istek aynı promise'i paylaşır. `/api/auth/logout` session
  authority sahibi değildir ve doğrudan çağrıda 409
  `CANONICAL_CLEANUP_REQUIRED` döndürür.
- Host kanıtı: server-session 27/27, auth-writer/server-gate 5/5, target revoke
  route + canonical logout/UI dar grubu 36/36, ortak website suite 668/668;
  TypeScript geçti. Gerçek staging, gerçek çoklu sekme ve gerçek browser
  process-death henüz doğrulanmadı; bu nedenle `TESTED_LOCAL` ve
  `PRODUCTION_SECURITY_GATE: BLOCKED` korunur.

## Implementation note — PWA-P1-008 auth storage authority (2026-07-30)

- Kurulu auth-js sürümünde lock dışında `_saveSession` çalıştıran password,
  signup ve anonymous yolları uygulama seviyesinde tek
  `CanonicalAuthMutationAuthority` sınırına alındı.
- Production UI/hook kodu session-creating writer'ları doğrudan çağırmaz;
  bounded repository guard testi canonical modül dışındaki çağrıları reddeder.
- SDK içinde kendi storage lock'unu alan OTP/session/update yolları da uygulama
  authority'sinden geçer; uygulama ve SDK kilit namespace'leri farklı olduğu
  için nested self-deadlock oluşmaz.
- Web Locks API production'da yoksa auth mutation fail-closed olur. Yalnız test
  ortamında deterministic in-process fallback bulunur.
- Mevcut exact-cookie chunk ownership ve partial-cleanup doğrulaması korunur.
- PKCE callback artık server-side session exchange veya `Set-Cookie` üretmez;
  exchange browser canonical authority içinde yapılır. Protected middleware
  read-only auth doğrulaması kullanır ve response cookie yenilemez.
- Gerçek staging ve çoklu sekme validation hâlâ zorunludur; bu not production
  doğrulaması değildir.

### Final two-gap closure notu (2026-07-30)

- Hedefli server revoke sonrasında browser singleton `signOut()` tamamen
  kaldırıldı. Prepare aşaması Supabase SSR auth cookie chunk adları ve raw
  değer taşımayan SHA-256 hash'lerinden bounded ownership snapshot alır.
  Local purge öncesinde current user/token fingerprint ve tüm chunk snapshot'ı
  yeniden doğrulanır; yalnız aynı A artifact'ları exact-name silinir.
  Account B veya ownership belirsizliği hiçbir cookie silmeden blocking
  `SERVER_SESSION_ACCOUNT_MISMATCH` üretir.
- `useSessionUser` auth observer'ı doğrudan `resetOfflineState()` veya
  kapsam-koruyucu purge çağırmaz. Initial hydration/same-account refresh
  cleanup değildir. A→B olayı B authority'yi uygulamadan canonical
  `account_switch` coordinator transaction'ını tetikler; aktif logout/recovery
  lockdown callback'leri ikinci cleanup başlatamaz.
- Revoke route bütün yanıtları `Cache-Control: no-store` ile döndürür,
  Authorization header 8192 karakterle bounded'dır ve token response/error/
  telemetry yüzeyine taşınmaz. Merkezi origin ve rate-limit altyapısı bu görevde
  oluşturulmadı; açık defense-in-depth borcudur.
- Host kanıtı: server-session 29/29, auth-writer/server-gate 8/8,
  logout/target-route 10/10, tam website suite 704/704; TypeScript ve
  `git diff --check` geçti. Gerçek staging, iki sekme ve process-death kanıtı
  olmadığı için durum `TESTED_LOCAL`, production gate `BLOCKED` kalır.
## Implementation note — Final P1 gap closure (2026-07-30)

- Cookie ownership doğrulaması ile exact chunk silme artık Supabase auth-js'in
  canonical `lock:<storageKey>` kilidi içinde yapılır. SDK ile yarışan başka
  sekme aynı kilidi almadan cookie yazamaz; lock desteği yoksa purge yapılmaz.
- Logout target, canonical action girişinde ilk await'ten önce account ID ve
  SHA-256 session fingerprint olarak capture edilir. Runtime initialization
  session hedefini değiştiremez.
- Concurrent cleanup dedupe yalnız reason + previous account + next account +
  fingerprint aynıysa Promise paylaşır; farklı transition blocking reddedilir.
- Ledger raw token taşımaz. Yalnız bounded fingerprint taşır.
- Bu host kanıtıdır; gerçek iki-sekme Web Locks, process-death recovery ve
  already-revoked Supabase staging davranışı ayrıca doğrulanmalıdır.
## Implementation note — Security architecture closure (2026-07-30)

- Supabase browser singleton ve fresh client aynı explicit auth lock adapter'ını
  kullanır. Adapter auth-js'nin `(name, acquireTimeout, operation)` sözleşmesine
  uyar; Web Locks yoksa fail-closed hata üretir.
- Durable cleanup ledger schema v2'dir. Account-scoped recovery hedefinde
  `previousAccountHash` ve immutable `expectedSessionFingerprint` birlikte
  zorunludur. Aktif schema-v1 kayıt current session'a bağlanmaz; quarantine
  edilir.
- Cookie chunk temizliği gerçek browser transaction değildir. Uygulama
  chunk-bazlı ownership-safe ve recoverable model kullanır: kalan set her adımda
  doğrulanır, kısmi durum typed blocking failure üretir, final verify olmadan
  cleanup tamamlanmaz.
