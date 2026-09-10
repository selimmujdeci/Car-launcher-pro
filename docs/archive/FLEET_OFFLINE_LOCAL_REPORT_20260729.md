# CAROS PRO — FLEET / VEHICLE / OFFLINE FINAL LOCAL REPORT

**Tarih:** 2026-07-29 · **Branch:** `feat/fleet-offline-final-local-completion`
**Kapsam:** yalnız yerel kod + yerel/geçici PostgreSQL + dokümantasyon.
**Production'a hiçbir şey uygulanmadı. Commit/push/deploy yapılmadı.**

---

## 1. Yönetici özeti

Filo/sahiplik/çevrimdışı alanının **büyük kısmı bu oturumdan önce zaten yazılmıştı**
(untracked hâlde ~4.600 satır: kuyruk, conflict motoru, RPC'ler, 6 ekran, LAB paneli,
migration 033–036). Bu oturumun işi o yığını *tamamlanmış ilan etmek* değil,
**ürünü yalan söyleten dört boşluğu kapatmak** oldu:

1. **Çevrimdışıyken güvenlik işlemleri "kaydedildi" gösteriliyordu.** `useFleet.perform`
   rol değişikliği, üye çıkarma, eşleştirme ve araç devri dahil *her* işlemi kuyruğa
   alıp "bağlantı gelince gönderilecek" diyordu. Kullanıcı henüz kimsenin vermediği
   yetkiyi verilmiş sayıyordu. → `offlineClassification.ts` + tek kapı.
2. **Kuyruk bilinmeyen şema sürümünü sessizce yorumluyordu** (zarf `version` alanı hiç
   okunmuyordu). → fail-closed.
3. **Kuyruk hesaba bağlı değildi** — namespace dışında ikinci savunma hattı yoktu. → `accountId` kapısı.
4. **Senkron otoritesinde kilit ve kuşak yoktu** — iki tur aynı öğeyi gönderebilir,
   çıkış sonrası gelen bayat yanıt yeni hesabın kuyruğunu değiştirebilirdi. → tek-döngü kilidi + generation guard.

Ayrıca **R4 (anon GRANT)** için migration 037 yazıldı ve **geçici PostgreSQL'de gerçekten
koşturulup doğrulandı** — ve bu sırada kritik bir saha gerçeği ortaya çıktı: head unit
anon key ile `vehicles`/`vehicle_commands` tablolarına doğrudan erişiyor, dolayısıyla
R4'ün naif uygulanması **aracı komut alamaz hâle getirirdi**.

**Sonuç: FLEET_OFFLINE_PARTIAL** — gerekçesi §21'de.

---

## 2. Branch / worktree izolasyonu

- Başlangıç branch: `feat/fleet-migration-035-r2-hardening`, **286 kirli yol**, 44 kayıtlı worktree.
- Yeni branch `feat/fleet-offline-final-local-completion` **aynı dizinde** açıldı
  (`git checkout -b`) — çünkü filo işinin tamamı *untracked* hâlde bu çalışma
  ağacındaydı; ayrı worktree açmak o dosyaları erişilemez kılardı.
- Değişiklik sayısı geçiş sonrası **286 → 286** (hiçbir şey kaybolmadı).
- `stash`/`reset`/`checkout --` **kullanılmadı**. Kullanıcının hiçbir değişikliği geri alınmadı.

---

## 3. Başlangıç mimarisi (bulunan)

| Katman | Dosya | Satır | Durum |
|---|---|---|---|
| Rol/yetki matrisi | `lib/fleet/roles.ts` | 106 | Saf, fail-closed |
| Typed hata sözleşmesi | `lib/fleet/errors.ts` | 131 | Stabil kodlar |
| API yetki kapısı | `lib/fleet/apiAuth.ts` | 107 | `auth.getUser()` tek kimlik |
| Kuyruk sözleşmesi | `lib/offline/types.ts` | 153 | Bounded/TTL/backoff |
| Kuyruk | `lib/offline/domainQueue.ts` | 368 | Dedupe/poison/restore |
| Senkron | `lib/offline/syncOrchestrator.ts` | 169 | Domain sırası + serileştirme |
| Conflict motoru | `lib/offline/conflictEngine.ts` | 199 | 13 kod, server-wins |
| Sahiplik snapshot | `lib/offline/ownershipSnapshot.ts` | 163 | Fail-closed offline yetki |
| Çevrimdışı eşleştirme | `lib/offline/offlinePairing.ts` | 249 | AES-256-GCM şifreli kod |
| Eşleştirme servisi | `lib/offline/pendingPairingService.ts` | 333 | Idempotent, in-flight kilit |
| Araç durum modeli | `lib/offline/vehicleOfflineStatus.ts` | 328 | 3 "çevrimdışı" ayrımı |
| UI | `dashboard/fleet/*` (6 sayfa) | ~1.060 | Türkçe, dürüst durum |
| LAB | `lib/lab/fleetLab*.ts` + `/lab` | ~380 | Salt-okunur |

