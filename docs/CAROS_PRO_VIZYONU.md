# CAROS PRO VİZYONU

> **Durum:** Canlı belge
> **Belge türü:** Ürün vizyonu + capability roadmap
> **Kaynak gerçekliği:** Kod, test, UI ve saha kanıtı ayrı değerlendirilir
> **Güncelleme kuralı:** İlgili her PR sonrasında güncellenir
> **Son güncelleme:** 2026-07-18 · Branch: `feat/w5-obd-pr1-native-handshake`
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

**Bugünkü toplam (57 denetlenen özellik):** YOK 14 · İSKELET 22 · ENTEGRE 14 ·
DOĞRULANDI 6 · SAHADA DOĞRULANDI 1 · **ÜRÜN HAZIR: 1**
(Detay: `docs-local/caros-feature-audit.html`)

---

## 6. Yapılan ve Kanıtlananlar

> Buraya **yalnız** kod/test/saha kanıtı olan işler girer. Sıra: en güçlü kanıt üstte.

### 6.1 Sahada doğrulanmış (kütük 🟢)

| # | İş | Kapsam | Test | Saha kanıtı | Kalan eksik |
|---|---|---|---|---|---|
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

> **Uyarı — en yüksek riskli açık test:** Tam tarama sonrası ana ekrana dönüldüğünde
> hız/RPM/coolant **hâlâ akıyor mu?** Çoklu-ECU probu `ATH1` + UDS extended session açar;
> `ATH0` restore bozulursa standart poll parser'ı **sessizce** ölür. Kod bunu korur
> (`HeaderRestoreException`, doğrulamalı+retry'li ATH0) ama **sahada kanıtlanmadı**.

---

## 7. Yapılacaklar (faz ve öncelik)

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
| P1-1 | Extended PID **değer dolumu** + ⚠️ RPM=0 anomalisi kök nedeni | Canlı Test'te extended PID'ler değer gösterir; motor açıkken RPM>0. **Rapor `8edd61a6` teyit etti:** `discovered: true, supportedCount: 15` ama `samples: []` — keşif çalışıyor, dolum yok. **PR-OBD-BLE-1 (2026-07-15) kök neden buldu+kod düzeltmesi:** "Tüm PID Canlı Test" burst modu `BleObdManager`'da ve `CarLauncherPlugin.setObdDiagnosticBurst` wiring'inde YOKTU → BLE dongle'lı araçlarda (Trafic+Doblo aynı 6-7 PID) extended hattı yalnız round-robin. Burst BLE'ye eklendi (Classic deseninin birebir aynası); `compileDebugJavaWithJavac` başarılı, TS sözleşme 32 test yeşil. **🔴 CİHAZDA DOĞRULANMADI** — kabul: BLE dongle + panel açıkken ≤20 sn'de ≥5 extended PID `TAZE`. Kalan: değer sığ seed (blok 40-A0) + NO_DATA/timeout ayrıştırması (ayrı PR'lar) |
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
| ECU Topology | YOK | HAYIR | Discovery çıktısına bağımlı |
| ECU Router | YOK | HAYIR | Vizyon rezervuarı |
| Standard DTC Mode 03/07/0A | ENTEGRE | HAYIR | `dtcService` + completeness; DTC'li araç borcu |
| Freeze Frame | ENTEGRE | HAYIR | FAZ 1; freeze frame'li araç yok |
| Readiness | ENTEGRE | HAYIR | Doblo'da 3/3 monitör gözlendi (🟡 #70) |
| UDS 0x19 | ENTEGRE | HAYIR | FAZ 3; üretici kodlu araç yok |
| UDS 0x22 | ENTEGRE | HAYIR | FAZ 3; saha borcu |
| KWP2000 | ENTEGRE | HAYIR | Trafic **kullanıcıda değil** → uzaktan rapor yolu. **2026-07-15 PR-OBD-KWP-1:** KWP acquisition yolu kapandı — boş-tx/6-hane KWP adresleme + **Servis 21** (ReadDataByLocalIdentifier) + profil `protocols` kapısı (CAN profili KWP hattında sorgulanmaz → COMM_ERROR fırtınası bitti) + `renaultTraficKwpProfile` (kanıt-dürüst: yalnız ISO kimlik DID'leri, LID'ler Servis 21 keşif taramasıyla sahada kanıtlanacak) + extended NO_DATA demotion (39/39 NO_DATA israfı biter, UI "VERMİYOR" gerçek nedeni gösterir) + `signalHub` tek otoriter okuma. 🔴 #79 |
| ISO-TP | — | — | **Bilinçli yazılmadı** (ELM327 donanımda yapıyor) — gerekçe roadmap'te |
| Manufacturer-specific diagnostics | ENTEGRE | HAYIR | F3-1; üretici kodlu araç borcu |
| Renault/Dacia DF codes | ENTEGRE | HAYIR | Trafic borcu |
| Scan Completeness | İSKELET | HAYIR | Deep Scan'e bağımlı → üretecek tarama yok; UI yok |
| Confidence ve provenance | ENTEGRE | HAYIR | Confidence kanıttan türer (kilitli); **provenance twin'de eksik** |
| **Hız Kaynağı Çelişki Kapısı** (yeni) | ENTEGRE | HAYIR | `931b41c` — **ilk saha-kanıtlı zero-trust ihlali kapatıldı.** Rapor `8edd61a6`: GPS 38.1 km/h · OBD hız **0** · RPM 1434 · gaz %13 → araç giderken gösterge 0'da kaldı, sürüş/park modu **7 kez flip-flop**. Kök: worker çapraz kontrolü TEK YÖNLÜ (`raw > 10 && rpm === 0` reddediliyor, simetriği kabul) + kaynak seçimi donanımı **"kesin değer"** sayıyordu (yorumda yazılı). Yapısal sebep: KWP'de hız ABS ECU'sunda; motor ECU'su `41 0D 00` döner. `_hwSpeedContradicted()`: donanım <1 + GPS >15 + RPM >900 → o kaynağın güveni 0 → GPS kazanır. 🔴 #77 |
| Write Safety Gate | DOĞRULANDI | HAYIR | 7 kapılı karar modeli + testler; **native yazma bilinçli YAZILMADI** (F4-5) |
| Bounded diagnostic evidence | ENTEGRE | HAYIR | errorLedger + bounded payload; saha kanıtı yok |
| **İlk-Eşleştirme Sürekliliği** (yeni) | ENTEGRE | HAYIR | **Kök neden:** native'de `ACTION_PAIRING_REQUEST` alıcısı vardı ama `ACTION_BOND_STATE_CHANGED` alıcısı YOKTU; ilk eşleştirmede Android bonding ASENKRON tamamlanır (insan PIN'i OS dialog'una girer) ama tek timeout-sınırlı deneme (eski 15s + JS 8-15s `Promise.race`) bu pencereyi aşıp düşüyordu, bonding sonradan bitse bile yeniden tetik yoktu → kullanıcı 2. kez "Bağlan" demek zorundaydı. `PairingGate.waitStrategyFor` saf haritası + `OBDManager.waitForBondViaReceiver` (receiver-latch, `BOND_WAIT_TIMEOUT_MS=90s`, zero-leak) + JS `PAIRING_GRACE_TIMEOUT_MS` (yalnız kullanıcı-başlatmış+Classic+bonded-değil). `CONNECT_WITHOUT_PAIRING` bilinçli olarak dokunulmadı (insecure-only adaptörlerde regresyon riski). Test: JUnit 10/10 + `regression.guards.test.ts` 2 yeni kilit + tam suite 4378/4378 + tsc temiz. 🔴 #82 |

