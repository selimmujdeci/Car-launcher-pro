# Arabam Cebimde — Credential ve Pairing Authority Envanteri

**Görev:** `PWA-P1-001`  
**Tarih:** 2026-07-29  
**Branch:** `feat/caros-lab-phase-a1`  
**HEAD:** `f89540c3b332cf0bfea897d8d22a1c2103f26889`  
**Canonical roadmap:** [`docs/archive/ARABAM_CEBIMDE_PWA_ROADMAP.md`](../archive/ARABAM_CEBIMDE_PWA_ROADMAP.md)  
**Kapsam:** Analiz ve sözleşme; davranışsal kod değişikliği yok.

## 1. Sonuç

Repository'de tek bir pairing veya command authority yoktur. Birbirinden ayrı
üç güven alanı vardır:

1. Oturumsuz PWA, pairing code karşılığında araç API key'i alır ve bunu
   `localStorage` içinde saklar.
2. Authenticated dashboard, Supabase access token ve server-side
   `pair_vehicle_to_user` RPC'siyle ownership kurar.
3. PhoneHub, Supabase ownership'den bağımsız Android Keystore identity,
   fingerprint trust ve kullanıcı confirmation kullanır.

Remote command için de iki paralel yol vardır:

- Oturum yoksa browser'daki vehicle API key bir bearer credential olur.
- Oturum varsa Supabase session ile doğrudan command insert veya kritik RPC
  kullanılır.

Bu ayrım bilinçli bir migration sözleşmesiyle birleşmeden production güvenlik
kapısı açılamaz.

## 2. Authority haritası

| Akış ID | Kullanıcı yüzeyi | Giriş noktası | Kimlik doğrulama | Yetki otoritesi | Credential türü | Credential üretimi | Saklama yeri | Komut yetkisi verir mi | Revoke yolu | Logout temizliği | Risk |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AUTH-01 | Login/dashboard | Supabase browser client | E-posta/şifre veya auth callback | Supabase Auth | Access + refresh token/session | Supabase Auth server | `@supabase/ssr` cookie formatı | Evet, RLS/RPC ve command insert yoluyla | `auth.signOut`; global/device revoke ayrıca doğrulanmadı | Yalnız Supabase session | HIGH: app-local vehicle/cache temizlenmiyor |
| PAIR-01 | `/kumanda` QR/PIN | `pairVehicle` → `/api/pwa/pair` | Kullanıcı oturumu yok; code possession | Eski `pair_vehicle` SECURITY DEFINER RPC; route service-role kullanır | Vehicle API key | Araç kayıt/pair RPC sonucu; ayrıntılı origin eski migration'da | Browser localStorage | Evet | Yalnız `clearLocalVehicle` client helper; server revoke doğrulanmadı | Hayır | CRITICAL |
| PAIR-02 | Authenticated araç ekleme | `/api/vehicle/link` | Bearer Supabase access token → `auth.getUser` | `pair_vehicle_to_user` + server ownership/company kuralları | Yeni remote secret dönmez; ownership/pairing row | Server RPC | Supabase `vehicles` + `vehicle_pairings`; session cookie | Dolaylı olarak evet | Unpair/ownership revoke uçtan uca doğrulanmadı | Session kapanır; ownership kalır, local cache temizlenmez | HIGH |
| PAIR-03 | PWA offline pairing | `PairingScreen` → pending pairing store | Mevcut UI yolu `userId:null` kullanabilir; server verification yok | Authority değildir; yalnız pending claim | Pairing code'un şifreli yerel kopyası + idempotency key | Kullanıcının girdiği/scanned code | User namespace'li localStorage; WebCrypto cipher | Hayır; doğrulanana kadar ownership yok | Store `clear` ve `clearAllPendingPairings` var | Logout wiring yok | HIGH: account binding eksik/null namespace |
| CMD-01 | Standalone PWA command/diagnostic | `sendCommandViaApiKey` → `/api/pwa/command` | `Authorization: Bearer <vehicle-api-key>` | Server route vehicle `api_key_hash` eşleşmesi | Vehicle API key | PAIR-01 | Browser localStorage, runtime memory/header | Evet | Server-side rotation/revoke doğrulanmadı | Hayır | CRITICAL |
| CMD-02 | Authenticated dashboard/PWA | `sendCommand` | Supabase cookie session | `vehicle_commands` RLS veya kritik command RPC | Access token/session | Supabase Auth | Cookie + SDK runtime | Evet | Supabase sign-out/session revoke | Yalnız session | HIGH: paralel command authority |
| CMD-03 | Kritik command PIN | `verifyCriticalCommand` | Client'ta 4 haneli PIN hash equality | Client localStorage ve bazı yollarda RPC/route flag | SHA-256 PIN hash | Browser | localStorage | Kritik komut gate'i olarak kullanılır | remove/rotation UI doğrulanmadı | Hayır | CRITICAL: server re-auth değildir |
| FLEET-01 | Fleet company/vehicle UI | `/api/company/*` → RPC | Supabase authenticated session | `auth.uid()` + server admin/company/owner checks | Session + server role/ownership | Supabase Auth ve profiles/company data | Cookie + database | Atama doğrudan araç komut secret'ı üretmez; erişim kapsamını etkiler | Remove vehicle/member/company RPC'leri | Session kapanır; offline snapshot/queue temizlenmez | HIGH; canlı RLS uygulanmışlığı bilinmiyor |
| PHONE-01 | Native PhoneHub companion | `CompanionIdentitySigner` | Android app/device identity | Android Keystore private key + signed handshake | Asimetrik identity key pair | AndroidKeyStore cihazda üretir | AndroidKeyStore | Doğrudan PWA/Supabase command yetkisi verdiği kanıtlanmadı | `deleteIdentity` | PWA logout ile ilişkisi yok | MEDIUM: ayrı identity domain |
| PHONE-02 | Phone ↔ head-unit trust | `LinkHandshake`, `CompanionTrustStore`, `PhoneHubTrustStore` | İmzalı ephemeral handshake + pairing code + user confirmation veya trusted fingerprint | İki uçtaki fingerprint trust store | Peer fingerprint, session keys, pairing code | Handshake derives ephemeral/session material | Fingerprint SharedPreferences; private identity Keystore; session key memory | PhoneHub application message yetkisi verebilir; PWA command ile binding yok | `forget/clear` + identity delete controller yolu | PWA logout ile ilişkisi yok | HIGH: ownership ↔ physical trust binding yok |

