# 🚗 Saha Doğrulama Planı — Renault Trafic (Öğrenme Zinciri P2-1→P2-5 + PR #11)

> **Amaç:** PR #39 (P2-5 Learning Integration) merge sonrası, öğrenme zincirini gerçek
> araçta (Renault Trafic) doğrulamak. Bu belge YALNIZ plan + gözlem kontrol listesidir;
> kod/branch/PR/migration içermez. Sonuçlar gözlemlendikçe `DEVICE_VALIDATION_LEDGER.md`
> gerçek sonuca göre güncellenir (test edilmeyen madde yeşil YAPILMAZ).
>
> **Referans main:** `20b0282` (PR #39 merge sonrası).

---

## ⛔ ÖN UYARI — İKİ YAPISAL KISIT (önce oku)

Saha testine çıkmadan önce iki kısıt netleştirilmeli; aksi halde "boş ekran"ı bug sanırsın.

### Kısıt 1 — Evidence Store write-path BAĞLI DEĞİL (en kritik)
Kod denetimi (main `20b0282`): runtime'da hiçbir yer `vehicleLearningEvidenceStore.upsert/save`
çağırmıyor; `vehicleLearningEngine.computeEvidence()` (VKB→evidence) de boot/idle'da
koşturulmuyor. Integration service (P2-5) yalnız `vehicleLearningEvidenceStore.list()` okur.

**Sonuç:** Evidence Store gerçek sürüşte **BOŞ** kalır →
- Dashboard öğrenme rozetleri: **görünmez** (annotation map boş)
- Expert "Araç Öğrenme": **"Henüz öğrenilmiş kanıt yok"**
- Diagnostic learning context: **null**

Yani **D, E, F(öğrenme kısmı), G** maddeleri mevcut wiring ile **gözlemlenemez** — bu bir
bug değil, henüz bağlanmamış bir katman (P2-6 kapsamı). Saha raporunda "test edilemedi
(write-path bağlı değil)" olarak işaretlenmeli; UI'yı uydurma veriyle doldurup yeşile
çekmek YASAK.

> **Ne BAĞLI:** VKB write-path bağlı — `autoLearningEngine` boot'ta başlar (SystemBoot),
> discovery gözlemlerini bağlı aracın fingerprint'ine işleyip VKB'ye `save()` eder. Yani
> **C (Fingerprint + Knowledge)** test*edilebilir*; ama VKB→Evidence Store köprüsü yok.

### Kısıt 2 — Tek Renault Trafic ile CANDIDATE/STRONG/CONFLICT kanıtlanamaz
`evidenceStatus(vehicleCount, ecuCount)`: `vehicleCount ≤ 1 → weak` (ECU sayısından
bağımsız). CANDIDATE ve STRONG **≥2 farklı araç** (farklı fingerprint hash) ister; CONFLICT
en az iki farklı marka/protokol kümesi ister. Dolayısıyla **tek** Trafic ile ulaşılabilecek
en üst öğrenme durumu **WEAK**'tir.

**Sonuç:** E ve conflict/pattern promotion maddeleri tek araçla **"araç yetersiz"** olarak
raporlanır. Farklı marka/model 2.-3. araçlar olmadan bu maddeler yeşil YAPILMAZ.

---

## 📋 Test Öncesi Hazırlık

| Öğe | Değer / Not |
|-----|-------------|
| Araç | Renault Trafic (motor/yıl/VIN kaydet) |
| OBD adaptör | Marka/model + BT(classic/BLE)/WiFi kaydet (ELM327 türevi) |
| Head unit / cihaz | Model + Android sürümü + DeviceTier (low/mid/high) kaydet |
| APK | `apk:safe` ile üretilmiş **taze** debug APK (test yeşil şart). Stale-APK tuzağına dikkat |
| Gözlem aracı | Chrome DevTools over adb (CDP) VEYA in-app Tanı paneli (`/admin/tani`) |
| Kontak | Motor çalışır durumda (ECU uyanık) — no_vehicle_response'u önlemek için |
| İkinci telefon | Yolcu paneli / CDP için (head unit adb'siz ise sideload) |

**DeviceTier'ı iki turda test et:** bir tur BASIC_JS (low) profilinde, bir tur BALANCED+ (mid/high).

---

## A. Bağlantı ve Temel Akış  `[testable]`

| # | Gözlem | Beklenen | Sonuç |
|---|--------|----------|-------|
| A1 | OBD adaptör bağlanıyor | Transport açılır (classic/ble/tcp); ilk boot classic+ble öğrenir, 2.+ boot doğrudan verified transport (BLE turu atlanır, elapsedMs düşer) | ☐ |
| A2 | VIN okunuyor / yokluk fail-soft | VIN okunur VEYA VIN yok → UI çalışır (fail-soft), çökme yok | ☐ |
| A3 | Protocol tespiti | Doğru protokol (ISO 15765 / CAN 11/29-bit) raporlanır | ☐ |
| A4 | ECU adresleri | ≥1 ECU adresi bulunur (7E8 vb.), normalize+tekil | ☐ |
| A5 | Canlı hız/RPM | 3Hz akış kesintisiz; impossible-value reddi (hız>300, RPM sıçraması) çalışır | ☐ |
| A6 | Kop/yeniden bağlan | Adaptör çekilince reconnect; commFailStreak→pollLoop reconnect; sonsuz "Broken pipe" YOK | ☐ |

**Log kanıtı:** OBD lifecycle event'leri (connect/handshake/disconnect) + kopma nedeni kategorisi
(`resource_busy`/`no_vehicle_response`/`socket_closed`…) tanı snapshot'ında görünür (PII yok).

---

## B. Discovery  `[testable]`

| # | Gözlem | Beklenen | Sonuç |
|---|--------|----------|-------|
| B1 | Yeni PID yakalanıyor | Katalog-dışı PID → Dashboard'da **NEW** rozeti | ☐ |
| B2 | Yeni DID yakalanıyor | UDS mode 22 DID → **NEW** rozeti (Fingerprint ikonu) | ☐ |
| B3 | Bilinen PID tekrar kaydedilmiyor | Registry'deki PID → **KNOWN**, yeni kayıt açılmaz | ☐ |
| B4 | NO DATA / 7F reddi | `NO DATA` / negatif `7F` yanıt → gözlem oluşmaz | ☐ |
| B5 | Duplicate | Aynı (ECU+mode+PID/DID) tekrar → yeni kayıt YOK, `seenCount++`, **DUPLICATE** rozeti | ☐ |
| B6 | Alan doğruluğu | ECU / request / rawResponse / mode / protocol doğru görünür | ☐ |
| B7 | Export | "Dışa Aktar (JSON)" panoya kopyalar (mevcut DiscoveryQueue içeriği) | ☐ |

**Not:** Discovery katmanı wiring'i BAĞLI (autoLearningEngine + dashboard aboneliği). Bu bölüm
gerçekten gözlemlenebilir.

---

## C. Fingerprint ve Knowledge (VKB)  `[testable]`

| # | Gözlem | Beklenen | Sonuç |
|---|--------|----------|-------|
| C1 | Tek araç → tek fingerprint | Aynı Trafic tek fingerprint hash üretir | ☐ |
| C2 | Geç gelen VIN duplicate yaratmıyor | VIN sonradan gelince staged fingerprint MERGE olur, 2. araç kaydı açılmaz | ☐ |
| C3 | Tekrar bağlanınca sayaç artışı | Aynı araç yeniden bağlanınca `lastSeen` güncellenir (sourceCount/observation artar) | ☐ |
| C4 | PID/DID doğru fingerprint'e bağlanıyor | Discovery gözlemi bağlı aracın fingerprint bilgi katmanına işlenir | ☐ |
| C5 | VKB sayıları doğru artıyor | `vehicleKnowledgeBaseStore.list()` kaydı büyür (bounded) | ☐ |

**Gözlem yolu:** CDP konsolunda `vehicleKnowledgeBaseStore.list()` (debug) VEYA Expert →
Manufacturer DID Inspector. autoLearningEngine idle/discovery-tick'te `save()` eder.

---

## D. Evidence Store  `[BLOCKED — write-path bağlı değil]`

> Kısıt 1: Evidence Store'a runtime yazıcı yok → tüm D maddeleri **test edilemez**.
> Aşağıdaki ölçütler ancak VKB→Evidence köprüsü (P2-6) bağlandıktan sonra geçerlidir.

| # | Ölçüt (P2-6 sonrası) | Sonuç |
|---|----------------------|-------|
| D1 | evidence kalıcı kaydoluyor (safeStorage `car-vehicle-learning-evidence`) | ⛔ blocked |
| D2 | uygulama kapanıp açılınca kayıt geri geliyor | ⛔ blocked |
| D3 | aynı araç tekrarında vehicleCount **artmıyor** (distinct fingerprint) | ⛔ blocked |
| D4 | observationCount artıyor | ⛔ blocked |
| D5 | farklı araçta vehicleCount artıyor | ⛔ blocked (+araç yetersiz) |
| D6 | ECU listesi tekilleşiyor | ⛔ blocked |
| D7 | storage bounded (≤512, status-aware LRU) | ⛔ blocked |

**Ara doğrulama (write-path olmadan):** `vehicleLearningEngine.computeEvidence()` CDP'den
manuel çağrılırsa VKB'den türetilmiş evidence görülebilir (kalıcı değil). Bu, mantığın
canlı VKB ile çalıştığını *gösterir* ama D'yi *doğrulamaz*.

---

## E. Confidence / Pattern  `[BLOCKED + araç yetersiz]`

> D bloklu olduğu için pattern engine boş evidence görür. Ek olarak tek araç kısıtı (Kısıt 2).

| # | Ölçüt | Tek Trafic ile | Sonuç |
|---|-------|-----------------|-------|
| E1 | tek araç evidence = WEAK | ulaşılabilir (write-path sonrası) | ⛔ blocked |
| E2 | 2. farklı araç = CANDIDATE | **araç yetersiz** | ⛔ n/a |
| E3 | 3 araç / 2 araç+2 ECU = STRONG | **araç yetersiz** | ⛔ n/a |
| E4 | duplicate confidence şişirmiyor | write-path sonrası (B5 ile dolaylı) | ⛔ blocked |
| E5 | conflict → MANUAL_REVIEW/CONFLICT | **araç yetersiz** (2 marka gerek) | ⛔ n/a |
| E6 | stale yanlış promote olmuyor | zaman-bağımlı, tek oturumda gözlenemez | ⛔ blocked |

---

## F. Dashboard ve Expert UI  `[kısmen testable]`

| # | Gözlem | Durum | Sonuç |
|---|--------|-------|-------|
| F1 | NEW/KNOWN/DUPLICATE/UNSUPPORTED rozetleri | `[testable]` — discovery bağlı | ☐ |
| F2 | filter/search/export | `[testable]` — mevcut davranış | ☐ |
| F3 | WEAK/CANDIDATE/STRONG öğrenme rozetleri | `[blocked]` — evidence boş → rozet çıkmaz | ⛔ |
| F4 | Manual Review / Conflict filtreleri | `[testable-mekanik]` — boş sonuç döner (çökmez); dolu veri için araç+write-path gerek | ☐/⛔ |
| F5 | Expert "Araç Öğrenme" sayıları evidence store ile eşleşiyor | `[blocked]` — "Henüz öğrenilmiş kanıt yok" beklenir | ⛔ |
| F6 | düşük tier'da ağır detay kapalı | `[testable]` — BASIC_JS'te "Basit Mod" rozeti + pattern/conflict detayı yok | ☐ |
| F7 | UI donma / liste kayması yok | `[testable]` — virtualization, 1000+ kayıtta akıcı | ☐ |

**Dürüst beklenti:** Bu araçla F1/F2/F6/F7 doğrulanır; F3/F5 "boş" doğrulanır (bug değil,
write-path yok). Öğrenme rozetlerinin *dolu* doğrulaması için D/E önce çözülmeli.

---

## G. Diagnostic Insight  `[BLOCKED (öğrenme) / testable (güvenlik)]`

| # | Gözlem | Durum | Sonuç |
|---|--------|-------|-------|
| G1 | learnedEvidenceCount doğru | `[blocked]` — evidence boş → learning=null | ⛔ |
| G2 | relatedStrongPids/Dids doğru | `[blocked]` | ⛔ |
| G3 | learningWarnings doğru | `[blocked]` | ⛔ |
| G4 | requiresManualReview doğru | `[blocked]` | ⛔ |
| G5 | learning severity/driveSafe/safety'yi DEĞİŞTİRMİYOR | `[testable]` — learning null iken insight aynen; dolu iken de safety fields sabit (birim testle kilitli, sahada kritik DTC ile doğrula) | ☐ |
| G6 | kritik DTC deterministik güvenlik kuralını koruyor | `[testable]` — critical DTC → driveSafe=false, severity korunur | ☐ |

**Sahada G5/G6:** bir kritik DTC (varsa gerçek, yoksa güvenli enjekte-gözlem) ile insight'ın
`severity`/`driveSafe` değerinin öğrenmeden bağımsız olduğunu gözle doğrula.

---

## H. PR #11 (Tanı Snapshot / Black Box)  `[testable — bağımsız]`

> PR #11 öğrenme zincirinden BAĞIMSIZ; bu araçla tam test edilebilir. Merge kararı buna bağlı.

| # | Gözlem | Beklenen | Sonuç |
|---|--------|----------|-------|
| H1 | OBD lifecycle event'leri | connect/handshake/protocol/disconnect black box timeline'da | ☐ |
| H2 | Tanı snapshot | "Tanı Gönder" → `/admin/tani` panelinde tüm bölümler dolu | ☐ |
| H3 | Replay buffer | Son olaylar geri oynatılabilir (ring buffer) | ☐ |
| H4 | Ağ online/offline event | Bağlantı kesilince/gelince event düşer | ☐ |
| H5 | Thermal event | Termal throttle/degraded/recovered event'leri timeline'da | ☐ |
| H6 | Sanitize / secret sızıntısı yok | VIN/MAC/cihaz adı ham yayılmaz; reason kategorileri PII-güvenli | ☐ |
| H7 | blackBox 10Hz davranışı değişmedi | Örnekleme hızı sabit, ek CPU/IO yok | ☐ |

---

## I. Performans / Termal / FPS  `[testable]`

**Senaryolar (her biri BASIC_JS ve BALANCED turlarında):**
1. 15 dk idle (ekran açık, harita görünür)
2. 30 dk sürüş (OBD canlı, GPS aktif)
3. Discovery **açık** vs **kapalı**
4. Dashboard/Expert **açık** vs **kapalı**

**Ölç ve kaydet (CDP Performance / in-app diag):**

| Metrik | idle | sürüş | discovery açık | dashboard açık | Kabul |
|--------|------|-------|----------------|-----------------|-------|
| FPS | | | | | 3Hz akışta gözle görülür gecikme yok |
| CPU % | | | | | BASIC_JS'te regresyon yok |
| RAM (MB) | | | | | sürekli büyüme YOK (leak) |
| Termal | | | | | throttle'a girmiyor |
| GC pause | | | | | uzun pause yok |
| OBD paket gecikmesi (ms) | | | | | 3Hz korunur |
| UI tepki (ms) | | | | | <100ms dokunma yanıtı |

**Öğrenme katmanı yükü:** Dashboard KAPALIYKEN integration service çağrılmaz (hot-path yok);
Evidence Store boş olduğundan `getAnnotationMap()` boş Map döndürür (≈0 maliyet). **Beklenti:**
P2-5 katmanı ölçülebilir bir hot-path yükü oluşturmaz. Yine de dashboard AÇIKKEN memoization'ın
(saat-kovası) tekrar hesap yapmadığını doğrula.

---

## J. Ledger Güncelleme Kuralı

Test **koşulduktan sonra** her madde `docs/DEVICE_VALIDATION_LEDGER.md`'de gerçek sonuca göre:
- 🟢 doğrulandı — kabul ölçütü cihazda gözlemlendi
- ❌ düştü — cihazda denendi, başarısız
- 🔴 kalır — test edilemedi (araç yetersiz / write-path bağlı değil)

**Bu plan hazırlanırken hiçbir madde yeşile çekilmedi** (test koşulmadı). #25 (P2-5) 🔴 kalır.
Blocked maddeler (D/E/F3/F5/G1-4) test edilemez olarak **🔴** kalır — yeşil YAPILMAZ.

---

## 📝 Rapor Şablonu (sahada doldur)

```
Test edilen cihaz/araç : Renault Trafic (___ / VIN ___) — Head unit ___ (tier ___)
OBD adaptör            : ___ (classic/ble/tcp)

Başarılı maddeler      : (A?, B?, C?, F1/2/6/7, G5/6, H?, I ölçümleri)
Başarısız maddeler     : (❌ olanlar + log)
Test edilemeyen        : D(write-path yok), E(araç yetersiz+write-path), F3/F5, G1-4
                         + gerekçe

Log/hata özeti         : (OBD reason kategorileri, çökme var mı, sanitize kontrolü)
FPS/CPU/RAM/termal     : (I tablosu sonuçları — 2 tier × 4 senaryo)

Ledger güncelleme      : (madde madde 🟢/❌/🔴 önerisi)
PR #11 merge edilebilir mi : (H1-H7 tümü 🟢 ise EVET; aksi → hangi madde düştü)
PR #39 özellikleri doğrulandı mı : (kısmen — F1/2/6/7 evet; öğrenme rozetleri write-path bekliyor)
Sonraki en küçük düzeltme : (aşağıya bkz.)
```

---

## 🔧 Beklenen "Sonraki En Küçük Düzeltme" (test öncesi öngörü)

Saha testi büyük olasılıkla şunu gösterecek: **P2-5 UI boş** çünkü Evidence Store yazılmıyor.
En küçük, izole, geri-alınabilir düzeltme (P2-6 adayı — bu görevin kapsamı DIŞINDA, ayrı PR):

> **Evidence Store population köprüsü:** `autoLearningEngine` tick'inde (veya ayrı idle
> job'da), VKB güncellendikten sonra `vehicleLearningEngine.computeEvidence()` çıktısını
> `vehicleLearningEvidenceStore.upsert()` ile (throttle'lı, bounded, idle-only) yaz. Bu tek
> köprü D/E/F3/F5/G1-4'ü canlıya açar. Hot-path'e sokma; discovery-tick/idle'da çalıştır.

Alternatif (daha da küçük, kalıcılıksız): Integration service `readEvidence` varsayılanını
"store boşsa `computeEvidence()`'a düş" yapacak şekilde genişlet — ama bu kalıcılığı (D1/D2)
yine test edilemez bırakır; tercih edilen köprü yaklaşımıdır.