### 8.5 Sürücü ve Yolculuk

| Özellik | Durum | Ürün hazır | Kanıt / eksik ana parça |
|---|---|---|---|
| Driver DNA | YOK | HAYIR | `smartDrivingEngine` sinyalleri temel olabilir |
| Driver-vs-Vehicle Analysis | YOK | HAYIR | Vizyon rezervuarı |
| AI Driving Coach | YOK | HAYIR | Driving Style'a bağımlı |
| Driving Style Analysis | İSKELET | HAYIR | Mod tespiti tüketiliyor; **stil skorlaması yok** |
| Journey Intelligence | İSKELET | HAYIR | `tripLogService` kayıt tutar; özet katmanı yok |
| Trip Replay | YOK | HAYIR | Black Box'a bağımlı |
| Smart Route Analysis | YOK | HAYIR | routing + health ayrı sistemler |
| Weather Impact Analysis | YOK | HAYIR | `weatherService` ham veri; etki modeli yok |
| AI Road Companion | İSKELET | HAYIR | companion iskeleti + safety kernel; ürün deneyimi yok |
| AI DJ | YOK | HAYIR | Vizyon rezervuarı |
| AI Radio | YOK | HAYIR | Vizyon rezervuarı |
| Doğal konuşma | ENTEGRE | HAYIR | `semanticAiService` + parser; saha kanıtı yok |
| Medya yönlendirme | ENTEGRE | HAYIR | `youtubeService`/`musicCommandParser`; tam sesli kontrol kısmi |
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
| Maliyet tahmini | YOK | HAYIR | Vizyon rezervuarı |
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
| Güvenlik-kritik hot-path | ENTEGRE | HAYIR | SafetyBrain + SafetyOverlay; **VoiceSafetyAnnouncer + CAN canlı bağlantı yok** |
| Kullanıcı izni ve açık rıza | ENTEGRE | HAYIR | DiagnosticReportModal rızası 🟢; genel rıza akışı (KVKK/GDPR) yok |
| Yanlış alarm azaltma | İSKELET | HAYIR | Debounce/histerezis var; ölçülen yanlış-alarm oranı yok |
| Ghost Replay / Black Box olay koruması | YOK | HAYIR | Vizyon rezervuarı |