### Satır kanıtları

- Oturumsuz PWA pairing ve service-role:
  `website/src/lib/pairingService.ts:78-87`,
  `website/src/app/api/pwa/pair/route.ts:35-39`.
- Vehicle API key'in response ve localStorage yaşamı:
  `website/src/app/api/pwa/pair/route.ts:50-75`,
  `website/src/lib/pairingService.ts:33-38,43-53,68-73,100-121`.
- Authenticated pairing:
  `website/src/app/api/vehicle/link/route.ts:17-25,32-39,64-78,80-130`.
- Atomik ownership ve grant sınırı:
  `supabase/migrations/20260729000034_pairing_company_and_owner_gps.sql:43-174,280-286`.
- Eski `pair_vehicle` grant daraltması:
  `supabase/migrations/20260729000035_fleet_membership_foundation.sql:245-271`.
- Offline pending pairing:
  `website/src/components/pwa/PairingScreen.tsx:187-199,232-250`,
  `website/src/lib/offline/offlinePairing.ts:31-41,65-74,139-193,226-245`.
- API-key command:
  `website/src/lib/commandService.ts:117-170`,
  `website/src/app/api/pwa/command/route.ts:16-18,35-76`.
- Authenticated command:
  `website/src/lib/commandService.ts:154-227`.
- PIN hash:
  `website/src/lib/criticalAuth.ts:4-15,17-40`,
  `website/src/lib/commandService.ts:23-29,189-205`.
- Supabase cookie session:
  `website/src/lib/supabaseBrowser.ts:14-29`,
  `website/src/lib/supabaseServer.ts:16-27,30-46`.
- Service-role env sınırı:
  `website/src/lib/supabaseAdmin.ts:3-17,21-25`.
- Logout:
  `website/src/app/api/auth/logout/route.ts:4-9`,
  `website/src/components/layout/Topbar.tsx:31-34`,
  `website/src/components/layout/Sidebar.tsx:137-140`.
- Phone identity/trust:
  `android/phonehub-companion/src/main/java/com/cockpitos/phonehub/companion/CompanionIdentitySigner.kt:29-39,56-81,100-144`,
  `android/phonehub-companion/src/main/java/com/cockpitos/phonehub/companion/CompanionLinkController.kt:59-60,167-186,299-328`,
  `android/phonehub-protocol/src/main/java/com/cockpitos/phonehub/protocol/LinkHandshake.java:141-164,206-234,329-357,472-486`.

## 3. Credential yaşam döngüleri

### 3.1 Supabase access/refresh session

```text
CREATED   Supabase Auth server
DELIVERED auth response/callback
STORED    @supabase/ssr cookie format
READ      browser/server/middleware Supabase clients
USED      API bearer header, RLS, RPC, realtime
ROTATED   Supabase SDK refresh mekanizması; repo-specific policy doğrulanmadı
REVOKED   signOut mevcut; global/device revoke doğrulanmadı
DELETED   session cookie signOut ile; app domain cache'leri değil
```

