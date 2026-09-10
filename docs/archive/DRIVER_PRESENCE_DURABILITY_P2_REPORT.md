# CAROS PRO — DRIVER PRESENCE DURABILITY P2 RAPORU

**Tarih:** 2026-07-31
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** Driver Presence History altyapısının üretim seviyesine yaklaştırılması
(kapanış idempotensi · araç bağı · kalıcılık · eşzamanlılık · gözlemlenebilirlik).
**Mevcut resolver:** **DEĞİŞTİRİLMEDİ**
**Presence History → trip attribution:** **BAĞLANMADI** (defter hâlâ karar değil)
**NFC / Bluetooth implementasyonu:** **YAPILMADI** (kapsam dışı)
**Commit / push / deploy / db push:** **YAPILMADI**

---

## 1. NİHAİ KARAR

### **`COMPLETE_LOCAL`**

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`COMPLETE_LOCAL`** |
| `presenceResolverRegressionVerdict` | **`PRESERVED`** |
| `presenceHistoryRegressionVerdict` | **`PRESERVED`** |
| `realDeviceValidationVerdict` | **`BLOCKED_REAL_DEVICE`** |
| `productionValidationVerdict` | **`NOT_VALIDATED`** |

**Neden `COMPLETE_LOCAL`, `COMPLETE` değil:** altı istenen işin tamamı yerelde
uygulandı ve gerçek PostgreSQL'de kanıtlandı, ancak gözlem ÜRETEN gerçek bir
kaynak (NFC/Bluetooth) hâlâ yoktur → defter gerçek veriyle **hiç dolmadı**,
gerçek head unit'te **hiç koşmadı**. Kanıtsız `PASS` verilmedi.

---

## 2. NE DEĞİŞTİ — ÜÇ AÇIK KAPI KAPANDI

P1 defteri kurmuştu; P2 onu **kanıt** hâline getirdi. Kapatılan üç kapı:

| # | Açık kapı (P1) | Somut zarar | P2 çözümü |
|---|----------------|-------------|-----------|
| 1 | Kapatma `UPDATE`'lerinde `expired_at IS NULL` koşulu **yoktu** | Bakım fonksiyonu segmenti `TTL_EXPIRED` ile kapattıktan sonra trigger **aynı** segmenti `SUPERSEDED` ile yeniden kapatabilir, kapanış anını ve süresini sessizce değiştirebilirdi → defter kanıt olmaktan çıkar | Tüm kapatmalarda idempotens koşulu + **kapanış değişmezlik trigger'ı** (son savunma) |
| 2 | Açık segment **kilitsiz** okunuyordu | Aynı araca eşzamanlı iki gözlem: ikisi de "açık segment yok" görür, `vdph_single_open_per_vehicle` ikincisini reddeder ve **gözlemin tamamı** hata ile geri alınırdı | Araç başına `pg_advisory_xact_lock` + açık segment `FOR UPDATE` ile okunur |
| 3 | `company_id` **istemcinin iddiasıydı** | A şirketinin kimliğiyle B şirketinin aracına gözlem yazılabilir, gözlem **yanlış tenant'ın** ekranında görünürdü | `_presence_binding_guard` BEFORE INSERT trigger'ı: araç–şirket ve sürücü–şirket bağı fail-closed doğrulanır |

TS tarafında ek olarak **kalıcılık yoktu**: uygulama yeniden başlayınca açık
segment ve `refreshCount` kayboluyordu — defter, tam da cevaplamak için var
olduğu soruya ("ne kadar kaldı?") yanlış cevap veriyordu.

---

## 3. YAPILAN İŞLER (istenen altı madde)

### 3.1 Presence TTL kapanışı güvenli hâle getirildi

**PostgreSQL** (`_presence_history_trigger`, `settle_expired_presence_history`):

- Tüm kapatma `UPDATE`'lerine `AND expired_at IS NULL` eklendi → bir segment
  **ancak açıkken** kapatılabilir; ikinci kapanış hiçbir satırı etkilemez.
