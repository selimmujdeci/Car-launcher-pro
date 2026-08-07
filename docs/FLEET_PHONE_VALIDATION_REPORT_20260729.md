# CAROS PRO — FLEET PHONE VALIDATION REPORT

**Tarih:** 2026-07-29 → 2026-07-30 (gece koşumu) · **Branch:** `feat/fleet-offline-final-local-completion`
**Oturum:** `FPV-20260729-2A9EE0E3` · **Sonuç: KOŞULDU — 12/15 PASS, 2 FAIL, 1 senaryo düzeltilip yeniden koşuldu**

> **Bu belge önceki iki turun "koşulamadı" raporunun yerini alır.** Bu turda
> telefon bağlandı, **ayakta bir yerel test backend kuruldu**, migration
> **033–039 uygulandı** ve **P1–P15 gerçek cihazda çalıştırıldı**.
> `phoneValidated` yine **false** — sebebi §26'da, ve bu kez sebep ortam
> eksikliği DEĞİL, **ölçülen ürün kusurları**dır.

---

## 1. Yönetici özeti

Bu koşum, üç turdur "ortam yok" diye bekleyen doğrulamayı gerçekten yaptı ve
**beş ürün kusuru ölçtü**. Bunların ikisi P0 sınıfı dürüstlük ihlaliydi:

| # | Kusur | Etki | Durum |
|---|---|---|---|
| **D1** | Her sayfa açılışında çevrimdışı kuyruk **siliniyordu** | Bekleyen işlem yok oluyor, ekran "Tüm işlemleriniz sunucuya iletildi" diyordu → **yalan tamamlanma** | ✅ **DÜZELTİLDİ** |
| **D2** | Yeniden bağlanınca **hiç otomatik senkron yok** | Banner "bağlantı geri geldiğinde gönderilecek" **sözünü tutmuyordu**; 40 sn'de tek istek gitmedi | ✅ **DÜZELTİLDİ** |
| **D3** | Boşluk tespiti otoritesi **hiçbir gerçek kopma sinyaline bağlı değildi** | 60 sn tam kesintide bile durum `LIVE`, ekran "Canlı — veriler güncel"; sunucu 6 revizyon ileride | ✅ **DÜZELTİLDİ** |
| **D4** | Çıkış yalnız **sunucu** oturumunu kapatıyordu | Kuyruk + snapshot çıkıştan sonra cihazda **kalıyordu** | ✅ **DÜZELTİLDİ** |
| **D5** | `list_company_vehicles` (036) **`revision` döndürmüyor**, devir UI'ı (039) onu zorunlu tutuyor | **Sahiplik devri UI'dan hiç başlatılamıyor** | 🔴 **AÇIK** (P11 FAIL) |

Ayrıca **bu koşumun ürettiği olmayan**, paralel iş akışına ait bir **blocker**
ölçüldü: `website` production build'i `ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY`
ile **düşüyor** (§21.3). Dokunulmadı, sahiplenilmedi.

---

## 2. Cihaz ve build bağlamı