| Özellik | Sonuç |
|---|---|
| Üreten | Supabase Auth server |
| Şifreli | HTTPS aktarımı varsayılır; cookie içeriğinin application-level şifrelemesi doğrulanmadı |
| Scope | User session/JWT claims |
| TTL | JWT/provider kontrollü; repository sabit değeri doğrulanmadı |
| Rotation | SDK refresh beklenir; özel rotation testi yok |
| Logout/account switch | Supabase session temizlenir; PWA local state temizlenmez |
| Lost device | Device-session listeleme/revoke akışı doğrulanmadı |
| Replay | Token ele geçirilmesi halinde expiry/revoke'a kadar risk; somut exploit doğrulanmadı |

Kanıt: `website/src/lib/supabaseBrowser.ts:14-29`,
`website/src/lib/supabaseServer.ts:16-46`,
`website/src/lib/deviceLinkClient.ts:4-8`,
`website/src/app/api/auth/logout/route.ts:4-9`.

### 3.2 Vehicle API key

```text
CREATED   araç registration/pairing backend
DELIVERED /api/pwa/pair JSON response
STORED    localStorage: caros_pair_api_key
READ      pairingService / vehicleStore / commandService / diagnostics
USED      Bearer header, payload encryption key derivation
ROTATED   DOĞRULANMADI
REVOKED   Server-side revoke DOĞRULANMADI
DELETED   clearLocalVehicle çağrılırsa; logout çağırmıyor
```

| Özellik | Sonuç |
|---|---|
| Üreten | Server/RPC; raw key client'a döner |
| Şifreli | Storage'da hayır |
| Scope | Tek vehicle ID kontrolü; key possession command authority |
| TTL | API key TTL doğrulanmadı |
| Rotation/revoke | Doğrulanmadı |
| Logout/account switch | Temizlenmez |
| Lost device | Revoke UI/API doğrulanmadı |
| Replay | Key kopyalanırsa yeniden bearer olarak kullanılabilir; rate/device binding doğrulanmadı |

Kanıt: `website/src/lib/pairingService.ts:2-7,33-38,68-73`,
`website/src/app/api/pwa/pair/route.ts:50-75`,
`website/src/app/api/pwa/command/route.ts:16-18,45-58`.

### 3.3 Pairing code

```text
CREATED   head-unit/server pairing function
DELIVERED ekran/QR/PIN
STORED    server linking fields; offline claim'de encrypted localStorage
READ      PWA route/RPC
USED      pair_vehicle veya pair_vehicle_to_user
ROTATED   yeni code generation ile; kesin lifecycle yolu birden fazla
REVOKED   single-use/null update authenticated RPC'de
DELETED   successful use/expiry cleanup; bütün yollar için doğrulanmadı
```

- Eski device-linking SQL, 60 saniye TTL ve single-use davranışı tanımlar:
  `supabase/migrations/20260421000003_device_linking.sql:162-182,189-212`.
- Authenticated yeni RPC code, TTL, use ve ownership'i tek transaction'da
  ele almak üzere tasarlanmıştır:
  `supabase/migrations/20260729000034_pairing_company_and_owner_gps.sql:43-174`.
- Oturumsuz route yalnız minimum 4 karakter kontrolü yapar ve rate-limit
  middleware'i göstermez:
  `website/src/app/api/pwa/pair/route.ts:11-18`.
- Authenticated route tam 6 rakam ister:
  `website/src/app/api/vehicle/link/route.ts:28-39`.
- Offline claim varsayılan TTL 60 saniyedir ve expired code gönderilmez:
  `website/src/lib/offline/offlinePairing.ts:31-41`.

Replay protection authenticated RPC için tasarlanmıştır. Oturumsuz eski RPC'nin
canlı gövdesi ve uygulanmış grant durumu doğrulanmadığından bütün deployment
için replay güvenliği doğrulanmış sayılamaz.

### 3.4 Client PIN hash

```text
CREATED   browser SHA-256(4 haneli PIN)
DELIVERED local runtime / command request
STORED    localStorage: caros_critical_pin_hash
READ      verifyCriticalCommand
USED      local equality ve bazı command RPC/route parametreleri
ROTATED   DOĞRULANMADI
REVOKED   DOĞRULANMADI
DELETED   logout ile HAYIR
```

Hash salt/slow KDF değildir; yalnız 10.000 olası dört haneli değer vardır.
Browser-local equality Supabase re-auth veya server challenge değildir.

Kanıt: `website/src/lib/criticalAuth.ts:4-15,23-40`,
`website/src/lib/commandService.ts:23-29,189-205`,
`website/src/app/api/pwa/command/route.ts:60-72`.

### 3.5 Offline queue/snapshot/pending-pairing material

```text
CREATED   user action / last server verification
DELIVERED domain queue/store
STORED    account-keyed localStorage
READ      useFleet / sync orchestrator
USED      offline display veya later sync
ROTATED   uygulanamaz; entries version/TTL ile yönetilir
REVOKED   cancellation/expiry/clear helpers
DELETED   helper mevcut; logout wiring yok
```

- Snapshot 24 saat TTL ve `userId` doğrulaması taşır:
  `website/src/lib/offline/ownershipSnapshot.ts:12-24,87-117,123-159`.