### 8.8 Güç ve Uyku Yönetimi

> **Bu grup bütünüyle YOK.** Akü boşaltma riski taşıdığı için her madde
> **güç bütçesi sözleşmesi** olmadan uygulanamaz.

| Özellik | Durum | Ürün hazır | Kanıt / eksik ana parça |
|---|---|---|---|
| Battery Protection | YOK | HAYIR | Voltaj PID okunuyor; koruma politikası yok |
| Smart Surveillance | YOK | HAYIR | Guardian Mode'a bağımlı |
| Continuous Surveillance | YOK | HAYIR | Güç bütçesi olmadan **yasak** |
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
| Arabam Cebimde | ENTEGRE | HAYIR | PWA kumanda + E2E şifreli uzaktan komut; **twin/memory paylaşımı yok** |
| CAROS Cloud | İSKELET | HAYIR | Supabase + RPC var; **senkron sözleşmesi yok** |
| Digital Garage | YOK | HAYIR | **Tek araç varsayımı** sökülmeli (geniş dokunuş) |
| Family Sharing | YOK | HAYIR | Garage + Cloud Sync'e bağımlı |
| Fleet Mode | İSKELET | HAYIR | admin/FleetCenter (web); cihaz-içi filo modu yok |
| Fleet Intelligence | İSKELET | HAYIR | `fleetKb` servis kapısı; **anonim toplama boru hattı yok** |
| Privacy Center | İSKELET | HAYIR | Sanitize motoru 🟡 kanıtlı; **kullanıcı paneli yok** (P3-2) |
| Cloud Sync | İSKELET | HAYIR | Tek yönlü rapor teslimi 🟢; **senkron/şema/RLS yok** (P2-6) |
| OTA Intelligence | ENTEGRE | HAYIR | `otaUpdateService` state machine; **telemetri yok**, saha kanıtı yok |
| Vehicle Marketplace | YOK | HAYIR | Life Story + doğrulama otoritesi ister — **ürün kararı gerekir** |
| Digital Health Certificate | YOK | HAYIR | Passport + doğrulanmış geçmişe bağımlı |
| Çoklu araç/kullanıcı yetkilendirmesi | İSKELET | HAYIR | RBAC (driver/admin/super_admin) var; **çoklu araç modeli yok** |
| Adaptive Runtime | DOĞRULANDI | HAYIR | Tier motoru + histerezis kilitleri; **düşük-uçta (K24) tier kabulü ölçülmedi** |
| Knowledge Base | ENTEGRE | HAYIR | KB **statik/yerel** — "öğrenen filo KB" iddiası doğrulanmadı |

---

## 9. Çelişki Kaydı

> Kanıtla çözülene kadar **hiçbir durum yükseltilmez**. Yeni çelişki bulunduğunda buraya yazılır.