- Yarışta **ilk kapanış kazanır**; kapatamayan yol yeni segment açmaz
  (tek-açık invaryantını kırmaktansa gözlemi defterde göstermemek yeğdir —
  gözlemin kendisi `vehicle_driver_presence`'ta durur ve resolver onu görür).
- `settle_expired_presence_history()` artık `FOR UPDATE SKIP LOCKED` kullanır:
  eşzamanlı ikinci koşum **tıkanmaz**, kilitli satırı atlar.
- Yeni **`trg_presence_history_closure_immutable`**: kapanmış bir satırın
  `expired_at` · `duration_ms` · `close_reason` · `detected_at` · `expires_at`
  alanları **değiştirilemez** (mantık bozulsa bile DB reddeder).

**TypeScript** (`driverPresenceHistory.ts`):

- `closeEntry` kapanmış segmenti **aynen döndürür** (ikinci kapanış yazılmaz).
- `isOpenSegment` artık `expiredAt === null && closeReason === null` —
  "kapanış anı bilinmeden kapatılmış" (`CLEARED`, süre `null`) bir segment
  yeniden açık sayılmaz; eskiden bu, o segmentin TTL ile ikinci kez
  kapatılmasına ve gerekçesinin sessizce değişmesine yol açardı.

### 3.2 Vehicle binding güçlendirildi

**PostgreSQL** — `_presence_binding_guard` beş kapıyı fail-closed kapatır:
araç yok · araç şirketsiz (bireysel) · `company_id` araçla uyuşmuyor ·
sürücü yok · sürücü aracın şirketine ait değil.

**TypeScript** — `DriverPresenceStore`:

- Yeni `bindVehicle(vehicleId, nowMs)`: bağın kaynağı **sunucunun verdiği araç
  kaydıdır** (`getVehicleIdentity().vehicleId`), gözlem yükü değil.
- `record()` üç kapıdan geçer: bozuk gözlem · **bağ yok** · **iddia edilen araç
  bağdan farklı**. Her ret ayrı sayılır (`bindingRejectedCount`) ve gerekçesi
  LAB'da görünür.
- Segmentin `vehicleId`'si artık **yalnız doğrulanmış bağdan** yazılır. P1'de
  gözlemin taşıdığı `vehicleId` doğrudan deftere geçiyordu — yani istemci
  defteri istediği araca yazabiliyordu.
- Bağ **değişirse** defter devredilmez, sıfırlanır (başka aracın geçmişini bu
  araca taşımak defteri yalan yapardı).

`presenceVehicleBinding.ts` köprüsü **ayrı dosyadadır**: resolver'ın bağımlılık
grafiğine kimlik/ağ servisi sokulmaz.

### 3.3 TS presence deposu kalıcı hâle getirildi

`driverPresencePersistence.ts` (yeni, **saf**: I/O yok · `Date.now()` yok):

- Şema **sürümlü** (`v1`), anahtar `fleet:presenceLedger:v1`.
- Çözümleme **fail-closed**: bozuk JSON · yanlış sürüm · şema ihlali ·
  invaryant ihlali · **başka araca ait defter** → tümü gerekçesiyle reddedilir.
  Kısmi onarım YAPILMAZ (kısmen okunan bir defter, okunamayandan tehlikelidir).
- DB'deki kilitlerin TS karşılıkları doğrulanır: yarım kapanış yasağı ·
  tek açık segment · sıralılık · tanınmayan enum reddi.
- Depo **tembel** hidratlanır (ilk erişimde, timer YOK — zero-leak).
- Yazma düşerse **gözlem kaybolmaz** (bellekteki defter geçerli), yalnız
  `WRITE_FAILED` LAB'da görünür.

**Yeniden başlatma davranışı** (test D1–D3): açık segment, `detectedAt`,
`refreshCount` ve kapanmış kayıtlar korunur; **kayıp dönem tahmin edilmez**.

### 3.4 Reconnect senaryoları doğrulandı

| Senaryo | Beklenen | Kilit |
|---------|----------|-------|
| Aynı presence yeniden | segment **uzar**, yeni satır yok, `refreshCount++` | TS `B1` · PG `C2` |
| Yeni presence | önceki `SUPERSEDED`, süre ölçülür, `switchCount++` | TS `B2` · PG (050 H7) |
| Süre dolarsa | `TTL_EXPIRED`, kapanış = **gözlemin kendi TTL'i** | TS `B3` · PG `D1/D2` |
| Clear | `CLEARED`; an bilinmiyorsa süre **`null`** | TS `B4`/`C4` |
| **Replay** (tekrar oynatma) | defter **değişmez**, `replayCount++` | TS `D2`/`H2` · PG `C1` |

`replayCount` bilinçli olarak `duplicateCount`'tan ayrıdır: "zaten işlenmiş
gözlemin tekrarı" ile "aynı kimlikte YENİ gözlem" farklı olaylardır.

### 3.5 CAROS LAB — Durability bölümü

`Presence History` ekranına **salt-okunur** `Durability (P2)` bölümü eklendi:

| İstenen alan | Ekrandaki karşılığı | Kaynak |
|---|---|---|
| Persistence Status | `persistenceState` (`UNINITIALIZED·EMPTY·RESTORED·REJECTED·READ_FAILED·WRITE_FAILED`) | gerçek depo durumu |
| Last Restore | `lastRestore` + `restoredSegments` + `snapshotSaved` | gerçek geri yükleme |
| Expiry Worker Status | `expiryMode = LAZY_ON_ACCESS` | **gerçek tasarım** |
| Expired Segment Count | `expiredSegmentCount` (+ `openSegmentCount`) | defterden türetilir |
| Vehicle Binding Status | `vehicleBindingState` + `boundVehicleRef` + `bindingRejectedCount` + `lastRejectReason` | gerçek bağ |
| Last Failure | `lastFailure` (bounded KOD) + `lastFailureAt` | gerçek arıza |

Kurallara uyum: **aktif komut YOK** (yalnız YENİLE) · timer YOK ·
sabit/örnek veri YOK · bilinmeyen alan `UNAVAILABLE` · **PII YOK**
(araç kimliği `veh:xxxxxxxx` olarak kısaltılır).

⚠️ **`expiryMode` bilerek `LAZY_ON_ACCESS` yazar:** head unit'te presence'ı
kapatan bir timer **yoktur** (zero-leak) ve olmayacaktır. Ekranda "worker
çalışıyor" gibi bir şey göstermek **sahte sağlık** olurdu.

### 3.6 Gerçek PostgreSQL testleri

Koşum ortamı: **yerel Supabase yığını** (`127.0.0.1:54322`), migration
zinciri 033→051 uygulanmış. Production ve staging'e **hiç bağlanılmadı**.

| Dosya | Kapsam | Sonuç |
|---|---|---|
| `supabase/migrations/…051_driver_presence_durability_p2.sql` | migration + kendi fail-closed doğrulaması | **uygulandı**, iki kez koştu (idempotent) |
| `local_051_presence_durability_p2.sql` | 22 kontrol (aşağıda) | **22/22 PASS** |
| `local_051_concurrent_seed/check.sql` | eşzamanlı TTL kapanışı | **4/4 PASS** |
| `local_049_driver_presence.sql` (regresyon) | resolver matrisi | **19/19 PASS** |
| `local_050_driver_presence_history.sql` (regresyon) | defter matrisi | **27/27 PASS** |

**051 matrisi:**

```
B1  yanlis arac REDDEDILDI (binding mismatch)              PASS
B2  cross-tenant SURUCU REDDEDILDI                         PASS
B3  SAHTE company_id iddiasi REDDEDILDI                    PASS
B4  bireysel (sirketsiz) arac REDDEDILDI                   PASS
B5  var olmayan arac REDDEDILDI                            PASS
B6  DOGRU bag hala kabul ediliyor                          PASS
C1  10x REPLAY tek segment kaldi (duplicate YOK)           PASS
C2  TAZELEME sayildi, yeni satir uretilmedi                PASS
D1  suresi gecen segment TTL ile KAPANDI                   PASS
D2  kapanis ani = gozlemin TTL i (uydurma YOK)             PASS
D3  IKINCI cagri HICBIR satiri etkilemedi (idempotent)     PASS
D4  kapanis DEGERLERI degismedi (2x kapanma yok)           PASS
E1  kapanmis segmenti degistirme REDDEDILDI                PASS
F1  ONCE kapanan segment SUPERSEDED ile EZILMEDI           PASS
F2  yeni segment ACILDI ve TEK acik segment var            PASS
G1  RESOLVER kararlari AYNEN calisiyor (PRESENCE_ONLY)     PASS
G2  gozlemsiz aralikta NO_PRESENCE KORUNDU (fail-closed)   PASS
G3  GECMIS defter fallback URETMEDI (defter != karar)      PASS
H1  kapanan her segmentin SURESI+GEREKCESI var             PASS
H2  arac basina TEK acik segment invaryanti KORUNDU        PASS
I1  B admini A gecmis kayitlarini GOREMIYOR (RLS)          PASS
I2  kullanici defteri kapatamaz (yalniz service_role)      PASS
```

**Eşzamanlı kapanış — iki ölçüm:**

1. **Paralel koşum:** 12 araçta açık+süresi geçmiş segment; 3 psql süreci
   aynı anda `settle_expired_presence_history()` çağırdı →
   `12 + 0 + 0 = 12`. Toplam, tohumlanan sayıyı **aşmadı** (çift kapanış yok).
2. **Deterministik çekişme (asıl kanıt):** bir oturum 5 satırı `FOR UPDATE`
   ile kilitli tutarken başka bir oturum bakım fonksiyonunu çağırdı →
   **`7` döndü, tıkanmadı**; kilit bırakılınca ikinci çağrı **`5`** döndü.
   Toplam tam 12; hiçbir satır iki kez kapanmadı, hiçbir çağrı beklemedi.

Ardından `K1–K4`: 12 segmentin tamamı kapandı · yarım kapanış yok ·
her segment **kendi TTL'inde** kapandı · hepsi `TTL_EXPIRED`.

---

## 4. "RESOLVER DEĞİŞMEYECEK" — NASIL GARANTİ EDİLDİ

| # | Kapı | Nerede |
|---|------|--------|
| 1 | Migration 051 `_resolve_driver_presence`, `_resolve_trip_driver`, `_trip_attribution_trigger` fonksiyonlarını **yeniden tanımlamaz** | Migration gövdesi |
| 2 | Migration kendi doğrulamasında resolver'ı **ÇAĞIRIR**: gözlem yokken `NO_PRESENCE` dönmezse migration **DÜŞER** | 051 doğrulama (c) |
| 3 | Attribution trigger gövdesinde `presence_history` geçerse migration **DÜŞER** | 051 doğrulama (d) |
| 4 | 049 matrisi (19/19) ve 050 matrisi (27/27) 051 uygulandıktan **sonra** yeniden koştu | §3.6 |
| 5 | TS kilidi: `resolveDriverPresence` gövdesinde `safeGetRaw`/`safeSetRaw`/`snapshot`/`history`/`_boundVehicleId` geçmesi **YASAK** | Test `F1` |
| 6 | TS kilidi: defter dolu + kalıcı kayıttan geri yüklenmiş durumda resolver çıktısı **bit bit aynı** | Test `F2` |
| 7 | TS kilidi: defter doluyken de `HEAD_UNIT` gözlemi `PRESENCE_UNUSABLE` kalır (fail-closed) | Test `F3` |

**Presence History → trip attribution kaynağı DEĞİL:** PG `G3` kilidi,
kapanmış bir geçmiş kaydının bulunduğu zaman aralığı sorulduğunda resolver'ın
hâlâ `NO_PRESENCE` döndüğünü kanıtlar — defter fallback **üretmez**.

---

## 5. TEST SONUÇLARI (tamamı bu turda koşuldu)

| Kapı | Komut | Sonuç |
|---|---|---|
| PostgreSQL — P2 matrisi | `psql -f local_051_presence_durability_p2.sql` | **22/22 PASS** |
| PostgreSQL — eşzamanlılık | seed + 3 paralel settle + check | **4/4 PASS** (12 = 12) |
| PostgreSQL — 049 regresyon | `psql -f local_049_driver_presence.sql` | **19/19 PASS** |
| PostgreSQL — 050 regresyon | `psql -f local_050_driver_presence_history.sql` | **27/27 PASS** |
| PostgreSQL — migration idempotens | 051 iki kez uygulandı | **temiz** |
| Vitest (kök) | `npx vitest run` | **9366/9366 · 441 dosya** |
| Vitest (website) | `npx vitest run --config vitest.config.ts` (website dizininde) | **866/866 · 41 dosya** |
| TypeScript | `npx tsc -b` | **temiz** |
| Build | `npm run build` | **başarılı (1 dk 37 sn)** |
| ESLint (değişen dosyalar) | `npx eslint src/platform/fleet …` | **temiz** |

> ⚠️ Website testleri **website dizininden** koşulmalıdır: kök dizinden
> `--config website/vitest.config.ts` ile çağrıldığında dosya okuyan 5 test
> `process.cwd()` yüzünden düşer. Bu bir ürün kusuru değil, koşum yolu
> tuzağıdır — rapora yazıldı ki bir dahaki turda "regresyon" sanılmasın.

Yeni TS kilitleri: `driverPresenceDurability.test.ts` — **39 test**
(A araç bağı 5 · B reconnect 4 · C kapanış idempotensi 4 · D kalıcılık 7 ·
E fail-closed çözümleme 8 · F resolver regresyonu 5 · G LAB yüzeyi 4 ·
H özet tutarlılığı 2).

---

## 6. BİLİNÇLİ OLARAK YAPILMAYANLAR

| Yapılmadı | Gerekçe |
|---|---|
| NFC / Bluetooth üreticisi | Kapsam dışı. Gözlem üreten yol olmadığı sürece attribution P0'daki gibi davranır — bu, katmanın **güvenlik tasarımıdır**. |
| Gerçek bir "expiry worker" (timer/cron) | Head unit'te timer kurmak zero-leak kuralını çiğner; sunucuda cron bu turun kapsamı değil. Kapanış **tembeldir** ve LAB bunu olduğu gibi söyler. |
| `presenceVehicleBinding` üretim yoluna bağlanmadı | Bağlanacak bir gözlem üreticisi yok. Bağ kurulmadığı sürece **her gözlem reddedilir** (fail-closed) — sessiz varsayım üretmemek için bilinçli. |
| Website'te Durability görünümü | Head unit LAB'ı hedeflendi; `list_vehicle_presence_history` sözleşmesi değişmedi. |
| Presence History'nin attribution'a bağlanması | **Yasak** (görev kuralı) — defter karar katmanı değildir. |

---

## 7. AÇIK BORÇLAR (kütüğe yazıldı)

| # | Borç | Kütük |
|---|------|-------|
| 1 | Gerçek NFC/BT gözlemi hiç üretilmedi → defter gerçek veriyle hiç dolmadı | #235 (mevcut) · #242 |
| 2 | `settle_expired_presence_history()` çağıran bir zamanlayıcı **yok** — kapanış tembel | #237 (mevcut) · #243 |
| 3 | Araç bağı üretimde hiç kurulmadı (çağıran yol yok) | #244 |
| 4 | Kalıcılık gerçek head unit'te (WebView kill / gece kapanış) hiç sınanmadı | #245 |
| 5 | Eşzamanlılık gerçek çok-istemcili trafikte değil, kontrollü kilitle ölçüldü | #246 |

---

## 8. DEĞİŞEN DOSYALAR

**Yeni**
- `supabase/migrations/20260731000051_driver_presence_durability_p2.sql`
- `supabase/verification/local_051_presence_durability_p2.sql`
- `supabase/verification/local_051_concurrent_seed.sql`
- `supabase/verification/local_051_concurrent_check.sql`
- `src/platform/fleet/driverPresencePersistence.ts`
- `src/platform/fleet/presenceVehicleBinding.ts`
- `src/__tests__/driverPresenceDurability.test.ts`
- `docs/DRIVER_PRESENCE_DURABILITY_P2_REPORT.md`

**Değişen**
- `src/platform/fleet/driverPresenceHistory.ts` (idempotens · `lastDetectedAt` · `replayCount` · `expiredSegmentCount`)
- `src/platform/fleet/driverPresence.ts` (**yalnız depo** — resolver gövdesine dokunulmadı)
- `src/components/devtools/screens/FleetPresenceHistoryScreen.tsx` (Durability bölümü)
- `src/platform/devtools/carosLabCatalog.ts` (ekran notu)
- `src/__tests__/driverPresence.test.ts` · `driverPresenceHistory.test.ts`
  (3 kilit **yeni doğru davranışa taşındı** — kaldırılmadı: araç bağı artık zorunlu)

---

## 9. SAHA DOĞRULAMA — NE GÖZLENMELİ

Gerçek NFC/BT kaynağı bağlandığında ve gerçek head unit'te:

1. Kart okutulduktan sonra uygulama **öldürülüp yeniden açıldığında** LAB'da
   `persistenceState = RESTORED` ve `refreshCount` **korunmuş** olmalı.
2. Araç bağı kurulmadan gelen gözlem **yazılmamalı**;
   `bindingRejectedCount` artmalı, `lastRejectReason = VEHICLE_NOT_BOUND`.
3. Vardiya devrinde önceki segment `SUPERSEDED`, süre **gerçek** olmalı.
4. 8 saat sonra segment `TTL_EXPIRED` olmalı; kapanış anı **TTL** olmalı
   (okuma anı değil).
5. Aynı gözlem çevrimdışı kuyruktan tekrar yüklendiğinde `replayCount` artmalı,
   `segmentCount` **artmamalı**.
6. Head unit çevrimdışıyken defter büyümemeli, `droppedSegments = 0` kalmalı.

Bu ölçütler gözlenene kadar `realDeviceValidationVerdict` = **`BLOCKED_REAL_DEVICE`**.