- Pending pairing key'i user ID namespace'i taşır ancak mevcut PWA çağrısı
  `userId:null` üretebilir:
  `website/src/lib/offline/offlinePairing.ts:139-193`,
  `website/src/components/pwa/PairingScreen.tsx:187-199`.
- Storage browser localStorage'dır; güvenli vault değildir:
  `website/src/lib/offline/storage.ts:4,44-68`.

### 3.6 PhoneHub identity key ve trust fingerprint

```text
CREATED   AndroidKeyStore asymmetric key generation
DELIVERED public SPKI + signed handshake
STORED    private key AndroidKeyStore; peer fingerprint SharedPreferences
READ      handshake/session setup
USED      transcript signature verification ve session key derivation
ROTATED   explicit automatic rotation DOĞRULANMADI
REVOKED   forget trust + deleteIdentity controller yolu
DELETED   explicit forget; PWA logout ile bağlı değil
```

| Özellik | Sonuç |
|---|---|
| Private key export | Kod yorumuna ve API kullanımına göre export edilmez |
| Scope | Yerel Android install/device identity |
| TTL | Identity key için yok; pairing code için protokol TTL'i var |
| Rotation | Delete/recreate mümkün; policy yok |
| Device binding | Fiziksel Android Keystore'a bağlı |
| Ownership binding | Supabase user/vehicle ownership'e bağlı değil |
| Lost phone | Backend trust revoke bağlantısı doğrulanmadı |
| Replay | Ephemeral key/transcript signatures koruma sağlar; uçtan uca saha testi yok |

Kanıt:
`CompanionIdentitySigner.kt:29-39,56-81,100-144`,
`CompanionTrustStore.kt:26,52-102`,
`CompanionLinkController.kt:167-186,299-328`,
`LinkHandshake.java:206-234,329-357,472-486`.

## 4. Tek authority kararı

| Authority/bileşen | Karar | Gerekçe |
|---|---|---|
| Supabase authenticated session | `KEEP` | Server user identity, middleware ve RLS/RPC için mevcut canonical foundation |
| `pair_vehicle_to_user` | `KEEP` | Code/TTL/single-use/ownership/company işlemini atomik server RPC'de topluyor |
| Server RPC/RLS ownership | `KEEP` | Client role/owner input'una güvenmeyen hedef authority |
| PhoneHub Android Keystore identity | `KEEP` | Export edilmeyen device identity ve signed handshake foundation'ı |
| PhoneHub peer fingerprint trust | `MIGRATE` | Korunmalı fakat Supabase account/vehicle/device binding ve revoke ledger'a bağlanmalı |
| `/api/pwa/pair` oturumsuz pairing | `DEPRECATE` | Code possession + service-role + raw vehicle secret response; authenticated authority ile paralel |
| Browser vehicle API key | `REMOVE` | Remote-control bearer secret localStorage'da tutulamaz |
| `clearLocalVehicle` ile client-only unpair | `MIGRATE` | Server revoke/ownership değişimi olmadan security revoke değildir |
| Client PIN hash authority | `REMOVE` | Re-auth/challenge değildir; düşük entropy hash localStorage'da |
| Client capability/role checks | `KEEP` (UX only) | UI affordance için yararlı; güvenlik authority'si değildir |
| API-key command authorization | `DEPRECATE` | Authenticated user + ownership + device-bound command authority'ye geçmeli |
| Authenticated direct command insert | `MIGRATE` | Tek server command authorization RPC/ledger'a alınmalı |
| Offline pending pairing | `MIGRATE` | Pending truth korunmalı; authenticated account namespace ve non-secret handle kullanılmalı |
| Demo pairing/command credentials | `REMOVE` (production path) | Yalnız fiziksel olarak ayrı demo build/environment'ta kalabilir |
| Device-wide/session-wide remote revoke | `UNKNOWN` | Repository'de tamamlanmış lifecycle bulunamadı |

## 5. Credential veri akışları

### 5.1 Mevcut oturumsuz PWA dalı

```text
USER
  ↓ QR / kısa code
PWA /kumanda
  ↓ POST, user session yok
/api/pwa/pair
  ↓ service-role (RLS bypass)
pair_vehicle(code)
  ↓
vehicle_id + RAW vehicle API key
  ↓
browser localStorage
  ↓ Bearer vehicle API key
/api/pwa/command
  ↓ api_key_hash karşılaştırması
vehicle_commands
  ↓
HEAD-UNIT
```

### 5.2 Mevcut authenticated dashboard dalı

```text
USER
  ↓ Supabase login
PWA / DASHBOARD
  ↓ access token / cookie session
/api/vehicle/link
  ↓ supabaseAdmin.auth.getUser(token)
pair_vehicle_to_user(code, server-verified userId)
  ↓ atomic server checks
vehicles.owner_id + vehicles.company_id + vehicle_pairings
  ↓
Supabase RLS / critical RPC veya direct command insert
  ↓
vehicle_commands
  ↓
HEAD-UNIT
```

