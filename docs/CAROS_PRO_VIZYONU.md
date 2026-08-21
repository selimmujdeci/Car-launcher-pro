# CAROS PRO VİZYONU

> **Durum:** Canlı belge
> **Belge türü:** Ürün vizyonu + capability roadmap
> **Kaynak gerçekliği:** Kod, test, UI ve saha kanıtı ayrı değerlendirilir
> **Güncelleme kuralı:** İlgili her PR sonrasında güncellenir
> **Son güncelleme:** 2026-08-03 · Branch: `feat/fleet-offline-final-local-completion`
> **Son iş:** NAV-MINIMAP-CONT-P0 — navigasyon oturum sürekliliği · **cihazda statik
> doğrulandı** (§6.3, kütük 🟢 #377/#379 · 🔴 #378/#380/#381/#382,
> `docs/NAVIGATION_MINI_MAP_SESSION_CONTINUITY_P0_REPORT.md`)
> **Önceki iş:** NAV-CORE-P0 — navigasyon çekirdeği güvenilirliği (§6.3, kütük #364–#372,
> `docs/NAVIGATION_CORE_RELIABILITY_P0_REPORT.md`)
> **Önceki güncelleme:** 2026-07-18 · Branch: `feat/w5-obd-pr1-native-handshake`
> **Son işlenen PR'lar:** PR-OBD-PAIR-CONTINUITY (ilk-eşleştirme oto-bağlantı kök düzeltmesi) ·
> `7754500` (W5-3c-3 change detection) · `931b41c` (hız çelişki kapısı) ·
> `7d95ed8`+`0eb98e2` (araç değişimi kurtarması) · `69d1972` (Bağlantıyı Sıfırla)

---

## 0. Bu Belge Ne Değildir

Bu bir pazarlama yazısı değildir. Burada yazan bir özellik, **o özelliğin var olduğu
anlamına gelmez** — yanındaki durum etiketi neyse odur. Vizyon bölümleri ürünün nereye
gittiğini anlatır; capability defteri ürünün **bugün nerede olduğunu** anlatır. İkisi
bilinçli olarak ayrı tutulmuştur ve karıştırılmaları yasaktır.

Bu belge Claude'un veya herhangi bir ajanın sohbet hafızasının yerine geçer. Sohbet
hafızası uçar; bu dosya sürüm kontrolündedir.

---

## 1. Kaynak Hiyerarşisi (çelişkide kim kazanır)

| Belge | Rolü | Otorite |
|---|---|---|
| `CLAUDE.md` | Anayasa — çalışma kuralları | **Mutlak** (çatışmada `AI.md` ile birlikte kazanır) |
| `AI.md` | Uygulama kuralları (atomik patch, real-device) | **Mutlak** |
| `docs/DEVICE_VALIDATION_LEDGER.md` | **Saha kanıtının TEK kaynağı** | Saha durumunda **mutlak** |
| **`docs/CAROS_PRO_VIZYONU.md`** (bu dosya) | **Ürün vizyonu + capability roadmap ana kaynağı** | Vizyon/öncelik/durum özetinde **birincil** |
| `docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md` | Mimari referans (katmanlar, motorlar, invaryantlar) | Mimari "nasıl" sorusunda birincil |
| `docs/MAVI_NEXT_VISION.md` | **Mavi (sesli AI) uzun vadeli ürün vizyonu** (8 modül, Yol Arkadaşı, voice-first) | Mavi vizyon/yönünde birincil; durum bu belgede DEĞİL |
| `docs/OBD_DIAGNOSTIC_OS_ROADMAP.md` | OBD/teşhis **alt-roadmap'i** (FAZ 0–4 görev kırılımı) | OBD görev detayında birincil |
| `docs-local/caros-feature-audit.html` | 57 özellik **detay denetim görünümü** | Denetim ayrıntısında yardımcı |
| `docs/CAROS_15_YIL_VIZYON_YOL_HARITASI.md` | 2026-07-08 tarihli denetim fotoğrafı | **Tarihsel** — bayat, güncellenmiyor |
| `ROADMAP.md` (kök) | 2026-06-24 tarihli yol haritası | **Tarihsel** — bayat, güncellenmiyor |

**Kural:** Bu belge ile bir başkası çelişirse → durum **yükseltilmez**, çelişki
[§9 Çelişki Kaydı](#9-çelişki-kaydı)'na yazılır ve kod/test/saha denetimi yeniden yapılır.

---

## 2. Ana Ürün Vizyonu

- **CAROS PRO yalnızca bir OBD uygulaması değildir.**
- CAROS PRO, araç içinde çalışan **AI destekli Vehicle Operating System / Edge Brain**'dir.
- **Arabam Cebimde**, aracın telefondaki ana kontrol ve yönetim merkezidir.
- İki sistem **tek mantıksal Digital Twin, Vehicle Memory ve araç kimliği** paylaşır.
- **Araç ekranı** güvenli sürüş, hızlı durum, navigasyon, medya ve sesli etkileşime odaklanır.
- **Telefon uygulamasından** araçla ilgili neredeyse bütün bilgi ve yönetim işlemlerine ulaşılabilir.
- Sistem **offline-first, fail-closed, zero-trust, evidence-first, safety-first ve
  budget-aware** çalışır.
- **Nihai amaç arızayı göstermek değil, oluşmadan önce önlemektir**; aracı, sürücüyü ve
  aileyi korumaktır.

**Referans neden Tesla değil:** Tesla yalnızca kendi aracını tanır. CAROS PRO yüzlerce
**bilinmeyen** marka/modeli **öğrenmek** zorundadır — garantili OEM verisi yok, güvenilmez
aftermarket telemetri var. Bu yüzden daha güçlü olmak zorundayız, daha gösterişli değil.

---

## 3. Mimari İlkeler (değişmez)

1. **Safety First** — güvenlik-kritik iş her tier'da açık, her koşulda öncelikli.
2. **Evidence First** — kanıtsız karar yok; her yargı kanıta bağlanır.
3. **Zero-Trust Telemetry** — hiçbir veri doğrulanmadan kabul edilmez.
4. **Fail-Closed Truth** — kanıt eksikse "temiz" denmez; belirsizlik belirsizdir.
5. **Offline First** — internet bir özellik değil, bir bonustur.
6. **Privacy and Consent First** — PII tek kapıdan maskelenir; rıza olmadan veri çıkmaz.
7. **Budget-Aware Hybrid Runtime** — her katman DeviceTier bütçesine abonedir.
8. **Modular Architecture** — modüller sözleşmeyle konuşur, birbirinin içine uzanmaz.
9. **Event Bus ve bounded ortak veri sözleşmeleri** — tek bus; sınırsız payload yok.
10. **Hot / Warm / Cold path ayrımı** — ağır analiz hot-path'e (3 Hz hız/RPM) asla girmez.
11. **Gerçek araç kanıtı olmadan "tamamlandı" denmez.**
12. **Dosya varlığı özellik varlığı sayılmaz.**
13. **Testli olmak ürün hazır olmak anlamına gelmez.**
14. **Saha doğrulaması olmadan "sahada doğrulandı" yazılmaz.**

> İlke 11–14 bu belgenin varlık sebebidir. Bir PR bunları çiğnediğinde belge değil,
> PR yanlıştır.

---

## 4. CAROS PRO ↔ Arabam Cebimde Bütünlüğü

```
┌─────────────────────────────────────────┐
│  CAROS PRO — Araç içi gerçek zamanlı beyin │
│  · OBD / CAN / GPS / sensörler            │
│  · Safety Kernel                          │
│  · canlı Digital Twin                     │
│  · olay algılama                          │
│  · fail-closed karar                      │
│  · offline çalışma                        │
└─────────────────────────────────────────┘
                    ⇅  Vehicle Link Fabric
┌─────────────────────────────────────────┐
│  Arabam Cebimde — Telefon kontrol merkezi │
│  · araç sağlığı        · bakım            │
│  · Vehicle Memory      · raporlar         │
│  · Digital Twin görünümü · AI             │
│  · teşhis              · ayarlar          │
│  · kullanıcı ve araç yönetimi             │
└─────────────────────────────────────────┘
                    ⇅  Güvenli Senkronizasyon
┌─────────────────────────────────────────┐
│  CAROS Cloud                              │
│  · yedekleme                              │
│  · uzun dönem öğrenme                     │
│  · Fleet Intelligence                     │
│  · çoklu cihaz senkronizasyonu            │
└─────────────────────────────────────────┘
```

**Bugünkü gerçek:** "Arabam Cebimde" bugün `website/src/app/(pwa)/kumanda` altındaki
PWA'dır — uzaktan komut (AES-256-GCM + ECDH P-256) ve panel çekirdeği vardır. Vizyondaki
**tek mantıksal Digital Twin / Vehicle Memory paylaşımı henüz YOKTUR**: paylaşılan araç
kimliği ve senkronizasyon sözleşmesi yazılmamıştır. Vehicle Link Fabric'in araç-içi ucu
çalışır (store → provider → adapter → HAL → Event Bus → Kernel), **bulut ucu bağlı değildir**.

---

## 5. Gerçeklik Durum Modeli

Her özellik için **yalnız** şu seviyeler kullanılır:

| Seviye | Anlamı |
|---|---|
| **YOK** | Kod yok. Sıfırdan yazılacak. |
| **İSKELET** | Dosya/motor var ama production'da çağrılmıyor veya tüketilmiyor. |
| **ENTEGRE** | Gerçek çağrı zincirine bağlı, ama ürün katmanı (UI/hata/telemetri) eksik. |
| **DOĞRULANDI** | Production entegre + davranış testli + UI/API + hata yönetimi tam. Saha kanıtı yok. |
| **SAHADA DOĞRULANDI** | Yukarıdakilerin hepsi + kütükte ölçülebilir gerçek cihaz/araç kanıtı. |

Ayrı alan: **ÜRÜN HAZIR: EVET / HAYIR**

`ÜRÜN HAZIR = EVET` yalnızca şu **altı koşulun tamamında** verilebilir:

1. Production entegrasyonu var.
2. Davranış testleri var.
3. Kullanıcı UI veya API yüzeyi var.
4. Hata yönetimi var.
5. Observability/telemetry var.
6. **Gerçek cihaz veya araç doğrulaması var.**

> Altı koşulun altıncısı en sık atlanan ve en pahalı olandır. Kütükte 🟢 olmayan hiçbir
> özellik ÜRÜN HAZIR = EVET alamaz.

**Bugünkü toplam (59 denetlenen özellik):** YOK 14 · İSKELET 24 · ENTEGRE 14 ·
DOĞRULANDI 6 · SAHADA DOĞRULANDI 1 · **ÜRÜN HAZIR: 1**
(+2 İSKELET: **Karar Otoritesi — MAVI Reasoning Engine** ve
**Karar Üretim Bağlantısı — Reasoning Production Wiring**, 2026-08-01)
(Detay: `docs-local/caros-feature-audit.html`)

---

## 6. Yapılan ve Kanıtlananlar

> Buraya **yalnız** kod/test/saha kanıtı olan işler girer. Sıra: en güçlü kanıt üstte.

### 6.1 Sahada doğrulanmış (kütük 🟢)

| # | İş | Kapsam | Test | Saha kanıtı | Kalan eksik |
|---|---|---|---|---|---|
| Ledger #677 (+#675) | **Native Java CI kapısı gerçek runner'da uçtan uca kanıtlandı** | 27 820 satır native Java — kilit/korna/alarm komutlarını MCU'ya seri porttan gönderen katman — 25 test sınıfı / 335 testiyle birlikte **hiçbir workflow tarafından koşulmuyordu**. `codeql.yml` yalnız javascript-typescript tarıyor; `reporter: java-junit` bir **rapor biçimi** adı, Java testi değil. JOB 4 `android_unit_tests` eklendi (paralel — Java doğruluğu TS lint'ine bağlı değil) | Kapı **ürün mutasyonuyla** sınandı, testle değil | **GitHub Actions, üç koşum (2026-08-21):** (a) 32473905876 → `BUILD SUCCESSFUL in 2m 27s`, `✓ Java test sınıfı: 25 · toplam test: 335`, 14/14 adım yeşil · (b) 32475771551 → `CMD_HONK_HORN` whitelist'ten çıkarılınca `McuCommandWhitelistTest > allSixHardwareCommandsProducePackets FAILED` + `> whitelistGateIsEffective FAILED`, `BUILD FAILED` · (c) 32476143408 → revert sonrası tekrar `BUILD SUCCESSFUL`. Yolda üç kusur çıktı, üçü de yalnız gerçek runner'da görünürdü: Capacitor CLI Node≥22 (CI'da 20) · `cap update`'in koşullu `dist/` ihtiyacı · gradle fail-fast'in kritik suite'i görünmez kılması | **Kapı main/dev üzerinde henüz koşmadı** — bu dal main'e girene kadar korumadaki PR'lar job'ı görmez · `LinkSessionTest` **flaky** (kütük 🔴 #678) → job rastgele kırmızı olabilir · **E2E workflow'u 10 Temmuz'dan beri hiç yeşil olmamış** (kütük 🔴 #679) |
| Ledger #676 (+#603) | **Filo telemetrisi buluta AKIYOR — dongle'sız araçlar artık ilk satırlarını oluşturabiliyor** | 042 sahte 0'ları kaldırmış ama tablo kolonları `NOT NULL` kalmıştı → `push_vehicle_event` **HTTP 400/23502**, dongle'sız araç bulutta HİÇ görünmüyordu (etkilenen sınıf filonun %93'ü). Migration **066** dört sinyal kolonunu nullable yaptı ve sahte `DEFAULT 0`ı düşürdü — NULL *"ölçülmedi"*, 0 *"ölçüldü ve sıfır"*; ikisi aynı şey değil | Kolon/RPC/ayrıcalık doğrulaması 066 içinde gömülü (üç kapı) + `prod_066_..._readonly.sql` salt-okuma hükmü | **Prod `Carospro`, 4 GÜNLÜK ÜRETİM TRAFİĞİ (2026-08-21 ölçümü):** telemetri **42 → 63 satır**; `fuel IS NULL` **22 satır**, en eskisi **16 Ağu 16:23** (066'nın uygulandığı gün), en yenisi **20 Ağu 14:19**, **22'sinin 22'si `is_online=true`**. 066 öncesi NULL satır **0**. Kanıt kusursuz çünkü RPC'nin `ON CONFLICT` dalı `COALESCE(EXCLUDED.fuel, t.fuel)` — **UPDATE NULL yazamaz**, yani her NULL satır `NOT NULL` kısıtı yokken geçmiş bir **INSERT**'tir. 18 satır `HEAD_UNIT_GPS` + `fuel/rpm/temp` üçü birden NULL = *"dongle takılı değil"* | **Sunum ucu:** PWA filo ekranında aracın **ÇEVRİMİÇİ** rozetiyle göründüğü gözlenmedi (`is_online` veride doğru, sunum ayrı iddia — #575 tam bu sınıftı) · **Benimseme:** 786 aracın **723'ünde** (%92) hâlâ hiç telemetri satırı yok; kısıt kalktı ama filo genelinde akış başlamadı |
| Ledger #614 | **Vektör harita cihazda ÇİZİYOR — 0 baytlık karo zehri kapatıldı** | Kök neden `caros-tile://` şeması DEĞİL: MapLibre karo `ArrayBuffer`ını worker'a transfer edip **detach** ediyor, fire-and-forget önbellek yazımı `await caches.open()` sırasında **boş gövde** yazıyordu → karo ilk açılışta çizip sonraki her açılışta kayboluyordu (0 baytlık girdi LRU baskısıyla da düşmez → kalıcı). Önbelleğe `slice(0)` kopyası yazılır; 0 baytlık isabet reddedilir/temizlenir; ağdan boş gelirse fırlatılır. Ayrıca `glyph-cache://` protokolü ilk kez üretim yoluna bağlandı (etiketler geldi) | 553 dosya / 12 289 test yeşil; **6 yeni kilit** (transfer/detach kilidi ilk yazımında sahte geçiyordu, düzeltme yokken düştüğü kanıtlandıktan sonra kabul edildi) | **Xiaomi 23090RA98I, iki ayrı açılış:** `transportation` 0 → **306 özellik**, önbellek karosu 0 → **34 095 bayt**; **2. açılış WiFi KAPALI** iken tüm sokak ağı + sokak adları önbellekten çizildi (`adb screencap`) | Sessiz başarısızlık yüzeyi (karo `errored` iken `tileError` boş) · `Map init cancelled` + her geçişte yeni harita örneği · WiFi kapalıyken "ONLİNE" etiketi · gece paleti (#612) hâlâ gerçek araçta gece görülmedi |
| Ledger #67 | **Öğrenilmiş protokol timeout'ta korunur** (OBD-OS-F0-2) | 2-strike timeout kalıcı `obd:lastProtocol`'ü silmez, yalnız oturum-içi bypass | Suite yeşil; 3b regresyon kilidi yeni davranışa güncellendi | **Doblo (CAN) + Redmi + BLE**: kayıt korundu | Trafic (KWP) 10 soğuk açılış senaryosu hâlâ açık |
| Ledger #3/#4/#5 | **Tanı Gönder uçtan uca** | boot self-pair → `triggerSupportSnapshot()` → RPC → `/admin/tani` | sanitize DENY_KEYS + teslimat 8-durum kilitleri | Cihazda buton → `vehicle_events` satırı → panelde listelendi | Migration 025/026 history boşluğu |
| Ledger #B | **Backend `push_vehicle_event` `text = uuid` düzeltmesi** | RPC rate-limit sorgusu tip uyumsuzluğu | — | Canlı Supabase'te doğrulandı | — |
| Ledger #10 | **VehicleCompute worker "require is not defined" ölümü** | oxc es2015 class-field → `_defineProperty` → `require` | Worker boot testi | Head unit'te worker ayakta | — |
| Ledger #14 | **Cloud geofence uçtan uca** | SecuritySuite → `push_geofence_zone` RPC → head unit | — | Uçtan uca gözlendi | Geofence **yazma** yolu ayrı |

### 6.2 Kısmi saha kanıtı (kütük 🟡)

| # | İş | Ne kanıtlandı | Ne kanıtlanmadı |
|---|---|---|---|
| Ledger #66/69/71 | Fail-closed DTC verdisi (F0-1) · handshake DISCOVERY kuyruğu (F0-3) · tek reconnect otoritesi (F0-5) | **Doblo/CAN taze APK: regresyon YOK**; F0-1 verdisi "kapsam-farkında" davrandı | **DTC'li araç yok** → "temiz demeyecek" iddiası tetiklenemedi; F0-3/F0-5 mekanizmaları tetiklenmedi |
| Ledger #70 | CAN regresyonu yok (F0-4) | Doblo'da 92 s kesintisiz akış: motor 62-69°C, devir 847-1088, menzil 270 km, 3/3 monitör | KWP (Trafic) kazancı — araç kullanıcıda değil |
| Ledger #65 | Native handshake + supported PID discovery (W5-OBD-PR1) | Cihazda canlı veri: hız 15, RPM 905, coolant 80°C, yakıt barı | Extended PID **değer dolumu**; ⚠️ RPM=0 anomalisi |
| Rapor `8edd61a6` (2026-07-15) | **KWP/protokol 5 aracında handshake TAM çalıştı** | `outcome: ok` · `vinPresent: true` · `vinClass/bitmapClass: ok` · 15 PID · 6.2 sn · quality %100 · OBD 8.2 sn'de bağlandı · DTC okundu (0 kod) · self-test 13 pass/1 warn/**0 fail** · boşta render ~3 fps | **Extended `samples: []`** (P1-1) · **hız PID'i 0 dönüyor** (→ #77 fix) · Event Bus'ta **0 tüketici** (aşağıya bkz.) |

### 6.3 Kod tamam + test yeşil, saha borcu açık (kütük 🔴)

- **✅ CI'DA KANITLANDI — NATIVE JAVA ARTIK CI KAPISINDA; 335 TEST YILLARDIR YAZILIYDI,
  HİÇ KOŞMUYORDU (2026-08-21, kütük 🟢 #675 → kanıt 🟢 #677, plan V-01 KAPANDI):** vizyon denetimi ölçtü — `android/app/src/test`
  + `android/phonehub-protocol/src/test` altında **25 test sınıfı / 335 test** var ve
  hepsi yerelde GEÇİYOR, ama **hiçbir workflow gradle çağırmıyordu**. `codeql.yml` yalnız
  `javascript-typescript` tarıyor; `main.yml`'deki `reporter: java-junit` bir **rapor biçimi**
  adı, Java testi değil. Yani **27 820 satır native Java** — kilit/korna/alarm komutlarını
  MCU'ya seri porttan gönderen katman — otomatik kapı olmadan sürüm alıyordu.

  **Eklenen:** `main.yml` JOB 4 `android_unit_tests` (PARALEL — Java doğruluğu TypeScript
  lint'ine bağlı değil; seri zincire eklemek bir ESLint uyarısının native regresyonu
  GİZLEMESİ demekti). Kapının ısırdığı **ürün mutasyonuyla** kanıtlandı (testi değil):
  `McuCommandFactory`'den `CMD_HONK_HORN` whitelist'ten çıkarılınca
  `251 tests completed, 2 failed → BUILD FAILED` (exit 1); geri alınca exit 0.
  Kasaya 5 kilit eklendi ve **iki mutasyonla düşürüldükleri gösterildi**
  (gradle çağrısı silinince · `buildDir` koşulsuz hâline dönünce).

  **Üç ders, üçü de bu depoda tekrar eden desenler:**
  1. **Yazılmış test ≠ koşan test.** "Java testlerimiz var" ifadesi 25 sınıf için
     doğruydu ve **hiçbir koruma sağlamıyordu** — "motor var, besleyen yok"un test
     katmanındaki kopyası.
  2. **Ad benzerliği kanıt sanıldı.** `reporter: java-junit` satırı yıllarca "Java
     testleri koşuyor" izlenimi verdi; o bir XML **biçim** adıdır.
  3. **Kapı, teşhis edeceği arızada ölmemeli.** İlk yazımda sayaç `bc`ye bağlıydı;
     `bc` olmayan ortamda çıktı **sessizce boş** kalıp adım YEŞİL geçiyordu (ölçüldü).
     `awk` + `total<=0` bloke ile kapatıldı.

  **AÇIK BORÇ:** iş akışı **GitHub Actions'ta hiç koşmadı** — "CI kırmızı olur" yarısı
  yalnız gerçek runner'da kanıtlanır. Ayrıca NDK bilinçli kurulmuyor (yerel görev
  grafiğinde native görev yok); varsayım yanlışsa ilk koşum bunu adıyla söyleyecek.
  **ÜRÜN HAZIR: HAYIR.**

- **HARİTA BİLGİ YOĞUNLUĞU — GOOGLE KARŞILAŞTIRMASI, 4 KÖK (2026-08-18, kütük
  🔴 #635 · #636 · #637 · #638):** araç **12 447 test yeşil**, `tsc` temiz,
  production build temiz. **Cihaza hiçbir şey kurulmadı** — dördü de saha borcu.

  Kullanıcı aynı gerçek kavşakta (0451. Sokak / 0469. Sokak / Mavi Bulvar,
  Tarsus–Bağlar) Google Maps ile CarOS Pro ekranını yan yana koydu: *"dağlar
  kadar fark"*. Denetim tek bir kusur değil **dört ayrı kök** buldu:

  - **KÖK 1 (#635 + #638):** rota bandı üstü sokak adı etiketi **iskeleti dahi
    yoktu**. OSRM adımlarının zaten taşıdığı `streetName` kullanıldı — yeni veri
    kaynağı/geocoding gerekmedi; segment sınırları painted-arrow'un (#485) AYNI
    anchor çözücüsünden geldi (ikinci geometri otoritesi kurulmadı). İlk tur
    zemini halo ile geçmişti; **#638'de `road-shield` kalkanının aynı 9-patch +
    `icon-text-fit` deseniyle gerçek dolgu "pill"e taşındı** (borç aynı gün
    kapatıldı, kütükte açıkça izlendi).
  - **KÖK 2 (#637):** vektör→raster düşüşü hem **gözlemlenemiyordu** (LAB
    `tileRender` NİYETİNİ okuyordu → yalancı tanıklık) hem de `unblockOnlineVector()`
    üründe hiç çağrılmadığı için **oturum sonuna kadar kalıcıydı**.
  - **KÖK 3 (kod yok, ölçüm):** Overpass ile ölçüldü — o mahallede 450×500 m'de
    **0 landuse poligonu**, en yakın bina 150-300 m. Eksik olan kod değil
    **OSM verisi**; stil değişikliği o bölgede hiçbir şey çözmez.
  - **KÖK 4 (#636):** bina 3B opaklık mandalı tek yönlüydü — 80 km/h'i bir kez
    gören sürüşte binalar kalıcı olarak stilin öngördüğünden soluk kalıyordu.

  **Süreç notu:** #636 ve #637 commit'lenmiş ama **kütük maddesi yazılmamıştı**;
  bu boşluk aynı turda kapatıldı (anayasa: kod değil KÜTÜK saha otoritesidir).

- **DASHBOARD'UN TAMAMI KONSOL DİLİNE ALINDI (2026-08-20, kütük 🔴 #663):**
  website **1282 test yeşil**, `tsc` + `next build` temiz. Tarayıcıda
  doğrulanMADI → kütükte 🔴.

  **İki ders, ikisi de tekrar eden desenler:**
  1. **Ulaşılamayan yüzey = olmayan yüzey.** Konsol canlıdaydı, CSS'te palet
     doğrulandı, ama telefonun birincil navigasyonunda ona giden sekme yoktu;
     kullanıcı için "değişen bir şey yok"tu. Bu, depoda dördüncü kez görülen
     "motor var, besleyen yok" örneğidir (#631 · #647 · #661 · #663).
  2. **Kapsam beyanı ≠ kullanıcının gördüğü.** "Filo paneli" diye tanımlanan
     iş, kullanıcının günlük baktığı ekranların çoğunu dışarıda bırakıyordu.

  **Sökülen üç sessiz kusur** (hepsi kanıt felsefesinin ihlaliydi): Ayarlar
  ekranının tamamı tiyatroydu (sahte profil formu + ölü Kaydet + tıklanamayan
  anahtarlar); Tanı ekranı eski sayısal yüzeyden okuyup telemetrisiz araçta
  "Yakıt %0" sahte alarmı üretiyordu; Harita ekranı kabuk içinde ikinci bir
  kabuk kurup hiçbir yere gitmeyen dekoratif bir alt menü çiziyordu.

  **Token kapsamı:** `[data-console]` yalnız token tanımıdır (`<html>`);
  zemin/mürekkep/odak `[data-console-root]`a bağlıdır — böylece pazarlama
  sayfaları kendi kimliğini korur.

  **AÇIK BORÇ:** pazarlama sayfaları ve PWA kapsam dışı · repaint toplu sınıf
  değişimiydi, alt bileşenlerin (araç modalı, PIN diyaloğu, komut paneli)
  kontrastı tek tek görsel doğrulanmadı · konsolun CAROS LAB gözlem ekranı yok.

- **FİLO PANELİ "KANIT KONSOLU" OLARAK YENİDEN KURULDU (2026-08-20, kütük 🔴 #662):**
  website **1268 test yeşil**, `tsc` + `next build` temiz. Tarayıcıda/cihazda
  doğrulanMADI → kütükte 🔴 bekliyor.

  **Neden bu iş vizyonla hizalı:** CAROS PRO'nun ayırt edici iddiası "gösteren
  değil, doğrulayan sistem"di; ama bu iddia bugüne dek yalnız *kodun içinde*
  yaşıyordu (`vehicleTelemetryFreshness`, `sessionInspectorModel`). Filo
  panelinde kullanıcı hâlâ generic bir SaaS ekranı görüyordu. Kanıt Konsolu,
  o iddiayı **görsel dile** çevirir: kanıtsız metrik yeşil boyanmaz, gösterge
  ibresi ölçüm yokken ortalamaya yaslanmaz, her sayının altında kaynağı ve
  yaşı yazar.

  **Yeni katman (7 ekran):** Genel Bakış · Araçlar · Araç Detay · Kayıtlar ·
  Uyarılar · Raporlar · Yönetim · Ayarlar. Hepsi mevcut Supabase yüzeyinden
  besleniyor; araç ve telemetri okuması `vehicleStore` TEK otoritesinden gelir
  (#632/#660'ta ikinci kopya sahada sessiz ayrışma üretmişti — tekrarlanmadı).

  **Üç yeni "dürüst düşüş" deseni ürüne girdi:**
  1. **Üçlü DTC durumu** — "okunamadı" ≠ "tarama yok" ≠ "tarandı, kod çıkmadı".
     Kısmi tarama boş liste ile "arıza yok" sayılmaz.
  2. **Bayat ölçüm tavanı** — bayat veri `KANITLI` olamaz (en fazla `UYARI`),
     ama kritik eşiği aşan bayat ölçüm kritik KALIR: güvenlik sinyali tazelik
     yüzünden yumuşatılmaz.
  3. **Türetim etiketi** — rapor serisi bir ölçüm değil türetimdir (geçmiş
     sağlık saklanmıyor) ve ekran bunu cümleyle söyler.

  **Ölçülen sınır — palet:** dayatılan gündüz paletinde kritik ↔ uyarı ayrımı
  normal görüşte ΔE 13,5 (eşik 15), deutan 6,4. Palet tasarım sisteminin
  sabiti olduğu için çözüm **formda** arandı: sağlık serisi iki seriyi ayrı
  katlarda çizer, renk tek başına anlam taşımaz. Bu, "renk bir süs değil bir
  hüküm" ilkesinin ölçüme dayalı ilk uygulamasıdır.

  **AÇIK BORÇLAR (ekranda da yazılı):** bildirim türü tercihleri sunucuda
  saklanmıyor · metrik geçmişi yok (`vehicle_telemetry` araç başına tek satır)
  · eski `/dashboard/settings` ekranı hâlâ sahte profil alanları ve ölü
  "Kaydet" düğmesi taşıyor · konsolun CAROS LAB gözlem ekranı YOK · üç
  kırılımda tarayıcı doğrulaması yapılmadı.

- **FİLO PANELİ ARAÇ KİMLİĞİ + HARİTA (2026-08-19, kütük 🔴 #661):**
  website **1230 test yeşil**, `tsc` + `next build` temiz. Telefonda test
  EDİLMEDİ → kütükte 🔴 bekliyor, "çalışıyor" DENMEZ.

  Kullanıcı (carospro.com → Panel, telefon ekran görüntüsü): *"araca isim koyma
  yok · harita çok kötü duruyor · yeşil noktaya dokununca aracın konumu tam
  olarak ve araç bilgileri belli olacak kart içinde"*. Ekranda araç kimliği
  olarak ham UUID görünüyordu.

  **KÖK 1 — uydurulmuş kimlik:** `plate: vehicle.plate ?? vehicle.id`. Plaka
  boşken araç UUID'si **plaka diye** gösteriliyordu; aynı desen iki yerde daha
  vardı (`deviceLinkClient`, `notificationEngine`). Kimlik yokken kimlik
  UYDURMAK, "sahte 0" ile aynı sınıf kusurdur: kullanıcı eksikliği göremez,
  dolayısıyla düzeltemez. Artık tek otorite var (`vehicleDisplay.ts`) ve
  kimlik yoksa **`Araç #kısaid` + `İsim ver`** görünür.

  **KÖK 2 — yazma ucu HİÇ yoktu ("motor var, besleyen yok" — dördüncü örnek):**
  `vehicles` satırının `plate/name/driver_name` alanlarına yazan tek bir çağrı
  yeri bile yoktu. Özellik eksik değildi, **hiç yoktu**. `PATCH /api/vehicles/:id`
  açıldı; yazma ucunda iki sessiz-ölüm kapatıldı: (a) PostgREST 200 ≠ satır
  etkilendi → boş dönüşte **403**, sahte "kaydedildi" YOK; (b) service_role
  RLS'i devre dışı bıraktığı için kapsam kullanıcının kendi token'ıyla ayrıca
  doğrulanır — **aynı kapı mevcut DELETE rotasında da eksikti** ve bu turda
  kapatıldı.

  **KÖK 3 — kamera hiç kurulmuyordu:** `LiveMap` her açılışta ülke zoom'unda
  (5,8) başlıyor, araç konumu geldiğinde kadraj kurmuyordu. Kusur "harita
  stili" değil **kamera sahipliğiydi**: boya doğruydu, çerçeve yanlıştı
  (#625 ile aynı sınıf). Artık konum bilinir bilinmez kadraj kurulur, ama
  kullanıcı haritayı eline aldıysa kamera geri ALINMAZ.

  Nokta dokunuşu artık tam ekran modal değil, harita üstünde **konum kartı**
  açar; kart adres · koordinat · konum tazeliği/kaynağı/doğruluğu ve dört
  ölçümü `VehicleFreshness` gerçek katmanından okur — bilinmeyen `Veri yok`
  yazar, adres çözümlenemezse bunu SÖYLER.

  **AÇIK BORÇ:** bu üç yüzeyin CAROS LAB gözlem ekranı YOK (kimlik yazma
  sonucu · ters çözümleme önbellek/başarı sayaçları · kadraj kararı gözlenemez);
  gözlemlenebilirlik kuralı gereği borç olarak yazıldı. PWA (`app/(pwa)`)
  bu turda kapsam DIŞI tutuldu.

- **PWA ARACI DOĞRUDAN EŞLEŞTİRİYOR; FİLO AYRI AKIŞ (2026-08-18, kütük 🔴 #631):**
  website **1193 test yeşil**, `tsc` temiz. **Canlıda ölçülerek doğrulandı**
  (`api/vehicle/link` bundle'da VAR, `api/pwa/pair` YOK).

  Kullanıcı: *"pwa sadece araç uygulaması ile işlemeli, filo da araç ile
  eşleşmesi ikisi ayrı."* Ölçüm: PWA'daki "Eşleştir" düğmesi **hiçbir koşulda
  çalışmıyordu** — çağırdığı rota 410 ile kalıcı kapalıydı ve ekran kullanıcıyı
  Filo panosuna yönlendiriyordu. Bireysel kullanıcı için "filo panosu" kavramı
  anlamsızdır.

  **Asıl bulgu — altyapı zaten hazırdı:** `pair_vehicle_to_user()` bireysel
  eşleştirmeyi destekliyor (`company_id` null, 3 araç limiti). "Kullanıcı ↔
  araç" ilişkisi vardı; eksik olan yalnız PWA'nın o rotayı çağırmasıydı.
  **Bu, tek oturumda karşılaşılan ÜÇÜNCÜ "motor var, besleyen yok" örneğidir**
  (sınırsız renk altyapısı · v3 önizleme köprüsü · bireysel eşleştirme).
  Denetim önceliği buradan çıkıyor: yeni motor yazmadan önce **var olan
  motorların besleniyor mu** diye taranması, yeni özellik yazmaktan daha çok
  değer üretiyor.

  Güvenlik tarafında kapatılan iki kusur geri gelmedi: oturum artık zorunlu,
  ham `api_key` saklanmıyor. Bir yan etki yakalandı: `getLocalVehicle` apiKey
  yoksa `null` dönüyordu → yeni akışla eşleşen araç PWA'da hiç görünmezdi.

  **Kalan eksik:** gerçek araç kodu ile eşleştirme denenmedi. Ölçütler #631'de.

- **TÜM ALT EKRANLAR DÜZENLENEBİLİR: 43 → 64 BİLEŞEN (2026-08-18, kütük 🔴 #629):**
  araç 561 dosya / **12 409 test yeşil**, website **1191 yeşil**.

  #628'in açık borcu kapandı: Teşhis · Bakım · Bildirimler · Hava · Güvenlik ·
  Dashcam · Spor · Seyahat ekranlarının hepsi artık iç yapı taşlarıyla
  düzenlenebiliyor. Her ekranın "tüm sayfa" kimliği korundu.

  **Bu turun asıl dersi kilidin kendisinden çıktı:** yeni yazdığım "defterdeki
  her kimlik kaynakta işaretli" kilidi Horizon temasını hatalı biçimde
  "işaretsiz" saydı. Ürün doğruydu — kimlikler `<Panel editId="…">`
  sarmalayıcısıyla geçiyordu. Ölçüm: ürün iki deseni birden kullanıyor (21
  doğrudan, 12 sarmalayıcı). **Aşırı katı kilit, gevşek kilit kadar yanlış
  yönlendirir**: biri sahte alarm, öteki sahte güven üretir. Kilit yazarken
  ürünün gerçek desenleri ÖNCE ölçülmeli.

  **Kalan eksik:** telefonda kullanılmadı. Kabul ölçütleri kütük #629'da.

- **AYARLAR EKRANI TEMA STÜDYO'DA TEK PARÇAYDI — 1 BİLEŞENDEN 9'A
  (2026-08-18, kütük 🔴 #628):** araç 561 dosya / **12 405 test yeşil**,
  website **1191 yeşil** (10 + 3 yeni kilit), `tsc` iki tarafta temiz.

  Kullanıcı *"ayarlarda istediğim yeri düzenleyemiyorum"* dedi. Kayıt defteri
  sayımı şikâyeti birebir doğruladı: `home` yüzeyi **33** düzenlenebilir bileşen
  taşıyor, `settings` yüzeyi **1**. Üst bar, kategori menüsü, bölüm başlıkları,
  ayar kartları, anahtarlar ve kaydırıcılar Stüdyo için görünmezdi.

  **İkinci kök ölçüm tarafındaydı:** `probeEditableGeometry` `querySelector`
  kullanıyordu — bir kimliğin ekrandaki ilk düğümü dışında hiçbir örneği
  dokunulabilir değildi. Bu sınır kodda *"bilinen ve beyan edilen sınır"* diye
  yazılıydı; **beyan edilmiş olması onu zararsız yapmıyordu.** Sahada tam olarak
  o sınır kullanıcıyı durdurdu.

  Ölçüm artık `querySelectorAll` ile her örneği bildiriyor (kimlik başına en çok
  24 kutu, her kutu `index` taşıyor). Tek kural çok öğeye indiği için
  düzenleyici bunu **açıkça yazıyor**: *"Bu ayar aynı türdeki TÜM öğelere
  uygulanır."* — kullanıcı tek karta dokunduğunu sanıp "neden hepsi değişti"
  demesin.

  Eski kilit (*"yinelenen kimlik tek kutuya iner"*) sahada zarar veren
  davranışı koruyordu; **kaldırılmadı, yeni doğru davranışa güncellendi.**

  **Kalan eksik:** diğer 8 alt ekran (Teşhis · Bakım · Bildirimler · Hava ·
  Güvenlik · Dashcam · Spor · Seyahat) hâlâ 1'er bileşen — aynı desenle
  açılmalı. Telefonda kullanılmadı. Kabul ölçütleri kütük #628'de.

- **TEMA STÜDYO: SINIRSIZ RENK — "MOTOR VAR, BESLEYEN YOK"UN BİR ÖRNEĞİ DAHA
  (2026-08-18, kütük 🔴 #627):** website 57 dosya / **1189 test yeşil**
  (16 yeni kilit), `tsc` temiz, `next build` başarılı.

  Kullanıcı *"renkler yeterli değil sınırsız renk lazım ve yazılarda da renk
  az"* dedi. Ölçüm: renk alanları 16 hazır renk + native `<input type="color">`
  sunuyordu — native seçici **saydamlığı hiç vermez** ve küçük bir kare olduğu
  için "her rengi seçebilirim" bilgisini taşımıyordu.

  **Asıl bulgu:** manifest sözleşmesi (`isSafeColor`) `#RRGGBBAA` · `rgba()` ·
  `hsla()` zaten kabul ediyordu — **sınırsız renk ve saydamlık altyapıda
  vardı**, eksik olan tek şey arayüzdü. Bu, denetimlerde tekrar tekrar çıkan
  "motor var, besleyen yok" deseninin bir örneğidir.

  Eklenenler: saf `colorMath` (üç yazımı okur, tek kanonik hex üretir, HSV↔RGB,
  WCAG kontrast, nötr rampa) ve `ColorPicker` (doygunluk×parlaklık alanı · ton ·
  **saydamlık** · son kullandıkların). Sürüklerken `onChange` kare başına en çok
  bir kez (rAF) — her değişim iframe'e canlı manifest yayını tetikliyor.

  "Yazılarda renk az" için 12 basamaklı **nötr rampa**: eski liste ağırlıkla
  vurgu renkleriydi, oysa gövde metninde doğru cevap çoğu zaman bir gri tonudur.

  En kritik kilit: **tüm HSV uzayından üretilen her hex `isSafeColor`dan
  geçer** — geçmeseydi renk sessizce düşerdi (kullanıcı seçer, hata görmez,
  araçta hiçbir şey değişmez). Yan düzeltme: kaynak kilitleri artık yorumları
  soyarak tarar; *"X KALDIRILDI"* açıklaması tam da X'i arayan kilidi
  düşürüyordu (tiyatro kilit tuzağı).

  **Kalan eksik:** telefonda henüz kullanılmadı. Kabul ölçütleri kütük #627'de.

- **TEMA STÜDYO CANLI ÖNİZLEMESİ GERÇEKTEN CANLANDI — İKİ KÖK, İKİSİ DE
  YAYINDA (2026-08-18, kütük 🟡 #626):** website 57 dosya / **1174 test yeşil**
  (9 yeni kilit), `tsc` temiz, `next build` başarılı.

  Kullanıcı *"yaptığım düzenlemeleri göremiyorum"* dedi. İki bağımsız kök vardı:

  **(A) Canlı araç uygulaması eski sözleşmeyi taşıyordu.** Bundle taramasıyla
  ölçüldü: `caros-preview-ready` VAR (bu yüzden arayüz "CANLI ÖNİZLEME" diyor)
  ama `caros-theme-manifest` ve `caros-preview-probe` **YOK**. Yani araç
  "hazırım" deyip manifesti hiç dinlemiyordu — hata çıkmadan, sessizce. v3
  köprüsü çalışma branch'indeydi, `origin/main`'de değildi.

  **(B) Düzenleyici önizlemeyi tamamen kaldırıyordu.** `ThemeStudio` editör
  açılınca erken `return` ediyor, kabuk `fixed inset-0` ile ekranı kaplıyordu →
  "canlı önizleme" yalnız *hiçbir şey düzenlenmezken* görülebiliyordu; üstelik
  iframe unmount olduğu için araç uygulaması her seferinde baştan boot ediyordu.

  Panel artık sticky önizlemenin **altında**, aynı ağaçta; iframe hiç taşınmaz.
  Düzenlerken önizleme %62'ye inip ortalanır — yer açar ama **kaybolmaz**.
  Seçim overlay'i editör açıkken de canlı: başka bir karta dokunmak doğrudan o
  kartın düzenleyicisine geçirir.

  Her iki Vercel projesi `main`'e dokunulmadan hedefli production deploy ile
  yayınlandı ve **canlıda ölçülerek doğrulandı** (araç bundle'ında beş mesaj
  tipinin hepsi; PWA chunk'ında `62%` ve `caros-theme-manifest` var,
  `aria-modal`/`fixed inset-0` yok).

  **Kalan eksik:** kullanıcının üçüncü isteği — *"yazıya dokununca yazı
  değişsin"* — YAPILMADI. Kart editöründe "Yazı" bölümü ayrı duruyor, ama
  görsel olarak metnin üstüne dokunma yok: araç ölçümü yalnız `[data-editable]`
  KART kutularını bildiriyor. Ayrıca düzeltme gerçek telefonda henüz
  kullanılmadı. Kabul ölçütleri kütük #626'da.

- **#623'ÜN KÖKÜ CİHAZDA GÖRÜLDÜ: BOYA KUSURSUZ, ROTA EKRANIN DIŞINDA —
  GİRİŞ KAMERASI HAM GPS HEADING'E BAĞLIYDI (2026-08-18, kütük 🔴 #625):**
  560 dosya / **12 395 test yeşil** (**+45 kilit**), `tsc` temiz.

  #624'ün APK'sı gerçek cihaza kuruldu ve CDP-over-adb ile canlı MapLibre
  okundu. **Boya kusursuz çıktı** — #622'nin hedefi tutturulmuş: çekirdek
  gradient `#79b0ff → #a5aaff → #34d399` (WCAG parlaklık **0,424** = hedef
  0,42), kılıf `#f59e0b`, opaklık **1,00**, blur yok, `lineMetrics: true`,
  z-sırası doğru. #623'te şüphelenilen köklerin **hepsi elendi**.

  **Ama rota ekranda hiç yoktu:** MapLibre 5 rota katmanının hiçbirini
  çizmiyordu ve rotanın **309 noktasının 0'ı** görüş alanındaydı — araç
  ekranda (451,301), rotanın ilk noktası (465,**432**), pencere 902×405.
  Kamera −42,5° bakarken rota güneybatıya gidiyordu.

  **Kök:** `enterNavigationView` altı çağrı yerinin hepsinde ham GPS heading
  (`headingRef.current ?? 0`) ile çağrılıyordu — dokümantasyonu *"first route
  step direction or GPS heading"* dediği hâlde rota yönü hiç kullanılmıyordu.
  Park hâlindeki araçta GPS heading **fiziksel olarak anlamsızdır** (Doppler
  yok) ve `?? 0` kamerayı kuzeye çevirir; kamera bir kez yanlış kurulunca araç
  hareket etmediği sürece hiçbir kod düzeltmiyordu (`setDrivingView`in yön
  düzeltmesi >5 km/h ister). **Google/BMW/Mercedes'te "Başlat"a basıldığı an
  kamera rotanın ilk adımına döner — araç dursa bile. Bizde dönmüyordu.**

  **#624'ün yapısal kör noktası da kanıtlandı:** paint denetçisi bu durumda
  hiçbir kural tetiklemez ve *"kök adayı yok"* der. Ekranın kendi uyarısı
  (*"kök bu ekranın bilmediği bir yerdedir"*) doğrulandı ve o boşluk kapatıldı:
  denetçiye **"Rota Ekranda mı"** bölümü + 4 teşhis kuralı eklendi; ölçüm
  türetilen sayımı (DERIVED) MapLibre'nin kendi render kanıtıyla (OBSERVED)
  yan yana koyar, ufuk-ötesi noktaları gidiş-dönüş projeksiyonuyla eler.

  **Düzeltme:** yön artık bir karardır (`resolveEntryBearing`, saf) — durağan
  araçta rota yönü GPS'i ezer, hareket hâlinde GPS üstünlüğü korunur, hiçbir
  kaynak yoksa kamera döndürülmez. Rotanın ileri yönü hesabının üründe **iki
  kopyası** vardı; üçüncüsü yazılmadı, kural tek saf fonksiyona taşındı.

  **Kalan eksik:** düzeltme **gerçek araçta bir kez bile çalıştırılmadı**
  (kullanıcı rotayı kapatıp ayrıldı). **Açık borç:** rota yine de kaybedilirse
  otomatik toparlama YOK — ölçüm katmanı hazır, tetikleyici bilerek
  bağlanmadı (cihazda doğrulanamayan kamera değişikliği bu dosyada daha önce
  iki kez regresyon üretti). Kabul ölçütleri kütük #625'te.

- **CAROS LAB · ROTA KATMAN DENETÇİSİ — "SONUCU DEĞİL SEBEBİ" GÖSTEREN GÖZLEM
  YÜZEYİ (2026-08-18, kütük 🔴 #624):** 559 dosya / **12 350 test yeşil**
  (27 yeni kilit), `tsc` temiz.

  #622'de rota cihazda soluk ÖLÇÜLDÜ ama kök teşhis edilemedi: `apk:safe`
  artefaktında CDP kapalıdır, MapLibre'nin gerçek paint değerleri okunamıyordu.
  Geçici bir CDP artefaktı üretmek yerine **kalıcı gözlem yüzeyi** eklendi —
  gözlemlenebilirlik kuralının tam olarak istediği çözüm: *"gözlemlenemeyen
  özellik tamamlanmış değildir."* Ekran her rota katmanının GERÇEK
  `line-color`/`line-gradient`/`line-opacity`/`line-blur`/z-sırasını, kaynağın
  `lineMetrics` durumunu ve bunların `resolveRouteColor` kararıyla farkını
  gösterir; altı teşhis kuralı ölçülen alanlardan deterministik türetilir.

  Salt-okunur olduğu **kilitle kanıtlanır** (sahte harita yazma çağrılarını
  sayar; tek yazma bile olsa kilit düşer). "Kök adayı yok" mesajı bilerek
  *"bu, rota doğru görünüyor DEMEK DEĞİLDİR"* der — fail-closed dil.

  **Kalan eksik:** ekran gerçek araçta **bir kez bile açılmadı** — kurulum
  anında USB bağlantısı koptu, APK cihaza gitmedi. **#623'ün kökü hâlâ
  görülmedi.** Kabul ölçütleri kütük #624'te.

- **GECE HARİTASI "GOOGLE SEVİYESİ" — KÖK ORAN DEĞİL, MUTLAK YÜZEY
  PARLAKLIĞIYMIŞ (2026-08-17, kütük 🔴 #622):** `tsc` temiz, suite yeşil.

  #609/#612/#619/#620/#621 turlarında ölçtüğüm **kontrast oranları doğruydu**
  (gece tali yolu 2,47 · Google 1,31), ama harita hâlâ "ölü/boş" görünüyordu.
  Ölçüm kökü gösterdi: Google gece zemini 0,0276 luminans, bizim ekranda
  **0,0081** — yüzey **3,4 kat** daha karanlıktı. Oran kilitleri bunu yapısal
  olarak göremez: **zemin karardıkça oranlar YÜKSELİR.** Zemin `#222c3c`ye
  çıkarıldı, gece CSS filtresi **tamamen kaldırıldı** (gece artık TEK
  otoriteden — ölçülmüş paletten — gelir), alan dolguları ve yol merdiveni
  yeni yüzeye göre yeniden ölçüldü.

  **Bu turun asıl bulgusu bir SESSİZ REGRESYON:** yeni palet yolu açtı
  (`#6a6b70 → #6f7581`) ama rota çekirdeği eski tonlarda kaldı → rota↔yol
  kontrastı **1,95 → 1,70**, yani #619'un **kendi eşiğinin altına** düştü.
  Kilit bunu kaçırdı çünkü zemini/yolu **sabit kopya** olarak tutuyordu; bir
  diğeri artık **silinmiş** bir `brightness(0.8)` filtresini modelliyordu —
  ikisi de var olmayan bir ekranı ölçüyordu. Ders, `#614` ile aynı sınıftan:
  **düşmeyen kilit tiyatro olabilir; kilit sabiti değil KAYNAĞI okumalı.**
  Kilitler canlı palete bağlandı, çekirdek durakları yeniden ölçüldü ve
  kasaya bugüne dek hiç olmayan bir **mutlak parlaklık** kilidi eklendi.

  **Kalan eksik:** hepsi host ölçümüdür — **#612'den beri gece paleti gerçek
  araçta bir kez bile görülmedi.** Kabul ölçütleri kütük #622'de.

- **`failure:OBD` TEK YÖNLÜ CIRCIRI KAPATILDI — ARIZA MERDİVENİ ARTIK GERİ
  DÖNÜŞLÜ (2026-08-16, kütük 🔴 #606):** araç suite **12 263 test / 551 dosya
  YEŞİL**, guard **522/522**, `tsc` temiz, **16 yeni kilit**.

  **#604 kökü cihazda yakalamıştı ama düzeltmemişti** ("runtime düşürme
  politikası kararı gerekir" diye borç yazılmıştı). Bu tur karar verildi.
  Üç kusur birlikte çalışıyordu: `reportFailure()` **her çağrıda** bir kademe
  iniyordu · çağıran `_scheduleReconnect()` bir istisna değil **rutin** yoldur
  (10 çağrı yeri, üstel tur + 5 dk'lık derin döngü) · **yukarı karşılık YOKTU**.
  Sonuç: dongle beslenmiyorsa ~40 sn'de `SAFE_MODE`, üstelik `rt-last-mode`
  üzerinden **sonraki açılışlara sızıyordu**.

  **YENİ SÖZLEŞME:** arıza merdiveni **bileşen başına tek kademe** iner (latch),
  tabanı **`POWER_SAVE`**'dir (SAFE_MODE yalnız **bilinçli** kararların modu:
  RAM krizi / crash-recovery) ve **geri dönüşlüdür** — `reportRecovery()` tüm
  arızalar geçince modu arıza öncesi seviyeye 30 sn histerezisle geri çıkarır.
  Kurtarma hedefi `_detectCapabilities()` ile **yeniden hesaplanmaz**
  (`runtimeOverride`'ı sessizce ezmemek için — #601(B) `cl_performanceMode`
  dersi) ve başka bir otorite modu devraldıysa hedef unutulur. Çağrı ucunda
  **dongle yokluğu arıza sayılmaz** (yalnız kanıtlanmış adaptörün kopması).

  **YÖNTEM NOTU:** çağrı ucu düzeltmesi tek başına saha vakasını **çözmezdi** —
  cihazdaki adres kanıtlıydı, circir tam da korunan yolda ateşleniyordu. Bu
  tahminle değil ölçümle ayrıldı: bir test 180 sn'lik pencerede
  `reportFailure('OBD')`'nin 1'den çok kez çağrıldığını kanıtlıyor → koruma
  **runtime latch'inde olmak zorunda**. Kilitlerin kilit olduğu, düzeltme
  geçici geri alınıp **4 testin düşmesiyle** gösterildi.

  **GÖZLEM:** CAROS LAB → Çalışma Zamanı → **Performans** ekranı katalogda
  "runtime modu" vaat ediyordu ama hiç göstermiyordu; eklendi (aktif mod ·
  güç/termal tavanı · arızalı bileşen listesi · kurtarma hedefi — salt-okunur,
  komut yok, timer yok).

  **AÇIK BORÇ:** #604(F) **crash-recovery yapışkanlığı** — `PERSIST_KEY` hiçbir
  yerde tüketilmiyor, `start()` kaydı yeniden yazıyor. Ayrı bir güvenlik-ağı
  politikası kararıdır, tahminle değiştirilmedi. Circir kapandığı için kaydın
  *yeni* zehirlenmesi bu yoldan gelemez, ama **hâlihazırda zehirli bir cihaz
  kendi kendini kurtaramaz** (kayıt iki katmanda: dosya + localStorage).
  **Cihazda doğrulanmadı → 🔴 kalır.**

- **GÖRSEL ÇAKIŞMA İDDİALARI GERÇEK TARAYICIDA YENİDEN ÖLÇÜLDÜ — 2'si gerçek,
  2'si ÖLÇÜM ARTEFAKTI (2026-08-16, kütük 🔴 #605):** araç suite **12 247 test /
  549 dosya YEŞİL**, guard **522/522**, `tsc` temiz, **8 yeni kilit**.

  **YÖNTEM DÜZELTMESİ ASIL BULGU:** saha turu çakışmaları ham
  `getBoundingClientRect()` ile ölçmüştü. O kutu ne `overflow` kabında
  **kaydırılmış** çocukları ne `opacity:0` katmanları bilir → "kesişiyor ama
  BOYANMIYOR" üretir. Playwright + gerçek Chromium üzerinde **kırpma +
  görünürlük + örtülme** farkındalıklı ölçüm kuruldu; **4 viewport × 3 ürün
  durumu**, rozet için ayrıca **4 tema** tarandı.

  **GERÇEK ÇIKANLAR (ikisi de üç çözünürlükte de vardı — telefona özel DEĞİL,
  düzeltmeler genel):** (1) saha testi rozeti `CAROS` marka mührünü örtüyordu
  (904×406: amblem %61 · `CAR` %64 · `OS` %67); çapa **6 aday × 9 durum**
  sınanarak veriyle seçildi. (2) sol alt köşenin **iki sahibi** vardı —
  etiketsiz `Yol durumu bildir` düğmesi `ÖZEL KONUMLAR` kartının üstüne
  biniyordu (kullanıcının "sahipsiz yarı saydam kare" dediği şey buydu).

  **DÜŞÜRÜLENLER (kod DEĞİŞTİRİLMEDİ — olmayan kusura düzeltme yazılmaz):**
  `YOL/HİBRİT/UYDU` düğmeleri ayrık ölçüldü ve navigasyonda `opacity:0`;
  alt bar etiketleri (`Bildirim`/`Menü`/`Telefon`) **dört viewport'ta da hiç
  boyanmıyor** (`DockScrollZone` içinde kırpılı) → çakışamazlar.

  **YAN BULGU — AÇILIŞ ÇÖKMESİ:** ölçüm sırasında gerçek tarayıcıda uygulama
  `Cannot access 'MAP_BG_NIGHT' before initialization` ile **açılışta
  çöküyordu**; kök `_mapState` ↔ `mapStyleBuilders` **dairesel bağımlılığı** —
  #552'de kapatılan döngünün **ikinci yarısı**. Token'lar döngüsüz `_mapIds`e
  taşındı. Rollup sırası bugün ters olduğu için üründe belirti görünmüyordu:
  kusur **gizliydi, yok değildi**.

  **AÇIK BORÇ:** `ONLINE` kaynak rozeti ↔ `KAPAT`/`ANA EKRAN` düğmesi üç
  çözünürlükte de çakışıyor; 7 aday konum sınandı, **hepsinde temiz olan slot
  yok** → bu tek bir çipin yeri değil, **harita HUD'unda paylaşılan köşe
  bütçesinin olmaması** sorunudur (`useDenseHud` şerit modelinin karşılığı).
  Tahminle taşınmadı.

- **AÇILIŞTA SAFE_MODE — KÖK BULUNDU (2026-08-16, kütük 🔴 #604):** native
  `onTrimMemory` şiddet testi `>= TRIM_MEMORY_RUNNING_CRITICAL (15)` idi; ama
  `UI_HIDDEN=20` · `BACKGROUND=40` · `MODERATE=60` · `COMPLETE=80` **"arka
  plana düştün"** bildirimidir, bellek baskısı değil. Zincir ürün kodunda uçtan
  uca doğrulandı: `"CRITICAL"` → `memoryWatchdog` → `setMode(SAFE_MODE)` →
  `_commit()` diske yazar → sonraki açılışta `start()` **SAFE_MODE'a sabitler**.
  Yani **Home tuşuna basmak** kalıcı SAFE_MODE üretiyordu. İkinci kök: geçişi
  duyuran log satırı, `logGate` yürürlükteki modu okuduğu için **kendi geçişi
  tarafından susturuluyordu** — kökün iki tur boyunca bulunamamasının sebebi
  buydu; yeni `rawConsole.ts` ile mod satırları kapıdan bağımsız yazılır.
  8 kilit. **Cihazda canlı yakalanmadı → 🔴 kalır.**

- **TEMA MİMARİSİ DÜZELTİLDİ — araç TÜKETİCİ oldu, ikinci stil otoritesi
  söküldü (2026-08-16, kütük 🔴 #597):** araç suite **12 200 test / 544 dosya
  YEŞİL**, `tsc -b` temiz, **4 yeni kilit**.

  **ÖLÇÜLEN KUSUR (gerçek araç ekran görüntüsü):** araçta bir karta **uzun
  basınca** tam bir tema editörü açılıyordu (RENK/YAZI/ŞEKİL/EFEKT + paletler +
  "SADECE BU / TÜMÜ"). Mimari ters kurulmuştu. Bu yalnız bir yerleşim hatası
  değildi — **ürünü kırıyordu:** `editStyleEngine` kendi style etiketine
  **`!important`** yazıyordu → araçta kalmış eski bir yerel düzenleme, Tema
  Stüdyo'dan gelen **Manifest v3'ü sessizce eziyordu**. Kullanıcı temayı
  gönderiyor, araçta değişmiyor, sebep hiçbir yerde görünmüyordu. Üstüne
  `useEditStore` varsayılanı **`locked: false`** idi → sürüş sırasında her uzun
  basış paneli açıyordu. Ve iki kayıt defteri yarışıyordu
  (`EDITABLE_REGISTRY` 36 ↔ `THEME_COMPONENTS` 33).

  **SÖKÜLEN: 1416 satır** — `useEditStore` · `EditPanel` · `editStyleEngine` ·
  `EditController` (`App`'te tüm ağacı sarıyordu) + `themeDocument.ts`
  (Manifest v3'ün öncülü; **kendi testinden başka üretim çağıranı yoktu**).

  **Yetenek kaybı YOK — ölçüldü:** yeni `EditableProp` (20) eski
  `ElementStyle`'ın (14) **üst kümesi**. Tek karşılıksız alan `size`; yerine
  `fontScale` + `padding` + `gap` + solver kart boyutu geçer.

  **Kalan tek zincir:** Arabam Cebimde / Tema Stüdyo → Manifest v3 →
  `theme_change` → `parseIncomingManifest` (**fail-closed**) → `themeRuntime` →
  tek `<style>`. Araçta artık **tek stil otoritesi** var. `data-editable`
  işaretleri kaldı — onları uzun-bas değil, Stüdyo'nun salt-okuma ölçüm köprüsü
  kullanıyor.

  **Ders: "APK'da editör yok" iddiası, aradığın ADI bilmene bağlıdır.**
  `ThemeStudio` grep'i temiz döndüğü için "ihlal yok" denmişti; ihlal başka
  adla (`EditController`/`EditPanel`) duruyordu. Bu yüzden yeni kilit **isme
  değil, DAVRANIŞA** bakıyor: tüm `src` taranıp ikinci bir stil otoritesinin
  doğmadığı doğrulanır — ve tarayıcının gerçekten gezdiği **kontrol ölçütüyle**
  kanıtlanır (≥300 dosya + var olan bir kimliği bulabilmesi), kilit boşluğa
  atılmaz.

  **AÇIK BORÇ:** `car-edit-system-v4` localStorage kaydı cihazlarda **yetim**
  kalır (okuyanı yok, zararsız) — temizlik yapılmadı. Ayrıca hem PWA hem APK
  **dağıtılmadı**: sahadaki telefon hâlâ 2 temalı eski Stüdyo'yu, araç da
  sökülmemiş APK'yı çalıştırıyor.

- **TEMA STÜDYO P0/P1 — "4 hazır tema seçiyorum"dan "CAROS'un görsel dilini
  tasarlıyorum"a (2026-08-15):** araç suite **12 175 test / 544 dosya YEŞİL**,
  PWA suite **1 100 test / 53 dosya YEŞİL**, `npm run guard` **518/518**,
  `tsc -b` ve `website tsc --noEmit` temiz. **76 yeni kilit.**
  Durum: **ENTEGRE** (host kanıtı tam; cihaz kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).
  Kütük: 🔴 **#589** (Tema Manifesti v2 + LAB ekranı) · 🔴 **#590** (4 tema +
  tam ekran editör) · 🔴 **#591** (kararlı bileşen kimliği + dokunarak seçim) ·
  🔴 **#592** (`theme_change` `data-theme="dark"` kusuru).

  **Ölçülen üç kök boşluk:** (1) Stüdyo'da **2 tema** vardı, araçta **4** tema
  render ediliyor — üstelik stüdyodaki iki temanın paleti araçtakiyle artık
  uyuşmuyordu (sessiz belge-kod ayrışması). (2) Araç `EDITABLE_REGISTRY`'de
  **31 kimlik** ilan ediyor, DOM'da **5 tanesi** vardı → bileşen bazlı tema
  fiilen imkânsızdı ("motor var, besleyen yok"). (3) Araca giden paket
  **sürümsüz ve doğrulanmamış** bir CSS-var torbasıydı; araç her anahtarı
  körlemesine yazıyordu ve `theme_change` her seferinde geçersiz
  `data-theme="dark"` basıyordu.

  **Yeni mimari (tek sözleşme, iki paket):** `themeManifest.ts` (schemaVersion 2:
  `themeId · themeVersion · tokens · componentOverrides · screenOverrides ·
  metadata`) + `themeComponentRegistry.ts` (kararlı `componentId`, DOM seçicisine
  bağlı DEĞİL) araç ve PWA'da **birebir** yaşar; ayrışma `themeContractParity`
  testiyle kilitlidir, `scripts/sync-theme-contract.mjs` ile senkronlanır.
  **NULL = DOKUNMA:** kullanıcı dokunmadıkça manifest boştur ve araç görünümü
  birebir aynı kalır. Yerel depo fail-SOFT, araca gelen paket **fail-CLOSED**
  (şema ihlali → komut `failed`, sebep LAB'da görünür). Gradient serbest metin
  değil **yapı** olarak taşınır → CSS injection yapısal olarak imkânsız.

  **Kapsam:** 4 tema · **10 ekran (surface)** · **33 düzenlenebilir bileşen** ·
  tam ekran editör (renk/gradient/tipografi/ikon/yerleşim/durum) · geri al-yinele ·
  **seviyeli** sıfırlama (bileşen → ekran → tema) · tema başına kalıcılık.
  Gözlem yüzeyi: **CAROS LAB → Çalışma Zamanı → Tema Manifesti** (salt-okunur;
  "uygulandı ≠ görünüm değişti" ayrımını hüküm olarak verir).

  **AÇIK BORÇ:** önizleme iframe'i **dağıtılmış** araç uygulamasını gösterir; bu
  turda dağıtım yapılmadı → "Dokun & Düzenle" ile önizlemeden bileşen seçme,
  araç uygulaması yeniden dağıtılana kadar **ölüdür** (bileşen listesinden seçim
  çalışır).

- **TEMA STÜDYO TAMAMLAMA TURU — yerleşim manifest'e girdi, dokunma modeli
  değişti (2026-08-15, aynı gün):** araç suite **12 209 test / 545 dosya YEŞİL**,
  PWA suite **1 125 test / 54 dosya YEŞİL**, `npm run guard` **518/518**,
  her iki `tsc` temiz, lint'te **yeni sorun yok** (12 hata da önceden vardı).
  **+56 kilit** (toplam 132). Durum: **ENTEGRE** — **ÜRÜN HAZIR: HAYIR**.
  Kütük: 🔴 **#593** (Manifest v3 + yerleşim) · 🔴 **#594** (ölçüm+overlay
  dokunma modeli).

  **Manifest v3:** `layoutOverrides` eklendi; v2 ve v1 paketleri **reddedilmez**,
  taşınır (yalnız v4+ reddedilir). **İkinci yerleşim motoru YAZILMADI** — alanlar
  `layoutSolver`ın gerçek ölçüleridir (`visible · size · ord · grow`), çözümü
  hâlâ `solveLayout` yapar. `zone` ve `alignment` **uydurulmadı** (solver'da yok).

  **Kapsam sınırı — kod gerçeği:** yerleşim motorunu fiilen kullanan temalar
  **yalnız Pro ve Expedition**tır; Horizon ve Tesla sabit grid ile çizilir →
  o temalarda yerleşim düzenlenemez ve Stüdyo bunu açıkça söyler.

  **Bilinçli davranış değişikliği:** `useLayoutStore` tek ortak niyet tutuyordu;
  Pro ve Expedition `music`/`vehicle`/`dock` kart id'lerini paylaştığı için
  biri diğerini eziyordu. `byTheme` eklendi (`byTheme[tema] ?? intent`) →
  o tema için manifest yoksa **eski davranış aynen sürer**.

  **Dokunma modeli değişti:** araç artık dokunuşu yakalamıyor, `preventDefault`
  çağırmıyor, DOM'a vurgu/stil yazmıyor. Yalnız `getBoundingClientRect`
  **ölçümü** bildiriyor; seçim katmanı Stüdyo'nun kendi overlay'i. Dokunuş
  iframe'e hiç ulaşmadığı için araç davranışını bozması yapısal olarak imkânsız.

  **CİHAZ DOĞRULAMASI YAPILAMADI:** `adb devices` boş (bağlı cihaz yok) ve bu
  görevde deploy/APK yasak. A–J senaryolarının tamamı 🔴 bekliyor.

- **TEMA STÜDYO GEÇMİŞİ — snapshot'tan DİLİM tabanlıya (2026-08-15, aynı gün):**
  araç suite **12 209 test / 545 dosya YEŞİL**, PWA suite **1 156 test / 55 dosya
  YEŞİL**, `npm run guard` **518/518**, her iki `tsc` temiz, lint'te yeni sorun yok.
  **+31 kilit** (toplam 163). Durum: **ENTEGRE** — **ÜRÜN HAZIR: HAYIR**.
  Kütük: 🔴 **#595**.

  **Ölçülen kusur:** geçmiş her adımda tüm manifest kümesinin kopyasını
  yığına atıyordu → "geri al" yapısal olarak GLOBAL'di; A kartını geri almak
  B kartını da o anki hâline döndürüyordu.

  **Çözüm — ikinci motor yazılmadı:** aynı `past`/`future` yığını korundu,
  adımın içeriği değişti. Artık her adım tek bir DİLİMİN önce/sonra değeri
  (`tokens` · `componentOverrides[x]` · `layoutOverrides[y]` ·
  `screenOverrides[z]` · `card` · `theme`). Dilimler bağımsız olduğu için
  kart-bazlı geri al tek yığından, ek durum tutmadan çıkıyor. `undo`/`redo`
  isteğe bağlı **kapsam** alıyor: yoksa global, kart editöründe kart kapsamı.

  **Yeni işlemler:** "↺ Tüm Değişiklikleri Geri Al" (seçili temanın tamamı,
  tek transaction, diğer temalara dokunmaz, iki adım onay) ve "↺ Kartı Sıfırla"
  (yalnız o kartın stili + yerleşimi, tek adım, onaylı).

  **Atomiklik:** aynı alana ardışık dokunuş `mergeKey` ile tek adıma iner;
  editör açma/kapama ve gezinme birleştirmeyi kırar.

  **Güvenlik kapısı:** kart kapsamlı geri al, geriye tararken tema düzeyi bir
  adıma rastlarsa DURUR — aksi hâlde tema sıfırlamasından sonra silinmiş bir
  override'ı geri diriltirdi.

  **Değişmeyen:** ThemeManifest v3 sözleşmesi · `theme_change` protokolü ·
  fail-closed doğrulama · zero-trust overlay · kalıcılık (geçmiş **oturum
  ömürlü**dür, depoya yazılmaz — zorla kalıcılık eklenmedi).

- **ENVANTER/BAĞLANTI DENETİMİ ve İLK DÖRT DÜZELTME (2026-08-13):** tam suite
  **11 951 test / 526 dosya YEŞİL**, `tsc` temiz, **19 yeni kilit**.
  Durum: **ENTEGRE** (host kanıtı tam; cihaz kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  Kütük: 🔴 **#558** (panik yakalayıcı) · 🔴 **#559** (tazelik otoritesi) ·
  🔴 **#560** (yakıt varsayımı) · 🔴 **#561** (AI Gateway izni).
  Denetim raporu: `docs/ENVANTER_BAGLANTI_DENETIMI_2026-08-12.md`.

  **Neden denetim:** Guardian'ın motorsuz olması, DR sinyalinin ölü olması ve
  akünün çok otoriteli olması artık tesadüf sayılmıyordu. Tüm CAROS LAB kataloğu
  (50 araç) beş mercekle tarandı: (1) kablo döşenmiş uca bağlanmamış, (2) ikinci
  otorite, (3) AVAILABLE ama içi boş, (4) belge-kod ayrışması, (5) sessiz varsayılan.

  **Kapatılan dört kusur:** panik yakalayıcı hiç kurulmuyordu (global JS hatası
  post-mortem üretmiyordu) · aynı tazelik sorusu üç dosyada elle kopyalanmış
  sayılarla cevaplanıyordu · yakıt varsayımı iki dosyada iki farklı sayıydı ve
  ikisi de kullanıcıya görünüyordu · AI Gateway kapsam izni sunucudan hiç
  okunmuyordu (kapı kalıcı fail-closed).

  **DENETİMİN KENDİ HATASI (kayda geçer):** ilk turda kullanılan "sıfır çağıran"
  ölçümü **sarmalayıcı üzerinden çağrılan** sembolleri yetim sanıyordu. Düzeltme
  turunda **altı bulgu geri çekildi** (E-07 · E-08 · E-13 · E-14 · E-18 · E-23) ve
  **ikisi daraltıldı** (E-15 · E-28). Kalıcı ders: statik "çağıran yok" sinyali tek
  başına kanıt DEĞİLDİR; sarmalayıcı zinciri takip edilmeden bulgu ilan edilemez.
  Aynı ders `feedback_audit-falsification-discipline` kaydında zaten vardı.

- **DENETİMİN KALAN SIRASI KAPATILDI (2026-08-13, ikinci tur):** tam suite
  **11 981 test / 531 dosya YEŞİL**, `tsc` temiz, **30 yeni kilit** (her blokta
  en az bir **KONTROL testi**). Durum: **ENTEGRE** (cihaz kanıtı YOK —
  ÜRÜN HAZIR: HAYIR). Kütük: 🔴 **#562** (medya kurtarma başarısı) ·
  🔴 **#563** (Phone Hub eşleştirme onayı) · 🔴 **#564** (kaza günlüğü okuma) ·
  🔴 **#565** (uzun yol tek otorite) · 🔴 **#566** (sahte-sıfır sınıfı) ·
  🔴 **#567** (TRIP AI durum kapısı). Rapor: `ENVANTER_BAGLANTI_DENETIMI…md` §0.2.

  **En pahalı üç kusur:** (1) medya kurtarma deneme sayacı hiç sıfırlanmıyordu →
  üç açılış sonrası process-death kurtarması **kalıcı** ölüyordu; (2) Phone Hub
  eşleştirme onayı hiçbir yüzeye bağlı değildi → RFCOMM oturumu **hiç
  kurulamıyordu** (#122'nin kod tarafındaki ucu); (3) kaza günlükleri yazılıyor
  ama **hiçbir yerden okunamıyordu** → kaza sonrası adli kanıt zinciri ölüydü.

  **Sahte-sıfır sınıfı (5 dosya) kapatıldı:** LAB sözleşmesi (`observed(null) →
  UNAVAILABLE`) sağlamdı; kusur **sözleşmeyi atlayan kaynak katmanlarındaydı**
  (`Number(x) || 0`). Bedeli teşhistir: "hiç olmadı" ile "ölçülemedi" aynı
  ekranda ayırt edilemiyordu — teşhis aracının kendisi hata avında yanlış yöne
  sürüklüyordu.

  **DENETİMİN İKİNCİ DERSİ:** bu turda **dört bulgu daha** geri çekildi/yeniden
  sınıflandırıldı (E-17 · E-16 · E-15 · E-25) çünkü ilgili dosyalar boşluğu
  **kendi başlıklarında BEYAN EDİYORDU** ("head unit'te bilinçli olarak boştur;
  üretim sunucuda") ve LAB ekranları bunu dürüstçe `UNAVAILABLE` gösteriyordu.
  Kalıcı ders: **beyan edilmiş borç ile sessiz boşluk aynı şey değildir** —
  dosyanın kendi başlığını okumak ölçümün parçasıdır. E-31/E-32 ise ters yönde
  düzeltildi: "kapı yok" sanılan şey aslında **kapının iki yerde kopyalanmış**
  olmasıydı (K1 → K2).

  **"Güvenli şekilde yapılabilir mi?" — üçüncü tur (aynı gün):** §0.2'de
  "yapılmadı" diye bırakılan üç madde yeniden ölçüldü ve ikiye ayrıldı.
  **E-02/E-03 yapılabilirmiş ve YAPILDI:** koridor ve öneri motorları tamamen
  saf çıktı (ağ yok · async yok · store yazma yok), POI kaynağı cihazın kendi
  yerel deposu → LAB'a **elle tetiklenen** hesap olarak bağlandı
  (`tripAiSources` + `tripAiModel`). Kilitlenen sınırlar: rota YAZILMAZ · ağa
  ÇIKILMAZ · timer KURULMAZ · açılışta KOŞMAZ · yer adı/adres/koordinat çıktıya
  SIZMAZ. **E-04 ve E-29 ise yapılmamalıymış:** `tripApplyComposition`
  adapter'ları `writeActiveRoute` (rota yazar) + `fetchRouteLeg` (ağa çıkar)
  kullanıyor → ürün kararı; keşif eylemleri ise `vehicle.*` önekiyle
  `takeoverPolicy.FORBIDDEN_PREFIXES` duvarına çarpıyor — politika modülünün
  kendi beyanı: *"hiçbir config onları TAKEOVER'a alamaz"*. Yani sesli keşif
  komutu bir wiring satırı değil, **güvenlik beyaz listesini delme** kararıdır.
  Tam kasa **11 997 test yeşil** · kütük 🔴 **#567** güncellendi.

  **Ders:** "yapmadım" ile "yapılmamalı" farklı şeylerdir ve ikisi de
  ÖLÇÜLEREK ayrılır. Kapı kurmak bir **son çaredir**, ölçmemenin mazereti
  değil: üç maddeden biri güvenle yapılabilirmiş.

  **Açık borçlar (yazıldı, kapatılmadı):** Fleet/AI sunucu okuma köprüsü
  (E-15/16/17 — dört LAB modülü dürüstçe boş) · `getPanicHandlerStatus()` LAB
  yüzeyi · `sessionInspectorSources` kalan sayaçları (aynı sahte-sıfır sınıfı) ·
  keşif eylemleri takeover politikası · TRIP AI ürün tetikleyicisi.

  **AÇIK BORÇ:** `getPanicHandlerStatus()` için LAB gözlem yüzeyi YOK · tazelik
  birleştirmesi yalnız *aynı sayıyı* taşıyan kanıtlı kopyaları kapsar (farklı
  değerli eşiklerin gerekçeleri yazılmadı) · ayakta kalan bulgular (E-15 defter
  yazımı · E-16 · E-17 · E-20 · E-25 · E-26 · E-28 defter/kuyruk · E-29 · E-31 ·
  E-32 · E-33 · sahte-sıfır sınıfı E-10/E-11/E-19/E-21/E-22) HENÜZ KAPATILMADI.

- **CAROS LAB · "TÜMÜNÜ YENİLE" tek tuşu + otomatik tur (2026-08-12):** tam suite
  **11 929 test / 525 dosya YEŞİL**, `tsc -b` temiz, eslint temiz, **31 yeni kilit**
  (`src/__tests__/carosLabRefreshAll.test.tsx`).
  Durum: **ENTEGRE** (host kanıtı tam; cihaz kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  Kütük: 🔴 **#556** (tek tuş · 9 bölüm) · 🔴 **#557** (otomatik tur · arka planda durur).

  **Neden:** LAB deseni "açılışta tek okuma + elle YENİLE"dir. Doğru ama sahada
  pahalıydı — bir tur kanıt toplamak için 9 ekranı tek tek açıp her birinde
  YENİLE'ye basmak gerekiyordu. Daha kötüsü **gözlem sırası bağımlılığı**: iki
  native kanıt önbelleği (#523 poll sayacı, #524 eleme) YALNIZ ilgili ekran
  açıldığında doluyordu → "TÜMÜNÜ KOPYALA" sık sık BAYAT kanıtla alınıyordu.
  #505 bu durumu bir uyarı satırıyla **söylüyordu ama çözmüyordu**.

  - **Tek tuş, sıralı tur:** `native-poll-evidence` → `native-elimination` →
    `kwp-recovery` → `poll-scheduler` → `location-engine` → `fix-age-ledger` →
    `navigation-core` → `eta-jump-ledger` → `address-search`. Sıra native-öncedir:
    ters sırada türetilmiş anlık görüntüler bir önceki turun önbelleğini okurdu.
    Native çağrılar **aynı anda basılmaz** (K24 / Mali-400 gerçeği).
  - **Dürüstlük sözleşmesi:** her bölüm kendi durumunu taşır — `TAZELENDİ` ·
    `KAYNAK YOK` · `OKUNAMADI` · `ZAMAN AŞIMI`. **"kaynak yok" ile "okunamadı"
    asla aynı kovaya atılmaz**; başarısız bölüm ekranda **adıyla** görünür
    (sessiz atlama YOK). Asılı bir native çağrı turu kilitlemez (6 sn üst sınır →
    o bölüm `ZAMAN AŞIMI`, tur devam eder). "Son BAŞARI" damgası yalnız gerçekten
    tazelenince ilerler — başarısız turda eski damga korunur.
  - **Otomatik tur, bütçeye abone:** aralık `getDeviceTier()`ten gelir —
    low **90 sn** · mid **60 sn** · high **45 sn**. Sıcak yola (3 Hz hız/RPM)
    GİRMEZ; maliyet **yalnız LAB açıkken** oluşur. Periyodik turun **sahibi**
    `CarosLabRefreshBar`'dır: LAB kapanınca unmount → `clearInterval`; uygulama
    arka plana atılınca `visibilitychange` → tur DURUR, öne gelince bir tur
    koşup devam eder. Yeniden giriş koruması koşucudadır (oto + elle tetik
    üst üste binmez).
  - **SALT-OKUNUR (pazarlıksız):** bağlantı KURMAZ, YENİDEN BAĞLANMAZ, araca
    komut/PID/AT sorgusu GÖNDERMEZ, poll · handshake · Derin Tarama BAŞLATMAZ;
    native uçlar salt SAYAÇ okumasıdır. **"TAZE bağlantı kur" ve H-A deneyi gibi
    araca dokunan ekranlar KAPSAM DIŞIDIR** — bilinçli kullanıcı eylemi olarak
    kalır (yapısal kilit: kataloğa `reconnect`/`connect`/`write` içeren bölüm
    giremez). Gizlilik: koordinat · adres metni · hedef adı · VIN turdan GEÇMEZ.
  - **Bilinçli ödünç (beyan):** açık olan araç ekranı bu turda **yeniden
    render EDİLMEZ** — remount, geliştiricinin ekran içi durumunu (yazdığı
    sorgu, açtığı kart) her turda silerdi. Tazelik yüzeyi turun kendi ayrıntı
    panelidir: her bölümün başlık ölçüsü (izlenen PID, p50/p95 fix yaşı, sıçrama
    adedi…) orada zaten görünür. Açık ekranın kendi YENİLE tuşu artık **taze
    önbelleği** okur.

- **NAV-MINIMAP-CONT-P0 · Navigasyon Oturum Sürekliliği (2026-08-03 → 04):**
  tam suite **10 447 test / 468 dosya TAMAMEN YEŞİL**, `tsc -b` temiz,
  `npm run build` ve `npm run apk:safe` başarılı, dokunulan dosyalarda **yeni lint
  hatası yok** (kalan 2 uyarı değişiklikten ÖNCE de vardı). **10 kalıcı regresyon
  kilidi** + 25 yeni birim testi.
  Durum: **DOĞRULANDI** (cihazda statik; gerçek sürüş YOK — ÜRÜN HAZIR: HAYIR).
  Verdict: **`LOCAL_COMPLETE_DEVICE_STATIC_VALIDATED_DRIVE_PENDING`**.
  Kütük: 🟢 **#377** (tam ekran kapalıyken ilerleme sürüyor) · 🟢 **#379**
  (20 döngüde tek oturum) · 🔴 **#378** (kırpma/ETA azalması) · 🔴 **#380/#381/#382**
  (cihazda bulunan iki kusur + açık borç).
  Tam rapor: `docs/NAVIGATION_MINI_MAP_SESSION_CONTINUITY_P0_REPORT.md`.

  Kök neden: **aktif navigasyon oturumunun fiilî sahibi `FullMapView` bileşeniydi.**
  Rota ilerlemesini süren GPS aboneliği bileşenin İÇİNDEYDİ ve o iki fonksiyonun
  (`updateRouteProgress` · `updateNavigationProgress`) kod tabanında başka çağıranı
  yoktu → tam ekran kapanınca **mesafe · ETA · adım sayacı · kademeli sesli anons ·
  sapma/reroute · varış tespiti TOPLUCA donuyordu.** Yani "tam ekranı kapat" fiilen
  "navigasyonu dondur" demekti; ürün de bu yüzden kapatmayı iptalle eş tutuyordu.

  - **Motor sahipliği görünümden alındı:** yeni `navigationSessionRuntime`
    (SystemBoot Wave 3) uygulama ömrü boyunca yaşayan TEK abonelikten tick üretir.
    **Yeni rota motoru · yeni eşik · yeni durum YOK** — yalnız sahiplik taşındı;
    reroute/map-matching/doğrulama/varış eşiklerine DOKUNULMADI. Timer yok
    (kadans GPS fix kadansı), idempotent (çift tick = çift sesli anons olurdu).
  - **Görünüm geçişi artık oturum sıfırlamıyor:** rota isteği dedup'ı bileşen
    ref'iydi (`lastFetchedRef`); unmount'ta ölünce tam ekran her yeniden açılışta
    AKTİF oturum için **yeni `fetchRoute`** atıyor ve durumu **ACTIVE→ROUTING**'e
    düşürüyordu. Sahiplik oturum otoritesine taşındı (`claimRouteRequest` +
    `getNavSessionId`).
  - **Mini harita aktif oturumun İKİNCİ GÖRÜNÜMÜ oldu:** rota çizgisi · ilerleme
    kırpma · kalan mesafe · ETA · sıradaki manevra · çevrimdışı rozeti · açık
    "Navigasyonu sonlandır". Kendi rota state'ini KURMAZ. **Dürüstlük:** manevra
    metni yoksa satır hiç render edilmez; manevra mesafesi yalnız
    `distanceToNextTurnSource !== UNKNOWN` iken gösterilir; şerit ve dönel kavşak
    çıkışı mini haritada HİÇ üretilmez (yapısal kilit).
  - **Kapatmak ≠ sonlandırmak:** oturumu bitiren tek giriş noktası `endNavigation()`
    kuruldu (öncesinde `stopNavigation()+clearRoute()` ikilisi üç ayrı yerde elle
    tekrarlanıyordu). Tam ekran X'i ve donanım geri tuşu bu yola BAĞLI DEĞİL.
  - **Gözlemlenebilirlik:** CAROS LAB → Araç → *Navigation Core* → **kart 9
    "Oturum Sürekliliği"** (motor ÇALIŞIYOR/ÇALIŞMIYOR · oturum kimliği · istek
    sahipliği VAR/YOK · işlenen fix + son tick yaşı · atlananlar · hata sayacı ·
    uptime). Koordinat ve hedef kimliği TAŞINMAZ.
  - **Açık borç (kaydedildi):** GPS kaybındaki ölü-hesaplama (DR) dalı hâlâ
    `FullMapView` içinde — tam ekran kapalıyken tünele girilirse ilerleme fix
    dönene kadar durur. Taşımak NAV-CORE-P0 alanına (DR eşikleri) girerdi.
  - **CİHAZ ÖLÇÜMÜ (2026-08-04, `4L45OFZDX84X55GE`, Android 13, duran araç):**
    tam ekran **donanım geri tuşuyla** kapatıldı → 44 sn boyunca durum `ACTIVE`
    ve **kalan mesafe 10 örneğin 8'inde FARKLI** (motor canlı hesaplıyor);
    **hiçbir harita mount DEĞİLKEN** LAB kart 9'da **işlenen fix 261 → 296
    (+35 fix / 30 sn)**, `Motor hatası=YOK`. 20 mini↔tam ekran döngüsünde
    **40 örneğin tamamı `ACTIVE`**, `reqId` **yalnız 1** (sıfır yeni rota
    isteği), oturum kimliği `#3` sabit. Eski kodda `reqId` ~21'e çıkardı.
    Yeni kodun cihazda olduğu **iki bağımsız kanıtla** gösterildi (hash'li
    chunk'lar cihaz origin'inden indirildi + eski `lastFetchedRef` izi YOK).
  - **CİHAZDA BULUNAN KUSUR K1 — uydurma ETA barı gerçek rotayla çelişiyordu:**
    `ProLayout`/`TeslaLayout`/`ExpeditionLayout` mini haritanın üstüne **sabit**
    `23 dk · 19:56 · 18 km` şeridi çiziyordu; gerçek rota **2,7 km** iken ekranda
    "18 km · 23 dk" yazıyor ve GERÇEK verili şeridi de örtüyordu. `useNavSummary`
    başlığındaki 2026-08-02 düzeltmesi ÜST CHIP'i gerçek kaynağa bağlamıştı; **alt
    bar gözden kaçmış.** Aktif rota varken gizlendi. Rota YOKKEN dekoratif sahte
    değerler duruyor → **açık borç, kütük #382.**
  - **CİHAZDA BULUNAN KUSUR K2 — navigasyondayken ana ekrana dönüş yolu YOKTU:**
    `MapHudControls` kapatma düğmesini `{!isNavigating && …}` ile gizliyordu;
    geriye donanım geri tuşu ve **kırmızı SONLANDIR** kalıyordu. Uygulama bir
    LAUNCHER ve hedef head unit'lerde (K24/T507) donanım geri tuşu çoğu zaman
    YOK → kullanıcı ana ekrana dönmek için navigasyonu **BİTİRMEK** zorundaydı;
    yani bu görevin kapattığı arıza UI tarafında hâlâ açıktı. Ayrı nötr renkli
    **"ANA EKRAN"** düğmesi eklendi ve cihazda doğrulandı.
  - **Sürüş bekleyen:** kırpmanın geride kalanı silmesi · kalan mesafe ve ETA'nın
    AZALMASI · reroute · kademeli sesli anons · varış · düşük-uç GPU (Mali-400/K24)
    FPS ve termal maliyeti. Ölçüm cihazı telefondu, head unit DEĞİL.

- **FIELD-GAP-CLOSURE-2026-08-05 · Konya→Tarsus saha eksiklerinin ilk kapatma turu:**
  tam suite **10 831 test / 477 dosya YEŞİL** (iki ardışık tam koşu; bir koşuda
  `labTruthAuthorities` paralel yarıştan düştü, izole ve ikinci tam koşuda geçti —
  ürün koduyla ilgisi yok), `tsc -b` temiz, değişen dosyalarda yeni lint hatası yok.
  Kütük **#432–#448** (17 madde). Durum: **ENTEGRE** — saha kanıtı YOK,
  **ÜRÜN HAZIR: HAYIR**. Kaynak eksik listesi: `docs/NAV_FIELD_GAPS_2026-08-05.md`.

  **Kapatılanlar (kod kanıtı, cihazda doğrulanmadı):**
  - **Yanlış veri gösterimi:** OBD `0xFF` sentineli artık hız olarak basılmıyor (#399);
    ekranda **tek hız otoritesi** var (#417 — sahada aynı anda üç farklı hız vardı);
    akü voltajı CAN→OBD otoritesine bağlandı ve WARN kartta görünür (#427);
    bakım ekranı veri yokken "güncel" demiyor (#420); rota iptalinde geri gelen
    sahte ETA şeridi tamamen kaldırıldı (#382/#431).
  - **Navigasyon çekirdeği:** GPS alım sağlığı (varış/kabul/red + tazelik sınıfı)
    ölçülebilir oldu (#401/#406/#423); "rotadan çıktın" kararı ile reroute artık
    AYNI doğruluk eşiğini paylaşıyor ve engellenen her reroute nedeniyle deftere
    yazılıyor (#402); hedef değişimi **sahiplik kapısına** bağlandı (#429 — kullanıcı
    iradesi olmadan hedef değişemez); `isGuidanceActive` ile "oturum açık" ≠ "rehberlik
    sürüyor" ayrıldı (#416/#418); ETA tek otoriteye indi ve kuş uçuşu mesafe hem
    işaretleniyor hem ETA girdisinden çıkarıldı (#403/#404); hız `null` iken sahte 0
    yazıp yönü çöpe atma kusuru giderildi (#405/#408).
  - **Altyapı:** cihaz TÜRÜ ile performans SINIFI ayrıldı (#411 — telefon artık head
    unit damgası almıyor); iklim ve ayarlar ekranları OEM token katmanına taşındı
    (#412-d/#425); AI `402` (kredi bitti) artık `401` ile aynı kovada değil (#421);
    kalıcı Supabase şema hatası tekrar denenmiyor (#422); **CAN snapshot'ın native'de
    neden 63 saattir yazılmadığının KÖKÜ bulundu** — anahtar kritik listede olmadığı
    için `localStorage` yedeği hiç alınmıyordu (#400).

  **AÇIKÇA YAPILMADI (bu turda kapsam dışı, kütükte açık):**
  - **Ekran görüntüsü gerektiren yerleşim kusurları:** #412-a/b/c (ana ekranda hız
    metni ikonlara biniyor · GPS uyarısı widget'ları kapatıyor · yol sayacı kırpık),
    #419 (müzik kontrolleri alt barın altında), #426 (tam ekran nav buton çakışması),
    #430 (dikey modda boş harita). Cihaz olmadan yapılacak CSS değişikliği **kör
    patch** olur; ölçüm turuna bırakıldı.
  - **#410 çevrimdışı rota motoru** (yerel OSRM) — ayrı ve büyük bir iş.
  - **#409 şerit + canlı trafik** — kod boşluğu değil **veri boşluğu**; BYOK sağlayıcı
    kararı gerektiriyor.
  - **#424 ağ dayanıklılığı (15 dk'da 131 kopma)** — #422 gürültüsünün bir kısmını
    kesse de asıl ölçüm yapılmadı.
  - **#414 doğrulama modunun kayıt ürettiği** doğrulanmadı.
  - **#421'in kullanıcıya görünen yüzeyi** (asistanda ayırt edici mesaj) bağlanmadı.
  - **#401'in KÖK NEDENİ** (fix neden 19,5 s bayat) hâlâ bilinmiyor — bu tur onu
    yalnız **ölçülebilir** yaptı.

  **Sıradaki adım:** aynı cihazda ikinci bir Konya→Tarsus ölçümü; `getGpsIntakeSnapshot`,
  `getRerouteBlockStats`, `getDestinationChangeLog` ve `validationWarnIds` çıktılarıyla
  #432–#448'in kabul ölçütleri tek tek sınanmalı.

- **TILE-SOURCE-P0 · Palet ve Topoloji ÜRÜNDE ÖLÜ KODMUŞ — Kaynak Bağlandı (2026-08-08):**
  tam suite **11 286/11 286 · 498 dosya**; `tsc -b` temiz. 7 yeni kilit.
  Kütük **#486** (engel) → **#487** (çözüm).
  Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  **Sahada yakalandı:** taze APK kurulduktan sonra harita hâlâ **ham OSM
  raster**'dı (sarı yollar, bej binalar). #482 (gündüz paleti) ve #483
  (köprü/tünel + kalkan) **hiç devreye girmemişti**.

  **Kök:** `buildVectorStyle`, yerel `.pbf` **ve** `VITE_VECTOR_TILE_URL` yoksa
  raster'a düşer. Üçü de yoktu → vektör yolu hiç çalışmıyordu.

  ⚠️ **Bu aynı zamanda bir TEST kusuruydu:** palet ve topoloji kilitleri stile
  `isAvailable: true` vererek **varsayımı** ölçüyordu, ürünün gerçek yolunu
  değil. Kilitler doğruydu ama yeşil olmaları özelliğin çalıştığını
  kanıtlamıyordu — projede daha önce ölçülmüş *"mekanizma kodda var ≠
  çalışıyor"* sınıfının aynısı (#383).

  **Sağlayıcı doğrulanarak seçildi:** OpenFreeMap — anahtarsız · limitsiz ·
  **ticari kullanım serbest** · MIT + OSM(ODbL) · **değiştirilmemiş
  OpenMapTiles** şeması (stil JSON'ı çekilip katman listesi okundu).

  **Sürüm damgası tuzağı önlendi:** ham şablon veri sürümü taşır; sabitlenirse
  sağlayıcı veriyi tazelediği gün harita sessizce kırılır. TileJSON ucu verilir.

  **Hibrit zincir — yerel `.pbf` > çevrimiçi vektör > raster.** Ağ yokken
  vektör denenirse harita **boş kalır**; iki kapı eklendi (çevrimdışı tespiti +
  karo hatası eşiği). İkincisi şart: yoksa fallback tekrar vektör döndürüp
  **sonsuz döngü** yapardı. Yerel `.pbf` ağdan bağımsızdır.

  **Eski bir kilit gerçeği söyledi:** *"gündüzde vektör asla dönmez"* kilidi
  düştü — o kural gündüz paleti yokken doğruydu ve #482'den beri **yanlış
  sebeple** yeşil kalmıştı. Kaldırılmadı, **güncellendi**; asıl kural
  (*gündüzde gece paleti kullanılamaz*) motordan bağımsız hâle getirildi.

  ⚠️ **Geçici adım:** çevrimiçi bağımlılık offline-first vizyonuna aykırıdır.
  Kalıcı çözüm yerel `.pbf` paketi — ayrı tur.

- **PAINTED-ARROW-P0 · Dönüş Artık Haritada Değil, Yolun Üstünde (2026-08-08, Boyanmış Ok PR):**
  tam suite **11 279/11 279 · 498 dosya**; `npm run guard` **372/372**;
  `tsc -b` temiz; eslint **0 hata** (2 uyarı mevcut koda ait, eklenen blokla
  ilgisiz). 27 yeni kilit. Kütük **#485**.
  Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  **Mimari karar — sembol değil ZEMİN.** Poligon coğrafi uzayda üretilir ve
  `fill` olarak çizilir; kamera eğildiğinde perspektif onu asfalta
  **kendiliğinden** yatırır. `symbol` ile yapılsaydı ok havada durur, pitch
  değişince kayardı — ek 3B dönüşüm ya da ekran-uzayı hizalaması **gerekmedi**.

  **Saf model:** rota geometrisi üzerinde manevra çapasından geriye 32 m,
  ileriye 22 m **yol boyunca** yürünür (kuş uçuşu değil); gövde 5 m şeride
  çevrilir, ok başı çıkış kolunun **içinden** alınır → ok kavşağın ötesine
  taşmaz.

  **Ok bir İDDİADIR — dayanağı yoksa çizilmez.** Hüküm boolean değil
  **gerekçelidir**; 8 sebep sayılabilir. "Çizemedim" (çapa çözülmedi · geometri
  kısa) ile "çizmeye gerek yoktu" (düz devam · henüz uzak) sahada tamamen farklı
  iki teşhistir. Çapa çözülemezse `-1` geçer, **0 uydurulmaz** — yoksa ok
  rotanın başına çizilirdi.

  **Adım seçimi HUD ile aynı kural:** yaklaşan dönüş `steps[currentStepIndex+1]`.
  İki yorum ayrışsaydı ekranda yazan dönüş ile yola boyanan dönüş **farklı
  kavşağı** gösterirdi.

  **Performans:** yeni timer/abonelik **0** — hesap mevcut GPS fix'i içinde.
  Hüküm değişmediyse `setData` hiç çağrılmaz; görünmezken katman silinmez,
  kaynak boşaltılır.

  **Gözlemlenebilirlik:** LAB → Navigation Core 7. kartta 6 alan. Durum ağır
  modülde değil **yaprak erişim katmanında** tutulur → LAB `maplibre-gl`
  grafiğini import etmez. Gözlem yüzeyinde koordinat/sokak adı **yoktur**.

  **Açık kalan:** dönel kavşak (`roundabout`) ayrı bir tur işidir; şu an
  `NOT_A_TURN` ile geçilir. Ok yanıp sönerse eşik histerezisi gerekecek —
  LAB'daki "görünür oluş sayısı" bunu ölçmek için var.

- **ROAD-TOPOLOGY-P0 · Katlı Kavşak Okunur Oldu + Yol Numarası Kalkanı (2026-08-08, Topoloji PR):**
  tam suite **11 252/11 252 · 497 dosya**; `npm run guard` **372/372**;
  `tsc -b` temiz; değişen dosyalarda eslint **0 sorun**. 16 yeni kilit.
  Kütük **#483** (+ **#484** takım kırılganlığı).
  Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  **İki kusur, ikisi de VERİ EKSİKLİĞİ DEĞİLDİ — okunmayan alanlardı:**
  `brunnel` (köprü/tünel) ve `ref` (yol numarası) karolarda zaten geliyordu,
  stil ikisini de hiç okumuyordu. Sonuç: katlı kavşak düz gri yumaktı ve
  sürücü "E-5" tabelasını haritayla eşleştiremiyordu.

  **Topoloji sırayla anlatılır:** tünel katmanları kasaların **önüne**
  (yüzeyin altında kalır, kesikli kasa + soluk gövde), köprü katmanları
  gövdelerin **sonrasına** (altındaki yolu keser, kasası %42 geniş → güverte
  kenarı gölge gibi okunur). Yedi yüzey yol katmanına `brunnel` kapısı eklendi.

  **Veri yoksa davranış birebir aynı:** `brunnel` taşımayan karo setlerinde yol
  yüzey sayılır — bu değişiklik veri yoksa hiçbir şeyi bozmaz.

  **Kalkan için sprite yoktu.** Stilde `sprite` tanımlı değil, bu yüzden kalkan
  **çalışma zamanında canvas'ta** üretilir (mevcut Rover/badge deseni): ek asset
  yok, offline çalışır, gündüz/gece ayrı. `icon-text-fit` + stretch bölgeleri ile
  **tek imaj metne göre esner** → "E-5" ve "D-100" için ayrı görsel gerekmez.
  İmaj `style.load`'da yeniden kaydedilir (stille gitmez), çağrı fail-soft.

  **Bina hacmi:** gündüz bina/zemin dolgu farkı yalnız 1.07 olduğu için beyaz
  bloklar düz kâğıt gibi duruyordu; ambient occlusion palete bağlandı
  (gündüz 0.48 · gece 0.30).

  **Performans bütçesi:** sınıf başına ayrı katman +20 katman demekti; genişlik
  tek katmanda `match` ile çözüldü → **toplam +5 katman**. Gece ve gündüz aynı
  katman listesini üretir (`NAV_SUPPRESS_TIERS` isimle bağlı — ikinci liste
  doğsaydı odak modu sessizce ölürdü).

  **Yan bulgu (#484):** yeni testler takımı 497 dosyaya çıkarınca **iki ayrı
  kilit ardışık koşumlarda farklı farklı düştü**. Değişiklikler stash'lenip
  temiz ağaçta koşuldu → **11 236/11 236 geçti**, yani düşüşler ürün kodundan
  değil takım büyümesinden geliyordu: `Test timed out in 5000ms`, 360+ modüllük
  grafiklerin dinamik `import()` süresi. Biri blok tavanıyla, biri kırılgan
  mock-yeniden-kurulum deseni kaldırılarak düzeltildi; ikincisi
  **falsifikasyonla doğrulandı** (bayrak kapatılınca kilit düştü).

- **DAY-PALETTE-P0 · Palet Onaylanan Tasarıma Hizalandı (2026-08-08, Palet Hizalama PR):**
  tam suite **11 236/11 236 · 496 dosya**; `tsc -b` temiz; değişen dosyalarda
  eslint **0 sorun**. Kütük **#482**.
  Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  **#480'in teşhisinde bir incelik atlanmıştı.** İlk kusur zeminin beyaz olması
  değil, **yolların da açık olmasıydı** (`#d3d8df`). #480 yolları koyulaştırdı
  ama zemini de griye çekti; oysa yollar koyulaştıktan sonra zemini beyaza geri
  çekmek ayrımı **bozmaz, artırır**.

  **Ölçüm** (zemin `#e9edf1` → `#f5f7f9`): otoyol **3.22 → 4.06** · ana cadde
  2.57 → 2.82 · ikincil 2.06 → 2.26 · tali sokak 1.63 → **1.71** · bina
  konturu/zemin 1.28 → **1.52**. Otoyol gövdesi ve kasası da koyulaştı →
  **yol sınıf hiyerarşisi açıldı** (referans değerlendirmesinde en zayıf ölçüt
  buydu: otoyol ile tali sokak ayırt edilemiyordu).

  **Bedeli ölçüldü ve telafi edildi:** zemin beyaza yaklaşınca bina/zemin farkı
  1.18 → 1.07'ye düşer; bina sınırını artık dolgu değil **kontur** taşır.

  **Kilit düzeltildi, gevşetilmedi:** *"zemin beyazdan en az 1.1 uzakta olsun"*
  kilidi **yanlış bir vekil ölçüydü** ve doğru paleti engelleyecekti. Ölçtüğü şey
  düzeltildi (saf beyaz yasağı + kontur/zemin ≥ 1.4); yol eşikleri **yukarı**
  taşındı. Eşikler yalnız yukarı gider. Gece paleti hiç değişmedi.

  **Süreç notu:** bu palet önce interaktif bir HMI referansında görülüp
  onaylandı, sonra koda taşındı — renk kararı tartışmadan değil **ölçümden**
  çıktı.

- **BUILD-TOOLCHAIN · `apk:safe` Gradle Aşamasında Düşüyordu (2026-08-08, JDK 21 Köprüsü):**
  tam suite **11 236/11 236 · 496 dosya**; `tsc -b` temiz; değişen dosyalarda
  eslint **0 sorun**. 8 yeni kilit. Kütük **#481**.
  Durum: **DOĞRULANDI** (bu makinede ölçüldü; CI'da koşulmadı).

  **Ölçülen kusur:** APK üretimi istendiğinde zincir
  `test ✅ → vite build ✅ → compat:verify ✅ → cap sync ✅ → gradle ❌` düştü:
  *"Cannot find a Java installation matching {languageVersion=21}"*. Capacitor
  plugin modülleri **JDK 21 toolchain** ister, `JAVA_HOME` ise **JDK 17**'yi
  gösteriyordu. Android Studio kendi **JBR**'sini (21.0.10) taşır ama gradle
  onu CLI'dan görmez → `apk:safe` bu makinede **her seferinde** düşerdi.
  #479'un "APK üretilmedi, yalnız derleme" notunun altındaki gerçek sebep budur.

  **Köprü artık ölçüyor:** `JAVA_HOME` yeterliyse (≥21) **hiç dokunulmaz**;
  yetersizse bilinen konumlarda JDK 21+ aranır ve **yalnız o çağrının
  ortamına** konur — kullanıcının kabuk ortamı kalıcı değiştirilmez (kilitli).

  **Fail-soft:** uygun JDK yoksa iş **durdurulmaz**, uyarılır ve gradle kendi
  auto-detection'ına bırakılır — yanlış pozitif APK üretimini engellememeli.
  Ayrıştırıcı ölçemediğinde **`null` döner, sahte `0` üretmez**
  ("ölçülemedi" ≠ "çok eski").

  **Kanıt (iddia değil, ölçüm):** `JAVA_HOME` kasten JDK 17'ye sabitlenip
  koşuldu → köprü JBR'ye geçti, **BUILD SUCCESSFUL**, exit 0. `clean
  assembleDebug` ile **taze APK üretildi (77,2 MB)**.

- **DAY-PALETTE-P0 · Gündüz Haritasında Yollar Beyaz Görünüyordu (2026-08-08, Gündüz Palet PR):**
  tam suite **11 228/11 228 · 495 dosya**; `npm run guard` **372/372**;
  `tsc -b` temiz; değişen dosyalarda eslint **0 sorun**. 11 yeni kilit.
  Kütük **#480**. Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  **Saha (kullanıcı gözlemi):** *"şu an yollar beyaz, güzel görüntü olmuyor;
  Google'daki gibi yollar gri, evler beyaz ve net olsun."*

  **Şikâyet bir sayıya indirgendi.** Gündüz paletinin ilk sürümü zemini beyaza
  (`#fafbfc`) çekiyordu; WCAG bağıl parlaklıkla ölçüldüğünde **tali yolun zemine
  kontrastı 1.38** (otoyol 2.49) çıkıyordu — yani yol ile boşluk pratikte ayırt
  edilemiyordu. Kusur "yanlış renk seçimi" değil, **rol dağılımının
  ölçülmemesiydi**.

  **Üç katmanlı ton sözleşmesi:** binalar **en açık** (saf beyaz + net kontur)
  · zemin **ortada** (nötr gri, beyaz DEĞİL) · yollar **en koyu**, otoyoldan
  taliye **monoton** açılan gri; kasalar gövdeden bir ton koyu — ince tali yolu
  görünür kılan gövde değil **kasadır**. Yeni ölçüm: tali **1.63** · ikincil
  2.06 · birincil 2.57 · otoyol **3.22**. Hiyerarşi renkle değil **tonla**
  taşınır → renk körlüğünde ve güneş parlamasında dayanıklı.

  **Yarım kalan iş kapatıldı:** `place-town` ve `place-city` halo'ları palette
  `townHalo`/`cityHalo` **tanımlı olmasına rağmen** gece sabitini (`#060c14`)
  doğrudan yazıyordu → gündüz beyaz zeminde koyu lacivert gölge. Palet
  kurulmuştu ama katmanlar ona **bağlanmamıştı**.

  **Gece değişmedi (kilitli):** gece paletinde aynı iki halo değeri birebir
  `#060c14` olduğu için bağlama gece davranışını değiştirmez — kilit bunu ayrıca
  doğrular. **Rota sözleşmesi bozulmadı:** `resolveLightBasemap()` renge değil
  **mod'a** bakar; rota paleti değiştirilmedi.

  **Kalıcı kazanç:** renk tercihi tartışmaya açıktır, ama artık **ölçülebilir
  ayrım pazarlık konusu değildir** — `mapDayPaletteContrast.test.ts` rol
  sıralamasını ve en düşük kontrast oranlarını kilitler; palet bir daha sessizce
  beyazlaşamaz.

- **WAKE-FORENSIC-P0 · Native Wake Sayaçları (2026-08-08, Faz 4 — yalnız ölçüm):**
  tam suite **11 217/11 217 · 494 dosya**; `npm run guard` **372/372**;
  `tsc -b` temiz; değişen dosyalarda eslint **0 sorun**. 10 yeni test (wake
  forensic kilidi 38 → 48). Kütük **#479**.
  Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  ⚠️ **DAVRANIŞ DEĞİŞMEDİ.** #476'nın açık borcuydu: JS defteri yalnız tetik
  anını görebiliyordu; **"mikrofon hiç açılmadı" · "VAD decode'u atladı" ·
  "metin çözüldü ama eşleşmedi"** kararları Java'da olduğu için JS'ten ayırt
  edilemiyordu — yani *"Mavi neden uyanmadı"* sorusunun üç büyük cevabı
  ölçüsüzdü.

  **Eklenen (şema 1 → 2, yalnız ekleme):** `wakeYieldCount` ·
  `wakeVadSkipFrames` / `wakeDecodeFrames` · `wakeNoMatchCount` ·
  `wakeTriggerCount` · `wakeLastTriggerLatencyMs` (konuşma başlangıcı → tetik;
  final-sonuç kapısı tartışması için **taban değer**).

  **Sayaç tasarımı:** oturum başında **sıfırlanmaz** (wake döngüsü saniyede
  oturum açıp kapatır → oturum-başı sayaç oran hesaplanamaz kılar) ve `bump()`
  ile doyurulur (sarmalanma/negatif yok). İkisi de kilitli.

  **Dokunulmazlık (kilitli):** her ölçüm noktası tek satırlık sayaç çağrısıdır;
  hiçbir koşul/`return`/`break` eklenmedi · `VAD_RMS_ON = 0.012` ve
  `VAD_HANGOVER = 12` değişmedi · gecikme değişkeni hiçbir koşula sokulmaz,
  yalnız ölçüme gider. **Olay fırtınası yok:** çerçeve başına JS olayı
  gönderilmez, `notifyListeners("wakeWord")` döngüde tam 1 kez.

  **Gizlilik yapısal:** `noteWake*` imzalarında **String parametre yoktur** —
  metin sızıntısı imkânsız; native JSON'a yalnız 6 sayı eklenir.

  **Geriye dönük uyum:** sayaçlar ayrı `wake` bloğunda; şema 1 APK'sında blok
  hiç gelmez → LAB **"Ölçüm yok (eski şema)"** gösterir, **sahte `0`
  üretilmez** (kilitli). Gecikme ölçülmediyse `-1` → "Henüz tetik ölçülmedi".

  **Derleme kanıtı:** `:app:compileDebugJavaWithJavac` → **BUILD SUCCESSFUL**.
  **APK üretilmedi, cihaza kurulmadı** — bu turun saha maddeleri bu yüzden
  tümüyle 🔴.

- **MEDIA-TRUTH-P0 · Kaynaksız "Müzik Aç" Gömülü Katmana Hizalandı (2026-08-08, PR-2):**
  `npm run guard` **372/372**; `tsc -b` temiz. 6 yeni kilit (medya kilitleri
  toplam 22). Kütük **#478**. Durum: **ENTEGRE** (saha kanıtı YOK —
  **ÜRÜN HAZIR: HAYIR**).

  **Kullanıcı kararı:** "müzik aç" dendiğinde harici uygulamaya gidilmeyecek;
  önce gömülü YouTube'dan açılacak, kaynak söylenirse o kaynaktan.

  **Ölçülen davranış:** `OPEN_MUSIC` dalı kaynak belirtilmese bile koşulsuz
  `play()` çağırıyordu → harici bir Android MediaSession devralınıyor ve sürücü
  uygulamadan koparılıyordu. Üstelik *"Müzik açılıyor"* cevabı **koşulsuzdu** —
  hiçbir şey başlamasa da söyleniyordu (#477 ile aynı sahte onay sınıfı).

  **Düzeltme:** kaynak **söylendiyse** eski davranış birebir korundu. Kaynak
  **söylenmediyse**: (1) gömülüde kaldığı yer varsa oradan devam, (2) yoksa
  gömülü aramayla başlat, (3) ikisi de olmazsa **harici uygulamaya sessizce
  gidilmez** — dürüstçe *"Gömülü oynatıcıda çalacak bir şey bulamadım. Kaynak
  söylersen oradan açayım."* denir.

  **Bu ilke yeni değildir:** `PLAY_MUSIC_SEARCH`/`PLAY_MUSIC_QUERY` zaten "önce
  gömülü, sonra harici" çalışıyordu; bu tur yalnız **kaynaksız yolu onlara
  hizaladı** — o iki yol değiştirilmedi (kilitli). İçerik uydurulmadı: sabit
  videoId/playlistId gömülmedi.

- **MEDIA-TRUTH-P0 · Sahte "Sonraki Parça" Onayı Kesildi (2026-08-08, PR-1):**
  `npm run guard` **372/372**; `tsc -b` temiz. 16 yeni kilit. Kütük **#477**.
  Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  **Saha (2026-08-08, Xiaomi 23090RA98I, gerçek cihaz):** kullanıcı "müzik
  değiştir" dedi, Mavi **"sonraki parça"** dedi, **parça değişmedi**.

  **Kök — sistem gerçeği BİLİYORDU ve ATIYORDU:** `mediaCommandGateway.next()`
  `CommandTruth{outcome, verificationLevel, failureCode}` döndürüyor;
  `mediaService._routeToAuthority` bunu `void import(...).then(...)` ile atıp
  **koşulsuz `true`** dönüyordu → `mediaService.next()` `void` idi →
  `commandExecutor` sonucu **beklemeden** konuşuyordu. CLAUDE.md'nin "sahte onay
  yasak" kuralının doğrudan ihlali.

  **Cihaz kanıtı (aynı oturum):** LAB → `OYNATMA GERÇEĞİ: BOŞTA` · `Ses kanıtı:
  HAYIR`; `dumpsys audio` → tüm player'lar `state:idle`; `dumpsys media_session`
  → `com.cockpitos.pro active=true`. Android bizi aktif medya oturumu sayıyordu
  ama **atlanacak parça yoktu** — buna rağmen onay veriliyordu.

  **Düzeltme (yalnız dürüstlük — yönlendirme ve politika değişmedi):**
  `MediaCommandResult {dispatched, verified, failureCode}`; `dispatched` ile
  `verified` **bilinçli ayrı** ("komut kabul edildi" ≠ "parça değişti").
  **Yalnız `outcome === 'VERIFIED'`** başarı sayılır; `ACCEPTED_UNVERIFIED`
  başarı olarak sunulmaz. `localNext`/`localPrev` boş kuyrukta sessizce hiçbir
  şey yapmıyordu → artık `empty_queue` · `end_of_queue` · `start_of_queue`
  döner (**başa sarma eklenmedi** — çalma sırası politikası kapsam dışı).
  Cevap tek karar noktasından üretilir: doğrulanmadıysa başarı cümlesi
  kurulmaz, **bilinmeyen sebep bile "yaptım" demez**.

  **Açık kalan (ayrı iş):** asıl yönlendirme kusuru — çalan sesin sahibi ile
  komutun gittiği otoritenin ayrışması.

- **TEST-KİLİDİ · Gizlilik Kilidi Zamana Bağlı Yanlış Alarmı Onarıldı (2026-08-08):**
  `platformRuntimeDiagnostics.test.ts` içindeki "event payload teşhise girmez"
  kilidi ham snapshot üzerinde alt-dize taraması yapıyordu; `lastEventAt`
  epoch'u (`1786199282175`) aranan `199` desenini **içerdiği için** belirli
  zaman pencerelerinde düşüyordu. Kardeş kilit bu tuzağı zaten biliyor ve
  temizleyici kullanıyordu — bu kilit o korumayı almamıştı. **Kilit
  zayıflatılmadı:** yalnız SAYI olan `last*At` alanları çıkarılır; metin taşıyan
  hiçbir alan çıkarılmaz, sızıntı yakalama gücü aynen durur.

- **WAKE-FORENSIC-P0 · Wake Karar Defteri (2026-08-08, Faz 1-3+5):**
  tam suite **11 149/11 149 · 490 dosya** (varsayılan timeout); `npm run guard`
  **368/368**; `tsc -b` temiz; değişen dosyalarda eslint **0 sorun**. 38 yeni
  test. Kütük **#476**.
  Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  ⚠️ **BU BİR DÜZELTME DEĞİLDİR.** Wake davranışı bilinçli olarak
  değiştirilmedi; yalnız nedenleri ölçülebilir kılındı. **"Test geçti" ile
  "wake sorunu çözüldü" aynı şey değildir** ve false wake / missed wake
  oranları gerçek araç ölçümü yapılmadan yorumlanmayacaktır.

  **Kapatılan boşluk:** `onWakeWordDetected` içindeki dört kapı sessizce
  `return` ediyordu → "hiç duyulmadı" ile "duyuldu ama bastırıldı" ayırt
  edilemiyordu. Kabul edilenler sayılıyordu (#460), reddedilen ve
  bastırılanlar hiç sayılmıyordu.

  **Kod otorite, rapor değil — bir hipotez ÇÜRÜTÜLDÜ:** önceki analiz
  "wake→greeting devrinde timer/onEnd yarışı ilk komutu kaçırıyor" demişti;
  `startListening` **idempotenttir** (`voiceService.ts:1884`), ikinci açılış
  no-op olur. `ACCEPTED_NO_INTENT` ölçülmeye devam eder ama artık bu
  mekanizmaya atfedilmez.

  **Taksonomi disiplini:** yalnız ürün kodunda gerçek karar noktası olan 8
  gerekçe tanımlandı. `SUPPRESSED_INTERACTION` **eklenmedi** (etkileşim
  duraklatması motoru tamamen durdurur → bastırılacak olay JS'e ulaşmaz;
  durum, karar değil). VAD · TTS half-duplex · native no-match **eklenmedi**
  (yalnız Java'da olur, JS göremez — uydurma olurdu).

  **Karar akışı değişmedi:** her `if (koşul) return;` aynı koşulla aynı yerde;
  `setInterval` sayısı 1'de kaldı; politika sabitleri ve eşleşme kuralı
  denetlenerek korundu. Korelasyon mevcut `VoiceLifecycleEvent` zincirinden —
  yeni kimlik sistemi ve yeni timer yok (zaman aşımı okuma anında türetilir).

  **Açık borç:** `wakeWordService.ts:461` ham metin + n-best logluyor; kapsam
  dışı bırakıldı — **hâlâ açık**. Java tarafı (VAD reddi · TTS sağırlığı ·
  native no-match) bu turda ölçülmüyordu; **Faz 4'te (#479) kapatıldı** —
  sayaçlar eklendi, ancak o APK henüz cihaza kurulmadı.

- **TUNNEL-NIGHT-P0 · Tünelde Harita Gece Görünümüne Geçiyor (2026-08-08, Tünel PR):**
  tam suite **11 111/11 111 · 489 dosya** (varsayılan timeout); `npm run guard`
  **368/368**; `tsc -b` temiz; değişen dosyalarda eslint **0 sorun**. 26 yeni
  test. Kütük **#475**. Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  **Kapatılan kusur:** `autoBrightnessService` tünel giriş/çıkışını zaten doğru
  algılıyordu ama `_tunnelMode` modül içinde kalıyor, harita okuyamıyordu →
  tünelde gündüz haritası. **Yeni dedektör yazılmadı**, mevcut karar dışa
  açıldı; yayın mevcut far callback'inde olduğu için **yeni timer yok**.

  **Asıl mimari karar — örtü `setMapNight` hunisinin İÇİNDE.** İki gerekçe:
  (a) `settings.dayNightMode`e yazmak `checkTime()` tarafından 60 sn'de geri
  alınır → flicker döngüsü; (b) `setMapNight`'ın **iki** yazıcısı var
  (`applyMapDayNight` **ve** `MiniMapWidget` doğrudan) — örtüyü çağıranlardan
  birine koymak diğerinin onu sessizce ezmesi demekti. Hunide ise hangi çağıran
  yazarsa yazsın örtü **yapısal olarak** korunur.

  **İstek/etkin ayrımı:** `_mapNightRequested` (örtü kalkınca dönülecek yer) ·
  `_mapNight` (etkin = tünel ‖ istek). Mevcut tüm okuyucular değişmedi; PR-3b
  `resolveLightBasemap()` zaten `getMapNight()` okuduğu için
  **`lightBasemap = !effectiveNight && mode === 'road'` semantiği korunur** ve
  gece rota paleti kendiliğinden, **değiştirilmeden** uygulanır. Rota
  paletine yeni renk eklenmedi (kilitli).

  **İdempotens:** aynı durum tekrar bildirilirse boyama yok; gerçek gecede
  tünele girmek de etkin değeri değiştirmediği için boyama tetiklemez.

  **Gözlemlenebilirlik disiplini çalıştı:** mevcut LAB alan denetimi kilidi,
  eklediğim dört alanın kayıt defterine yazılmadığını yakaladı ve tam suite
  düştü; düzeltildi.

  **Bilinen sınır (saha ölçmeli):** tünel kanıtı **OBD far sinyaline bağlıdır**
  — OBD bağlı değilken tünel modu hiç tetiklenmez (fail-safe: sahte gece yok).
  OSM `tunnel` etiketi ayrı PR olarak açık kaldı.

- **MAVI-LOC-P0 · "Neredeyiz?" Gerçek Konumdan Cevaplanıyor (2026-08-08, Mavi Konum PR):**
  tam suite **11 085/11 085 · 488 dosya** (varsayılan timeout); `npm run guard`
  **368/368**; `tsc -b` temiz; değişen dosyalarda eslint **0 sorun**. 35 yeni
  test. Kütük **#474**. Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  **Kapatılan kusur:** "Mavi, neredeyiz?" → "Haritayı açıyorum." Bu bir
  halüsinasyon değil **bağlam açlığıydı**: zincir (niyet → eylem → handler →
  `readCurrentLocation` → reverse geocode) baştan sona mevcut ve doğruydu, ama
  iki kapı kapalıydı (maviCore gölge modda; tool loop varsayılan kapalı) ve
  Mavi'nin sistem promptunda **konum satırı hiç yoktu** — yakıt, DTC, menzil ve
  yolculuk vardı, konum yoktu.

  **Kapılara dokunulmadı.** Tool loop/orchestrator **global açılmadı** (kilitli),
  gölge modu değiştirilmedi, zincir yeniden yazılmadı. Konum mevcut kaynaklardan
  türetilip **bağlama** eklendi.

  **Karar tablosu fail-closed:** taze fix → GPS/high (doğruluk bilinmiyorsa
  yükseltilmez) · eskimiş + DR → DEAD_RECKONING/`estimated:true` · **çok eski +
  DR yok → UNAVAILABLE** (bayat koordinat "kesin konum" sunulmaz) · **adres
  çözülemediyse → UNAVAILABLE** (koordinatı doğal dile taşımaktansa bilmediğini
  söyler). DR güveni 0 ise tahmin dayanaksızdır ve kullanılmaz.

  **Gizlilik yapısal:** `LocationContext` tipinde lat/lon **alanı yoktur**;
  cümle yalnız şehir/ilçe/yol taşır. Kilit hem koordinat desenini hem
  "enlem/boylam" kelimelerini arar.

  **Tek ekleme — `reverseGeocodeParts()`:** mevcut `reverseGeocode` adresi ilk
  iki parçaya kısalttığı için **şehir kayboluyordu**. Aynı modüle, aynı uca,
  **aynı ToS rate-limiter'ına** bağlı ek fonksiyon yazıldı; mevcut fonksiyon ve
  kilitleri hiç değiştirilmedi. İkinci servis değildir.

  **Senkron/asenkron ayrımı:** bağlam kurucusu senkron, geocode ağ çağrısı →
  fix · sınıf · DR · kaynak · güven **her okumada taze**, yalnız yer adı
  önbellekten (TTL 90 sn / 400 m, talep-tetikli). Mavi nerede olduğunu bilmese
  bile **bildiğini/bilmediğini daima doğru bilir**. Yeni zamanlayıcı yok.

  **Trip PR dersi uygulandı:** bağımlılık ters çevrildi
  (`locationContextAccess`, çalışma zamanı bağımlılığı sıfır). Graf ölçüldü:
  **357 → 359** (yalnız iki yaprak); ağır servis graf dışında.

  **Bu turun YAPMADIĞI (onaylı kapsam):** tünel gece modu ve DR mimarisi dahil
  edilmedi; TripSession değiştirilmedi. **Sonraki PR: tünel gece modu.**

- **TRIP-P0 · Yolculuk Kapanışı Onarıldı + Seyahat Oturumu (2026-08-08, Trip PR):**
  tam suite **11 050/11 050 · 487 dosya** (varsayılan timeout — `--testTimeout`
  gerekmedi); `npm run guard` **368/368**; `tsc -b` temiz; değişen dosyalarda
  eslint **0 sorun**. 28 yeni test. Kütük **#473**.
  Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  **Kapatılan kusur:** Mavi "3 saattir yoldayız" derken gerçek 40 dakikaydı ve
  km de yanlıştı. Tek kök ikisini birden açıklıyor: yolculuğu kapatan duruş
  penceresi YALNIZ `_onGPS`/`_onOBD` gövdesinde kuruluyordu; `_liveClock`
  bitiş DEĞERLENDİRMİYORDU. Araç park edip veri tamamen susunca kapanış hiç
  kurulmuyor, yolculuk açık kalıyor ve sonraki sürüşte aynı oturum devam
  ediyordu — monotonik süre park süresini, mesafe de önceki sürüşü sayıyordu.

  **Sessizlik ≠ duruş (bilinçli ayrım):** 60 sn "aracın DURDUĞUNU GÖRDÜK"
  demektir; sessizlik "HİÇBİR ŞEY GÖRMÜYORUZ" demektir. Sessizliği 60 sn'de
  kapatmak uzun tünelde sürüşü ortadan bölerdi (Ovit ≈ 11 dk) → ayrı ve uzun
  eşik (**15 dk**), kapanış `cleanClose: false` (kanıtı kaybettik, duruşu
  görmedik). Mevcut 60 sn'lik duruş yolu birebir korundu.

  **Seyahat oturumu — ne ölçüyor, ne ölçmüyor:** saf model ardışık yolculukları
  ve aralarındaki boşluğu tek seyahate toplar. **Hiçbir şey ÖLÇMEZ:** süre
  kovaları `tripMetricsAccumulator`, mesafe `tripLogService` otoritesinden
  gelir. **Sahipsiz olan tek büyüklük segmentler arası MOLA'dır** — modelin
  gerçekten türettiği tek şey odur. Mesafe kümülatif beslenir ve segment
  değişiminde mühürlenir → çifte sayım **yapısal olarak imkânsız**.

  **Yeni timer YOK:** süren mola ve geçen süre okuma anında türetilir; oturum
  `onTripState`'e tek abonelik kurar. Odometre, PR-451a `consumedM` projeksiyonu
  ve KALAN rota mesafesi bu toplama **girmez** (dördü de kilitli).

  **Ölçümle bulunan mimari düzeltme:** `companionChatProvider` senkron olduğu
  için oturum önce statik import edilmişti; bu Mavi bağlam grafiğini
  ağırlaştırıyordu. Bağımlılık ters çevrildi (`tripSessionAccess` — çalışma
  zamanı bağımlılığı sıfır). Graf ölçüldü: servis ve saf model
  `vehicleDataLayer` grafından çıktı.

  **Bu turun YAPMADIĞI (onaylı kapsam):** Mavi konum cevabı ve tünel gece modu
  bu PR'a **dahil edilmedi** — ayrı turlara bırakıldı.

- **OEM-NAV-P0 · Ölü Hesap Projeksiyon Ekseni Rotaya Bağlandı (2026-08-08, PR-451a):**
  yeni model + runtime bağlantısı **26/26 test**; `tsc -b` temiz; değişen
  dosyalarda eslint **0 sorun**; `npm run guard` **368/368**. Kütük **#472**.
  Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  ⚠️ **Tam suite bu turda TEMİZ DEĞİL: 11 016/11 019 geçti, 3 düştü.** Düşen
  üçü de `routeColorPolicy.test.ts` içindedir ve **PR-451a ile ilgisizdir**
  (aşağıda "Çelişki Kaydı"na yazıldı).

  **Teşhis düzeltmesi (kütük #451 kısmen eskimişti):** "konum ölü hesabı YOK"
  hükmü `gpsService._startDeadReckoning()` (gerçekten boş) ve
  `VehicleCompute.worker._applyDeadReckoning()` (yalnız odometre) okunarak
  verilmişti. Ancak `navigationSessionRuntime._drTick` **konum ÜRETİYOR ve
  `updateRouteProgress`e besliyor**. Ölü olan özellik değil, projeksiyonun
  **EKSENİYDİ**: `projectDeadReckon` son heading doğrultusunda düz çizgi atıyor,
  rota geometrisini hiç kullanmıyordu.

  **Türetilen bedel (⚠️ saha ölçümü DEĞİL):** yanal sapma ≈ s²/(2R), koridor
  `55–95 m` → 90 km/h'de R=400 m'de **~8 sn**, R=1000 m'de ~13 sn, R=3000 m'de
  ~23 sn'de koridor aşılıyor. Yani DR, 60 sn'lik `DR_MAX_DT_SEC` tavanına
  **ulaşamadan** `OFF_NETWORK`e düşüyordu. #451'de kayıtlı saha gözlemi
  (`lateralM` max 1496 m · `STRAIGHT_LINE` 92 örnek · kalan mesafe 45 kez arttı)
  bu mekanizmayla tutarlıdır; **düz tünelde 60 sn dayandığı için özellik bazen
  "çalışıyor" görünüyordu** — teşhisi geciktiren şey buydu.

  **Düzeltme:** saf model `navigation/core/routeProjectionModel.ts` →
  `advanceAlongRoute()` çapadan polyline **boyunca** ilerletir; viraj geometride
  zaten taşındığı için yanal sapma **yapısal olarak doğmaz**. Kilit: R≈400 m
  sentetik yayda 60 sn boyunca sapma **< 1 m**, aynı yayda heading projeksiyonu
  **< 15 sn**'de koridoru aşıyor — kusur ve düzeltme AYNI testte kanıtlanır.

  **Asıl incelik — çapa bir kez alınır:** mevcut projeksiyon MUTLAKtır (her tick
  "son gerçek fix'ten v×Δt", birikimli değil). Çapa DR'ye girerken bir kez
  alınır; her tick `getRouteProgressPoint()` okunsaydı çapa kendi
  projeksiyonumuzla kayar ve **mesafe iki kez uygulanırdı**. GPS tazelenince
  çapa unutulur — bayat çapa, aracın çoktan geçtiği noktadan ilerletmekti.

  **Fail-closed:** geometri yok/bozuk · çapa yok · segment aralık dışı → eski
  heading projeksiyonu AYNEN. `advanceM <= 0`/`NaN` → yerinde kalır (geriye
  ilerleme YOK). Rota bitince son noktada durur, `exhausted: true`; **varış
  iddia edilmez**.

  **Bu turun YAPMADIĞI (bilinçli, sonraki PR'lara):** (a) HUD dürüstlüğü —
  `isDeadReckoningActive()` hâlâ `gpsService`e bakar ve **daima false**'tur,
  sürücüye "GPS yok — konum tahmini" uyarısı HÂLÂ GÖSTERİLMİYOR; (b) worker'daki
  ikinci (odometre) DR sahibi duruyor; (c) GPS dönüşünde fusion/reconciliation
  yok → tünel çıkışında konum sıçraması BEKLENİR.

- **OEM-NAV-P0 · Gündüz Rota Kılıfı + Zemin Kutbu Sözleşmesi (2026-08-08, PR-3b):**
  tam suite **10993 test / 485 dosya** — `--testTimeout=30000` ile TEMİZ;
  varsayılan 5 sn timeout'ta `regression.guards` içindeki `_hasAnyField`
  dinamik-import testi yüklü makinede düşüyor (aşağıya bkz.). `tsc -b` temiz;
  değişen dosyalarda eslint **0 sorun**. Kütük **#471**.
  Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  **Kapatılan kusur (K2):** gün/gece geçişi yalnız raster paint + arka planda
  yapılıyordu; rota katmanlarının gündüz varyantı YOKTU. Ham OSM zemininde beyaz
  kılıf **1,00–2,32:1** ile yok hükmündeydi (eşik 3,0). Açık zeminde kılıf
  ürünün kendi `--oem-ink` mürekkebine (`#0A0C10`) çekildi → **8,45–19,57**.

  **Tek token, zincirleme kazanç:** kılıf koyulaşınca çekirdeğin zeminle
  savaşması gerekmiyor; yalnız kılıftan ayrışması yetiyor. Emerald ucu
  2,54→7,72 · amber 2,15→9,11 · trafik renkleri 3,4–8,6. Bu yüzden gradient,
  halo mavisi, amber ve trafik paleti **değiştirilmedi**.

  **Ölçülerek reddedilen:** çekirdeği koyulaştırmak (`#1A56C4`) koyu kılıfla iç
  kenarı 2,96'ya düşürüyor → rota tek koyu bloğa dönüşür. Kilit testiyle kayıtlı.

  **Asıl risk — sözleşme daraltması:** PR-3a'nın `dayMode` girdisi fazla genişti.
  `MapMode` ile `getMapNight()` bağımsızdır; **gündüz + uydu** gerçek bir
  kombinasyondur ve orada koyu kılıf rotayı yok ederdi. Girdi `lightBasemap`e
  daraltıldı, türetme tek yerde: `!night && mode === 'road'`. Fail-soft kutup
  asimetriktir — okunamazsa AÇIK sayılmaz.

  **Bu turun YAPMADIĞI:** K3 (amber'in manevra/tehlike ikili anlamı) · K4
  (low-end/high-end çekirdek ayrımı) · K5 (trafik gradient yaşam döngüsü) ·
  halo genişliğinin açık zeminde "mavi pus" üretip üretmediği (ÖLÇÜLMEDİ).

  **Bilinçli davranış sonucu (saha ölçütü):** açık zeminde *yaklaşma kademesi*
  amber taşımaz; kritik manevra ve tehlike sinyali halo üzerinden korunur.

- **OEM-NAV-P0 · Rota Rengi Tek Hakeme Bağlandı (2026-08-07, PR-3a):**
  tam suite **10979 test / 485 dosya TEMİZ**; `tsc -b` temiz; regresyon kasası
  **368/368**; değişen dosyalarda eslint **0 sorun**. Kütük **#470**.
  Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  **Kapatılan kusur (K1):** rota kılıfı ve halosunun rengini iki ayrı blok, iki
  ayrı bayrakla yazıyordu ve manevra bloğu önce koştuğu için tehlike rengini
  siliyordu: *risk 0,6 → amber · kademe 0→1 → amber · kademe 1→0 → **beyaz***,
  risk hâlâ yüksek ama bayrak değişmediği için bir daha uygulanmıyordu. Aynı
  kusurun iki yolu daha vardı: yeniden çizim ve sürüşten çıkış.

  **Yöntem:** renk artık durum DEĞİŞİMİNDEN değil ANLIK DURUMDAN türer. Saf
  hakem `map/core/routeColorModel.ts`, öncelik **TEHLİKE > MANEVRA > NORMAL**.
  Dedup tek anahtarla (`routeColorKey`) yapılır ve kılıf+halo+çekirdek birlikte
  yazılır → katmanların ayrışması yapısal olarak imkânsız. Eski iki bayrak
  `_mapState`ten kaldırıldı ki ikinci sahiplik geri dönemesin.

  **Renk DEĞİŞTİRİLMEDİ.** `#ffffff` · `#4285f4` · `#f59e0b` aynen; kademe 1'de
  halonun normal kalması da birebir korundu. `dayMode` sözleşmeye kondu fakat
  davranışı etkilemiyor — PR-3b için açık genişleme noktası.

  **Ölçüm bırakıldı, uygulanmadı:** saf kontrast yardımcısı eklendi ve K2'nin
  sayıları testlere gömüldü (gündüz beyaz kılıf ≈ **1,05:1**, amber ≈ **2,05:1**;
  WCAG 1.4.11 eşiği 3:1). Bu, PR-3b'nin kabul ölçütüdür; **palet kararı
  verilmedi**.

  **Bu turun YAPMADIĞI:** gündüz/gece palet tasarımı (PR-3b) · `#f59e0b`'nin
  manevra ile tehlike arasında paylaşılması (K3) · düşük-uç/yüksek-uç çekirdek
  ayrımı (K4) · trafik gradient'inin dekoratif gradient'i kalıcı ezmesi (K5).

- **OEM-NAV-P0 · Rota Kalınlığı Tek Otoriteye Bağlandı (2026-08-07, PR-3):**
  tam suite **10952 test / 484 dosya TEMİZ**; `tsc -b` temiz; regresyon kasası
  **368/368**; değişen dosyalarda eslint **0 sorun**. Kütük **#469**.
  Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  **Kapatılan kusur:** rotanın beş katmanının kalınlığını dört bağımsız yer
  yazıyordu ve hiçbiri diğerini bilmiyordu (kurulum · perspektif düzeltmesi ·
  nefes alan glow · hiç güncellenmeyen shadow/flow). z18'de ölçülen sonuç
  **CASE 46 > CORE 39 > GLOW 24 > SHADOW 22**: katman sırası gereği neon halo
  ve derinlik gölgesi tamamen kayboluyordu — iki `line-blur` katmanı GPU yakıp
  ekrana hiçbir şey çizmiyor, risk arttıkça nefes alan **güvenlik sinyali
  sürüş sırasında sürücüye hiç ulaşmıyordu**. Ayrıca navigasyon başlar başlamaz
  rota **3,2× kalınlaşıyor** (10 → 32 px) ve kalınlık ekran ölçüsünü hiç hesaba
  katmadığı için `vmin` ekseninde **2,22× görsel ağırlık farkı** oluşuyordu.

  **Yöntem:** tek saf politika (`map/core/routeWidthModel.ts`). ÇEKİRDEK tek
  geometrik kaynaktır; kılıf · gölge · halo · akış ondan **oranla** türer →
  sıra tersine dönmesi yapısal olarak imkânsız. Ölçek `vmin` tabanlı (taban
  0,72 / tavan 1,15), referans **head unit 1024×600 → 1,000** olduğu için
  birincil donanımda çekirdek ve kılıf **birebir korundu**. Ölçüm harita
  CANVAS'ından alınır — mini harita ile tam ekran ancak böyle aynı görsel
  ağırlığa sahip olur. Yeni dinleyici/timer YOK; ölçüm yalnız kalınlığın zaten
  yazıldığı anlarda yapılır. `vmin` yayılımı **2,22× → 1,39×**.

  **Öz-düzeltme kaydı:** nefes tabanını önce 0,60 seçmiştim; nefesin dip
  noktasında halo yine kılıfın altına düşüyordu. Taban TÜRETİLDİ
  (`casing/glow = 0,838` → 0,88, %5 pay) ve kilit testi bunu yakaladı.

  **Bu turun YAPMADIĞI (iddia edilmiyor):** kalınlığın MUTLAK seviyesi
  tartışılmadı — "önizlemedeki 10 px mi, sürüşteki 32 px mi doğru?" sorusu
  cihazda ölçülmesi gereken ayrı bir karardır ve **açık borçtur**; alternatif
  rota katmanı (`car-route-alt-fill`) bilerek kapsam dışı (o bir dokunma
  hedefidir); rota RENGİ/kontrastı ve gece-gündüz paleti bu turda ele
  alınmadı; glow'un genişlemesinin orta seviye GPU'daki FPS etkisi ÖLÇÜLMEDİ.

- **OEM-NAV-P0 · HUD Üst Bant Şerit Bütçesi — Dikey Navigasyon (2026-08-07, PR-2):**
  tam suite **10931 test / 483 dosya TEMİZ**; `tsc -b` temiz; regresyon kasası
  **368/368**; değişen dosyalarda eslint **0 sorun**. Kütük **#468**.
  Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  **Kapatılan kusur:** yoğunluk kapısı tek eksenliydi (`useDenseHud`, yükseklik
  < 520). Yatay için doğru; ama tam ekran navigasyon dikey de açılıyor ve dikeyde
  yükseklik 740–930 px olduğu için kapı hiç kapanmıyordu → 360–430 px genişliğe
  TAM yerleşim çiziliyordu. 360 px'te ölçülen: manevra kartı **16..304**, yol
  tabelası **70..290**, ikisi de `top: --sat+14` → **220 px örtüşme**. Alt bardaki
  3 sütunlu şerit de taşıyordu (`clamp()` bu genişlikte tabana oturduğu için
  korumuyor: talep ≈339 px, mevcut 328 px).

  **Yöntem — ŞERİT MODELİ, ikinci yerleşim kopyası değil:** üst bant üç şerittir
  (sol manevra kartı · orta yol tabelası · sağ hız paneli). Orta şerit
  merkez-çapalı olduğundan bütçesini yan şeritlerin sınırlarından hesaplar. Karar
  tek ve SAF (`computeHudLayout`), hook yalnız ölçümle besler → testin
  doğruladığı kod ile ürünün koştuğu kod AYNIDIR. **Yeni dinleyici/timer YOK**
  (üründe zaten iki ekran gözlemcisi var; üçüncüsü kurulmadı).

  **Eşikler türetilmiştir, serbest sabit değil:** tabela asgarisi = panelin KENDİ
  bildirdiği `minWidth: 140`; dar-ekran eşiği = `sol şerit + tabela asgarisi + sağ
  şerit` = **572**. Bütçe yetmezse tabela sıkıştırılmaz, çizilmez — sıkıştırılırsa
  `minWidth` kazanıp komşu şeride taşar, kusurun kendisi budur.

  **Yatay korunuyor:** bütçe kutunun doğal genişliğinden (≈220 px) büyük — head
  unit **416**, telefon yatayı **296** → görünür etki yok. `dense` aynen yükseklik
  ölçütü kaldı; `TurnPanel`/`SpeedPanel` yalnız onu alır (yoğun varyantları
  yüksekliği GENİŞLİĞE takas eder, dikeyde ters yönde yanlış olurdu).

  **Bu turun YAPMADIĞI (iddia edilmiyor):** dikeyde yol tabelası GİZLENİR — o
  bilginin (üzerinde olunan sokak) alt bilgi çubuğuna taşınması **açık borçtur**;
  manevra kartı dikeyde hâlâ 288 px sabit lane kullanır, tam genişlik banner'a
  dönüşmez; `MapHudControls` zoom kolonu ve `HazardBanner` (`--sat+72`) genişlik
  eksenine bağlanmadı; `--lp-dock-h` (ana ekran dock'u) tam ekran haritada ölü
  boşluk olarak kullanılmaya devam ediyor; Android sistem çubuğunun dikeyde
  `env(safe-area-inset-bottom)` bildirip bildirmediği ÖLÇÜLMEDİ.

- **OEM-NAV-P0 · Kamera Sönümlemesi Kadanstan Ayrıldı (2026-08-07, PR-1):**
  tam suite **10913 test / 482 dosya TEMİZ**; `tsc -b` temiz; regresyon kasası
  **368/368**; değişen dosyalarda eslint **0 sorun**. Kütük **#467**.
  Durum: **ENTEGRE** (saha kanıtı YOK — **ÜRÜN HAZIR: HAYIR**).

  **Kapatılan kusur:** `dampCameraToward`ın alfaları çağrı BAŞINA uygulanıyordu ve
  150 ms'lik tempoda ayarlanmıştı; oysa `setDrivingView` üründe **150 ms · ~500 ms ·
  16 ms** olmak üzere üç tempoda çağrılıyor. Ölçüm (τ = −Δt/ln(1−α), `DAMP_PITCH`):
  **1,29 s / 4,29 s / 0,14 s** → mini haritanın kamerası tam ekrandan **3,3× tembel**,
  ölü hesaplama yolununki **9,4× hırçındı**. `MiniMapWidget`in "AYNI politika, AYNI
  argümanlar" iddiası argümanlar için doğru, **TEMPO için yanlıştı** — ve bu fark
  hiçbir yüzeyde görünmüyordu. Aynı bağımlılık cruise eşiğinde (tick sayısı) ve
  momentum delta'sında da vardı.

  **Yöntem:** alfa Δt'ye uyarlanır (`1 − (1−α)^(Δt/150)`), **kalibrasyon noktasında
  değer AYNEN korunur** → sahada tek tek ayarlanmış tam ekran davranışı BİREBİR
  değişmedi (bağımsız oracle testiyle kilitli). Cruise ölçütü SÜREYE çevrildi
  (1050 ms = 7 × 150). Saati `MapInteractionManager` okur, motor SAF kalır.

  **Gözlem yüzeyi:** CAROS LAB → *Navigasyon Çekirdeği* → `cam-cadence` · `cam-tau` ·
  `cam-offcadence`. Ölçüm yoksa `UNAVAILABLE`; sahte Δt/τ üretilmez. `cam-offcadence`,
  üründe hangi kamera tempolarının gerçekten koştuğunun **ilk doğrudan ölçümüdür**.

  **Bu turun YAPMADIĞI (iddia edilmiyor):** kamera kadansı ARTIRILMADI — dünya hâlâ
  6,7 Hz'te `jumpTo` ile adımlıyor. Akıcılık artışı ayrı bir PR'ın konusudur ve bu
  düzeltme onun ÖN KOŞULUDUR: kadans-bağımlı sönümleme dururken tempoyu yükseltmek
  saha-ayarlı kamera hissini sessizce bozardı.

  **Aynı turda ölçülüp KAPATILMAYAN açık borçlar (bkz. kütük):** ölü hesaplama
  yolunda 16 ms'lik kamera kapısı (`FullMapView.drInterval`) · tam ekranın hâlâ
  `interpolateNavPoint` kullanması (tek işaret-hareket otoritesi sözleşmesi henüz
  yapısal DEĞİL) · dikey navigasyon için yerleşim modu yokluğu (`useDenseHud` yalnız
  YÜKSEKLİĞE bakar) · mini haritada viewport-oransız rota kalınlığı.

- **NAVIGATION-CAMERA-SHADOW · Kamera Politikası Gölge Doğrulaması (2026-08-05):**
  tam suite **10769 test / 477 dosya**, **iki ardışık koşumda da TEMİZ**;
  `tsc -b --force` temiz; yeni/değişen dosyalarda eslint **0 sorun**.
  Kütük **#398**. Durum: **ENTEGRE** (saha kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  Karar: **`NAVIGATION_CAMERA_SHADOW_COMPLETE_LOCAL`** ·
  `realVehicleValidationVerdict = PENDING_REAL_VEHICLE`.
  Tam rapor: `docs/NAVIGATION_CAMERA_SHADOW_REPORT.md`.

  #396'da kurulan `CAM-2026.08.05` politikası kamerayı sürmediği için o tur
  PARTIAL kalmıştı; devralma kararı **ölçüme** bağlıydı. Bu tur o ölçümün
  altyapısını kurar: legacy `cameraEngine` çıktısı ile politika önerisi **aynı
  navigasyon oturumunda yan yana** üretilir ve farkları LAB'da görünür.

  - **ÜRÜN DAVRANIŞI DEĞİŞMEDİ** ve bu testle kilitlendi: `cameraEngine`'in 10
    saha-ayarlı sabiti, kamera akışı ve `map.project()` çağrı sayısı (3 — hepsi
    bu turdan önce vardı) sabitlendi. Gölge katmanı `cameraEngine`'i **import
    etmez**, **Map API çağırmaz**, **koordinat kabul etmez** (tip düzeyinde).
  - **`anchorY` türetilmedi, ÖLÇÜLDÜ:** legacy çerçeve denetimi için zaten
    `map.project(...).y` hesaplıyordu; gölge o değeri yeniden kullanır → gölge
    için ek harita işi YOK.
  - **#396'nın açık borcu kapandı:** `suppressedCameraUpdates` artık sabit 0
    değil, gerçek sayaç. `accepted + suppressed === evaluation` ve
    `legacyApply + legacySkip === evaluation` değişmezleriyle kilitli — hiçbir
    kamera çağrısı sayaçtan kaçamaz.
  - **Sahte 0 yazılmadı:** politika bu turda zoom/pitch önermediği için o
    deltalar dürüstçe `null`. LAB alan denetimine bu **yapısal istisna** açıkça
    listelendi ve gerekçesinin ekranda yazdığı ayrıca kilitlendi — eğri
    devralınınca istisna kalkmalıdır.
  - **En anlamlı sinyal sayı değil KARAR:** legacy kamerayı sürdü mü, politika
    izin verir miydi? Ayrışma, eğri devralınırsa ürünün farklı davranacağı yeri
    işaret eder.
  - **Taşınan kilitler:** üç durakta-kamera kilidi erken dönüşün tek-satır
    biçimini şart koşuyordu; erken dönüş bloğa alındı (çıkmadan önce gölge
    bildiriliyor) — davranış birebir aynı, kilitler yeni biçime taşındı ve
    "erken dönüş de raporlanmalı" kilidi EKLENDİ.
  - **Flaky disiplini:** önceki turda görülen `selfTestEngine` timeout'u bu tur
    iki koşumda da geçti; `cameraShadow*`/`cameraPolicy*`/`navMarkerMotion*` ile
    **import bağı olmadığı** doğrulandı → sahiplenilmedi ama gizlenmedi.
  - **Açık borçlar:** `viewport` her zaman `FULL` raporlanıyor (mini/tam ayrımı
    `setDrivingView` imzasını değiştirmeyi gerektirirdi) · politika hâlâ
    zoom/pitch önermiyor · sayaçlar oturumlar arası kalıcı değil ·
    **gerçek araçta hiçbir ölçüm yapılmadı**.

- **NAVIGATION-MOTION-CAMERA-P0 · Mini Harita Hareketi & Takip Kamerası (2026-08-05):**
  tam suite **10732 test / 476 dosya TAMAMEN YEŞİL**, `tsc -b --force` temiz,
  eslint'te bu paketin dosyalarında **0 hata / 0 uyarı**. Kütük **#394–#397**.
  Durum: **ENTEGRE** (saha kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  Karar: **`NAVIGATION_MOTION_CAMERA_P0_PARTIAL`** ·
  `realVehicleValidationVerdict = PENDING_REAL_VEHICLE`.
  Tam rapor: `docs/NAVIGATION_MOTION_CAMERA_P0_REPORT.md`.

  - **MİNİ HARİTADA ARAÇ ZIPLIYORDU:** marker DOĞRUDAN GPS geri çağrısında
    çiziliyordu (2 Hz tavan) — tam ekran ise kendi RAF'ında ara değer üretiyordu.
    Aynı üründe iki farklı akıcılık. Paylaşılan `navMarkerMotionRuntime` kuruldu;
    bileşenler artık kendi interpolasyon motorunu KURMAZ, yalnız "şimdi nereye
    çizilmeli" diye SORAR. Dürüstlük sınırları: duran araçta **yapay mesafe
    üretilmez**, fiziksel olarak imkânsız GPS sıçraması **animasyonla
    meşrulaştırılmaz**, bayat konumda işaret **donar**.
  - **🔴 TESTİN BULDUĞU ÜRETİM KUSURU — kuzeyde işaret 180° ters dönüyordu:**
    `utils/interpolation.lerpAngle` `((b-a+180)%360)-180` kullanıyordu; JS'te `%`
    **kalan** operatörüdür, modulo değil → `lerpAngle(350,10,0.5)` **180°**
    döndürüyordu (doğrusu 0°). Araç KUZEYE giderken marker ara değerleme
    sırasında tam ters dönüyordu; ters geçiş doğru çalıştığı için kusur bugüne
    kadar fark edilmemişti. Düzeltildi ve kilitlendi.
  - **MİNİ HARİTA KAMERASI EKSİK ARGÜMANLA ÇAĞRILIYORDU:** `setDrivingView`
    tam ekranda 10, mini haritada 6 argümanla çağrılıyordu → kavşak yaklaşımı,
    dönüş öngörüsü ve durakta rota-yönü düzeltmesi mini haritada HİÇ
    çalışmıyordu. Parite sağlandı (yol-boyu manevra mesafesi + rotanın ileri
    yönü, tam ekranla AYNI otoriteden).
  - **Versiyonlu kamera politikası** (`CAM-2026.08.05`): 10 durum · histerezisli
    hız bantları (CRUISE giriş 90 / çıkış 82 → sınırda salınım yok) · yol-boyu
    manevra bantları · yön-duyarlı çapa · güncelleme fırtınası kapısı.
  - **Dikey tam ekran navigasyon:** ana arayüz YATAY kalır (manifest
    değişmedi); kilit yalnız tam ekran navigasyon süresince native
    `setNavigationOrientation` ile gevşer, çıkışta geri alınır (ref-count'lu,
    fail-soft).
  - **Gözlemlenebilirlik:** CAROS LAB → Navigation Core → **kart 13 "İşaret
    Hareketi · Takip Kamerası"** (22 alan; koordinat maskelidir).
  - **Açık borçlar (bu yüzden PARTIAL):** kamera politikası ÜRETİLİYOR ve
    gözleniyor ama **fiilî zoom/pitch hâlâ sahada ayarlı `cameraEngine`
    eğrilerinden geliyor** — eğrileri aynı turda devralmak ölçümsüz regresyon
    riskiydi · `anchorY` henüz kameraya uygulanmıyor · `suppressedCameraUpdates`
    ürün sayacı bağlı değil · **APK üretilmedi, yön değişimi hiç çalıştırılmadı**
    · döner kavşak/iki yakın manevra için özel kadraj yok.

- **NAVIGATION-DELIVERY-CORE-P0 · Teslim Çekirdeği: Ses · Ölü Hesaplama · ETA (2026-08-04):**
  tam suite **10684 test / 475 dosya TAMAMEN YEŞİL**, `tsc -b --force` temiz,
  eslint'te bu paketin dosyalarında **0 hata / 0 uyarı**. Kütük **#391–#393**.
  Durum: **ENTEGRE** (saha kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  Karar: `NAVIGATION_DELIVERY_CORE_P0_COMPLETE_LOCAL` ·
  `realVehicleValidationVerdict = PENDING_REAL_VEHICLE`.
  Kaynak analiz: `docs/NAVIGATION_P0_CORE_OEM_GAP_ANALYSIS.md` (G1·G2·G3).
  Tam rapor: `docs/NAVIGATION_DELIVERY_CORE_P0_REPORT.md`.

  OEM denetiminin en ağır üç bulgusu kapatıldı. Üçü de aynı sınıftandı:
  **navigasyonun TESLİM katmanı bir React bileşenine bağlıydı.**

  - **SESLİ YÖNLENDİRME ÖLÜYDÜ:** kademeli anons `NavigationHUD`'un
    `useEffect`'indeydi ve o bileşen yalnız `FullMapView` içinde mount ediliyor
    → sürücü mini haritaya döndüğü an **hazırlık · yaklaşma · dönüş anonslarının
    hepsi susuyordu**. Üstelik `navigationSessionRuntime` başlığı bu arızanın
    çözüldüğünü YAZIYORDU (belge–kod çelişkisi). Kademe maskesi bileşen ref'i
    olduğu için görünüm açılıp kapanınca aynı manevra **ikinci kez**
    seslendiriliyordu. Sahiplik `voiceGuidanceRuntime`e taşındı; kanonik kimlik
    `oturum:rotaRevizyonu:adım`. **Eşikler ve metinler BİREBİR korundu** —
    yeni anons algoritması YAZILMADI.
  - **TÜNELDE İLERLEME ÖLÜYDÜ:** ölü hesaplama beslemesi `FullMapView`'ın RAF
    döngüsündeydi → mini haritadayken tünelde **mesafe · ETA · adım sayacı**
    donuyordu. Runtime'a taşındı: **tek** 1 Hz zamanlayıcı, aynı eşikler
    (`GPS_STALE_MS=5000` · `DR_MAX_DT_SEC=60` · `allowReroute:false`).
    Çift ilerleme yapısal olarak imkânsız — `updateRouteProgress` **mutlak**
    eşleştirme yapar, birikimli değildir. Güven bitince ilerleme DURUR;
    hız kaynağı yoksa projeksiyon YAPILMAZ (sahte ilerleme yasak).
  - **ETA ROTANIN SÜRE MODELİNİ KULLANMIYORDU:** `annotations=duration` OSRM'den
    **zaten isteniyordu** ama yanıt hiç ayrıştırılmıyordu — o veri için harcanan
    bant genişliği çöpe gidiyordu. ETA `kalanMesafe / anlıkHız` ile türetildiği
    için şehir→otoyol rotasında varış saati sürekli kayıyordu. Artık gövde
    rotanın kendi süresidir; anlık hız yalnız **kırpılı** (0.8–1.5) bir düzeltme
    çarpanı üretir ve modeli EZEMEZ. Araç durunca ETA şişmez (düzeltme yalnız
    ≥8 km/sa'te uygulanır). Süre dizisi doğrulaması **fail-closed**; süre +
    geometri + revizyon **atomik** devralınır → bayat rota süresi kullanılamaz;
    düz hat `ROUTE_MODEL` durumunu yapısal olarak üretemez.
  - **Gözlemlenebilirlik:** CAROS LAB → Navigation Core → **kart 12 "Teslim
    Çekirdeği"** (22 alan, salt-okunur; runtime BAŞLATILAMAZ/DEĞİŞTİRİLEMEZ).
  - **Taşınan kilitler (kaldırılmadı):** hız-adaptif eşik · rota değişince
    kademe sıfırlama · off-by-one anons · ilk-talimat damgası monotonikliği ·
    "motor timer kurmaz" → **"yalnız DR için TEK timer"** (bu kilit bilinçli
    değişti: GPS kesilince geri çağrı gelmez, DR zamanlayıcısız çalışamaz).
  - **Açık borçlar:** HUD'da LIMP_HOME bildirimi için tek `speakNavigation`
    kaldı (bilişsel durum, kapsam dışı, kilitli) · ETA hesaplanamadığında
    ekranda bir önceki değer kalır (LAB'da durum görünür) · **hiçbir senaryo
    gerçek araçta ölçülmedi.**

- **VEHICLE-AWARE-SPEED-LIMIT-P0 · Araç Farkında Hız Sınırı (2026-08-04):**
  tam suite **10621 test / 474 dosya TAMAMEN YEŞİL**, `tsc -b --force` temiz
  (app + website), eslint'te bu paketin dosyalarında **0 hata / 0 uyarı**.
  Kütük **#388–#390**. Durum: **ENTEGRE** (saha kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  Karar: `VEHICLE_AWARE_SPEED_LIMIT_P0_COMPLETE_LOCAL` ·
  `realDeviceValidationVerdict = PENDING_REAL_DEVICE`.
  Tam rapor: `docs/VEHICLE_AWARE_SPEED_LIMIT_P0_REPORT.md`.

  Hız limiti zincirinin doğruluk tarafı bugüne kadar **yalnız yoldaydı**. Oysa
  Türkiye'de aynı yolun sınırı araca göre değişir: levhası 130 olan bir otoyolda
  otomobil (M1) 130, **panelvan (N1) 110, kamyonet (N1) 95** ile sınırlıdır.
  Ruhsatında kamyonet yazan bir Fiat Doblo sürücüsüne 130 göstermek onu 35 km/sa'lik
  bir yasal ihlale doğru yönlendirir. Bu tur **8 Kapı**'nın 1–3. kapılarını
  (doğru mu · önemli mi · kullanıcı bilmeli mi) hız limiti sinyali için kapatır.

  - **Kanonik yasal sınıf modeli** (`legalVehicleClass`): M1/M1G/M2/M3/N1/N1G/N2/N3
    + ruhsat gövde cinsi + kaynak sırası + altı durum (`VERIFIED · PROBABLE ·
    AMBIGUOUS · UNAVAILABLE · CONFLICTED · STALE`). **Marka/model adından sessiz
    sınıf ÜRETİLMEZ** — Doblo hem M1 hem N1 satılır. **OBD'den okunan VIN tek
    başına ruhsat kanıtı SAYILMAZ** (otoriter kaynaklar: ruhsat · kullanıcı ·
    resmî VIN sorgusu).
  - **Versiyonlu Türkiye politika tablosu** (`TR-2022.07.01`): sayılar UI'a
    gömülmez; her satır ülke · sürüm · yürürlük · otorite · kaynak künyesi taşır.
    Değerler **iki bağımsız kaynakla** doğrulandı (KGM resmî sayfası + KTY md.100),
    panelvanın kamyonetten ayrılması (RG 21/3/2012) ve otoyol 130/140 kararı
    (İçişleri, 1/7/2022) künyelendi. **Kaynak çelişkisi kaydedildi:** yönetmeliğin
    2010 metninde panelvan satırı yok; daha güncel ve otoriter olan KGM esas alındı.
  - **Tek otorite `computeEffectiveSpeedLimit`:** `min(yol sınırı, araç tavanı)`.
    Araç sınıfı tablosu levhayı **ASLA YÜKSELTMEZ** (kaba kuvvet taramasıyla
    kilitli: 9 levha × 5 kategori × 5 gövde). Sınıf bilinmiyorsa **otomobil
    VARSAYILMAZ** → kart `ROAD_ONLY` + açık **"YOL SINIRI"** etiketiyle çıkar.
    N1 gövdesi belirsizse **en düşük aday** (95) uygulanır; yol sınıfı
    çözülemiyorsa tavan hiç uygulanmaz.
  - **DENETİMDE BULUNAN KUSUR — tam ekran levhası sessizce ÖLÜYDÜ:**
    `NavigationHUD` levhayı `useSpeedLimitByLocation()`'ın **dönüş değerinden**
    alıyordu; o değer hook'un yerel state'idir ve modül düzeyi sahiplik kilidi
    yüzünden **yalnız sorgu SAHİBİ örnekte** dolar. Mini harita önce mount
    olduğunda tam ekran hook'u kalıcı `null` dönüyor ve **HUD levhası hiç
    çıkmıyordu**; ters sırada ise HUD, dürüstlük modelinden GEÇMEMİŞ ham değeri
    (bayat/çelişkili/çıkarım) gösterebiliyordu. Yani ürün fiilen **iki ayrı hız
    limiti motoru** çalıştırıyordu. Tek `useEffectiveSpeedLimit()` hook'u ve tek
    `SpeedLimitCard` bileşeninde birleştirildi.
  - **Kullanıcı doğrulaması sürüşü BÖLMEZ:** soru modal değil, haritanın altında
    ince bir şerittir ve yalnız **araç dururken** (≤3 km/sa, hız bilinmiyorsa
    HİÇ) çıkar. "Bilmiyorum" bir sınıf beyanı değildir — sınıf `UNKNOWN` kalır.
    Kullanıcı ↔ internet çelişkisi **sessizce ezilmez**: kullanıcı uygulanır,
    durum `CONFLICTED` ilan edilir. Kalıcı düzeltme: Ayarlar → Ruhsat Sınıfı.
  - **Gözlemlenebilirlik:** CAROS LAB → Navigation Core → **kart 11 "Araç Sınıfı ·
    Uygulanabilir Hız Sınırı"** (28 alan, salt-okunur; sınıf/politika/limit
    buradan DEĞİŞTİRİLEMEZ). Tam VIN taşınmaz — yalnız maskeli gösterim.
  - **Gizlilik:** tam VIN loga/LAB'a/exporta çıkmaz; backend'e bile yalnız ilk
    **9 hane** (seri numarası yok) gider ve proxy 17 haneyi **reddeder**.
    Sağlayıcı anahtarı bundle'a gömülmez; backend yoksa araştırma yapılmaz.
  - **Açık borçlar (rapor §16):** sağlayıcı yapılandırılmadı → çalışma-zamanı
    araştırması bugün fiilen **kapalı**, sınıfın tek gerçek kaynağı kullanıcı
    beyanı · tam ekrandaki `≈` çıkarım levhası bilinçli olarak kaldırıldı
    (`maxspeed`siz yollarda kart görünürlüğü düşecek; doğru çözüm araç sınıfına
    duyarlı çıkarım katmanıdır) · KGM/YİD otoyol ayrımı için veri kaynağı yok ·
    ruhsat OCR kapsam dışı · **araç tavanı aşımında uyarı üretilmiyor** ·
    `speedLimitService`'in yüksek hızda uç nokta rotasyonu kusuru (#385) sürüyor.

- **NAV-CORE-P0 · Navigasyon Çekirdeği Güvenilirliği (2026-08-03):**
  tam suite **10389 test / 466 dosya TAMAMEN YEŞİL**, `tsc --noEmit` temiz,
  `npm run build` başarılı, eslint'te bu paketin dosyalarında **0 hata / 0 uyarı**.
  Kütük **#364–#372**.
  Durum: **ENTEGRE** (saha kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  Tam rapor: `docs/NAVIGATION_CORE_RELIABILITY_P0_REPORT.md`.
  Karar: `NAVIGATION_CORE_RELIABILITY_P0_COMPLETE_LOCAL` ·
  `realVehicleValidationVerdict = FIX_PENDING_REAL_VEHICLE_RETEST`.

  İki saha şikâyetinin ("yeniden rota çok geç", "saçma yollardan götürüyor")
  kökü tek bir yapısal eksikti: **ham GPS noktası doğrudan rota kararı olarak
  kabul ediliyordu.** Karar zincirine üç **saf** katman kondu ve rota
  isteklerine yaşam döngüsü verildi.

  - **Map matching (rota-göreli):** üç bağımsız kanıt — dik mesafe · **yön
    uyumu** (bölünmüş bulvarda karşı şeridi eleyen tek sinyal) · ilerleme
    sürekliliği. Durumlar `MATCHED · MATCH_UNCERTAIN · OFF_NETWORK · STALE ·
    UNKNOWN`; `MATCHED` dışında güven 0.40 ile tavanlı. Ham GPS kaybolmaz.
  - **Sapma durum makinesi:** sabit "3 tick" yerine hız+doğruluk uyarlanabilir
    kanıt penceresi (2–5 örnek **ve** 0.8–2.5 sn; kaba sapmada kısalır).
    Tek örnek asla doğrulamaz; **tünel/GPS kaybı sapma sayılmaz.**
  - **Rota doğrulama kapısı:** sağlayıcının ilk rotası artık **koşulsuz kabul
    edilmiyor** — 12 denetim, `REJECTED` rota uygulanmıyor, alternatifler
    arasından **en az kusurlu** seçiliyor. Yol sınıfı kanıtı olmadığı için o
    denetim dürüstçe `UNKNOWN` kalıyor.
  - **İstek yaşam döngüsü:** kimlik · SUPERSEDED · **bayat yanıt reddi**
    (eski yanıt güncel rotayı EZEMEZ) · tekrar bastırma sayacı · 5 halkalı
    gecikme ölçümü (sapma → istek → yanıt → uygulandı → ilk talimat).
  - **Yol-boyu manevra mesafesi:** kullanıcının birebir bildirdiği kusur
    ("daha 50 metre var, sağa dön diyor") kapatıldı. `cumulativeDistances`
    zaten vardı; eksik olan manevra noktasının geometri indeksiydi.
  - **İki dürüstlük ihlali kapatıldı:** (a) kanıtsız şerit rehberi — oklar
    manevra tipinden TÜRETİLİYORDU; artık gerçek `intersections[].lanes`
    yoksa panel **hiç çıkmıyor**; (b) dönel kavşak çıkış numarası artık
    `maneuver.exit`ten geliyor, yoksa **uydurulmuyor**.
  - **Ölü katman kapatıldı:** her rotada 3 sn'ye kadar bekleyen
    `localhost:5000` isteği oturumda tek ve 700 ms sınırlı yoklamaya indi.
  - **Denetimde OLMAYAN bir kusur bulundu:** `UnifiedVehicleStore.speed` zaten
    km/h iken `navigationService` **üç yerde 3.6 ile çarpıyordu** → varış
    kapısı 10 km/h yerine 2.8 km/h'ye düşüyor ve **varış tetiklenmiyordu**;
    ETA sistematik olarak kısa çıkıyordu.
  - **Gözlemlenebilirlik borcu kapatıldı:** denetimin "47 LAB girdisinde
    navigasyon ekranı YOK" bulgusu giderildi — **CAROS LAB → Araç →
    Navigation Core** (8 kart, salt-okunur, 28 kilit).
    **Gizlilik kararı:** görev "raw GPS / matched position" göstermeyi
    istiyordu; **koordinat GÖSTERİLMEDİ** (CLAUDE.md gözlemlenebilirlik
    kuralı 6 + `LocationEngineScreen` emsali) — yalnız VAR/YOK, yaş ve
    rotaya dik mesafe.
  - **Açık borçlar (rapor §15):** tam yol-ağı eşleştirme ve çevrimdışı gerçek
    rota `routing-graph.bin` artefaktına bağlı (cihazda YOK) · trafik verisi
    yok · hayalet GPS hızı filtresi (#362) hâlâ uygulanmadı · `ROAD_CLASS_MIX`
    denetimi kanıtsız olduğu için UNKNOWN.
  - **Bu turda kendi eklediğim iki kusur testlerle yakalanıp kapatıldı:**
    (1) map matching koridor dışını `UNKNOWN` sayıyordu → reroute tamamen
    ölürdü; (2) `recordFailure` kendi güncellik kapısını bozuyordu → düz-hat
    yolunda rota tamamen kayboluyordu.

- **PRE-ROAD-GATE · Yol Öncesi Güvenlik Kapısı (2026-08-02):**
  tam suite **10043 test / 459 dosya TAMAMEN YEŞİL**, `tsc -b` temiz, eslint 0 sorun.
  Kütük **#312 · #313 · #314 · #315**.
  Durum: **ENTEGRE** (saha kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  Tam rapor: `docs/AUTONOMOUS_FIELD_VALIDATION_PRE_ROAD_SAFETY_GATE_REPORT.md`.
  Karar: `PRE_ROAD_GATE_PARTIAL`.

  Uzun yol öncesi iki iş yapıldı: (a) yanlışlıkla `git checkout --` ile geri
  alınan üç dosyanın **kanıtlı kurtarma denetimi**, (b) saha testinin kendi
  kayıtlarını denetleyen **ikinci, salt-okunur otorite**.

  - **Kurtarma KANITLANDI, ama artık risk kayda geçti:** katalog **44/44 araç ×
    6 alan birebir**, screenMap **35/35 case aynı ekrana** (iki `focus` prop'u
    dahil), MainLayout'ta **sahipsiz string 0**. Kanıt testi
    `_auditCatalogRecovery.test.ts`. **Kapatılamayan boşluk:** yöntem derlenmiş
    bir yapıya dayandığı için 2026-08-01 23:55 sonrası düzenleme penceresine
    KÖRDÜR → kütük #314, kapanışı kullanıcı teyidine bağlı.
  - **Denetim gerçek bir kusur buldu (#315):** `<FieldTestBadge />` mount'u
    kurtarma sırasında düşmüştü; `tsc` temiz, **tüm suite yeşildi** ve hiçbir
    test yakalamadı — sürüş göstergesi ürüne bağlı olmadığı hâlde "tamam"
    görünüyordu. Geri kondu ve **mount kilidi** yazıldı. DERS: *"tüm testler
    yeşil" bir mount'un varlığını KANITLAMAZ.*
  - **Öz-denetleyici (`longRoadSelfValidator`) — ölçen ile denetleyen AYRI:**
    8 denetim ham olay defterinden yeniden hesap yapar (olay varlığı · zaman
    tutarlılığı · sayaç yeniden üretimi · null→hüküm · kopya olay · düşen
    kaydın etkisi · checkpoint↔halka çelişkisi · restart sıçraması).
    **PASS/FAIL kararına DOKUNMAZ:** `affectsAcceptanceVerdict:false` tipte
    sabittir, doğrulayıcı kabul matrisini **import dahi etmez**, JSON raporda
    `verdicts` bloğunun DIŞINDA durur ve bozuk öz-denetimle matrisin
    değişmediği testle kanıtlanmıştır.
  - **Düşen kayıt MISMATCH SAYILMAZ:** bütçe budaması farkı zaten açıklar;
    aksi hâlde bütçe davranışı sahte "veri bozuk" alarmına dönüşürdü →
    `INSUFFICIENT_RAW_EVIDENCE`. Bu kural yazılırken gerçek bir boşluk bulundu
    ve düzeltildi (defterin TAMAMI budandığında ilk uygulama yine MISMATCH diyordu).
  - **Başlangıç kapısı gerçek otoriteye bağlandı:** GPS **izni** artık
    `gpsService.getGPSState()`ten okunuyor (izin İSTENMEZ, yalnız okunur) →
    `BLOCKED_POLICY`; storage artık bütçe payını da bildiriyor ve işletim
    sistemi boş alanını **"yeterli" VARSAYMIYOR**. Eksik kapı testi
    ENGELLEMEZ — tek meşru engel kanıtın SAKLANAMAMASIDIR (kalıcılık/tampon).
  - **Önceki turun "kırık kilit" tespiti ÇÜRÜTÜLDÜ:** `regression.guards ›
    _hasAnyField` kırık DEĞİL, **kararsız** — soğuk Vite önbelleğinde 5 sn'lik
    dinamik import zaman aşımı; ısındığında izole 3/3 ve tam suite yeşil.
    Kütük #312 🔴→🟡 taşındı ve yanlış teşhis kayda geçirildi.
  - **Gerçek araç:** `realVehicleReadinessVerdict=NOT_RUN`; öz-denetleyici
    gerçek veriyle hiç koşmadı (#313) — `CHECKPOINT_RING` ve
    `RESTART_COUNTER_JUMP` gerçek kesinti/process-death olmadan doğrulanamaz.

- **LONGROAD-P0 · Otomatik Uzun Yol Saha Doğrulama (2026-08-02):**
  tam suite **9973 test / 455 dosya yeşil** (1 düşen kilit bu paketten BAĞIMSIZ —
  kütük **#312**), `tsc -b` temiz, yeni dosyalarda eslint 0 sorun.
  Kütük **#308 · #309 · #310 · #311** 🔴.
  Durum: **ENTEGRE** (saha kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  Tam rapor: `docs/AUTONOMOUS_LONG_ROAD_FIELD_VALIDATION_P0_REPORT.md`.
  Karar: `AUTONOMOUS_FIELD_VALIDATION_P0_PARTIAL`.

  Kullanıcının tek bir kez **BAŞLAT** demesiyle uzun yol boyunca kendi kendine
  koşan pasif gözlemci: 30 senaryoyu kenar tabanlı algılar, 7 sinyal için defter
  tutar (ilk görülme · kapsama · en uzun boşluk · min/ort/max · geçersiz/bayat),
  kritik olaylarda bounded BlackBox penceresi (öncesi 60 sn / sonrası 120 sn)
  dondurur, cooldown+dedupe'lu snapshot alır, uygulama ölse bile **aynı
  `sessionId` ile** devam eder ve tek düğmeyle Türkçe + JSON saha raporu üretir.
  CAROS LAB → Geliştirici → **Uzun Yol Saha Doğrulama** (`long-road-field-validation`,
  yeni AVAILABLE) — böylece #151 Zorunlu Gözlemlenebilirlik Kuralı aynı fazda
  karşılandı.

  - **Ürün davranışına DOKUNULMADI (`productBehaviorVerdict=UNCHANGED`):** yalnız
    mevcut senkron getter'lar okundu; yeni okuma katmanı, ikinci session engine
    veya global store KURULMADI. Yasak-çağrı kilidi 9 dosyada testle sabitlendi
    (`connectOBD`/`sendCommand`/`startPolling`/`startNavigation`/`play()`/`alert`
    … hiçbiri yok). Async native PULL'lar (`refreshExtendedPollEvidence`,
    `refreshKwpRecoveryEvidence`) ve tembel singleton üreten
    `getLiveDiscoveryCoordinator` **bilinçle dışlandı**.
  - **Sürücü güvenliği (`driverDistractionVerdict=SAFE_PASSIVE`):** sürüş
    sırasında popup/ses/odak/ekran değişimi YOK; gösterge oturum aktif değilken
    `null` render eder; özet YALNIZ araç dururken açılabilir ve **hız
    bilinmiyorsa fail-closed kapalı** kalır.
  - **Eşikler gizlenmedi:** her kabul maddesi `thresholdSource` taşır ve eşikler
    `PRODUCT_CONTRACT` (ürünün kendi hükmü) ile `SPEC` (bu tur için açıkça
    sabitlenen) olarak AYRILIR; 5 SPEC eşiği raporda ayrı tabloda **açık borç**
    olarak listelenir — gizlice "ürün standardı" gibi sunulmaz.
  - **Gizlilik iddia değil ÖLÇÜM (`privacyVerdict=PASS`):** üretilen rapor
    `auditPrivacy()` ile gerçekten taranıyor (TAM VIN · koordinat · JWT · Bearer ·
    e-posta · anahtar deseni). Bulgu varsa yalnız DESEN ADI bildirilir, eşleşen
    değer rapora GİRMEZ.
  - **Bu tur üç gerçek kusur testlerle bulundu ve onarıldı:** (1) oturum başlatma
    bayat gövde döndürüyordu → çağıran "snapshot alınmadı" görüyordu; (2) restore
    kayıp penceresi ölçülmemişti → `LR_MAX_CHECKPOINT_LOSS_MS` (30 sn) olarak
    açıkça tanımlanıp kilitlendi; (3) **kritik olaylar checkpoint aralığını
    bekliyordu** → tekrarlanamaz saha kanıtı kaybolabilirdi, artık anında yazılıyor.
  - **Dürüst boşluklar:** AI kanıt akışı · müzik · navigasyon gözlem kanalları P0'da
    BAĞLANMADI ve `NOT_OBSERVED` döner; sürücü zinciri gerçek kaynak olmadığı için
    `BLOCKED_HARDWARE`; filo eşleştirmesi olmayan cihazda bulut maddeleri
    `BLOCKED_BACKEND` (FAIL DEĞİL). APK SHA-256, git revizyonu ve başlangıç bölgesi
    bu katmandan okunamadığı için `UNAVAILABLE` bırakıldı — uydurulmadı.
  - **Gerçek araç:** `realVehicleValidationVerdict=BLOCKED_REAL_VEHICLE`. Sistem
    `obdAdapter !== 'real'` veya geçerli hız örneği yoksa bu kararı KENDİSİ verir
    ve raporun sonuna "bu rapor SAHA DOĞRULAMASI SAYILMAZ" uyarısını basar.

- **MAVI-STT-CONTEXT-GRAMMAR Bağlama göre daraltılan komut grameri (2026-07-28):**
  tam suite **8514 yeşil (412 dosya) İKİ TEMİZ KOŞU**, `tsc -b` temiz, eslint 0 hata,
  `compileDebugJavaWithJavac` başarılı. Kütük **#160** 🔴.
  Durum: **ENTEGRE** (saha kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  Offline Vosk aktif komut sözlüğü artık bağlama göre daraltılıyor: bekleyen onay
  varken yalnız 7 girdilik confirmation grameri, navigasyon/medya/araç bağlamında o
  sınıf + çapraz-bağlam kaçış seti, kanıt yoksa tam sözlük (919 girdi).
  **Çevrimiçi tam dikte yolu değişmedi.**
  - **Gramer karar üretmez:** yalnız tanıma adaylarını daraltır. Intent, eylem ve
    onay kabul/ret otoritesi M4 + `voiceService`te kaldı; parser, Action Registry,
    TTS, VAD, AudioSource ve bulut ASR akışına dokunulmadı.
  - **Bu tur üç gerçek kusur ölçümle bulundu ve onarıldı:** (1) "gramer uygulanmaz"
    ile "tür süzgeci yok" tek `null` sentinel'ine bindiği için **bağlamsız her
    offline dinleme gramersiz kalıyordu** — özellik mevcut Yol A kazancını
    artırmak yerine siliyordu; (2) okuma katmanı ağır servisleri doğrudan import
    edince obd/store zinciri `voiceService` grafiğine girdi ve **9 test dosyası
    yüklenemez** oldu (depoda `diagnosticTrailCore` başlığında yazılı olan aynı
    kaza) → bağımlılıksız sağlayıcı çekirdeği + SystemBoot Wave 2 ayrımı; (3)
    `vehicle_status`/`vehicle_maintenance`/`vehicle_health_check`/`vehicle_clear_dtc`
    "PATTERNS'te yok" varsayılmıştı, ölçüm bunu yanlışladı → araç sınıfına eklendi.
  - **Kilitlerim 6 uydurma beklentiyi yakaladı:** `aracı kilitle` bir keyword değil
    (`arabayı kilitle`/`kilitle`), `sonraki şarkı`/`korna çal` beklentileri hiç
    ölçülmemişti. Beklentiler parser'dan **ölçülerek** düzeltildi, parser'a
    dokunulmadı.
  - **Onarılmayan, bilerek kilitlenen kusurlar (kapsam dışı — "parser değiştirilmez"):**
    `NEGATE_RE`'de `vazgeç` yazılı ama ASCII `\b` yüzünden **çalışmıyor**;
    `"sonraki şarkı"` → `open_music`; `"korna çal"` → `play_music_query`; anlamsız
    cümle → `show_weather`. Dördü karakterizasyon testiyle donduruldu.
  - **Gizlilik yapısal:** tanı yüzeyinde sözcük yok — sınıf, adet, sabit gerekçe
    kodu, doyan sayaçlar; değişim tespiti FNV-1a parmak iziyle (metin saklanmaz).
  - **Açık sınır:** `akaryakıt bul` (`find_nearby_gas`) ile `navigasyonu iptal et` /
    `rotayı durdur` offline yüzeyi YOKTUR — gramere konmadı, yeni komut icat edilmedi.
  - **Eksik ana parça:** gürültülü ortamda daralmanın tanıma başarısını gerçekten
    artırdığı **ölçülmedi** (STT-LAB-2 defteriyle karşılaştırılmalı).
  - **Sonraki atomik görev:** `NEGATE_RE` sözcük-sınırı kusurunun ayrı ve atomik
    onarımı (kabul/ret kuralı değiştiği için ayrı tur olmalı).

- **MAVI-STT-LAB-3 Koşul bazlı toplu özet (2026-07-28):** tam suite
  **8481 yeşil (411 dosya) İKİ TEMİZ KOŞU**, `tsc -b --force` temiz, eslint 0 hata,
  `compileDebugJavaWithJavac` başarılı. Kütük **#159** 🔴.
  Durum: **ENTEGRE** (saha kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  Ölçüm Defteri'ne **KOŞUL ÖZETLERİ** bölümü: aynı koşulun tamamlanmış kayıtları
  ikinci seviyede toplulaştırılır (8 koşul, sabit sıra, açılır ayrıntı) + iki koşul
  arasında matematiksel fark. #158'in saha planı koşul başına ≥3 tekrar istiyordu;
  tek tek kayıt karşılaştırmak sürüş sonrası pratik değildi.
  - **İki seviye asla karışmaz:** kayıt-içi p50 (21 örnek) ile kayıtlar-arası medyan
    (N ölçüm) ayrı havuzlardır. Ham örnek ne açılır ne saklanır.
  - **Merkez değer MEDYAN, ortalama değil:** tek bozuk ölçüm ortalamayı kaydırır,
    medyanı kaydırmaz (aykırı değerle kilitlendi). Yüzdelik yine tek kaynaktan
    (`percentileNearestRank`) — LAB-1/LAB-2 ile aynı gerçek.
  - **`source_lost` ayrı sayılır ve hiçbir şeyi bozmaz:** 4 kayıtlı özetin 11 metriği
    de 3 kayıtlı temiz özetle birebir eşit (kilit testi). `cancelled` iki kat süzülür.
  - **Salt-okunurluk yapısal:** özet bileşeni ham kayıt tipini GÖRMEZ ve mutasyon
    geri çağrısı ALMAZ → o katmanda silme/başlatma/ayar değiştirme imkânsızdır.
  - **Bounded:** ikinci kalıcı depo kurulmadı, modül seviyesi mutable durum yok
    (üst düzey `let`/`var` taraması boş), koşul sayısı enum ile 8.
  - **Bu turda kendi kilitlerim iki hata yakaladı:** otoyol hız medyanını min ile
    karıştırmışım ve "modül cache yok" kalıbı fonksiyon-içi yerel `let`'i yakalıyordu.
    İkisi de test tarafında düzeltildi — üretim davranışı değişmedi.
  - **Açık sınır:** özet yalnız defterdeki 30 kayıttan hesaplanır; daha eski ölçümler
    düşmüştür ve geri getirilemez.

- **MAVI-STT-LAB-2 Kabin gürültü ölçüm defteri (2026-07-28):** tam suite
  **8451 yeşil (410 dosya) İKİ TEMİZ KOŞU**, `tsc -b --force` temiz, eslint 0 hata,
  `compileDebugJavaWithJavac` başarılı. Kütük **#158** 🔴.
  Durum: **ENTEGRE** (saha kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  STT-LAB-1 ekranına **7 · ÖLÇÜM DEFTERİ** bölümü: kullanıcı koşul etiketi ve süre
  (5/10/20/30 sn) seçer, **ÖLÇÜMÜ BAŞLAT** der, ≥500 ms aralıkla mevcut gözlem
  örneklenir ve süre sonunda **tek özet kayıt** oluşur. Böylece "50 km/s'te taban ne,
  110'da ne, fan açıkken ne değişiyor" sorusu ilk kez **karşılaştırılabilir** hale
  geldi — ekrana bakarak not almak sürüşte mümkün değildi.
  - **Yeni diagnostics üreticisi KURULMADI:** koşucu STT-LAB-1 hattını tüketir.
    Yüzdelik hesabı da tek kaynaktan gelir (`percentileNearestRank` dışa açıldı) —
    iki ekranın aynı veriye farklı p95 demesi tanı hattını çürütürdü.
  - **Sahiplik yapısal:** koşucuda modül seviyesi durum YOKTUR; sahibi onu yaratan
    bileşendir → unmount'ta ölür. "Arka planda ölçüm devam eder" hatası **imkânsız**.
  - **Açık sözleşme — iptal:** iptal edilen ölçüm `cancelled` üretilir ve kullanıcıya
    gösterilir ama **deftere yazılmaz** (kısa ölçüm 10 sn'liklerle kıyaslanamaz).
    `source_lost` ise yazılır — tam süre koştu, "kanıt yoktu" gerçek bir bulgudur.
  - **Karar üretilmez:** karşılaştırma yalnız A · B · (B−A). "Daha iyi", "şunu kullan",
    "gürültü hızdan arttı" gibi hüküm/öneri/nedensellik YOKTUR; 12 yasak dize hem
    modelde hem markup'ta taranır.
  - **Yerel saklama kararı:** mevcut `safeStorage` + `caros.lab.*` deseni
    (`phoneHubFieldStore` ile birebir) kullanıldı — yeni genel amaçlı persistence
    katmanı ve **yeni bulut servisi kurulmadı**, depo katmanında ağ çağrısı yok.
  - **Bu turda kendi kilidim bir kusur yakaladı:** kaba yasak-dize taraması kendi
    dürüstlük cümlemi ("Sahte/örnek kayıt ÜRETİLMEZ") sahte veri sanmıştı → kilit
    kontrol YÜZEYİ taramasına çevrildi (buton etiketleri), olumsuzlama korundu.
  - **Açık sınır:** ölçüm sırasında ekrandan çıkınca CPU/ısınma artışı olmadığı
    **cihazda ölçülmedi** — testler yapısaldır. Kütük #158 (j) maddesi.

- **MAVI-STT-LAB-1 Mikrofon + STT gözlem ekranı (2026-07-28):** tam suite
  **8409 yeşil (409 dosya)**, `tsc -b` temiz, eslint 0 hata,
  `compileDebugJavaWithJavac` başarılı. Kütük **#157** 🔴.
  Durum: **ENTEGRE** (saha kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  CAROS LAB → AI → **Mavi STT / Mikrofon** (`stt-mic`, yeni AVAILABLE):
  seçilen/denenen Android AudioSource, örnekleme-kanal-buffer, AEC/NS/AGC için
  **ayrı ayrı** mevcut/oluşturuldu/etkin, anlık RMS + öğrenilmiş gürültü tabanı +
  **KULLANILAN gerçek VAD eşiği**, bounded RMS özeti (min/p50/ort/p95/max),
  aynı turda örneklenen hız/hareket durumu, grammar SINIFI ve son tanıma sonucu
  KATEGORİSİ. Böylece "araç içinde duymuyor" şikâyeti ilk kez **sayısal olarak**
  soruşturulabilir hale geldi.
  - **STT davranışı DEĞİŞMEDİ:** yeni motor kurulmadı, VAD eşikleri
    (`1100 / 0.010f / 1.9f / 0.012`) ve AudioSource aday sırası test ile
    **donduruldu**; native taraf `VoskLatencyTelemetry` ile aynı "yalnız ölçüm"
    disiplinini izler. `VoiceMicDiagnostics` **saf Java**'dır (tek bağımlılık
    `java.util`) — Android/ses API'si import etmediği için mikrofona dokunması
    teknik olarak imkânsızdır ve bu yapısal kanıt testle kilitlendi.
  - **Bu turda görünür kılınan iki kod gerçeği** (kusur değil, artık ölçülebilir):
    wake yolunda gürültü tabanı **hiç öğrenilmez** (sabit eşik) ve wake yolunda
    **AEC/NS/AGC hiç kurulmaz** — ikisi de KAYNAK YOK / `false` olarak dürüstçe
    gösterilir, sahte 0 taban veya sahte "efekt etkin" üretilmez.
  - **Nedensellik ÜRETİLMEZ:** hız ile gürültü aynı okuma turunda ve aynı damgayla
    örneklenir; aradaki fark "örnekleme sapması" olarak açıkça gösterilir.
    "Hız gürültüyü artırdı" gibi hüküm YOKTUR — ilişki ancak saha kütüğündeki
    tekrarlı ölçümle kurulur.
  - **Açık sınır:** klima/fan seviyesi için repoda **hiçbir sağlayıcı yoktur** →
    KAYNAK YOK gösterilir ve saha ölçümünde fan durumu **elle** not edilecektir.
    Yeni sağlayıcı kurmak bu salt-okunur turun kapsamı dışında bırakıldı.
  - **Dürüst sınır (MAVI-M4-LAB ile aynı):** jsdom'da `createRoot` çalışmadığı için
    "oto-yenileme timer'ı kuruldu/temizlendi" RUNTIME'da ölçülmedi; testler
    yapısaldır. Runtime kanıtı kütük #157'nin (m) maddesidir.

- **MAVI-M4 Tek Eylem Otoritesi (2026-07-28):** tam suite **8225 yeşil (403 dosya)**
  iki temiz koşu, `tsc -b` temiz, eslint 0 hata. Kütük **#151** 🔴. Durum: **ENTEGRE**
  (saha kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  İki yürütücü (`intentEngine.routeIntent` · `commandExecutor.dispatchIntent`) teke
  indirildi: araç etkili 13 eylem tek deftere (`action/maviActionAuthority`) alındı ve
  tek kapıdan geçiyor — **hareket (M2) → AiSafetyGate → açık onay → capability**, hepsi
  port/native/OBD çağrısından ÖNCE. `RouterContext`ten araç etkili portların tamamı
  kaldırıldı → o katman yapısal olarak donanım/OBD çağıramaz (guard testi).
  - Bu turda bulunan **üç gerçek üretim kusuru** (hepsi kapatıldı):
    1. **Onay akışı ÖLÜ UÇTU** — `needs_confirmation` saklanıyor ama "evet"i tüketen
       kod üretimde HİÇ YOKTU → telefon araması ve DTC silme **yürütülmesi imkânsızdı**.
    2. **Korna/far/alarm sesli hatta HİÇ BAĞLI DEĞİLDİ** — `routeIntent` opsiyonel
       portu çağırıyor, port hiç sağlanmadığı için komut **sessizce düşüyordu**.
    3. **`CHECK_VEHICLE_HEALTH` sahte "temiz" diyordu** — OBD okuması başarısızken
       (`isStale`) bile `succeeded` + "sistemler temiz, sorun yok".
  - Ayrıca `call_contact` sonuç-ACK listesine alındı (onay beklenirken "Arama
    başlatılıyor" denmesi = M3 sahte ACK sınıfı).
  - M3 kilitleri (`maviFakeAck`) **zayıflatılmadan** yeni otoriteye taşındı; 15
    maddelik M4 kilidi + uçtan uca onay akışı testi eklendi. Yanlışlama yapıldı:
    onay kapısı devre dışı → 9 test, onay çözüm bloğu devre dışı → 4 test kırılıyor.
  - ✅ Gözlemlenebilirlik borcu **KAPANDI** (MAVI-M4-LAB, kütük #152) — aşağıya bakınız.

- **MAVI-M4-LAB Eylem Otoritesi gözlem ekranı (2026-07-28):** tam suite
  **8265 yeşil (404 dosya)**, `tsc -b` temiz, eslint 0 hata. Kütük **#152** 🔴.
  Durum: **ENTEGRE** (saha kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  CAROS LAB → AI → **Eylem Otoritesi** (`action-registry` PLACEHOLDER→AVAILABLE):
  13 eylemlik defter, son kapı kararları (en yeni→en eski, sabit 40'lık dairesel
  halka) ve kapı sayaçları. Böylece #151 Zorunlu Gözlemlenebilirlik Kuralını
  karşılar hale geldi.
  - Otorite katmanına **bounded + PII'siz** tanı API'si eklendi; kayıt fail-soft'tur
    ve **kararı değiştirmez** (kilit testi kapı sonuçlarını birebir doğrular).
  - Bu turda bulunan gerçek kusur: `peekPendingAction` gözlem için **kullanılamazdı**
    — süresi dolmuş isteği **siler** (salt-okunur ekran üretim durumunu değiştiremez)
    ve `intent.payload` **kişi adı + ham kullanıcı komutu** taşır. Ayrı, mutasyonsuz
    ve yalnız VAR/YOK döndüren bir yüzey (`getPendingActionDiagnostics`) yazıldı.
  - Gizlilik yapısal olarak kilitlendi: bekleyen onay slotuna bilerek kişi adı ve ham
    komut konur, ardından hem snapshot JSON'ı hem render markup'ı taranır.
    Yanlışlama yapıldı: modele kişi adı sızdırıldı → 2 test kırıldı.
  - **Dürüst sınır:** repoda `@testing-library/react` yok ve jsdom'da `createRoot`
    çalışmıyor → `renderToStaticMarkup` **effect koşturmaz**. Bu yüzden "otomatik
    yenileme timer'ı kuruldu/temizlendi" RUNTIME'da ölçülmedi; testler yapısaldır
    (varsayılan durum · effect gövdesi · cleanup). Runtime kanıtı kütük #152'de
    🔴 madde olarak bekliyor.

- **MAVI-M4-LAB-2 Eylem zinciri korelasyonu (2026-07-28):** tam suite
  **8302 yeşil (405 dosya)** iki temiz koşu, `tsc -b` temiz, eslint 0 hata.
  Kütük **#153** 🔴. Durum: **ENTEGRE** (saha kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  Kanıt Görüntüleyici'ye `mavi-chain` kanalı ve tur bazlı gruplu görünüm eklendi:
  `komut alındı → actionId → kapı kararı → yürütücü sonucu → M6 TTS sonucu`
  tek grupta, `turnId` ile korele.
  - **Yeni depo kurulmadı:** #152'nin karar halkası `action/maviActionTrace`e
    taşındı ve üç üreticinin (kapı · yürütücü · konuşma) ORTAK halkası oldu.
  - **Eksik aşama tahmin edilmez:** gözlenmemiş her aşama "gözlemlenmedi" der;
    kapı geçti ama yürütücü sonucu yoksa hüküm `INCOMPLETE`'tir — "başarılı" DEĞİL.
  - Proaktif güvenlik uyarısı ayrı tür (`proactive_speech`, `turnId:null`) ve
    hiçbir kullanıcı turuna karışmaz (çift savunma + yanlışlama ile doğrulandı).
  - **Bu turda bulunan gerçek kusur (üretim DEĞİŞTİRİLMEDİ):**
    `maviSpeech.speakMaviAnswer` içindeki stale dalı **ULAŞILAMAZ KODDUR** —
    `getActiveMaviTurn()` daima `_activeId` döndürdüğü için `isMaviTurnCurrent`
    her zaman `true`; dolayısıyla `_suppressedStale` sayacı ASLA artmaz.
    Davranış bugün DOĞRUDUR çünkü gerçek stale koruması ÇAĞRI YERİNDEDİR
    (`useVoiceCommandHandler` turu komut anında yakalar → `continueIfTurnCurrent`).
    Kilit testi bu çağrı-yeri sözleşmesini korur ki "maviSpeech zaten koruyor"
    sanılıp o kapı kaldırılmasın. ✅ Borç **KAPANDI** (MAVI-M6-DEAD-STALE-BRANCH,
    kütük #154) — aşağıya bakınız.
  - **MAVI-M6-DEAD-STALE-BRANCH (2026-07-28):** tam suite **8323 yeşil (406 dosya)**
    iki temiz koşu, `tsc -b` temiz, eslint 0 hata. Kütük **#154** 🔴.
    Ulaşılamaz stale dalı, `_suppressedStale` sayacı ve `suppressedStale` tanı alanı
    **gerçekten kaldırıldı** (yorumla gizlenmedi). Kod diff'i **saf silmedir** —
    davranış değişmedi, çünkü dal hiç çalışmıyordu (dört tur durumunda da ölçüldü).
    Gerçek stale otoritesi çağrı yerlerinde bırakıldı ve `maviStaleAuthority.test.ts`
    ile kilitlendi; yanlışlama: kapı kaldırıldı → test kırıldı, dal geri eklendi →
    test kırıldı.
    - ✅ Açık boşluk **KAPANDI** (MAVI-M6-LATE-SPEECH-GATE, kütük #155).

- **MAVI-M6-LATE-SPEECH-GATE (2026-07-28):** tam suite **8345 yeşil (407 dosya)**
  iki temiz koşu, `tsc -b` temiz, eslint 0 hata. Kütük **#155** 🔴.
  Durum: **ENTEGRE** (saha kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  `commandExecutor` ve `voiceInfoService`in **await sonrası** konuşmaları, komut
  girişinde yakalanmış tur token'ı ile korundu. Token opsiyoneldir → turn kavramı
  olmayan çağıranlar (uzak komut hattı) geriye uyumlu kalır.
  - **Asıl kök neden defter mutasyonuydu:** geç cevap yalnız konuşmuyor, `_syncTurn`
    ile YENİ turun `answered/progressed` bayraklarını da sıfırlayıp ikinci sesin
    yolunu açıyordu. Kapı bu yüzden **defter mutasyonundan ÖNCE** duruyor; sırayı
    bozan bir değişiklik kilit testiyle kırılır.
  - `_speak`/`_speakProgress` token'ı **zorunlu** parametre aldığı için tsc 44 çağrı
    yerinin tamamını kapsadı — "unutulmuş korumasız konuşma" yapısal olarak imkânsız.
  - **Bilinçli davranış değişikliği:** eskimiş turun await sonrası cevabı artık susar.
    Await ÖNCESİ progress meşrudur (tur güncelken söylendi) ve susturulmaz.
  - `staleLateSpeechSuppressed` sayacı eklendi — #154'te kaldırılan ölü sayacın
    aksine gerçekten ölçülebilir, doyan, PII'siz.
  - **Kapsam dışı bırakılanlar:** `notificationService`, proaktif güvenlik hattı
    (`speakSafetyAlert`), navigasyon talimatları ve `speakAlert` hata kanalı — bunlar
    kullanıcı turuna bağlı DEĞİLDİR ve bilinçli olarak bu sözleşmeye alınmadı.
  - ✅ Gözlemlenebilirlik borcu **KAPANDI** (MAVI-M6-LAB-SPEECH-COUNTERS, kütük #156).

- **MAVI-M6-LAB-SPEECH-COUNTERS (2026-07-28):** tam suite **8365 yeşil (408 dosya)**
  iki temiz koşu, `tsc -b` temiz, eslint 0 hata. Kütük **#156** 🔴.
  Durum: **ENTEGRE** (saha kanıtı YOK — ÜRÜN HAZIR: HAYIR).
  Mavi Konsolu'na **F bölümü** eklendi: M6 konuşma defteri + M5 tur kapısı sayaçları.
  `getMaviSpeechDiagnostics()`/`getMaviTurnDiagnostics()` üretiliyor ama hiçbir ekran
  okumuyordu — #155'in `staleLateSpeechSuppressed` sayacı, geç konuşma kapısının
  sahada çalıştığını gösteren TEK kanıt olduğu için bu borç saha doğrulamasını
  imkânsız kılıyordu.
  - Dürüstlük: kaynak yoksa sahte `0` basılmaz (alan hiç üretilmez → KAYNAK YOK);
    sayaç doyduysa "artık gerçek adet değildir" açıkça bildirilir; defter/aktif tur
    ayrışması iki GÖZLENEN alandan türetilir.
  - Gizlilik tip düzeyinde: konuşma sözleşmesinin tüm değerleri `number`/`boolean`
    — metin alanı YOK; tek dize `activeState` enum'u.
  - Mevcut konsol kilitleri yeni doğru davranışa GÜNCELLENDİ (bölüm 5→6, fırlatma
    kilidi iki yeni kaynağı kapsıyor) — hiçbiri zayıflatılmadı.
  - Yanlışlama: sayaç kaynakta 0'a sabitlendi → canlı ölçüm testi kırıldı.

  - **Test altyapısı borcu:** üç test (`maviPlanner` · `currentLocation` ·
    `openRouterKeyService`) dosyalarının İLK dinamik import'unda ~360 modüllük
    kapanışı derliyor ve yüklü makinede vitest'in 5 sn varsayılanını aşıyordu.
    Yalnız o üç testin SÜRESİ genişletildi (30 sn) — hiçbir iddia zayıflatılmadı.
    Kök çözüm: ağır kapanışları test kurulumuna taşımak (ayrı görev).

- **VehicleCompute worker dayanıklılığı (2026-07-26, VCOMP-01/02):** tam suite
  **7880 yeşil (387 dosya)**, `tsc -b` temiz, lint 0 hata, guard 159/159. Kütük **#136** 🔴.
  Worker dispatcher artık exception'da ölmüyor (fail-safe) ve bilinmeyen sinyal
  kaynağı sessizce yutulmuyor (fail-loud). Switch/delegasyon/tip/mesaj arabirimi
  DEĞİŞMEDİ — 11 kilit testi bunu zorluyor; hız/odo/geofence suitleri 193/193 yeşil.
  - ⚠️ Denetimin "DataCloneError" tetikleyici örneği ve "dairesel referans" test planı
    fiziksel olarak geçersizdi (o hata gönderen tarafta fırlar) — düzeltilerek raporlandı.
  - ✅ Açık borç **KAPANDI** (VCOMP-03, kütük #137): bilinmeyen kaynak artık VAL
    tamponuna YAZILAMIYOR — fail-closed kapı state yazımından önce `return` ediyor.
    Kök beklenenden ciddiydi: `FUSED` **tip-geçerli** bir `SignalSource` ama tampon
    anahtarı değil → bugün bile sızabiliyordu. Durum: **ENTEGRE**.

- **CAROS LAB Deterministik Mavi Senaryo Koşucusu (2026-07-26, Görev 4):** tam suite
  **7869 yeşil (386 dosya)**, `tsc -b` temiz, lint 0 hata, guard 159/159. Kütük **#135**.
  14 senaryo GERÇEK üretim fonksiyonlarını enjekte bağımlılıklarla koşturuyor;
  EventBus/TTS/telefon/navigasyon/OBD/ağ/storage'a DOKUNMUYOR, üretim tekillerini
  değiştirmiyor, timer açmıyor, saat enjekte (deterministik).
  - Bu turda bulunan gerçek kusur: proaktif kapı güveni yok sayıyordu →
    `PROACTIVE_MIN_CONFIDENCE = 70` (verdictEngine'in mevcut eşiğinden türetildi).
  - ⚠️⚠️ **Koşucunun PASS vermesi SAHA KANITI DEĞİLDİR.** Hiçbir 🔴 maddeyi 🟢 yapmaz;
    UI'da kaldırılamaz "SİMÜLASYON" etiketi kilit testiyle zorlanıyor. Durum: **ENTEGRE**.

- **Açıklanabilir karar zinciri (2026-07-26, Görev 3):** tam suite **7849 yeşil
  (385 dosya)**, `tsc -b` temiz, lint 0 hata, guard 159/159. Kütük **#134** 🔴.
  Dikey zincir kanıtlandı: gerçek karar kaynağı → mevcut evidence halkası →
  mevcut diagnostic trail → CAROS LAB Mavi Konsolu "E".
  - Yeni DecisionEnvelope/paralel telemetri **kurulmadı**; `TakeoverDecisionRecord`
    (yalnız sahiplik semantiği) **dokunulmadı** — kilit testiyle korunuyor.
  - **İki confidence ölçeği birleştirilmedi:** `percent_0_100` ve `unit_0_1` ayrı;
    değer ölçeğiyle birlikte taşınır. Kaynaksız alan yazılmaz, LAB'da UNAVAILABLE.
  - ⚠️ Kaynaksız kalanlar: `fallbackReason` ve `source` için `llm`/`parser`/`fallback`
    (bugün yalnız `rule` doğuyor). Durum: **ENTEGRE**.

- **Kısa süreli konuşma bağlamı (2026-07-26, Görev 2):** tam suite **7829 yeşil
  (384 dosya)**, `tsc -b` temiz, lint 0 hata, guard 159/159. Kütük **#133** 🔴.
  Dikey akış GERÇEKTEN çalışıyor: araç yorumu → bounded konu yazımı →
  takip sorusu → gerçek prompt funnel'ı (`buildCompanionSystemPrompt`) → ipucu.
  - Konu YALNIZ allowlist kimliği (4 konu, hepsinin gerçek yorumlayıcı üreticisi var);
    ham DTC/kullanıcı metni yapısal olarak giremez.
  - **TTL uydurulmadı:** repoda zaman-tabanlı konuşma TTL'i yok → ölçü TUR tabanlı ve
    mevcut `MAX_HISTORY_TURNS`'ten türetildi (4 kullanıcı turu). Bitiş PASİF, timer YOK.
  - **Belirsizlik fail-closed:** aktif konu bilinse bile "bunu hatırlat" eylem üretmez;
    netleştirme sorulur. İpucu zorlayıcı değil. Durum: **ENTEGRE**.

- **Navigasyon karar otoritesi denetimi (2026-07-26, Görev 1):** tam suite **7809 yeşil
  (383 dosya)**, `tsc -b` temiz, lint 0 hata, guard 159/159.
  - Denetimin "paralel yürütme riski" iddiası **çürütüldü**: köprü eşlemesi ve sahiplik
    guard'ı ZATEN yerinde; bugün çifte `resolveAndNavigate` çağrısı YOK (kütük #132).
  - Bulunan gerçek kusur — **boş hedefle navigasyon** — fail-closed kapatıldı.
  - ⚠️ **Açık mimari borç (#132b):** `navigation.open` eylem kimliği `open_maps` ile
    paylaşıldığı için serbest adres navigasyonu takeover'a alınamıyor; alınsaydı
    "haritayı aç" harici uygulama yerine uygulama-içi ekranı açardı. Durum: **ENTEGRE**
    (tek yürütme garantili), ancak **otorite Mavi DEĞİL**.

- **MAVİ üretim-bağlama turu (2026-07-26, ikinci tur — 4 atomik görev):** tam suite
  **7799 yeşil (382 dosya)**, `tsc -b` temiz, lint 0 hata (25 uyarı = değişmemiş taban).
  Birinci turun **üç açık borcu kapatıldı**, biri kısmen. Hepsi **kütükte 🔴** (#128–#131):
  - **Proaktif uyarı üretim döngüsüne bağlandı** (kütük #128, borç #124 KAPANDI):
    `companionProactiveWiring` + `aiCoreRuntime.onRunResult` gözlemcisi. ⚠️ Bağlantı
    `SystemOrchestrator` poll'una DEĞİL, ZATEN çalışan aiCore edge döngüsüne yapıldı →
    **yeni timer/poll/abonelik sıfır**. Çifte seslendirme koruması (`engine_overheat`
    hattını SystemOrchestrator zaten sesliyor) kilitle korunuyor. Durum: **ENTEGRE**.
  - **`engine_running` kontak kanıtı adaptörü** (kütük #129, borç #127 KISMEN kapandı):
    RPM > 400 **VE** şarj voltajı ≥ 13.2 V iki-sinyal şartı. Eşikler bilinçli olarak saf
    çözümleyicinin DIŞINDA (`ignitionEvidenceAdapter`) — `deepScanIgnitionSource`'un
    "ham sayıya eşik uygulamaz" invaryantı korundu. ⚠️ **Kalan borç:** sağlayıcı üretimde
    OBD okuyucusuna bağlanmadı; native ACC yayını (Java+bridge+JS) bu tura alınmadı;
    eşikler gerçek araçta ölçülmedi. Durum: **İSKELET**.
  - **PHONE_* fail-soft handler kaydı** (kütük #130, borç #123 KAPANDI): üç handler
    `PHONE_NOT_CONNECTED` / `PHONE_TRANSPORT_MISSING` ile DÜRÜSTÇE reddediyor; gölge modda
    bile `ok:true` dönmüyor (sahte "arama yapıldı" yasağı). Native komut kanalı geldiğinde
    yalnız üç gövde değişecek. Durum: **ENTEGRE**.
  - **Tanısal olay izi diske kalıcılaştırıldı** (kütük #131, borç #125 KAPANDI):
    `safeStorage` + 30 sn debounce + 50 olay tavanı + alan-alan doğrulama; hot-path'te
    yazma YOK, kapanışta `immediate` flush. Restart sonrası önceki oturum izi korunuyor.
    ⚠️ Sahada ölçülmeli: 1 saatlik sürüşte bu anahtara düşen gerçek yazma adedi.
    Durum: **ENTEGRE**.

- **MAVİ Vehicle Intelligence turu (2026-07-26 — 5 atomik görev):** tam suite
  **7772 yeşil (380 dosya)**, `tsc -b` temiz, lint 0 hata (25 uyarı = değişmemiş taban).
  Beşi de **kütükte 🔴** (#123–#127). Üçündeki açık borç ikinci turda (#128–#131) kapatıldı:
  - **PHONE_\* eylem kontratları** (kütük #123): `phone.media.play` · `phone.call.start`
    (high, geri alınamaz → onay zorunlu) · `phone.sms.draft` deftere donduruldu.
    ⚠️ **Açık borç:** `executionEngine` phone.\* handler'ı YOK → eylemler bugün bir şey YAPMAZ.
    Durum: **İSKELET**.
  - **Proaktif kritik arıza sesli uyarısı** (kütük #124): kritik kök-nedende Mavi
    kendiliğinden konuşur; geri manevrada susar, 5 dk debounce, ≤180 karakter, AĞA ÇIKMAZ.
    CAROS LAB Mavi Konsolu'na "E · Proaktif Kritik Arıza Uyarısı" bölümü eklendi
    (gözlemlenebilirlik şartı KARŞILANDI). ⚠️ **Açık borç:** verdict üretim döngüsünden
    ÇAĞRILMIYOR → cihazda henüz hiç tetiklenmez. Durum: **İSKELET**.
  - **Araç hafızası — geçmiş arıza eğilimi** (kütük #125): `interpretDiagnosticTrend`
    + gerçek kaynak `ai.mechanic.report` olay halkası; ham DTC kodu prompt'a GİRMEZ.
    ⚠️ **Açık borç:** halka RAM'de — yeniden başlatmada geçmiş sıfırlanır (kalıcı DTC
    geçmişi yok). Durum: **ENTEGRE**.
  - **Driver DNA sürüş stili** (kütük #126): `tripLogService` sert manevrayı fren/gaz
    olarak ayırır; histerezisli sınıflandırma → ≤150 karakter üslup talimatı prompt'a girer.
    Durum: **ENTEGRE**.
  - **Deep Scan `prepare()` kontak kapısı** (kütük #127): enjekte edilen çözümleyiciyle
    fail-closed hazırlık fazı; `null` (bilinmiyor) ile `false` aktif faz açısından AYNI
    karar, ama `getConfirmedValue()` ÜÇ DURUMLU bırakıldı (bilinmeyeni "kapalı" diye
    kaydetmek kanıt uydurmaktır). ⚠️ **Açık borç:** depoda kontak yayan AUTHORITATIVE
    kaynak hâlâ YOK → `ignitionResolver` üretimde bağlanmadı. Durum: **İSKELET**.


- **OBD Diagnostic OS FAZ 0–4:** 25/26 görev kod olarak tamam (+1 gereksiz→kapatıldı),
  tam suite **4074 yeşil (235 dosya)**, tsc + lint + Java derlemesi temiz. **Commit YOK.**
  Yalnız 3 madde saha kanıtına ulaştı (§6.1/§6.2). Detay: `docs/OBD_DIAGNOSTIC_OS_ROADMAP.md`.
- **Diagnostics V2 Root Cause Engine:** PR-1→8 uygulandı ve yeşil (Finding V2,
  `buildRootCauseSnapshot`, errorLedger, rootCauseKb, INCONCLUSIVE, çok-hipotez,
  `buildDiagnosticVerdict`, IncidentCenter VerdictSection). **Hiçbiri cihazda doğrulanmadı.**
- **Platform omurgası:** Vehicle HAL · Event Bus · Kernel · Capability Registry · Provider
  Adapter zinciri merged. Kütükte #33–#59 arası ağırlıkla 🔴.
- **İlk-Eşleştirme Sürekliliği (PR-OBD-PAIR-CONTINUITY):** bonded olmayan Classic adaptöre
  ilk `connect()` çağrısı, insan PIN girişi asenkron bitse bile aynı çağrı içinde devam eder
  (native receiver-latch bond bekleme + JS pairing-grace timeout). JUnit 10/10 + tam suite
  4378/4378 + tsc temiz. **Cihazda doğrulanmadı** (§8.4, kütük #82).
- **CAROS LAB Faz A1 (geliştirici platformu shell'i):** FAZ A / Developer First
  politikasının ilk somut ürünü (`docs/CAROS_LAB_DEVELOPER_PLATFORM_STRATEGY.md`).
  5 kategori · 26 araç kartı · fail-closed geliştirici kapısı; 8 araç GERÇEKTEN bağlı,
  geri kalanı dürüst PLACEHOLDER/DISABLED. Yeni motor YOK — mevcut paneller ve
  salt-okunur kaynaklar yeniden kullanıldı. tsc temiz, tam suite **6819 yeşil (358 dosya)**,
  yeni 39 kilit. **Cihazda doğrulanmadı** (kütük #91). Durum: **ENTEGRE**.
- **Adaptif OBD tazelik eşiği + GPS hayalet kapısı (saha snapshot 2026-07-25):** gerçek
  cihaz kopyası, OBD `connected` + rpm 758 (rölanti) iken sistemin GPS'e düştüğünü ve park
  hâlindeki aracın 10.6 km/h "hız" + 48 m sahte odometre ürettiğini kanıtladı. Kök: sabit
  5 s tazelik eşiği ölçülen ~4.3 s KWP kadansına dar geliyordu; ayrıca çelişki kapısı yalnız
  tek yönlüydü. Yeni saf modül `obdCadenceGate` (eşik gözlenen kadanstan öğrenilir; taban 5 s
  / tavan 20 s; ölü kaynak kendi eşiğini büyütemez) + `_gpsGhostSpeed` ters yön kapısı.
  Trafic/`010D` bozuk-hız vakası korunuyor (iki kapı aynı sabitlerden okur). tam suite
  **7092 yeşil (366 dosya)**, tsc temiz. **Cihazda doğrulanmadı** (kütük #108).
  Durum: **ENTEGRE**.
- **Mavi "Neredeyim?" zinciri (intent → action → tool):** Kök neden bozuk kod değil, zincirin
  hiç var olmamasıydı — niyet kataloğunda konum niyeti, Action Registry'de konum eylemi,
  `MAVI_TOOLS`'ta konum aracı ve `geocodingService`'te **reverse geocoding** yoktu. Dördü de
  eklendi: `query.current_location` → `location.current.read` → `get_current_location`, adres
  için mevcut Nominatim sağlayıcısının `/reverse` ucu (3 s bounded, retry yok, offline'da ağa
  çıkmaz). Konum kaynağı yeni store DEĞİL — mevcut `gpsService`/`UnifiedVehicleStore` snapshot'ı.
  Dürüstlük kademeli: taze → normal · bayat → yaşı beyan edilir · >5 dk → fail-closed ·
  adres yoksa koordinat okunur (uydurma yer adı yok). tam suite **7146 yeşil (367 dosya)**,
  `tsc -b` temiz. **Cihazda doğrulanmadı** (kütük #110). Durum: **ENTEGRE**.
- **Runtime Scheduling native kanıt körlüğü giderildi:** aynı kopya, LAB'daki poll kanıtı
  alanının cihazda poll ÇALIŞIRKEN bile hep "Kanıt mevcut değil (eski APK / poll başlamadı)"
  dediğini gösterdi (`js.eventsReceived=102` ile açık çelişki). Üç kök: (1) kanıt önbelleğini
  yalnız tanı raporu yolu dolduruyordu → ekran tek atış salt-okunur sayaç tazelemesi yapar
  hâle geldi (araca komut gönderilmez), (2) hüküm elindeki veriyle çelişiyordu → yeni
  `NO_NATIVE_EVIDENCE_JS_ALIVE` kodu, (3) `lastPollAt`/`lastSuccessfulPid` native yanıtta
  varken anlık görüntüye taşınmıyordu → taşındı. **Cihazda doğrulanmadı** (kütük #109).
  Durum: **ENTEGRE**.
  **Faz A2 (Raw OBD Traffic Inspector)** üstüne geldi: TX/RX/SYSTEM/ERROR sınıflandırma
  (yalnız gerçek veriden türetilir), yön + metin filtresi, PAUSE/CLEAR/maskeli EXPORT.
  Native olayda bulunmayan protokol/oturum/transport alanları **uydurulmadı**. Tam suite
  **6887 yeşil (359 dosya)**, +68 kilit. **Cihazda doğrulanmadı** (kütük #92).
  **Faz A3 (Session Inspector)** eklendi: 6 katmanlı salt-okunur oturum görünümü,
  OBSERVED/DERIVED/UNAVAILABLE/STALE sınıflandırması, SOURCE MISMATCH bölümü ve
  fail-closed genel özet. Yeni session engine/store YAZILMADI; yalnız mevcut senkron
  getter'lar okundu. Kaynağı olmayan alanlar (poll kadansı · kuyruk · keep-alive) ve
  yazıcısı olmayan ölü debugStore alanları UNAVAILABLE olarak beyan edildi. Tam suite
  **6941 yeşil (360 dosya)**, +54 kilit. **Cihazda doğrulanmadı** (kütük #93).
  **Faz A4 (Runtime Scheduling Inspector)** eklendi: Queue Monitor + Poll Scheduler ortak
  salt-okunur görünümü; 6 AYRI runtime otoritesi birleştirilmeden ayrı kanal olarak
  gösterilir. Yeni scheduler/queue/motor YAZILMADI, production instrumentation EKLENMEDİ.
  Beşinci gözlemlenebilirlik sınıfı **UNSAFE_TO_OBSERVE** eklendi (yan etkili getter
  okunmaz). Kuyruk derinliği · poll kadansı · keep-alive UNAVAILABLE; özet fail-closed
  (ACTIVE/PARTIAL/IDLE/BLOCKED/UNKNOWN, "timer var" ACTIVE saydırmaz). Tam suite
  **6999 yeşil (361 dosya)**, +58 kilit. **Cihazda doğrulanmadı** (kütük #94).
  **Erişilebilirlik + tema turu (2026-07-25)** eklendi: (a) CAROS LAB kısayolu artık
  **dört tema dock'unun tamamında** (Pro · Expedition · Tesla · Horizon) — AppGrid kartı
  ve `DockBar` ile AYNI fail-closed kapının arkasında (o tarihte `DEBUG_ENABLED &&
  canDebug`; kapı 2026-07-26'da `DEVELOPER_FEATURES_ENABLED`'a dönüştü — aşağıya bak),
  her dock'un EN SONUNDA (sürücü akışındaki kısayolların sırası değişmez). Yeni
  entitlement/route/registry YOK — tek giriş noktası `openCarosLab()`. (b) **SAHA
  BULGUSU:** CAROS LAB aydınlık temada SİYAH kalıyordu — shell ve 8 araç ekranının
  tamamı sabit renk (`bg-[#070b12]`, `text-white/xx`, `border-white/xx`, tailwind
  `*-500/xx` paletleri) kullandığı için hiçbir tema değişkenine abone DEĞİLDİ ve
  `html.light-ui` flip'i onlara ulaşmıyordu. Tüm ağaç `--oem-*` token'larına taşındı
  (yeni palet katmanı YOK); en soluk mürekkep `--oem-ink-3` (ink-4 α .34 güneşte
  okunmuyor), marka aksanı cyan yerine `--oem-info`. Tam suite **7045 yeşil (364 dosya)**,
  regresyon kasasına 3 yeni kilit (kaynak taraması: devtools ağacında sabit renk yasak).
  **Cihazda doğrulanmadı** (kütük #103).
  **Türkçeleştirme turu (2026-07-25)** eklendi: arayüzün tamamı (5 kategori · 26 araç adı ·
  tüm durum/sınıf rozetleri · ekran metinleri) Türkçeye çevrildi. Ham enum'lar
  (`AVAILABLE`·`OBSERVED`·`FOUNDATION_ONLY`…) **makine sözleşmesi** olarak `data-*`
  özniteliklerinde korunur → dürüstlük kilitleri dile bağımlı DEĞİL. Protokol kısaltmaları
  (PID·DID·NRC·KWP·UDS·TX·RX) ve kod alan adları FAZ A politikası gereği çevrilmedi.
  Aynı turda #103'ün **eksik kapsamı düzeltildi**: LAB'ın yeniden kullandığı 4 ekran
  (Performans · Kayıt Oynatma · CAN İzleyici · Keşif Veritabanı) devtools ağacının dışında
  olduğu için tema düzeltmesine girmemişti — token'landı ve kilide eklendi. Tam suite
  **7050 yeşil (364 dosya)**, +2 dil kilidi. **Cihazda doğrulanmadı** (kütük #104).
  **TÜMÜNÜ KOPYALA (2026-07-25)** eklendi: LAB başlığındaki tek düğme katalog · oturum ·
  zamanlama · kanıt · ham OBD/CAN · keşif verisini TEK maskeli metinde panoya kopyalar.
  Salt-okunur (yeni servis/abonelik/timer/native pull YOK), 3 maskeleme kapısı HER
  bölümde, fail-closed (maskelenemeyen kayıt düşer + sayısı beyan edilir), bounded
  (200 satır/bölüm · 180k karakter), pano 3 kademeli fail-soft — üçü de düşerse sahte
  "kopyalandı" DEMEZ, seçilebilir metin gösterir. İlk yazımda `maskCommonSecrets`
  yalnız OBD bölümüne uygulandığı için KANITLAR'daki bearer token'ı ham sızdıran kusur
  **testle yakalandı** ve düzeltildi. Tam suite **7064 yeşil (365 dosya)**, +14 kilit.
  **Cihazda doğrulanmadı** (kütük #105).
  **KWP İzleyici gerçek ekran (Faz A4, 2026-07-26)** eklendi: `kwp-monitor` PLACEHOLDER
  durumundan **AVAILABLE**'a geçti. Native KWP kurtarma merdiveninin (ATPC) sayaçları
  şimdiye kadar LAB'da HİÇ görünmüyor, yalnız Kanıt Görüntüleyici'deki `recovery.*`
  satırlarından dolaylı okunabiliyordu. Yeni ekran 4 bölümlüdür (Protokol/Uygulanabilirlik ·
  Oturum Sağlığı · Kurtarma Merdiveni · Keep-Alive) ve TAMAMEN SALT-OKUNURDUR: kurtarma
  NATIVE'dedir, ekran onu ne tetikler ne durdurur. Native/OBD/recovery/polling koduna
  DOKUNULMADI; yeni servis, abonelik, timer veya global store kurulmadı. Gözlemlenebilirlik
  ilkelleri Session Inspector modelinden yeniden kullanıldı — paralel sınıflandırma yok.
  **Dürüstlük kararları:** ATWM/ATSW/ATST JS'e açılmamıştır (yalnız native
  `ElmInitSequencer`) → dört alan da KAYNAK YOK; native sabitleri ekrana kopyalamak
  ölçülmemişi ölçülmüş göstermek olurdu. `lastRecoveryAt=0` "hiç kurtarma yok" demektir,
  epoch 0 tarihi DEĞİL; `lastRecoveryToFirstPidMs=-1` "ölçülmedi" demektir, -1 ms değil;
  kanıt yoksa sayaçlar 0 UYDURULMAZ ve hüküm FAIL-CLOSED kalır (BİLİNMİYOR ≠ sağlıklı).
  Periyodik yenileme YOKTUR (repo deseni: tek atış senkron okuma + elle YENİLE).
  36 yeni kilit (model · sentinel · fail-closed hüküm · katalog · render · zero-leak ·
  sabit-renk yasağı). **Cihazda doğrulanmadı** (kütük #112). Durum: **ENTEGRE**.
  **Araç Parmak İzi gerçek ekran (Faz A5, 2026-07-26)** eklendi: `vehicle-fingerprint`
  PLACEHOLDER'dan **AVAILABLE**'a geçti. Araç kimliği ve keşif kanıtları şimdiye kadar
  dört ayrı modülde dağınıktı; artık tek geliştirici ekranında toplanıyor (Araç Kimliği ·
  ECU Keşfi · Desteklenen Veriler · Kanıt Sağlığı). **ARACA SORGU GÖNDERMEZ:**
  `discoveryFingerprint.getVehicleFingerprint()` bilerek KULLANILMADI — o fonksiyon
  gerçek bir UDS isteği (DID F190) gönderiyor; keşif deposu anahtarı bunun yerine ZATEN
  KAYITLI VIN'den saf `hashVin()` ile YEREL olarak türetiliyor, araç trafiği sıfır.
  Native/OBD/keşif koduna DOKUNULMADI; yeni servis, abonelik, timer veya store kurulmadı.
  Gözlemlenebilirlik ilkelleri Session Inspector modelinden yeniden kullanıldı.
  **Gizlilik:** ham VIN, plaka ve adaptör MAC kaynak katmanından DIŞARI ÇIKMIYOR — model
  sözleşmesinde `vin`/`metadata` alanı YOK; yalnız geri çevrilemez `hash` ve `vinHash`
  gösteriliyor. **Dürüstlük:** hash yoksa üretilmiyor, damga yoksa "şimdi" yazılmıyor,
  `null` (kaynak yok) ile `[]` (çalıştı, boş) ayrı sınıflandırılıyor; `getAutoDiscoveredDids()`
  bu ayrımı VEREMEDİĞİ için boş dizide hüküm KURULMUYOR. Kanıt sağlığı fail-closed:
  kimlik kaydı yoksa hiçbir koşulda HAZIR denmiyor. Listeler bounded, kesilen kuyruk
  toplam sayıyla beyan ediliyor. 42 yeni kilit (katalog · screen-map · tam/kısmi/boş
  kaynak · VIN sızıntısı yasağı · bounded liste · sentinel ve damga dürüstlüğü ·
  timer/komut/native import yasağı · zero-leak · sabit-renk yasağı).
  **Cihazda doğrulanmadı** (kütük #113). Durum: **ENTEGRE**.
  **Adaptör Tanılama gerçek ekran (Faz A6, 2026-07-26)** eklendi: `adapter-diagnostics`
  PLACEHOLDER'dan **AVAILABLE**'a geçti. ELM327/Bluetooth taşıma sağlığı, OBD oturum
  bayrakları ve bağlantı yaşam döngüsü sayaçları tek salt-okunur ekranda toplandı
  (Transport · OBD Oturumu · Yaşam Döngüsü · Kaynak Sınırları). **AT/OBD KOMUTU
  GÖNDERMEZ** (adaptör kimlik sorgusu ATI/ATZ dahil), reconnect/reset/recovery
  tetiklemez; native/OBD koduna DOKUNULMADI. Yedi mevcut senkron getter okunur, hepsi
  try/catch içinde.
  **Asıl kazanım — İKİ SAĞLIK MOTORUNUN ÇELİŞKİSİ GÖRÜNÜR OLDU:** `obdService` ADAPTİF
  tazelik penceresi, `ObdHealthMonitor` ise MUTLAK 4 sn donma eşiği kullanır; bu ikisi
  şimdiye kadar tek gerçekmiş gibi algılanıyordu. Artık ayrı alanlarda gösteriliyor ve
  zıt olmadıklarında ekran açıkça "ÇELİŞKİ" diyor — hangisinin haklı olduğu ekranda
  KARARA BAĞLANMIYOR.
  **Dürüstlük:** `-1` sentinel'i sayı gibi basılmıyor (`lastPacketAgeMs=-1` → "hiç paket
  yok"; `connectionQuality=-1` → "hiç bağlanılmadı"; ikisi de "0" DEĞİL), `0` sayaç ile
  KAYNAK YOK ayrılıyor, damga yoksa "şimdi" yazılmıyor. **Fail-closed:** `connected=true`
  tek başına SAĞLIKLI üretmiyor — hüküm ancak oturum kaynağı okunup `sessionReady`
  dediğinde HEALTHY oluyor (bu kural, yazarken testin yakaladığı GERÇEK bir model
  hatasından sonra eklendi). **Gizlilik:** adaptör adı/adresi/seri numarası kaynak
  katmanından çıkmıyor; yalnız "kayıtlı (gösterilmez)" varlık beyanı var.
  **Kaynak sınırları dürüstçe beyan edildi:** RSSI · native buffer doluluğu ·
  klon/orijinal hükmü · gelişmiş BLE tanısı (MTU/GATT) · firmware/seri no için JS
  getter'ı YOK → beşi de KAYNAK YOK. 48 yeni kilit.
  **Cihazda doğrulanmadı** (kütük #114). Durum: **ENTEGRE**.

  **Giriş odağı — Kuyruk İzleyici / Sorgu Zamanlayıcı (UX-F1, 2026-07-26):** iki katalog
  girdisi **ORTAK** `RuntimeSchedulingScreen` ekranını paylaşmaya devam eder, fakat giriş
  yapılan araç kimliğine göre **başlangıç odağı** farklıdır: `queue-monitor` → *1 · Komut
  Yürütme*, `poll-scheduler` → *2 · Canlı Sorgulama* (`live-polling`) ilk sırada ve
  BİRİNCİL ODAK rozetiyle. Bağlam ekran eşlemesinden **dar tipli prop** olarak geçer
  (`SchedFocusContext`); sıralamayı **SAF** `orderChannelsForFocus()` yapar.
  **YENİ ekran / route / state sistemi YOK**, katalog aracı silinmedi/birleştirilmedi.
  **Sınır:** hiçbir kanal gizlenmez — 6 kanalın tamamı iki girişte de görünür, kalan 5
  kanalın göreli sırası AYNEN korunur ve bağlam verilmezse ESKİ varsayılan sıra geçerlidir
  (geriye uyumlu). Sıra **yalnız gösterimdir**: ham değer, sınıflandırma, kanal aktivitesi
  ve runtime hükmü girişten bağımsızdır. İmperative scroll · DOM erişimi · timer · listener
  · abonelik YOK. 22 yeni kilit. **Cihazda doğrulanmadı** (kütük #115). Durum: **ENTEGRE**.

  **Mavi Konsolu gerçek ekran (Faz A7, 2026-07-26)** eklendi: `mavi-console`
  PLACEHOLDER'dan **AVAILABLE**'a geçti. Mavi sesli asistanın RAM durumu tek salt-okunur
  ekranda toplandı (Yaşam Döngüsü · Son Teşhis Aşamaları · AI Sağlığı · Sağlayıcı Soğuma).
  **DİNLEME/TTS BAŞLATMAZ**, AI sağlayıcısına istek atmaz, komut dispatch etmez,
  retry/reset tetiklemez; native/Java koduna DOKUNULMADI. Dört mevcut senkron getter
  okunur, her biri AYRI try/catch içinde — dördü birden fırlatırken bile ekran ayakta
  kalır (davranışsal kilitle ölçüldü).
  **Asıl kazanım — GİZLİLİK YAPISAL HÂLE GETİRİLDİ:** transcript metni, `lastCommand`,
  konuşma geçmişi, öneri metinleri ve ses hatası MESAJI kaynak katmanından ÇIKMAZ; ham
  snapshot tipinde bu alanlar **YOKTUR**, yalnız VAR/YOK bayrağı ve ADET taşınır. Yani
  sızıntı "dikkat edilerek" değil, **tip olarak** engellenir. Kopyalama butonu yoktur.
  **Dürüstlük:** halka BOŞ (`[]`) ile OKUNAMADI (`null`) ayrıdır; damgasız kayda "şimdi"
  yazılmaz; sağlayıcı soğumaları (Gemini · Groq · Haiku) AYRI kalır, tek toplama
  indirgenmez (2026-07-04 "çapraz kirlenme" saha dersi korunur); `throttled` ve repoda
  tanımsız her durum HAZIR ilan EDİLMEZ — tahmin yasak.
  **Beyan edilen sınır:** `getAiHealthSnapshot()` tam saf değildir (vadesi dolmuş devre
  kesici penceresini kapatan yarı-açık geçiş) — gizlenmedi, ekranda ve kütükte yazılı.
  51 yeni kilit. **Cihazda doğrulanmadı** (kütük #116). Durum: **ENTEGRE**.

  **Geliştirici erişim kapısı: ROL → BUILD (2026-07-26).** Kapı `DEBUG_ENABLED &&
  canDebug` idi; test APK'sını kuran her cihaz varsayılan `driver` rolüyle açıldığı ve
  `canDebug` yalnız technician/admin/super_admin'de bulunduğu için **geliştirici
  yüzeyleri görünmüyordu** — rolü elle yükseltmek ya da localStorage taşımak
  gerekiyordu. Ürün gerçeği bunu gereksiz kılıyor: CAROS PRO hâlâ **geliştirme + aile
  içi saha testi** aşamasında, Play Store/genel dağıtım YOK.
  Artık TEK derleme-zamanı otoritesi var: `platform/debug/developerFeatures.ts →
  DEVELOPER_FEATURES_ENABLED`. Aynı karar önce ÜÇ dosyada yeniden hesaplanıyordu;
  üçü de artık bu sabiti import ediyor (`DEBUG_ENABLED` geriye uyumlu takma ad).
  **Menü kapısı ve doğrudan route/render kapısı AYNI kararı kullanır.**
  **Kapı silinmedi, dönüştürüldü:** fail-closed davranış korunur; `canDebug` izni rol
  modelinden SİLİNMEDİ (satış sonrası mühendis modu için) ve normal yetkiler
  değişmedi. **Ölçüldü (build çıktısında, cihazda DEĞİL):** bayrak kapalı gerçek
  `vite build` → `developerFeaturesEnabled:!1`, kapı KAPALI.
  **Dürüstçe beyan edilen sınır:** kapı kapalıyken bile LAB/DebugPanel chunk'ları
  APK'da bulunur (koşulsuz lazy import) — gerileme değil, ama "kod pakette yok"
  denemez; sertleştirme ayrı tur. Satış öncesi kapatma adımları:
  `docs/RELEASE_CHECKLIST.md`. 24 yeni kilit. **Cihazda doğrulanmadı** (kütük #117).

  **Çözücü Kayıtları gerçek ekran (Faz A8, 2026-07-26)** eklendi: `decoder-registry`
  PLACEHOLDER'dan **AVAILABLE**'a geçti. Repoda KAYITLI çözücü tanımları tek salt-okunur,
  aranabilir envanterde toplandı: **82 standart PID · 30 üretici DID · 4 profil · 4 marka**.
  **ARAÇ TARAMA EKRANI DEĞİLDİR** — OBD/AT komutu göndermez, ECU sorgulamaz, PID/DID
  keşfi başlatmaz, bağlantı/polling/reconnect tetiklemez, native çağrı ve ağ isteği
  yapmaz, timer kurmaz; native/Java koduna DOKUNULMADI.
  **Asıl kazanım — SESSİZ DERLEME DAVRANIŞI GÖRÜNÜR OLDU:** profil derleyicisi haritayı
  YALNIZ kimlikle anahtarlar → aynı profilde aynı kimlik iki kez tanımlıysa **SON yazan
  kazanır** (ECU farkı bunu ÖNLEMEZ) ve ECU referansı çözülemeyen DID **sessizce atlanır**.
  Ekran ikisini de ÜZERİNE YAZILDI / DERLEMEDE DÜŞTÜ olarak gösterir. Farklı
  profillerdeki aynı kimlik **çakışma sayılmaz** (repo aynı anda tek profil yükler,
  profiller birleşmez) — ayrı sayaçta bilgi amaçlı durur.
  **Dürüstlük:** üretici DID'lerinde çözücü sınıfı ve formül özeti VERİDEN üretilir
  (decode.fn + katsayı) → kesindir; standart PID'lerde çözücü bir JS kapanışıdır,
  makine-okunur spec YOKTUR → sınıf ÖZEL, formül "—" (uydurulmaz). "Rol" alanı kayıt
  defterindeki yeri anlatır, **aracın desteğini DEĞİL**.
  **Gizlilik:** çözücü fonksiyon referansı katmandan çıkmaz, gövdesi hiçbir yöntemle
  okunmaz (`toString`/`eval`/`new Function` kod tabanında yok — kilitli); VIN, parmak izi
  ve çalışma-zamanı ECU cevabı modele girmez. Registry'ye **canlı referans verilmez**
  (primitif kopya) → model registry'yi değiştiremez.
  Yazarken iki gerçek hata kendi testlerimiz tarafından yakalandı ve düzeltildi: (1) bozuk
  kayıt modelde çökme üretiyordu, (2) Türkçe arama sessizce başarısızdı
  (`'DEVRİ'.toLowerCase()` → `i` + birleşen nokta). 56 yeni kilit.
  **Cihazda doğrulanmadı** (kütük #118). Durum: **ENTEGRE**.

  ### 👁️ Zorunlu Gözlemlenebilirlik Kuralı — AÇIK BORÇ KAYDI (2026-07-26)

  Kural yürürlüğe girdi: **"Gözlemlenemeyen özellik tamamlanmış değildir."** Her önemli
  özellik aynı fazda CAROS LAB salt-okunur gözlem ekranıyla birlikte biter (tam metin:
  `CLAUDE.md` → "ZORUNLU GÖZLEMLENEBİLİRLİK KURALI"). Kural **geriye dönük** uygulandığında
  bugün şu boşluklar vardır — bunlar "tamamlandı" diye SUNULMAZ:

  | Alt sistem | Durum | Eksik gözlem yüzeyi |
  |---|---|---|
  | Geliştirici erişim kapısı (`DEVELOPER_FEATURES_ENABLED`) | Uygulandı, LAB ekranı YOK | Bayrağın etkin değeri, hangi yüzeylerin açık olduğu, satış build'i fail-closed durumu |
  | AI kimlik bilgisi akışı (QR Key Beam + pano otomatik algılama) | Uygulandı, LAB ekranı YOK | Sağlayıcı başına anahtar VAR/YOK (**anahtarın kendisi ASLA**), son beam sonucu, pano algılama durumu |
  | Adaptif poll kadansı / tazelik kapısı | Uygulandı, kısmen kör | Çalışma Zamanı ekranında `pollCadence` KAYNAK YOK — hesaplanan profil hiçbir yerde saklanmıyor |
  | Kurtarma merdiveni (`recovery-monitor`) | Motor var, ekran PLACEHOLDER | Kurtarma durumu yalnız Çalışma Zamanı kanalında özet olarak görünüyor |
  | Derin Tarama (`deep-scan`) · UDS Explorer · Eylem Kayıtları · Araç Çağırma · Bellek/Bilgi Gezgini · Benchmark | Ekran PLACEHOLDER | Kendi gözlem ekranları yok |
  | **Adres sağlayıcı katmanı (`geocodingProviders` · BYOK)** | ✅ **KAPATILDI (2026-08-11, kütük #543)** — LAB ekranı **Adres Arama Kanıtı** (`address-search-evidence`) açıldı | Borç kapandı: cevabı ÜRETEN katman (premium/Nominatim/gevşetilmiş/Overpass/cihaz-içi/önbellek), kullanıcının SEÇİP SEÇMEDİĞİ, başarısızlık sebep sınıfı + `confidence`, iki yüzeyin ayrışması ve eksik kanıt sayacı artık sahada GÖRÜNÜYOR. **Gizlilik sınırı korundu:** sorgu metni hiç saklanmıyor (yalnız `AddressQueryShape` bayrakları), anahtar değeri ve koordinat taşınmıyor. **Kalan borç (ölçüldü, düzeltilmedi):** ürün "veri OSM'de var mı" sorusunu SORMUYOR → `GROUND_TRUTH` kanıt boşluğu; sorgunun ayrıştırıcıda bozulup bozulmadığı ölçülmüyor → `QUERY_INTEGRITY` boşluğu. |
  | **Servis kalp atışı izleyicisi (`SystemHealthMonitor`)** | **Motor var + `getHeartbeatEvidence()` export'u var, LAB ekranı YOK** | Servis başına **beat yaşı · eşik · saat tabanı · alarm/recovered sayısı** hiçbir LAB ekranında gösterilmiyor; `LongRoadFieldValidationScreen` yalnız türetilmiş "GPS kaybı olayı / en uzun kayıp" sayaçlarını gösteriyor. Sonuç: sahte alarm ile gerçek kesinti **ancak `cl_crash_log` ham kaydı elle okunarak** ayrılabildi (2026-08-02, kütük #327). Borç bu turda KAPATILMADI — GPS beat kaynağı DEĞİŞİM'den VARIŞ'a taşındı ama gözlem yüzeyi hâlâ yok. |

  Katalog kapsamı bugün: **41 AVAILABLE · 7 PLACEHOLDER · 2 DISABLED** (50 araç)
  — sayılar `carosLabCatalog.ts`ten SAYILDI (2026-08-11). Buradaki eski
  "18 · 8 · 2 (28)" ifadesi koddan sapmıştı: elle artırılan bir sayı sessizce
  yanlışlaşır, o yüzden bir daha artırma — SAY.
  Bu tablo bir yol haritasıdır; kapatılan her satır ilgili PR'da işaretlenir.

  ### 📱 PHONE-HUB P0.5 — Donanım Keşfi ve Üretici Sondası (2026-07-26)

  Phone Hub mimarisi **dondurulmadan önce** head unit'in gerçekte ne bildiğini ölçen
  **salt-okunur** teşhis altyapısı eklendi (`phone-hub-probe`, İletişim kategorisi).
  Native sonda + tek `@PluginMethod` + TS köprüsü + LAB kaynak/model/ekran aynı atomik
  turda tamamlandı (zorunlu gözlemlenebilirlik kuralı).
  **Bu faz yetenek EKLEMEZ, hiçbir kullanıcı davranışı ÜRETMEZ:** keşif/tarama,
  eşleştirme, soket/GATT, adapter aç-kapat, SCO, ses yolu değişimi, medya tuşu, çağrı,
  izin isteği, vendor bind/broadcast ve OBD müdahalesi YOKTUR — **19 yasak çağrı dizesi
  statik güvenlik testiyle kilitlendi**.
  **Asıl kazanım — YETENEK VARSAYIMI KIRILDI:** bağlantı DURUMU ile kontrol OTORİTESİ
  artık ayrı alanlar. Depoda A2DP Sink/HFP yığınını yöneten kod YOKTUR, bu yüzden otorite
  **asla ANDROID_APP olamaz** ve "destekleniyor" iddiası yalnız *cihazdan gözlenmiş kanıt +
  uygulama otoritesi* birlikteyken açılır — **bugün her ikisi için de HAYIR**.
  **Dürüstlük:** BT kapalıyken profil "DISCONNECTED" diye uydurulmaz (UNAVAILABLE);
  `-1` sentinel'leri 0 gibi basılmaz; damga yoksa "şimdi" yazılmaz ve durum AVAILABLE
  olmaz; GATT için güvenilir salt-okunur API YOK → UNAVAILABLE; vendor **yayın** gözlemi
  için depoda sayaç/damga altyapısı YOK → "gözlendi" DENMEZ (yeni izleyici eklemek bu
  salt-okunur fazın kapsamı dışıdır).
  **Gizlilik yapısal:** MAC · cihaz adı · telefon modeli · kişi adı · numara · medya
  başlığı · token taşıyan alan YOKTUR; adapter adı için bile yalnız "var mı".
  **Beyan edilen kapsam sınırı:** depoda Robolectric/Mockito YOKTUR → Android'e dokunan
  okuma yolları düz JUnit'te koşulamaz; saf sınıflandırma (16 native test) ve statik
  güvenlik test edilmiştir, gerçek okuma davranışı **yalnız cihazda** doğrulanabilir.
  49 yeni TS kilidi + 16 native kilit. **Cihazda doğrulanmadı** (kütük #119).
  Durum: **ENTEGRE**.

  ### 📱 PHONE-HUB P0.7 — saha turu ÖN KOŞULDA DÜŞTÜ (2026-07-26)

  Gerçek head unit kanıtı toplanmak istendi; `adb devices` tek cihaz gösterdi ve o cihaz
  **Xiaomi/Redmi telefonuydu** (`zircon`, Android 13/SDK 33, MediaTek `mt6886`).
  Ölçüm **başlamadan durduruldu** — telefonda alınan veri head unit otoritesi üretemez.
  **Kanıt:** 112 sistem özelliği içinde otomotiv/car eşleşmesi **sıfır**; 400 paket
  içinde vendor CAN/MCU/car-setting paketi **yok**; `com.android.car` **tam eşleşme
  FALSE** ve `/system/framework` içinde CarService kütüphanesi yok.
  **Kayda geçen ders:** ilk geniş desen taraması `android.car` için "VAR" dedi — eşleşen
  paketler yalnızca `com.android.carrierconfig` ve akrabalarıydı. Bu **substring
  yanlış-pozitifi** raporu kirletmeden yanlışlandı ve P0.8'de **tam eşleşme zorunluluğu**
  olarak koda + teste kilitlendi.
  **Sonuç:** P0.6'nın **8 blocker'ının 8'i açık**; dört otorite **UNKNOWN**; coexistence
  **gözlenmedi**. `docs/phoneHubFieldValidation.json` dosyasına HEAD_UNIT kaydı
  **bilinçli olarak EKLENMEDİ** (kanıtsız kayıt yazmak fail-closed kuralının ihlali olurdu).
  Durum: **YOK** (ölçüm yapılamadı).

  ### 📱 PHONE-HUB P0.8 — CAROS LAB Saha Doğrulama Aracı (2026-07-26)

  P0.7'nin düşmesi bir araç eksikliğini de gösterdi: saha ölçümü **ad-hoc adb
  komutlarına** bağlıydı. Bu tur, araç geldiğinde ölçümü **tekrarlanabilir ve güvenli**
  biçimde yürütecek aracı kurdu (`phone-hub-field-validation`, İletişim kategorisi).
  **P0.5 ekranı SİLİNMEDİ** — LAB'da artık iki ayrı araç var: *Hardware Probe* (anlık
  donanım gözlemi) ve *Saha Doğrulama* (senaryolu kanıt defteri).
  **Bu tur gerçek head unit sonucu ÜRETMEZ** — yalnız aracı hazırlar; hazırlık durumu
  araçsız doğal olarak **NOT_READY**'dir ve **P1-A BAŞLATILMAZ**.

  **Ne eklendi:** native saf snapshot + salt-okunur sonda · AYRI `@PluginMethod`
  (P0.5 sözleşmesi ve şema sürümü aynen korundu → geriye uyumlu) · TS köprüsü ·
  saf model (5 senaryolu durum makinesi, 4 otorite karar motoru, coexistence hükmü,
  7 koşullu readiness, PII süzgeci, şema göçü) · tek okuma katmanı (P0.5'in donanım
  okuyucusunu **yeniden kullanır**, paralel sistem kurmaz) · yerel kalıcılık · ekran.

  **Asıl kazanım — ROL KAPISI:** `android.hardware.type.automotive` **yokluğu tek
  başına head unit olmadığını KANITLAMAZ** (aftermarket üniteler sıradan Android tablet
  yapısında olabilir). Bu yüzden **birleşik kanıt modeli** kullanılır: sinyaller toplanır,
  hiçbiri veto etmez. ≥2 bağımsız teknik sinyal → doğrulandı (yüksek güven); 1 sinyal +
  kullanıcı onayı → doğrulandı (yalnız **orta** güven); **0 teknik sinyal + onay →
  yükseltme YOK** — kullanıcı onayı teknik kanıtın yerine geçmez, yalnız bir kanıt
  kaydıdır. Cihaz **telefon** teşhis edilirse saha aşamaları kilitlenir, ölçüm BLOCKED
  yazılır ve dört otorite UNKNOWN kalır.

  **Authority dürüstlüğü:** tek zayıf paket eşleşmesi otorite kanıtı **sayılmaz**;
  profil/servis **varlığı** otorite kanıtı **değildir** (telefon bağlıyken CONNECTED
  gözlemi şart); çelişkili kanıt → **HYBRID**; kanıt yok → **UNKNOWN**.
  **Açık borç dürüstçe beyan edildi:** A2DP/HFP profil proxy'si bind sızıntısı riski
  nedeniyle **bilinçli olarak açılmadı** (P0.5 BLOCKER-8 hâlâ açık) ve MediaSession
  listesi etkin bir NotificationListener istediği için bu fazda **izin istenmez** →
  çoğu cihazda erişim DENIED kalacak; ikisi de sabit hata kodu + blocker olarak görünür,
  sessizce atlanmaz.
  **Gizlilik yapısal:** paket adı, ham fingerprint, parça/sanatçı/albüm adı, MAC, numara
  taşıyan alan yoktur (dialer ve oturum sahibi yalnız **sınıfa** çevrilir); diske yazımda
  ve dışa aktarımda **ikinci** bir PII süzgeci uygulanır. Kayıt **yalnız yereldir** —
  uzak sunucuya gönderim yoktur.
  79 yeni TS kilidi + 22 yeni native kilit (P0.5'in 16 testi bozulmadı).
  **Cihazda doğrulanmadı** (kütük #120). Durum: **ENTEGRE** · **ÜRÜN HAZIR: HAYIR**.

  ### 📱 PHONE-HUB P1-PREP — Companion Foundation (2026-07-26)

  Dört otorite hâlâ UNKNOWN olduğu için bir taşımaya bağlanan kod yazmak, saha
  kanıtı ters çıkarsa **atılması gereken** mimari üretirdi. Bu tur o riski
  tersine çevirdi: bağlantıdan **tamamen bağımsız** Companion iskeleti kuruldu
  (`src/platform/companion/`, 16 modül).

  **Kurulan katmanlar:** Companion Domain · Connection State Machine (10 durum,
  açık geçiş tablosu) · `PhoneHubSession` + Session Manager · Capability Registry ·
  mesaj zarfı (sağlama toplamı, REQUEST/RESPONSE/EVENT/ACK) · protokol ve yetenek
  anlaşması · yerel eşleştirme güven modeli · `ConnectionTransport` sözleşmesi ·
  scriptlenebilir Mock Transport (7 senaryo) · Event Bus köprüsü (7 olay) ·
  Action Registry sözleşmesi (9 yer tutucu eylem) · telemetri · yerel kalıcılık ·
  durum dökümü. LAB'daki Saha Doğrulama ekranına **küçük salt-gözlem bölümü**
  eklendi (READY/NOT READY · SESSION · TRANSPORT).

  **En önemli kısıt — GERÇEK BAĞLANTI YOKTUR:** 9 taşıma türü BEYAN edildi,
  **yalnız MOCK uygulandı.** BLE · RFCOMM · USB · Wi-Fi Direct · TCP · vendor
  servisi · MCU köprüsü için tek satır bağlantı kodu yok; uygulanmamış taşıma her
  çağrıda `TRANSPORT_NOT_IMPLEMENTED` ile dürüstçe reddeder. `assessFoundation`
  READY dese bile **`realConnectionReady` daima false**. Native üretim kodu
  **eklenmedi** ve bu yokluk bir native testle KİLİTLENDİ — gerçek taşıma ancak
  saha kanıtından sonra (P1-A) yazılır.

  **Fail-closed omurga:** geçersiz durum geçişi reddedilir ve durum korunur
  (sessiz sıçrama yok) · gönderim yalnız CONNECTED/DEGRADED · protokol kesişimi
  boşsa bağlantı düşer, downgrade yok · yetenek kesişiminin boş olması hata
  değildir · bilinmeyen yetenek taşınır ama asla `granted` sayılmaz · yerel
  destek listesi bilinçli boş → bugün hiçbir yetenek "anlaşıldı" olamaz · bozuk
  zarf oturumu kapatmaz (sayaç artar) · nesil kapısı bayat çağrıyı reddeder ·
  **diskten dönen oturum "bağlı" olarak geri yüklenmez.**

  **Timer yok, sahiplik tek yerde:** taşımalar pull (`poll()`) modelidir; zaman ve
  kimlik üreteci enjekte edilir. Saf katmanlarda `Date.now`/`setInterval`/
  `localStorage` geçmez (testle kilitli). Gerekçe depoda gerçekten yaşanmış
  sahipsiz-timer arızasıdır.

  **"Secure" sınırı dürüstçe beyan edildi:** zarfta `encryption` alanı var ama
  şifreleme **uygulanmamıştır**; `AES_GCM`/`GZIP` gelirse reddedilir. Sağlama
  toplamı FNV-1a'dır — bütünlük sezme aracıdır, kriptografik imza değildir.

  **Testte yakalanan gerçek sızıntı düzeltildi:** yetenek `digest`'i karşı tarafın
  bilinmeyen jeton adlarını açık yazıyor ve bu özet döküme/olaya taşınıyordu →
  bilinmeyen kısım adet + geri çevrilemez karmaya indirgendi (değişim tespiti
  korundu, ad sızmıyor).

  122 yeni TS kilidi + 3 yeni native kilit. **Cihazda doğrulanmadı** (kütük #121).
  Durum: **ENTEGRE** · **ÜRÜN HAZIR: HAYIR** · **P1-A BAŞLATILMADI**
  (kütük #120'nin saha ölçütleri sağlanmadan taşıma seçimi yapılamaz).

> **Uyarı — en yüksek riskli açık test:** Tam tarama sonrası ana ekrana dönüldüğünde
> hız/RPM/coolant **hâlâ akıyor mu?** Çoklu-ECU probu `ATH1` + UDS extended session açar;
> `ATH0` restore bozulursa standart poll parser'ı **sessizce** ölür. Kod bunu korur
> (`HeaderRestoreException`, doğrulamalı+retry'li ATH0) ama **sahada kanıtlanmadı**.

---

## 7. Yapılacaklar (faz ve öncelik)

### 7.0 SIRA KURALI (BAĞLAYICI — 2026-08-09)

> **Bir seferde BİR yarım iş tamamlanır ve gerçek araçta kanıtlanmadan sıradakine
> geçilmez.**

Bu kural bir tercih değil, **bu projenin ölçülmüş dersidir**: kütükteki 384
kırmızı satırın büyük bölümü paralel başlatmaktan doğdu. Her biri tek başına
doğru yazılmıştı; hiçbiri sonuna kadar götürülmedi. Bir işi %90 bitirip
sıradakine geçmek, %0 yapmaktan **daha pahalıdır** — çünkü yarım iş bakım
maliyeti üretir, okuyucuyu yanıltır ve "var" sanıldığı için yeniden yazılmaz.

**Uygulama:**
- Yeni bir parça, önündeki parça kütükte 🟢 olmadan **başlatılmaz**.
- Bir parçanın önkoşulu (veri kaynağı · lisans · araç · başka bir düzeltme)
  sırası geldiğinde hâlâ yoksa, o parça **başlatılmaz** ve sıradakine
  **atlanmaz** — önkoşul işi sıraya alınır.
- "Test yeşil + tsc temiz" bir parçayı bitirmez; kabul ölçütü kütüktedir.

**Yürürlükteki sıra (2026-08-09):**

```
#491 (ağsız hüküm)  →  GPS / G1  →  Trip Cost  →  Guardian AI
```

| Sıra | Neden burada |
|---|---|
| **#491** | ADR-286 karar omurgasının çevrimdışı çalıştığı cihazda henüz gösterilmedi. Kanıtlanmamış omurganın üstüne yeni karar katmanı eklenmez. |
| **GPS (G1)** | Guardian'ın konum tabanlı kurallarının yarısı GPS düzelmeden **matematiksel olarak** bitirilemez (p50 19,5 s bayat fix = 94 km/h'de ~509 m körlük). Bkz. şartlı kilit **#508**. |
| **Trip Cost** | **Filo müşterisine satılacak ilk somut şey.** Araç gerektirmez, çıktısı bir rakamdır, müşteri kendi muhasebesiyle doğrulayabilir. |
| **Guardian AI** | En pahalı kanıt onunki: gerçek araç + gerçek yol + gerçek hava + tekrarlanabilir senaryo. |

Parça bazlı eksikler, önkoşullar, iş tahminleri ve satış kanalı eşlemesi:
**`docs/TAMAMLAMA_PLANI_2026-08-09.md`**.

**Fiyat kaynağı ilkesi (2026-08-09, bağlayıcı — Trip Cost ve benzeri her özellik için):**

> **Ürün hiç kullanıcı girdisi olmadan da çalışır.** *"Fiyatları sen gir"* demek,
> özelliği kullanıcıya tamamlatmaktır; çoğu kişi girmez ve **gömülü satışta özellik
> ölü doğar**. Kullanıcı girdisi **ZORUNLULUK değil, İYİLEŞTİRMEDİR**.

- **Varsayılan dolu gelir ya da kalem hiç doğmaz** — kullanıcıya soru sorularak
  boşluk kapatılmaz.
- **Sistem kalemi kendiliğinden EKLEMEZ:** rota plajın/müzenin yanından geçiyor
  diye ücret kalemi doğmaz. Ya kullanıcı söyler, ya kalem yoktur. Rota
  yakınlığından ihtiyaç türetmek (niyet okuma) **yasaktır**.
- **Veri toplama yasağı:** rezervasyon/fiyat sitelerinden **otomatik veri
  çekilmez**. İzin verilen üç yol: **resmî kaynak** (TÜİK · KGM) · **elle
  derlenmiş kendi tablomuz** (kaynağı + tarihi beyanlı) · **kullanıcı beyanı**.
- **Sunum:** kullanıcıya **yalnız güncellenmiş TL** gösterilir (*"Mersin 1 gece
  ~2.800 TL, tahmini"*). **Endeks, yüzde ve hesap kullanıcıya ASLA görünmez**
  (LAB'da geliştiriciye açık kalır — gizleme değil sadeleştirme).
- **Etiket:** tablo kaynaklı kalem **"tahmin"**dir, **"ölçüm" değildir**
  (`CostItemSource`'a `'estimate'` eklenecek; LAB'da `DERIVED`, `OBSERVED` değil).
- **Kalemler VERİ olacak, KOD değil:** yeni kalem eklemek kod değişikliği
  gerektirmez (PID Pack / RulePack deseni — kaynağı ve lisansı beyanlı paket).
- **Çevrimdışı:** benzin canlı; HGS/otel/otopark tabloları **paket hâlinde
  cihazda**, ayda bir tazelenir. Ağ yoksa kalem ölmez, yalnız `stale` olur.

**Silme kararları iptal (2026-08-09):** Guardian AI ve Trip Cost **tamamlanacak**.
`SPEED_CAMERA_WARNING` kuralı kalır ama **veri gelmez** — boş yuva olarak
tasarlanır (veriyi üretici/filo müşterisi kendi lisansıyla takar; PID Pack
deseni). Yuva boşken kural **hiç çalışmaz**, sessizce "risk yok" demez.
*(⚠️ Bu hüküm **2026-08-13'te ezildi** — aşağıdaki "🟡 BOŞ YUVA KARARI DEĞİŞTİ"
bölümüne bakın: yuva EGM paketiyle dolduruldu. Tarihsel kayıt olarak bırakıldı.)*

**🔎 BOŞ YUVA KARARI ÖLÇÜMLE DOĞRULANDI (2026-08-13 — `docs/ADR_RADAR_DATA_SOURCE.md`):**
Ücretsiz tek aday olan **OSM gerçek Overpass sorgularıyla ölçüldü**: TR sınırı içi
**730** `highway=speed_camera` + **30** `enforcement` ilişkisi. Kapsam şehre göre
uçurum: İstanbul **182**, Mersin ili **4**, **Adana ili 0**, ve saha rotamızın
kalbi **Mersin merkez→Tarsus koridorunda 0**. Etiket kalitesi karar üretmeye
yetmiyor: yön **%32**, hız limiti **%48**, kamera tipi **%0,2**; medyan kayıt
tazeliği **~2,7 yıl**, verinin %26'sı tek gönüllüde. **Karar: OSM taban katmandır,
birincil kaynak DEĞİLDİR** — yuva ikinci kaynak (ticari lisans / müşteri paketi)
gelmeden **doldurulmaz**; kısmi veriyle uyarı vermek P0 "yanlış güven" hatasıdır.
ADR ayrıca **ODbL karıştırma tuzağını** sabitler: OSM ile ticari kaynak **tek
veritabanında birleştirilmez** (share-alike ticari veriye bulaşır), katmanlar ayrı
tutulup çalışma zamanında birleştirilir.

**💰 BÜTÇE KARARI (2026-08-13 — ADR §6-C):** Ürünün henüz geliri yok; **radar
verisine bugün para harcanmayacak**. Teklif metinleri hazır bekliyor
(`docs/RADAR_VERI_TEKLIF_TALEBI_TASLAKLARI.md`), **ilk ticari head unit siparişi
veya ilk ödemeli filo müşterisinde** gönderilecek. Bugünkü hükümler: yuva **boş
kalır** · veri kaynağı belirsizken **radar kodu yazılmaz** (şema kaynağa bağlı →
ölü kod) · *"radara yakalanmaz"* vaadi **satış/pazarlama malzemesinde
KULLANILMAZ**. Sıfır maliyetli yollar (EGM izin talebi · Lufop anahtarı · OSM)
açık ama **birlikte bile kapsam eşiğini geçmez** → özellik yapılabilir, **söz
verilemez**.

**🟡 BOŞ YUVA KARARI DEĞİŞTİ — YUVA DOLDURULDU (2026-08-13, kütük #568/#569):**
Sahibinin iki kararı (ADR §6-D) yukarıdaki "yuva boş kalır" hükmünü **ezdi**:
**(K2)** EGM'nin kamuya açık EDS verisi izin beklenmeden kullanılacak; **(K5)**
paket geliştirici tarafında üretilip cihaza gömülecek. Zincir kuruldu ve
`speedCameraWarningRule` **ilk kez üründe koşuyor** — Guardian'ın `map` yuvası
**kısmen** (yalnız `speedCamera` dilimi) doldu. Kararın **iptal etmediği** iki
şey aynen duruyor:
1. **Söz hâlâ verilemez.** *"Radara yakalanmaz"* pazarlama vaadi YASAK (K7).
   Kapsam ölçüldü ve eksik: Mersin ili 0, Mersin–Tarsus koridoru üç kaynakta da
   0, mobil radar hiçbir statik kaynakta YOK. **Uyarı çıkmaması "denetim yok"
   anlamına gelmez** ve ürün böyle bir izlenim vermez.
2. **G1 kapısı hâlâ kapalı.** #508 artık bir uyarı notu değil, **koda yazılmış
   bir kapıdır**: uyarı fix YAŞINA değil `doğruluk + hız × fix yaşı ≤ 150 m`
   **konum belirsizliğine** tabidir. Sahadaki p50 19,5 s bayat fix otoyol
   hızında bu kapıyı kapatır → özellik şehir içinde çalışır, otoyolda **sessiz
   kalır** ve bu sessizlik CAROS LAB'da sayı olarak GÖRÜNÜR. G1 düzeldikçe
   özellik kendiliğinden açılır; hiçbir eşik gevşetilmez.

Ürün dili de karara uyduruldu: kayıtların **%93'ünde tür bilinmediği** için
sürücüye **"radar" DENMEZ, "denetim noktası" denir** (K3) ve pakette hız limiti
HİÇ olmadığı için uyarı **hız eşiği İDDİA ETMEZ** (K4). Kuralda `'unknown'`
(varlık bilinmiyor → sessiz) ile `'unspecified'` (varlık gözlendi, tür
belirtilmemiş → uyarır, tür iddia etmez) **ayrı** davranır.


### P0 — Yanlış güven / güvenlik

| # | İş | Neden P0 | Kabul kriteri |
|---|---|---|---|
| P0-1 | **OBD FAZ 0–4 saha borcunu kapat** (25 maddeden 22'si 🔴/🟡) | Kod "tamam" ama kullanıcıya yanlış güven riski sahada kanıtlanmadı | Kütükte her madde 🟢 veya ❌; ❌ olan geri alınır |
| P0-2 | **ATH0 restore regresyon testi (araçta)** | Sessiz veri ölümü — kullanıcı fark etmez | Tam tarama sonrası hız/RPM/coolant akışı 60 s kesintisiz |
| P0-3 | **Gömülü AI anahtarı bundle/APK sızıntısı** | **Satış blocker** — `.env` VITE anahtarları literal gömülü | Anahtar rotate + kaldır + nokta erişim + CI guard |
| P0-4 | **Debug/güvenlik bayrakları shippable build'de** (`/enable-adb`, port 8899) | Satışa gitmemeli | Release build'de erişilemez + guard testi |
| P0-5 | **DTC'li araçta fail-closed verdi doğrulaması** (F0-1) | Ürünün ana güven vaadi | Pending/permanent kodlu araçta ekran "SİSTEM TEMİZ" DEMEZ |

### P1 — Temel güvenilirlik

| # | İş | Kabul kriteri |
|---|---|---|
| P1-1 | Extended PID **değer dolumu** + ⚠️ RPM=0 anomalisi kök nedeni | Canlı Test'te extended PID'ler değer gösterir; motor açıkken RPM>0. **Rapor `8edd61a6` teyit etti:** `discovered: true, supportedCount: 15` ama `samples: []` — keşif çalışıyor, dolum yok. **PR-OBD-BLE-1 (2026-07-15) kök neden buldu+kod düzeltmesi:** "Tüm PID Canlı Test" burst modu `BleObdManager`'da ve `CarLauncherPlugin.setObdDiagnosticBurst` wiring'inde YOKTU → BLE dongle'lı araçlarda (Trafic+Doblo aynı 6-7 PID) extended hattı yalnız round-robin. Burst BLE'ye eklendi (Classic deseninin birebir aynası); `compileDebugJavaWithJavac` başarılı, TS sözleşme 32 test yeşil. **🔴 CİHAZDA DOĞRULANMADI** — kabul: BLE dongle + panel açıkken ≤20 sn'de ≥5 extended PID `TAZE`. Kalan: değer sığ seed (blok 40-A0) + NO_DATA/timeout ayrıştırması (ayrı PR'lar). **TEŞHİS DÜZELTMESİ (2026-08-09, `docs/P1-1_KOK_NEDEN_TESHISI.md`):** P1-1 "bozuk boru" değil **ölçülmemiş boru** — elimizdeki tek `samples: []` ölçümü 2026-07-15 tarihli, boşluğu kapatan `_watchAllSupportedPids` ise 2026-07-17'de (`f1e0e7f`) girdi ve o tarihten beri kimse yeniden ölçmedi. **SERTLEŞTİRME PAKETİ (2026-08-09, kütük #503/#504/#505):** S1 reconnect'te destek filtresi fail-closed kapatıldı (kanıt yoksa sorgu yok), S3'e sınırlı yeniden deneme yolu verildi (2 deneme · 20 s+60 s), S2 için tazelenmemiş raporlara görünür uyarı eklendi; üç eksik test (bağlama · dolum · S1 regresyonu) yazıldı — **bağlama ve dolum artık cihazsız kanıtlı**. **🔴 Hüküm hâlâ VERİLMEDİ** — kabul ölçütü değişti: gerçek araçta **önce** Runtime Scheduling → YENİLE, sonra `extendedPollEvidence.decision` okunur ve H1/H2/H3/H4'ten biri kayda geçer |
| P1-2 | Trafic (KWP) 10 soğuk açılış — protokol koruma saha kabulü | `protocolActive='5'` kalır, dakikalarca-takılma = 0. **Kısmen ilerledi:** rapor `8edd61a6` KWP'de handshake `ok` + protokol 5 aktif gösterdi (tek oturum; 10 açılış ölçütü hâlâ açık) |
| P1-3 | `canStatus` store'a yazılmıyor (W4B artığı) | Kaynak-kaybı durumu store'dan okunabilir |
| P1-4 | GPS çift/üçlü abonelik (#62) | Tek konum akışı; park gürültüsü kesilir |
| P1-5 | Migration 025/026 history boşluğu | Supabase history ile kod uyumlu |
| **P1-6** | **Event Bus tüketicisi yok** — omurga yayın yapıyor, kimse dinlemiyor (`publishedCount 127 / activeListenerCount 0`) | En az bir gerçek tüketici bağlanır ve `deliveredCount > 0` sahada gözlenir; ya da omurga dürüstçe "hazır ama kullanılmıyor" olarak etiketlenir |
| **P1-7** | **BT-timeout ile protokol-timeout ayrılmıyor** — ikisi de "zaman aşımı" | Native'den aşama bilgisi (`connect` / `init` / `protocol`) gelir → "dongle yok" ile "protokol yanlış" karışmaz. Bu ayrım olmadan araç-değişimi tahmini hep tahmin kalır (bkz. #78 fix'in tolerans dengesi) |

### P2 — Ürün kapsamı

| # | İş | Kabul kriteri |
|---|---|---|
| P2-1 | **Deep Scan tetikleyicisi** (W5-3c handler) — bkz. §8 | Kullanıcı/ignition ile gerçek tarama başlar, faz yürür, sonuç üretilir |
| P2-2 | **Prediction Engine production tüketicisi** | Motor çıktısı store/UI'da görünür (tek dar dilim) |
| P2-3 | Root Cause PR-9 (subsystem yayılımı) + cihaz doğrulaması | Kök neden gerçek araçta kanıtla üretilir |
| P2-4 | Vehicle Memory — bounded kalıcı zaman-serisi | Yazma throttle'lı, bounded, atomik depo |
| P2-5 | Digital Twin **provenance** katmanı | Her sinyalin kaynak izi okunabilir |
| P2-6 | Cloud Sync şema + RLS/GRANT sözleşmesi (veri akışından ÖNCE) | GRANT+RLS+policy üçlüsü doğrulama sorgusuyla kanıtlı |

### P3 — Kalite, UI ve gözlemlenebilirlik

| # | İş | Kabul kriteri |
|---|---|---|
| P3-1 | Maintenance Timeline UI (mevcut veriyle) | Yeni sinyal eklemeden timeline görünür |
| P3-2 | Privacy Center paneli | Ne toplanıyor / sil / dışa aktar |
| P3-3 | Yerleşim Motoru'nu kalan temalara yay (EXPEDITION dahil) | Tüm temalarda yerleşim etkili |
| P3-4 | Scan Completeness raporu UI | Hangi ECU tarandı/atlandı görünür |
| P3-5 | Web↔ürün uyumu: "200+ DTC" iddiası → gerçek sayı | Web ile ürün aynı sayıyı söyler |

### Uzun vadeli vizyon

Aşağıdaki §8 defterinde **YOK** durumundaki her şey buraya aittir. Bunlar **taahhüt
değildir** — vizyon rezervuarıdır. Bir madde ancak P0–P3'e taşındığında taahhüt olur.

---

---

## 7.9 NAVİGASYON VİZYONU — 7 KATMAN (2026-08-11)

> **Bu bölüm bir ENVANTER ve YÖN belgesidir.** Yeni kütük numarası açmaz; mevcut
> ölçülmüş açıklara (kütük #401–#407 · `docs/NAV_FIELD_GAPS_2026-08-05.md` G1–G19)
> referans verir. Durum yükseltmesi YAPMAZ — saha kanıtı kütükten okunur.

Navigasyon, CarOS Pro'nun **8 Kapı** sözleşmesinin en sert sınandığı yerdir: konum
bir gösterge değil, bir **karar girdisidir**. Aşağıdaki yedi katman, "harita çizen
uygulama" ile "aracın ikinci beyni" arasındaki farkı tanımlar.

### Katman 1 — Konum bir KANITTIR

Konum; yaş (`fixAgeMs`), doğruluk (`accuracyM`) ve kaynak (GPS · ölü hesap · füzyon)
taşıyan **tek otoritedir**. Bayatlık **dürüstçe gösterilir**; taze fix yokken akıcı
animasyonla süreklilik **taklit edilmez**.

*Ölçülmüş açık:* **G1 / kütük #401** — fix p50 **19,5 s** bayat (94 km/h'de ~509 m
körlük) · **G11 / #406** — doğruluk p95 **7 578 m**, yanal sapma 1 480 m. Kabul
ölçütü **#508**'de kilitli: `p50 < 3 s` **VE** `p95 < 10 s` **VE** iz/gerçek yol
oranı **> 0,9**.

### Katman 2 — FÜZYON: GPS tek başına yetmez

Tekerlek hızı, motor devri ve vites; GPS ile birleşerek tünelde ve şehir
kanyonunda konumu **sürdürür**. Ölü hesap bir yedek değil, **sürekliliğin
kendisidir**.

*Ölçülmüş açık:* **Ç-7 — iki paralel hız sistemi**: `speedFusion` (plausibility +
histerezis + kalibrasyon) yalnız MiniMap/telemetri yolunda; ana gösterge yolu
(worker → resolver → HAL store) bunlara sahip değil. Kısmen kapatıldı; **tek
otoriter hız kaynağı** hedefi açık. Ayrıca **G8 / #405** — `headingDeg` her örnekte
mevcutken eşleme motoru `HEADING_UNKNOWN` diyor: taşınan veri kullanılmıyor.

### Katman 3 — TEK ROTA OTORİTESİ

Tek ETA, tek kalan mesafe, **tek hesaplama noktası**. Aynı gerçeğin iki cevabı
olamaz.

*Ölçülmüş açık:* **G4 / #403** — ekran kartı "3 sa 18 dk" derken motor "4 sa 42 dk"
diyordu (1,5 saat fark). Ekran tarafındaki ikinci türetme **kaldırıldı**
(`NavigationHUD`), ETA artık yalnız motordan gelir. **Kalan:** **G3** ETA
salınımı (43 kez >60 s sıçrama, en büyüğü 1 sa 49 dk) ve **G5+G9 / #404** kalan
mesafenin %38'i kuş uçuşu + mesafe 69 kez arttı.

### Katman 4 — GERÇEK ÇEVRİMDIŞI ROTA MOTORU

Rota hesabı **cihazda** yapılır. OEM satışında head unit'e veri paketi gelmez ve
ağ garanti değildir; çevrimdışı rota bir konfor özelliği değil, **satış koşuludur**.

*Ölçülmüş açık:* **G15** — çevrimdışı rota motoru YOK; ağ kesilince rehberlik
tamamen düşüyor. Ön-ADR: `docs/ADR_OFFLINE_ROUTING.md` (motor seçimi · veri paketi
boyutu/lisansı · gömülü dağıtım).

### Katman 5 — ARAÇ-FARKINDA ROTALAMA

Rota, aracın **o anki durumunu** bilir: DPF rejenerasyonu sürerken uzun dur-kalk
güzergâhı önerilmez · akü düşükken uzun rölanti planlanmaz · menzil **gerçek
tüketimden** hesaplanır (katalog değerinden değil) · filo aracında yükseklik ve
ağırlık kısıtı rotayı belirler.

Bu katman, navigasyonun OBD/CAN katmanıyla kesiştiği yerdir ve CarOS Pro'yu
"harita uygulaması" olmaktan çıkaran şeydir.

### Katman 6 — EKRANDA DÜRÜSTLÜK

Konum bayatsa **harita bunu söyler**. Marker akıcı animasyonla ilerletilip taze
veri varmış gibi gösterilmez. Rehberlik düşmüşse "rehberlik yok" yazılır; düz-hat
tahmini gerçek rota gibi sunulmaz.

*Ölçülmüş açık:* **G10 / #407** — rota doğrulaması 399/399 örnekte `DEGRADED` ve
bu kullanıcıya HİÇ gösterilmiyor · **G19** — iki uyarı aynı anda farklı doğruluk
değeri gösterdi · **G16/G17/G18** — hız göstergesi ikonlara biniyor, GPS kartı
widget'ları kapatıyor, yol sayacı kırpılıyor.

### Katman 7 — SÜRÜCÜ KATMANI

Radar/EDS uyarısı · ortalama hız kesiti (section control) · hız limiti · şerit
rehberliği · kavşak yakınlaştırma görünümü · **gerçekçi ETA**.

*Ölçülmüş açık:* **G6** — 32 adımın 0'ında şerit verisi (sağlayıcı vermiyor;
istemci hazır) · **G7** — canlı trafik yok → ETA yapısal olarak gerçekçi olamaz ·
**T2 / #390** — tam ekran hız limiti levhası sessizce ölüydü · **#455** — kavşak
görünümü tetikleyicisi.

---

### SESLİ-ÖNCELİKLİ ARAYÜZ İLKESİ (bağlayıcı)

Sürüşte **bakış bütçesi ~1,5 saniyedir** — 100 km/h'de **~40 metre kör yol**. Bu
bütçe aşılıyorsa tasarım yanlıştır, kullanıcı dikkatsiz değildir.

Her bilgi **dört kovadan birine** girer; ikisine birden giremez:

| Kova | Ölçüt | Örnek |
|---|---|---|
| **SESLİ** | zamana duyarlı **VE** eylem gerektirir **VE** kısa | "200 metre sonra sağa" · "radar 500 m" |
| **EKRAN — TEK BAKIŞTA** | sürekli durum · **≤3 bilgi birimi** · 1 saniyede okunur | kalan mesafe · sonraki manevra oku · hız |
| **EKRAN — DURUNCA** | detay; araç hareketliyken **ertelenir** | rota alternatifleri · şerit şeması · POI listesi |
| **SESSİZ KAYIT** | karar üretmez, sonradan okunur | ham iz · tanı defteri · LAB alanları |

**Kural:** hız arttıkça **ekranda az, seste çok**. Bir bilgi sesli kovaya girmiyorsa
sürüş sırasında ekranda yer kaplamayı hak etmiyordur.

---

### FİKİR HAVUZU — 5 GRUP (onaylı, sıralı)

Gruplar **sıralıdır**: önceki grup kütükte 🟢 olmadan sonraki başlatılmaz (§7.0).

**GRUP 1 — TEMEL** (her şeyin önkoşulu)
1. **G1 konum düzeltmesi** — kabul ölçütü #508
2. **Tek rota otoritesi** — tek ETA · tek kalan mesafe
3. **Çevrimdışı rota motoru** — cihazda hesap

**GRUP 2 — SÜRÜCÜ KATMANI** (G1'e bağlı — konum kanıtı olmadan hiçbiri kurulamaz)
4. Radar / EDS uyarısı
5. Hız limiti
6. Şerit rehberliği
7. Kavşak yakınlaştırma görünümü
8. Gerçekçi ETA

**GRUP 3 — ARAÇ-FARKINDA** (5 kategoriye bağlı: yakıt · sıcaklık · akü · DPF · yük)
9. Gerçek menzil (ölçülen tüketimden)
10. Yakıt/şarj zamanlaması
11. Tırmanışta sıcaklık uyarısı
12. Bozuk yol uyarısı

**GRUP 4 — ÖĞRENEN**
13. Öğrenilmiş rota (sürücünün fiilen kullandığı yol)
14. Mola planı
15. Zamanla düzelen ETA (kişisel sürüş profili)

**GRUP 5 — FİLO**
16. Kamyon rotası (yükseklik · ağırlık · tonaj kısıtı)
17. Güzergâh uyumu (planlanan ↔ gerçekleşen)
18. Teslimat sırası optimizasyonu
19. Filo menzil/şarj planı
20. Sürücü-araç eşleşmesine göre rota tercihi

---

### ÜRÜN SÖZÜ

> **"CAROS PRO kullanan biri radara yakalanmamalı."**

Bu söz **G1'e bağlıdır** ve ondan önce verilemez: radar uyarısı mesafe tabanlıdır
("500 metre sonra"), mesafe konumdan türer, konum p50 19,5 saniye bayatken 94 km/h'de
**~509 metre** hata taşır — yani uyarı radarın üstünde ya da geçtikten sonra çalar.
**G1 kapanmadan bu söz verilmez**; şartlı kilit **#508** tam olarak bunu korur.

Sözün ikinci yarısı **veri**dir. Bu yarı **ölçüldü** (2026-08-13,
`docs/ADR_RADAR_DATA_SOURCE.md`): ücretsiz tek aday OSM'de TR genelinde **730**
sabit kamera var ama **Mersin–Tarsus koridorunda 0**, **Adana ilinde 0**;
noktaların yalnız **%32'sinde yön** bilgisi var. Sahibinin kararıyla (K2) veri
kaynağı **EGM kamuya açık EDS haritası** oldu ve paket üretildi (**1 503 nokta**),
zincir üründe koşuyor (kütük #568/#569) — ama kapsam boşluğu **kapanmadı**:
Mersin ili EGM'de de **0**, Mersin–Tarsus koridoru **üç kaynakta da 0**, mobil
radar **hiçbir statik kaynakta yok**.

Bu yüzden **söz hâlâ verilmez** ve iki yarısı da yerinde durur:

| Yarı | Durum | Ne değişti |
|---|---|---|
| **G1 / konum** | 🔴 KAPALI | #508 artık bir not değil, **koda yazılmış kapı**: `doğruluk + hız × fix yaşı ≤ 150 m`. p50 19,5 s bayat fix otoyol hızında bu kapıyı kapatır; düşüşler LAB'da SAYILIR. |
| **Veri / kapsam** | 🟡 KISMÎ | Yuva doldu ama kapsam eksik. Ürün **"uyarı çıkmadı = denetim yok"** izlenimini vermez; LAB dört ayrı sessizlik nedenini ayırt eder. |

*"Radara yakalanmaz"* vaadi satış ve pazarlama malzemesinde **KULLANILMAZ** (K7).
Ürünün verdiği tek söz şudur: **bildiği denetim noktalarını, konumundan emin
olduğu anda, tür ve hız iddiası taşımadan bildirir.**

---

### MİMARİ SINIR — KARAR MOTORDA, LLM'DE DEĞİL

Radar/uyarı **kararı ve zamanlaması** deterministik motorda kalır; LLM'de değil.
Bu, **#283 safety hot-path** sınıfının gereğidir: uyarının doğru anda çalması bir
güvenlik davranışıdır, bir metin üretimi değildir.

- **Mavi ağızdır, beyin değildir.** LLM yalnız **ağ varken** ve yalnız
  **zenginleştirme** amacıyla devreye girer (ifade · bağlam · açıklama).
- Ağ yokken uyarı **aynen** çalışır; LLM'in yokluğu bir güvenlik kaybı ÜRETMEZ.
- LLM hiçbir uyarıyı **bastıramaz**, **geciktiremez** ve **eşiğini değiştiremez**.

---

### DEVİR NOKTASI (2026-08-11)

Bu bölümün kod tarafındaki ilerlemesi ve sıradaki üç iş **`docs/HANDOFF_2026-08-11_NAV_OBD.md`**
belgesinde devredildi: G1 tek konum otoritesi kuruldu (#527), G3'ün kökü **ölçülerek**
bulundu (#530 — `SPEED_GATE_CHANGED` %67, düzeltme çarpanının 1↔1.5 ani geçişi),
`fixAgeMs` için **dağılım defteri** gerekiyor (#508 onsuz kapanmaz) ve saha koşumunda
**bağlantı kararsızlığı** ölçüldü (8 timeout · quality %57).

### DEVİRDEN SONRAKİ TUR — GÖREV A/B/C (2026-08-11, aynı gün)

Devir belgesinin §5'indeki üç iş **kod tarafında** yapıldı. Hiçbiri sahada
doğrulanmadı → üçü de kütükte **🔴** (#536 · #537 · #538).

| Görev | Ne yapıldı | Ne YAPILMADI (dürüst sınır) |
|-------|-----------|------------------------------|
| **A** · bağlantı kararsızlığı | `obd/linkLossLedger` (saf): kopma anındaki imza (voltaj bandı · link/ECU yaş sırası · timeout aşaması) + **kurtarma imzası** (süre · düşen deneme) defterlenir. Ayırt edilemeyen durumda aday **UNKNOWN** kalır ve **eksik kanıt** sayılır (`nextMeasurement` = bir sonraki turun işi). LAB → Adaptör Tanılama → *4 · Kopma Kanıtı* + kopya bölümü. | **KÖK NEDEN HÂLÂ BİLİNMİYOR.** Hiçbir reconnect/eşik davranışı DEĞİŞTİRİLMEDİ (kör düzeltme yasağı). Defter hüküm motoruna girdi DEĞİLDİR (KİLİT 31 bunu sabitler). Native soket hata kodu JS'e hâlâ açık değil. |
| **B** · `fixAgeMs` dağılımı | `navigation/core/fixAgeLedger` (saf): bounded halka (240) + p50/p95 + **≥30 örnek olmadan hüküm YOK**. Örnek **tüketici okumasında** alınır → yeni timer YOK (Zero-Leak). Ayrıca kopyadaki `fixAgeMs`in **map-match** yaşı olduğu, #508'in sayısının **G1 otoritesinden** (`konumFixYasMs`) geldiği ayrıştırıldı. | #508 **kapanmadı**: dağılım henüz gerçek araçta toplanmadı. Üçüncü ölçüt (**iz/gerçek yol > 0,9**) bu defterde **ÖLÇÜLMEZ** ve `trackRatioMeasured: false` ile beyan edilir — ayrı bir iş. Örnekleme zaman ekseninde düzgün DEĞİLDİR (beyan edilir). |
| **C** · G3 düzeltmesi | Hız kapısı **anahtar değil rampa** (8 → 16 km/h, `etaSpeedGateWeight`): eşikte etki 0 → fonksiyon **sürekli** → sahada ölçülen `factor 1↔1.5` ani geçişi ve ondan doğan **%50 ETA zıplaması** yapısal olarak imkânsız. Rampa **saf** (zaman/durum yok). 16 km/h üstünde eski davranış **birebir** korunur. `etaJumpLedger` bant-farkındalığı kazandı. | Doğrulama **aynı defterle** yapılacak: `SPEED_GATE_CHANGED` sayısı sahada **düşmeli**. Düşmezse ya rampa bandı yanlış ya kök tek başına bu değil. G3'ün diğer tetikleyicileri (`ROUTE_REVISION`, `BASE_DURATION_ONLY`) DOKUNULMADI. |

**Bir sonraki atomik PR:** saha koşumu → kopyada üç bölümü oku (`KOPMA KANIT
DEFTERİ` · `KONUM FIX YAŞI DAĞILIMI` · `ETA SIÇRAMA DEFTERİ`) → #536'nın
`nextMeasurement` alanının söylediği kanıtı enstrümanla; #537 `count ≥ 30` ise
#508 hükmünü oku; #538 için `SPEED_GATE_CHANGED` sayısını tabanla (4/6) karşılaştır.

### ADRES ARAMA — BELİRSİZLİK ÇÖZÜMÜ (2026-08-12, kütük #547)

Teşhis turunun (§3.5) "gevşetilmiş adayda mesafe kapısı yok" bulgusu ölçümle
**doğrulandı ve genişledi**: kusur gevşetilmiş adaylara özgü değildi — **mesafe
zincirin HİÇBİR yerinde karar değişkeni değildi.** Canlı ölçüm (Tarsus,
2026-08-12): `"Cumhuriyet Mahallesi"` → sunulan ilk aday Adana 43 km, 3,5 km'deki
Tarsus adayı ÜÇÜNCÜ · `"Bağlar Mahallesi"` (harita çubuğu zinciri) → ilk aday
Siverek 405 km · `"İstanbul Bağlar Mahallesi"` → ilk aday Tarsus'ta bir okul
(0 km), yani **yakınlık açıkça istenen şehri eziyordu.**

**Kural (kullanıcı sözleşmesi):** *şehir belirtilmemişse EN YAKIN öncelikli;
şehir açıkça belirtilmişse O ŞEHİR kesin ve mesafeye göre REDDEDİLMEZ* — biri
Tarsus'tayken "İstanbul …" arıyorsa oraya gideceği için arıyordur.

| Ne yapıldı | Ne YAPILMADI (dürüst sınır) |
|-----------|------------------------------|
| `platform/geo/locationBiasGate.ts` (SAF): üç mod — `CITY_SCOPED` (mesafe kapısı KAPALI, yalnız yanlış il KANITI olan aday elenir) · `PROXIMITY` (mesafeye göre sırala; 100 km üstü `farFromUser` → otomatik rota yok; gevşetilmiş **ve** 150 km üstü aday elenir) · `UNMEASURED` (konum yoksa hiçbir şey yapılmaz, sahte mesafe üretilmez). İl kanıtı sonucun **son 4 virgül parçasından** okunur. Kapı **her katmanda** ve **her iki yüzeyde** çalışır; elemesi deftere (`biasDroppedCount`) ve LAB → Adres Arama Kanıtı ekranına taşınır. | **Hiçbir sağlayıcı/sorgu mantığı değişmedi**: `extractStreetQuery`, gevşetme merdiveni ve numara doğrulaması DOKUNULMADAN kaldı — kapı onların ÜSTÜNE eklendi. **Kanıtsız eleme yok:** il bilgisi taşımayan aday elenmez, `cityUnverified` ile onaya düşer. Sözlük **81 il** ile sınırlıdır: ilçe/mahalle adı şehir bildirimi SAYILMAZ (ör. "Tarsus" → en-yakın modu). Teşhis §3.2 (yazım/boşluk toleransı), §3.6 (yüzey ayrışmasının kalan yapısal farkları: BYOK + kısaltma + gevşetme yalnız A zincirinde), §3.8 (kapı numarası) bu turda **kapatılmadı**. |

**Durum: ENTEGRE** (26 birim testi + 12 kilit + 5/5 canlı sağlayıcı ölçümü).
**SAHADA DOĞRULANDI DEĞİL** — gerçek araçta ölçülecek altı kabul ölçütü kütük
#547'dedir. **ÜRÜN HAZIR: HAYIR.**

#### Okunabilirlik kusuru — seçim listesi açık temada okunmuyordu (kütük #550)

Belirsizlik çözümü doğru adayları üretse bile kullanıcı **onları göremiyordu**:
sonuç kartı gündüz/güneş temasında koyu zemin üzerinde koyu mürekkeple
çiziliyordu. Kök kartın kendisinde DEĞİLDİ — kart yüzeyini doğru tema tokenından
alıyor ve sekiz tema kombinasyonunun hepsinde sağlamdı (cihazda tek tek ölçüldü,
Δlum ≥ 180). Suçlu `base.css`'in compat kuralıydı: `backdrop-filter` kapatılırken
yarı saydam yüzeyler **tema-agnostik SABİT koyu** bir renge sabitleniyor, metinler
ise `--oem-ink` ile açık temada koyu kalıyordu. Cihazda ölçülen fark: **Δ 1/255**
(blur sınıfı kaldırılınca Δ 229 → suçlu kesinleşti). Opaklaştırma rengi artık
`--oem-compat-solid` tokenı üzerinden temayla flip eder; **koyu tema değeri
birebir aynı bırakıldı** (regresyon yok). Ders: *bir kartın kendi tokenları doğru
olması onun okunabilir olduğunu KANITLAMAZ* — global bir `!important` kuralı
yüzeyi ezerken mürekkebi ezmeyebilir. **Durum: ENTEGRE**, cihazda üretim APK'sıyla
görsel doğrulama BEKLİYOR (kütük #550). **ÜRÜN HAZIR: HAYIR.**

### BU BÖLÜMÜN DURUMU

Yedi katmanın hiçbiri **SAHADA DOĞRULANDI** değildir. Katman 3'ün bir parçası
(G4 ikinci ETA otoritesi) kapatıldı; G3'ün **kökü kapatıldı ama araçta
doğrulanmadı** (#538). Katman 1'in kabul ölçütü kilitli (#508); ölçüm **aracı**
artık var (#537) ama **ölçümün kendisi** hâlâ bekliyor. Katman 4 için henüz kod
yoktur — yalnız ön-ADR vardır.

**Sıra (ölçülerek doğrulandı, 2026-08-11):** Katman 1 (G1) → Katman 3 → Katman 4.
Gerekçe: `routeProjectionModel` ve `mapMatchModel` zincirinde ölçülen bağımlılık —
bayat/çöp fix → eşleştirme koridorundan (55–95 m) çıkış → `mapMatchState:
OFF_NETWORK` → `distanceToNextTurnSource: STRAIGHT_LINE` → kalan mesafe ve ETA
hataları. Saha oranları bu zinciri destekliyor: `OFF_NETWORK` **%38** ve
`STRAIGHT_LINE` **%38** (aynı 399 örnek). Yani **G3/G5/G9 kökü G1+G11'e bağlıdır**
ve konum otoritesi kapanmadan rota otoritesi kalıcı olarak düzelmez.

## 8. Capability Defteri

> Durumlar §5 modeline göredir. **YOK** = kod yok; vizyon rezervuarı.
> Kritik/aktif özellikler tam şablonla, geri kalanı kompakt tabloyla tutulur.

### 8.1 Tam şablonlu kritik özellikler

#### Deep Vehicle Scan

- **Amaç:** Tüm ECU'ları profesyonel biçimde tarayıp eksiksiz teşhis tabanı üretmek.
- **Kullanıcı değeri:** Car Scanner'ın göremediği ABS/airbag/şanzıman/BCM arızalarını görmek.
- **Mimari rol:** Teşhis kanıt tabanının üreticisi (Capability + Root Cause besleyicisi).
- **Durum:** **İSKELET** (offline `change_detection` fazı ENTEGRE — aşağıya bakınız)
- **Ürün hazır:** HAYIR
- **Production kanıtı:** Wiring **boot'ta çalışıyor** — `SystemBoot.ts:586`
  `startPlatformCoreDeepScanWiring()` + `SystemBoot.ts:667` `triggerDeepScanOfflinePass()`
  → `orchestrator.runOfflinePass()`. **W5-3c-3'ten sonra:** `change_detection` fazı artık
  gerçek handler'a bağlı → `skipped` değil, karar üretiyor. **Diğer 5 offline faz hâlâ
  handler'sız → `skipped`; 6 aktif faz (ECU/PID/DID/firmware sorgusu) hiç çalışmıyor** —
  `waiting_for_ignition`'da fail-closed bloke. **Gerçek ECU taraması hâlâ YOK.**
- **Test kanıtı:** Faz makinesi + fail-closed + ownership birim testleri; W5-3c-3 ile
  21 change-detection kilidi. Gerçek tarama testi yok.
- **UI/API:** YOK — kullanıcı taramayı başlatamaz, sonucu göremez.
- **Saha doğrulaması:** Doğrulanmadı.
- **Runtime yolu:** Cold
- **DeviceTier etkisi:** Yalnız soğuk-yol/idle; low tier'da faz sayısı budanır.
- **Bağımlılıklar:** Ignition source (authoritative kanıt yok → `ignitionConfirmed` daima `null`), OBD transport.
- **Eksik ana parça:** Kalan **offline faz handler'ları** + **aktif faz tetikleyicisi**
  (ignition/kullanıcı) + sonuç yüzeyi.
- **Sonraki atomik PR:** W5-3c-4 — sıradaki offline faz handler'ı (`capability_analysis`),
  aynı pasif-okuma disiplini ile.
- **Kabul kriterleri:** (kod) handler bağlı fazda `skipped` yerine gerçek sonuç üretilir
  ✅ `change_detection` için karşılandı; (cihaz) gerçek araçta ≥1 faz tamamlanır ve
  **tarama sonrası hız/RPM akışı bozulmaz** — 🔴 açık.
- **Son güncelleme:** 2026-07-15 (W5-3c-3)

##### Offline Change Detection (alt-yetenek — W5-3c-3)

- **Durum:** **ENTEGRE** (İSKELET'ten yükseldi — production'da çağrılıyor ve karar üretiyor)
- **Ürün hazır:** HAYIR — UI yüzeyi yok, saha kanıtı yok.
- **Production kanıtı:** `SystemBoot:667` → `triggerDeepScanOfflinePass()` →
  `runOfflinePass({handlers:{change_detection}})` → `offlineChangeDetectionHandler` →
  `changeBaselineAdapter.resolve()` → (fingerprint store + deep scan geçmişi, **pasif okuma**)
  → `changedEcu:true` ise `runtime.recordChangeDetection()`.
- **Test kanıtı:** 21 kilit (`offlineChangeDetection.test.ts`) — lazy-load, fail-closed
  no_baseline, VIN-matcher ECU tespiti, tautoloji koruması, bounded çıktı, yazma-yok,
  Event-Bus-yok statik guard'ı.
- **UI/API:** YOK — sonuç yalnız runtime sayacına düşer, kullanıcı görmez.
- **Saha doğrulaması:** **Doğrulanmadı** (🔴). Kabul ölçütü: aynı VIN'e ECU eklenip/çıkarılıp
  yeniden bağlanınca `changedEcu` bir kez kaydedilir; ECU seti aynıyken **asla** kaydedilmez.
- **Runtime yolu:** Cold · **DeviceTier etkisi:** Her tier — 2 bounded okuma (≤8 fingerprint LRU), ucuz.
- **Bağımlılıklar:** `VehicleFingerprintStore` (VIN dolu olmalı — VIN yoksa matcher `signature`'a
  düşer ve baseline devretmez), `DeepScanPersistenceStore` (önceki tarama kaydı).
- **Eksik ana parça:** `changedFirmware` **hiç üretilmiyor** — offline pass firmware envanteri
  toplamıyor (DID sorgusu = aktif faz). Firmware değişimi için aktif faz şart.
- **Sonraki atomik PR:** UI yüzeyi veya W5-3c-4 (bkz. üst madde).
- **Mimari not (bilinçli karar):** Baseline yalnız hash ile aranamaz — fingerprint hash'i
  `V:vin|P:proto|E:ecus|B:bitmap` türevi olduğu için **ECU değişimi hash'i de değiştirir**
  (anahtar kaybolur). Bu yüzden hash → bulunamazsa **VIN matcher** ile önceki fingerprint'e
  ulaşılır ve ECU setleri karşılaştırılır. Matcher yalnız `reason:'vin'` (confidence 1.0)
  kabul eder; `signature` döngüsel (ECU/bitmap türevi), `adapter-mac` aracı değil dongle'ı tanır.
- **Son güncelleme:** 2026-07-15 (W5-3c-3)

#### Prediction Engine

- **Amaç:** Arızayı oluşmadan önce tahmin etmek (anayasanın 6. kapısı).
- **Kullanıcı değeri:** "5 dk sonra ne olacak" — önleme, gösterme değil.
- **Mimari rol:** Vehicle Brain'in öngörü katmanı.
- **Durum:** **İSKELET**
- **Ürün hazır:** HAYIR
- **Production kanıtı:** **YOK** — production consumer yok; çıktı hiçbir store/UI'ya bağlı değil.
- **Test kanıtı:** İzole birim testi (`predictionEngine.test.ts`) — production yolu test edilmiyor.
- **UI/API:** YOK
- **Saha doğrulaması:** Doğrulanmadı.
- **Runtime yolu:** Cold · **DeviceTier etkisi:** Yalnız idle/soğuk-yol; low tier'da kapalı.
- **Bağımlılıklar:** Vehicle Memory (zaman-serisi) — **yok**, bu yüzden besleme tabanı eksik.
- **Eksik ana parça:** Besleyen zaman-serisi + tüketen store/UI.
- **Sonraki atomik PR:** P2-2 — tek sinyalle dar dilim: motor → store slice → kart yüzeyi.
- **Kabul kriterleri:** (kod) production yolundan çıktı üretilir; (cihaz) gerçek araçta
  en az bir öngörü kanıtla gösterilir ve yanlış-alarm oranı ölçülür.
- **Son güncelleme:** 2026-07-15

#### Digital Twin

- **Amaç:** Aracın canlı dijital ikizi — kimlik, geçmiş, şimdi ve gelecek tek modelde.
- **Kullanıcı değeri:** Araç ve telefon aynı gerçeği görür.
- **Mimari rol:** CAROS PRO ↔ Arabam Cebimde paylaşımının **çekirdeği**.
- **Durum:** **İSKELET**
- **Ürün hazır:** HAYIR
- **Production kanıtı:** `UnifiedVehicleStore` **gerçek Digital Twin değildir** — yalnız
  anlık sinyal aynasıdır. **Kimlik, history, prediction, provenance ve lifecycle eksiktir.**
- **Test kanıtı:** Store birim testleri (twin davranışı test edilemez — yok).
- **UI/API:** Göstergeler (anlık); twin yüzeyi YOK.
- **Saha doğrulaması:** Doğrulanmadı.
- **Runtime yolu:** Hot (veri katmanı) · **DeviceTier etkisi:** Görsel twin low tier'da feda; veri katmanı bütçeli.
- **Bağımlılıklar:** Vehicle HAL (var), Vehicle Memory (yok), Vehicle Passport (iskelet).
- **Eksik ana parça:** Kimlik + geçmiş + tahmin + **provenance** + yaşam döngüsü.
- **Sonraki atomik PR:** P2-5 — provenance (her sinyalin kaynak izi): twin'in ilk gerçek katmanı.
- **Kabul kriterleri:** (kod) her sinyal kaynağıyla birlikte okunur; (cihaz) gerçek araçta
  provenance zinciri kanıtla doğrulanır.
- **Son güncelleme:** 2026-07-15

#### AI Fabric

- **Amaç:** Tek AI yerine uzman AI ekibi (router + uzmanlar + kanıt hakemi).
- **Kullanıcı değeri:** Doğru soruyu doğru uzmana sormak; kanıtla tartılmış tek cevap.
- **Mimari rol:** Zekâ katmanının orkestrasyonu.
- **Durum:** **İSKELET**
- **Ürün hazır:** HAYIR
- **Production kanıtı:** **Model fallback zinciri (Gemini→Groq→Haiku) çoklu-agent AI Fabric
  DEĞİLDİR.** Uzman agent router, evidence judge ve birleşik cevap akışı **yoktur**.
- **Test kanıtı:** Fallback zinciri testli; fabric davranışı yok → test edilemez.
- **UI/API:** YOK (fabric olarak) · **Saha doğrulaması:** Doğrulanmadı.
- **Runtime yolu:** Cold · **DeviceTier etkisi:** Yalnız yüksek tier + çevrimiçi.
- **Bağımlılıklar:** Evidence Engine (entegre), BYOK anahtar akışı (P0-3 ile bağlı).
- **Eksik ana parça:** Agent router · uzmanlık ayrımı · evidence judge · cevap birleştirme.
- **Sonraki atomik PR:** İki-uzman + hakem ile en dar çalışan akış (router iskeleti değil).
- **Kabul kriterleri:** (kod) iki uzman + hakemden tek birleşik cevap; (cihaz) gerçek
  araç sorusunda kanıtla doğrulanmış cevap.
- **Son güncelleme:** 2026-07-15

#### Self Diagnostic System

- **Amaç:** Uygulamanın kendi sağlığını izlemesi ve kanıtı dışarı taşıması.
- **Kullanıcı değeri:** "Tanı Gönder" — sorun bize kanıtla ulaşır.
- **Mimari rol:** Observability'nin tek kapısı.
- **Durum:** **SAHADA DOĞRULANDI**
- **Ürün hazır:** **EVET** (altı koşulun tamamı)
- **Production kanıtı:** `GlobalDiagnosticButton` → `selfTestEngine` → sanitize (PII-guard)
  → `diagnosticDelivery` → Supabase RPC → `/admin/tani`.
- **Test kanıtı:** sanitize DENY_KEYS, teslimat 8-durum, rate-limit kuyruk kilitleri.
- **UI/API:** Tanı Gönder butonu + `DiagnosticReportModal` (rıza + önizleme + reportId).
- **Saha doğrulaması:** 🟢 Ledger #3/#4/#5 — boot self-pair + RPC teslimatı gerçek cihazda;
  W4E runtime sayaçları raporda gözlendi (484 B).
- **Runtime yolu:** Cold · **DeviceTier etkisi:** Her tier açık — ucuz, talep-güdümlü.
- **PR-OBD-DIAG-2 (2026-07-15, kod+test):** Rapora **PID KEŞİF KANITI** eklendi —
  `obdDeep.handshake.discoveryEvidence`: her bitmap bloğu (00→A0) için outcome
  (OK/NO_DATA/TIMEOUT_*/NEGATIVE/PARSE_ERROR/NOT_ATTEMPTED) + continuation
  (SET/CLEAR/UNKNOWN) + stopReason + `evidenceComplete`. Salt-türetilmiş
  (`buildDiscoveryEvidence`, ek OBD komutu YOK, handshake byte davranışı değişmedi).
  Artık `readBlocks:["0","20"]` sonucunun **doğru durma** (CONTINUATION_CLEAR) mı yoksa
  **erken kesilme** (NO_DATA/timeout → OUTCOME_UNKNOWN) mı olduğu ayrılabiliyor; kanıt
  eksikken "desteklenmiyor" çıkarımı YASAK. Kilit: `pidDiscoveryEvidence.test.ts` (15).
  Payload ~0.5-0.8 KB (≤6 blok, preview ≤24 hane). **🔴 gerçek araç raporuyla teyit
  bekliyor** — Trafic/Doblo raporunda evidence gözlenince Ledger'a işlenecek.
- **PR-OBD-DIAG-3 (2026-07-15, kod+test):** **EXTENDED PID POLL KANITI** eklendi —
  `obdDeep.extendedPollEvidence`. Kök: Trafic raporunda `extended.samples: []` iki farklı
  arızayı ayıramıyordu (H1 poll hiç çalışmadı · H2 çalıştı ama ECU değer üretmedi · H3
  native başarılı ama JS/store'a akmadı). Yeni oturumluk **bounded** sayaçlar
  (attempted/success/noData/timeout(0-byte,partial)/negative/error/callbackEmitted +
  kadans pollCycles/burstCycles/roundRobinCycles + son 8 deneme halkası) native tarafta
  (`ExtendedPollEvidence`, iki poll loop'ta O(1) instrumentation) + JS akış sayaçları
  (`eventsReceived/decodeFailures/valuesStored`) birleştirilip **H1/H2/H3/H4 kesin hükmü**
  üretiliyor (`classifyExtendedPoll`, saf/test edilebilir). Outcome, mevcut
  `ElmResponseParser.Kind`'den türetilir (`readPidClassified` — readPidRaw'ın null'a
  çökerttiği sınıflandırmayı korur); **ek OBD komutu YOK, polling davranışı DEĞİŞMEDİ**,
  ham yanıt gövdesi saklanmaz (PII-güvenli, yalnız responseLength). Kilitler:
  `ExtendedPollEvidenceTest` (14, JVM) + `extendedPollEvidence.test.ts` (16). Payload ~1 KB.
  **🔴 gerçek araç raporuyla teyit bekliyor** — Trafic raporunda H1/H2 ayrımı gözlenince
  Ledger'a işlenecek (sıradaki saha adımı).
- **PR-OBD-CONN-1 (2026-07-15, kod+test):** **DETERMİNİSTİK + GÖZLEMLENEBİLİR bağlantı reset'i.**
  Kök neden (`OBDConnectModal.tsx`): "Bağlantıyı Sıfırla" `resetObdConnection()` (async native
  disconnect, fire-and-forget) + `startOBD()`'yi TEK senkron tick'te çağırıyordu → kullanıcı
  görünür disconnect/reconnect yaşam döngüsü görmüyordu (saha: "hiçbir şey olmadı"). Native
  zincir zaten tamdı (`disconnectOBD` → iki manager `disconnect()`+`close()`+queue clear;
  `_startNative` `_pendingDisconnect`'i await ediyordu → native yarış korunuyordu) — boşluk
  UX/gözlemlenebilirlikteydi. Fix: `resetObdConnection` artık **Promise** (senkron flag/handshake
  sıfırlama ANINDA; async bölüm native disconnect'i BEKLER) → UI buton "Sıfırlanıyor…" + disabled
  (çift-dokunuş yok) → disconnect BİTİNCE tek temiz reconnect. Bounded lifecycle telemetrisi
  (`getObdConnLifecycle` → `obdDeep.connLifecycle`): reset istendi/bitti · disconnectCalled ·
  reconnectRequested · lastResetReason · state · lastPacketAgeMs (PII yok). **Reset ≠ Forget:**
  reset kayıtlı adresi/protokol kaydını KORUR (aynı dongle, temiz oturum); cihazı unutmaz.
  Kilitler: `obdService.test.ts` CONN-1 (5). Suite 4166 yeşil, tsc+lint temiz. Native değişiklik
  YOK. **🔴 CİHAZDA DOĞRULANMADI** — Trafic'te reset→"Sıfırlanıyor"→disconnect kanıtı +
  reconnect'te ham trafik yeniden başlaması gözlenince Ledger'a. **Not:** stale-veri "connected"
  rozetini gizleme (freshness-gated badge) bu PR'da DEĞİL — ayrı takip.
- **Bağımlılıklar:** Supabase RPC · migration 025/026 (history boşluğu — P1-5).
- **Eksik ana parça:** — · **Sonraki atomik PR:** —
- **Kabul kriterleri:** (karşılandı) cihazda buton → `vehicle_events` satırı → panelde listelenir.
- **Son güncelleme:** 2026-07-15

### 8.2 Vehicle Intelligence

| Özellik | Durum | Ürün hazır | Kanıt / eksik ana parça |
|---|---|---|---|
| Digital Twin | İSKELET | HAYIR | §8.1 — provenance/kimlik/history/lifecycle yok |
| Vehicle Memory | İSKELET | HAYIR | Öğrenme motoru çalışır; **kalıcı zaman-serisi yok** |
| Vehicle DNA | YOK | HAYIR | Vehicle Memory'ye bağımlı |
| Vehicle Timeline | YOK | HAYIR | Maintenance Timeline (İSKELET) ile karıştırılmamalı |
| Vehicle Black Box | YOK | HAYIR | Olay-anı kalıcılığı gerekir |
| Vehicle Ghost Replay | YOK | HAYIR | Black Box'a bağımlı |
| Vehicle Life Story | YOK | HAYIR | Memory + Passport + bulut gerekir |
| Vehicle Passport | İSKELET | HAYIR | `vehicleIdentityService` + fingerprint var; **passport UI/doğrulama zinciri yok** |
| Vehicle Personality | YOK | HAYIR | Vizyon rezervuarı |
| Vehicle Memory Graph | YOK | HAYIR | Vizyon rezervuarı |
| Reliability Score | YOK | HAYIR | Health Score (İSKELET) ile ayrı |
| Risk Radar | YOK | HAYIR | Vizyon rezervuarı |
| Vehicle Health Forecast | YOK | HAYIR | Prediction Engine'e bağımlı |
| Component Life | YOK | HAYIR | Vizyon rezervuarı |
| Vehicle Stress Meter | YOK | HAYIR | Vizyon rezervuarı |
| Hidden Fault Hunter | YOK | HAYIR | Deep Scan + UDS'e bağımlı |
| Vehicle Immune System | YOK | HAYIR | Vizyon rezervuarı |
| Missing Sensor Reconstruction | YOK | HAYIR | Zero-trust ile dikkatli tasarım ister |
| Future Failure Map | YOK | HAYIR | Prediction'a bağımlı |
| Vehicle Digital Shadow | YOK | HAYIR | Twin'e bağımlı |
| Vehicle MRI | YOK | HAYIR | Deep Scan'e bağımlı |
| Road Learning | YOK | HAYIR | Vizyon rezervuarı |
| Vehicle Evolution | YOK | HAYIR | Vizyon rezervuarı |

### 8.3 AI Fabric

| Özellik | Durum | Ürün hazır | Kanıt / eksik ana parça |
|---|---|---|---|
| AI Router | İSKELET | HAYIR | Model **fallback** var; uzman router yok |
| AI Mechanic | YOK | HAYIR | Root Cause + KB üstüne kurulur |
| AI Analyst | YOK | HAYIR | Vizyon rezervuarı |
| AI Predictor | İSKELET | HAYIR | = Prediction Engine (§8.1) |
| AI Historian | YOK | HAYIR | Vehicle Memory'ye bağımlı |
| AI Cost Advisor | YOK | HAYIR | Vizyon rezervuarı |
| AI Trip Planner | YOK | HAYIR | Vizyon rezervuarı |
| AI Learning Engine | İSKELET | HAYIR | `autoLearningEngine` var; kalıcılık yok |
| AI Evidence Judge | YOK | HAYIR | **AI Fabric'in kilit eksiği** |
| AI Teacher | YOK | HAYIR | Vizyon rezervuarı |
| AI Fleet Brain | YOK | HAYIR | Fleet Intelligence'a bağımlı |
| AI Service Advisor | İSKELET | HAYIR | `maintenanceBrain`/`fuelAdvisorService`; öneri katmanı bağlı değil |
| AI Negotiator | YOK | HAYIR | Vizyon rezervuarı |
| AI Mechanic Battle | YOK | HAYIR | Vizyon rezervuarı |
| AI Explainability | YOK | HAYIR | Confidence/provenance üstüne kurulur |
| AI What If | YOK | HAYIR | Vizyon rezervuarı |
| AI Future Report | YOK | HAYIR | Vizyon rezervuarı |
| AI Repair Verification | YOK | HAYIR | Repair Memory'ye bağımlı |
| AI Laboratory | YOK | HAYIR | Vizyon rezervuarı |
| Self-Healing Advisor | YOK | HAYIR | Vizyon rezervuarı |
| Failure Simulator | YOK | HAYIR | Vizyon rezervuarı |
| Maintenance Simulator | YOK | HAYIR | Vizyon rezervuarı |
| Cost Predictor | YOK | HAYIR | Vizyon rezervuarı |

### 8.4 Teşhis ve OBD

> Görev kırılımı: `docs/OBD_DIAGNOSTIC_OS_ROADMAP.md` (FAZ 0–4).
> **Kod 25/26 tamam · suite 4074 yeşil · saha borcu 22 madde.**

| Özellik | Durum | Ürün hazır | Kanıt / eksik ana parça |
|---|---|---|---|
| Professional OBD OS | ENTEGRE | HAYIR | Core PID araçta akıyor (🟡 #65). **2026-07-15 KWP kanıtı** (rapor `8edd61a6`): protokol 5'te handshake `ok`, VIN okundu (`vinPresent`), bitmap `ok`, 15 PID, quality %100, 6.2 sn. **Extended `samples: []` — değer dolumu HÂLÂ YOK** (P1-1); hız PID'i bu araçta `0` dönüyor (aşağıya bkz.) |
| Fail-Closed Diagnostic Verdict | ENTEGRE | HAYIR | 🟡 #66 — regresyon yok gözlendi; **DTC'li araçta kanıt yok** (P0-5) |
| **Araç Değişimi Kurtarması** (yeni) | ENTEGRE | HAYIR | **Saha bug'ı çözüldü** (`7d95ed8`+`0eb98e2`): dongle aynı oturumda başka araca takılınca öğrenilmiş protokol sonsuza dek zorlanıyordu → sonsuz "Bağlanıyor…" → kullanıcı uygulamayı **öldürmek** zorundaydı. Kök: `if (_lastHandshakeSuccessAt != null) return;` (= "bu oturumda bağlandıysa araç değişmedi" varsayımı). Kademeli tolerans + **tek-kullanımlık** bypass. 🔴 #78 |
| **Bağlantıyı Sıfırla** (yeni) | ENTEGRE | HAYIR | `69d1972` — kullanıcı-tetikli tam sıfırlama (`resetObdConnection`): `stopOBD()`'nin dokunmadığı oturum-içi öğrenme/kimlik durumu (`_lastHandshakeSuccessAt`, `_addressConnectedOnce`, bypass, protocolCycle) temizlenir = uygulamayı öldürmenin etkisi, uygulama kapanmadan. **Kullanıcı beyanı en güçlü kanıt** → tahmin eşiği beklenmez. UI: OBD tarama modalı footer. 🔴 #78 |
| Protocol-Aware Timing | ENTEGRE | HAYIR | FAZ 0 kapsamı; saha borcu |
| Learned Protocol Preservation | **DOĞRULANDI** | HAYIR | 🟢 #67 Doblo/CAN'de kanıtlı; **Trafic/KWP kabulü açık** (P1-2) |
| DataGate Lifecycle | ENTEGRE | HAYIR | F0-3 kapsamı; mekanizma tetiklenmedi |
| Multi-ECU Discovery | ENTEGRE | HAYIR | `multiEcuScan` → `DTCPanel` + `verdictEngine` (production); saha kanıtı yok |
| Deep Vehicle Scan | İSKELET | HAYIR | §8.1 — handler yok → fazlar `skipped` |
| **Keşif Sonucu Dürüstlüğü (yeni/zaten kayıtlı kırılımı)** (yeni) | ENTEGRE | HAYIR | Saha şikâyeti "25 PID bulundu ama eklenmedi" **kusur değildi** — hepsi katalogda vardı (`status:'known'`), panel bunu söylemiyordu. Kırılım eklendi ve YALNIZ o taramanın PID'lerinden hesaplanır (`known+fresh+unclassified === bulunan` invaryantı testli); gözlemi olmayan PID **tahmin edilmez**. PID gözlemine aktif protokol işlenir; ECU adresi/ham yanıt bu katmanda gerçekten yok → boş kalır, uydurulmaz. 🔴 #241 |
| ECU Topology | YOK | HAYIR | Discovery çıktısına bağımlı |
| ECU Router | YOK | HAYIR | Vizyon rezervuarı |
| Standard DTC Mode 03/07/0A | ENTEGRE | HAYIR | `dtcService` + completeness; DTC'li araç borcu |
| Freeze Frame | ENTEGRE | HAYIR | FAZ 1; freeze frame'li araç yok |
| Readiness | ENTEGRE | HAYIR | Doblo'da 3/3 monitör gözlendi (🟡 #70) |
| UDS 0x19 | ENTEGRE | HAYIR | FAZ 3; üretici kodlu araç yok |
| UDS 0x22 | ENTEGRE | HAYIR | FAZ 3; saha borcu |
| KWP2000 | ENTEGRE | HAYIR | Trafic **kullanıcıda değil** → uzaktan rapor yolu. **2026-07-15 PR-OBD-KWP-1:** KWP acquisition yolu kapandı — boş-tx/6-hane KWP adresleme + **Servis 21** (ReadDataByLocalIdentifier) + profil `protocols` kapısı (CAN profili KWP hattında sorgulanmaz → COMM_ERROR fırtınası bitti) + `renaultTraficKwpProfile` (kanıt-dürüst: yalnız ISO kimlik DID'leri, LID'ler Servis 21 keşif taramasıyla sahada kanıtlanacak) + extended NO_DATA demotion (39/39 NO_DATA israfı biter, UI "VERMİYOR" gerçek nedeni gösterir) + `signalHub` tek otoriter okuma. 🔴 #79 |
| **Capability-Güdümlü Poll Listesi (oturum içi)** (yeni) | ENTEGRE | HAYIR | **Saha ölçümü 2026-07-31 (protokol 7):** bitmap `4100983B0011` → PID `0x11` DESTEKLENMİYOR, ama `0111` HER poll turunda soruluyor ve istisnasız `NO DATA` dönüyordu (boşa komut + tur başına bir `ECU_NO_RESPONSE`). Kök: `refinePidList` doğruydu ama çekirdek küme native'e YALNIZ `connectOBD` anında gidiyordu; araç desteğini handshake'te (bağlantıdan SONRA) bildirdiği için kanıt hiçbir zaman uygulanamıyordu ("bir sonraki reconnect'te kullanır"). Oturum-içi setter (`setCorePidSet`) + `setObdCorePids` köprüsü; **Classic ve BLE'ye birlikte** uygulanır (PR-OBD-BLE-1 dersi). Fail-soft: eski APK'da metot yok → atlanır, boş liste gönderilmez. 🔴 #240 |
| **VIN Adresi Keşfe Bağlı (29-bit)** (yeni) | ENTEGRE | HAYIR | **Saha ölçümü 2026-07-31:** protokol 7 / ECU `18DAF110` olan araçta `autoDidDiscovery` VIN'i sabit `7E0/7E8` ile istiyordu → her seferinde `NO DATA` → **29-bit araçlarda otomatik DID keşfi hiç başlamıyordu.** Artık önce ECU topolojisi keşfedilir, VIN o adreslerden okunur; `7E0/7E8` yalnız son çare. Yan etki kapatıldı: VIN yoklaması **3 deneme + 2 dk soğuma** ile bütçelendi (sınırsız tekrar çekirdek poll'u boğar, bayatlığı artırırdı). 🔴 #239 |
| ISO-TP | — | — | **Bilinçli yazılmadı** (ELM327 donanımda yapıyor) — gerekçe roadmap'te |
| Manufacturer-specific diagnostics | ENTEGRE | HAYIR | F3-1; üretici kodlu araç borcu |
| Renault/Dacia DF codes | ENTEGRE | HAYIR | Trafic borcu |
| Scan Completeness | İSKELET | HAYIR | Deep Scan'e bağımlı → üretecek tarama yok; UI yok |
| Confidence ve provenance | ENTEGRE | HAYIR | Confidence kanıttan türer (kilitli); **provenance twin'de eksik** |
| **Hız Kaynağı Çelişki Kapısı** (yeni) | ENTEGRE | HAYIR | `931b41c` — **ilk saha-kanıtlı zero-trust ihlali kapatıldı.** Rapor `8edd61a6`: GPS 38.1 km/h · OBD hız **0** · RPM 1434 · gaz %13 → araç giderken gösterge 0'da kaldı, sürüş/park modu **7 kez flip-flop**. Kök: worker çapraz kontrolü TEK YÖNLÜ (`raw > 10 && rpm === 0` reddediliyor, simetriği kabul) + kaynak seçimi donanımı **"kesin değer"** sayıyordu (yorumda yazılı). Yapısal sebep: KWP'de hız ABS ECU'sunda; motor ECU'su `41 0D 00` döner. `_hwSpeedContradicted()`: donanım <1 + GPS >15 + RPM >900 → o kaynağın güveni 0 → GPS kazanır. 🔴 #77 |
| Write Safety Gate | DOĞRULANDI | HAYIR | 7 kapılı karar modeli + testler; **native yazma bilinçli YAZILMADI** (F4-5) |
| Bounded diagnostic evidence | ENTEGRE | HAYIR | errorLedger + bounded payload; saha kanıtı yok |
| **İlk-Eşleştirme Sürekliliği** (yeni) | ENTEGRE | HAYIR | **Kök neden:** native'de `ACTION_PAIRING_REQUEST` alıcısı vardı ama `ACTION_BOND_STATE_CHANGED` alıcısı YOKTU; ilk eşleştirmede Android bonding ASENKRON tamamlanır (insan PIN'i OS dialog'una girer) ama tek timeout-sınırlı deneme (eski 15s + JS 8-15s `Promise.race`) bu pencereyi aşıp düşüyordu, bonding sonradan bitse bile yeniden tetik yoktu → kullanıcı 2. kez "Bağlan" demek zorundaydı. `PairingGate.waitStrategyFor` saf haritası + `OBDManager.waitForBondViaReceiver` (receiver-latch, `BOND_WAIT_TIMEOUT_MS=90s`, zero-leak) + JS `PAIRING_GRACE_TIMEOUT_MS` (yalnız kullanıcı-başlatmış+Classic+bonded-değil). `CONNECT_WITHOUT_PAIRING` bilinçli olarak dokunulmadı (insecure-only adaptörlerde regresyon riski). Test: JUnit 10/10 + `regression.guards.test.ts` 2 yeni kilit + tam suite 4378/4378 + tsc temiz. 🔴 #82 |
| **Yakıt Seviyesi Kalibrasyonu (PID 0x2F şamandıra eğrisi)** (yeni) | ENTEGRE | HAYIR | **Saha ölçümü 2026-08-04 (sürüş hâlinde, CDP ile ham ELM327 trafiği):** kullanıcı “depo full, uygulama yarım gösteriyor” dedi. `012F` → **`412F99`** → 0x99 = 153 → SAE J1979 (A×100/255) = **%60**; ekran 6/10 segmentte, yani gösterim ham veriyle **tutarlı**. Uygulamanın matematiği DOĞRU — kusur aracın şamandıra eğrisinin 0–255 aralığını kullanmamasında. **Asıl bulgu:** ölçek mekanizması (`_fuelCalibScale` + `loadObdFuelCalib`) 2026-07-16 Doblo vakasından beri koddaydı ama **`saveObdFuelCalib`'in üründe hiçbir çağıranı yoktu** → ölçek kalıcı olarak 1, kalibrasyon fiilen **ölü özellikti** (cihazda `obd:fuelCalib:*` anahtarının yokluğuyla doğrulandı). Yazma ucu bağlandı: ham 2F ölçekten ayrı tutulur (`_rawFuelPct`), `calibrateFuelLevel(actualPct)` kullanıcı beyanından katsayı türetir (kanıtsız/bayat/aralık dışı istek **reddedilir** — sahte “kalibre edildi” yok), Ayarlar → Araç panelinde ham↔gösterim↔katsayı salt-okunur gösterilir ve LAB Canlı Veri'deki 2F satırı artık **ham** değeri gösterir (kalibre araçta ölçeklenmiş sayıyı “PID 2F” diye sunmuyordu). 11 kilit testi (çift-ölçekleme yasağı dahil) + tsc temiz. 🔴 #383 |

### 8.5 Sürücü ve Yolculuk

| Özellik | Durum | Ürün hazır | Kanıt / eksik ana parça |
|---|---|---|---|
| **Resetlenebilir Yol Sayacı** | **ENTEGRE** | HAYIR | **RESETTABLE_TRIP_METER P0 (2026-08-02, kütük #323 — `COMPLETE_LOCAL`, saha borcu 🔴):** ana ekranda menzil kartının altındaki ölü `0 km KİLOMETRE` alanı gerçek, sıfırlanabilir kullanıcı sayacına dönüştürüldü. **YENİ MESAFE MOTORU YOK** — tek otorite `useUnifiedVehicleStore.odometer`, sayaç yalnız `odometer − baseline` FARKI (paralel haversine/Euler yazılmadı; `tripLogService` ve `longRoadModel.OdometryLedger` trip/oturum sınırında sıfırlandıkları için taban olamazdı). **Fail-closed reset kapısı:** yalnız hız KESİN `0` iken; hareket hâlinde veya hız bilinmiyorken (`SPEED_UNKNOWN`) reddedilir ve storage'a hiçbir şey yazılmaz — sürüşte popup/modal AÇILMAZ, onay kartın içinde satır içi fazdır ve araç hareket ederse kendiliğinden kapanır. **Reset kapsamı dar:** yalnız `distanceKm`/`startedAt`/`resetCount`; trip geçmişi · odometre store'u · long road oturumu · Fleet kayıtları ASLA silinmez (spy testleriyle kanıtlı). **Restart tuzağı yapısal kapalı:** restore sonrası ilk odometre okuması yalnız tohumlar, mesafeyi artırmaz → duplicate replay iki katına çıkmaz. Negatif delta hiç eklenmez (GPS sıçraması → fail-soft yeniden tohumlama + `confidence: MEDIUM`); `null`/`NaN` odometre kaydı değiştirmez (sahte 0 yok); bozuk kalıcı kayıt fail-closed reddedilir; `state !== READY` iken `— km`. **Dört temada da GERÇEKTEN mount edildi** (Expedition · Horizon · Tesla · Pro) — mount kanıtı ham kaynak testiyle kilitli; eski "Kilometre" etiketi hiçbir temada kalmadı. **Saha testi ile otorite ayrımı korundu:** iki taraf birbirine yazmaz (import grafiği testte kilitli), saha testi sayacı otomatik sıfırlamaz; LAB'da yalnız salt-okunur karşılaştırma ve **fark bir hata hükmü DEĞİLDİR**. **Gözlem:** CAROS LAB → Vehicle → Trip Engine → `User Trip Meter (resettable)` (12 alan, sıfırlama butonu YOK). Host kanıtı: `tripMeter.test.ts` 34/34, tam suite 10126/10127 (düşen tek test `regression.guards` K24 `_hasAnyField` timeout'u — **stash ile ölçüldü, ÖNCEDEN VARDI**), `tsc -b` temiz, lint 0. **AÇIK BORÇ:** gerçek araçta hareket-halinde-reddetme, process-kill sonrası süreklilik ve "reset trip geçmişini silmiyor" ölçütleri gözlenmedi → `SAHADA DOĞRULANDI` DEĞİL. Rapor: `docs/RESETTABLE_TRIP_METER_P0_REPORT.md` |
| Driver DNA | YOK | HAYIR | `smartDrivingEngine` sinyalleri temel olabilir. **ÖN KOŞUL ARTIK KURULDU:** sürücü kimliği ve trip atama temeli için bkz. *Sürücü Kimliği ve Atama* satırı — Driver DNA'ya geçmeden önce o temelin **sahada doğrulanması** şart (yanlış kişiye yanlış profil çıkarma riski) |
| **Sürücü Varlığı (Presence)** | **İSKELET** | HAYIR | **Driver Presence P1 (2026-07-30, kütük #233–#235 — `COMPLETE_LOCAL` · gerçek cihaz `BLOCKED_REAL_DEVICE`):** P0'ın bilinçli sınırını aşmak için **fiziksel varlık gözlemi** katmanı kuruldu — *assignment bir PLANDIR, presence bir GÖZLEMDİR*. P0'da bir yöneticinin ataması sürücünün direksiyonda olduğunu kanıtlamadığı için `VERY_HIGH` verilemiyordu; presence bu boşluğu doldurur ve NFC kanıtı atamayla uyuştuğunda `VERY_HIGH`'ı ilk kez mümkün kılar. **NFC/Bluetooth İMPLEMENTASYONU YAPILMADI** (kapsam gereği): sözleşme, tek otoriteli resolver ve DB katmanı hazır ama gözlem ÜRETEN hiçbir yol yok — bu yüzden attribution bugün **P0'daki gibi bit bit aynı** çalışır (PG P1 ile kanıtlı). **En kritik güvenlik kararı `HEAD_UNIT`'in kimlik doğrulayan kaynak SAYILMAMASI:** head unit `anon` rolünde çalışır ve kullanıcı oturumu yoktur; P0'da serbest sürücü seçimi bilinçli kapatılmıştı ve presence katmanı o kararı **arkadan dolanmamalıdır** — ekrandan gelen "ben Ahmet'im" beyanı taşınır ve LAB'da görünür ama sürücü kanıtı sayılmaz (tavan `LOW`). `PHONE` de doğrulanmış değil. **İstemci kendi güvenini yükseltemez:** bildirilen güven kaynağın tavanını aşamaz (head unit `VERY_HIGH` iddia etse `LOW`'a düşer). Resolver yedi karar üretir; **çelişki fail-closed**: NFC kartı Ahmet okutmuş ama araca Mehmet atanmışsa hangisinin doğru olduğu BİLİNEMEZ (kart ödünç verilmiş de olabilir) → `CONFLICTED`, sürücü yazılmaz. Atamasız fiziksel kanıt `PRESENCE_ONLY` olur ve plan desteği olmadığı için güven `HIGH` ile SINIRLANIR. **Süresiz presence YOK** (varsayılan 8 sa TTL, DB'de en fazla 24 sa CHECK) — sabah kart okutan sürücü akşamki yolculuğa bağlanmaz. Manuel sonuç presence tarafından da EZİLMEZ; 10× replay revizyonu şişirmez. Kanıt: **19/19 presence PG kontrolü** + **P0'ın 54/54 kontrolü 049 sonrası yeniden koşuldu ve geçti** (`PRESERVED`) + **45 kilit**, iki tsc temiz, build geçti, 049 idempotent. **AÇIK BORÇ:** NFC okuyucu ve BT eşleşme doğrulaması yok · presence yazma RPC'si yok (gerçek kaynak gelince `anon` erişimi çok dikkatli tasarlanmalı) · Fleet UI'da presence rozeti yok (yalnız LAB) · gerçek cihaz doğrulaması YOK. Rapor: `docs/DRIVER_PRESENCE_P1_REPORT.md`. |
| **Karar Kuyruğu Zamanlayıcısı (Reasoning Queue Scheduler)** | **İSKELET** | HAYIR | **MAVI Reasoning Scheduler P1 (2026-08-01, kütük #280 · #285–#287 — `COMPLETE_LOCAL` · üretim `NOT_VALIDATED` · gerçek araç `BLOCKED_REAL_VEHICLE`):** 058'in "karar üretimi artık otomatiktir" iddiası kuyruk yolu için **doğru değildi** — `run_mavi_reasoning_queue()` vardı ama onu çağıran hiçbir şey yoktu, dolayısıyla hot-path olayları (bağlantı · konum) ve düşmüş/yeniden denenecek işler **sonsuza kadar bekliyordu** (açık borç #280). 059 bu boşluğu kapattı ve **yerelde kanıtladı:** sessizlikten dönen bir araç olayı aynı işlem içinde `state=PENDING`/`started_at=NULL` ölçüldü, ardından zamanlanmış koşum onu **elle hiçbir dispatch olmadan** işledi (`processed=1`); `cron.job_run_details` art arda beş başarılı dakikalık koşum gösterdi. **ZAMANLAYICI KARAR ÜRETMEZ:** yalnız `run_mavi_reasoning_queue()` + `expire_mavi_reasoning()` **çağırır**; gövdesinde `mavi_reason(`, `ai_evidence`, `_reasoning_confidence` veya `SUPPORTED` görülürse migration DÜŞER (ikinci otorite yasağı hem migration doğrulamasında hem testlerde kilitli). **ÜÇ FAIL-CLOSED KURALI:** (1) **örtüşen koşum YOKTUR** — sabit anahtarlı advisory lock; önceki tik sürerken gelen tik iş yapmaz ve `SKIPPED_LOCKED` olarak **dürüstçe kaydedilir** (iki eşzamanlı oturumla gerçekten kanıtlandı); (2) **ölçülmeyen sayaç `0` DEĞİL `NULL`dır** — dört CHECK kısıtı sahte "0 iş işlendi" yazılmasını reddeder; (3) **koşum satırı önce `FAILED` açılır** — oturum ortada ölürse yarım iş sessizce kaybolmaz. **SAĞLIK ÜÇ DEĞERLİDİR:** zamanlanmamış→`false` (gerçek arıza) · hiç koşmamış→**`null`** · art arda hata→`false` · **aralık bilinmiyor→`null`** (tanınmayan cron ifadesinde gecikme ölçülemez, bu yüzden "sağlıklı" DENMEZ) · >3 aralık gecikme→`false`. Sıra bir kilittir: hata kapısı aralık kapısından ÖNCE gelir, yoksa düşen bir koşum belirsizliğe gömülürdü. CAROS LAB'a **Queue Scheduler** bölümü, Fleet Dashboard'a **Kuyruk Koşucusu** bölümü eklendi; ikisi de **karar yokken bile** gösterilir — koşucu yoksa "0 bekleyen iş" ile "işleri işleyecek kimse yok" ekranda aynı görünürdü. Sağlık RPC'si şirket/kişisel veri TAŞIMAZ ve oturumsuz BOŞ döner. Kanıt: **34/34 yeni PG kontrolü** + iki oturumlu örtüşme testi + 059 üç kez idempotent + **058 47/47 (üç ayrı koşumda, canlı cron ile yarış yok)** + **057 56/56** + **36 yeni TS + 10 yeni website kilidi**, kök 9725/9725 (449 dosya), website 965/965, iki tsc temiz, build geçti. **AÇIK BORÇ:** üretim Supabase'inde pg_cron açılmadı (deploy yasağı) · gerçek araç olayı zamanlanmış koşumla hiç karara bağlanmadı · `expire_ai_evidence()` hâlâ zamanlayıcısız · **`buildVehicleVerdict` taşıma çatalı AÇIK** (#286: kanıt/karar omurgası sunucuda, cihazda kanıt üreten ürün kodu yok, ama tanı verdisi çevrimdışı çalışmak zorunda) · website ESLint `src/**` ignore ediyor (#287). Rapor: `docs/MAVI_REASONING_SCHEDULER_P1_REPORT.md`. |
| **Karar Üretim Bağlantısı (Reasoning Production Wiring)** | **İSKELET** | HAYIR | **MAVI Reasoning Production Wiring P1 (2026-08-01, kütük #279–#284 — `COMPLETE_LOCAL` · gerçek araç `BLOCKED_REAL_VEHICLE`):** 057'nin karar motoru GERÇEK ÜRÜN AKIŞINA bağlandı. **HEDEF YEREL OLARAK KANITLANDI:** yalnız kanıt yazıp yolculuk kapatan, içinde HİÇBİR `mavi_reason` çağrısı olmayan bir koşum iki olay üretti (`TRIP_COMPLETED` → TRIP resolver, `EVIDENCE_ADDED` → VEHICLE resolver), ikisi de `COMPLETED` oldu ve biri `UNSUPPORTED` (güven `MEDIUM`) karar yazdı; ikincisi kanıtsız olduğu için dürüstçe `INSUFFICIENT_EVIDENCE` kaldı — *"veri yok, o hâlde sorun yok"* DENMEDİ. **12 GERÇEK OLAY BAĞLI:** yolculuk tamamlandı · DNA güncellendi · içgörü oluştu · araç kimliği/bağlantısı değişti · konum durumu değişti · sürücü doğrulaması/varlığı değişti · filo sağlığı güncellendi · kanıt eklendi/süresi doldu/geri çekildi. **BEŞ FAIL-CLOSED KURALI:** (1) **VARSAYILAN RESOLVER YOKTUR** — eşlenmemiş niyet `NULL` döner ve kuyruğa GİREMEZ; 057'nin 12 niyetinin tamamının eşlendiği migration doğrulamasında ÇAĞRILARAK sınanır, bilinmeyen niyet "en yakın" resolver'a düşmez; tanınmayan olay tipi de CHECK ile reddedilir; (2) **BOUNDED DEDUPE** — anahtar şirket+niyet+özne (olay tipi bilinçli olarak DÂHİL DEĞİL: aynı soru iki farklı olaydan gelirse tek kez sorulur); 20 tekrar tek iş açtı, `suppressed_count` 21 oldu ve bastırma sessizce yutulmadı; (3) **RESOLVER KARAR ÜRETMEZ** — yalnız öznesini doğrulayıp `mavi_reason`a yönlendirir; gövdesinde kanıt okuması, güven/çelişki çağrısı veya karar sabiti görülürse migration DÜŞER; özne yoksa karar UYDURULMAZ (`SKIPPED` + bounded gerekçe); (4) **HATA YALITIMI** — reasoning düşse bile trip yükleme, Evidence Engine, Fleet Insight ve DNA çalışmaya DEVAM EDER ama hata sessizce yutulmaz (`FAILED`·`RETRY_PENDING`·`REJECTED`·`SKIPPED`·`DEDUPED` + ≤5 üstel yeniden deneme); (5) **EŞZAMANLILIK** — `PENDING→RUNNING` geçişi atomik, ikinci işleyici `ALREADY_RUNNING` alır, koşucu `SKIP LOCKED` ve idempotent. **HOT-PATH KORUNDU:** bağlantı ve konum olayları yalnız GERÇEK durum geçişinde (10 dk sessizlik sonrası) üretilir ve karar üretimi telemetri yoluna SOKULMAZ (kuyruğa alınır, koşucu işler) — CLAUDE.md performans bütçesi ihlal edilmedi. CAROS LAB'a **Live Event Queue** (bekleyen·çalışan·tamamlanan·düşen·yeniden denenecek·reddedilen·atlanan·bastırılan + ortalama kuyruk/karar süresi + kuyruk sağlığı) ve Fleet Dashboard'a **4 kuyruk kartı** eklendi; kuyruk bölümü KARAR YOKKEN BİLE gösterilir ("hiç karar yok" ile "olaylar geliyor ama karara bağlanamıyor" farklı arızalardır) ve **hiç olay olmaması başarı sayılmaz**. **PARALEL KARAR OTORİTESİ TARAMASI (madde 11):** Reasoning Engine'i bypass eden **8 gerçek karar noktası** bulundu (`buildVehicleVerdict` · `buildDiagnosticVerdict` · `buildAiCoreVerdict` · `combineConfidence` — ağırlıklı KENDİ güven formülü, 057'nin en-zayıf-halka ilkesiyle doğrudan çelişiyor · `maintenanceBrain` · `fuelAdvisorService` · `smartCardEngine` · `predictionEngine`) ve **6 güvenlik/yetki kapısı** bilinçli istisna olarak gerekçelendirildi; **hiçbiri değiştirilmedi**, yalnız görünür kılındı. Kanıt: **47/47 yeni PG kontrolü** + **053–058 zinciri artan sırada temiz** + **40 TS + 12 website kilidi**, kök 9689/9689 (448 dosya), website 955/955, iki tsc temiz, build geçti, lint temiz, 058 idempotent. **AÇIK BORÇ:** üretim akışı gerçek araç verisiyle HİÇ çalışmadı · kuyruk koşucusu için zamanlayıcı YOK (hot-path olayları ve düşmüş işler bekler) · kanıt üretmeyen 6 olay karar tetikliyor ama çoğunlukla `INSUFFICIENT_EVIDENCE` çıkıyor (kapsam borcu) · 8 paralel karar otoritesi hâlâ yerinde. Rapor: `docs/MAVI_REASONING_PRODUCTION_WIRING_P1_REPORT.md`. |
| **Karar Otoritesi (MAVI Reasoning Engine)** | **İSKELET** | HAYIR | **MAVI Reasoning Engine P1 (2026-08-01, kütük #272–#278 — `COMPLETE_LOCAL` · gerçek araç `BLOCKED_REAL_VEHICLE`):** CAROS PRO'nun **TEK KARAR OTORİTESİ**. Bundan sonra hiçbir modül kendi kararını üretmeyecek; **LLM karar VERMEZ**, yalnız burada ZATEN VERİLMİŞ kararı doğal dile çevirir. Bu iddia yedi kapıyla kilitlendi ve **determinizm çağrılarak sınandı**: aynı defter + aynı istek → `toEqual` ile bit bit aynı karar, kanıt sırası sonucu değiştirmiyor. **ALTI SÖZLEŞME KURALI:** (1) **karar kanıtsız üretilemez** — *"veri yok, o hâlde sorun yok"* bir karar DEĞİLDİR; kanıtsız istek `INSUFFICIENT_EVIDENCE` olur ve DB CHECK'i kanıtsız `SUPPORTED`/`UNSUPPORTED` satırını reddeder (kanıt bağı metin listesi değil **gerçek FK**'dir); (2) **güven istemciden alınamaz** ve **formül KOPYALANMAZ** — 055'in `_evidence_weakest`/`_evidence_confidence` fonksiyonları ÇAĞRILIR (kopyalanırsa migration DÜŞER), TS tarafında da `aiEvidence`ten ithal edilir; tek kanıtlı karar `MEDIUM`u aşamaz, eksik kapsam güveni AŞAĞI çeker, hiçbir adım güveni yükseltemez ve sonuçlandırıcı olmayan karar daima `UNKNOWN` taşır (*"kararsızım ama eminim"* olamaz); (3) **çelişkili kanıtta karar ÜRETİLMEZ** — iki kaynağın çeliştiği yerde birini seçmek uydurmaktır; `VALUE_DIVERGENCE` (%10 sabit eşik, çağıran gevşetemez) ve `REVISION_DIVERGENCE` ayrı ayrı tanımlı, ölçümü olmayan kanıt çelişemez; (4) **süresi dolmuş kanıt karara katılmaz ama zincirden SİLİNMEZ**, süresi dolan kararın kendisi de silinmez ve kanıt bağı korunur (süre dolumu idempotent); (5) **replay yeni karar AÇMAZ** — kimlik = özne + niyet + **kanıt imzası** (zaman içermez); kanıt kümesi değişirse bu ARTIK BAŞKA bir karardır çünkü dayanağı başkadır; bastırılan tekrar sessizce yutulmaz, sayılır; (6) **UNKNOWN gerçek bir karardır** — niyet birden fazla adaya işaret ediyorsa motor KURA ÇEKMEZ. **Durum makinesi GERÇEKTEN yürür:** `NEW → ANALYZING → terminal`; `NEW → SUPPORTED` kestirmesi YOK, sonuçlanmış karar sessizce değiştirilemez, `REJECTED`/`EXPIRED` mutlak terminal. **Karar zinciri UYDURULMAZ:** `DECISION → EVIDENCE → FLEET_INSIGHT · DRIVER_DNA → TRIP → VEHICLE`; içgörü ucu `ai_evidence_chain`ten, DNA ucu `driver_dna`dan çözülür, çözülemeyen uç YAZILMAZ, okunamayan kanıt düğümü `resolved:false` ile GÖRÜNÜR kalır. **Tek veri kapısı:** motor yalnız `ai_evidence` okur (TS import kilidiyle sabit); `vehicles`/`vehicle_trips`/`driver_dna` yalnız tenant doğrulaması ve zincir ucu içindir, karar **başka bir karar otoritesine devredemez** (`_dna_status`·`_fleet_insight_confidence`·`_resolve_driver_*` çağrılamaz). **Karar İSTEMCİYE kapalı:** `mavi_reason` yalnız `service_role`, tablolar `authenticated` için salt-okunur, `anon` hiç göremez. CAROS LAB'a **MAVI Reasoning Engine** ekranı ve Fleet Dashboard'a **5 karar kartı** (Son Kararlar · Karar Güveni · Kanıt Durumu · Çakışmalar · Bilinmeyenler) eklendi ve kartlar `/dashboard/fleet/lab` sayfasına **gerçekten bağlandı** (bağlılık testle kilitli — 055/056'nın bağlanmamış kart borcu tekrarlanmadı). **Doğrulama sırasında GERÇEK bir kusur bulundu ve düzeltildi:** geçersiz durum geçişi sayacı trigger içinde artırılıp `RAISE` ediliyordu — exception artışı da geri alıyordu, yani *"sessizce yutulmaz"* iddiası fiilen çalışmıyordu; sayım, geçişi alt-işlemde yakalayan `mavi_reasoning_transition` sarmalayıcısına taşındı. Kanıt: **56/56 yeni PG kontrolü** + **053–056 zinciri 057 sonrası yeniden koştu** + **86 TS + 28 website kilidi**, website 942/942, iki tsc temiz, kök build geçti, lint temiz, 057 idempotent (üç kez uygulandı). **AÇIK BORÇ:** motor gerçek araç verisiyle HİÇ çalışmadı · karar üretimini tetikleyen üretim yolu YOK (şu an üretimde hiç karar üretilmiyor) · mevcut AI yüzeyleri (AI Mechanic · Driver Coach · Fleet Advisor · Predictive Maintenance · Trip/Diagnostic/Repair/Service Advisor · AI Negotiator · Vehicle Health Advisor) henüz bu motora TAŞINMADI — kural yalnız YENİ özellikler için bağlayıcı. Rapor: `docs/MAVI_REASONING_ENGINE_P1_REPORT.md`. |
| **Kanıt Üretim Bağlantısı (Evidence Production Wiring)** | **İSKELET** | HAYIR | **AI Evidence Production Wiring P1 (2026-08-01, kütük #267–#271 — `COMPLETE_LOCAL` · gerçek araç `BLOCKED_REAL_VEHICLE`):** 055 omurgası ÜÇ gerçek üretim kaynağına bağlandı: **Trip Metrics P2 · Driver DNA P1 · Fleet Intelligence P1**. Deep Scan · BlackBox · DTC · bakım tahmini · LLM **KAPSAM DIŞI** ve `EVIDENCE_ADAPTERS` bunu testle kilitler. **Kaynak modüller doğrudan kanıt YAZMAZ:** tek yol `_evidence_adapter_record` kapısıdır ve **kaynak sahipliği** orada uygulanır — bir adaptör başkasının kanıtını yazamaz (`FOREIGN_SOURCE`). **Trip:** yalnız KAPANMIŞ yolculuk; `UNAVAILABLE` alan kanıt üretmez; `ESTIMATED` ölçülmüş gibi İŞARETLENMEZ; 10× replay tek kanıt; **trip revizyonunda eski kanıt DEĞİŞMEZ** — `subject_revision` eklendi (055 modeli kırılmadan GENİŞLETİLDİ) ve eski kayıt `SUPERSEDED` olarak ilişkilendirilir. **DNA:** yalnız öğrenme eşiği aşılınca; viraj/akü kanıtı ASLA üretilmez (kaynak yok); tek genel sürücü puanı YOK; **`RETRACTED` DNA aktif güvenilir kanıt gibi kullanılmaz** (kanıtlar `SUPERSEDED`e düşer, silinmez); DNA metrik FORMÜLLERİ SQL'e KOPYALANMADI (tek otorite `driverDnaEngine.ts`). **Fleet Intelligence:** mevcut `fleet_insight_evidence` satırları TEK gerçek kaynaktır (paralel motor YOK); kanıt <3 iken ACTIVE zincir kurulmaz; replay duplicate zincir üretmez; `SINGLE_VEHICLE_ONLY` etiketi korunur; `BATTERY_TREND`/`MAINTENANCE_TREND` kanıt üretmez. **Hata yalıtımı:** adaptör hatası ana işlemi (trip yükleme/DNA/insight) BOZMAZ ama SESSİZCE YUTULMAZ — bounded durum (`REPORTED·DEDUPED·REJECTED·DEGRADED·RETRY_PENDING`) + **sınırlı** retry (≤5 deneme, üstel bekleme; tükenince `DEGRADED` kalır). CAROS LAB'a **Source Adapters** bölümü (adaptör durumları · son olay/sonuç · sayaçlar · öksüz zincir · kaynak kapsamı) ve Fleet UI'ya salt-okunur **kanıt listesi** eklendi ("Bu yolculuğun/profilin/içgörünün kanıtları"). Kanıt: **40/40 yeni PG kontrolü** + **048–055 zincirinin tamamı 056 sonrası yeniden koştu** + **27 TS + 6 website kilidi**, kök 9563/9563, website 914/914, iki tsc temiz, lint temiz, build geçti, 056 idempotent; Music Hub 157/157, AccountCleanup 174/174. **AÇIK BORÇ:** zincir gerçek araç verisiyle HİÇ beslenmedi (`WIRED` ≠ saha doğrulaması) · retry zamanlayıcısı yok · kanıt kartları sayfalara bağlanmadı · kapsam dışı kaynaklar bağlanmadı · kalıcı secret-scan harness'ı yok (bu turda ad-hoc koşuldu, bulgu yok). Rapor: `docs/AI_EVIDENCE_PRODUCTION_WIRING_P1_REPORT.md`. |
| **AI Kanıt Omurgası (AI Evidence Engine)** | **İSKELET** | HAYIR | **AI Evidence Engine P1 (2026-08-01, kütük #262–#266 — `COMPLETE_LOCAL` · gerçek araç `BLOCKED_REAL_VEHICLE`):** CAROS PRO'daki BÜTÜN AI sistemlerinin ortak omurgası. Bugün sistem yalnız veri topluyor; yarın Mavi'nin söylediği HER cümle buradaki bir kanıta geri izlenebilecek — `AI_ANSWER` bilinçli olarak zincirin tüketici listesindedir, yani kanıt bağı olmayan bir AI çıktısı sistemin AÇIKLAYAMAYACAĞI bir iddiadır. **BU PAKET AI CEVABI ÜRETMEZ** (5 kilitle): LLM/model/tahmin/öneri YOK ve **kanıt bir CÜMLE DEĞİLDİR** — `title`/`message`/`explanation` kolonu DB'de eklenirse migration DÜŞER. **BEŞ SÖZLEŞME KURALI:** (1) **kaynaksız kanıt ACTIVE olamaz** (`SOURCE_UNKNOWN` hem CHECK hem TS kapısıyla reddedilir; öznesiz ve ölçümsüz kayıt da öyle — reddedilenler SİLİNMEZ, gerekçesiyle saklanır); (2) **güven kanıttan bağımsız YAZILAMAZ** — `EvidenceInput`ta `confidence` alanı YOKTUR ve sunucu istemcinin yazdığını YOK SAYIP yeniden türetir: kaynak · ölçüm kalitesi · örnek sayısının en zayıf halkası, **tek gözlem MEDIUM'u aşamaz**; (3) **kanıt DEĞİŞMEZDİR** — özne/kaynak/kategori/metrik/doğuş anı güncellenemez ve **bir modül BAŞKASININ kanıtını değiştiremez**; (4) **süresi dolan kanıt SİLİNMEZ** (`EXPIRED`) — geçmiş bir iddianın dayanağı yok edilirse o iddia açıklanamaz hâle gelir; (5) **UNKNOWN gerçek bir cevaptır** — kapsam oranı kanıt yoksa `null`dır (0 DEĞİL: "sıfır ölçtük" ile "hiç bakmadık" farklı şeylerdir). **Birleştirme:** kimlik zamanı İÇERMEZ → aynı kanıt ikinci kez açılmaz, `refreshCount` artar ve **ilk kanıt zamanı korunur**. **Zincir:** `get_evidence_chain()` ile tek tıkla bir çıktının dayandığı kanıtlar, ters yönde bir kanıtın beslediği çıktılar okunur; **var olmayan kanıta bağ kurulamaz**. **Kapsam:** beklenen kategoriler sabittir ve gerçeğe göre AŞAĞI ÇEKİLMEZ; eksikler tek tek listelenir. CAROS LAB'a **AI Evidence Engine** ekranı (sayaçlar · kaynak dağılımı · zincir · kapsam · bütünlük bayrağı) ve Fleet Dashboard'a **4 kanıt kartı** eklendi (Kapsam · Kalite · Süresi Dolmuş · Kanıtı Olmayan). Kanıt: **38/38 yeni PG kontrolü** + **048 (54/54) · 049 (20/20) · 050 (27/27) · 051 (22/22) · 052 (30/30) · 053 (25/25) · 054 (31/31) 055 sonrası yeniden koştu** + **46 TS + 14 website kilidi**, kök 9536/9536, website 908/908, tsc temiz, lint temiz, build geçti, 055 idempotent. **AÇIK BORÇ:** omurga gerçek veriyle hiç dolmadı · kanıt ÜRETEN entegrasyon YOK (DNA/FI/trip/deep scan bağlanmadı) · süre dolumunu çağıran zamanlayıcı yok · kanıt kartları sayfaya yerleştirilmedi · head unit↔sunucu köprüsü yok. Rapor: `docs/AI_EVIDENCE_ENGINE_P1_REPORT.md`. |
| **Filo Zekâsı (Fleet Intelligence)** | **İSKELET** | HAYIR | **Fleet Intelligence Engine P1 (2026-08-01, kütük #257–#261 — `COMPLETE_LOCAL` · gerçek araç `BLOCKED_REAL_VEHICLE`):** Klasik filo takibi "ne oldu" gösterir; bu katman *"ne DEĞİŞİYOR, hangi KANITLA, ne kadar EMİN olabiliriz"* sorusunu cevaplar. **BU PAKET AI ÜRETMEZ** (5 kilitle): LLM/model/tahmin/öneri YOK ve **insight bir CÜMLE DEĞİL KANIT KÜMESİDİR** — `title`/`message`/`recommendation` alanı hem TS modelinde hem DB'de YASAK (migration doğrulaması bu kolonlar eklenirse DÜŞER). Bir içgörünün hangi araçlardan, sürücülerden, yolculuklardan ve metriklerden oluştuğu `fleet_insight_evidence`'ta satır satır izlenebilir. **KANITSIZ İÇGÖRÜ OLUŞMAZ:** kanıt <3 iken `ACTIVE` olamaz ve DB trigger'ı bunu son savunma olarak reddeder. **TEK ARAÇTAN `HIGH` ÇIKMAZ** (pazarlıksız): tek araç kanıtı `MEDIUM` tavanına takılır ve `SINGLE_VEHICLE_ONLY` damgası taşır; ikinci araç kanıtı gelince damga kalkar. **Ölçülmemiş kanıt kabul edilmez** (`value=null`+`UNKNOWN`) — `0` gibi davranmaz; **aynı kanıt iki kez birikmez** (replay) ve **aynı konu ikinci içgörü açmaz** (dedupe). **Trend** iki pencerede de ≥5 örnek ve ≥2 araç ister (iki noktadan trend çıkarmak gürültüyü bilgi sanmaktır); %10 altı `FLAT`. **Filo sapması ARAÇ BAZINDA DEĞİL** filo düzeyindedir ve her kanıt kaç araçtan geldiğini taşır; sapma bir SUÇLAMA değildir (mevsim/güzergâh da değişmiş olabilir) → yorum ÜRETİLMEZ. **Filo sağlığında TEK PUAN YOK:** 6 boyut ayrı durur, ölçülemeyen boyut `UNKNOWN` + endeks `null` kalır ve DB CHECK'i "bilinmiyor ama 0.4" çelişkisini reddeder; `overall_score` kolonu eklenirse migration DÜŞER. **Kapsam** bir başarı değil BİLGİ ölçüsüdür: düşük kapsam "filo kötü" değil **"bilmiyoruz"** demektir (araç yoksa `null`, 0 değil). **Kanıt kaynağı olmayan 2 tip BEYAN EDİLDİ:** `BATTERY_TREND` (voltaj trip'te yok) ve `MAINTENANCE_TREND` (servis kaydı yok) — sıcaklıktan "bakım gerekiyor" çıkarmak tahmindir, üretilmez. CAROS LAB'a **Fleet Intelligence** ekranı (insight/kanıt/trend/bilinmeyen sayaçları · sağlık boyutları · sapma kanıtı · kapsam · öğrenme yaşı · her içgörünün kanıt satırları) ve Fleet Dashboard'a **6 kart** eklendi (kanıt yoksa boş pano değil GEREKÇE). Kanıt: **31/31 yeni PG kontrolü** + **048 (54/54) · 049 (20/20) · 050 (27/27) · 051 (22/22) · 052 (30/30) · 053 (25/25) 054 sonrası yeniden koştu** + **41 TS + 14 website kilidi**, kök 9490/9490, website 894/894, tsc temiz, lint temiz, build geçti, 054 idempotent. **AÇIK BORÇ:** gerçek yolculuklardan üretilmiş TEK içgörü yok · içgörü üreten periyodik iş YOK (tablolar elle doluyor) · akü/bakım için kaynak yok · dashboard kartları sayfaya yerleştirilmedi · head unit↔sunucu köprüsü yok. Rapor: `docs/FLEET_INTELLIGENCE_ENGINE_P1_REPORT.md`. |
| **Sürücü DNA (Driver DNA)** | **İSKELET** | HAYIR | **Driver DNA P1 (2026-08-01, kütük #252–#256 — `COMPLETE_LOCAL` · gerçek araç `BLOCKED_REAL_VEHICLE`):** *Bu bir puanlama sistemi DEĞİLDİR* — tek bir "sürücü puanı" bilinçli olarak üretilmez; amaç zaman içinde KANITLA oluşan sürüş karakteridir. **BU PAKET AI ÜRETMEZ** (bağlayıcı, 4 kilitle): model/tahmin/öneri/doğal dil yok, `fetch`/LLM importu yasak, `score`/`rating` alanı yok, sürücü ETİKETLENMEZ — üretilen şey AI'nin GELECEKTE güvenle kullanacağı kanıt altyapısıdır. **14 bileşen** (yumuşaklık · agresiflik · yakıt disiplini · mekanik duyarlılık · gece · şehir içi · şehirler arası · rölanti · fren · hızlanma · viraj · motor · akü · tutarlılık), her biri `MEASURED`/`DERIVED`/`UNKNOWN` provenance + örnek sayısı + kanıt mesafesi taşır; `UNKNOWN` metrik DAİMA `null` değer taşır (sahte 0 YASAK). **EN ÖNEMLİ DÜRÜSTLÜK KARARI:** istenen bileşenlerden ikisi bugün ÖLÇÜLEMEZ (`CORNERING_STYLE` için yanal ivme, `BATTERY_CARE` için voltaj trip modelinde YOK) → hızdan viraj türetmek mümkündü ama UYDURMA olurdu; kalıcı `UNKNOWN` + `NO_EVIDENCE_SOURCE` olarak BEYAN edildi ve testle kilitlendi. **Güven motoru:** 5 yolculuk + 50 km eşiğinin altında DNA OLUŞMAZ (metrik listesi BOŞ döner); "çok veri ≠ çok kanıt" — 200 yolculuk hiçbir sinyal ölçülmemişse güven `UNKNOWN`, metriklerin yarısı bilinmiyorsa `LOW`. **Öğrenme:** 1 / 10 / 100 / 1000 eşikleriyle `NASCENT→DEVELOPING→ESTABLISHED→MATURE` (hem TS hem PG'de kilitli). **Sapma:** taban ve son pencere karşılaştırılır; iki pencerede de ≥5 örnek yoksa KARAR YOK, %25+ değişimde `DRIFTING` + kanıt (hangi metrik, hangi değerden hangi değere, kaç örnekle). Sapma bir SUÇLAMA değildir — yorum üretilmez. **Araç etkisi TAHMİNDİR** ve `estimated: true` tip seviyesinde sabittir; kanıt yoksa endeks `null` ("etkisi yok" DEĞİL, "bilinmiyor"). **PG (053):** sürücü×şirket başına tek DNA · her sinyalin KENDİ sayacı (ölçülmemiş alan `0` sayılmaz) · `dna_trip_single_owner` ile replay kilidi · sürücü değişiminde katkı GERİ ALINIR ve `integrity_state='RETRACTED'` ile GİZLENMEZ · cross-tenant ve devir sızıntısı kapalı · **metrik formülü SQL'e KOPYALANMADI** (iki otorite yasağı, migration doğrulaması bunu zorlar). CAROS LAB'a **Driver DNA** ekranı (learning level · confidence · DNA yaşı · metrik/bilinmeyen sayısı · drift + kanıt · araç etkisi TAHMİN rozetiyle) ve Fleet UI'ya **DNA kartı** eklendi (eşik altında BOŞ KART değil GEREKÇE). Kanıt: **25/25 yeni PG kontrolü** + **048 (54/54) · 049 (20/20) · 050 (27/27) · 051 (22/22) · 052 (30/30) 053 sonrası yeniden koştu** + **41 TS + 14 website kilidi**, kök 9449/9449, website 880/880, tsc temiz, lint temiz, build geçti. **AÇIK BORÇ:** DNA gerçek araç yolculuklarıyla HİÇ dolmadı · viraj/akü için kanıt kaynağı yok · sürücü değişiminde sapma pencereleri tam geri alınamıyor · DNA kartı sayfaya yerleştirilmedi · head unit↔sunucu okuma köprüsü yok. Rapor: `docs/DRIVER_DNA_P1_REPORT.md`. |
| **Sürücü Kimlik Doğrulama (Driver Authentication)** | **İSKELET** | HAYIR | **Driver Authentication P1 (2026-07-31, kütük #247–#251 — `COMPLETE_LOCAL` · gerçek cihaz `BLOCKED_REAL_DEVICE`):** *Presence bir GÖZLEMDİR, Authentication bir KANITTIR.* Bir NFC kartın okunması **kartı** kanıtlar, **kişiyi** değil (kart ödünç verilebilir/kopyalanabilir/çalınabilir) — 049'daki "kart = kişi" varsayımı bir kimlik doğrulaması DEĞİLDİ. **⚠️ POLİTİKA DEĞİŞTİ (bilinçli):** presence artık **TEK BAŞINA `VERY_HIGH` ÜRETEMEZ** (tavan `HIGH`); en yüksek güven yalnız **kimlik doğrulaması + fiziksel varlık + AYNI sürücü** birlikteyken mümkündür. 049'un P6 kilidi KALDIRILMADI, yeni doğru davranışa TAŞINDI ve yanına P6b eklendi ("kimlik doğrulanmadan VERY_HIGH VERİLMEZ"); pozitif senaryo 052 T5'te kilitli. **RESOLVER'LAR DEĞİŞMEDİ:** `_resolve_driver_presence` ve `_resolve_trip_driver` tek satır bile düzenlenmedi — presence otoritesi hâlâ `PRESENCE_CONFIRMED` + kendi güvenini üretir; tavan YALNIZ kompozisyon katmanında (`_trip_attribution_trigger`) uygulanır. **Kanonik model:** `driverId · vehicleId · authenticationSource · authenticationLevel · verifiedAt · expiresAt · sessionId`. Kaynak tavanları: NFC/PIN → `VERIFIED`, BLUETOOTH/PHONE → `PARTIAL` (cihaz yakınlığı kişiyi kanıtlamaz); **`HEAD_UNIT` bilinçli olarak YOK** (anon rolde kimlik iddiası kanıt olamaz). **İstemci seviyesini yükseltemez** — tavan hem TS'te hem SUNUCUDA uygulanır (`_authentication_write_guard` seviyeyi DÜŞÜRÜR). **`sessionId` ZORUNLUDUR** ve replay kilidinin dayanağıdır: `vda_session_unique` ile bir oturum şirket içinde tek kez kullanılabilir; 24 saatten eski mesaj ve gelecek tarihli kayıt (saat oynatma) REDDEDİLİR. **Trust katmanı** beş karar üretir (`VERIFIED_PRESENCE` · `PRESENCE_ONLY` · `AUTHENTICATION_ONLY` · `TRUST_CONFLICT` · `NO_TRUST`); kimlik ile varlık farklı kişiyi gösterirse **fail-closed** (sürücü YAZILMAZ) ve doğrulama **zayıf bir gözlemi GÜÇLENDİRMEZ**, yalnız `VERY_HIGH` kapısını açar. Kanıtsız durumda **P0 atama modeli AYNEN** çalışır. CAROS LAB'a **Driver Authentication** ekranı eklendi (authority state · source · level · expires · session age · ret sayaçları); PIN/kart numarası/token ve TAM oturum kimliği taşınmaz (`ses:xxxxxxxx`). Kanıt: **30/30 yeni PG kontrolü** + **048 (54/54) · 049 (20/20) · 050 (27/27) · 051 (22/22) 052 sonrası yeniden koştu** + **42 yeni TS kilidi**, kök 9408/9408, website 866/866, tsc temiz, lint temiz, build geçti, 052 idempotent. **AÇIK BORÇ:** gerçek kaynak (NFC/PIN/BT/telefon) YOK · doğrulama YAZAN yüzey YOK (bugün `VERY_HIGH` kapısı KAPALI) · `VERY_HIGH` gerçek araçta hiç üretilmedi · replay kilitleri gerçek trafikte sınanmadı · geçmiş `VERY_HIGH` kayıtları geriye dönük hesaplanmadı (bilinçli). Rapor: `docs/DRIVER_AUTHENTICATION_P1_REPORT.md`. |
| **Sürücü Varlığı Geçmişi (Presence History)** | **İSKELET** | HAYIR | **Driver Presence History P1 (2026-07-30, kütük #236–#238 — `COMPLETE_LOCAL` · gerçek cihaz `BLOCKED_REAL_DEVICE`):** P1 "şu an kim araçta?" sorusunu cevaplıyordu ve yalnız TEK gözlem tutuyordu; bu tur *"varlık ZAMAN İÇİNDE nasıl değişti?"* sorusunu cevaplayan **segment defterini** ekler (kim geldi · ne kadar kaldı · yerine kim geçti · kaç kez el değiştirdi). **MEVCUT RESOLVER DEĞİŞTİRİLMEDİ** — `resolveDriverPresence` ve `_resolve_driver_presence` bu turda tek satır bile düzenlenmedi; geçmiş bir **KARAR katmanı değil DEFTERDİR** ve attribution'ı ne besler ne değiştirir (migration doğrulaması trigger gövdesinde `presence_history` geçmesini bile YASAKLAR). **Dedupe segment kimliğiyle kurulur** (`araç · sürücü · kaynak`): aynı kartın 10 kez okutulması 10 satır değil, süresi uzayan TEK satırdır (`refresh_count` artar) — DB'de ayrıca `vdph_observation_unique` kısıtıyla fail-closed kilitlenir. **Süresi dolan segment düzgün kapanır:** kapanış anı gözlemin TTL'idir, okuma anı DEĞİL; `SUPERSEDED` · `TTL_EXPIRED` · `CLEARED` gerekçesi zorunludur ve **yarım kapanış CHECK ile yasaktır** (kapandı ama süresi yok / süresi var ama gerekçesi yok kabul edilmez). **Açık segmentte süre `NULL`'dır — sahte `0` YASAK**; kapanış anı bilinmiyorsa uydurulmaz. Bir araçta aynı anda **tek açık segment** olabilir (kısmi unique index). Çevrimdışı replay için geç gelen eski gözlem, daha yeni segmenti bozmadan **kapalı** kaydedilir. **Fleet UI'da "Son görülen sürücü" alanı eklendi** — ama bu bir GÖZLEMDİR, trip attribution kararı değildir ve **doğrulanmamış kaynak isim GÖSTERMEZ**: `list_vehicle_presence_history` HEAD_UNIT/PHONE kayıtlarında `driver_id`/`driver_name` alanlarını sunucuda NULL'lar (049'da kapatılan kapı UI'dan arkadan dolanılamaz), istemci ikinci kapı olarak aynı düşürmeyi tekrarlar. CAROS LAB'a ayrı **Presence History** ekranı eklendi (current · previous · duration · switch count); kişisel veri taşımaz (`drv:xxxxxxxx` / `veh:xxxxxxxx`), gözlem üretmez. Kanıt: **27/27 yeni PG kontrolü** + **049'un 19/19'u ve P0'ın 54/54'ü 050 sonrası yeniden koşuldu ve geçti** + **77 yeni kilit** (53 head unit + 24 website), kök 9310/9310, website 866/866, iki tsc temiz, lint temiz, build geçti, 050 idempotent. **AÇIK BORÇ:** gözlem üreten kaynak hâlâ YOK (NFC/BT) → defter gerçek veriyle hiç dolmadı · TTL kapanışı TEMBEL (timer yok; okuma yüzeyi gerçeği söyler ama satır gecikmeli kapanır) · head unit tarafında araç kimliği bağlanmadı (`vehicleId=null`) · gerçek cihaz doğrulaması YOK. Rapor: `docs/DRIVER_PRESENCE_HISTORY_P1_REPORT.md`.<br><br>**Driver Presence Durability P2 (2026-07-31, kütük #242–#246 — `COMPLETE_LOCAL` · gerçek cihaz `BLOCKED_REAL_DEVICE`):** defter **kanıt** hâline getirildi; resolver yine tek satır değişmedi ve defter attribution'a HÂLÂ bağlı değil (PG `G3` kilidi: kapanmış geçmiş kaydının olduğu aralıkta resolver hâlâ `NO_PRESENCE` döner — defter fallback ÜRETMEZ). **Kapanış idempotensi:** P1'de kapatma UPDATE'lerinde `expired_at IS NULL` koşulu YOKTU → bakım fonksiyonu segmenti `TTL_EXPIRED` ile kapattıktan sonra trigger AYNI segmenti `SUPERSEDED` ile yeniden kapatıp kapanış anını ve süresini sessizce değiştirebilirdi (kapanmış satırı değişen bir defter kanıt olmaktan çıkar). Artık tüm kapatmalar idempotent, yarışta **ilk kapanış kazanır** ve `trg_presence_history_closure_immutable` kapanmış satırın değişmesini DB seviyesinde reddeder; TS'te de `closeEntry` kapanmışı aynen döndürür ve `isOpenSegment` artık `closeReason`'a da bakar. **Eşzamanlılık:** araç başına `pg_advisory_xact_lock` + açık segment `FOR UPDATE` (eskiden kilitsiz okunuyordu → aynı araca eşzamanlı iki gözlemde ikincisi kısmi unique index'e takılıp gözlemin TAMAMINI geri aldırıyordu); bakım fonksiyonu `FOR UPDATE SKIP LOCKED` ile tıkanmaz. Ölçüldü: 12 segment · 3 paralel çağrı → `12+0+0`; 5 satır kilitliyken çağrı **7 döndü ve beklemedi**, kilit kalkınca **5**. **Araç bağı:** `company_id` istemcinin İDDİASIYDI → A şirketi B'nin aracına gözlem yazabilir ve gözlem yanlış tenant'ta görünürdü; `_presence_binding_guard` beş kapıyı fail-closed kapatır (araç yok · şirketsiz araç · şirket uyuşmazlığı · sürücü yok · cross-tenant sürücü). TS tarafında segmentin `vehicleId`'si artık YALNIZ doğrulanmış bağdan yazılır; bağ yokken gözlem REDDEDİLİR. **Kalıcılık:** defter `safeStorage`'a sürümlü şemayla yazılır, tembel hidratlanır (timer YOK); yeniden başlatmada açık segment · `detectedAt` · `refreshCount` KORUNUR, tekrar oynatılan gözlem `replayCount` artırır ama defteri DEĞİŞTİRMEZ. Bozuk/eski kayıt ONARILMAZ — gerekçesiyle reddedilir. CAROS LAB'a **Durability** bölümü eklendi (persistenceState · lastRestore · expiryMode=`LAZY_ON_ACCESS` · expiredSegmentCount · vehicleBindingState · lastFailure) — timer olmadığı dürüstçe yazılır, sahte 'worker çalışıyor' YOK. Kanıt: **22/22 yeni PG kontrolü + 4/4 eşzamanlılık** + **049'un 19/19'u ve 050'nin 27/27'si 051 sonrası yeniden koştu** + **39 yeni TS kilidi**, kök 9366/9366, website 866/866, tsc temiz, lint temiz, build geçti, 051 idempotent. **AÇIK BORÇ:** gerçek NFC/BT gözlemi hâlâ YOK · TTL kapanışını çağıran zamanlayıcı YOK · araç bağı üretimde hiç kurulmadı · kalıcılık gerçek head unit'te sınanmadı. Rapor: `docs/DRIVER_PRESENCE_DURABILITY_P2_REPORT.md`. |
| **Sürücü Kimliği ve Atama** | **ENTEGRE** | HAYIR | **Fleet Driver Identity & Assignment P0 (2026-07-30, kütük #226–#232 — `COMPLETE_LOCAL` · gerçek araç `BLOCKED_REAL_VEHICLE` · head unit `BLOCKED_REAL_DEVICE`):** "Bu aracı, bu zaman aralığında, bu yolculukta **kim** kullanıyordu?" sorusu artık cevaplanabilir — cevap kanıtlanamıyorsa **`UNKNOWN`**. **Preflight'ta bulunan gerçek:** mevcut "sürücü" kavramı `vehicles.driver_name` adlı **serbest bir TEXT kolonuydu** — kimliğe bağı, zaman aralığı, denetimi, tenant güvenliği ve trip bağı YOKTU; Fleet UI onu `driver_name ?? '—'` diye gösteriyordu. O kolon **değiştirilmedi** (geriye uyum) ama sürücü otoritesi artık `fleet_drivers` + `vehicle_driver_assignments` + trip attribution zinciridir. **Yedi kavram AYRI tutuldu** (Auth User · Company Member · Vehicle Owner · Observer · Driver Profile · Driver Assignment · Trip Attribution) ve tek bir `user_id` alanına indirgenmedi: *bir kişinin Fleet hesabı olması onu sürücü YAPMAZ · aracın sahibi olmak her trip'in sürücüsü olmak DEĞİLDİR · araca erişebilmek onu sürmek DEĞİLDİR.* **`linked_user_id` NULLABLE** — şoförlerin çoğunun uygulamada hesabı yoktur; hesap zorunlu kılınsaydı gerçek sürücü kaydı hiç oluşturulamazdı. Atama **anlık alan değil ZAMAN ARALIĞIDIR** (yarı-açık `[starts_at, ends_at)`; bitişik aralık çakışma değil, vardiya devri). Çakışma iki katmanda kapalı: kısmi UNIQUE index + `pg_advisory_xact_lock` (`btree_gist` **bilinçli kullanılmadı** — uzantı izni yoksa migration tümden düşerdi). **Attribution kuralı:** tam kapsayan tek atama → `ATTRIBUTED`/`HIGH`; kısmi kapsama → kesin sürücü **YAZILMAZ**; çoklu → `CONFLICTED`; yok → `UNKNOWN`. **Owner/admin/son-kullanıcı fallback YASAK** — `_resolve_trip_driver` gövdesinde `auth.uid()`, `owner_id` ve `profiles` HİÇ geçmez (yapısal kilit). **`VERY_HIGH` verilmiyor:** bir yöneticinin ataması sürücünün direksiyonda olduğunu KANITLAMAZ (otomatik `HIGH`, manuel `MEDIUM`); `VERY_HIGH` ancak fiziksel kimlik kanıtı (NFC/doğrulanmış seçim) gelince mümkün. **Head unit'te sürücü seçimi BİLİNÇLİ olarak açılmadı** — `anon` rolünde güvenli kimlik doğrulama yok; serbest seçim *"kim olduğunu iddia eden herkes o kişi sayılır"* demek olur ve attribution'ı kanıt olmaktan çıkarırdı. Yalnız salt-okunur minimum özet (`get_active_driver_assignment`); sürücü listesi api_key ile ÇEKİLEMEZ, ehliyet/telefon ALINAMAZ. Snapshot **süresiz cache tutmaz** (12 sa → `STALE`; bayat snapshot sürücü kanıtı DEĞİLDİR). **Trip Metrics P2 korunmak için `upload_vehicle_trip` DEĞİŞTİRİLMEDİ** — attribution `BEFORE INSERT OR UPDATE` trigger'ıyla çözüldü: yükleme yolundan bağımsız, **trip zamanını** kullanır (replay zamanını değil), `DUPLICATE`'te tetiklenmez. Manuel düzeltme `trip_key`/metrik/trip revizyonunu **BOZMAZ**, önceki sonuç `trip_driver_attribution_revisions`'ta korunur, replay ile **ezilmez**. Araç devri mevcut transfer RPC'sine dokunulmadan **trigger** ile kapatıldı (açık atamalar `COMPLETED`, cross-tenant sürücü sızıntısı yok). Gizlilik: tam ehliyet **hiç UI'a gelmez** (`•••1234`), telefon yalnız admin'e, **CAROS LAB'da sürücü adı bile yok** (yalnız `drv:a1b2c3d4`). Kanıt: **54 gerçek-PostgreSQL** kontrolü (RPC'ler ÇAĞRILARAK) + **70 kilit**, iki tsc temiz, `npm run build` geçti, 048 idempotent. **Bu turda kendi fail-closed denetimim bir yanlış alarm verdi:** `pg_get_functiondef` YORUMLARI da döndürür — "employee_code ALAMAZ" açıklaması sızıntı sanılıp migration düştü; denetim önce yorumları temizleyecek sonra **davranışa** bakacak şekilde güçlendirildi (P2'deki `speedVio·lat·ions` tuzağının aynısı: *metin araması niyet kanıtı değildir*). **AÇIK BORÇ:** gerçek araç/head unit doğrulaması YOK · head unit sürücü seçimi ve fiziksel kimlik (NFC/BLE/telefon) bağlı değil · araç detayında "ata/bitir" UI düğmeleri sonraki tur · bireysel araçlar (owner_id) kapsam dışı · `driver_name` göçü yapılmadı · 040–048 hiçbir ortama uygulanmadı. Rapor: `docs/FLEET_DRIVER_IDENTITY_ASSIGNMENT_P0_REPORT.md`. |
| Driver-vs-Vehicle Analysis | YOK | HAYIR | Vizyon rezervuarı |
| AI Driving Coach | YOK | HAYIR | Driving Style'a bağımlı |
| Driving Style Analysis | İSKELET | HAYIR | Mod tespiti tüketiliyor; **stil skorlaması yok** |
| Journey Intelligence | **ENTEGRE** | HAYIR | **Trip Metrics P2 (2026-07-30, kütük #219–#225 — `COMPLETE_LOCAL` · gerçek araç `BLOCKED_REAL_VEHICLE`):** P1'in beş metrik borcu kapandı. **Yakıt artık gerçekten ÖLÇÜLEBİLİYOR** — OBD seviye farkı yedi kapıdan geçerse `MEASURED` (başlangıç/bitiş okuması · ikmal belirtisi yok · OBD sürekliliği · negatif olmayan · fiziksel makullük · mesafe); **yüzde ölçümü litreden AYRI taşınır** (litre daima `DERIVED` — depo kapasitesi kullanıcı girdisi, üretici verisi değil). Kapılar geçilemezse sabit `8,5 L/100 km` kullanılır ama **daima `ESTIMATED`** ve `fuel_reject_reason` ile **gerekçesi yazılır**. Maliyet trip **başında** alınan **fiyat snapshot'ına** bağlı: trip kapandıktan sonra fiyat değişse geçmiş maliyet DEĞİŞMEZ. Sert fren/hızlanma **artık kalıcı** (2 s debounce — tek manevra 3–5 kez sayılmıyor; kaynak geçişi ve veri boşluğu olay ÜRETMEZ). Süre **hareket/rölanti/BİLİNMEYEN** olarak ayrıştı — *bilinmeyen süre rölanti SAYILMAZ*, invaryant üç yerde korunuyor (birikim · test · DB CHECK). Tepe RPM/sıcaklık yalnız **taze** OBD'den (`-1` sentinel'i `0` değil `null`; trip başında sıfırlanır). **Hız ihlali BİLİNÇLİ olarak üretilmiyor** — gerçek limit kaynağı araştırıldı, yok (§11). Confidence **kanıta dayalı** ve **kanıtı da taşınıyor** (`confidence_limited_by`). **PAUSED/RESUMED analiz sonucu UYGULANMADI:** kısa veri kaybı/arka plan/OBD reconnect trip'i duraklatmamalı; "kaç kez durup devam etti" bir durum geçişi değil `stopCount` ölçümüdür. **Devralınan kodda beş zincir kusuru bulundu ve düzeltildi — hepsi 9 154 test yeşilken vardı:** `public._trip_source()` migration 047'de 25 kez çağrılıyordu ama **hiçbir yerde tanımlı değildi** (her yükleme `42883` ile ölecekti); 047'nin kendi imza deseni `pg_get_function_identity_arguments`'ın parametre isimlerini de döndürdüğünü gözden kaçırdığı için **migration hiç uygulanamıyordu**; `tripUploadRuntime` sabit `DERIVED`/`fuelMeasured:false` göndererek üretilen provenance'ı **eziyordu**; `p_provenance`/`p_price`/`p_coverage` hiç gönderilmiyordu; kanonik modelde `unknownTimeMin` **yoktu**. Ayrıca Fleet UI sunucunun kabul ettiği `VERY_HIGH` güvenini **"Bilinmiyor"a düşürüyordu**. **Kalıcı ders:** *yeşil test çalışan bir zincir demek değildir* — bulguların tamamı ancak gerçek PostgreSQL çalıştırılınca ve zincir uçtan uca kilitlenince görüldü; bu yüzden parçaları değil **parçalar arasındaki bağı** ölçen ayrı bir `*Wiring` kilit dosyası eklendi. Kanıt: **33 gerçek-PostgreSQL** doğrulaması (046 satır uyumluluğu · null preservation · replay · kısıtlar · tenant isolation · anon deny), kök **9 192/9 192**, website **792/792**, `npm run build` geçti, 047 idempotent. **AÇIK BORÇ:** gerçek araçta hiç yolculuk tamamlanmadı · kullanıcı yakıt fiyatı ayar yüzeyi yok (maliyet bu yüzden hâlâ `ESTIMATED`) · gerçek hız limiti kaynağı yok · tam olay tablosu yok · geçmiş 100 trip göç etmedi · 040–047 hiçbir ortama uygulanmadı. Rapor: `docs/FLEET_TRIP_METRICS_P2_REPORT.md`. **Özet katmanı hâlâ yok** (trip başına metrik var, yolculuk *anlatısı* yok). |
| Trip Replay | YOK | HAYIR | Black Box'a bağımlı |
| Smart Route Analysis | YOK | HAYIR | routing + health ayrı sistemler |
| Weather Impact Analysis | YOK | HAYIR | `weatherService` ham veri; etki modeli yok |
| AI Road Companion | İSKELET | HAYIR | companion iskeleti + safety kernel; ürün deneyimi yok |
| AI DJ | YOK | HAYIR | Vizyon rezervuarı |
| AI Radio | YOK | HAYIR | Vizyon rezervuarı |
| Doğal konuşma | ENTEGRE | HAYIR | `semanticAiService` + parser; saha kanıtı yok. **2026-07-24:** "muhabbet edilebilirlik" 3 KÖKÜ düzeltildi — (a) emniyet pencereleri (takip 20sn/idle 15sn) uzun cevabı `ttsCancel()` ile ortadan kesiyordu → `isTtsSpeaking()` ile tavanlı uzatma **🔴 #95**, (b) kendi süre bütçemizin timeout'u "ağ öldü" sayılıp 2 komutta 90sn offline yapıyordu → kesicide ayrı/yüksek eşik **🔴 #95**, (c) **canlı cihazda yakalandı:** Anthropic CORS `TypeError`'ı ağ ölümü sayılıp ~2 dakikada bir 90sn offline üretiyordu (aynı turda 4 sağlayıcı HTTP yanıtı verirken!) → tur-kapsamlı `sawHttpResponse` kanıtı **🔴 #97**. Üçü de cihaz doğrulaması bekliyor |
| Medya yönlendirme | ENTEGRE | HAYIR | `youtubeService`/`musicCommandParser`; tam sesli kontrol kısmi. **2026-07-29 (Müzik Hub Paket A):** Mavi'nin `media.play/pause/next` komutları artık tek kapıdan (`MediaCommandGateway`) geçer ve **typed `CommandTruth`** döner; ses kanıtı üretilemeyen kaynakta (Spotify Connect · YouTube · harici oturum) asistan **"çalıyor" DEMEZ**, "başlatma isteği gönderildi" der; başarısızlıkta port throw eder → `ok:false`. **🔴 #170 cihaz doğrulaması bekliyor**. **2026-08-08 (#477/#478):** kapı gerçeği üretiyordu ama `mediaService` onu **atıyordu** — "sonraki parça" cihazda sahte onay verirken parça değişmiyordu; sonuç artık `MediaCommandResult{dispatched, verified, failureCode}` ile taşınır ve **yalnız `VERIFIED`** başarı sayılır. Kaynaksız "müzik aç" harici uygulamayı devralmayı bıraktı, gömülü katmana hizalandı; bulunamazsa **dürüst red** verilir. **🔴 #477/#478 cihazda ölçülmedi** |
| **Tek playback otoritesi (Native Audio Core)** | ENTEGRE | HAYIR | **2026-07-29 · Müzik Hub Paket A.** Öncesi: 5 ayrı ses alanı (harici MediaController · ham MediaPlayer · HTMLAudioElement · YouTube IFrame · Spotify Connect), **audio focus YOK · becoming-noisy YOK · MediaSession YOK · foreground servis YOK · process-death kurtarması YOK**, kaynak devri best-effort (çift ses riski), "komut kabul edildi" = "çalıyor". Sonrası: `CarosPlaybackService` (Media3 + ExoPlayer) + `CarosAudioFocusManager` + 10 modüllük JS çekirdeği (playback truth · yetenek sözleşmesi · işlemsel devir · nested duck · tek ses formülü · kurtarma · komut kapısı). Legacy hatlar silinmedi, otoriteye YÖNLENDİRİLDİ. **Test yazımında iki gerçek kusur ölçüldü ve düzeltildi:** `playSource` kilitlenmesi (her çalma komutu sonsuza asılırdı) ve rollback'in hata kodunu silmesi. 62 JS + 17 Robolectric kilidi. **🔴 #169 — HİÇBİRİ CİHAZDA ÖLÇÜLMEDİ** |
| **Kuyruk kurtarma + cihaz doğrulama altyapısı** | ENTEGRE | HAYIR | **2026-07-29 · Müzik Hub Paket B.** Paket A sapmayı yalnız TESPİT ediyordu; artık **bounded kurtarma** var: native timeline otoritedir, UI projeksiyondur, kurtarma **çalan medyayı değiştirmez** (oynatıcıya komut YOK). Dört güvenlik şartı kilitli: kullanıcı komutu önceliği · devir sürerken başlamama · dış otoritede fail-closed · deneme+cooldown+devre kesici. Bayat karar (generation/revision değişimi) ATILIR. Ayrıca **41 senaryoluk makine-okur cihaz doğrulama sözleşmesi** (A–H) + bounded olay izi (JS + native, monotonic saat, allowlist'li kod alanı). **Kanıtsız PASS otomatik BLOCKED'a düşer.** Paket A'da ölçülen 3 kusur düzeltildi: gecikmeli odak ölü yolu (telefon görüşmesi sonrası müzik hiç başlamıyordu), bayat focus callback'i, uzlaştırma yanlış pozitifi (native = UI'nin 120'lik penceresi). **🔴 #173 — cihazda ölçülmedi** |
| **Medya gözlem yüzeyi (CAROS LAB)** | ENTEGRE | HAYIR | **2026-07-29.** LAB → Çalışma Zamanı → **Medya Otoritesi**: 7 kart (otorite/kaynak · oynatma gerçeği · ses odağı-yol · ses-ducking · kuyruk · komut kanıtı · kurtarma), salt-okunur, timer yok. "Ses üretiliyor (kanıtlı)" ile "yalnız istek" AYRI hüküm; kanıt yoksa **UNAVAILABLE** (sahte 0/sahte "sağlıklı" yok). Kuyruk sapması (`UI_AHEAD · NATIVE_AHEAD · INDEX_DRIFT · …`) tipli gösterilir — **bu paket sapmayı düzeltmez, görünür kılar**. Başlık/sanatçı/URI/kapak LAB'a girmez. **🔴 #170** |
| Telefon ve mesaj entegrasyonu | DOĞRULANDI | HAYIR | PhoneScreen + contacts; head unit saha kanıtı yok |
| Güvenli hands-free kullanım | İSKELET | HAYIR | modeController var; **HFDM kısıt profili yok** |

### 8.6 Bakım ve Servis

| Özellik | Durum | Ürün hazır | Kanıt / eksik ana parça |
|---|---|---|---|
| Predictive Maintenance | İSKELET | HAYIR | Prediction × maintenanceBrain **birleşimi kodda yok** |
| Smart Maintenance Planner | İSKELET | HAYIR | Statik hatırlatma var; dinamik hesap yok |
| Maintenance Timeline | İSKELET | HAYIR | Veri var; **timeline UI yok** (P3-1) |
| Repair Memory | YOK | HAYIR | Vehicle Memory'ye bağımlı |
| AI Service Advisor | İSKELET | HAYIR | §8.3 |
| AI Repair Verification | YOK | HAYIR | Repair Memory'ye bağımlı |
| Servis öncesi kontrol listesi | YOK | HAYIR | Vizyon rezervuarı |
| Gereksiz parça değişimi uyarısı | YOK | HAYIR | **Ürünün en güçlü vaatlerinden** — Root Cause + KB üstüne kurulur |
| Maliyet tahmini (Trip Cost) | İSKELET | HAYIR | **12 dosya / 2 111 satır saf çekirdek + testler** (yakıt·HGS·otopark·konaklama + `confidenceLedger`: `unknown` toplama girmez, `upperBound` uydurulmaz). **Hiçbir fiyat girdisinin kaynağı yok** (P2–P5). **Rota→plan wiring BAĞLANDI** (2026-08-09, kütük #510 🔴): canlı rotadan mesafe/süre okunuyor, beyan kapısı fail-closed (eksik alan varsayılanla DOLDURULMUYOR), kategori kapıları "hiç açılmadı" ile "değer bilinmiyor"u AYIRIYOR, LAB → Trip Cost ekranı salt-okunur. Fiyat kaynağı olmadan da plan üretiliyor; tutar `null` kalıyor, sıfır yazılmıyor. **FİYAT KAYNAĞI MODELİ KARARA BAĞLANDI (2026-08-09):** ürün **hiç kullanıcı girdisi olmadan çalışır** — yakıt gömülü aylık tablo, HGS gömülü tarife (ilk sürümde km bazlı yaklaşık), otel elle derlenmiş il taban tablosu + **TÜİK konaklama fiyat endeksiyle içeride güncelleme**; otopark · kamp · plaj · feribot · müze **hesaba HİÇ GİRMEZ** (sistem sormaz/tahmin etmez/uydurmaz). Kullanıcı girdisi **zorunluluk değil iyileştirmedir** ve `source:'user'` ile tablo tahmininden yüksek güven alır. Rezervasyon/fiyat sitelerinden **otomatik veri çekilmez**. Bkz. Ç-11 · plan §3.0 |
| Doğrulanmış bakım/tamir geçmişi | YOK | HAYIR | Passport + Memory + bulut gerekir |

### 8.7 Güvenlik ve Hayat Koruma

| Özellik | Durum | Ürün hazır | Kanıt / eksik ana parça |
|---|---|---|---|
| Emergency AI | YOK | HAYIR | `hazardService`/`safetyService` **farklı amaç** |
| Emergency Contact System | YOK | HAYIR | Emergency AI'ya bağımlı |
| Konum paylaşımı | ENTEGRE | HAYIR | Realtime konum (Supabase) var; acil bağlamı yok |
| Acil arama desteği | YOK | HAYIR | Phone Integration üstüne kurulur |
| Kaza sonrası rehberlik | YOK | HAYIR | Vizyon rezervuarı |
| Silent Emergency | YOK | HAYIR | Vizyon rezervuarı |
| Vehicle Guardian Mode | YOK | HAYIR | Park algısı var; **güç bütçesi sözleşmesi şart** (akü riski) |
| **Guardian AI** (sürüş sırasında risk uyarısı — *Vehicle Guardian Mode DEĞİL*) | ENTEGRE | HAYIR | **TICK SAHİBİ BAĞLANDI (2026-08-11, #539–#542).** `runGuardian` artık üründe FİİLEN çağrılıyor: sahip `runtimeManager.scheduleTask` (§L.0 tek tik-wheel) · taban **1000 ms** · kritiklik **NORMAL** · `deferIdle` KAPALI · kendi timer'ı YOK · görünüme bağlı DEĞİL. Kadans sözleşmesi: *Guardian aynı modda OBD anket periyodunu ASLA aşmaz* (5 modun tamamı testle kilitli). Bütçe **TEK**: 8 ms/koşum (#494 tavanının yarısı); **host ölçümü** p95 **11,5 µs** (gerçek yol) / **49,0 µs** (8 kural birden) — tavanı aşmak için cihaz ~1 391× / ~327× daha yavaş olmalı. **AMA: bu tur Guardian'a kalp atışı verir, SES vermez** — çıktı sürücüye SUNULMAZ, aşırı ısınma/akü otoritesi hâlâ `VehicleCompute.worker` → `SystemOrchestrator`; ikinci eylem otoritesi doğmadı. **MAP YUVASI KISMEN DOLDU (2026-08-13, #568/#569):** `SPEED_CAMERA_WARNING` artık **boş yuva DEĞİL** — sahibinin kararıyla (ADR §6-D: K2 EGM verisi kullanılacak · K5 paket cihaza gömülecek) gömülü EGM EDS paketi (**1 503 nokta**) → `enforcementPointsPackage` (saf) → `enforcementPointsSource` → `enforcementMapSource` (`MapSource`in İLK gerçek implementasyonu) zinciri kuruldu. Fiilen koşabilen kural **2**: `vehicle-health` + `speed-camera`. `map` yuvası **YALNIZ `speedCamera` dilimi** için bağlıdır (viraj/limit/eğim/tehlike üreticisi hâlâ YOK); `weather`/`driver` BAĞLI DEĞİL. **#508 ARTIK KODA YAZILI BİR KAPI:** uyarı fix YAŞINA değil `doğruluk + hız × fix yaşı ≤ 150 m` **konum belirsizliğine** tabidir → sahadaki p50 19,5 s bayat fix otoyol hızında kapıyı kapatır, özellik şehir içinde çalışır otoyolda **sessiz kalır**, düşüşler LAB'da SAYILIR. Ürün dili K3/K4'e uyar: "radar" DEĞİL **"denetim noktası"**, hız eşiği **İDDİA EDİLMEZ**; kuralda `'unknown'` (varlık bilinmiyor → sessiz) ile `'unspecified'` (varlık gözlendi, tür belirtilmemiş → uyarır) **ayrı** davranır. Kapsam boşluğu KAPANMADI (Mersin 0 · Mersin–Tarsus üç kaynakta da 0 · mobil radar hiçbir statik kaynakta yok) → *"radara yakalanmaz"* vaadi **YASAK** (K7). Yorgunluk **#509** altında. **Gözlem yüzeyi VAR:** CAROS LAB → Çalışma Zamanı → **Guardian Runtime** (6 kart) + CAROS LAB → Araç → **Denetim Noktası Verisi** (5 kart · kapı sayaçları "uyarı neden çıkmıyor"u sayıyla cevaplar). **Cihazda HİÇ ölçülmedi → ÜRÜN HAZIR HAYIR** |
| Güvenlik-kritik hot-path | ENTEGRE | HAYIR | SafetyBrain + SafetyOverlay; **VoiceSafetyAnnouncer + CAN canlı bağlantı yok** |
| Kullanıcı izni ve açık rıza | ENTEGRE | HAYIR | DiagnosticReportModal rızası 🟢; genel rıza akışı (KVKK/GDPR) yok |
| Yanlış alarm azaltma | İSKELET | HAYIR | Debounce/histerezis var; ölçülen yanlış-alarm oranı yok |
| Ghost Replay / Black Box olay koruması | YOK | HAYIR | Vizyon rezervuarı |

### 8.8 Güç ve Uyku Yönetimi

> **DÜZELTME (2026-07-27, DEBT-005):** Bu grup için önceki "bütünüyle YOK" beyanı
> **yanlıştı**. Temel katman olan **Battery Protection UYGULANMIŞ ve boot'a bağlıdır**;
> grubun geri kalanı hâlâ YOK. Bu, üç modlu güç/gözetim mimarisinin tamamlandığı
> anlamına **GELMEZ** — uyku/gözetim modlarının hiçbiri yazılmadı. Kalan maddeler
> akü boşaltma riski taşıdığı için **güç bütçesi sözleşmesi** olmadan uygulanamaz.

| Özellik | Durum | Ürün hazır | Kanıt / eksik ana parça |
|---|---|---|---|
| Battery Protection | ENTEGRE | HAYIR | `power/BatteryProtectionService.ts` (4 seviye + histerezis + 10 sn hareketli ortalama → `runtimeManager.setPowerCeiling`), `SystemBoot.ts:810` koşulsuz kayıtlı. **Eksik:** tek veri kaynağı `onOBDData.batteryVoltage`; OBD yoksa seviye geçişi hiç tetiklenmez. Gerçek araçta seviye geçişi ölçülmedi |
| Smart Surveillance | YOK | HAYIR | Guardian Mode'a bağımlı. **Kodda karşılığı yok** — Battery Protection'ın varlığı bunu kapsamaz |
| Continuous Surveillance | YOK | HAYIR | Güç bütçesi olmadan **yasak**. **Kodda karşılığı yok** |
| Service Session | YOK | HAYIR | Vizyon rezervuarı |
| OBD/ECU Sleep Profile (araç bazlı) | YOK | HAYIR | Uyku olay kaydı gerekir (öğrenme öncesi kanıt) |
| Öğrenilmiş Wake Policy | YOK | HAYIR | Sleep Profile'a bağımlı; reconnect ≠ wake stratejisi |
| Kontrollü kısa ECU uyanışı | YOK | HAYIR | Write Gate disiplini ister |
| Akü düşükken wake reddi | YOK | HAYIR | **Bu grubun ilk yazılacak maddesi** (fail-closed) |
| Araç uyurken geçmiş analizi | YOK | HAYIR | Vehicle Memory'ye bağımlı |
| Tekrar uykuya dönme doğrulaması | YOK | HAYIR | Saha kanıtı zorunlu |

### 8.9 Platform ve Ekosistem

| Özellik | Durum | Ürün hazır | Kanıt / eksik ana parça |
|---|---|---|---|
| Vehicle Link Fabric | ENTEGRE | HAYIR | Araç-içi zincir çalışır (🟡 HAL→Bus 0,37 publish/sn); **bulut ucu yok**. ⚠️ **Omurga yayın yapıyor ama KİMSE DİNLEMİYOR** (rapor `8edd61a6`): `publishedCount 127 · deliveredCount 0 · activeListenerCount 0 · droppedCount 0`. **Sayaç yanlış DEĞİL — kanıtlandı:** `deliveredCount` yalnız bir listener çağrılınca artar (`platformEventBus.ts:478,564`), `_subById.size = 0` → matematiksel olarak 0. `historyCount 22` + `retainedEventCount 3` listener'dan BAĞIMSIZ yollarda arttığı için (retain dispatch'ten önce `:422`, history sonra `:457`) publish hattının uçtan uca sağlam olduğunu kanıtlıyor. Yani bus arızalı değil, **tüketici migrasyonu hiç yapılmadı**. Dürüst okuma: *taşıyıcı hazır, yük yok*. **PR-E1 (`a34d3b8`) ile tüketicisiz transient yayın maliyeti kaldırıldı** (talep kapısı) — omurga artık "uykuda ve bedava". |
| **Event Bus Talep Kapısı** (PR-E1) | ENTEGRE | HAYIR | `vehicleHalEventBridge` transient `vehicle.signal.changed` yayınını **aktif abone yoksa atlar** (`hasSubscribers()` — bus'ta zaten tanımlıydı, hiç çağrılmıyordu). Retained yaşam-döngüsü event'leri kapıya TABİ DEĞİL (geç gelen tüketici `replayLast` ile doğru başlangıç durumunu alır). **R-1 kapatıldı:** dedupe imzası yalnız gerçek publish sonrası güncellenir — yoksa atlanan event imzayı kirletir, abone sonradan gelince ilk gerçek event sonsuza dek yutulurdu. Fail-safe: bus kapı sağlamıyorsa/patlarsa → YAYINLA (event kaybetme). Bounded telemetri: `skippedCount` (drop DEĞİL — bus'a hiç girmedi). 8 kilit; suite 4115 yeşil. 🔴 **cihaz kanıtı bekliyor** (hedef: `publishedCount 127→≤5`, `halBridge 124→≤3`, `retainedEventCount 3` değişmez, göstergeler birebir aynı). |
| Arabam Cebimde | ENTEGRE | HAYIR | PWA kumanda + E2E şifreli uzaktan komut; **twin/memory paylaşımı yok**. **YENİ (kütük #168):** araç kartı artık üç ayrı gerçeği KARIŞTIRMIYOR — araç çevrimdışı · kullanıcı çevrimdışı · komut teslim edilmedi. DB `vehicle_commands.status` **değiştirilmeden** ürün evrelerine eşlendi (QUEUED·SENT·ACKNOWLEDGED·EXECUTED·VERIFIED·FAILED·EXPIRED); araç ulaşılamazken `pending` komut **QUEUED**tur, "gönderildi" DEĞİL. Tanınmayan durum fail-closed `null`; okunamayan alan "Okunamadı" — **sahte 0 yazılmaz**. ⚠️ Bilinen RLS sınırı: `vehicle_commands` SELECT `user_id=auth.uid()` → yalnız kullanıcının KENDİ komutları sayılır (UI bunu açıkça yazar). 🔴 saha kanıtı bekliyor. · **🔵 ÜÇ ÖLÜ UÇ KAPATILDI (2026-08-14, kütük #573–#575 — `COMPLETE_LOCAL`):** kullanıcı sorusu (*"özelliklerin altı dolu mu"*) üzerine yapılan kod denetimi, ürün ekranında ÇALIŞIYOR görünen üç özelliğin **hiç çalışmadığını** ölçtü. **(1) Teşhis sekmesi üç katmanda ölüydü:** `vehicle_commands_type_check` 2026-04-24'ten beri dokuz tipte donmuştu → PWA'nın gönderdiği `read_dtc`/`clear_dtc`/`read_voltage`/`set_speed_alert`/`layout_change` **INSERT'te `23514` ile reddediliyordu** (komut hiç oluşmuyordu); `result` kolonu **hiç yaratılmamıştı** (`/api/pwa/dtc-result` `42703` alırdı); araç tarafında tip tanımlı değildi (`default: rejected`). Migration **063** + yeni `remoteDiagnosticCommands` yürütücüsü + `{outcome, result?, reason?}` sözleşmesiyle üçü de kapatıldı. **(2) Hız uyarısı** ayarı araca hiç ulaşmıyordu ama telefon koşulsuz "Kaydedildi ✓" diyordu; `speedAlertRuntime` (histerezis + cooldown, zero-trust eşik, `safeStorage` kalıcılığı, tek bildirim otoritesi) ile bağlandı. **(3) Kumanda telemetri şeridi** ham sayı basıyordu — araç OFFLINE iken ekranda *HIZ 22 yeşil · YAKIT 0 · MOTOR 0* görünüyordu; `telemetry` tazelik katmanı (`Measurement`) zaten üretiliyordu ama **hiç okunmuyordu**, artık okunuyor (bilinmeyen → em-dash, bayat → etiketli, sağlık rengi hak edilmeden verilmiyor). **Aynı turda ölçülen DÖRT dürüstlük kusuru daha kapatıldı:** araç bağlı değilken "Arıza Kodu Yok" denmesi · kısmi taramanın (`completeness.failed`) API'de düşürülmesi · demo modda `Math.random()` ile **rastgele voltaj** ve gerçek modda `?? 12.4` ile **sahte voltaj** basılması · `clearDtc`'nin 2 sn sonra listeyi körlemesine boşaltıp **yalancı temizleme** göstermesi. **EN AĞIR BULGU AYRI BİR GÜVENLİK KUSURUDUR:** `commandListener.updateCurrentSpeed()` ürün yolunda **sıfır çağırana** sahipti → `currentSpeedKmh` daima 0 → uzaktan lock/unlock'un *"sürüş sırasında reddet (>5 km/h)"* kapısı **hiç tetiklenemiyordu**; araç 100 km/h giderken telefondan verilen "Aç" komutu geçerdi. Kapı aynı hız aboneliğinden beslendi. Kanıt: **33 yeni kilit**, website **1002/1002**, iki tsc temiz, yanlışlama koşuldu. **İKİNCİ TUR (aynı gün, kütük #576/#577):** üç açık borçtan ikisi kapatıldı. **CAROS LAB → İletişim → Uzak Komut Zinciri** ekranı kuruldu (salt-okunur): "komut çalışmadı"nın **dört sebebi** artık ayrı hükümdür — dinleyici yok · E2E şifre kapısı · sürüş güvenliği kapısı · tanımsız tip; `HEALTHY` yalnız **gerçekten tamamlanan komut varsa** verilir ("hata yok" sağlık kanıtı sayılmaz) ve ekranda **hız kapısı körlüğü uyarısı** vardır (#574'ün izi ölçülebilir). **Kayıtlar sekmesi sunucuya bağlandı** (migration 064: `vehicle_fuel_logs` + `vehicle_service_records`, RLS + anon REVOKE + `client_ref` çift-gönderim koruması; **gerçek PostgreSQL'de 8/8 PASS — cross-tenant sızıntı reddi dâhil**); veri artık **araç kapsamlıdır** (iki araçta kayıtlar karışmıyordu → karışmıyor), eski yerel kayıtlar göç ediyor ve ekran verinin **NEREDE yaşadığını** her zaman söylüyor (`Hesabınıza kayıtlı` · `Yalnız bu cihazda` · `Sunucu okunamadı`). Aynı turda servis hükmündeki **sahte "İyi"** kusuru da kapatıldı (`odometer ?? 0` → kilometre bilinmiyorsa `unknown`). **Migration 063 de gerçek PostgreSQL'de doğrulandı (7/7 + idempotent + fail-closed)** ve kusur ölçümle kanıtlandı (`23514` ve `42703`). **ÜÇÜNCÜ TUR (kütük #578):** **Kayıtlar çevrimdışı kuyruğa bağlandı.** Ağ yokken yazma düşüyor ve kayıt yalnız yerelde kalıyordu; kuyruk altyapısı hazırdı ama kayıtlar ona **hiç bağlı değildi**. Aynı turda **ikinci bir ölü uç ölçüldü ve kapatıldı:** kuyruğu boşaltan tek yer `useFleet`ti ve o hook yalnız `/dashboard/fleet/*` sayfalarında mount ediliyor → PWA'da kuyruk **hiç sürülmezdi**; yeni `useRecordsSync` (timer yok · `online` aboneliği · `QUEUE_SYNC` kapısı) ve bekleyen şeridi ile yazma ile boşaltma AYNI turda bağlandı. Kayıtlar `OFFLINE_DEFERRED`dir: ekran **"sıraya alındı, henüz hesabınıza işlenmedi"** der, rozet yeşil DEĞİLDİR. **Kalıcı hata (RLS reddi · FK) kuyruğa ALINMAZ** — bağlantıyla düzelmeyecek bir işi "gidecek" diye göstermek yalandır; `23505` ise **başarıdır** (kayıt zaten sunucuda). Kuyruktaki kayıt listeden kaybolmaz ve sunucudaki kopyasıyla **çift gösterilmez** (`clientRef` eşleşmesi); anahtarsız eski göç kaydı `LOCAL` etiketlenir, "sırada" iddia edilmez. Kayıtlar için **yeni API rotası açılmadı** (ikinci yetki otoritesi kurmamak için) — yazma yolu ürünle aynıdır, yalnız zamanı ertelenir. Kanıt: **21 yeni kilit**, website **1038/1038**, tsc temiz, **yanlışlama iki kez koşuldu** (kalıcı-hata kapısı ve bekleyen-birleştirme ayrı ayrı bozuldu → ilgili kilitler anında düştü). **Aynı turda kayıt SİLME arayüzü de kuruldu (kütük #579):** 064 DELETE ayrıcalığını zaten veriyordu, yalnız arayüz yoktu → yanlış kayıt geri alınamıyordu. Silme kaydın yaşadığı **her yerde** yapılır; en kritik kısım kuyruk iptalidir — "sırada" bir kayıt yalnız yerelden silinseydi **kuyruk onu bağlantı gelince yine gönderirdi** ve silinen kayıt hesapta belirirdi. Silme **kuyruğa alınmaz**: çevrimdışı "silindi" demek satır sunucuda dururken gitmiş gibi göstermektir. İki aşamalı onay (araç içi yanlış dokunma gerçektir). **Aynı turda bakım zekâsı ölçülemeyen kilometreye karşı sağlamlaştırıldı (kütük #580):** aracın anlık kilometresi okunamıyorken hüküm **her zaman "Bilinmiyor"** kalıyordu. Artık kayıtlardan türetilen en yüksek kilometre bir **alt sınır**dır ve kural **asimetriktir** — alt sınır bile aralığı aşmışsa **"geçmiş"** denebilir (hüküm kesindir), ama alt sınırın düşük olması gerçek kilometrenin düşük olduğunu kanıtlamadığı için **"iyi" ASLA denmez**. Bu, "8 kapı"nın *doğru mu → önemli mi → hangi aksiyon* zincirinin kanıt seviyesine saygı gösteren hâlidir: veri yetmiyorsa hüküm YOK, ama yeten yönde hüküm VAR. Yakıt formu araçtan okunan kilometreyi **öneri** olarak doldurur (kaynağı yazar, kullanıcının yazdığını ezmez, ölçüm yoksa boş bırakır). Ayrıca gönderilemeyen kayıtlar artık **tek tek** yönetiliyor (gerekçe · deneme sayısı · yeniden dene · vazgeç); gerekçe uydurulmaz, bilinmeyen kod gizlenmez. Kanıt: 18 yeni kilit, **1062/1062**, yanlışlama koşuldu. **UYGULAMA DENEMESİ (kütük #581):** 063/064 yerel ortama uygulanmak istendi ve **uygulanamadı** — üç engel ölçüldü: (1) fleetval stack'inin şeması uyumsuz (`vehicle_commands.type` kolonu ve `vehicle_users` tablosu YOK; 063 transaction dışı olduğu için denemek tabloyu yarım bırakırdı), (2) **migration zinciri sıfırdan uygulanamıyor** — temiz bir Supabase stack'inde 11. migration `vehicles.owner_id` yokluğundan kırılıyor ve o kolonu **hiçbir migration yaratmıyor**; prod ve fleetval bugüne elle müdahalelerle gelmiş, (3) prod'a push geri alınamaz olduğu için bilinçli olarak yapılmadı. Buna karşın **her iki migration da izole PG 17.11 ortamında tam doğrulandı** (063: 7/7, 064: 8/8; GRANT/RLS/POLICY eksiksiz, `anon = 0`) ve **uçtan uca senaryo koştu**: `read_dtc` komutu oluştu, araç `result` yazdı, `/api/pwa/dtc-result` sorgusu çalıştı, `set_speed_alert` kabul edildi, bilinmeyen tip hâlâ reddedildi, kayıt zinciri RLS altında yazdı/engelledi/sildi. **Kırık migration zinciri yeni ve ayrı bir borçtur.** **ZİNCİR ONARILDI (aynı gün, kütük #582 — `COMPLETE_LOCAL`):** kırık zincir borcu kapatıldı. Prod **salt-okunur** okundu (`read_only:true` → sunucu bağlantıyı `supabase_read_only_user`'a düşürür; prod'a **hiçbir yazma yapılmadı**) ve `owner_id`'nin "elle müdahale" OLMADIĞI ölçüldü: prod'un migration defterindeki **12 kaydın 10'u `website/supabase/migrations` zincirine aittir** — yani prod'un tabanı website zinciridir, kök zincir onun üzerine defter tutulmadan uygulanmıştır. Zincir temiz bir ortamda baştan sona yürütülerek **11 sessiz sapma** ölçüldü (owner_id · api_key_hash · iki RPC aşırı-yükleme çakışması · 012'nin ALTER/DROP POLICY sıra hatası · `vehicle_events.vehicle_id` prod'da **TEXT** iken zincirin uuid yapması · `profiles`/`vehicle_locations.company_id`/`idx_vehicle_loc_company`/`vehicle_telemetry.lat` eksikleri · **Supabase varsayılan ayrıcalıkları** yüzünden 049'un kendi fail-closed denetimine takılması · **iki migration'ın aynı sürüm numarasına çözülmesi** → `supabase db reset` `23505`). Son ikisi kritiktir: doğrulama fixture'ı `ALTER DEFAULT PRIVILEGES` kurmadığı için **doğrulama ortamı gerçek Supabase'den sapmıştı**, ve sürüm çakışması yüzünden zincir **CLI ile hiç uygulanamıyordu**. **Mevcut migration'ların içeriği DEĞİŞTİRİLMEDEN 5 düzeltici migration** eklendi (tanımlar prod'dan okundu, uydurulmadı) ve en riskli adımın (canlı `push_vehicle_event` ile aynı imza) prod'da **NO-OP** olduğu prod-benzeri bir DB'de **ölçülerek** kanıtlandı. **GERÇEK Supabase stack'inde CLI 70 migration'ın tamamını uyguladı** ve yeni `local_chain_full_verify.sql` **25/25 PASS** verdi (zincir bütünlüğü 6/6 · 063 8/8 · GRANT/RLS/POLICY 4/4 `anon=0` · gerçek RLS davranışı 7/7). Yanlışlama koşuldu (düzeltici çıkarılınca zincir aynı yerde yeniden düştü). **AMA PROD'A HÂLÂ PUSH EDİLEMEZ:** (a) `20260424000009` sürümü iki zincirde de kullanılmış ve prod defterinde `command_bus` olarak kayıtlı → CLI `user_trial`'ı atlar; (b) `initial_schema` prod'da uygulanmamış ama nesneleri var → push düşer; (c) **064'ün `user_can_access_vehicle()`'ı `vehicle_users` tablosuna dayanır ve o tablo prod'da YOKTUR**. Çözüm ayrı bir iştir: prod şemasından **baseline squash** + iki dizinin birleştirilmesi + `supabase migration repair`. Rapor: `docs/db/SCHEMA_DRIFT_REPORT_20260814.md`. **PROD'A UYGULANDI (aynı gün, kütük #583):** üç engelin üçü de kapatıldı ve **migration 063/064 artık production'da CANLI**. Prod'un kataloğu salt-okunur okunup tek bir **baseline squash** üretildi; temiz bir Supabase stack'inde prod ile **969/969 anahtar birebir** eşleştiği ölçüldü (Türkçe tanımlayıcılar **bayt düzeyinde** doğrulandı — ilk okuma katmanı PowerShell 5.1 yüzünden Türkçe karakterleri çift kodluyordu ve bu kusur, karşılaştırmanın iki tarafı da aynı bozuk kaynaktan geldiği için **görünmüyordu**; okuma pwsh 7'ye taşındı). İki dizin tek zincire birleştirildi (49 dosya arşive), sürüm çakışması ve deftersiz `initial_schema` squash ile yapısal olarak ortadan kalktı; `vehicle_users` engeli iki yeni migration ile çözüldü — ikincisi (`user_can_access_vehicle` prod sahiplik yolları) olmasaydı **Kayıtlar özelliği sessizce ölü doğardı** (boş tablo yüzünden araç sahibi kendi kaydını göremezdi). Prod'un birebir kopyasında **gerçek `supabase db push`** provası 35 migration'ı hatasız uyguladı (25/25 doğrulama, ikinci push idempotent); prod'un **gerçek verisiyle** uyumluluk ön kontrolü yapıldı (silinecek/bozulacak satır **0**); defter yedeklenip baseline'a hizalandı ve 35 migration canlıya uygulandı. Sonrasında **prod ↔ doğrulanmış klon 2315/2315 anahtar aynı** ve prod salt-okunur denetimi **18/18 PASS** (anon 0 · authenticated 4/4 · CHECK 14 tip · erişim fonksiyonu dört yol · **veri kaybı yok**: 78 671 olay · 576 araç değişmedi). **AMA saha kanıtı YOK:** #573/#574/#577/#578/#579/#580 maddeleri gerçek telefon ve gerçek araç ölçümü ister; bu tur hiçbir cihaz ölçümü yapmadı ve prod'a test verisi yazılmadı (RLS davranışı prod'da **yapısal** olarak kanıtlandı, davranışsal olarak yalnız klonda). Bu maddeler **🔴 kalır**. **DÖRDÜNCÜ TUR — KALAN DÖRT BORÇ KAPATILDI (aynı gün, kütük #584–#587 — `COMPLETE_LOCAL`):** #583'ten sonra açık kalan dört madde de kapatıldı. **(1) Sürüş güvenliği kapısı hâlâ kördü (#584).** #574 kapıyı `onOBDData`ya bağlamıştı ama OBD ürünün tek hız kaynağı değildir — gerçek otorite **HAL>CAN>OBD>GPS** ile çözülen `UnifiedVehicleStore.speed`tir (#549). **OBD dongle takılı olmayan araçta kapı tamamen kördü** ve CAROS LAB bunu doğru raporluyordu. Üstelik kapının hız değişkeni **0 ile başlıyor** ve **yaşı tutulmuyordu**: OBD koptuktan sonra donmuş bir `0` sonsuza dek geçerli sayılıyor, araç 100 km/h giderken uzaktan "Aç" komutu geçiyordu. Kapı artık **füzyon otoritesine** bağlı (OBD yedek), besleme **zaman damgalı** (eski örnek taze örneği ezemez) ve hüküm **üç değerli**: `ALLOW · BLOCK · SPEED_UNKNOWN`. **Beyan edilen ödünç:** `SPEED_UNKNOWN` reddetmez — kapalı otoparkta kullanıcının aracını açamaması ürünü kırardı — ama bu kabul **kanıtsız sayılır**, ayrı sayaçta defterlenir ve LAB'da **"Hız kanıtsız kabul"** olarak görünür; `movingBlocked = 0` iken "kapı korudu" **denemez**. **(2) Araç içindeki sürücüye hız uyarısı bağlandı (#585).** Uyarı yalnız telefona gidiyordu; direksiyondaki kişi hiçbir şey görmüyor ve **çevrimdışıyken uyarı tamamen kayboluyordu**. **Mimari karar sessizce alınmadı:** "Guardian zinciri" yolu incelendi ve **reddedildi** — `guardianRuntime` kendi başlığında sürücüye SUNUM YAPMADIĞINI beyan eder ve bir sunum katmanı yoktur; oraya sunum eklemek **ikinci bir eylem otoritesi** kurardı. Uyarı bunun yerine ısınma/kaza/yakıt uyarılarının **zaten sahibi olan** otoriteye bağlandı: `VehicleEventHub → SystemOrchestrator`. Araç içi uç **önce** gider (asıl muhatap sürücüdür ve bu uç ağ gerektirmez), telefon push'u sonra; geri viteste **bastırılır** (kamerayı WARNING bölemez) ve uyarı **CRITICAL değildir**. **(3) Servis "Yapıldı" akışı kilometreyi artık soruyor (#586).** Araçtan ölçüm alınamıyorken kayıt sessizce `null` yazılıyordu ve **kullanıcıya hiç sorulmuyordu** — oysa kilometreyi bilen tek kişi oydu; ürün, kendisine verilebilecek veriyi istemeden "hesaplayamıyorum" diyordu. Ölçüm varken davranış aynı; yokken form açılır, **"Bilmiyorum" ayrı bir düğmedir** ve `null` yazar (uydurma 0 hâlâ yasak). Alt sınırın altındaki değer reddedilmez ama **uyarılır** (#580'in asimetrisiyle tutarlı). **(4) Kayıt düzenleme (UPDATE) arayüzü açıldı (#587).** 064 UPDATE ayrıcalığını ve politikasını zaten vermişti; yazma katmanı ve arayüz yoktu → yanlış litre/kilometre ancak kaydı **silip yeniden girerek** düzeltilebiliyordu. Üç yol üç ayrı gerçektir: `SERVER` sunucuda güncellenir ve **çevrimdışı reddedilir** (kuyruğa alınmış bir düzenleme başka cihazın değişikliğini sessizce ezerdi), `QUEUED` kuyruktakini iptal edip yerine düzeltilmişi koyar, `LOCAL` yerinde güncellenir. **Kritik dürüstlük kapısı:** RLS altında UPDATE, satır görünmüyorsa **hata vermez** — sıfır satır etkiler ve başarılı görünür (#195'in dersi); yazıcı `.select('id')` ile etkilenen satırı **okur**, satır yoksa başarı **iddia edilmez**. Kanıt: **33 yeni kilit**, kök kasası **12 053/12 054** (düşen 1 test ve 5 yükleme hatası bu turun DEĞİL — `git stash` ile doğrulandı, #588), website **1075/1075**, iki tsc temiz, **yanlışlama dört kez koşuldu** (tazelik kapısı · sahte 0 alanı · boş-girdi `null`'ı · alt-sınır uyarısı ayrı ayrı bozuldu → ilgili kilitler anında düştü, hepsi geri alındı). **KALAN AÇIK BORÇ:** hiçbiri **gerçek cihazda ölçülmedi** — #573/#574/#577/#578/#579/#580/#584/#585/#586/#587 **🔴 kalır** ve kabul ölçütleri kütüktedir · **#588 KAPATILDI (aynı gün):** kasadaki 5 ölü SQL güvenlik kilidi onarıldı — hedefleri "migration niyeti"nden **üretim gerçeğine** (`00000000000000_prod_baseline.sql`) taşındı, böylece kilitler zayıflamadı **güçlendi**. Onarırken **dört sapma ölçüldü ve beyan edildi** (kusuru korumazlar; kusurun hâlâ orada olduğunu kilitlerler): **S1** OTA tablolarında `anon` tam yazma ayrıcalıklı — tek savunma RLS (karşı örnek: `vehicle_geofences`te aynı tuzak kapatılmış, yani sapma "yapılamaz" değil "yapılmamış") · **S2** `ota_apks` bucket'ı **prod'da hiç yok** → OTA dağıtımının depolama ucu üründe mevcut değil · **S3** `rollout_plans.status`'ta CHECK kısıtı yok → durum serbest metin · **S4** baseline fonksiyon EXECUTE ayrıcalıklarını taşımıyor → o kilitler bu turda geri getirilemedi. En değerli yeni kilit istemci↔sunucu senkronudur: istemcinin `SERVER_MAX_BYTES` sabiti prod'daki `c_max_bytes` ile birebir karşılaştırılıyor — ayrışırsa ya veri sessizce kaybolur ya da gönderilebilir rapor gönderilmez; bu ayrışmayı bugüne dek hiçbir kilit yakalayamazdı. Kasa **541/541 dosya · 12 124/12 124 test** yeşil, `npm run guard` 518/518 → **APK kapısı açıldı**. Yanlışlama dört ayrı bozmayla koşuldu, altı kilit anında düştü. Dört sapma **açık borçtur** (kabul ölçütleri kütük #588'de) · OBD kilometresiyle **otomatik bakım eşleştirmesi** hâlâ yok (bakım hükmü elle girilen km'ye bağlı) · **Eşleştir ekranı** telefonda eski deploy'a bakıyor (kod meselesi değil, deploy meselesi). 🔴 saha kanıtı bekliyor. · **UZAK KOMUT ZİNCİRİ SAHADA ÖLÜ BULUNDU VE UÇTAN UCA ONARILDI (2026-08-19, kütük #645–#648):** kullanıcı aracı eşleştirdiği anda özellik zincirinin **hiçbir halkasının çalışmadığı** ortaya çıktı ve her halka prod'da **ölçülerek** kapatıldı. **(1) YAZMA (#645):** `vehicle_commands.company_id` NOT NULL'du, bireysel araçta şirket yoktur → "ARACA GÖNDER" hiç INSERT edememiş (tablo 0 satır). **(2) OKUMA (#646):** araç tabloyu doğrudan sorguluyordu; anon istemcide `auth.uid()` NULL → 0 satır. `fetch_pending_vehicle_commands` (069) eklendi. **(3) DURUM YAZMA + İSTEMCİ (#647):** `anon`un tabloda **hiç ayrıcalığı olmadığı** ve `accepted_at`/`executed_at`/`finished_at` kolonlarının **şemada bulunmadığı** ölçüldü → `update_command_status` ve `increment_command_retry` **hiç çalışmamış** (#646'nın "UPDATE ucu çalışıyor" varsayımı yanlıştı). 070 ile kolonlar eklendi, imza tekilleştirilip `p_result` ucu açıldı; istemci hem okumayı hem yazmayı **api_key RPC'lerine** bağladı. Ayrıca `vehicle_push_tokens` **0 satır** olduğu için push-to-wake hiç tetiklenmiyordu ve dinleyici yalnız "FCM kaydı başarısız" dalında açılıyordu → **hiç açılmıyordu**; dinleyici ömrü artık **eşleşmeye** bağlı ve kalıcı, teslim **15 sn ÇEKME** ile (Realtime olayları anon istemcide RLS yüzünden gelmez). **(4) PWA KALICILIĞI (#648):** yetki kapısı kendi runtime'ı başlatılmadan sorulduğu için **her sayfa yenilemesinde** eşleşmiş araç kayboluyordu; kapı sırası düzeltildi. **GÖZLEMLENEBİLİRLİK:** LAB → Uzak Komut Zinciri artık çekme kanıtını (`yoklama turu · hatalı tur · son sonuç ok/empty/no_key/error`) ve iki yeni hükmü (**KOMUT HİÇ ÇEKİLMEDİ** · **ÇEKME HATA VERİYOR**) gösteriyor — "komut gelmedi" ile "hiç sorulmadı" ayrımı yoktu ve kusurun uzun süre görünmemesinin sebebi buydu. **AÇIK SINIF:** aynı NOT NULL `company_id` deseni **18 tabloda** duruyor (bireysel araç `telemetry_events`/`notifications` gibi tablolara yazamaz). 🔴 **Zincirin tamamı gerçek araçta doğrulanmadı** (yeni APK şart); kabul ölçütleri kütük #647/#648'de. |
| CAROS Cloud | İSKELET | HAYIR | Supabase + RPC var; **senkron sözleşmesi yok** |
| Digital Garage | YOK | HAYIR | **Tek araç varsayımı** sökülmeli (geniş dokunuş) |
| Family Sharing | YOK | HAYIR | Garage + Cloud Sync'e bağımlı |
| Fleet Mode | **ENTEGRE** | HAYIR | **Web/PWA ucu uçtan uca kuruldu (kütük #167):** 6 Company API rotası (kimlik yalnız auth session'dan · sunucu tarafı `assertCapability` · typed hata kodları) · rol/capability matrisi (individual·observer·member·admin × 14 yetki, bilinmeyen rol **fail-closed**) · 6 filo ekranı + 12 durum · araç ata/çıkar (sahiplik DEĞİŞMEZ) · "Araç erişim rolleri" kartı matristen **türetilir**. **Cihaz-içi filo modu hâlâ YOK.** 🔴 **staging/saha kanıtı bekliyor** — cross-tenant reddi, observer salt-okunurluğu ve son-admin koruması gerçek oturumla ölçülmedi. · **🟢 TELEFON DOĞRULAMASI YAPILDI (2026-07-30, kütük #190):** Xiaomi 23090RA98I / Android 13 gerçek cihazda P1–P15 koşuldu → **14 PASS · 1 FAIL**. Ayakta yerel Supabase (migration **033–039 uygulandı**, `vehicles.revision` trigger'ı canlı). Koşum **dört ürün kusuru ölçtü ve düzeltti** (kütük ❌ F1–F4): (1) çevrimdışı kuyruk her sayfa açılışında siliniyor + ekran "Tüm işlemleriniz sunucuya iletildi" diyordu (**yalan tamamlanma**), (2) reconnect'te **hiç otomatik senkron yoktu** (banner sözünü tutmuyordu; 40 sn/0 istek), (3) boşluk tespiti otoritesi **hiçbir gerçek kopma sinyaline bağlı değildi** — 60 sn tam kesintide durum `LIVE`, ekran "Canlı — veriler güncel", sunucu 6 revizyon ileride, (4) çıkış yerel kuyruğu/snapshot'ı silmiyordu. **AÇIK:** sahiplik devri UI'dan **hiç başlatılamıyor** — `list_company_vehicles` (036) `revision` döndürmüyor, devir kapısı (039) onu zorunlu tutuyor (kütük #189) · `website` production build'i `ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY` ile **düşüyor** (paralel iş; kütük ❌ F5). Durum **SAHADA DOĞRULANDI'ya YÜKSELTİLMEDİ**: head unit hiç denenmedi, production hiç kullanılmadı, tek build üzerinde 15/15 geçiş yok (kütük #188). · **🟢 İKİNCİ TUR (2026-07-30, kütük #192/#194):** **SAHİPLİK DEVRİ ARTIK ÇALIŞIYOR** — gerçek cihazda uçtan uca tamamlandı (A başlattı → B kabul etti → sunucuda `owner_id=B`, `company_id NULL`, revizyon +1, transfer `COMPLETED`, **eski sahibin pairing kaydı 0**, bekleyen komut iptal; A'da araç yok, düzenleme denemesi **409**). Kapatılan iki backend kusuru: **migration 040** — `list_company_vehicles()` `revision` döndürmüyordu (devir hiç başlamıyordu) · **migration 041** — `list_vehicle_transfers()` her çağrıda `42702 column reference "id" is ambiguous` atıyordu, yani devrin **OKUMA ucu 039'dan beri hiç çalışmamıştı** (hedef gelen devri göremiyordu). Ayrıca iki dürüstlük kusuru daha düzeltildi: kuyruk "okunamadı" durumu "bekleyen yok" gibi sunuluyordu ve `refresh()` `loading`'de mahsur kalabiliyordu. **Nihai artefakt `6B37DB3B…` üzerinde 11/15 tam kanıtla PASS · 0 FAIL · 4 senaryo (P4·P5·P13·P15) `BLOCKED_EVIDENCE`** (ölçüm akışı borcu, kütük #193). Durum **SAHADA DOĞRULANDI'ya YÜKSELTİLMEDİ**: `phoneValidated=false` (15/15 şart), head unit hiç denenmedi, production hiç kullanılmadı, migration 033–041 production'da YOK. · **🟢🟢 ÜÇÜNCÜ TUR (2026-07-30, kütük #195): TELEFON DOĞRULAMASI TAMAMLANDI — **15/15 senaryo TEK ARTEFAKT üzerinde tam kanıtla PASS · 0 FAIL · 0 BLOCKED** (`phoneValidated=true`, artefakt `6B37DB3B…` = `website/src` 199 dosya + migration 040/041). Kalan dördü sürücüye zorunlu ön kapı eklenerek ölçüldü: P4 revizyon 41→44 + `SUSPECTED_GAP → RESYNCING → LIVE`; P5 16 sn snapshot gecikmesinde 11/11 örnekte "güncel" DEMEDİ; P13 8 geçiş → 8 reconnect/8 resync, runtime yeniden kurulmadı, rAF 17 ms, crash/ANR yok; P15 gerçek çakışma dürüst gösterildi ("zorla devral" YOK, ham SQL yok). **DURUM: SAHADA DOĞRULANDI (TELEFON)** — ancak **ÜRÜN HAZIR: HAYIR**: head unit'te H1–H8 `BLOCKED_HEAD_UNIT` (Fleet ekranları head unit APK'sında hiç yok), migration 033–041 production'da **YOK** (`NOT_VALIDATED`), ve `website` production build'i `ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY` ile **düşüyor** (paralel iş; kütük ❌ F5) → PWA yayınlanamaz. Ayrıca `RECONCILING` durumu yapı gereği gözlenemez (kütük 🟡 #196). · **🔵 ARAÇ BAĞLANTI/TELEMETRİ P0 (2026-07-30, kütük #197–#202 — `FLEET_VEHICLE_CONNECTIVITY_P0_PARTIAL`):** Zincirin **veri dürüstlüğü** onarıldı. Ölçülen 14 kusurun en ağırları: `rpm` ve `engineTempC` telemetri payload'ına **HİÇ konmuyordu** (Fleet'te kalıcı `0`); bilinmeyen hız `speed: 0` gönderiliyor, RPC de `coalesce(NULLIF(payload->>'speed',''),0)` ile bunu **DB'de kalıcılaştırıyordu**; `tel?.fuel ?? 0` yüzünden yakıtı bilinmeyen araç **kırmızı boş çubuk + "⚠ Yakıt ikmali gerekiyor"** sahte kritik alarmı veriyordu; bekçi araç çevrimdışına düşünce **`speed:0, rpm:0` yazıyordu** (90 km/h'te kopan bağlantı "0 km/h" oluyordu); `/api/pwa/pair` **hiçbir migration'da tanımlı olmayan** `pair_vehicle(text)` RPC'sini çağırıyor, **kimlik doğrulamasız** çalışıyor ve **HAM `api_key` döndürüyordu** (`vehicles.pairing_code` kolonu hiç oluşturulmamıştı); PWA ekranı **QR eşleştirmesini destekleniyormuş gibi** gösteriyordu. Yapılanlar: saf `telemetryContract` (bilinmeyen alan **konmaz**, ölçülen `0` korunur, NaN/Infinity/aralık dışı reddedilir, bayat OBD/GPS **eklenmez**) · üç ölü eşleştirme yolu **410** ile kapatıldı ve tek otorite `pair_vehicle_to_user`'da sabitlendi · **migration 042** (tazelik/kaynak kolonları · `received_at`/`observed_at` ayrımı → **istemci saati otorite değil** · `vehicle_identity` + `record_vehicle_identity` ile `IDENTITY_CONFLICT` ve **sınırlı** güven 0.50→0.95, çakışmada eski VIN **korunur** · anon REVOKE · fail-closed DO bloğu) · sinyal başına tazelik (`LIVE·STALE·OFFLINE·NEVER_SEEN·UNKNOWN`; mevcut `Connectivity` enum'ı **değiştirilmedi**) · Fleet UI dürüstlüğü ("Veri yok" · "eski veri" · "Son bilinen konum") · **CAROS LAB → Vehicle → Fleet Connectivity** salt-okunur ekranı (redaction: `api_key` değeri, ham kod, TAM VIN, TAM UUID **yok**). Kanıt: kök **8 885/8 885**, website **685/685**, iki tsc temiz, **26 gerçek-PostgreSQL** sözleşme doğrulaması, 042 **idempotent**. **AÇIK BORÇ:** `reportVehicleIdentity()` yazıldı ve test edildi ama **VIN/parmak izi üreten kaynaklara çağrı noktası bağlanmadı** → kimlik hâlâ sunucuya gitmiyor. `website` build kapısı **hâlâ kapalı** (paralel AccountCleanup `useSessionUser` → SSR muhafızı; bu paket o dosyaya dokunmadı) → ana karar bu yüzden `COMPLETE_LOCAL` değil **`PARTIAL`**. Tam rapor: `docs/FLEET_VEHICLE_CONNECTIVITY_P0_REPORT_20260730.md`. · **🔵 ARAÇ KİMLİĞİ P1 (2026-07-30, kütük #203–#208 — `COMPLETE_LOCAL`):** P0'ın en büyük açık borcu kapandı — kimlik boru hattı artık **canlı gerçek kaynaklara bağlı**. Zincir koddan izlendi: native `performHandshake()` → Mode 09 PID 02 ham VIN → `buildHandshakeResult` → `vehicleProfileRegistry.findBestMatch` → `persistHandshakeVin` → `decodeWmi`/`decodeVinYear` → `useVidStore` ayna → `AutomaticVehicleFingerprint` (SystemBoot:830, CANLI) → **kimlik koordinatörü** → tek ağ ucu. Bu turda **dört gerçek kusur** bulundu: (1) kimlik yayını HİÇ çağrılmıyordu; (2) **`22P02`** — istemci `fingerprint_version`'ı `'fp1'` metin gönderiyor, 042'deki RPC `int` bekliyordu → kimlik çağrısının TAMAMI düşüyordu; (3) **`42P01`** — kendi 042'mdeki okuma RPC'si var olmayan `company_members` tablosuna bakıyordu (üyelik `profiles.company_id`'de) → oturumlu her kullanıcı için fonksiyon düşüyor, Fleet UI'da kimlik HİÇ görünemezdi; (4) koordinatörün async yayın yolunda üst düzey muhafız yoktu → yakalanmayan promise reddi + `_inFlight` sonsuza dek `true` (yayın kalıcı susar). (2) ve (3) **kendi P0 çalışmamın kusurları** ve ikisi de "test yeşil + tsc temiz" olmasına rağmen vardı; yalnız **gerçek PostgreSQL'de gerçek `auth.uid()` oturumuyla** çalıştırınca ortaya çıktı. **Kalıcı ders:** *fonksiyonun tanımını okumak onu çalıştırmak değildir* — 042/043 doğrulamam gövde METNİNİ inceliyordu ve oturumsuz çağrıyı sınıyordu, o dal `auth.uid() IS NULL`'da erken dönüp hatalı satıra hiç ulaşmıyordu. Yapılanlar: saf kanonik `VehicleIdentityObservation` (13 alan; VIN türevi marka/yıl VIN yoksa taşınmaz, doğrulanmamış taşımada protokol "aktif" sayılmaz, nesil yalnız marka+yıl varsa türer) · **tek yayın otoritesi** koordinatör (kanıt kapısı → dedupe → bütçeli backoff retry → tek ağ ucu; yapısal kilitle doğrudan çağrı YASAK) · **migration 043** (`identity_revision` + `vehicle_generation` + `protocol_change_count`, `fingerprint_version` → text, `UNCHANGED` hükmü güven şişmesini kapatır, `PROTOCOL_CHANGED` çakışma DEĞİL) · **migration 044** (kapsam `profiles.company_id`) · **CAROS LAB → Vehicle → Fleet Identity** salt-okunur ekranı · Fleet UI araç detayında "Araç Kimliği" (okunamadı ≠ bilinmiyor; savunma katmanlı maskeleme: maskesiz VIN UI'dan GEÇEMEZ). Kanıt: kök **8 964/8 964**, website **727/727**, iki tsc temiz, **36 gerçek-PostgreSQL** doğrulaması (devir · observer · owner · cross-tenant · anon deny · service role dahil), 043/044 idempotent. **Ölçüm dürüstlüğü:** ilk koşumda devir testleri FAIL verdi — ürün değil TEST kusuruydu (`set_config('role','authenticated')` = `SET LOCAL ROLE` → fixture UPDATE'i RLS yüzünden 0 satır etkiledi ve sessizce geçti); `RESET ROLE` + `GET DIAGNOSTICS ROW_COUNT` ile onarıldı. **AÇIK BORÇ:** gerçek araç doğrulaması YOK (#203–#208 🔴) · `supportedPidBitmap` parmak izi hesabına dahil değil (imza eşleşmesi fiilen yalnız protokol+ECU; eklemek tüm hash'leri değiştirir → ayrı PR) · 040–044 hiçbir ortama uygulanmadı. Tam rapor: `docs/FLEET_VEHICLE_IDENTITY_P1_REPORT.md`. · **🔵 KONUM MOTORU P1 (2026-07-30, kütük #209–#213 — `COMPLETE_LOCAL` · gerçek cihaz `BLOCKED_REAL_DEVICE`):** tek GPS kaynağı çok kaynaklı hakeme dönüştürüldü (EXTERNAL_GPS → HEAD_UNIT_GPS → PHONE_HUB_GPS → LAST_KNOWN). `gpsService` **DEĞİŞTİRİLMEDİ**, yalnız gözlemleniyor — mevcut harita/hız/radar/geofence tüketicileri aynı. Güven üç bağımsız kanıttan (hassasiyet · tazelik · **süreklilik**) türer ve **en zayıf kanıt tavanı belirler**: *tek fix `MEDIUM`'dur*, mükemmel hassasiyette bile — çünkü tek fix çok yollu yansımayı, soğuk-başlangıç kaba fix'ini ve tünel çıkışı sıçramasını ayırt EDEMEZ. Titreşim üç kapıyla engellendi (yükseltme serbest · düşürme 6 s gecikmeli · 4 s tutunma): 20 s'de 40 kez zıplayan kaynakta kapılar olmasa ~40 geçiş olurdu, gerçekleşen **≤6**. **İki ciddi kusur bulundu:** (1) `push_vehicle_event` koordinat aralığını DOĞRULAMIYORDU — gerçek PG testi `lat=999` gönderdi ve **yazıldı**; migration 045 kapattı (+ Null Island `(0,0)`; yalnız CHECK eklemek payload'ı düşürüp kuyruğu poison'a atardı, RPC de kapıya bağlandı). (2) **🔴🔴 kök `tsc --noEmit` HİÇBİR ŞEYİ denetlemiyordu** (çözüm dosyası, `"files": []`) — kasıtlı tip hatası bile sessiz geçti. Bu boş denetim yüzünden P0 ve P1 `CarosLabToolId` union'ına eklenmeyen araç kimlikleriyle **kök build'i KIRIK bırakmıştı**; üç id eklendi, `npm run build` gerçekten geçti. **Kalıcı kural:** kökte tip kanıtı `npm run build`/`tsc -b`'dir. Kanıt: 57 kilit + **13 gerçek-PG** doğrulaması. Rapor: `docs/FLEET_LOCATION_ENGINE_P1_REPORT.md`. · **🔵 TRIP MOTORU P1 (2026-07-30, kütük #214–#218 — `COMPLETE_LOCAL` · gerçek araç `BLOCKED_REAL_VEHICLE`):** mevcut `tripLogService` Fleet'e taşındı — **yeni trip sistemi yazılmadı**, o modülün tek satırı değişmedi (kilit #13 yapısal olarak zorluyor). **En önemli gerçek: yakıt ve maliyet ÖLÇÜLMÜYOR, TAHMİN.** Head unit yakıtı `mesafe/100 × 8,5 L` sabitiyle, maliyeti sabit birim fiyatla hesaplıyor; `fuelAtStart` araçtan okunuyor ama `TripRecord`'da **hiç kullanılmıyor**. Bu paket o gerçeği düzeltmedi ama **gizlemiyor**: her metrik `MEASURED·DERIVED·ESTIMATED·UNAVAILABLE` etiketi taşıyor, DB'de `fuel_source`/`cost_source` kolonlarında saklanıyor, Fleet UI'da **"(tahmini)"** ekiyle görünüyor. `tripLogService`'te HİÇ üretilmeyen metrikler (idle/moving time · stop count · max rpm · max temp · speed violations) **UYDURULMADI** → `NULL`. Kanonik model (`TripSummary`/`TripMetrics`/`TripEvent`/`TripStatistics`) + yaşam döngüsü otoritesi (RUNNING→PAUSED→RESUMED→COMPLETED→UPLOADED→ARCHIVED; geçersiz geçiş YOK SAYILIR) + **§5 anlık yükleme YOK** (canlı 5 s bildirimleri elenir, yalnız kapanan trip tek özet olarak mevcut at-least-once kuyruğundan gider) + **§6 deterministik `trip_key` dedupe** (rastgele `tripId` dedupe için KULLANILAMAZ; aynı/düşük revizyon `DUPLICATE`, yüksek revizyon `UPDATED`; 10 replay → **tek satır**) + migration 046 (`vehicle_trips`, 14 metrik **NULLABLE**, koordinat kolonu **YOK**, RLS + anon kilidi) + LAB Trip Engine + Fleet UI Yolculuklar. Kanıt: 87 kilit + **25 gerçek-PG** doğrulaması (owner · observer · cross-tenant · anon deny · devir · offline replay), kök **9 086/9 086**, website **770/770**, `npm run build` geçti. **AÇIK BORÇ:** gerçek araçta hiç yolculuk tamamlanmadı · `PAUSED`/`RESUMED` ve stop count gerçek üretimi yok · gerçek yakıt ölçümü yok · `harshBrake`/`harshAccel` kalıcı değil (Driver DNA verisi trip kapanışında kayboluyor) · geçmiş 100 trip göç etmedi. Rapor: `docs/FLEET_TRIP_ENGINE_P1_REPORT.md`. |
| Fleet Intelligence | İSKELET | HAYIR | `fleetKb` servis kapısı; **anonim toplama boru hattı yok** |
| Privacy Center | İSKELET | HAYIR | Sanitize motoru 🟡 kanıtlı; **kullanıcı paneli yok** (P3-2) |
| Cloud Sync | İSKELET | HAYIR | Tek yönlü rapor teslimi 🟢; **senkron/şema/RLS yok** (P2-6). **KISMİ İLERLEME (#167):** filo/sahiplik alanı için typed **offline domain kuyruğu** (11 işlem türü · bounded · TTL · üstel backoff · dedupe · dependsOn · poison-item), **sync orchestrator** (domain sırası + entity serileştirme, 9 durum), **13 kodlu conflict engine** (ownership/company'de otomatik local-wins YOK, server-wins/fail-closed) ve **ownership snapshot** (bayat snapshot kritik yazmayı ENGELLER) kuruldu. Bu yalnız **filo alanını** kapsar — genel cihaz↔bulut senkron sözleşmesi hâlâ YOK. 🔴 |
| OTA Intelligence | ENTEGRE | HAYIR | `otaUpdateService` state machine; **telemetri yok**, saha kanıtı yok |
| Vehicle Marketplace | YOK | HAYIR | Life Story + doğrulama otoritesi ister — **ürün kararı gerekir** |
| Digital Health Certificate | YOK | HAYIR | Passport + doğrulanmış geçmişe bağımlı |
| Çoklu araç/kullanıcı yetkilendirmesi | **ENTEGRE** | HAYIR | Filo rol modeli (individual·observer·member·admin) hem API hem UI'da uygulandı; **UI görünürlüğü güvenlik sayılmıyor** — her rota sunucuda ayrıca doğruluyor. Bir kullanıcı aynı anda yalnız bir şirkete üye olabilir; cross-tenant erişim fail-closed reddedilir. Çoklu **araç** modeli tarafında bireysel 3-araç limiti + şirket ataması var. 🔴 staging kanıtı bekliyor (#167). |
| Adaptive Runtime | DOĞRULANDI | HAYIR | Tier motoru + histerezis kilitleri; **düşük-uçta (K24) tier kabulü ölçülmedi** |
| Knowledge Base | ENTEGRE | HAYIR | KB **statik/yerel** — "öğrenen filo KB" iddiası doğrulanmadı |

---

## 9. Çelişki Kaydı

> Kanıtla çözülene kadar **hiçbir durum yükseltilmez**. Yeni çelişki bulunduğunda buraya yazılır.

| # | Çelişki | Kanıt | Karar |
|---|---|---|---|
| Ç-11 | §8.6 **"Maliyet tahmini | YOK"** diyor; oysa `platform/trip/cost/` altında **12 dosya / 2 111 satır** saf çekirdek + testleri duruyor (TRIP-COST-A1…B2: dört sağlayıcı · `confidenceLedger` · boru hattı · rota adaptörü). | Ölü kod envanteri (2026-08-09) ölçümü; `src/platform/trip/cost/` dosya/satır sayımı. | **Vizyon iyimser değil, KÖR.** Durum **YOK → İSKELET**'e çekildi: kod var, ürün yolunda değil, hiçbir fiyat girdisinin kaynağı yok. **ÜRÜN HAZIR: HAYIR** değişmedi. Ders: "YOK" satırı bazen "kod yok" değil "kimse bakmadı" demektir — envanter olmadan capability defteri kendini yanıltır. |
| Ç-12 | Ölü kod envanteri (2026-08-09) `guardianDecisionEngine`'i **"11. karar otoritesi"** diye listeledi; modülün kendi başlığı ise *"Bu motor KARAR-SUNUMU yapar, RİSK ANALİZİ DEĞİL — event ÜRETMEZ, severity HESAPLAMAZ"* diyor. | `guardianDecisionEngine.ts:1-28` (yeniden adlandırmadan ÖNCEki yol — bugün `guardianAlertRanker.ts`); motor `GuardianRiskEvent`leri değiştirmeden taşır, `highestSeverity`/`overallRiskScore` değerlerini aynen korur. | **Envanter yanlıştı → düzeltildi.** Modül bir karar otoritesi DEĞİL, **uyarı sıralayıcısıdır**; ADR-286'nın tekleştirmek istediği şey *hüküm üretenler*dir, sıralayıcılar değil. Karar otoritesi sayısı 11 değil **10**. **Yeniden adlandırma UYGULANDI (2026-08-09, tek atomik PR):** `guardianAlertRanker` · `rankGuardianAlerts` · `GuardianAlertPlan` · `GUARDIAN_ALERT_RANKER_ID`. Davranış değişmedi (tsc temiz · 26/26 · guard 393/393). Yanlış ad, bir sonraki okuyucuyu aynı yanılgıya düşürürdü. |
| Ç-1 | `docs/OBD_DIAGNOSTIC_OS_ROADMAP.md` kendini **"TEK GERÇEK KAYNAKTIR"** ilan ediyor; bu belge de ana kaynak olarak konumlanıyor. | İki dosyanın başlıkları. | **Çözüldü:** roadmap **OBD alt-roadmap'idir** (görev kırılımı); vizyon/durum özeti bu belgededir. Roadmap'in kendi ifadesi OBD kapsamıyla sınırlı okunur. |
| Ç-2 | Roadmap "FAZ 0 → 3 madde 🟢 (F0-1, F0-2, F0-4)" diyor; **kütükte F0-1 (#66) hâlâ 🔴/🟡 satırında, F0-4 (#70) 🟡 KISMİ**. | `DEVICE_VALIDATION_LEDGER.md` §🟢 tablosu: yalnız **#67 (F0-2)** tam 🟢; #66/69/71 satırı açıkça "**KISMİ 🟡**". | **Kütük kazanır.** Bu belgede F0-1 = 🟡 (regresyon yok, DTC'li araç kanıtı yok), F0-4 = 🟡. Roadmap'in "3 🟢" özeti **iyimser**. |
| Ç-3 | `docs-local/caros-feature-audit.html`, Deep Scan için "`start()/run()/runNextPhase()` production'da **hiçbir yerden çağrılmıyor**" diyordu. | `SystemBoot.ts:667` → `triggerDeepScanOfflinePass()` → `orchestrator.runOfflinePass()` **çağrılıyor**; ancak handler bağlı değil → tüm fazlar `skipped`. | **Kısmen yanlış → HTML düzeltildi.** Sonuç seviyesi (İSKELET) değişmez: gerçek tarama yok. Doğru ifade §8.1'dedir. |
| Ç-4 | `docs/CAROS_15_YIL_VIZYON_YOL_HARITASI.md` (2026-07-08) ve `ROADMAP.md` (2026-06-24) farklı durum tabloları taşıyor. | Tarihler + içerik. | **Tarihsel** ilan edildi (§1). Güncellenmiyorlar; çelişkide bu belge kazanır. |
| Ç-5 | Web sitesi "200+ DTC" diyor; üründe **37** DTC var. | `WEB_URUN_UYUM_BACKLOG.md`. | Açık — P3-5. Pazarlama iddiası **ürün gerçeğine** çekilecek. |
| Ç-6 | Root Cause Engine `FUSION_LOW_CONFIDENCE` için **yanlış dosyayı** işaret ediyordu (`speedFusion.ts`). | Tanı raporundaki `fusion.activeSource` `useHALStatusStore`'dan gelir → `VehicleSignalResolver:348` → **VehicleCompute worker**. `speedFusion.ts` yalnız `MiniMapWidget` + `telemetryService` tarafından kullanılır — ana göstergeyi beslemez. | **Düzeltildi** (`931b41c`): `suspectFiles` artık ana yolu (worker) ilk sırada gösteriyor. **Ders:** tanı motorunun kendisi de kanıtla denetlenmeli — yanlış yönlendiren tanı, tanısızlıktan pahalıdır (beni de yanlış dosyaya yolladı). |
| Ç-7 | **İki paralel hız sistemi** var ve *akıllı olan* ana yolda değil. | `speedFusion.ts` plausibility + histerezis + kalibrasyon içerir ama yalnız MiniMap/telemetry'de; ana gösterge yolu (worker → resolver → HAL store) bunlardan **hiçbirine** sahip değildi. | **Kısmen kapatıldı** (`931b41c` çelişki kapısını ana yola koydu). **Açık borç:** iki sistemin varlığı mimari bir kokudur — uzun vadede tek otoriter hız kaynağı olmalı (Digital Twin provenance ile birlikte, P2-5). |
| Ç-9 | "Bağlantıyı Sıfırla" saha'da **görünür lifecycle üretmiyordu** → kayıtlı cihaz "bağlı gibi" kalıyor, UI/native aynı gerçeği gösterip göstermediği belirsizdi. | `OBDConnectModal.tsx`: reset + reconnect TEK senkron tick'te; `resetObdConnection` void (async native disconnect fire-and-forget). Native disconnect zinciri aslında tamdı → boşluk UX/gözlemlenebilirlikte. | **Düzeltildi** (PR-OBD-CONN-1): reset artık Promise (native disconnect'i bekler) + buton "Sıfırlanıyor…"/disabled + bounded lifecycle telemetrisi (`obdDeep.connLifecycle`). **Açık borç:** stale-veri "connected" rozetini gizleme (freshness-gated badge) ayrı PR. **🔴 Trafic'te doğrulanmadı.** |
| Ç-8 | Kod yorumu "**Vite prod'da `worker.format:'iife'` → `type:'module'`'ü classic'e ZORLAR**" diyordu; bu YANLIŞTI. | Duster saha raporu `44a81bd1` (WebView 74): `VehicleCompute:create — Failed to construct 'Worker': Module scripts are not supported on DedicatedWorker` (tekrarlı) + `%45 ana thread donması` verdict'i. Prod bundle incelemesi: worker DOSYASI IIFE ama call-site `{type:"module"}` **kalıyordu** → Vite `type`'ı call-site'ta değiştirMEZ. | **Düzeltildi** (PR-RUNTIME-WORKER-1): iki literal-type call-site (`import.meta.env.DEV` ölü-kod eleme ile prod'da 'classic' bırakır). Prod bundle artık `{type:"classic"}`. **Ders:** worker DOSYA formatı ≠ constructor `type` seçeneği — ikisi ayrı ayrı doğrulanmalı; "Vite halleder" varsayımı bundle denetimiyle sınanmadan yazılmamalı. **🔴 Duster/8227L cihazda worker round-trip doğrulaması bekliyor.** |
| Ç-10 | Kütük **#471 (PR-3b)** "tam suite **10 993 test / 485 dosya** — `--testTimeout=30000` ile **TEMİZ**" diyor; PR-451a turunda ölçülen: **11 016/11 019 · 3 DÜŞTÜ**, üçü de `routeColorPolicy.test.ts` içinde. | Tek başına koşumda da deterministik düşüyor (`npx vitest run src/__tests__/routeColorPolicy.test.ts`): "TEHLİKE yüksekken kademe 1→0 … amber KORUNUR" ve "YENİDEN ÇİZİM … tehlike rengi KAYBOLMAZ" → beklenen `#f59e0b`, gelen **`#0A0C10`**; "BAYAT ANAHTAR TUZAĞI…" → beklenen `#ffffff`, gelen **`#0A0C10`**. **Kök:** bu üç ENTEGRASYON testi PR-3a döneminde, kılıf her zaman `#ffffff` iken yazıldı ve `syncRouteColor` üzerinden **gerçek** `resolveLightBasemap()`i çağırıyor; test ortamında `getMapNight()=false` + `getMapMode()='road'` → `lightBasemap=true` → PR-3b'nin açık-zemin mürekkebi `#0A0C10` yazılıyor. Testler PR-3b'de **güncellenmedi**. | **Ölçüm kazandı — #471'in "TEMİZ" iddiası DÜŞTÜ.** Bu bir ÜRÜN kusuru değil, **bayat kilit testi** kusuruydu: `#0A0C10` PR-3b'nin bilinçli ve kütüğe yazılmış kararıdır (açık zeminde kılıf koyu mürekkep, tehlike sinyali **halo** üzerinden taşınır). PR-451a bu dosyaya dokunmadı (kapsam dışı, atomiklik). **✅ ÇÖZÜLDÜ (2026-08-08, Ç-10 test bakım turu):** ürün kodu DEĞİŞMEDİ; yalnız `routeColorPolicy.test.ts` güncellendi. Kök sebep testin ENTEGRASYON bloğunun zemin kutbunu **hiç sürmemesi** ve ortam varsayılanına (gündüz+road → AÇIK) sessizce bağlanmasıydı — PR-3a'da kılıf her zaman `#ffffff` olduğu için bu bağımlılık görünmüyordu. Üç kilit `withPole()` ile kutbu AÇIKÇA sürüyor ve artık **iki kutupta birden** koşuyor (3 test → 6): açık zeminde kılıf `#0A0C10`, koyu zeminde `#ffffff`/amber; her ikisinde de halo tehlikede amber KALIR. Kilit **zayıflatılmadı, GÜÇLENDİ** — açık zeminde kılıf tehlike/normal ayrımı taşımadığı için "boya gerçekten yazıldı mı" sorusunu halo yanıtlar ve bu ayrıca kilitlendi. Sonuç: tam suite **11 022/11 022** (varsayılan timeout, `--testTimeout=30000` gerekmedi) · guard **368/368** · `tsc -b` temiz · eslint 0. #471'in "tam suite temiz" iddiası artık ölçümle karşılanıyor. |

---

## 10. Güncelleme Protokolü (bağlayıcı)

Bu belge statik kalmaz. CAROS PRO ile ilgili **her PR veya önemli değişiklikte**:

1. Göreve başlamadan önce **bu dosya okunur**.
2. Yapılan işin **hangi vizyon özelliğini etkilediği** belirlenir.
3. PR tamamlandığında **ilgili özellik durumu güncellenir**.
4. **Yeni dosya eklenmesi özelliği otomatik olarak tamamlanmış yapmaz.**
5. Durum **yalnız gerçek kanıta göre** yükseltilir.
6. **Saha kanıtı yoksa "SAHADA DOĞRULANDI" verilmez.**
7. Özellik hâlâ iskeletse **dürüstçe İSKELET kalır**.
8. PR kapsamı dışında kalan maddeler **dokümana yazılır** (sessizce düşürülmez).
9. **Son güncelleme tarihi ve ilgili PR/commit** eklenir.
10. Roadmap sırası bilinçli mimari kararla değiştiyse **gerekçe yazılır**.

### PR sonrası kontrol listesi

- [ ] Bu dosya okundu, etkilenen özellik(ler) bulundu.
- [ ] Durum seviyesi kanıta göre güncellendi (yükseltme kanıtsız yapılmadı).
- [ ] Production kanıtı: **çağrı zinciri** yazıldı (import ≠ kanıt).
- [ ] Test kanıtı: davranış testi mi, izole test mi — ayrıldı.
- [ ] UI/API yüzeyi güncellendi (yoksa "YOK" yazıldı).
- [ ] Saha doğrulaması: kütük satırı referansı verildi veya "Doğrulanmadı" yazıldı.
- [ ] Ürün hazır: altı koşul tek tek kontrol edildi.
- [ ] Eksik ana parça + sonraki atomik PR güncellendi.
- [ ] Kapsam dışı bırakılanlar yazıldı.
- [ ] Son güncelleme tarihi + PR/commit eklendi.
- [ ] Çelişki bulunduysa §9'a yazıldı.

---

## 10.9 Filo · Araç Sahipliği · Çevrimdışı Senkronizasyon (2026-07-29)

> Durum kaynağı: `docs/DEVICE_VALIDATION_LEDGER.md` #176 · #177 · #178 (üçü de 🔴).

### Filo / Şirket Üyeliği

- **Durum:** **ENTEGRE** (sunucu otoritesi kurulu, sahada doğrulanmadı)
- **Production kanıtı:** `useFleet` → `/api/company*` rotaları → `resolveActor()`
  (kimlik YALNIZ `auth.getUser()`'dan; istemci gövdesinden actor id OKUNMAZ) →
  `callRpc()` → migration 035/036 RPC'leri (`create_company` · `add_company_member` ·
  `list_company_members` · `list_company_vehicles`). Son-admin koruması ve
  cross-tenant reddi **RPC içinde**, UI'da değil.
- **Test kanıtı:** 398 website testi yeşil; rol/yetki matrisi, son-admin ve
  conflict sınıflandırması davranış testleriyle kilitli.
- **Eksik ana parça:** Migration 035/036 **production'a uygulanmadı**; davet
  (invite) akışı yerine doğrudan `add_company_member` var — e-posta ile davet YOK.
- **Ürün hazır:** **HAYIR** (production migration + saha doğrulaması yok).

### Araç Sahipliği ve Eşleştirme

- **Durum:** **ENTEGRE**
- **Production kanıtı:** `pair_vehicle` EXECUTE yetkisi 035'te `anon`/`authenticated`'tan
  GERİ ALINDI; eşleştirme sunucu tarafı doğrulamadan geçer. Çevrimdışı eşleştirme
  **sahiplik ÜRETMEZ** — yalnız `PENDING_SERVER_VERIFICATION` claim'i üretir ve kod
  AES-256-GCM ile şifreli saklanır (`offlinePairing.ts`).
- **Eksik ana parça:** Sahiplik **devri** (transfer) akışı YOK; cihaz değişimi
  senaryosu kodlanmadı. Linking code brute-force için sunucu tarafı rate limit
  doğrulanmadı.
- **Ürün hazır:** **HAYIR**.

### Çevrimdışı Mutation Kuyruğu ve Senkronizasyon

- **Durum:** **ENTEGRE** (tek otorite · fail-closed · bounded)
- **Production kanıtı:** `enqueueOfflineMutation()` **tek kapıdır**;
  `offlineClassification.ts` güvenlik/sahiplik işlemlerini çevrimdışı REDDEDER
  (§Ledger #176). `DomainQueue` hesap kapsamına bağlıdır, bilinmeyen şema
  sürümünü yorumlamaz; `SyncOrchestrator` tek-döngü kilidi + kuşak kapısı ile
  bayat yanıtın yeni hesabın kuyruğunu bozmasını engeller (§Ledger #177).
- **Cleanup entegrasyonu (PWA-P1-007):** queue, ownership snapshot ve pending
  pairing production `AccountCleanupCoordinator` composition'ında ayrı,
  deterministic participant'lardır. Her biri generation/lockdown kapısından
  sonra persistent + süreç-içi authority'yi temizler ve gerçek `verifyEmpty`
  olmadan fazı tamamlamaz (§Ledger #183).
- **Server session revoke (PWA-P1-008, TESTED_LOCAL):** prepare edilen immutable
  A access tokenını hedefleyen izole server `scope:local` revoke, ortak
  auth-mutation kilidi, account-hash/generation kapısı,
  timeout/network recovery ve ayrı `VERIFY_EMPTY` participant’ı production
  composition’a bağlandı (§Ledger #184/#186). Gap closure ile immutable session
  fingerprint hedefi, revoke-öncesi Account A/B kimlik karşılaştırması,
  singleton+fresh-client+cookie bağımsız final verify, recovery final reverify
  ve canonical auth-writer guard eklendi. Late `getUser/onAuthStateChange`
  sonuçları cleanup sırasında reddedilir; doğrulanmış cleanup sonrası yeni
  generation Account B olayı kabul edilir. Gerçek provider/browser ölçümü ve
  LAB auth gözlemi yoktur; access-token JWT expiry’ye kadar geçerli
  kalabildiğinden “anında tüm server authority iptal” iddiası kurulmaz.
  Topbar/Sidebar tek canonical coordinator transaction'ına bağlıdır; blocking
  cleanup fallback sign-out/navigation üretmez ve eski `/api/auth/logout`
  doğrudan bypass'ı session mutate etmeden reddeder. Final two-gap closure ile
  browser singleton sign-out kaldırıldı; local auth cookie purge yalnız A'nın
  doğrulanmış chunk-hash snapshot'ına uygulanır. Auth observer doğrudan offline
  storage silmez; A→B geçişini canonical coordinator'a yönlendirir.
- **UI/API yüzeyi:** `/dashboard/fleet` (özet) · `/members` · `/vehicles` ·
  `/pending` (çevrimdışı merkezi) · `/conflicts` · `/lab` (salt-okunur gözlem).
- **Eksik ana parça:** Kuyruk `localStorage` üzerindedir (IndexedDB değil) —
  büyük filo ve çok sekmeli kullanımda sekmeler arası kilit YOKTUR.
  Realtime gap-detection uygulanmadı.
- **Ürün hazır:** **HAYIR** (logout wiring host-testli; server revoke için
  gerçek staging/çoklu-sekme/process-death/account-switch saha kanıtı yok).

### Güvenlik (R4 — anon GRANT)

- **Durum:** **DOĞRULANDI (yerel)** — production'da **YOK**.
- **Kanıt:** Migration 037 geçici PostgreSQL'de koştu; `anon` → `profiles`/`companies`
  erişimi gerçekten **`permission denied`** oldu, `authenticated` 8/8 korundu,
  ikinci koşu idempotent, RLS kapalıyken fail-closed durdu (§Ledger #178).
- **🔴 Açık risk:** Head unit `commandListener.ts` **anon key ile `vehicles` ve
  `vehicle_commands` tablolarına doğrudan erişiyor**. Bu tablolarda anon GRANT'i
  geri alınırsa araç komut almayı bırakır. FAZ 2'nin ön koşulu bu erişimin
  SECURITY DEFINER RPC'ye taşınmasıdır.
- **Sonraki atomik PR:** head unit `vehicle_commands` okuma yolunun RPC'ye göçü.

---

## 11. Kapsam Dışı (bu belgenin yapmadıkları)

- Bu belge **kod değiştirmez**; capability durumu kodun aynasıdır, tersi değil.
- Bu belge **vizyonu uygulanmış özellik gibi sunmaz** — §8'deki YOK'lar taahhüt değildir.
- Bu belge **gelecekteki tüm fikirleri kısa vadeli taahhüde çevirmez**; öncelik yalnız
  P0–P3'tedir.
### PWA session cleanup final P1 host kanıtı — 2026-07-30

PWA-P1-008 `TESTED_LOCAL`: cookie compare/delete auth-js canonical storage lock
altına alındı; logout hedefi ilk await öncesinde immutable fingerprint ile
sabitlendi; concurrent account-transition metadata'sı scope doğruluyor. Website
730/730 ve TypeScript geçti. Durum `DOĞRULANDI` veya `ÜRÜN HAZIR` değildir:
staging, gerçek çoklu sekme ve process-death kanıtı yoktur; production security
gate `BLOCKED` kalır.
### PWA-P1-008 security architecture closure — 2026-07-30

PWA auth cleanup host seviyesi `TESTED_LOCAL`: production Supabase client'ları
explicit ortak auth lock'a katılıyor, account-scoped ledger v2 fingerprint
zorunluluğu taşıyor ve cookie partial mutation typed/fail-closed yönetiliyor.
Gerçek staging, browser, çoklu sekme ve process-death kanıtı bulunmadığından
durum `DOĞRULANDI`/`SAHADA DOĞRULANDI` değildir; ürün hazır değil ve production
security gate `BLOCKED` kalır.
### Saha eksiklerinin ikinci kapatma turu — 2026-08-07 (kütük #462–#466)

2026-08-06 Adana–Şanlıurfa sürüşünün açık maddelerinden **beşi** kapatıldı.
Tümü `TESTED_LOCAL` — 480 dosya / 10 882 test yeşil, `tsc -b` temiz.
**Hiçbiri `DOĞRULANDI` veya `SAHADA DOĞRULANDI` DEĞİLDİR**: gerçek araç kanıtı
yoktur, kabul ölçütleri kütükte 🔴 beklemektedir.

- **#462** OBD veri yolu yan deftere bağlıydı — `recordFeatureRecovered()`
  fırlarsa `connected` geçişi hiç yapılmıyordu (fail-soft onarımı).
- **#463 (#458)** Odometre Δt'si **ölçüm anına** bağlandı; varış farkı meşru
  hareketi teleport sanıp 32 dakikada 1,15 km'yi kalıcı siliyordu.
- **#464 (#456)** Kaza kaydı artık **hareket kanıtı** istiyor; depo en yeni
  5 kayıtla sınırlı. Sallanan telefon sahte çarpışma üretmiyor.
- **#465 (#459-a,b)** ECU susarken adaptörün ölçtüğü voltaj artık kaybolmuyor →
  akü uyarısı sürücüye ulaşabilir; "adaptör bağlı · ECU yanıt vermiyor" ile
  "bağlanamadı" **ayırt edilebilir** hâle geldi.
- **#466 (#460)** Wake watchdog bir arıza tespiti DEĞİLmiş: canlılık hiç
  ölçülmüyor, 5 dakikada bir koşulsuz yeniden kurulum var. Yanıltıcı
  "self-heal" mesajı kaldırıldı, karar ölçülebilir yapıldı.

**Bilinçli YAPILMAYANLAR (açık borç):**

- **#451 — KISMEN KAPANDI (PR-451a, kütük #472); teşhisi de düzeltildi.**
  Buradaki eski ifade ("konum ölü hesabı YOK") **yanlıştı**: `gpsService` ve
  worker doğru okunmuştu ama `navigationSessionRuntime._drTick` konum ÜRETİYOR
  ve `updateRouteProgress`e besliyor. Ölü olan özellik değil, projeksiyonun
  **EKSENİYDİ** — düz heading atışı virajda 60 sn tavanına ulaşamadan koridoru
  aşıyordu (türetme: s²/(2R), R=400 m'de ~8 sn). PR-451a ekseni rota
  geometrisine bağladı; sapma R≈400 m yayda 60 sn boyunca < 1 m (kilitli).
  **HÂLÂ AÇIK olanlar:** (a) `isDeadReckoningActive()` hâlâ `gpsService`e bakar
  ve **daima false** → HUD'da "GPS yok — konum tahmini" uyarısı **hâlâ yok**;
  (b) worker'daki ikinci (odometre) DR sahibi duruyor — odometre çift-sayımı
  riski bu yüzden sürüyor; (c) GPS dönüşünde fusion/reconciliation yok → tünel
  çıkışında konum sıçraması BEKLENİR. Dönüş rampası (`calculateFusionRamp`)
  ZATEN hazır ama BAĞLI DEĞİL. DR konumlarının `isEstimated` bayrağıyla
  taşınması da açık — bu üçü çok-sistemli olduğu için ayrı turlara bırakıldı.
- **#455 — `vehicleCtx.speedKmh` sahte `0`.** `VehicleContext.speedKmh` tipi
  nullable değil; dürüstleştirmek Mavi yığınında çok-sistemli tip değişimi
  demek. Güvenlik açığı DEĞİL (doğrulandı: `maviActionAuthority` fail-closed).
- **#457 — `raw_community_events` sunucuda YOK.** İstemci tarafı #447'de
  kapatıldı; kalan iş **kod değil operasyon**: `supabase/migrations/
  20260516000000_community_events.sql` sunucuya uygulanmalı (GRANT + RLS +
  policy üçlüsü dosyada TAM, denetlendi).
- **#459-c** motor çalışırken 11,99 V ≠ 13,5–14,5 V şarj bandı — ölçülmedi.

---

### SAHA KOPYASI TURU — 5 KUSUR SIRAYLA KAPATILDI (2026-08-12, kütük #551–#555)

Kaynak: gerçek araçta alınan CAROS LAB tam kopyası (29 dk oturum, OBD bağlı
`protocol 7`, navigasyon ACTIVE). Kopyadaki ham kanıt kodla çapraz doğrulandı;
**beş kusurun beşi de kopyadan ÖLÇÜLDÜ, tahminle bulunmadı.**

| # | Kusur | Kök | Durum |
|---|-------|-----|-------|
| 551 | ETA hız kapısı sıçraması (7/11, -174 s) | Süreklilik HIZ ekseninde kurulmuştu; kullanıcı ZAMAN eksenini görür | ENTEGRE 🔴 |
| 552 | Harita stilinde 5 doğrulama hatası | 3 ayrı kök: `case` içinde 3 zoom ifadesi · MapLibre'de olmayan AO · döngüsel import | ENTEGRE 🔴 |
| 553 | Araç durunca GPS "ölü" ilan ediliyor | Sağlık, konum REFERANS DEĞİŞİMİNDEN türetiliyordu | ENTEGRE 🔴 |
| 554 | Kopma defterinin kurtarma ucu hiç kapanmıyor | Kurtarma yalnız handshake'e bağlıydı; ECU sustuğunda handshake koşmaz | ENTEGRE 🔴 |
| 555 | Blackbox "1 Hz" değil, mükerrer örnekler | `requestIdleCallback` istekleri birikiyordu | ENTEGRE 🔴 |

**Bu turun asıl dersi — yeşil test ürünü kanıtlamaz, ÖLÇTÜĞÜ ŞEYİ kanıtlar:**

- **#538 sahada yanlışlandı.** `etaModel.ts` "sıçrama matematiksel olarak
  imkânsız hâle gelir" diyordu ve kilidi YEŞİLDİ. Kilit hız eksenini 0,5 km/sa
  adımlarla tarıyordu; sahanın adımı ise 5 s'de ~15 km/sa. Doğru olan cümle
  "hız ekseninde süreklidir" idi — "sıçrama imkânsızdır" değil. Kilit dosyasına
  kapsam uyarısı yazıldı, iddia daraltıldı.
- **Harita AO kilitleri YEŞİLKEN özellik HİÇ çalışmıyordu.** İki test stildeki
  AO şiddetini okuyup doğruluyordu; oysa MapLibre o özelliği tanımadığı için
  katmanı reddediyordu. Test "stilde şu yazıyor" diyordu, ekranda karşılığı
  yoktu. Kilitler kaldırılmadı — tasarım kararı palet tokenine taşındı,
  uygulanmadığı gerçeği AYRI ve açık bir kilitle sabitlendi.
- **#327'nin dersi bir katmana taşınmamıştı.** "Sağlık 'değer değişti mi'den
  DEĞİL 'paket geldi mi'den türetilir" kuralı heartbeat'te uygulanmış ama
  `VehicleConnectivityManager`'da uygulanmamıştı → araç her durduğunda GPS ölü.
- **#536 manşet metriğini yapısal olarak hiç üretemiyordu.** Defter açıldı,
  yazma ucu bağlandı, ama kurtarma ucu yalnız handshake yoluna bağlıydı ve
  ECU suskunluğunda o yol hiç koşmaz. "Defter var" ≠ "defter ölçüyor".

  **DEVAM (#596 · saha koşumu 2026-08-16):** #554 sonrası defter GERÇEKTEN
  ölçmeye başladı (3/3 `recoveryMs` doldu, `medianRecoveryMs` ilk kez doğdu) —
  ama ürettiği sayının BİRİ ölçüm değil artefakttı: 9 sn arayla açılan iki
  kayıttan yenisi 27 976 ms, eskisi **828 625 ms** aldı. `noteRecovery` LIFO
  eşleştiriyordu; aynı anda bekleyen iki kayıttan eskisi açık kalıp çok sonra
  gelen **ilgisiz** bir damgayı yiyordu. Bu yalnız rapor kirliliği değildi:
  `attachRecovery` süreyi kök-neden keskinleştirmede kullanır (>60 s →
  `ADAPTER_UNREACHABLE`) → şişmiş süre **yanlış parçayı suçlayabilirdi**.
  Düzeltme uydurmaz, **susar**: watchdog kopması ancak sağlıklı durumdan
  düşerek doğduğu için yeni bir watchdog kaydı "arada gözlenmemiş bir
  toparlanma oldu"nun kanıtıdır → eski kayıt `recoverySuperseded` mühürlenir,
  süresi kalıcı `null` kalır, `RECOVERY` kanıt boşluğu açık kalır, ortanca/
  en-uzun hesabına girmez ve ayrı bir `supersededCount` ile beyan edilir.
  **Ders: "defter ölçüyor" ≠ "ölçtüğü sayı o kaydın kendi olayına ait".**
  Ölçüm ucunun eşleştirmesi de en az ölçümün kendisi kadar kanıt ister.
  Kütük #554'ün (e) ölçütü ("30 s+ çıkarsa uç yanlış olaya bağlanmış
  demektir") bu kusuru **önceden tarif etmişti** — kabul ölçütünü ölçülebilir
  yazmanın karşılığı budur.

**Yöntem notu (tekrarlanabilir):** MapLibre'nin kendi `validateStyleMin`'i
(ISC, zaten kurulu transitive bağımlılık) teste bağlandı ve doğrulayıcının
sahadaki üç hatayı GERÇEKTEN yakaladığı **kontrol testiyle** kanıtlandı. Aynı
disiplin ETA'da da uygulandı: sınır olmadan aynı hız dizisinin gerçekten
sıçradığını gösteren kontrol testi var — kilit boşluğa atılmadı.

**Host kanıtı:** 523 test dosyası · 11 893 test yeşil · `tsc -b` temiz.
**Saha kanıtı: YOK.** Beşi de kütükte 🔴; hiçbiri "çalışıyor" diye sunulamaz.

**Bir sonraki atomik PR:** saha koşumu → yeni kopyada beş bölümü oku
(`ETA SIÇRAMA DEFTERİ` · `HATA KÜTÜĞÜ` · `OTURUM DENETÇİSİ→connectivity` ·
`KOPMA KANIT DEFTERİ` · `BLACKBOX ÖRNEKLERİ`) ve her biri için kütükteki
kabul ölçütünü tek tek işaretle. Özellikle #551(b) `maxAbsDeltaS < 60 s` ve
#553(f) karşı kontrol (gerçek sinyal kaybı hâlâ görülüyor mu) atlanmamalı —
ikisi de düzeltmenin kapıyı körletip körletmediğini ölçer.

**Bu turda BİLİNÇLİ YAPILMAYANLAR (açık borç):**

- **AO geri bağlanmadı** — MapLibre GL 4 desteklemiyor. `bldg3dAO` tokeni ve
  tasarım kararı korundu; gündüz binaların düz görünmesi bu borcun bedelidir.
  MapLibre AO'yu desteklediğinde tek satırla geri bağlanır (kilit o an bilinçli
  düşecek şekilde yazıldı).
- **`fixAgeMs` ile `konumFixYasMs` ayrımı KUSUR DEĞİLDİR** — ilk okumada
  "otorite çelişkisi" sanıldı, kod incelemesinde #537'de BİLİNÇLİ ayrıldıkları
  görüldü (map-match yaşı ≠ konum sağlayıcı yaşı). Teşhis düzeltildi, kod
  değiştirilmedi.
- **#537 dağılım defteri hâlâ hüküm veremiyor** — kopyada 3 örnek ve üçü de
  `readGap 0` ile TEK okumadan gelmiş (`spanMs: 0`). Hüküm doğru olarak
  `INSUFFICIENT_SAMPLES` diyor ama örnekleyicinin aynı okumayı çoğaltması ayrı
  bir kusurdur; bu turda KAPSAM DIŞI bırakıldı, açık borç.
- **Sürüşte kullanıcı dokunmadan açılan 6 modal** (`⚠ZAMANSIZ`, z100000/z9990)
  incelenmedi — biri YouTube açılışıyla 20 s uyumlu, muhtemelen masum; kalanlar
  kimliklendirilmedi. Güvenlik ilgisi olduğu için ayrı tura bırakıldı.
- **Mavi proaktif katmanı 29 dk boyunca hiç konuşmadı** (~260 değerlendirme,
  hepsi `not_critical`). Kusur mu tasarım mı belirlenmedi — ölçüldü, kayda
  geçti, karar sonraki tura.

---

## V-04 — "Ölü kod" aslında TÜKETİCİSİ DOĞMAMIŞ KODMUŞ (2026-08-21)

**Durum: ENTEGRE** · **ÜRÜN HAZIR: HAYIR** (altı madde de kütükte 🔴 — saha kanıtı YOK)

Vizyon kapatma planının V-04 maddesi (`docs/VIZYON_KAPATMA_PLANI_2026-08-21.md`)
kapandı: üretimde hiç import edilmeyen altı modülün **altısı da BAĞLANDI**, hiçbiri
silinmedi (kullanıcı kararı: *"kurtarılabilir ise kesinlikle silme, çalışır hale getir"*).

| Modül | Ne yapıldı | Kütük |
|---|---|---|
| `adapterCapability` | klon adaptör tespiti ürün yoluna | 🔴 #682 |
| `nativeCoreService` eksiği | native ekran ölçümü cihaz sınıflandırmasına | 🔴 #683 |
| `signalHub` | CAROS LAB · **Sinyal Otoritesi** (zarf dürüstlüğü gözlemlenebilir) | 🔴 #684 |
| `fleetKb` | tarama turunun iki ucu: ipucu okuma + gözlem öğrenme | 🔴 #686 |
| `serviceFunctions` | CAROS LAB · **Servis Fonksiyonları Kapısı** (yazma AÇILMADI) | 🔴 #687 |
| `manufacturerProfileBuilder` | CAROS LAB · **Üretici Profil Adayları** (inceleme yüzeyi) | 🔴 #688 |

**Turun asıl bulgusu — sınıflandırma yanlıştı.** Bu modüller "yazılmış ama bozuk" değil,
**tüketicisi hiç doğmamış** modüllerdi. Üçünde (`signalHub` · `serviceFunctions` ·
`manufacturerProfileBuilder`) eksik olan şey koddaki bir kusur değil, **modülün var oluş
sebebini karşılayan yüzeydi**: bir sinyal otoritesinin okuyucusu, bir yazma kapısının
gözlemi, "manuel onaya hazır" üreten bir builder'ın inceleme ekranı. Yüzey olmadan bu
modüller "yapıldı" yanılsaması üretiyordu — depoda tekrar eden **"motor var, besleyen yok"**
deseninin en sinsi biçimi.

**Ölçüm tuzağı (V-04/1'de yakalandı):** planın "ölü modül" taraması `nativeCoreService`'i
yanlış listelemişti; gerçek import **uzantılı** yazılmıştı (`'./nativeCoreService.ts'`) ve
`grep -rl "/<modül>'"` deseni onu göremedi. Gerçek ölü sayısı 10 → 5, ~2.900 → ~749 satır.
*grep, aradığın adı bilmene bağlıdır.*

**Bilinçli YAPILMAYANLAR (borç değil, kapsam kararı):**

- **Araca native YAZMA yolu açılmadı** (UDS 0x31 / 0x2E / 0x27). `serviceFunctions`'ın
  kendi sözleşmesi "kapı ve model önce, yazma sonra" diyor; LAB ekranı da yazma iddiası
  taşımıyor ve YENİLE dışında düğmesi yok. Bugünkü ürün araca yazmıyor.
- **Rutin destek keşfi yok:** hangi servis rutininin bu araçta desteklendiğini kanıtlayan
  bir kanal YOK. Ekranda `KANIT KANALI YOK` yazıyor — uydurulmuyor; gerçek çağrıda kapı
  zaten fail-closed reddediyor.
- **Profil adayı ONAY yolu yapılmadı:** çakışmalar otomatik çözülmüyor, bir aday ürüne
  girecekse bunu insan yapacak.
- **`predictionEngine` · `kwpDtc` · `driverDnaEngine` · `deepScanOrchestrator.run()`**
  V-04 kapsamında değildi; sırasıyla V-09 · V-08 · V-11 · V-10 maddelerine devredilmişti.

**Host kanıtı:** 582 test dosyası · 12.753 test yeşil · `tsc -b` temiz · `npm run lint`
0 hata · `npm run build` başarılı. CAROS LAB 45 → **50 AVAILABLE** ekran.
**Saha kanıtı: YOK.** Altısı da kütükte 🔴; hiçbiri "çalışıyor" diye sunulamaz.

**Bir sonraki atomik PR:** saha koşumu — kütük #684/#686/#687/#688'in kabul ölçütlerini
gerçek araçta tek tek işaretle. Özellikle #686(c) (ikinci taramada UDS'li ECU'nun ÖNCE
taranması ve **toplam DTC sayısının AZALMAMASI**) atlanmamalı: ipucunun kapsamı daraltıp
daraltmadığını ölçen tek maddedir.