---

## 4. Authority haritası (tek gerçek kaynak)

| Alan | Otorite | Yazma yolu | Okuma yolu |
|---|---|---|---|
| Kimlik | Supabase `auth.getUser()` | — | `resolveActor()` |
| Üyelik/rol | `profiles` + RPC (036) | `add_company_member` · `update_member_role` | `/api/company` |
| Araç sahipliği | `vehicles.owner_id` (sunucu) | `pair_vehicle` (anon EXECUTE **geri alındı**) | `list_company_vehicles` |
| Çevrimdışı yetki | `OwnershipSnapshot` (son **doğrulanmış** erişim) | `storeSnapshot()` | `canOffline()` |
| Bekleyen mutation | `DomainQueue` (**tek**, hesaba bağlı) | `enqueueOfflineMutation()` **tek kapı** | `queue.all()` |
| Senkron | `SyncOrchestrator` (**tek**, kilitli+kuşaklı) | `runOnce()`/`drain()` | `getGeneration()` |
| Eşleştirme claim'i | `PendingPairingStore` (şifreli) | `createPendingPairing()` | `readPairingCounts()` |

**Çoklu otorite kalmadı.** Telemetri kuyruğu (`connectivityService`) ayrı ve bilinçli
olarak dokunulmadı — farklı alan, farklı ömür.

---

## 5. Şirket ve üyelik modeli

Roller: `individual · observer · member · admin` (+ sunucuda `super_admin`).
Yetki matrisi `roles.ts`'de **tek yerde**; UI ve sunucu aynı matrisi okur ama
**UI görünürlüğü güvenlik değildir** — her rota `assertCapability()` ile ayrıca doğrular
ve RPC kendi içinde üçüncü kez doğrular.

- Son-admin koruması: **RPC içinde** (036) — kaldırılamaz, rolü düşürülemez.
- Bilinmeyen rol → fail-closed `individual` (en dar yetki).
- Observer salt-okunur: `vehicle.command` yetkisi **yok** — komut bile gönderemez.

**Eksik:** e-posta ile *davet* akışı yok (doğrudan üye ekleme var); şirket silme/arşivleme
politikası uygulanmadı; bireysel↔şirket geçişi yalnız sunucu tarafında mümkün.

---

## 6. Araç sahipliği ve pairing

- Linking code: hash'li idempotency anahtarı (kodun kendisi anahtar olarak
  **kullanılmıyor** — yoksa AES şifrelemesi anlamsız olurdu), TTL, tek kullanım,
  in-flight kilidi, tanınmayan red **fail-closed REJECTED**.
- Çevrimdışı eşleştirme **sahiplik üretmez** — `PENDING_SERVER_VERIFICATION`.
- `pair_vehicle` EXECUTE yetkisi `anon`/`authenticated`'tan 035'te geri alındı.

**Eksik:** sahiplik **devri** (transfer) akışı yok · cihaz değişimi senaryosu yok ·
linking code brute-force rate limit'i sunucuda doğrulanmadı.

---

## 7. Çevrimdışı mutation kuyruğu