### 5.3 Mevcut offline pending dalı

```text
USER
  ↓ QR/PIN, network unavailable
PairingScreen
  ↓
PendingPairingStore
  ↓ encrypted code + TTL + idempotency key
account/null namespace localStorage
  ↓ network restored
eski /api/pwa/pair submitter
  ↓
SERVER VERIFICATION

Not: pending kayıt ownership veya command authority değildir.
```

### 5.4 Mevcut PhoneHub trust dalı

```text
PHONE Android app                    HEAD-UNIT Android app
AndroidKeyStore identity             AndroidKeyStore identity
          ↓ signed ephemeral handshake ↓
       peer identity fingerprint verification
                     ↓
          derived pairing code + user confirm
                     ↓
      peer fingerprint SharedPreferences trust
                     ↓
          encrypted PhoneHub link/session

Supabase user/vehicle ownership ile binding: DOĞRULANMADI
```

### 5.5 Hedef tek-authority akışı

```text
AUTHENTICATED USER SESSION
  ↓ server validates user + rate limit + re-auth when required
PAIRING API
  ↓ opaque single-use code, short TTL
pair_vehicle_to_user(auth.uid-derived identity)
  ↓ RLS/RPC ownership + company conflict checks
CANONICAL VEHICLE OWNERSHIP
  ↓ explicit account↔device↔vehicle binding ledger
PHONEHUB KEYSTORE DEVICE IDENTITY
  ↓ proof-of-possession, revocable binding
SERVER COMMAND AUTHORIZATION RPC
  ↓ ownership + role + capability + re-auth + idempotency
IMMUTABLE COMMAND LEDGER
  ↓
HEAD-UNIT EXECUTION / READBACK / VERIFICATION

Browser'a remote-control secret verilmez.
```

## 6. Güvenlik bulguları

### Bulgu ID

PWA-SEC-001

### Öncelik

P0

### Sınıf

SECURITY_CRITICAL

### Başlık

Vehicle remote-control API key browser localStorage'da saklanıyor.

### Kanıt

- `website/src/lib/pairingService.ts:33-38,43-53,68-73`
- `website/src/store/vehicleStore.ts:50,73-83`
- `website/src/lib/commandService.ts:117-170`

### Etki

Origin içinde script çalıştırabilen bir saldırgan veya aynı browser profile'ına
erişen taraf, araç bearer credential'ını okuyabilir.

### Saldırı veya hata senaryosu

XSS veya kötü niyetli üçüncü taraf script localStorage key'ini okur ve
`/api/pwa/command` için bearer olarak tekrar kullanır. Repository'de XSS'in
gerçekleştiği doğrulanmamıştır; localStorage kullanımı XSS etkisini remote
command credential kaybına büyütür.

### Mevcut koruma

Server raw key yerine hash ile vehicle lookup yapar; key vehicle ID ile
eşleştirilir.

### Eksik koruma

HttpOnly/secure vault, device binding, rotation, revoke ve logout cleanup.

### Önerilen çözüm

Browser'a remote-control secret döndürme. Authenticated session + server
ownership + device-bound proof ile tek command authority kur.

### Sonraki atomik görev

`PWA-P1-002`, ardından secure persistence/pairing migration görevi.

---

### Bulgu ID

PWA-SEC-002

### Öncelik

P0

### Sınıf

SECURITY_HIGH

### Başlık

Logout ve account switch yalnız Supabase session'ı kapatıyor.

### Kanıt

- `website/src/app/api/auth/logout/route.ts:4-9`
- `website/src/components/layout/Topbar.tsx:31-34`
- `website/src/components/layout/Sidebar.tsx:137-140`
- `website/src/lib/pairingService.ts:57-61`
- `website/src/lib/offline/ownershipSnapshot.ts:151-159`

### Etki

Önceki hesaba ait API key, vehicle cache, PIN hash, location/fuel/maintenance,
offline queue ve snapshot yeni oturumda kalabilir.

### Saldırı veya hata senaryosu

A hesabı logout olur, B hesabı aynı browser'da login olur; vehicleStore ağ/RLS
boş döndüğünde local aracı koruyabilir ve eski credential kullanılabilir.

### Mevcut koruma

Bazı store'larda user namespace ve bağımsız clear helper'ları vardır.

### Eksik koruma

Tek atomik cleanup coordinator ve fail-closed boot gate.

### Önerilen çözüm

PWA-P1-002'de bütün account-scoped state için cleanup contract, ordering,
failure ledger ve boot quarantine tanımla.

### Sonraki atomik görev

`PWA-P1-002 — Logout/account-switch cleanup contract`

---

### Bulgu ID

PWA-SEC-003

### Öncelik

P0