| # | Çelişki | Kanıt | Karar |
|---|---|---|---|
| Ç-1 | `docs/OBD_DIAGNOSTIC_OS_ROADMAP.md` kendini **"TEK GERÇEK KAYNAKTIR"** ilan ediyor; bu belge de ana kaynak olarak konumlanıyor. | İki dosyanın başlıkları. | **Çözüldü:** roadmap **OBD alt-roadmap'idir** (görev kırılımı); vizyon/durum özeti bu belgededir. Roadmap'in kendi ifadesi OBD kapsamıyla sınırlı okunur. |
| Ç-2 | Roadmap "FAZ 0 → 3 madde 🟢 (F0-1, F0-2, F0-4)" diyor; **kütükte F0-1 (#66) hâlâ 🔴/🟡 satırında, F0-4 (#70) 🟡 KISMİ**. | `DEVICE_VALIDATION_LEDGER.md` §🟢 tablosu: yalnız **#67 (F0-2)** tam 🟢; #66/69/71 satırı açıkça "**KISMİ 🟡**". | **Kütük kazanır.** Bu belgede F0-1 = 🟡 (regresyon yok, DTC'li araç kanıtı yok), F0-4 = 🟡. Roadmap'in "3 🟢" özeti **iyimser**. |
| Ç-3 | `docs-local/caros-feature-audit.html`, Deep Scan için "`start()/run()/runNextPhase()` production'da **hiçbir yerden çağrılmıyor**" diyordu. | `SystemBoot.ts:667` → `triggerDeepScanOfflinePass()` → `orchestrator.runOfflinePass()` **çağrılıyor**; ancak handler bağlı değil → tüm fazlar `skipped`. | **Kısmen yanlış → HTML düzeltildi.** Sonuç seviyesi (İSKELET) değişmez: gerçek tarama yok. Doğru ifade §8.1'dedir. |
| Ç-4 | `docs/CAROS_15_YIL_VIZYON_YOL_HARITASI.md` (2026-07-08) ve `ROADMAP.md` (2026-06-24) farklı durum tabloları taşıyor. | Tarihler + içerik. | **Tarihsel** ilan edildi (§1). Güncellenmiyorlar; çelişkide bu belge kazanır. |
| Ç-5 | Web sitesi "200+ DTC" diyor; üründe **37** DTC var. | `WEB_URUN_UYUM_BACKLOG.md`. | Açık — P3-5. Pazarlama iddiası **ürün gerçeğine** çekilecek. |
| Ç-6 | Root Cause Engine `FUSION_LOW_CONFIDENCE` için **yanlış dosyayı** işaret ediyordu (`speedFusion.ts`). | Tanı raporundaki `fusion.activeSource` `useHALStatusStore`'dan gelir → `VehicleSignalResolver:348` → **VehicleCompute worker**. `speedFusion.ts` yalnız `MiniMapWidget` + `telemetryService` tarafından kullanılır — ana göstergeyi beslemez. | **Düzeltildi** (`931b41c`): `suspectFiles` artık ana yolu (worker) ilk sırada gösteriyor. **Ders:** tanı motorunun kendisi de kanıtla denetlenmeli — yanlış yönlendiren tanı, tanısızlıktan pahalıdır (beni de yanlış dosyaya yolladı). |
| Ç-7 | **İki paralel hız sistemi** var ve *akıllı olan* ana yolda değil. | `speedFusion.ts` plausibility + histerezis + kalibrasyon içerir ama yalnız MiniMap/telemetry'de; ana gösterge yolu (worker → resolver → HAL store) bunlardan **hiçbirine** sahip değildi. | **Kısmen kapatıldı** (`931b41c` çelişki kapısını ana yola koydu). **Açık borç:** iki sistemin varlığı mimari bir kokudur — uzun vadede tek otoriter hız kaynağı olmalı (Digital Twin provenance ile birlikte, P2-5). |
| Ç-9 | "Bağlantıyı Sıfırla" saha'da **görünür lifecycle üretmiyordu** → kayıtlı cihaz "bağlı gibi" kalıyor, UI/native aynı gerçeği gösterip göstermediği belirsizdi. | `OBDConnectModal.tsx`: reset + reconnect TEK senkron tick'te; `resetObdConnection` void (async native disconnect fire-and-forget). Native disconnect zinciri aslında tamdı → boşluk UX/gözlemlenebilirlikte. | **Düzeltildi** (PR-OBD-CONN-1): reset artık Promise (native disconnect'i bekler) + buton "Sıfırlanıyor…"/disabled + bounded lifecycle telemetrisi (`obdDeep.connLifecycle`). **Açık borç:** stale-veri "connected" rozetini gizleme (freshness-gated badge) ayrı PR. **🔴 Trafic'te doğrulanmadı.** |
| Ç-8 | Kod yorumu "**Vite prod'da `worker.format:'iife'` → `type:'module'`'ü classic'e ZORLAR**" diyordu; bu YANLIŞTI. | Duster saha raporu `44a81bd1` (WebView 74): `VehicleCompute:create — Failed to construct 'Worker': Module scripts are not supported on DedicatedWorker` (tekrarlı) + `%45 ana thread donması` verdict'i. Prod bundle incelemesi: worker DOSYASI IIFE ama call-site `{type:"module"}` **kalıyordu** → Vite `type`'ı call-site'ta değiştirMEZ. | **Düzeltildi** (PR-RUNTIME-WORKER-1): iki literal-type call-site (`import.meta.env.DEV` ölü-kod eleme ile prod'da 'classic' bırakır). Prod bundle artık `{type:"classic"}`. **Ders:** worker DOSYA formatı ≠ constructor `type` seçeneği — ikisi ayrı ayrı doğrulanmalı; "Vite halleder" varsayımı bundle denetimiyle sınanmadan yazılmamalı. **🔴 Duster/8227L cihazda worker round-trip doğrulaması bekliyor.** |

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

## 11. Kapsam Dışı (bu belgenin yapmadıkları)

- Bu belge **kod değiştirmez**; capability durumu kodun aynasıdır, tersi değil.
- Bu belge **vizyonu uygulanmış özellik gibi sunmaz** — §8'deki YOK'lar taahhüt değildir.
- Bu belge **gelecekteki tüm fikirleri kısa vadeli taahhüde çevirmez**; öncelik yalnız
  P0–P3'tedir.