| Garanti | Nasıl |
|---|---|
| Bounded | `MAX_QUEUE_SIZE=500`; dolunca terminal budanır, yer yoksa **açıkça reddedilir** |
| TTL | 7 gün; süresi geçen `EXPIRED`, asla gönderilmez |
| Poison koruması | `maxAttempts=6` → `PERMANENT_FAILED`; sonsuz retry yok |
| Backoff | Deterministik üstel (2s→5dk), `Math.random` yok |
| Dedupe | `dedupKey` (yerel) + `idempotencyKey` (sunucu) |
| Kesinti | Yeniden açılışta `SYNCING` **kör başarılı sayılmaz** → `RETRYABLE_FAILED` |
| **Şema (YENİ)** | Bilinmeyen zarf/öğe sürümü **yorumlanmaz**; depo silinmez |
| **Hesap (YENİ)** | `accountId` kapısı — yabancı kayıt yüklenmez, yabancı yazma reddedilir |

---

## 8. Sync coordinator

- **Tek döngü:** eşzamanlı ikinci `runOnce()` başlatılmaz (`skippedAlreadyRunning`).
- **Kuşak kapısı:** `abort()` generation'ı artırır; uçuştaki yanıt geldiğinde kuşak
  değişmişse kuyruğa **hiçbir şey yazılmaz** (`staleRejected` sayılır).
- Hesap değişiminde `getQueue()` otomatik `abort()` eder.
- Domain sırası: company → membership → ownership → pairing → assignment → telemetri.
- Aynı entity tek turda tek işlem (serileştirme); farklı araçlar paralel.
- `drain()` bounded + kuşak değişince derhal durur.

---

## 9. Conflict engine

13 conflict kodu, her biri için politika: `autoResolvable · requiresUserDecision ·
cancelOperation · resolution · localRetryAllowed · dataLossRisk` + Türkçe açıklama.
**Sahiplik/şirket çakışmasında otomatik local-wins ASLA yok** — "zorla devral"
seçeneği üretilmez.

---

## 10. Realtime entegrasyonu