### Sınıf

SECURITY_HIGH

### Başlık

Authenticated ve oturumsuz pairing paralel authority oluşturuyor.

### Kanıt

- `website/src/app/api/pwa/pair/route.ts:35-39,50-75`
- `website/src/app/api/vehicle/link/route.ts:17-25,64-78`
- `supabase/migrations/20260729000034_pairing_company_and_owner_gps.sql:43-174`

### Etki

Ownership, company conflict, credential issuance ve revoke semantiği giriş
yoluna göre değişir.

### Saldırı veya hata senaryosu

Authenticated ownership kapıları bir yolda uygulanırken code possession'a
dayanan eski yol farklı authority üretir.

### Mevcut koruma

Migration 035 eski RPC'yi yalnız service-role'a daraltmak üzere tasarlanmış.

### Eksik koruma

Tek client entry, tek server RPC ve tek result contract.

### Önerilen çözüm

Eski route'u deprecate et; geçiş süresinde raw secret vermeyen authenticated
adapter yap.

### Sonraki atomik görev

PWA-P1-003.

---

### Bulgu ID

PWA-SEC-004

### Öncelik

P0

### Sınıf

SECURITY_CRITICAL

### Başlık

Client PIN hash doğrulaması server re-auth değildir.

### Kanıt

- `website/src/lib/criticalAuth.ts:4-15,23-40`
- `website/src/lib/commandService.ts:23-29,189-205`
- `website/src/app/api/pwa/command/route.ts:60-72`

### Etki

Browser storage'a sahip saldırgan kritik komut gate'ini taklit edebilir. Dört
haneli unsalted SHA-256 hash offline brute-force'a dirençli değildir.

### Saldırı veya hata senaryosu

Hash okunur veya 10.000 olası PIN denenir; route `pinHash` varlığını
`critical_auth_verified` alanına dönüştürebilir.

### Mevcut koruma

Plaintext PIN gönderilmiyor; authenticated RPC yolu PIN hash alıyor.

### Eksik koruma

Server nonce/challenge, attempt throttling, user re-auth/biometric assertion ve
short-lived authorization grant.

### Önerilen çözüm

Local PIN authority'yi kaldır; kritik komut için server-issued, one-time,
short-lived challenge kullan.

### Sonraki atomik görev

PWA-P2-004.

---

### Bulgu ID

PWA-SEC-005

### Öncelik

P1

### Sınıf

SECURITY_HIGH

### Başlık

Pairing brute-force ve route rate-limit koruması doğrulanmadı.

### Kanıt

- `website/src/app/api/pwa/pair/route.ts:11-18`
- `website/src/app/api/vehicle/link/route.ts:28-39`

### Etki

Kısa code uzayında çevrimiçi deneme riski.

### Saldırı veya hata senaryosu

IP/device/user bazlı rate limit yoksa otomatik code denemesi yapılabilir.
Gerçek bir brute-force olayı doğrulanmamıştır.

### Mevcut koruma

Authenticated yol 6 rakam formatı, server TTL ve single-use contract taşır.

### Eksik koruma

Rate limit, progressive delay, lockout/alert/audit ve entropy policy kanıtı.

### Önerilen çözüm

Edge/API ve RPC seviyesinde birleşik user+IP+device+vehicle throttling ve
generic error response.

### Sonraki atomik görev

PWA-P1-005.

---

### Bulgu ID

PWA-SEC-006

### Öncelik

P1

### Sınıf

RELIABILITY_HIGH

### Başlık

Pairing TTL/replay sözleşmeleri birden fazla şema ve route'ta parçalı.

### Kanıt

- `supabase/migrations/20260421000003_device_linking.sql:162-182,189-212`
- `supabase/migrations/20260729000034_pairing_company_and_owner_gps.sql:43-174`
- `website/src/lib/offline/offlinePairing.ts:31-41`

### Etki

Deployment migration history'sine göre code tüketme davranışı farklı olabilir.

### Saldırı veya hata senaryosu

Eski RPC/grant aktif kalırsa yeni atomic ownership/replay varsayımları geçerli
olmayabilir.

### Mevcut koruma

60 saniye TTL ve single-use tasarımları vardır; offline expired claim gönderilmez.

### Eksik koruma

Canlı schema/grant verification ve tek canonical RPC.

### Önerilen çözüm

Staging migration verification ile eski function signature/grant'ları fail
closed denetle.

### Sonraki atomik görev

PWA-P1-003 ve PWA-P10-002.

---

### Bulgu ID

PWA-SEC-007

### Öncelik

P1

### Sınıf

SECURITY_HIGH

### Başlık

Credential rotation, remote revoke ve lost-phone flow doğrulanmadı.

### Kanıt

- `website/src/lib/pairingService.ts:57-61`
- `android/phonehub-companion/src/main/java/com/cockpitos/phonehub/companion/CompanionLinkController.kt:167-186`