| Alan | Değer |
|---|---|
| `validationSessionId` | `FPV-20260729-2A9EE0E3` |
| `deviceContextId` | `DEV-B872EC0C8CC1B720` (üretici\|model\|sürüm\|API hash'i) |
| Cihaz durumu | **`device`** — yetkili ✅ |
| Üretici · model | **Xiaomi · 23090RA98I** |
| Android · API · ABI | **13 · 33 · arm64-v8a** |
| Kullanılabilir depolama | ~99 GB boş (226 GB, %57 dolu) |
| Batarya | koşum başı %50 → sonu %70 (şarjda) |
| RAM | 11.6 GB toplam |
| Bağlı ağ türleri | Wi-Fi (5 GHz, WPA2) + Cellular (LTE) |
| CAROS PRO `applicationId` | `com.cockpitos.pro` |
| Kurulu sürüm | **versionName 1.0.2 · versionCode 4** (DEBUGGABLE, minSdk 24 / targetSdk 36) |
| **Doğrulanan artefakt** | `website/` PWA — **yerel dev (debug) derlemesi**, release imzası YOK, production endpoint YOK |
| `buildSha256` (koşum başı) | `ADB92A0AF36032B903D307E417945B7C725EDB3310D1DC115A2D6C3B8543E77B` |
| `buildSha256` (koşum sonu / nihai) | `5DCF27D21D39D7E3D501153672C0B65ADD85BFA325EB942871012E755F2A8AF6` |
| Derleme kimliği tanımı | `website/src` altındaki 199 dosyanın SHA-256 manifestosunun SHA-256'sı |
| `gitHead` | `f89540c3b332cf0bfea897d8d22a1c2103f26889` |
| Dirty worktree | **EVET** (~324 yol; büyük kısmı paralel iş) |
| Validation registry sürümü | `phoneValidationScenarios.ts` — 15 telefon + 8 head-unit senaryosu |
| Köprü | `adb reverse tcp:3000` + `tcp:54321` (USB) → telefon `localhost` üzerinden erişti (secure context korundu) |

### 2.1 APK üretilmedi — gerekçe (mimari gerçek)

`com.cockpitos.pro` **head unit** uygulamasıdır ve Fleet/Offline/Transfer
ekranlarını **içermez** (`src/` içinde fleet kodu: 0 dosya · `website/src`
içinde: 21 dosya). Talimattaki "debug APK üret → kur" adımı bu mimaride
uygulanamaz; runbook'un öngördüğü **PWA yolu** kullanıldı. Bu yüzden
`buildSha256` bir APK hash'i **değil**, yukarıda tanımı verilen **kaynak ağacı
hash'idir** — APK hash'i gibi sunulmuyor.

### 2.2 Gizlilik

Cihaz **seri numarası, Android ID, IMEI, MAC, telefon numarası, e-posta ve
token rapora YAZILMADI**; IMEI/MAC/Android ID **hiç sorgulanmadı**.
Ekran görüntüsü almadan önce her seferinde `dumpsys window | mCurrentFocus`
ile ön plandaki uygulamanın **Chrome olduğu doğrulandı**; telefonda kullanıcıya
ait kişisel sekmeler mevcuttu ve **hiçbirine dokunulmadı, okunmadı,
yakalanmadı**. Sürücü betiği köken filtresi uygular: yalnız
`http://localhost:3000` sekmeleri hedeflenir.

---

## 3. Test backend / environment kapıları

**Yerel Supabase CLI stack kuruldu (izole scratchpad projesi: `fleetval`).**
Production ve staging'e **hiç bağlanılmadı, hiçbir şey yazılmadı.**

| Kapı | Sonuç | Kanıt |
|---|---|---|
| Local/test backend erişilebilir | ✅ | `127.0.0.1:54321` (Kong/PostgREST/GoTrue/Realtime), DB `54322` |
| Production backend kullanılmıyor | ✅ | `.env.local` yalnız `localhost`; `.env.staging.local` **bilinçli kullanılmadı** |
| **Migration 039 uygulanmış** | ✅ | `033·034·035·036·037·038·039` **tamamı temiz geçti**; `vehicles.revision` kolonu ve trigger canlı doğrulandı (0→3→6→9→12) |
| Test hesabı | ✅ | A = `fleet-a@caros.test` (admin) |
| İkinci test hesabı | ✅ | B = `fleet-b@caros.test` (member → individual) |
| Üçüncü hesap (çakışma için) | ✅ | C = `fleet-c@caros.test` (başka filoda admin) |
| Test şirketi | ✅ | `f1eef1ee-…0001` + ikinci filo `f2eef2ee-…0002` |
| Test aracı | ✅ | bireysel `aaaa1111-…` (A) + şirket aracı `bbbb2222-…` |
| Transfer hedefi | ✅ | B (INDIVIDUAL hedef) |
| Fleet ekranları açılıyor | ✅ | `/dashboard/fleet`, `/members`, `/pending`, `/conflicts`, `/transfer`, `/vehicles`, `/lab` — hepsi telefonda render edildi |
| CAROS LAB export çalışıyor | ✅ | 10 panel · 68 satır okundu |
| Airplane mode testi mümkün | ✅ | `cmd connectivity airplane-mode enable/disable` (root gerekmedi) |
| Wi-Fi/mobil veri geçişi mümkün | ✅ | iki taşıyıcı da mevcut |
| Process kill uygulanabilir | ✅ | `am force-stop com.android.chrome` (pid gerçekten öldü) |
| Debug-only hook (P5/P12) | ✅ | `window.__carosFleetDebug` — yalnız dev; production paketinde **YOK** (§21.2) |

### 3.1 Depodaki migration zinciri temiz DB'de replay EDİLEMİYOR (ölçüldü)

`supabase start` ilk denemede **düştü**:

```
Applying migration 20260426_sentry_mode.sql...
LegacyMigrationApplyError: ... CREATE POLICY "Kendi araç olaylarını oku" ... vehicles WHERE owner_id = auth.uid()
```

Kök neden: `20260421000000_initial_schema.sql` **üretim şemasıyla uyuşmuyor** —
oradaki `vehicles` tablosunda `owner_id` **yok** (company_id/plate/brand/model…).
Yani depo tarihinin başı, bugünkü ürün sözleşmesinin **atası değil**. Bu,
hafızadaki "SQL kanonik şema / isim kayması" borcunun somut kanıtıdır.

**Çözüm (yalnız yerelde, depo DEĞİŞTİRİLMEDİ):** depoda bu iş için hazırlanmış
`supabase/verification/local_baseline_fixture.sql` kullanıldı — auth şeması ve
rol blokları çıkarıldı (gerçek GoTrue/`auth.uid()` kullanıldı), test verisi
çıkarıldı (gerçek hesaplar GoTrue ile açıldı) → baseline + `033–039`.
**Migration 033–039 geçmişi yeniden yazılmadı; depoya hiçbir SQL eklenmedi.**

### 3.2 Baseline ile üretim şeması arasındaki farklar (dürüst sınır)

Koşum sırasında ürün kodunun ihtiyaç duyduğu ve baseline'da eksik olan kolonlar
**yerel DB'ye** eklendi: `vehicles.driver_name`, `vehicles.odometer_km`,
`vehicle_locations.lng`, `vehicle_locations.created_at`,
`vehicle_telemetry.{speed,fuel,temp,rpm,updated_at}`. Bunlar üretimde zaten
vardır (kod onları sorguluyor); baseline eksik kurmuş. **Bu farklar
"production doğrulandı" ANLAMINA GELMEZ.**

### 3.3 Taşıma katmanı sınırı (P4/P5/P13 için önemli)

Köprü USB (`adb reverse`) üzerinden kurulduğu için **telefonun uçak modu
realtime WebSocket'ini KOPARMIYOR** — soket USB tüneli üzerinden ayakta kalıyor.
Bu yüzden:

* **P1 · P2 · P3 · P8 · P15** → **GERÇEK uçak modu** ile koşuldu
  (karar `navigator.onLine`'a bağlı; uygulamanın göndermemesi gerekiyor).
* **P4 · P5 · P13** → **tarayıcı ağ katmanı çevrimdışı emülasyonu** ile koşuldu
  (`Network.emulateNetworkConditions offline:true`): soket **gerçekten** yıkılır,
  `navigator.onLine` false olur, fetch'ler düşer. Ürün kodu değiştirilmedi,
  yalnız taşıma kesildi. Bu bir **sınırlamadır** ve raporlanmıştır.

---

## 4. Kanıt politikası

`phoneValidationScenarios.ts` dört kapıyı makine düzeyinde zorluyor ve bu
koşumda hiçbiri esnetilmedi: `UNKNOWN_SCENARIO` · `HEAD_UNIT_REQUIRED` ·
`EVIDENCE_MISSING` · `DEVICE_CONTEXT_MISSING`.

Ekran görüntüleri oturuma özel geçici dizinde tutuldu (yol referansları
§5–19'da). **Kalıcı depoya kişisel içerik yazılmadı.**

---

## 5. P1 — Çevrimdışı metadata mutation queue

| Alan | Değer |
|---|---|
| scenarioId | P1 |
| buildSha256 | `ADB92A0A…` (D1 düzeltmesi sonrası) |
| preconditions | Oturum açık (A/admin) · araç erişilebilir · kuyruk boş ✅ |
| executedSteps | Filo ekranı **çevrimiçi** yüklendi → `airplane-mode enable` (`onLine=false` doğrulandı) → filo adı değiştirilip **Kaydet** → `/dashboard/fleet/pending` açıldı |
| expectedEvents | kuyruğa `COMPANY_UPDATE` eklendi |
| observedEvents | `COMPANY_UPDATE:PENDING` — `caros.fleet.queue.<A>` içinde ✅ |
| expectedUiState | "…tamamlanmış sayılmaz" + bekleyen +1 |
| observedUiState | **"Çevrimdışısınız — işlem sıraya alındı. Sunucu onaylayana kadar tamamlanmış sayılmaz."** · Bekleyen işlemler **0 → 1** · pending ekranı: "Şu an 1 işlem sırada bekliyor / Filo bilgisi güncelleme — Sırada bekliyor" ✅ |
| expectedServerState | sunucuda değişiklik yok |
| observedServerState | `companies.name` = `Dogrulama Filosu` (**değişmedi**) ✅ |
| prohibitedEvents | "Kaydedildi" / "Tamamlandı" |
| prohibitedEventObserved | **HAYIR** (`/Kaydedildi/`=false, `/Tamamlandı/`=false, yalan "iletildi"=false) |
| evidenceRefs | `evidence/P1-pending-fixed.png` · LAB/localStorage okumaları |
| **result** | **PASS** |
| notes | **İlk koşumda FAIL'di.** Aynı adımlar `buildSha256 2A9EE0E3` üzerinde koşulduğunda pending ekranı **"Bekleyen işlem yok — Tüm işlemleriniz sunucuya iletildi"** diyordu ve `localStorage` **tamamen boştu**. Kök neden ölçümle bulundu (§20 D1). Düzeltmeden sonra kuyruk sayfa geçişinde hayatta kaldı. |

---

## 6. P2 — Transfer/rol offline iken ONLINE_REQUIRED

| Alan | Değer |
|---|---|
| executedSteps | (a) Üyeler ekranı çevrimiçi yüklendi → uçak modu → B'nin rolü `member→observer` seçildi → "Evet, değiştir". (b) Devir ekranı çevrimiçi yüklendi → uçak modu → araç + hedef doldurulup **"Devri başlat"** tıklandı |
| observedEvents | `requires_online` reddi — her iki işlemde |
| observedUiState | Rol: **"Bu işlem için internet bağlantısı gerekli. Güvenlik ve yetki değişiklikleri çevrimdışı kaydedilemez."** · Devir: **"İnternet bağlantısı yok. Sahiplik devri çevrimdışı yapılamaz ve kaydedilmez."** + "Bu işlem için internet bağlantısı gerekli. Sahiplik devri çevrimdışı yapılamaz." ✅ |
| observedServerState | `profiles.role` B = `member` (**değişmedi**) · `vehicle_ownership_transfers` **count = 0** ✅ |
| prohibitedEventObserved | **HAYIR** — kuyruk 0 → **0** (transfer mutation kuyruğa **girmedi**), "kaydedildi" yok |
| evidenceRefs | `evidence/P2-transfer-offline.png` |
| **result** | **PASS** |
| notes | Kozmetik bulgu: devir ekranının `offline` kapıları **anında tepki vermiyor** (girdi/select `disabled` olmadı), çünkü `phase` yalnız `refresh()`'te güncelleniyordu. **Otorite yine de reddetti ve hiçbir şey kuyruğa girmedi** — güvenlik invaryantı korundu. D2 düzeltmesiyle `offline` olayında `refresh()` de tetiklendiği için bu kozmetik gecikme de kapandı. |

---

## 7. P3 — Reconnect sonrası tek sync

| Alan | Değer |
|---|---|
| executedSteps | Çevrimdışı 1 `COMPANY_UPDATE` sıraya alındı → uçak modu kapatıldı → **CDP ağ katmanında tüm `/api/` istekleri sayıldı** (40 sn) |
| expectedUiState | bekleyen sayısı sıfırlanır |
| observedUiState (ilk koşum) | **Bekleyen 1 kaldı.** 40 sn boyunca sunucuya **TEK istek bile gitmedi** (`istekler: []`), öğe `PENDING` |
| observedEvents (elle tetik) | Aynı senaryo "Şimdi gönder" ile: `GET /api/company` → **`PATCH /api/company` × 1** → doğrulama GET'leri. `patchCompanySayisi = 1` |
| observedServerState | `companies.name` = `Filo P3 TEKSENKRON` — **tam bir kez uygulandı** ✅ |
| prohibitedEventObserved | "aynı işlem iki kez" → **HAYIR** · "senkron turu çalışıyor kalır" → **HAYIR** |
| **result (ilk koşum)** | **FAIL** · failureCode `NO_AUTO_SYNC_ON_RECONNECT` |
| **result (D2 düzeltmesi sonrası)** | **PASS** — P15 koşumunda ölçüldü: uçak modu kapandıktan sonra **elle müdahale olmadan** `MEMBER_ADD:PENDING → CONFLICT` geçişi oldu, yani senkron kendiliğinden çalıştı |
| notes | "Tam bir kez" garantisi **ağ katmanında kanıtlandı** (PATCH=1). Düşen şey garanti değil, **tetikleyiciydi**: çevrimdışı bannerı "bağlantı geri geldiğinde gönderilecek" diyordu ama hiçbir otomatik tetik yoktu. |

---

## 8. P4 — Revision gap detection

| Alan | Değer |
|---|---|
| executedSteps | LAB açık, durum `LIVE` → ağ **gerçekten** kesildi → **ikinci istemci (sunucu tarafı SQL)** araçta 3 değişiklik yaptı → ağ geri açıldı → 30 sn boyunca 2.5 sn'de bir otorite örneklendi |
| **ilk koşum (kusurlu build)** | 6 sn ve **60 sn** kesintide: durum **`LIVE` kaldı**, `reconnectCount=0`, `suspectedGapCount=1` (açılıştan kalma), `confirmedGapCount=0`, `resyncAttemptCount=1`, `lastServerRevision=3` — **sunucu 9'a çıkmışken**. Yani snapshot alınmadan LIVE'da kaldı ve ekran "Canlı — veriler güncel" demeye devam etti |
| **result (ilk koşum)** | **FAIL** · failureCode `DISCONNECT_NEVER_OBSERVED` — yasaklı olay **gözlendi** ("Durum snapshot alınmadan LIVE olur", "lastGapReason boş/bayat kalır") |
| **D3 düzeltmesi sonrası ölçüm** | kesinti → **`SUSPECTED_GAP`**, `reconnectCount 0→1`; sunucu 9→**12**; yeniden bağlanma → `lastGapReason=`**`RECONNECTED`**, `suspectedGapCount 1→2`, **`confirmedGapCount 0→1`**, `resyncAttemptCount 1→2`, `resyncSuccessCount 1→2`, `lastServerRevision 9→`**`12`**, `snapshotEntityCount=2` |
| observedServerState | `max(vehicles.revision)` = 12 — **039 trigger'ı gerçek DB'de çalışıyor** ✅ |
| prohibitedEventObserved (düzeltme sonrası) | **HAYIR** — snapshot alınmadan LIVE olunmadı, `lastGapReason` doldu |
| **result (nihai)** | **PASS** |
| notes | Revizyon kaynağı gerçek: `vehicles.revision` (migration 039). Uydurma revizyon üretilmedi. |

---

## 9. P5 — Snapshot tamamlanmadan LIVE/"güncel" olmama

| Alan | Değer |
|---|---|
| Ön koşul (debug hook) | `window.__carosFleetDebug.setSnapshotDelayMs(ms)` — **yalnız dev derlemesi** |
| executedSteps | Snapshot gecikmesi 8–25 sn'ye alındı → ağ kesildi/açıldı → 400 ms aralıkla 80 örnek + uzlaştırma penceresinde **5 kez elle LAB YENİLE** |
| observedEvents | Geçiş dizisi: `SUSPECTED_GAP` → **`RESYNCING` (7.6 sn)** → `LIVE` ✅ |
| observedUiState | 5 bağımsız yenilemenin **hepsinde**: `Durum = RESYNCING — Sunucuyla eşitleniyor`, `Güvenilir mi (LIVE) = HAYIR` |
| prohibitedEvents | "RESYNCING sırasında 'Canlı — veriler güncel' gösterilir" |
| prohibitedEventObserved | **HAYIR** — `guncelIbaresi=false`, 85 ölçümün tamamında |
| evidenceRefs | `evidence/P5-resyncing.png` (LAB · Realtime paneli, `SUSPECTED_GAP — veriler doğrulanıyor`) |
| **result** | **PASS** |
| notes | `RECONCILING` durumu **yakalanamadı**: `reconcile()` saf bir fonksiyon ve 2 varlıkta mikrosaniye sürüyor; 400 ms örnekleme onu göremez. Durum makinesinde vardır, ama "gözlendi" DEMİYORUM. |

---

## 10. P6 — Account A queue'nun Account B'ye sızmaması

| Alan | Değer |
|---|---|
| executedSteps | A ile çevrimdışı 2 işlem sıraya alındı → çevrimiçi → **Çıkış Yap** → B ile giriş → `/dashboard/fleet` ve LAB okundu |
| observedUiState | B'de **Bekleyen işlemler = 0** · rol **"Filo üyesi"** (admin değil) ✅ |
| observedLabState | **"Kuyruk hesap kapsamına bağlı = EVET"** · Yabancı hesap kaydı reddi = 0 · Kuyruk boyutu = 0 |
| localStorage | B oturumunda yalnız `caros.fleet.snapshot.<B>` — **A'nın anahtarları YOK** ✅ |
| Kapsam kanıtı | B'nin snapshot varlık sayısı **1**, A'nın **2** → A'nın **bireysel aracı** B'nin kapsamına girmiyor ✅ |
| prohibitedEventObserved | **HAYIR** |
| **result** | **PASS** |
| notes | Ölçümde bir **kusur bulundu (D4)**: çıkıştan hemen sonra A'nın `queue`+`snapshot` anahtarları **cihazda duruyordu**; ancak B hidrasyonunda kapsam korumalı temizlik onları sildi. B onları hiçbir zaman okuyamadı (namespace + `accountId` kapısı), yani **erişim sızıntısı değil, kalıntı**. D4 düzeltildi (§20). B'nin ekranında görünen "A HESABI P6" **şirket adıdır** (A'nın senkronladığı yeni ad) — sızıntı değil, ortak veri. |

---

## 11. P7 — Logout sırasında aktif sync iptali

| Alan | Değer |
|---|---|
| executedSteps | A ile çevrimdışı 1 işlem sıraya alındı → CDP `Fetch` ile `PATCH /api/company` **dondurulacak şekilde tuzak kuruldu** → uçak modu kapatıldı → otomatik senkron başladı → **PATCH uçuşta donduruldu** → tam o anda **Çıkış Yap** → sonra istek **serbest bırakıldı** |
| observedEvents | `patchDonduruldu = true` · çıkış anındaki kuyruk durumu = **`SYNCING`** (gerçekten uçuşta) |
| observedUiState | Çıkış sonrası `/login`; `caros.*` anahtarları = **[]** (kuyruk + snapshot silindi) ✅ |
| Bayat yanıt testi | Dondurulmuş istek serbest bırakıldıktan **6 sn sonra** da anahtarlar **[]** → bayat yanıt kuyruğu **diriltemedi** ✅ |
| Yeni oturum | "Bekleyen işlem yok", yalnız 1 taze snapshot anahtarı ✅ |
| prohibitedEvents | "Çıkıştan sonra kuyruk durumu değişir" |
| prohibitedEventObserved | **HAYIR** |
| **result** | **PASS** |
| notes | Bu senaryo D4 düzeltmesi **olmadan geçmezdi**: düzeltmeden önce çıkış yalnız `/api/auth/logout` çağırıyordu, istemci `onAuthStateChange` hiç tetiklenmiyordu. LAB'daki "Bayat sonuç reddi" sayacı çıkıştan sonra **UNAVAILABLE** olur (orkestratör yok edilir) — bu yüzden kanıt sayaç değil, **depo + sunucu durumu**dur. |

---

## 12. P8 — Process kill sonrası queue restore

| Alan | Değer |
|---|---|
| executedSteps (a) | Çevrimdışı 1 işlem sıraya alındı → **`am force-stop com.android.chrome`** (pid gerçekten öldü, doğrulandı) → yeniden açıldı |
| observedUiState (a) | "Şu an 1 işlem sırada bekliyor / Filo bilgisi güncelleme — Sırada bekliyor" (**özgün zaman damgasıyla**) ✅ · kuyruk `COMPANY_UPDATE:PENDING` |
| executedSteps (b) | **Uçuş-ortası kill:** `PATCH` CDP ile donduruldu, öğe **`SYNCING`** iken süreç öldürüldü |
| observedEvents (b) | Yeniden açılışta öğe **retryable** durumda, kuyruk **boşalmadı**, sunucu **değişmedi** |
| executedSteps (c) | `SYNCING` diske **flush edildikten sonra** kill → yeniden açılış |
| observedUiState (c) | Ekranda **"Gönderilemedi — tekrar denenecek"** = **`RETRYABLE_FAILED`** ✅ (beklenen `SYNCING → RETRYABLE_FAILED` düşürmesi cihazda doğrulandı) |
| prohibitedEvents | "başarılı sayılır" · "kuyruk sessizce boşalır" |
| prohibitedEventObserved | **HAYIR** — üç alt vakada da (`/gönderildi/`=false, `/başarılı/`=false) |
| **result** | **PASS** |
| notes | (b)'de `SYNCING` **diske inmemişti**: Chrome localStorage yazımlarını topluca boşaltıyor ve `SIGKILL` bunu kaybediyor → geri dönüşte öğe `PENDING` göründü. Bu **platform davranışıdır**, uygulama mantığı değil; güvenli sonuç (retryable, kayıp yok) yine korundu. Düşürme mantığının kendisi (c) ile ayrıca cihazda kanıtlandı. Ayrıca ölçülen nüans: `load()` düşürmeyi **bellekte** yapıyor, diske hemen yazmıyor (UI doğru, ham depo bir tur geride). |

---

## 13. P9 — Bozuk queue item quarantine

| Alt vaka | Yapılan | LAB gözlemi | Çökme |
|---|---|---|---|
| (a) | `caros.fleet.queue.<A>` = `{BOZUK-JSON---` | **Bozuk kayıt (karantina) = 1** · Kuyruk boyutu 0 | **YOK** |
| (b) | Geçerli zarf + 4 çöp öğe (`{id}`, `{sacma}`, `null`, `42`) | **Bozuk kayıt = 4** · Kuyruk boyutu 0 | **YOK** |
| (c) | Zarf sürümü `99` (ileri sürüm) | **Bilinmeyen şema reddi = 2** · Bozuk = 0 · **depo SİLİNMEDİ** (fail-closed, ileri uyumluluk) | **YOK** |

| Alan | Değer |
|---|---|
| prohibitedEvents | "açılışta çöker" · "bozuk kayıt sessizce yok sayılır" |
| prohibitedEventObserved | **HAYIR** — her vakada sayaç arttı ve panel ayakta kaldı |
| evidenceRefs | `evidence/P9-quarantine.png` |
| **result** | **PASS** |
| notes | Depo bozma **tarayıcı geliştirici arayüzüyle** yapıldı (senaryonun ön koşulu bunu zaten şart koşuyor) — ürün koduna test kancası eklenmedi. |

---

## 14. P10 — Membership revoke sonrası cache temizliği

| Alan | Değer |
|---|---|
| İkinci istemci | **GERÇEK**: A'nın kendi JWT'si ile PostgREST üzerinden `remove_company_member` RPC'si (RLS ve yetki kontrolleri **açık**) |
| executedSteps | Telefonda B oturumu filo ekranlarını görüntülerken A üyeliği kaldırdı → telefonda yenilendi |
| observedEvents | RPC → **HTTP 200** · `{"removed": true, "user_id": "<B>", "company_id": "<şirket>"}` |
| observedServerState | `profiles` B → `role='individual'`, **`company_id` NULL** ✅ |
| observedUiState | Filo ekranı: **"Filonuz yok · Bireysel kullanıcı · Şu anda bireysel kullanıcısınız ve en fazla 3 araç bağlayabilirsiniz"** · Araçlar ekranı: **"Araç atamak için önce bir filo oluşturun."** · şirket aracının plakası/adı **listelenmedi** ✅ |
| prohibitedEvents | "eski filo araçları görünmeye devam eder" · "komut butonları aktif kalır" |
| prohibitedEventObserved | **HAYIR** — filo aracına ait hiçbir komut düğmesi kalmadı (yalnız genel kabuk: Çıkış Yap / Hırsız Savar / avatar) |
| **result** | **PASS** |
| notes | Dürüst sınır: "önce" karesi `/dashboard/fleet/vehicles` üzerindeydi ve o ekranda plaka render edilmiyordu; B'nin kaldırma **öncesi** filo görürlüğü P6 ölçümünden biliniyor ("2 üye · 1 araç"). Yani önce/sonra karşıtlığı iki ölçümün birleşiminden kuruluyor, tek karede değil. |

---

## 15. P11 — Ownership transfer sonrası eski sahip cache temizliği

| Alan | Değer |
|---|---|
| executedSteps | A (admin) `/dashboard/fleet/transfer` → araç `bbbb2222…` (şirket aracı) → hedef türü **INDIVIDUAL** → hedef `<B>` → **"Devri başlat"** |
| observedEvents | UI reddi: **"Araç bilgisi güncel değil. Sayfayı yenileyip tekrar deneyin."** (`canStartTransfer` → `UNKNOWN_REVISION`) |
| observedServerState | `vehicle_ownership_transfers` **count = 0** — hiç transfer kaydı oluşmadı |
| Kök neden (ölçüldü) | `/api/company/vehicles` → `list_company_vehicles()` (migration **036**) **yalnız** `{vehicle_id, name, plate, owner_id, last_seen}` döndürüyor. Devir UI'ı `readRevision()` ile `revision` arıyor; **yok** → `null` → hook fail-closed reddediyor. `vehicles.revision` migration **039**'da var ama **hiçbir okuma yüzeyine bağlı değil**. |
| prohibitedEvents | "A aracı hâlâ düzenleyebiliyor" · "A konumu görebiliyor" |
| prohibitedEventObserved | **Değerlendirilemedi** — devir hiç başlatılamadığı için devir-sonrası durum oluşmadı |
| **result** | **FAIL** · failureCode `TRANSFER_REVISION_NOT_EXPOSED` |
| notes | Bu **ortam eksikliği DEĞİL**: migration 039 uygulanmış, kolon ve trigger canlı doğrulanmış (P4'te 0→12). Kusur **036 ↔ 039 sözleşme boşluğu**. Mesaj dürüst ama **yanıltıcı**: "Sayfayı yenileyip tekrar deneyin" — yenilemek asla işe yaramaz, çünkü API o alanı hiç döndürmüyor. Çözüm iki adaydan biri: (1) yeni bir ileri migration ile RPC'ye `revision` eklemek, (2) devir ekranının revizyonu RLS altında `vehicles` tablosundan doğrudan okuması. **Bu koşumda hiçbiri uygulanmadı** — migration üretmek/uygulamak talimat kapsamı dışıydı. |

---

## 16. P12 — Stale callback'in yeni scope'a uygulanmaması

| Alan | Değer |
|---|---|
| executedSteps | A → çıkış → B ile giriş (yeni kuşak) → LAB okundu → **aktif otoriteye bir önceki kuşaktan olay verildi** |
| observedEvents | `injectStaleEvent()` → `{injected:true, accepted:**false**, reason:"**GENERATION_MISMATCH**"}` |
| observedLabState | **Bayat olay reddi 0 → 1** · `lastGapReason` → `GENERATION_MISMATCH` · Kapsam kuşağı = 2 |
| observedUiState | B ekranında A'nın **bireysel aracı bir an bile görünmedi**; B'nin snapshot varlık sayısı **1** (A'nın 2) |
| prohibitedEventObserved | **HAYIR** |
| **result** | **PASS** |
| notes | Dürüst sınır: bayat olay **debug köprüsüyle enjekte edildi** — çünkü hesap değişiminde eski kanal aboneliği kapatıldığı için doğal yolla geç bir olay üretmek zamanlamaya bağlı ve tekrar üretilemez. **Kapı gerçektir**: enjeksiyon, telefonda çalışan gerçek otoritenin gerçek `onEvent` kuşak karşılaştırmasından geçti ve sayacı otorite kendi kararıyla artırdı — sayaç elle set edilmedi. |

---

## 17. P13 — Reconnect storm'un bounded kalması

| Alan | Değer |
|---|---|
| executedSteps | 10 kez hızlı çevrimdışı/çevrimiçi (toplam **14.3 sn**), sonra 20 sn boyunca sayaç izlendi |
| observedEvents | `reconnectCount` 5 → **15** (tam +10, **amplifikasyon yok**) · `resyncAttemptCount` 5 → **15** (gerçek geçiş başına **tam 1** resync) · `resyncSuccessCount` 5 → 15 · `resyncFailureCount` **0** |
| Sınırlılık kanıtı | Fırtına bittikten sonra sayaçlar **20 sn boyunca 15'te sabit kaldı** — kaçak büyüme yok |
| observedUiState | `requestAnimationFrame` gecikmesi **11 ms** → arayüz **donmadı** ✅ |
| expectedServerState | snapshot isteği seli gitmez |
| observedServerState | 10 gerçek yeniden bağlanma için 10 snapshot okuması (**1:1**, minimum), `snapshotEntityCount` sabit 2 |
| prohibitedEventObserved | **HAYIR** |
| **result** | **PASS** |
| notes | Tüm resync'ler başarılı olduğu için **üstel backoff yolu bu koşumda tetiklenmedi** (`resyncAttempt=0` kaldı). Sınırlılık, backoff'la değil **1:1 oran + fırtına sonrası durma** ile kanıtlandı. |

---

## 18. P14 — LAB PII/token/raw payload redaction

| Alan | Değer |
|---|---|
| executedSteps | `/dashboard/fleet/lab` — **10 panel · 68 satır** tam metin tarandı |
| Taranan yasaklı desenler | e-posta · **tam UUID** · JWT (`eyJ…`) · koordinat çifti · plaka · ham JSON · `Bearer` · eşleştirme kodu |
| observedUiState | Yalnız `VAR/YOK`, adet ve durum kodları. Örnek: `Aktif kullanıcı=VAR`, `Profil durumu=DOĞRULANMIŞ`, `Şirket kimliği=VAR`, `Şirket rolü=admin`, `Bağlantı=ÇEVRİMİÇİ` |
| prohibitedEventObserved | **HAYIR** — `yasakliBulgu: []` (8 desenin **hiçbiri** bulunamadı) |
| evidenceRefs | `evidence/P14-lab.png` |
| **result** | **PASS** |
| notes | Kapsam dışı ama kayda değer gözlem: **Üyeler** ekranı (`/fleet/members`) ve **Çakışmalar** ekranı üye **tam UUID'sini gösteriyor**. P14 yalnız LAB'ı kapsıyor, bu yüzden senaryoyu düşürmüyor; yine de ürün kararı olarak gözden geçirilmeli. |

---

## 19. P15 — Conflict UI'nin dürüst davranması

| Alan | Değer |
|---|---|
| Çakışma nasıl üretildi | **GERÇEK**: C hesabı başka bir filoda admin. A çevrimdışıyken C'yi filoya eklemeyi sıraya aldı → bağlantı gelince sunucu reddetti |
| observedEvents | `MEMBER_ADD:PENDING` → (**otomatik senkron**) → **`MEMBER_ADD:CONFLICT:USER_ALREADY_IN_COMPANY`** |
| observedUiState | "**Kullanıcı zaten bir filoda** · **Ne oldu?** Eklemek istediğiniz kullanıcı başka bir filoya bağlı. Bir kullanıcı aynı anda yalnız bir filoya üye olabilir. · **Sunucudaki gerçek durum:** Sunucudaki kayıt geçerli kabul edildi; sizin bekleyen işleminiz uygulanmadı." · Seçenekler: **"Sunucudaki durumu kabul et" / "Vazgeç"** |
| prohibitedEvents | ham SQL/teknik hata metni · çakışmanın sessizce yok sayılması |
| prohibitedEventObserved | **HAYIR** — `zorlaDevral=false`, `hamSql=false`, `teknikKod=false` |
| observedServerState | üye **eklenmedi** ✅ |
| **result** | **PASS** |
| notes | **"Zorla devral" seçeneği YOK** — anayasa maddesi cihazda doğrulandı. Bu koşum aynı zamanda **P3'ün D2 düzeltmesini kanıtladı**: senkron elle tetiklenmedi. |

---

## 20. Ölçülen kusurlar ve uygulanan düzeltmeler

### D1 — Çevrimdışı durum her sayfa açılışında siliniyordu ✅ DÜZELTİLDİ

**Kanıt (telefonda):** `caros.fleet.queue.probe` ve `caros.fleet.snapshot.probe`
sayfa geçişinde **silindi**, yabancı önekli `zzz.probe` **hayatta kaldı** →
önek kapsamlı bir silme çalışıyordu.

**Kök neden:** `useSessionUser`'daki `onAuthStateChange`, abonelik kurulur
kurulmaz `INITIAL_SESSION` yayınlıyor. O anda `lastUserRef.current` henüz
`null` olduğu için `lastUserRef.current !== id` **doğru** çıkıyor ve hidrasyon
**hesap değişimi** sanılıp `resetOfflineState()` çağrılıyordu.

**Düzeltme:** hidrasyon ile gerçek hesap değişimi ayrıldı (`hydratedRef`).
Hidrasyonda yeni ve **kapsam korumalı** temizlik çalışır:
`retainOnlyAccountOfflineState(userId)` — bu hesabın ve oturumdan bağımsız
`device` kapsamının kayıtları korunur, **diğer tüm hesapların kayıtları
silinir** (güvenlik amacı korunur). Aynı koşumda sınandı:
`caros.fleet.queue.YABANCI-HESAP` **silindi**, `caros.fleet.pairing.device`
**korundu**.

### D2 — Yeniden bağlanınca hiç otomatik senkron yoktu ✅ DÜZELTİLDİ

**Kanıt:** uçak modu kapandıktan sonra **40 sn** boyunca `/api/` isteği **0**;
kuyruk `PENDING`. Oysa ekran "bağlantı geri geldiğinde gönderilecek" diyordu.

**Düzeltme:** `useFleet` içine `window.online` → `sync()` ve
`window.offline` → `refresh()` dinleyicileri (unmount'ta kaldırılıyor —
sıfır sızıntı). Çift gönderim riski yok: `SyncOrchestrator`'ın `running`
kilidi zaten var ve P3'te ağ katmanında **PATCH=1** ölçüldü.

### D3 — Boşluk tespiti hiçbir gerçek kopma sinyaline bağlı değildi ✅ DÜZELTİLDİ

**Kanıt:** **60 sn** tam ağ kesintisinde `reconnectCount=0`,
`suspectedGapCount` sabit, `resyncAttemptCount` sabit, durum **`LIVE`**,
`lastServerRevision=3` iken sunucu **9**. Ekran "Canlı — veriler güncel".
Yani `RealtimeSyncAuthority` doğru yazılmış ve unit-testli, ama **kör**:
tek besleyicisi Supabase kanalının `subscribe` durum geri çağrısıydı ve o
geri çağrı gerçek cihazda `CLOSED` üretmedi.

**Düzeltme:** `useRealtime` içinde tarayıcının kendi `offline`/`online`
olayları **aynı otoriteye** aktarıldı (`onConnectionStatus`), sekme öne
gelince `tick()` çağrılır. **İkinci otorite kurulmadı** — karar yine tek
otoritede. Sonuç P4/P5'te ölçüldü.

### D4 — Çıkış yerel çevrimdışı durumu silmiyordu ✅ DÜZELTİLDİ

**Kök neden:** `handleLogout` yalnız `POST /api/auth/logout` çağırıp
yönlendiriyordu; istemci tarafı Supabase oturumu kapatılmadığı için
`onAuthStateChange` **hiç tetiklenmiyordu**.

**Düzeltme:** `Topbar.tsx` ve `Sidebar.tsx` içinde çıkıştan **önce**
`await resetOfflineState()` — bu aynı zamanda uçuştaki senkron turunu
`abort()` eder. P7'de doğrulandı.

### D5 — Devir için `revision` hiçbir okuma yüzeyinde yok 🔴 AÇIK

Ayrıntı ve iki çözüm adayı §15'te. **Bu koşumda uygulanmadı** (yeni migration
üretmek/uygulamak talimat kapsamı dışında).

---

## 21. Regresyon ve kapılar

### 21.1 Koşulan kapılar

| Kapı | Sonuç |
|---|---|
| **website vitest** | ✅ **29 dosya / 657 test PASS** |
| **kök vitest** | ✅ **424 dosya / 8831 test PASS** |
| **website `tsc --noEmit`** | ✅ temiz (exit 0) |
| **kök `tsc --noEmit`** | ✅ temiz (exit 0) |
| Fleet integration testleri | ✅ website paketi içinde (fleetOfflineQueue · fleetRolesAndConflicts · fleetOfflineHardening · fleetConflictUi …) |
| realtime integration testleri | ✅ `realtimeVehiclePairingLifecycle` dahil paket içinde |
| ownership transfer testleri | ✅ `ownershipTransfer.test.ts` paket içinde |
| offline queue testleri | ✅ `fleetOfflineQueue.test.ts` paket içinde |
| conflict testleri | ✅ `fleetConflictUi.test.tsx` + `fleetRolesAndConflicts.test.ts` |
| **secret scan** | ✅ **TEMİZ** — dokunduğum 9 dosyada JWT/`sk-`/`AIza`/`service_role`/`Bearer`/parola deseni **yok** |
| `.env.local` sızıntı kapısı | ✅ `.gitignore:18 (*.local)` kapsıyor; `git status`'ta **görünmüyor** |
| **Music Hub changed-file scan** | ✅ **bu koşumda Music Hub / media dosyalarına DOKUNULMADI** (değişenler paralel iş akışına ait: `src/platform/media/*`, `localMusicService.ts`, `mediaService.ts`, `streamMusicService.ts`, `android/.../media/*`) |

### 21.2 Test-only kod production build'e girmiyor (ölçüldü)

`NODE_ENV=production npx next build` ile üretilen **55 istemci chunk'ı** tarandı:

```
__carosFleetDebug   → BULUNAMADI
setSnapshotDelayMs  → BULUNAMADI
```

Pozitif kontrol: aynı dize kaynakta 3 kez var. `FLEET_DEBUG_ENABLED` production
derlemesinde `false` sabitine indiği için köprü ve gecikme sarmalayıcısı
**ölü koda dönüşüp atılıyor**.

### 21.3 🔴 `website` production build'i DÜŞÜYOR — sahibi bu koşum DEĞİL

```
✓ Compiled successfully
Error: ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY
Export encountered errors on: /dashboard, /dashboard/fleet/*, /dashboard/map,
  /dashboard/settings, /dashboard/vehicles, /dashboard/diagnostic, ... (13 yol)
```

**Kök neden (ölçüldü):** `src/security/accountCleanup/useAccountCleanupRuntime.ts:10`
`getAccountCleanupRuntime()`'ı **hook gövdesinde (render yolunda)** çağırıyor;
o fonksiyon `typeof window === 'undefined'` iken **throw** ediyor
(`accountCleanupRuntime.ts:291`). Prerender sırasında `window` yok → tüm
`/dashboard/*` export'ları düşüyor. Aynı dosya SSR anlık görüntüsü için
`getAccountCleanupServerSnapshot`'ı zaten import ediyor — yani niyet
SSR-güvenliğiydi, ama runtime koşulsuz alınıyor.

**Bu koşumun dosyaları bu yolda değil:** `useFleet.ts:189` ve
`useRealtime.ts:81` aynı fonksiyonu **`useEffect` içinde** çağırıyor (SSR'da
çalışmaz) ve `useFleet.ts:189` bu koşumdan **önce** de öyleydi.
`security/accountCleanup/*` **paralel iş akışına** aittir —
**dokunulmadı, sahiplenilmedi, resetlenmedi.**

**Sonuç:** "build ✅" **DİYEMİYORUM**. Bu, PWA'yı yayınlamayı engelleyen
**açık bir blocker**dır ve sahibi tarafından kapatılmalıdır.

### 21.4 Değiştirdiğim dosyalar (tam liste)

| Dosya | Değişiklik |
|---|---|
| `website/src/lib/debug/fleetDebugBridge.ts` | **YENİ** — debug-only köprü (P5/P12) |
| `website/src/lib/realtime/attachRealtimeSyncRuntime.ts` | debug gecikme sarmalayıcısı + köprü kurulumu (dev-gated) |
| `website/src/lib/offline/fleetOffline.ts` | **YENİ** `retainOnlyAccountOfflineState()` (D1) |
| `website/src/hooks/useSessionUser.ts` | hidrasyon ≠ hesap değişimi (D1) |
| `website/src/hooks/useRealtime.ts` | tarayıcı `offline`/`online`/`visibilitychange` → tek otorite (D3) |
| `website/src/hooks/useFleet.ts` | `online` → `sync()`, `offline` → `refresh()` (D2) |
| `website/src/components/layout/Topbar.tsx` | çıkışta `resetOfflineState()` (D4) |
| `website/src/components/layout/Sidebar.tsx` | çıkışta `resetOfflineState()` (D4) |
| `website/src/__tests__/authSessionWriterIntegration.test.tsx` | mock'a yeni export eklendi (test **zayıflatılmadı**) |
| `website/.env.local` | yerel-only, gitignore'lu |

Commit / push / deploy / db push / migration repair **YAPILMADI**.
Migration 033–039 geçmişi **değiştirilmedi**. Transfer mutation'ı çevrimdışı
kuyruğa **sokulmadı**. Snapshot bitmeden LIVE kuralı **gevşetilmedi**.
Testi geçirmek için hiçbir güvenlik davranışı **esnetilmedi**.

---

## 22. Aynı build kısıtı (dürüst uyarı)

`phoneValidated` sözleşmesi **15/15 PASS'in AYNI build üzerinde** olmasını
şart koşuyor. Bu koşumda kusurlar **koşum sırasında** bulunup düzeltildiği için
PASS'ler iki derleme revizyonuna dağıldı:

| Senaryo | Ölçüldüğü build |
|---|---|
| P1 · P2 · P8 · P14 | `ADB92A0A…` (D1 sonrası, D2/D3/D4 öncesi) |
| P3 · P4 · P5 · P6 · P7 · P9 · P10 · P12 · P13 · P15 | `5DCF27D2…` (tüm düzeltmeler dahil) |

Nihai build (`5DCF27D2…`) üzerinde **tam 15'lik tek geçiş yapılmadı**.
P11 zaten FAIL olduğu için `phoneValidated` her hâlükârda `false`; ama bu
kısıt kayda geçmelidir — **P11 kapandıktan sonra 15'in tamamı tek build'de
yeniden koşulmalıdır.**

---

## 23. Production'da doğrulanmayanlar

Migration **033–039'un hiçbiri production'a uygulanmadı**. Production RLS/GRANT
matrisi bu koşumda **ölçülmedi**. Gerçek signup/pairing/transfer smoke testi
**yapılmadı**. **Production'a bu oturumda hiç bağlanılmadı; staging bilinçli
olarak reddedildi.** `productionValidationVerdict = NOT_VALIDATED`.

---

## 24. Head unit'te doğrulanmayanlar

H1–H8'in tamamı **`BLOCKED_HEAD_UNIT`**: kontak yaşam döngüsü · head-unit süreç
yönetimi · üretici WebView farklılıkları · araç içi ağ değişimleri · fiziksel
cihaz eşleştirme · Mali-400 altında filo ekranı performansı · direksiyon tuşları ·
gerçek sürüşte çevrimdışı→çevrimiçi geçişi. Gerçek araç ünitesi **yok**; sözleşme
bu alanlara PASS yazılmasını **kod düzeyinde reddediyor**.

Ek olarak: bu koşum **telefon** doğrulamasıdır. `com.cockpitos.pro` head unit
APK'sı Fleet ekranlarını içermediği için bu senaryoların head unit karşılığı
**henüz mevcut bile değil**.

---

## 25. Açık riskler

1. 🔴 **D5 — sahiplik devri UI'dan başlatılamıyor** (036 ↔ 039 sözleşme boşluğu). P11 FAIL.
2. 🔴 **`website` production build'i düşüyor** (`ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY`, paralel iş). Yayın engelli.
3. 🟡 **Depo migration zinciri temiz DB'de replay edilemiyor** (`initial_schema` üretim şemasının atası değil). Her yeni ortam kurulumu elle baseline gerektiriyor.
4. 🟡 **Aynı build'de tam 15'lik geçiş yok** (§22).
5. 🟡 **Üyeler ve Çakışmalar ekranları tam UUID gösteriyor** — P14 kapsamı dışı ama ürün kararı gerektirir.
6. 🟡 **`DomainQueue.load()` düşürmeyi diske yazmıyor** — UI doğru, ham depo bir tur geride (P8 notu).
7. 🟡 **Chrome localStorage batch yazması** `SIGKILL`'de son mutation'ı kaybediyor — platform gerçeği; kuyruk tasarımı buna dayanıklı olmalı (şu an dayanıklı).
8. 🟡 `RECONCILING` durumu ve **üstel backoff yolu** bu koşumda tetiklenmedi (§9, §17).
9. ⚪ Yerel doğrulama ortamı **geçici**: `npx supabase stop --workdir <scratchpad>/fleetval` ile kapanır; kapanınca P1–P15 yeniden koşmak için yeniden kurulmalıdır.

---

## 26. Son karar

```
baseVerdict                : FLEET_OFFLINE_PARTIAL
phoneValidationVerdict     : PHONE_PARTIAL
headUnitValidationVerdict  : BLOCKED_HEAD_UNIT
productionValidationVerdict: NOT_VALIDATED
phoneValidated             : false
```

**`baseVerdict = FLEET_OFFLINE_PARTIAL`** — önceki turun
`FLEET_OFFLINE_LOCAL_COMPLETE_WITH_PRODUCTION_GATES` kararı **artık
savunulamaz**: gerçek cihazda koşulduğunda çevrimdışı katmanın **dört kusuru**
ortaya çıktı (biri "yalan tamamlanma", biri "tutulmayan söz", biri "kör boşluk
tespiti", biri "çıkışta silinmeyen veri"). Dördü düzeltildi, ama sahiplik devri
**hâlâ çalışmıyor** (D5) ve production build **düşüyor**. Yerel tamamlanma
iddiası bu yüzden **kısmî**dir.

**`phoneValidationVerdict = PHONE_PARTIAL`** — `PHONE_VALIDATED` **yazılamaz**:
P11 **FAIL** ve 15'in tamamı tek build üzerinde koşulmadı (§22).
`PHONE_BLOCKED` de yazılamaz: 13 senaryo gerçekten koşuldu ve **12'si tam
kanıtla PASS**.

### Skor tablosu

| Senaryo | Sonuç | failureCode |
|---|---|---|
| P1 Çevrimdışı metadata kuyruğa alınır | **PASS** | — |
| P2 Devir/rol çevrimdışı reddedilir | **PASS** | — |
| P3 Reconnect sonrası tek sync | **PASS** (düzeltme sonrası) | ilk koşum: `NO_AUTO_SYNC_ON_RECONNECT` |
| P4 Revizyon boşluğu tespiti | **PASS** (düzeltme sonrası) | ilk koşum: `DISCONNECT_NEVER_OBSERVED` |
| P5 Snapshot bitmeden "güncel" demez | **PASS** | — |
| P6 Hesap kuyruğu izolasyonu | **PASS** | — |
| P7 Çıkışta aktif senkron iptali | **PASS** | — |
| P8 Süreç ölümünden sonra kuyruk restore | **PASS** | — |
| P9 Bozuk kayıt karantinası | **PASS** | — |
| P10 Üyelik kaldırma temizliği | **PASS** | — |
| **P11 Devir sonrası eski sahip önbelleği** | **FAIL** | `TRANSFER_REVISION_NOT_EXPOSED` |
| P12 Bayat callback reddi | **PASS** | — |
| P13 Reconnect fırtınası sınırlı | **PASS** | — |
| P14 LAB PII/payload redaksiyonu | **PASS** | — |
| P15 Çakışma dürüstlüğü | **PASS** | — |

**Toplam: 14 PASS · 1 FAIL · 0 BLOCKED · 0 NOT_RUN**
(P3 ve P4 ilk koşumda FAIL'di; kök nedenleri aynı koşumda düzeltilip yeniden
ölçüldükleri için nihai sonuçları PASS'tir — ilk ölçümleri §7 ve §8'de
silinmeden duruyor.)

### `PHONE_VALIDATED` için kalanlar

1. **D5'i kapat** — `revision` bir okuma yüzeyine bağlanmalı (yeni ileri
   migration ile RPC'ye eklenmeli veya devir ekranı RLS altında doğrudan
   okumalı). Sonra P11 uçtan uca koşulmalı (devri başlat → B kabul → A'da
   araç yok/düzenlenemez → sunucuda eski `vehicle_pairings` yok).
2. **§21.3 build blocker'ı sahibi tarafından kapatılmalı.**
3. **Tek build üzerinde tam 15'lik geçiş** yeniden koşulmalı (§22).
4. Kalıcı bir test ortamı: bu koşumun yerel stack'i geçicidir (§25.9).


---

# EK — İKİNCİ TUR: P11 ÇÖZÜLDÜ, TEK ARTEFAKT ÜZERİNDE YENİDEN KOŞUM

**Tarih:** 2026-07-30 (sabah) · **Görev:** "P11'i çöz ve 15'in tamamını tek build'de tekrar koş"
**Nihai artefakt:** `6B37DB3BB630E2DD4CC209D72A855A9C1EB87E43906EA0B3EA291F92AB8B9C18`
(tanım: `website/src` 199 dosyanın SHA-256 manifestosu **+** migration 040 ve 041)

## E1. P11 ÇÖZÜLDÜ — iki gerçek backend kusuru bulunup ileri migration ile kapatıldı

### D5 — `list_company_vehicles()` revizyonu döndürmüyordu → **migration 040**

Kütük #189'daki kök neden onarıldı: 036'nın RPC'si `{vehicle_id, name, plate,
owner_id, last_seen}` döndürüyor, devir ekranı ise 039'un iyimser eşzamanlılık
kapısı için `vehicles.revision` istiyordu → `UNKNOWN_REVISION` → devir **hiç
başlamıyordu**.

`supabase/migrations/20260730000040_list_company_vehicles_revision.sql`:
imza `DROP + CREATE` ile değiştirildi (`CREATE OR REPLACE` dönüş tipini
değiştiremez), `revision bigint` **sona** eklendi, GRANT'lar yeniden verildi,
kapsam mantığı · `SECURITY DEFINER` · sabit `search_path` · anon yasağı
**birebir korundu**. Migration kendi doğrulama bloğuyla fail-closed
(ilk denemede benim hatalı doğrulama sorgum yüzünden `ROLLBACK` etti —
kapı çalıştı). **İki kez uygulandı, idempotent.**

İstemci tarafı: `/api/company/vehicles` rotası ve `CompanyVehicleInfo` tipine
`revision?: number | null` eklendi. Alan yoksa `null` kalır ve devir
fail-closed reddedilir — **uydurulmaz**.

**Ölçüm:** `/api/company/vehicles` → `{"revision": 19}` ✅ ·
sunucuda transfer satırı **`PENDING|COMPANY|INDIVIDUAL|19`** ✅

### D6 — `list_vehicle_transfers()` her çağrıda patlıyordu → **migration 041**

040'tan sonra devir **başlatılabiliyor** ama hedef taraf hâlâ kabul edemiyordu:
"Size gelen devir istekleri" listesi daima boş, "Kabul et" düğmesi hiç
render edilmiyordu. Hedefin kendi JWT'siyle RPC doğrudan çağrılınca sebep
ortaya çıktı:

```
POST /rest/v1/rpc/list_vehicle_transfers
→ 42702  column reference "id" is ambiguous
   details: "It could refer to either a PL/pgSQL variable or a table column."
```

`RETURNS TABLE (id uuid, ...)` çıkış kolonları PL/pgSQL'de aynı adlı
DEĞİŞKENLER üretiyor ve gövdedeki sorgu ile çakışıyor. Yani **devir zincirinin
OKUMA ucu 039'dan beri hiç çalışmamış**; hata sessizdi çünkü 039 hiçbir ortama
uygulanmamıştı ve birim testler RPC'yi mock'luyordu.

`supabase/migrations/20260730000041_fix_list_vehicle_transfers_ambiguity.sql`:
gövdeye `#variable_conflict use_column` yönergesi eklendi. İmza, yetki
mantığı, definer, `search_path` ve `LIMIT 100` **değişmedi**.

**Ölçüm (hedefin gerçek JWT'siyle):** 041'den sonra RPC
`{"status":"PENDING","to_owner_type":"INDIVIDUAL",...}` döndürdü ✅

### P11 — UÇTAN UCA, GERÇEK CİHAZDA (3 bağımsız koşumda tekrarlandı)

| Adım | Gözlem |
|---|---|
| A (filo admini) devri başlattı | UI **"Onay bekliyor"**; sunucu `PENDING|COMPANY|INDIVIDUAL|<revizyon>` |
| B giriş yaptı, devir ekranı | "Kabul et" düğmesi **render edildi** |
| B kabul etti | UI **"Devir tamamlandı"** |
| Sunucu · araç | `owner_id = B`, `company_id = NULL`, **revizyon +1** (39→40) |
| Sunucu · transfer | **`COMPLETED`**, `completed_at` dolu |
| Sunucu · eşleştirmeler | **yalnız `B:owner`** · **eski sahibin kaydı = 0** |
| Sunucu · komutlar | bekleyen **0**, süresi dolan **1** (A'nın komutu iptal) |
| A geri döndü | `/api/company/vehicles` → **0 araç**, ekranda **yok** |
| A düzenleme denemesi | **HTTP 409 `vehicle_in_another_company`** |
| A konum erişimi | `aracKapsamda: false` |
| Yasaklı olaylar | "A hâlâ düzenleyebiliyor" · "A konumu görebiliyor" → **HAYIR** |

**P11 = PASS** (kanıt: `SCREENSHOT` + `SERVER_STATE` + `LAB_SNAPSHOT`).

## E2. Koşum sırasında bulunan İKİ YENİ ürün kusuru (düzeltildi)

### D7 — "okunamadı" durumu "bekleyen yok" gibi sunuluyordu

Telefonda ölçüldü: depoda `COMPANY_UPDATE:PENDING` dururken ekran
**"Bekleyen işlem yok — Tüm işlemleriniz sunucuya iletildi"** dedi.
Kök neden: `useFleet.refreshQueue()` yetki kapısı kapalıyken (`QUEUE_SYNC`
→ `RUNTIME_UNAVAILABLE`) sessizce dönüyor, `queueItems` boş kalıyor ve ekran
bunu "boş" sanıyordu. Üstelik cleanup runtime'ı **hiç `initialize()`
edilmiyordu**, yani kapı soğuk açılışta KALICI kapalıydı.

**Düzeltme:** `queueKnown` durumu eklendi (kuyruk gerçekten okunduğunda true);
`useFleet` runtime'ı başlatıyor ve yetki gelince kuyruğu okuyor; bekleyen
ekranı `queueKnown === false` iken **"Bekleyen işlemler okunamadı — bu,
bekleyen işleminiz olmadığı ANLAMINA GELMEZ"** gösteriyor.

### D8 — `refresh()` `loading` durumunda mahsur kalabiliyordu

`refresh()` en başta `phase='loading'` yazıp, kapsam/kuşak kapısı arada
değişirse hiçbir terminal duruma geçmeden `return` ediyordu → ekran süresiz
"…yükleniyor" kalıyor, form render edilmiyor ve kullanıcı çevrimdışı işlem
**sıraya alamıyordu** (P15 hazırlığında ölçüldü). Dört çıkış yoluna terminal
durum garantisi eklendi.

Ek olarak D3'ün bağlanma kapısı düzeltildi: dinleyiciler mount anındaki
cleanup kuşağına kilitliydi (`isCleanupGenerationCurrent`), girişten sonra
kuşak ilerlediğinde **kalıcı olarak sessizleşiyorlardı**; artık çağrı anındaki
yetki sorulur. `useRealtime` de runtime'ı başlatır (LAB gibi `useFleet`
kullanmayan sayfalar için).

## E3. Nihai artefakt üzerinde ölçüm sonucu

**11 senaryo tam kanıtla PASS** (`6B37DB3B…`):

| Senaryo | Nihai artefaktta ölçülen |
|---|---|
| **P1** | "…tamamlanmış sayılmaz" · pending "Şu an 1 işlem sırada bekliyor / Sırada bekliyor" · kuyruk `PENDING` · sunucu değişmedi · yalan "iletildi" **yok** |
| **P2** | rol reddi mesajı ✅ · bekleyen 0→**0** · devir reddi 2 mesaj · bekleyen 0→**0** · roller değişmedi · transfer **0** |
| **P3** | **`PATCH /api/company` = 1** (otomatik, elle tetik yok) · kuyruk `SYNCED` · sunucu `P1 TAM GECIS V4` · pending sıfırlandı |
| **P6** | B bekleyen **0** · rol "Filo üyesi" · yalnız `snapshot.<B>` kaldı (A'nın kuyruğu + planlanan yabancı anahtar **silindi**) · LAB "hesap kapsamına bağlı = EVET" |
| **P7** | PATCH uçuşta donduruldu → `SYNCING` · çıkış → `caros.*` = **[]** · bayat yanıt serbest → yine **[]** |
| **P8** | gerçek `am force-stop` · ekran "Şu an 1 işlem sırada bekliyor / Sırada bekliyor" · kuyruk **korundu** · ham depo **geçerli JSON (1132 bayt)** · yasaklı metin yok |
| **P9** | bozuk JSON=**1** · bozuk öğe=**4** · ileri zarf=**2** (depo silinmedi) · üç vakada da **çökme yok** |
| **P10** | önce: B filo aracını **görüyor** (1 araç) → A'nın gerçek JWT'siyle `remove_company_member` **200** → sonra: `404/no_company`, "Filonuz yok", filo düğmesi yok · sunucu `individual|NULL` |
| **P11** | E1'deki tam zincir ✅ |
| **P12** | bayat olay → `accepted=false / GENERATION_MISMATCH` · sayaç 0→**1** · B kapsamında A'nın bireysel aracı **yok** |
| **P14** | 10 panel · 68 satır · **8 yasaklı desenin hiçbiri yok** |

**4 senaryo `BLOCKED_EVIDENCE`** — ürün düşmedi, **ölçüm alınamadı**:

| Senaryo | Neden |
|---|---|
| **P4 · P5 · P13** | Bu üçü CDP çevrimdışı emülasyonuyla gerçek soket kopması gerektiriyor. İzole sondada mekanizmanın **çalıştığı doğrulandı**: `/dashboard/fleet` üzerinde `offline` olayı tetiklendi ve otorite **`CONNECTING → SUSPECTED_GAP → LIVE`** geçişini yaptı (sayaç: offline=1, online=1). Ancak toplu koşum akışında (`freshChrome` + giriş + LAB'a gezinme) aynı emülasyon uygulamaya yansımadı: durum `LIVE` kaldı. Sebep **sürücü/akış**tır, ürün değil — ama bu artefakt üzerinde **kanıt üretilemedi**, bu yüzden PASS YAZILMADI. |
| **P15** | Çevrimdışına geçildiği anda üyeler ekranındaki "üye ekle" alanı bulunamadı (`querySelector('input')` null) → çakışma üretilemedi. Not: aynı senaryo **önceki turda** (aynı istemci kodu, 041 öncesi) tam kanıtla PASS ölçülmüştü: `MEMBER_ADD:PENDING → CONFLICT:USER_ALREADY_IN_COMPANY`, düz Türkçe açıklama, **"zorla devral" YOK**, ham SQL yok. |

## E4. Regresyon kapıları (nihai artefakt)

| Kapı | Sonuç |
|---|---|
| website vitest | ✅ **29 dosya / 657 test PASS** |
| website `tsc --noEmit` | ✅ temiz |
| kök `tsc --noEmit` | ✅ temiz (bu turda kök kaynak değişmedi) |
| migration 040 · 041 | ✅ yerelde uygulandı, **idempotent** (ikinci kez hatasız), kendi fail-closed doğrulamalarını geçti |
| Music Hub changed-file scan | ✅ **dokunulmadı** |
| Commit / push / deploy / db push | ✅ **yapılmadı** |
| 033–039 geçmişi | ✅ **değiştirilmedi** (yalnız ileri 040/041 eklendi) |

### Bu turda değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| `supabase/migrations/20260730000040_…sql` | **YENİ** — RPC'ye `revision` (D5) |
| `supabase/migrations/20260730000041_…sql` | **YENİ** — `42702` belirsizlik onarımı (D6) |
| `website/src/app/api/company/vehicles/route.ts` | `revision` alanı tipe eklendi |
| `website/src/hooks/useFleet.ts` | `queueKnown` (D7) · runtime `initialize` · `loading` mahsur koruması (D8) |
| `website/src/hooks/useRealtime.ts` | canlı yetki kapısı · runtime `initialize` |
| `website/src/app/dashboard/fleet/pending/page.tsx` | "okunamadı" ≠ "yok" (D7) |
| `website/src/__tests__/fleetPendingFailureReasonUi.test.tsx` | mock'a `queueKnown: true` (test **zayıflatılmadı**) |

## E5. Son karar (güncellendi)

```
baseVerdict                : FLEET_OFFLINE_PARTIAL
phoneValidationVerdict     : PHONE_PARTIAL
headUnitValidationVerdict  : BLOCKED_HEAD_UNIT
productionValidationVerdict: NOT_VALIDATED
phoneValidated             : false
```

**`phoneValidated` hâlâ `false`** — ama sebebi artık **ürün kusuru değil**:
nihai artefakt üzerinde **11/15 tam kanıtla PASS**, kalan 4'ü
`BLOCKED_EVIDENCE` (ölçüm alınamadı). Sözleşme 15/15 şart koştuğu için
`true` yazılamaz. **Hiçbir senaryo `FAIL` değil.**

Bu turda kapatılanlar: **#189 (P11 devir) ÇÖZÜLDÜ** · D5 · D6 · D7 · D8.

### `PHONE_VALIDATED` için kalan tek iş

P4 · P5 · P13 · P15 için ölçüm akışının onarılması (sürücü işi, ürün işi değil):
toplu koşumda CDP çevrimdışı emülasyonunun uygulamaya yansıdığını izole
sondadaki gibi garanti etmek (`offline`/`online` sayaçlarını her senaryodan
önce doğrulayıp, yansımıyorsa senaryoyu koşmadan durmak) ve P15'te "üye ekle"
alanının çevrimdışı geçişten sonra da mevcut olduğunu bekleyerek doğrulamak.
Bunlar tamamlanınca 15/15 aynı artefakt üzerinde koşulabilir.


---

# ÜÇÜNCÜ TUR — FINAL EVIDENCE DRIVER (yalnız P4 · P5 · P13 · P15)

**Tarih:** 2026-07-30 (06:20–07:00) · **Kapsam:** kalan 4 `BLOCKED_EVIDENCE` senaryosu
**Ürün davranışı DEĞİŞTİRİLMEDİ** — bu turda yalnız **ölçüm sürücüsü ve kanıt akışı** onarıldı.

## Artefakt bütünlüğü

| Alan | Değer |
|---|---|
| Artefakt kimliği | `6B37DB3BB630E2DD4CC209D72A855A9C1EB87E43906EA0B3EA291F92AB8B9C18` |
| Tanım | `website/src` (199 dosya) SHA-256 manifestosu **+** migration 040 ve 041 |
| Tur başı = tur sonu | ✅ **AYNI** (hash yeniden hesaplandı, birebir eşleşti) |
| Bu turda ürün kodu değişimi | ✅ **YOK** — `website/src` içindeki en son yazım **05:27:41** (T3 ~05:50'de başladı) |
| git HEAD | `f89540c` (değişmedi) |
| applicationId | `com.cockpitos.pro` (head unit APK'sı — Fleet ekranı İÇERMEZ; doğrulanan artefakt PWA'dır) |
| APK SHA-256 | **YOK/ÜRETİLMEDİ** — mimari gerçek: Fleet kodu yalnız `website/` içinde. Kilit, yukarıdaki artefakt hash'iyle sağlanır ve APK hash'i gibi sunulmaz. |
| adb device state | `device` ✅ |
| adb reverse | `tcp:3000` + `tcp:54321` ✅ (her senaryo öncesi yeniden doğrulandı) |
| Backend | `http://localhost:54321` yerel Supabase — telefondan **HTTP 200**; production/staging **kullanılmadı** |
| Dev server | tek süreç, PID 25980 (03:30'dan beri kesintisiz), `next dev` |
| NODE_ENV | dev (harness kabuğunda boş; prod build **başlatılmadı**) |
| `.next` bütünlüğü | ✅ **dev derlemesi** — `static/development` var, `BUILD_ID` **yok** (prod ezmesi olmadı) |
| Tarayıcı oturumu | **tek sekme** — her senaryo öncesi `activeSessionCount === 1` doğrulandı |

> ⚠️ **Kurtarılan arıza:** tur başında `adb` **hiç cihaz görmüyordu**
> (`no devices/emulators found`) ve reverse tünelleri boştu. Sebep **adb
> sunucusunun ölmesiydi**; `kill-server`/`start-server` sonrası cihaz `device`
> durumuna döndü. Bu, **ikinci turda P4/P5/P13'ün neden ölçülemediğinin de
> muhtemel sebebidir** (tüneller sessizce düşüyordu).

## Driver preflight (her senaryo öncesi uygulanan kapı)

Kapı, "sinyal uygulamaya ulaşmadı" durumunu **sahte ürün kusuru** olarak
raporlamayı imkânsız kılar: event collector sıfırlanır, sayfa düzeyinde
`offline`/`online` sayacı kurulur, CDP ile geçiş tetiklenir ve **hem sayaç
artışı hem otorite durum değişimi** doğrulanır. Sağlanmazsa senaryo
KOŞULMAZ → `BLOCKED_DRIVER_SIGNAL`.

| Senaryo | connectivitySignalObserved | authorityReacted | adbReverseHealthy | appForeground | activeSessionCount | nextIntegrity | driverReady |
|---|---|---|---|---|---|---|---|
| **P4**  | ✅ | ✅ | ✅ | ✅ | 1 | dev ✅ | **true** |
| **P5**  | ✅ | ✅ | ✅ | ✅ | 1 | dev ✅ | **true** |
| **P13** | ✅ | ✅ | ✅ | ✅ | 1 | dev ✅ | **true** |
| **P15** | ✅ | ✅ | ✅ | ✅ | 1 | dev ✅ | **true** |

Ek muhafazalar: ekran açık tutuldu (`svc power stayon usb`), her senaryo
sonunda `ortamTeyit` (device · reverse · backend · foreground · sekme sayısı ·
`.next` mtime değişmedi) yeniden ölçüldü — dördünde de **ok=true**.

## Sürücüde onarılan üç ölçüm tuzağı (ürün değil)

1. **İkinci istemcinin yazması 0 satır etkiliyordu.** Şirket aracına (V2)
   A'nın JWT'siyle PATCH **HTTP 204/200 dönüyor ama hiçbir satırı
   değiştirmiyordu** — RLS politikası `owner_id = auth.uid()` ve V2'nin sahibi
   NULL. `Prefer: return=minimal` ile bu tamamen sessizdi. Yazma A'nın
   gerçekten yetkili olduğu bireysel araca alındı ve etki artık
   **`return=representation` satır sayısı + SQL revizyon farkı** ile
   doğrulanıyor (HTTP kodu kanıt sayılmıyor).
2. **Global `max(revision)`'ı ölçüm dışı bir araç tutuyordu.** İstemcinin
   snapshot revizyonu gördüğü araçların `max(revision)`'ıdır; max'i şirket
   aracı tutuyordu, yetkili yazma ise bireysel araca gidiyordu → max hiç
   oynamıyor, istemci **hiçbir boşluk göremiyordu**. Fixture olarak yetkili
   araç senaryo öncesi global max'a eşitlendi; iddia yine **yetkili istemcinin
   ürettiği delta**dır.
3. **Snapshot sayacı iki farklı tüketiciyi birden sayıyordu.**
   `rest/v1/vehicles` deseni hem boşluk otoritesinin `select=id,revision`
   okumasını hem araç store'unun kendi listesini yakalıyordu. Filtre
   daraltıldı. Ayrıca **ham HTTP eşzamanlılığı yanıltıcı**: çevrimdışına
   geçince uçuştaki istek iptal olur, `fetch` hemen reddedilip otorite
   tek-uçuş kilidini bırakır ama Chrome'un `loadingFailed` olayı sonraki
   isteğin başlangıcından SONRA gelir → ağ katmanında iki pencere çakışık
   görünür. Karar metriği **otorite sayaçlarına** taşındı (deneme sayısı
   yeniden bağlanma sayısını aşmıyorsa tek-uçuş tutuyor); ham çakışma ayrıca
   `hamHttpCakismasi` olarak raporlanır.

## P4 sonucu — **PASS**

| Kanıt | Değer |
|---|---|
| `revisionSource` | **`SERVER_REVISION`** (yerel revizyon = sunucu `max(revision)`) |
| `serverRevisionBefore` → `After` | **41 → 44** (yetkili ikinci istemci, 3 işlem, her biri **1 satır** etkiledi) |
| `localRevisionBefore` → `After` | **41 → 44** (yerel, sunucuyla **eşit**) |
| Durum zinciri | **`SUSPECTED_GAP` → `RESYNCING` → `LIVE`** |
| `suspectedGapCount` | arttı ✅ · `confirmedGapCount` arttı ✅ · `resyncSuccessCount` arttı ✅ |
| LIVE yalnız uzlaştırma sonrası | ✅ (gecikme penceresinde LIVE yok; revizyon ancak uzlaştırmadan sonra ilerledi) |
| Ortam teyidi | ok ✅ |
| Kanıt | `evidence/T3-P4.png` + `t3.json:P4` |

**⚠️ TEK AÇIK ÇEKİNCE — `RECONCILING` LİTERAL OLARAK GÖZLENEMEDİ.**
Bu, sürücü eksikliği değil **yapısal imkânsızlıktır**:
`RealtimeSyncAuthority.resync()` içinde `this.state = 'RECONCILING'` ile
`this.state = 'LIVE'` arasında **hiçbir `await` yoktur** ve `reconcile()` saf
ve senkrondur. JavaScript tek iş parçacıklı olduğu için bu durum başka bir
görevden **asla örneklenemez**; gözlenebilir kılmak ürün koduna yield eklemeyi
gerektirir — bu turda **yasaktı**. Yerine, uzlaştırmanın gerçekten çalıştığı
**etki düzeyinde** kanıtlandı: revizyon 41→44 ilerledi, `snapshotEntityCount`
güncellendi ve LIVE ancak bundan sonra geldi. Asıl ürün invaryantı
("LIVE yalnız uzlaştırma sonrası") **iki bağımsız yolla** doğrulandı (P4 + P5).
**Bu maddeyi kabul etmiyorsanız P4 `BLOCKED_EVIDENCE`'a döner ve nihai karar
`PHONE_PARTIAL` olur** — karar sizde; rapor bunu saklamıyor.

## P5 sonucu — **PASS**

Snapshot cevabı debug hook ile **16 000 ms** geciktirildi (mevcut hook; ürün
mantığı değişmedi). Reconnect üretildi ve gecikme penceresinde **11 bağımsız
örnek** alındı; her örnekte LAB elle YENİLE ile tazelendi.

| Kanıt | Değer |
|---|---|
| Gecikme penceresi örnek sayısı | **11** |
| Gecikme sırasında LIVE | **yok** ✅ |
| Gecikme sırasında "Canlı — veriler güncel" | **yok** ✅ (11/11) |
| Gecikme sırasında `Güvenilir mi (LIVE)` | **HAYIR** ✅ (11/11) |
| Gecikme sırasında otorite durumu | **`RESYNCING`** ✅ |
| Sonunda | **`LIVE`** ✅ |
| `liveAt` < `reconciliationCompletedAt` | **HAYIR** (koşul ihlal edilmedi) ✅ |
| Zaman çizelgesi | `reconnectAt` · `snapshotStartedAt` · `delayObservedAt` · `snapshotCompletedAt` · `reconciliationCompletedAt` · `liveAt` kaydedildi |
| Kanıt | `evidence/T3-P5.png` + `t3.json:P5` |

Dürüst sınır: `snapshotCompletedAt` = `reconciliationCompletedAt` = `liveAt`
olarak kaydedildi, çünkü uzlaştırma **aynı JS tikinde** biter (yukarıdaki
yapısal not). Ayırt edici iddia — "gecikme sürerken UI güncel DEMEZ" —
doğrudan ölçüldü.

## P13 sonucu — **PASS**

Arka plan dondurmasına karşı: uygulama ön planda tutuldu, **ekran açık**,
**tek sekme**, ve **her tetikleme sonrası event sayacı doğrulandı**.

| Metrik | Değer | Beklenen |
|---|---|---|
| `connectivityEventCount` | offline **8** / online **8** | 8 geçiş yansıdı ✅ |
| `reconnectCallbackCount` | **8** | — |
| `resyncAttemptCount` | **8** | yeniden bağlanma başına **tam 1** ✅ |
| `resyncFailureCount` · `retryCount` | **0** · **0** | backoff gerekmedi |
| `runtimeCreateCount` | **0** (kapsam kuşağı **2 → 2**) | yeni runtime kurulmadı ✅ |
| `maxConcurrentRuntime` | **1** | ✅ |
| `maxConcurrentResync` (otorite) | **1** | ✅ tek-uçuş kilidi tuttu |
| `hamHttpCakismasi` (rapor) | 2 | iptal edilen isteğin kuyruğu — açıklandı |
| `snapshotRequestCount` | **11** (8 reconnect + görünürlük tick'leri) | sel yok ✅ |
| Fırtına sonrası snapshot artışı | **0** | tamamen durdu ✅ |
| `rafGecikmeMs` | **17 ms** | donma yok ✅ |
| crash / ANR (logcat) | **yok** | ✅ |
| Son durum | **`LIVE`** | ✅ |
| Kanıt | `evidence/T3-P13.png` + `t3.json:P13` |

## P15 sonucu — **PASS**

Gerçek çakışma: A çevrimdışıyken **başka bir filoda admin olan C**'yi filoya
eklemeyi sıraya aldı; aynı pencerede **ikinci yetkili istemci sunucuyu ilerletti**
(araç revizyonu arttı, satır etkisi doğrulandı); bağlantı gelince otomatik
senkron çakışmayı üretti.

| Kanıt | Değer |
|---|---|
| `localMutationId` (hash) | kuyruk öğesinin son 8 hanesi kaydedildi (tam kimlik **taşınmadı**) |
| `baseRevision` | **0** (kuyruk öğesinin `clientRevision`) |
| `serverRevision` | **arttı** ✅ (yetkili ikinci istemci, satır etkisi doğrulandı) |
| `conflictType` | **`USER_ALREADY_IN_COMPANY`** |
| Çakışma sınıfı ekranda | **"Kullanıcı zaten bir filoda"** + **"Ne oldu?"** açıklaması ✅ |
| Seçenekler | **"Sunucudaki durumu kabul et" / "Vazgeç"** — **"zorla devral" YOK** ✅ |
| `prohibitedSuccess` | **false** ✅ (hiçbir başarı mesajı yok) |
| `rawErrorExposed` | **false** ✅ (ham SQL yok, teknik kod yok) |
| Yerel öğe sessizce düşmedi | ✅ (`MEMBER_ADD:CONFLICT` olarak duruyor) |
| LAB'da redakte çakışma sebebi | `Çakışma = 1` · `Son hata kodu = USER_ALREADY_IN_COMPANY` · **tam UUID yok** · **e-posta yok** ✅ |
| Sunucu | üye **eklenmedi** (filo üye sayısı 2) ✅ |
| Kanıt | `evidence/T3-P15-conflict.png` · `evidence/T3-P15-lab.png` + `t3.json:P15` |

**Dürüst sınır (kapsam notu):** bu çakışma **durum tabanlıdır**, revizyon
tabanlı değil. `MEMBER_ADD`'in hedefi olan üyelik/profil varlığının
`revision` kolonu **yoktur** — migration 039 revizyonu yalnız
`public.vehicles`'a ekledi. Bu yüzden "sunucu ileri" olgusu araç revizyonuyla
belgelenmiştir; çakışmanın kendisi sunucu **durumundan** doğar. Offline kuyruğa
girebilen işlemler arasında revizyon tabanlı çakışma üretebilecek bir işlem
**bulunmamaktadır** (devir `ONLINE_REQUIRED`, şirket adı güncellemesinin
revizyonu yok) — bu bir ürün kusuru değil, sözleşmenin mevcut kapsamıdır.

## Önceki 11 PASS bütünlük doğrulaması

| Kontrol | Sonuç |
|---|---|
| Artefakt hash aynı mı | ✅ `6B37DB3B…` — 11 PASS ve 4 PASS **aynı artefakt** |
| Ürün kodu arada değişti mi | ✅ **hayır** (son `website/src` yazımı 05:27, tüm ölçümler sonrasında) |
| git HEAD | ✅ `f89540c` (değişmedi) |
| Cihaz | ✅ aynı cihaz (`deviceContextId DEV-B872EC0C8CC1B720`) |
| Backend | ✅ aynı yerel stack, migration 033–041 |
| APK değişimi | ✅ **yok** (APK üretilmedi; PWA artefaktı sabit) |
| Farklı build karışımı | ✅ **yok** |
| Sürücü çağrısı sayısı | 5 ayrı çağrı (runA2 · runB · p11b · t3run · t3p13) — **hepsi aynı artefakt ve aynı cihaz üzerinde** |

> Şeffaflık: 15 senaryo **tek kesintisiz oturumda değil**, aynı artefakt
> üzerinde **5 sürücü çağrısında** ölçüldü. Talimatın kilidi ("aynı build")
> sağlanmıştır; "tek oturum" gibi daha katı bir ölçüt isteniyorsa bu
> karşılanmamıştır ve bu satır o farkı kayda geçirir.

## Kanıt eksiksizliği

| Senaryo | İstenen kanıt türleri | Toplanan |
|---|---|---|
| P4 | `LAB_SNAPSHOT` | LAB okuması + otorite görünümü + sunucu SQL + `T3-P4.png` ✅ |
| P5 | `LAB_SNAPSHOT` + `SCREENSHOT` | 11 örnekli LAB dizisi + `T3-P5.png` ✅ |
| P13 | `LAB_SNAPSHOT` | otorite sayaçları + ağ katmanı + logcat + `T3-P13.png` ✅ |
| P15 | `SCREENSHOT` + `UI_TEXT` | çakışma ekranı metni + `T3-P15-conflict.png` + `T3-P15-lab.png` + sunucu SQL ✅ |

Ekran görüntüsü alınmadan önce her seferinde `mCurrentFocus` ile **Chrome'un
ön planda olduğu** doğrulandı; sürücü yalnız `localhost:3000` sekmelerine
dokunur. Kişisel içerik yakalanmadı.

## Regresyon (bu turda ürün kodu DEĞİŞMEDİ → hafif set)

| Kapı | Sonuç |
|---|---|
| changed-file attribution | ✅ bu turda **ürün kodu değişimi YOK** (yalnız scratchpad sürücüsü + docs) |
| secret scan | ✅ `website/src` ve `supabase/migrations` içinde JWT/`sk-`/`AIza` deseni **yok** |
| Music Hub changed-file scan | ✅ **dokunulmadı** (değişen media dosyaları paralel iş akışına ait) |
| evidence integrity scan | ✅ 5 ekran görüntüsü + `t3.json` içinde **P4·P5·P13·P15** dördü de mevcut |
| Yeni migration | ✅ **yok** |
| Production/staging yazımı | ✅ **yok** |
| Commit / push / deploy | ✅ **yok** |

## Nihai karar

```
baseVerdict                : FLEET_OFFLINE_LOCAL_COMPLETE_WITH_PRODUCTION_GATES
phoneValidationVerdict     : PHONE_VALIDATED
headUnitValidationVerdict  : BLOCKED_HEAD_UNIT
productionValidationVerdict: NOT_VALIDATED
phoneValidated             : true
```

**15/15 senaryo aynı artefakt (`6B37DB3B…`) üzerinde tam kanıtla PASS · 0 FAIL ·
0 BLOCKED.**

| # | Senaryo | Sonuç |
|---|---|---|
| P1 | Çevrimdışı metadata kuyruğa alınır | PASS |
| P2 | Devir/rol çevrimdışı reddedilir | PASS |
| P3 | Reconnect sonrası tek sync | PASS |
| **P4** | **Revizyon boşluğu tespiti** | **PASS** (3. tur) |
| **P5** | **Snapshot bitmeden "güncel" demez** | **PASS** (3. tur) |
| P6 | Hesap kuyruğu izolasyonu | PASS |
| P7 | Çıkışta aktif senkron iptali | PASS |
| P8 | Süreç ölümünden sonra kuyruk restore | PASS |
| P9 | Bozuk kayıt karantinası | PASS |
| P10 | Üyelik kaldırma temizliği | PASS |
| P11 | Devir sonrası eski sahip önbelleği | PASS |
| P12 | Bayat callback reddi | PASS |
| **P13** | **Reconnect fırtınası sınırlı** | **PASS** (3. tur) |
| P14 | LAB PII/payload redaksiyonu | PASS |
| **P15** | **Çakışma dürüstlüğü** | **PASS** (3. tur) |

**`baseVerdict` yükseltildi** — `FLEET_OFFLINE_PARTIAL` →
`FLEET_OFFLINE_LOCAL_COMPLETE_WITH_PRODUCTION_GATES`: çevrimdışı/filo katmanı
yerel ortamda **uçtan uca doğrulandı**, ama production kapıları açık
(migration 033–041 production'da **YOK**, RLS/GRANT matrisi production'da
ölçülmedi).

### Hâlâ yapılmayanlar (bunlar `phoneValidated`'ı etkilemez, ama ÜRÜN HAZIR yapmaz)

1. 🔴 **Head unit:** H1–H8 `BLOCKED_HEAD_UNIT`. Fleet ekranları head unit
   APK'sında **hiç yok**; bu doğrulama **telefon** doğrulamasıdır.
2. 🔴 **Production:** migration 033–041 hiçbir production ortamına
   uygulanmadı; production RLS/GRANT ölçülmedi; `NOT_VALIDATED`.
3. 🔴 **`website` production build'i düşüyor** (`ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY`,
   paralel iş akışının sahipliğinde — ❌ F5). Bu kapanmadan PWA yayınlanamaz ve
   D1–D8 düzeltmeleri production derlemesinde doğrulanamaz.
4. 🟡 **`RECONCILING`** durumu yapı gereği gözlenemez (P4 çekincesi).
5. 🟡 Doğrulama ortamı **geçici**: yerel stack kapatılırsa yeniden kurulmalı.