Mevcut: `realtimeVehiclePairingLifecycle.test.ts` ile abonelik yaşam döngüsü kilitli.
**Eksik (açık borç):** reconnect sonrası snapshot/**gap detection** uygulanmadı;
realtime event'in pending local mutation'ı ezmemesi için revizyon karşılaştırması yok.

---

## 11. Account cleanup entegrasyonu

`src/security/accountCleanup/*` **paralel işin kodudur — dosyalarına dokunulmadı.**
Entegrasyon adapter üzerinden:

- Registry zaten `caros.fleet.queue.*` · `caros.fleet.snapshot.*` · `caros.fleet.pairing.*`
  ve `fleet-queue-memory-context` descriptor'larını tanıyor.
- Bu oturumda **filo tarafı** güçlendirildi: `resetOfflineState()` artık
  `{ok, residualKeys, verifiable}` **döndürür** — "sildim herhâlde" varsayımı kalktı;
  ayrıca süreç-içi pairing tekilini (`resetPendingPairingStore`) de bırakıyor
  (önceden bırakmıyordu — gerçek bir sızıntı yoluydu).

---

## 12. UI/UX

`/dashboard/fleet` · `/members` · `/vehicles` · `/pending` · `/conflicts` · `/lab`.
Eylem sonucu artık `offlineClass` + `serverConfirmed` taşır; "İşlem tamamlandı"
yalnız sunucu 200 döndüğünde yazılır. `ONLINE_REQUIRED` işlem çevrimdışı denenirse
kullanıcı **"Bu işlem için internet bağlantısı gerekli"** görür ve bekleyen sayısı artmaz.

---

## 13. CAROS LAB

`/dashboard/fleet/lab` salt-okunur; açılışta tek okuma + elle YENİLE; timer/abonelik yok.
**Yeni iki panel:** *Hesap İzolasyonu & Kuşak* (kuyruk hesap bağı · yabancı hesap reddi ·
şema reddi · senkron kuşağı · bayat sonuç reddi · tur çalışıyor mu) ve *Çevrimdışı Politika*.
LAB **yeni otorite kurmaz** (`peekOrchestrator()` — `getOrchestrator()` değil).
Hassas veri taşınmaz: yalnız VAR/YOK ve ADET; eşleştirme kodu **çözülmeden** sayılır.
`accountScopeBound === false` ise panel **DEGRADED** olur.

---

## 14. Security / RLS

Migration 037 (FAZ 1) **geçici PostgreSQL 16'da gerçekten koşturuldu**:

| Doğrulama | Sonuç |
|---|---|
| `anon` → profiles/companies ayrıcalığı | **4+4 → 0** |
| `SET ROLE anon; SELECT FROM profiles` | **permission denied** ✅ |
| `SET ROLE anon; SELECT FROM companies` | **permission denied** ✅ |
| `authenticated` ayrıcalıkları | **8/8 korundu** (yan hasar yok) |
| Araç tabloları (FAZ 2) | **dokunulmadı** (8 ayrıcalık duruyor) ✅ |
| İkinci koşu | **idempotent**, hata yok |
| RLS kapalıyken | **fail-closed DURDU** ✅ |
| `local_037_verify.sql` | **6/6 PASS** |

### 🔴 En kritik bulgu

Head unit **anon key** ile doğrudan tablo erişimi yapıyor:
`src/platform/commandListener.ts:293` (`vehicles` UPSERT — e2e_public_key),
`:378` ve `:464` (`vehicle_commands` SELECT), `remoteCommandService.ts:453`.
R4'ün "6 filo tablosunda anon SELECT'i kaldır" biçiminde naif uygulanması
**aracın komut almasını ve E2E anahtar yayınını durdururdu.** Bu yüzden araç
tabloları FAZ 2'ye bırakıldı; ön koşulu bu erişimin SECURITY DEFINER RPC'ye göçüdür.

---

## 15. Migration değişiklikleri

- **Mevcut 033–036 dosyalarına DOKUNULMADI** (035 R2 hardening korundu).
- **Yeni:** `20260729000037_anon_grant_defense_in_depth.sql` (FAZ 1, taslak —
  idempotent · transaction · fail-closed · rollback notlu).
- **Yeni doğrulama:** `supabase/verification/local_037_fixture.sql` · `local_037_verify.sql`.
- **İki migration zinciri** (kök `supabase/migrations` vs `website/supabase/migrations`)
  büyütülmedi — yeni dosya yalnız **kök** zincire eklendi (033–036 ile aynı yer).
  Zincir birleştirme kararı bu oturumun kapsamı dışıdır; `docs/db/MIGRATION_HISTORY_RESOLUTION_20260729.md` mevcut.

---

## 16. Test sonuçları

| Paket | Sonuç |
|---|---|
| Website (`npx vitest run`, 20:18 — paralel iş dahil) | **18 dosya / 431 test PASS** |
| Website (20:09 — yalnız bu oturumun işi) | 17 dosya / 398 test PASS |
| Website `tsc --noEmit` | **temiz** |
| Kök depo (`npm run test`) | **424 dosya / 8831 test PASS** |
| Yerel PostgreSQL 037 | **6/6 PASS** |

**Yeni test dosyaları:** `fleetOfflineHardening.test.ts` (27 kilit) ·
`fleetAnonGrantMigration.test.ts` (14 kilit).
**Düşen test yok.** Başka ajana ait düşen test **gözlenmedi**.

⚠️ **Lint koşulamadı:** `website/` dizininde ESLint yapılandırması **yok**
(`next lint` interaktif kuruluma giriyor). Yapılandırma eklemek kapsam dışı
bırakıldı; bu bir **açık borçtur**, "temiz geçti" olarak sunulmuyor.

---

## 17. Performans

Kuyruk bounded (500) · conflict geçmişi kuyruğun içinde bounded · tek sync döngüsü ·
polling yok (LAB elle YENİLE) · backoff deterministik + tavanlı · `drain` maksimum tur
sınırlı. LAB paneli lazy sayfa; ağır animasyon eklenmedi (Mali-400 bütçesi korundu).
**Ölçülmedi:** büyük filo (100+ araç) sayfalama ve N+1 sorgu analizi yapılmadı.

---

## 18. Paralel Music Hub çakışma kontrolü

**Music Hub çakışması YOK.** Bu oturumda dokunulan dosyaların tamamı
`website/src/{lib/offline,lib/lab,lib/fleet,hooks/useFleet.ts,app/dashboard/fleet,__tests__}`,
`supabase/`, `docs/` altındadır. `src/platform/media*`, `android/.../media/`, Audio Focus,
Mavi media port ve CAROS LAB media ekranlarına **hiç dokunulmadı** (dosya sistemi zaman
damgası taramasıyla doğrulandı: media dizinlerinde bu oturumda değişen dosya **0**).

### ⚠️ Paralel iş tespiti (AccountCleanup) — çakışma yok, ama eşzamanlı

Dosya zaman damgası taraması, **bu oturum sürerken** `website/src/security/accountCleanup/`
altında başka bir sürecin dosya oluşturduğunu gösterdi:

| Dosya | Değişim | Sahip |
|---|---|---|
| `vehicleAuthorityRuntime.ts` | 20:10 (**yeni**) | paralel iş |
| `vehicleCleanupParticipants.ts` | 20:10 (**yeni**) | paralel iş |
| `createAccountCleanupRuntime.ts` | 20:12 (**yeni**) | paralel iş |
| `index.ts` | 20:12 (güncellendi) | paralel iş |

Ayrıca `hooks/useCommandTracker.ts` · `hooks/useRealtime.ts` · `store/vehicleStore.ts` ·
`store/pinDialogStore.ts` · `test-artifacts/*` aynı pencerede değişti — **hiçbiri bu
oturumda düzenlenmedi**.

**Sahiplenme kararı:** bu dosyaların hiçbirine dokunulmadı, yeniden yazılmadı. Filo tarafı
entegrasyonu kendi katmanımda yapıldı (`resetOfflineState()` doğrulama döndürür,
`peekOrchestrator()` salt-okuma) — karşı tarafın koduna bağımlılık eklenmedi.

**Etkisi ölçüldü:** paralel işin dosyaları eklendikten sonra website paketi yeniden koşuldu →
**18 dosya / 431 test PASS** (paralel iş +1 dosya, +33 test getirdi; hepsi yeşil).
İki iş arasında düşen test **yok**.

---

## 19. Production'da doğrulanmayanlar (sahte yeşil YAPILMADI)

- Migration **033–036 production'a uygulanmadı**; 037 de uygulanmadı.
- Production RLS/GRANT matrisi ölçülmedi.
- Gerçek signup → profile üretimi smoke testi yapılmadı.
- Gerçek pairing/komut zinciri araçta test edilmedi.
- PWA çevrimdışı akışı gerçek cihazda denenmedi (Ledger #176–#178 🔴).

---

## 20. Açık riskler

1. **🔴 R4 FAZ 2 bloke** — head unit anon tablo erişimi RPC'ye taşınmadan araç
   tablolarında GRANT daraltılamaz. Taşınmazsa R4 yarım kalır.
2. **Tam güvenlik matrisi koşulmadı** — 6 rol × 9 tablo/RPC için allow/deny
   matrisi yerel DB'de uygulanmadı (033–036 yerel DB'ye kurulmadı; 037 için
   minimal fixture kullanıldı).
3. **Realtime gap detection yok** — reconnect sonrası snapshot otoritesi uygulanmadı.
4. **Sahiplik devri akışı yok.**
5. **Kuyruk `localStorage`'da** — çok sekmeli kullanımda sekmeler arası kilit yok.
6. **Website ESLint yapılandırması yok** — statik kalite kapısı eksik.
7. İki migration zinciri sorunu duruyor (büyütülmedi, çözülmedi de).

---

## 21. Son karar

## `FLEET_OFFLINE_PARTIAL`

**Neden COMPLETE değil:** Kabul kuralının dört maddesi hâlâ karşılanmıyor —
(a) RLS/güvenlik matrisi test **edilmedi** (§20.2), (b) realtime stale event kapısı
**yok** (§20.3), (c) sahiplik devri akışı **yok** (§20.4), (d) R4 yalnız yarısı
uygulanabilir durumda (§20.1).

**Neden BLOCKED veya REJECTED değil:** Dört ürün-yalanı boşluğu kapatıldı ve
kanıtlandı; tek sync otoritesi, hesap kapsamlı kuyruk, idempotency, conflict motoru,
son-admin koruması ve logout doğrulaması **yerinde ve testli**. 8831 + 398 test yeşil,
migration yerel DB'de gerçekten koşturuldu.

**Sonraki atomik adım:** head unit `vehicle_commands` okuma yolunun SECURITY DEFINER
RPC'ye göçü — hem R4 FAZ 2'yi açar hem de aracın anon tablo bağımlılığını bitirir.