### Etki

Kaybolan telefonda browser credential ve fiziksel PhoneHub trust ayrı ayrı
geçerli kalabilir.

### Saldırı veya hata senaryosu

Kullanıcı başka cihazdan yalnız Supabase session'ı kapatsa vehicle API key ve
PhoneHub trust iptal edilmez.

### Mevcut koruma

Yerel unpair helper ve native forget/deleteIdentity vardır.

### Eksik koruma

Server device ledger, per-device revoke, key version/rotation ve push revocation.

### Önerilen çözüm

Account↔device↔vehicle binding ledger ve server-initiated revoke tasarla.

### Sonraki atomik görev

PWA-P1-007.

---

### Bulgu ID

PWA-SEC-008

### Öncelik

P1

### Sınıf

SECURITY_HIGH

### Başlık

PhoneHub device trust, Supabase ownership'e bağlı değil.

### Kanıt

- `CompanionLinkController.kt:59-60,167-186,299-328`
- `LinkHandshake.java:472-486`
- Repository genelinde PhoneHub fingerprint ile `auth.uid`/vehicle ownership eşlemesi bulunmadı.

### Etki

Fiziksel trusted phone ile cloud account/vehicle authority farklı gerçekler
olabilir.

### Saldırı veya hata senaryosu

Ownership değişir fakat eski PhoneHub fingerprint trust yerel cihazlarda
kalabilir.

### Mevcut koruma

Signed handshake, user confirmation ve fingerprint pinning.

### Eksik koruma

Ownership version, remote revoke ve transfer reconciliation.

### Önerilen çözüm

Keystore public identity fingerprint'ini server device binding ledger'a
proof-of-possession ile kaydet.

### Sonraki atomik görev

PWA-P1-004/PWA-P1-007.

---

### Bulgu ID

PWA-SEC-009

### Öncelik

P1

### Sınıf

SECURITY_HIGH

### Başlık

Service-role browser'a doğrudan expose edilmiyor, fakat yüksek yetkili route
sınırları tek güven kapısıdır.

### Kanıt

- `website/src/lib/supabaseAdmin.ts:3-17`
- `website/src/app/api/pwa/pair/route.ts:35-39`
- `website/src/app/api/vehicle/link/route.ts:17-25,77-78`

### Etki

Route auth/code doğrulamasındaki kusur RLS bypass eden service-role etkisine
büyür.

### Saldırı veya hata senaryosu

Service-role env browser bundle'a doğrudan konmamıştır; exposure doğrulanmadı.
Ancak oturumsuz route code'u tek authorization kabul eder.

### Mevcut koruma

Secret server-only env adıyla lazy admin client içindedir.

### Eksik koruma

Route abuse controls ve bütün service-role çağrıları için merkezi authorization.

### Önerilen çözüm

Service-role'u yalnız authenticated, typed server use-case katmanından çağır.

### Sonraki atomik görev

PWA-P1-003/PWA-P1-005.

---

### Bulgu ID

PWA-SEC-010

### Öncelik

P1

### Sınıf

SECURITY_HIGH

### Başlık

Cross-tenant ve observer server kontrolleri tasarlanmış fakat canlı doğrulama yok.

### Kanıt

- `supabase/migrations/20260729000035_fleet_membership_foundation.sql:128-250`
- `supabase/migrations/20260729000036_fleet_management_rpcs.sql:117-164,220-292,338-348`

### Etki

Migration uygulanmamış veya grant drift varsa client role UI'si güvenlik
sağlamaz.

### Saldırı veya hata senaryosu

Observer doğrudan RPC/REST çağırır veya başka tenant vehicle ID gönderir.

### Mevcut koruma

RPC'ler `auth.uid()`, company ve admin rolü kontrolü taşır; anon revoke edilir.

### Eksik koruma

Staging/live pg privilege, RLS ve adversarial cross-tenant test kanıtı.

### Önerilen çözüm

Migration verification scriptini staging'de çalıştır ve negatif test matrisini
release gate yap.

### Sonraki atomik görev

PWA-P1-006/PWA-P10-002.

## 7. Migration öncesi değişmez sözleşme

### Pairing contract

1. Production pairing için kullanıcı authenticated olmalıdır.
2. Client userId/companyId/ownerId/role güvenlik girdisi kabul edilmez;
   kimlik server session'dan çözülür.
3. Code en az 128-bit entropy taşıyan opaque token olmalıdır. İnsan girişli
   kısa kod gerekiyorsa aynı server challenge'a map edilmeli, sıkı rate-limit
   uygulanmalıdır.
4. Code TTL varsayılan en fazla 60 saniye; tek kullanımlık ve transaction içinde
   tüketilmelidir.
5. Rate limit edge/API ve server RPC'de user+IP+device+vehicle boyutlarında
   uygulanmalıdır.
6. Başka owner/company conflict'i typed, generic ve fail-closed döner; otomatik
   ownership transferi yapılmaz.
