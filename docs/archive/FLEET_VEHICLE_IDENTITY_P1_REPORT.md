# CAROS PRO — FLEET VEHICLE IDENTITY P1 RAPORU

**Tarih:** 2026-07-30
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** P0'dan kalan en büyük teknik borcun kapatılması — hazır olan Vehicle
Identity Pipeline'ın **gerçek veri kaynaklarına bağlanması**
**Commit / push / deploy / db push:** YAPILMADI (kural gereği)

---

## 1. EXECUTIVE SUMMARY

### Nihai karar: **`COMPLETE_LOCAL`**

Kimlik boru hattı artık **canlı** ve **uçtan uca yerel kanıtı var**. P0 raporunda
"en büyük açık borç" olarak yazdığım madde kapatıldı: `reportVehicleIdentity()`
yazılmıştı ama **hiçbir yerden çağrılmıyordu**; artık gerçek üretici zincirine
bağlı.

**Gerçek araç doğrulaması YAPILMADI** — kütükte #203–#208 🔴 bekliyor (§9).
Bu rapordaki hiçbir PASS gerçek araç veya gerçek telefon gözlemine dayanmaz.

### Bu turda bulunan ve düzeltilen **dört gerçek kusur**

| # | Kusur | Nasıl bulundu | Etki (düzeltilmeseydi) |
|---|-------|---------------|------------------------|
| **K1** | Kimlik yayını **hiç çağrılmıyordu** | P0 raporundaki açık borç | Kimlik sunucuya HİÇ gitmez |
| **K2** | **`22P02`** — istemci `fingerprint_version`'ı `'fp1'` (metin) gönderiyor, 042'deki RPC `int` bekliyordu | gerçek PostgreSQL çağrısı | Kimlik çağrısının **TAMAMI** düşer |
| **K3** | **`42P01`** — kimlik OKUMA RPC'si var olmayan `public.company_members` tablosuna bakıyordu (üyelik `profiles.company_id`'de) | gerçek oturumla (`auth.uid()`) çağırma | Fleet UI'da kimlik **HİÇ görünemez** |
| **K4** | Koordinatörün async yayın yolunda üst düzey muhafız yoktu → **yakalanmayan promise reddi** ve `_inFlight` sonsuza dek `true` | kendi yazdığım kilit testi (#29) | Kimlik yayını **kalıcı olarak susar** |

**K2 ve K3 kendi P0 çalışmamın kusurlarıdır.** İkisi de "test yeşil + tsc temiz"
olmasına rağmen vardı; ikisi de yalnız **gerçek PostgreSQL'de gerçek oturumla**
çalıştırınca ortaya çıktı. K3'ün özellikle öğretici yanı: 042/043 doğrulamam
fonksiyonun **gövde metnini** inceliyordu (`pg_get_functiondef ... LIKE`) ve
oturumsuz çağrıyı sınıyordu — oturumsuz çağrı `auth.uid() IS NULL` dalında
**erken dönüyor**, yani hatalı satıra hiç ulaşmıyordu.

> **Ders (kalıcı):** Bir fonksiyonun *tanımını* okumak onu *çalıştırmak* değildir.
> Erken dönen bir dal, sonraki satırların doğruluğunu KANITLAMAZ.

---

## 2. KİMLİK KAYNAKLARI (§1 — koddan doğrulanmış, tahmin değil)

Zincir baştan sona izlendi. Her satır repoda doğrulanabilir:

| Veri | Üreten dosya | Fonksiyon | Yaşam döngüsü | Güven |
|------|--------------|-----------|---------------|-------|
| **Ham VIN** (Mode 09 PID 02) | `src/platform/nativePlugin.ts` → native | `CarLauncher.performHandshake()` → `raw09` | Bağlantı/handshake anında, TEK sefer | En güçlü kanıt; birçok araç `0902`'yi DESTEKLEMEZ → VIN'siz profil NORMALDİR |
| **VIN ayrıştırma + PID bitmap** | `src/core/val/OBDHandshake.ts` | `buildHandshakeResult(raw)` → `{vin, supportedPids, readBlocks}` | handshake yanıtı gelince | `readBlocks` zero-trust kapısı: yalnız OKUNAN bloklarda "desteklenmiyor" çıkarımı |
| **Profil eşleşmesi** | `src/core/val/VehicleProfile.ts` | `vehicleProfileRegistry.findBestMatch(vin, supportedPids)` | handshake sonrası | Profil ipucu — KARAR DEĞİL |
| **VIN kalıcılığı** | `src/platform/vehicleProfileService.ts` | `persistHandshakeVin()` → `setHandshakeVin()` | handshake sonrası; 17 hane + ISO 3779 karakter kapısı | Şekli tutmayan VIN REDDEDİLİR |
| **Marka** | `src/platform/canBus/VehicleHandshake.ts` | `decodeWmi(vin)` → `WMI_MAKE[vin[0..2]]` | VIN değişince | Sözlükte yoksa `null` (tahmin YOK) |
| **Model yılı** | aynı dosya | `decodeVinYear(vin)` → `VIN_YEAR_MAP[vin[9]]` | VIN değişince | Haritada yoksa `null` |
| **Model** | kullanıcı araç profili | `profile?.name` | profil seçilince | Kullanıcı girdisi — VIN'e bağlı DEĞİL |
| **Aktif protokol** | `src/platform/obdStorage.ts` | `updateObdAdapterInfo({lastProtocolNum, isTransportVerified})` | bağlantı kurulunca | **Taşıma doğrulanmadıysa "aktif" SAYILMAZ** |
| **ECU adresleri** | `src/platform/obd/discovery` | `discoveryCaptureService.getObservations()` | keşif turlarında birikir | Ham girdi — sunucuya GİTMEZ |
| **Parmak izi hash'i** | `src/platform/vehicleFingerprintService.ts` | `canonicalFingerprintKey()` → `fingerprintHash()` (çift tohumlu FNV-1a) | girdi imzası değişince | Deterministik kimlik; metadata/zaman DAHİL DEĞİL |
| **Öğrenilmiş güven** | `src/platform/vehicleFingerprintBuilder.ts` | `ingestVehicleFingerprint()` | her yeni gözlemde `+CONFIDENCE_STEP` | Yerel öğrenme; sunucu güveninden AYRI |
| **Canlı tetikleyici** | aynı dosya | `AutomaticVehicleFingerprint._onVidChange()` (SystemBoot:830) | `useVidStore` aboneliği + imza guard'ı | Telemetri tick'lerinde iş YAPMAZ |

### VID buluşma noktası

`useVidStore` (`src/store/useVidStore.ts`) dört grubu taşır; kimlik için ilgili
olanlar `vehicle{vin,make,model,modelYear,vehicleType}` ve
`obdAdapter{lastProtocolNum,isTransportVerified,lastAddress,lastTransport}`.
Yazanlar YALNIZ ikisi: `vehicleProfileService._mirrorVehicleToVid()` (tek yönlü
ayna) ve `obdStorage`.

### §1'de sorulup **BULUNAMAYAN** iki şey (dürüst kayıt)

- **`vehicleFingerprintService` PID bitmap'ini kimlik hesabına ALMIYOR.**
  `assembleFingerprintInput()` `supportedPidBitmap` alanını hiç GEÇMİYOR →
  `normalizePidBitmap('')` → boş. Yani imza eşleşmesi (0.80 güven) fiilen
  yalnız `protocol + ecuAddresses` üzerinden çalışıyor. **Bu turda
  DEĞİŞTİRİLMEDİ**: bitmap eklemek TÜM mevcut hash'leri değiştirir ve
  saklanmış parmak izlerini "araç değişti" gibi gösterir. Açık borç (§10).
- **`fleetKb.buildFingerprint`** (`src/platform/obd/fleetKb.ts`) ikinci, ayrı bir
  parmak izi üreticisidir ve kimlik zincirinde KULLANILMIYOR (ölü kod —
  daha önce de kütüğe girmişti). Bu tura DAHİL EDİLMEDİ.

---

## 3. CANONICAL VEHICLE IDENTITY (§2)

`src/platform/telemetry/vehicleIdentityObservation.ts` — **saf** (I/O · timer ·
`Date.now()` · React · global durum YOK).

`VehicleIdentityObservation` alanları: `vin · vinSource · make · model ·
modelYear · activeProtocol · fingerprintHash · fingerprintVersion · confidence ·
observedAt · source · identityRevision · vehicleGeneration`
(§2'de istenen 13 alanın tamamı).

### Kanıt kapıları (kilitli)

| Kural | Davranış |
|-------|----------|
| Geçersiz VIN | `vin` VE `vinSource` **ikisi de** `null` (kaynaksız VIN yalanı olmaz) |
| VIN yok | `make`/`modelYear` de `null` — bunlar **VIN türevidir**, tahmin ÜRETİLMEZ |
| Taşıma doğrulanmadı | `activeProtocol = null` (öğrenilmiş ≠ aktif) |
| Parmak izi yok | `fingerprintVersion` de taşınmaz |
| Nesil | YALNIZ marka **ve** yıl varsa türer (`deriveVehicleGeneration`); 5 yıllık kova — **ipucudur, karar değil** |
| Revizyon | İstemcide **ÜRETİLMEZ**; sunucudan bilinen değer taşınır, yoksa `null` |

### Otorite sınırları (yapısal kilit)

- Gözlemde `device_id` **YOK** (test #27) — head unit değişebilir, araç aynı kalır.
- Gözlemde sahiplik alanı **YOK** (test #28) — `ownerId`/`userId`/`companyId` yok.
- Gözlemde ham parmak izi girdisi **YOK** (test #26) — `ecuAddresses`,
  `supportedPidBitmap`, `adapterMac`, `metadata` taşınmaz.

---

## 4. KOORDİNATÖR (§3)

`src/platform/telemetry/vehicleIdentityCoordinator.ts` + ince kablolama
`vehicleIdentityRuntime.ts`.

```
OBD handshake → VID store → Fingerprint store
     ↓  (AutomaticVehicleFingerprint._onVidChange — canlı, SystemBoot:830)
observeVehicleIdentity()        ← TEK giriş
     ↓
Validation  evaluatePublishable()      → kanıtsız gözlem GİTMEZ
     ↓
Dedupe      identitySignature()        → aynı kimlik GİTMEZ
     ↓
Publish     telemetryService.publishIdentityObservation()   ← TEK ağ ucu
     ↓
Sunucu hükmü  CREATED · UPDATED · UNCHANGED · PROTOCOL_CHANGED · IDENTITY_CONFLICT
```

### "Hiçbir modül doğrudan çağırmasın" — **yapısal olarak** kilitli

Test #14 tüm kimlik dosyalarını tarayıp `.publishIdentityObservation(`
çağıranların listesinin **tam olarak `[vehicleIdentityRuntime.ts]`** olduğunu
doğruluyor. Test #15 üreticinin `callVehicleRpc`/`record_vehicle_identity`'yi
hiç görmediğini doğruluyor.

### Hot-path disiplini

- `observe()` **senkron**, ağ çağrısı yapmaz; yayın `queueMicrotask` ile
  zustand abonelik yolundan **çıkarılır** (test #30: aynı tick'te `publish`
  çağrılmıyor).
- 3 Hz telemetri tick'i yayın **tetiklemez**: imza değişmedikçe iş yapılmaz
  (test #4: aynı kimlik 50 kez → **1** yayın, 49 dedupe).
- Zamanlayıcı **DI** ile alınır; koordinatör içinde gömülü `setTimeout` YOK
  (test #18).

### Zero-leak

`stop()` bekleyen retry timer'ını temizler (test #23); kapatma sonrası gelen
yanıt durumu **değiştirmez** (generation guard, test #24); SystemBoot cleanup
zincirine kayıtlı (test #19).

---

## 5. VALIDATION VE GÜVEN POLİTİKASI (§4)

| Girdi | Davranış | Kanıt |
|-------|----------|-------|
| VIN okunamadı | `null` | test #2 · PG `I10` |
| VIN doğrulanamadı | `UNVERIFIED` | PG `I15` (042'den beri) |
| Parmak izi yok | `null`, sürüm de yok | test #5, #11 |
| Protokol bilinmiyor | `null` | test #4 |
| **Aynı kimlik** | **tekrar GÖNDERİLMEZ** (istemci dedupe **+** sunucu `UNCHANGED`) | test #4, #5 · PG `I3`, `I3b` |
| VIN değişti | `IDENTITY_CONFLICT`, **eski VIN korunur** | test #18 · PG `I5` |
| Parmak izi değişti | `IDENTITY_CONFLICT`, **eski hash korunur** | test #20 · PG `I6` |
| Protokol değişti | **`revision++`**, çakışma DEĞİL | test #22 · PG `I4` |

### İki savunma katmanı, iki ayrı gerekçe

- **İstemci dedupe** (imza): gereksiz ağ çağrısını ve batarya tüketimini önler.
- **Sunucu `UNCHANGED`** (043): istemci dedupe atlatılsa bile **güven puanının
  tekrarla şişirilmesini** önler. PG `I3b`: aynı kimlikle 5 tekrar çağrı →
  `identity_confidence` **0.70'te sabit**.

### İnce ama önemli iki kural

1. **`null` → değer geçişi ÇAKIŞMA DEĞİLDİR** (öğrenmedir). VIN'siz araç
   sonradan VIN öğrenirse bu `ENRICHED`'dir (test #19 · PG `I8`).
2. **Parmak izi ŞEMA SÜRÜMÜ** değiştiyse hash farkı araç değişimi değildir —
   aynı araç, farklı hesaplama. Çakışma **ilan edilmez** (test #21 · PG `I7`).
   `FINGERPRINT_SCHEMA_VERSION = 'fp1'`; hash algoritması veya girdi kümesi
   değişirse **artırılmalıdır**.
3. **Çakışma zenginleşmeyi EZER** — aynı turda hem yeni alan öğrenilip hem VIN
   değiştiyse bu zenginleşme değil çakışmadır (test #23).

---

## 6. ÇAKIŞMA MODELİ

| Aşama | Davranış |
|-------|----------|
| Tespit | YALNIZ **değer → BAŞKA değer**; `NULL → değer` asla |
| Sunucu | eski `vin`/`fingerprint_hash` **DEĞİŞTİRİLMEZ**; `identity_conflict_count +1`; güven **0.30**; `last_conflict_reason` |
| Revizyon | Çakışmada **ARTMAZ** (kimlik ilerlemedi) — PG `I5`: rev 2'de kaldı |
| İstemci | `CONFLICT` durumu; **retry YAPILMAZ** (çakışma ağ hatası değil, test #14) |
| Sonsuz döngü | Çakışan imza "gönderilmiş" sayılır → 20 tekrar bildirimde **1** yayın (test #15) |
| UI | **GİZLENMEZ** — "Farklı araç algılandı" + "Kayıtlı bilgi korundu" |

---

## 7. FLEET UI (§6)

`website/src/lib/fleet/vehicleIdentityView.ts` (saf) + `VehicleModal.tsx`
"Araç Kimliği" bölümü.

Gösterilenler: **Şasi No (VIN — maskeli)** · Marka · Model · Yıl ·
**OBD Protokolü** · İmza Sürümü · **Kimlik Güveni** · durum etiketi.

| Durum | Kullanıcı metni | Koşul |
|-------|-----------------|-------|
| `VERIFIED` | "Doğrulandı" | güven ≥ **0.70** ve çakışma yok |
| `PENDING` | "Doğrulanıyor" | güven eşiğin altında **veya bilinmiyor** |
| `CONFLICT` | "Farklı araç algılandı" | `conflict_count > 0` — **güven yüksek olsa bile** |
| `STALE` | "Kimlik bilgisi eski" | kayıt 30 günden eski |
| `UNKNOWN` | "Kimlik bilinmiyor" | ne VIN ne parmak izi |
| *(okuma düştü)* | **"Okunamadı"** | RPC `null` döndü |

### Dürüstlük kilitleri

- **"Okunamadı" ≠ "Kimlik bilinmiyor"** — RPC düşerse UI sahte "bilinmiyor" DEMEZ.
- **Savunma katmanlı maskeleme:** RPC maskeli döndürür, ama görünüm katmanı da
  sınar — maske işareti taşımayan ve VIN uzunluğunda görünen değer
  **GÖSTERİLMEZ** (test #10, #12). Sunucu sözleşmesi bozulsa bile UI sızdırmaz.
- Bilinmeyen alan → **"Veri yok"**; ölçülen `0` → `"0"` (test #13, #14).
- Güven bilinmiyorsa **%0 GÖSTERİLMEZ** → "Veri yok" (test #15).
- Kullanıcı metinlerinde teknik iç detay (`rpc`, `api_key`, `sql`, `column`,
  `null`) **SIZMAZ** (test #21).
- Görünüm nesnesinde sahiplik/anahtar alanı **YOK** (test #22).

---

## 8. CAROS LAB (§5)

**Yeni araç:** `fleet-identity` (kategori `vehicle`, `AVAILABLE`)
`src/components/devtools/screens/FleetIdentityScreen.tsx`

Dört bölüm: **Kimlik Durumu** (durum · kaynak · revizyon · son değişim sınıfı) ·
**Kimlik Alanları (maskeli)** · **Yayıncı** (durum · yayın reddi · deneme ·
retry · yayınlanan · dedupe ile atlanan · son başarı · son başarısızlık) ·
**Sunucu Hükmü** (son hüküm · sunucu güveni · çakışma sayısı · gerekçe).

§5'te istenen alanların tamamı var: VIN durumu · Fingerprint · Protocol ·
Confidence · Revision · Publisher State · Retry Count · Conflict Count ·
Last Success · Last Failure · Identity Source.

### "Raw veri gösterme" — kilitli

| Yasak | Kilit |
|-------|-------|
| TAM VIN | test #6: yalnız `maskVin(obs.vin)`; `{obs.vin}` render'ı YOK |
| Ham parmak izi | test #7: yalnız `.slice(0, 12)` |
| API anahtarı · ham Mode 09 · ECU · bitmap · MAC · JWT | test #8 |
| Konum/GPS | test #9 |
| **Mutlak zaman damgası** | test #10: yalnız zaman FARKI; `toISOString`/`new Date(` YOK |

**Aktif komut YOK** (test #3): `fetch` · `.rpc(` · `publishIdentityObservation` ·
`observeVehicleIdentity` · `performHandshake` · `setInterval/setTimeout` ·
`localStorage.setItem` · `.observe(` · `.stop(` çağrısı yok.
`getSnapshot()` **asla fırlatmaz** (K4 ile birlikte sertleştirildi) — LAB okuma
yüzeyinden çıkan bir istisna gözlem ekranını çökertirdi.

---

## 9. MIGRATION

Yalnız ileri; **033–042 geçmişi değiştirilmedi.**

### `20260730000043_fleet_vehicle_identity_p1.sql`

- `identity_revision` (NOT NULL DEFAULT 1, CHECK ≥ 1) · `vehicle_generation` ·
  `protocol_change_count` · `last_protocol_change_at`
- **`fingerprint_version`: smallint → text** (K2 — `22P02` kusuru); mevcut
  değerler metne çevrilir, veri kaybı YOK
- Eski 9-argümanlı imza **DROP** (ikinci otorite kalmasın)
- `UNCHANGED` hükmü · `PROTOCOL_CHANGED` hükmü · `identityRevision` yanıtta
- Fail-closed DO bloğu: kolonlar · `fingerprint_version` **text mi** · eski imza
  **gitti mi** · DEFINER + `search_path` · `UNCHANGED` gövdede var mı · anon
  kapalı mı · VIN maskeleme duruyor mu · RLS açık mı

### `20260730000044_fix_identity_read_scope.sql`

- K3 onarımı: kapsam **`profiles.company_id`** üzerinden (036'daki
  `list_company_vehicles` deseniyle aynı)
- Şirkete bağlı olmayan kullanıcı da **kendi** araçlarını görür (istisna
  fırlatılmaz → UI ham hata göstermek zorunda kalmaz)
- Fail-closed DO bloğu: `company_members` referansı **kalmadı mı** ·
  `profiles` kullanılıyor mu · maskeleme duruyor mu · DEFINER/`search_path` ·
  anon kapalı mı · **referans verilen tablolar GERÇEKTEN var mı** (42P01 bir
  daha olmasın)

**İdempotency:** 043 ve 044 ikinci uygulamada da `OK` + `COMMIT`.

---

## 10. TESTLER (§7)

### Gerçek PostgreSQL — **36 doğrulama** (mock DEĞİL)

Yerel Supabase `supabase_db_fleetval`, gerçek `auth.uid()` oturumları ile.

**Kimlik sözleşmesi (19):**
```
I1  22P02 KAPANDI: metin fp surumu kabul (CREATED, rev=1, conf=0.70)   PASS
I2  INSERT alanlari gercekten yazildi (vin/src/fpv/conf/rev/nesil)     PASS
I3  DEDUPE: ayni kimlik -> UNCHANGED, guven ARTMAZ, revizyon ARTMAZ    PASS
I3b 5 tekrar cagri sonrasi identity_confidence 0.70'te SABIT           PASS
I4  PROTOKOL DEGISIMI -> PROTOCOL_CHANGED, rev=2, conflict=false       PASS
I5  VIN CAKISMASI -> eski VIN korundu, conf=0.30, cc=1, rev ARTMADI    PASS
I6  PARMAK IZI CAKISMASI -> eski hash korundu, cc=2                    PASS
I7  SEMA SURUMU farkli -> cakisma DEGIL, yeni hash yazildi             PASS
I8  NULL -> VIN ogrenme cakisma DEGIL (UPDATED, conf 0.50->0.60)       PASS
I9  KANITSIZ cagri: conf 0.50, vin/fp NULL                             PASS
I10 kaynaksiz VIN / VIN'siz kaynak tasinmaz                            PASS
I11 gecersiz api_key REDDEDILIR                                        PASS
I12 device_id kimlik tablosunda YOK (arac kimligi != cihaz)            PASS
I13 ham parmak izi girdisi (ECU/bitmap/MAC) kolonu YOK                 PASS
I14 kimlik yazimi owner_id'ye DOKUNMUYOR (VIN otorite DEGIL)           PASS
I15 revizyon >= 1 CHECK kisiti calisiyor                               PASS
I16 anon YAZAR (cihaz yolu) · anon OKUMAZ · service_role OKUR          PASS
I17 oturumsuz okuma 0 satir (fail-closed)                              PASS
I18 okuma RPC maskeleme duruyor                                        PASS
```

**Kapsam / devir / observer (11 + 6):**
```
T0  kimlik kuruldu                                                     PASS
T1  devir UPDATE gercekten 1 satir etkiledi (olcum gecerli)            PASS
T2  DEVIR kimlik kaydini SILMEZ                                        PASS
T3  eski sahip bu aracin kimligini GORMEZ                              PASS
T4  yeni sahip GORUR                                                   PASS
T5  devir sonrasi cihaz kimlik yazmaya DEVAM eder                      PASS
T6  devirden sonra VIN KORUNDU                                         PASS
T7  fixture geri alindi                                                PASS
T8  SIRKET UYESI sirket aracinin kimligini GORUR                       PASS
T9  uye icin VIN MASKELI (•••123456)                                   PASS
T10 BASKA sirketin uyesi GORMEZ (cross-tenant reddi)                   PASS
S1  sahip kendi aracini gorur · S2 maskeli VIN · S3 yabanci gormez
S4  oturumsuz gormez · S8 cihaz oturumsuz yazabilir · S9 RLS+anon      PASS
```

> **Ölçüm dürüstlüğü:** İlk koşumda S6a/S6b/S7 `FAIL` verdi. Ürün kusuru
> DEĞİLDİ — testimin kusuruydu: S1'de `set_config('role','authenticated')`
> yapmıştım (= `SET LOCAL ROLE`), sonraki fixture `UPDATE`'i **RLS yüzünden 0
> satır etkiledi ve sessizce geçti**. Düzeltme: fixture yazmaları `RESET ROLE`
> ile postgres rolünde + `GET DIAGNOSTICS ROW_COUNT` ile **etkilenen satır
> doğrulaması** (T1). Bu, geçen turdaki "PostgREST 200 ≠ satır etkilendi"
> tuzağının aynı sınıfı.

### Birim / entegrasyon (mock)

| Paket | Sonuç |
|-------|-------|
| Kök `vitest` | **8 964 / 8 964 PASS** (430 dosya) |
| `website` `vitest` | **727 / 727 PASS** (35 dosya) |
| Kök `tsc --noEmit` | **TEMİZ** |
| `website` `tsc --noEmit` | **TEMİZ** |
| `eslint` (yeni dosyalar) | **0 hata** |
| Sır taraması (yeni dosyalar) | **temiz** |

**Bu turun yeni kilitleri (72):**

| Dosya | Adet |
|-------|------|
| `src/__tests__/vehicleIdentityObservation.test.ts` | 29 |
| `src/__tests__/vehicleIdentityCoordinator.test.ts` | 30 |
| `src/__tests__/carosLabFleetIdentity.test.ts` | 20 (LAB + tek otorite) |
| `website/src/__tests__/vehicleIdentityView.test.ts` | 23 |

Kapsanan §7 senaryoları: identity insert · update · conflict · null ·
protocol change · fingerprint change · **retry** · **dedupe** · **restart** ·
**reconnect** · **vehicle transfer** · **observer** · **owner** · **anon deny** ·
**service role**.

### Beklenen tek "kırmızı"

`pg_042_verify.sql` betiğinin kimlik bölümü (T10+) artık hata veriyor:
`function public.record_vehicle_identity(..., integer, ...) does not exist`.
Bu **kasıtlıdır** — 043 o imzayı `22P02` kusurunu kapatmak için düşürdü.
Aynı betiğin **telemetri** bölümü (T1–T8, P0 garantileri) **tamamı PASS**.
Geçerli kimlik hükmü yukarıdaki 19 + 11 kontroldür.

---

## 11. BOZULMAYAN / DOKUNULMAYAN ALANLAR

| Alan | Durum |
|------|-------|
| Fleet telefon doğrulaması (15/15) | **Bozulmadı** — `Connectivity` enum'ı ve offline/realtime/transfer mimarisi değişmedi |
| Sahiplik otoritesi | **Değişmedi** — kimlik yazımı `owner_id`'ye dokunmuyor (PG `I14`) |
| Migration 033–042 | **Değiştirilmedi** |
| Paralel **AccountCleanup** | **Dokunulmadı** |
| Paralel **Music Hub** | **Dokunulmadı** — `localMusicService` · `carosMediaLayer` · `mediaService` · `streamMusicService` · `android/.../media/*` değişiklik listemde YOK |
| Production / staging | **Yazma YOK** |

### P0'dan devam eden, bu pakete ait OLMAYAN açık kapı

`website` production build'i hâlâ `ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY` ile
düşüyor (paralel ajanın izlenmeyen `useSessionUser.ts` → SSR muhafızı).
Bu pakette o dosyaya **dokunulmadı**; bu yüzden ana karar `COMPLETE_LOCAL`
verilirken **build kapısı kimlik paketinin dışında** sayıldı — kimlik
değişikliklerinin hiçbiri o zincirde değil ve iki `tsc` + iki test paketi temiz.

---

## 12. AÇIK BORÇLAR

| # | Borç | Neden bu turda yapılmadı |
|---|------|--------------------------|
| **B1** | **Gerçek araç doğrulaması** — kütük #203–#208 🔴 | Araç/telefon oturumu bu turda yoktu |
| **B2** | `supportedPidBitmap` parmak izi hesabına dahil değil → imza eşleşmesi zayıf | Eklemek TÜM mevcut hash'leri değiştirir; `FINGERPRINT_SCHEMA_VERSION` artırımı + saklanmış parmak izi göçü gerektirir (ayrı atomik PR) |
| **B3** | `fleetKb.buildFingerprint` ikinci ölü üretici | Kaldırmak kimlik dışı dosyalara dokunur |
| **B4** | Migration 040–044 **hiçbir ortama uygulanmadı** (yalnız yerel) | `db push` yasak |
| **B5** | Fleet araç LİSTESİ kartında kimlik yok (yalnız detay modalinde) | Liste her araç için ayrı okuma yapmamalı; toplu okuma ayrı tur |
| **B6** | `PROTOCOL_CHANGED` hükmü istemcinin `IDENTITY_STATES` listesinde yok → `parseIdentityAck` onu `UNKNOWN` sayar (davranış zararsız: `conflict=false`, revizyon okunur) | Küçük sözleşme genişletmesi; kimlik akışını etkilemiyor |

---

## 13. NİHAİ KARAR

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`COMPLETE_LOCAL`** |
| Gerçek araç doğrulaması | **YAPILMADI** — kütük #203–#208 🔴 bekliyor |
| Production doğrulaması | **YAPILMADI** — 040–044 hiçbir ortamda yok |
| Telefon doğrulaması (15/15) | **KORUNDU** |

### Dürüstlük beyanı

Bu rapordaki her PASS **yerel** kanıttır: 8 964 kök + 727 website birim/
entegrasyon testi, iki temiz `tsc`, ve **36 gerçek-PostgreSQL sözleşme
doğrulaması** (gerçek `auth.uid()` oturumlarıyla, mock'suz). Gerçek araçta
veya gerçek telefonda **hiçbir madde doğrulanmadı**; kütükte 🔴 bekleyen altı
madde "çalışıyor" olarak sunulmuyor.

Bu turda kendi P0 çalışmamda **iki kusur** (`22P02`, `42P01`) ve kendi P1
koordinatörümde **bir kusur** (yakalanmayan promise reddi) bulundu — üçü de
"test yeşil + tsc temiz" olmasına rağmen vardı. `42P01` özellikle şunu
gösterdi: **fonksiyonun tanımını okumak onu çalıştırmak değildir.**