7. Pairing sonucu ownership row ve opaque binding ID döner. Client'a
   remote-control secret dönmez.
8. Remote command için device binding zorunludur; binding Keystore
   proof-of-possession ile server ledger'a bağlanır.
9. Pending offline pairing authority değildir. Secret code yerine mümkünse
   expiring opaque claim handle saklar.

### Credential contract

1. Browser'da vehicle ID, display metadata, freshness'li cache ve opaque
   non-authoritative record ID tutulabilir.
2. Vehicle API key, remote command secret, reusable PIN verifier, service-role
   key veya account encryption root localStorage/sessionStorage/IndexedDB'de
   tutulamaz.
3. Supabase session `@supabase/ssr` güvenli cookie stratejisiyle yönetilir;
   cookie flag/config deployment'ta doğrulanır.
4. Native proof key Android Keystore/Apple Keychain gibi non-exportable vault'ta
   tutulur.
5. Tokenlar kısa ömürlü ve versioned; refresh rotation reuse detection ve
   per-device revoke destekli olmalıdır.
6. Logout önce command authorization'ı ve account context'i quarantine eder,
   sonra local cleanup + server signout yapar. Her hata durumunda yeni komutlar
   fail-closed kalır.
7. Account switch yeni account namespace açmadan önce eski namespace cleanup
   ledger'ını doğrular.
8. Lost-device flow bütün session, device binding, push token ve trust
   fingerprint'lerini server'dan revoke eder.

### Command authorization contract

1. Her command authenticated `userId`, `accountId`, `vehicleId`,
   `deviceBindingId` ve immutable actor/audit ile ilişkilendirilir.
2. Ownership/company/role server RPC/RLS katmanında kontrol edilir.
3. Client capability check yalnız UX'tir; server vehicle capability registry
   zorunludur.
4. Kritik command için kısa ömürlü server challenge + recent re-auth veya
   platform biometric assertion gerekir.
5. Idempotency key client intent başında üretilir, retry/process death boyunca
   stabildir; server unique constraint ile enforce edilir.
6. Nonce/challenge tek kullanımlı, kısa TTL ve actor/vehicle/command scope'ludur.
7. Vehicle API-key command yolu production'dan kaldırılır. Gerekli head-unit
   machine credential browser'a verilmez ve yalnız device-bound channel'da
   kullanılır.
8. Tek server command authorization use-case/RPC, bütün UI ve Mavi çağrılarının
   authority'sidir.

## 8. Test ve doğrulama

Çalıştırılan komut:

```text
npx vitest run --config vitest.config.ts \
  src/__tests__/commandService.test.ts \
  src/__tests__/pairingCompanyOwnership.test.ts \
  src/__tests__/fleetCompanyApi.test.ts \
  src/__tests__/fleetMembershipFoundation.test.ts \
  src/__tests__/fleetOfflinePairingWiring.test.ts \
  src/__tests__/fleetOfflineQueue.test.ts \
  src/__tests__/fleetRolesAndConflicts.test.ts \
  src/__tests__/fleetSqlAndLab.test.ts \
  src/__tests__/realtimeVehiclePairingLifecycle.test.ts
```

Sonuç:

- 9 test dosyasının 8'i geçti.
- 212 test geçti.
- `commandService.test.ts` suite import aşamasında başarısız oldu ve 0 test
  çalıştırdı.
- Hata: `ReferenceError: Cannot access 'mockSupabase' before initialization`
  (`commandService.test.ts:34`), Vitest hoisted `vi.mock` factory.
- Test expectation veya uygulama kodu değiştirilmedi.
- Bu sonuç command authorization testlerinin yeşil olduğunu kanıtlamaz.
- Staging SQL, gerçek cihaz ve gerçek araç doğrulaması yapılmadı.

## 9. Bilinmeyenler

- Migration 033–036'nın canlı/staging uygulanmış durumu.
- Canlı `pair_vehicle` gövdesi ve bütün function grant drift'i.
- Supabase cookie `Secure`, `HttpOnly`, `SameSite` deployment değerleri.
- Vehicle API key rotation/revoke endpoint'i.
- Pairing endpoint rate-limit/WAF dış konfigürasyonu.
- Head-unit machine credential lifecycle.
- PhoneHub trust ile cloud ownership bağının planlanan authority'si.
- Production'da demo fallback'ın etkin olup olmadığı.
- Per-device Supabase session revoke ve lost-device operasyon akışı.

## 10. Görev kararı

`PWA-P1-001: COMPLETED`

Bu karar yalnız analiz/envanter görevinin tamamlandığını ifade eder. Hiçbir
production güvenlik engeli kapanmamıştır ve genel ürün ilerlemesine tamamlanmış
paket kabul kriteri katkısı yoktur.

Sonraki atomik görev:

`PWA-P1-002 — Logout/account-switch cleanup contract`
