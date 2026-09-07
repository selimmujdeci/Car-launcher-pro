# CAROS PRO VİZYONU

> **Durum:** Canlı belge
> **Belge türü:** Ürün vizyonu + capability roadmap
> **Kaynak gerçekliği:** Kod, test, UI ve saha kanıtı ayrı değerlendirilir
> **Güncelleme kuralı:** İlgili her PR sonrasında güncellenir
> **Son güncelleme:** 2026-08-28 · Branch: `feat/fleet-offline-final-local-completion`

> **MAPDATA ML RESCUE (2026-09-07):** Microsoft ML footprint geometry rescue
> **FAIL**; `BuildingGapDetector` **ENTEGRE / CODE PASS**; shadow tile **BLOCKED**.
> Doğrulanmamış ML geometrisi canonical/publishable bina olamaz. Üçüncü doku
> Erdemli n=113 (ML 112, OSM-derived 1); geometri referansı yetersiz alanlar
> UNKNOWN. Saha/cihaz doğrulaması yok; kütük #1322 ve
> `field-runs/mapdata-ml-accuracy-20260907/RESCUE_REPORT.md` otoritedir.

> ⚠️ **VERİ KAYBI BİLDİRİMİ (2026-08-28 · dürüst kayıt — silinmesin)**
>
> Bu belgenin **işlenmemiş (uncommitted) çalışma kopyası** 2026-08-28'de F6-B turu
> sırasında bir araç hatasıyla **SIFIRLANDI** ve geri getirilemedi (git'te yoktu,
> stash/dangling blob/editör geçmişi/OneDrive kopyası yok). Belge en son
> **`71f608a1` commit'indeki 2026-08-03 hâline** geri alındı; aşağıdaki F6-A/F6-B
> bölümleri elde kalan metinden yeniden yazıldı.
>
> **KAYBOLAN içerik:** 2026-08-03 → 2026-08-28 arasında bu belgeye yazılmış ama
> hiç commit edilmemiş vizyon güncellemeleri — **V-16 serisi** (filo/vardiya/API/
> raporlar) ve **P0-VDK-F1-A … F5-H** turlarının vizyon anlatımları.
>
> **KAYBOLMAYAN kanıt:** `docs/DEVICE_VALIDATION_LEDGER.md` (2 MB, #364–#944 —
> BÜTÜN maddeler yerinde) · kaynak kodu · testler · tur raporları (`docs/*_REPORT.md`)
> · commit geçmişi. **Kaybolan yalnız ANLATIMDI, KANIT DEĞİL.**
>
> **YAPILACAK:** F1-A…F5-H ve V-16 bölümleri kütük maddeleri (#700–#937) ve
> commit geçmişi kaynak alınarak yeniden yazılmalı. O bölümler yeniden yazılana
> kadar bu belge **eksiktir** ve durum seviyeleri için **kütük MUTLAK OTORİTEDIR**.
> Bu belge kütükle çelişirse kütük kazanır; durum YÜKSELTİLMEZ.

> **Son iş:** P0-VDK-F6B — **Çoklu-ECU üretici DTC kapsamı (rol-farkında, salt-okunur)**:
>   F6-A ÖLÇÜLMÜŞ uç noktaları buldu; F6-B o uç noktalardan **elde edilebilecek
>   en tam ve en DÜRÜST read-only DTC kapsamını** alıyor ve asıl soruyu
>   cevaplanabilir kılıyor: **“neyi sordum, ne cevap verdi, neyi okuyamadım ve
>   NEDEN?”**
>   **PLAN ARTIK VERİDEN TÜRER — ROL TABLOSU YOK:** `dtcCoveragePlan` (SAF · yeni)
>   hangi salt-okunur DTC servisinin sorulacağına CDDL `ServiceDef` kümesi + native
>   `DiagnosticServiceGate` alt fonksiyon kümesinin TS aynası (`GENERIC_UDS_19_SUBS`)
>   + ölçülmüş protokol ailesi + adreslenebilirlik + NRC 0x11 ile ÖLÇÜLMÜŞ servis
>   yokluğundan karar verir. **Plan girdisinde ROL ALANI YOKTUR**: rolü `unknown`
>   olan uç nokta, rolü kanıtlanmış uç noktayla BİREBİR aynı planı alır (F6-A §4).
>   **ON BİR KAPSAM SINIFI:** Mode 03/07/0A · UDS 19-01/02/03/04/06/0A · KWP 18/13;
>   her biri `TAM · KISMİ · DESTEKLENMİYOR(ölçüldü) · BİLİNMİYOR · ERTELENDİ ·
>   ENGELLİ · GEÇERSİZ` olarak sınıflandırılır. Uç nokta hükmü FAIL-CLOSED:
>   **tek bir BİLİNMİYOR/ERTELENDİ/KISMİ bile TAM hükmünü düşürür.**
>   **KAPATILAN ÜÇ ÖLÇÜLMÜŞ KUSUR:**
>   ① **SİHİRLİ STATUS MASKESİ** — ürün her ECU'ya 0x19-01 gönderip dönen
>   `statusAvailabilityMask`i kanıt defterine yazıyor ve **ATIYORDU**; 0x19-02'ye
>   sabit `FF` konuyordu. Artık maske ÖLÇÜMDEN gelir (ek sorgu YOK); ölçülemezse
>   `FF`e düşülür ama varsayım SESSİZ DEĞİLDİR (`ASSUMED_FULL` künyesi).
>   ② **GÖRÜNMEZ PDU'LAR** — `_readUdsReferences` ECU başına 1+8 = **9 isteği**
>   hatta çıkarıyordu ve HİÇBİRİ `consumeRequest`ten geçmiyordu: 8 ECU'da
>   **72 görünmez PDU**, iptal edilemez, geç yanıt kapısı işlemez. Artık her istek
>   (0x19-01 dâhil) F1-A `consumeRequest` TEK kapısından geçer.
>   ③ **KAPSAM ASİMETRİSİ** — snapshot/extended kanıtı yalnız 0x19-02'nin
>   ardından alınıyordu; **0x19-0A'nın VAR OLMA SEBEBİ olan** arşiv/etkin-değil
>   kayıtları derin kanıt HİÇ almıyordu. Artık merdiven bitince BİR KEZ, birleşmiş
>   kayıt kümesiyle çalışır — istek sayısı ARTMADAN kapsam simetrik olur.
>   **BAĞIMSIZ TANIK:** 0x19-01'in BEYAN ETTİĞİ kayıt sayısı artık çözülen sayıyla
>   karşılaştırılır; beyan > ölçüm ise kapsam `TAM` değil `KISMİ` yazılır.
>   **KÖR SÜPÜRME YOK:** 0x19-06 yalnız ÖLÇÜLMÜŞ bir ham DTC hedefiyle ve ECU
>   başına tavanlı (8) gönderilir; snapshot kayıt numarası süpürülmez.
>   **0x19-04 hattan HİÇ ÇIKMAZ** — native salt-okunur alt fonksiyon kümesinde
>   (`01·02·03·06·0A`) YOKTUR; kapı ZORLANMADI, durum dürüstçe `ENGELLİ` yazılır.
>   **ANLAM UYDURULMAZ:** 0x19-06 gövdesinin şeması OEM’e özgüdür; yalnız
>   “ham genişletilmiş veri MEVCUT” kanıtı üretilir.
>   **DAVRANIŞ DEĞİŞİKLİĞİ (dikkat):** reponun KENDİ CDDL sözleşmesi 0x19'u CAN'e
>   bağlar (`protocols: ['can']`) ama ürün yavaş seri hatta da 5 UDS isteği
>   gönderiyordu. Artık KWP araçta 0x19 HİÇ çıkmaz; o bütçe ISO 14230-3'ün gerçek
>   DTC servislerine (0x18/0x13) kalır. Açık risk kütükte (🔴 #943).
>   **İKİNCİ OTORİTE KURULMADI:** kod listesi ve “temiz mi” hükmü hâlâ YALNIZ
>   `dtcAuthority`de; sayım zinciri hâlâ `dtcPipelineAccounting`te (meta okumalar
>   19-01/03/06 o künyeye GİRMEZ — DTC kaydı üretmezler, girselerdi parite ölçümü
>   bozulurdu); bütçe hâlâ F1-A'da; güvenlik hâlâ native kapıda.
>   **LAB:** yeni salt-okunur ekran “Çoklu-ECU DTC Kapsamı” (Araç kategorisi) —
>   uç nokta başına 11 sınıfın sonucu, sorulmama gerekçesi, maske künyesi,
>   beyan/ölçüm karşılaştırması, snapshot/extended VAR-YOK'u, alan korunumu ve
>   mevcut RAW→PARSER→AUTHORITY→UI zinciri. **DTC KODU TAŞIMAZ** (gizlilik).
>   **AÇIK BORÇ:** 0x19-04 kapalı (native kapı + CDDL tanımı gerekir — yeni APK işi);
>   tarama içi yetenek yeniden kullanımı yalnız AYNI OTURUM + AYNI uç nokta
>   kapsımlıdır (F4-C çizgesinden okuma tam tarama SONRASINDA çözülen `vehicleId`e
>   bağlı olduğu için bu turda bağlanamadı); standart Mode 03/07/0A döngüsü plana
>   GÖRE değil eskisi gibi koşar (plan onu yalnız SINIFLANDIRIR).
>   **DURUM: ENTEGRE** — **SAHADA DOĞRULANMADI** (kütük 🔴 #938–#944)

> **Önceki iş:** P0-VDK-F6A — **Unknown-role ECU keşfi + kanıt tabanlı ECU kimliği**:
>   Kapatılan yapısal açık: ürün motor ECU'sunda derinleşmişti ama **rolü
>   bilinmeyen uç noktalar ölüydü**. `EcuVariant.role` tip düzeyinde `unknown`ı
>   yasaklıyor, `healingTargetFromProvenEcu` yalnız `MEASURABLE_ROLES` kabul
>   ediyordu → `7E1`de cevap veren, DTC'si bile okunan bir modül F4-B servis
>   keşfine ve F4-C öğrenmesine **HİÇ giremiyordu**. “Yalnız motoru tanıyor”
>   olmanın yapısal sebebi buydu.
>   **TEMEL AYRIM KURULDU: ADRES BULMAK ≠ ROL BİLMEK.** İki ayrı katman:
>   `ecuEndpointModel` (uç nokta — kaydında `role` alanı YOKTUR) ve
>   `ecuRoleEvidenceModel` (rol — kanıttan deterministik güven). Rol
>   birinciden TÜRETİLMEZ.
>   **GÜVEN SINIFLARI (AI/olasılık YOK):** `PROVEN` (standart garanti ya da
>   ECU'nun iki bağımsız kimlik beyanı) · `STRONG` (ECU beyanı ya da iki
>   destekleyici kanıt) · `CANDIDATE` (yalnız davranış benzerliği) ·
>   `UNKNOWN` · `CONFLICT` (iki güçlü kanıt farklı rol → fail-closed, ilki
>   SEÇİLMEZ). **Yetenek imzası ADAY tavanını YAPISAL olarak geçemez.**
>   **UNKNOWN ARTIK DEĞERLİ:** `EcuVariant.role` ölçümde `unknown` taşıyabilir
>   (BELGE yasağı `cddl/validate.ROLE_UNKNOWN_FORBIDDEN` ile DURUYOR) ve
>   `productionDiscovery` hedefleri rol-bağımsız kuruluyor → rolsüz uç nokta
>   keşfe ve yetenek çizgesine girer, kimlik yoklaması alır, ama rol-özel
>   hiçbir şey çalıştıramaz. “Kim olduğunu bilmiyorum” ≠ “ECU yok”.
>   **KÖR TARAMA YAPISAL OLARAK İMKÂNSIZ:** aday uzayı adresleme ailesine göre
>   KAPALIDIR — CAN11 yalnız ISO 15765-4 çifti (`7E0..7E7`), CAN29 ve KWP için
>   standart aday uzayı YOKTUR ve uç nokta yalnız ölçülmüş responder/kaynak
>   adresinden doğar. OEM sihirli adres tablosu YOK.
>   **CDDL VariantPattern İLK KEZ ÇALIŞTIRILIYOR:** desen artık ölçülmüş
>   gerçeklere (VIN WMI/VDS · DID yanıtı · cevap veren adres) karşı
>   değerlendiriliyor; TÜM kanıtlar sağlanmadan tutmaz, birden çok desen
>   tutarsa `BELİRSİZ` olur ve **ilki seçilmez**.
>   **ARAÇ İZOLASYONU:** üçüncü kalıcı bölüm (`caros-ecu-roles-v1:<parmakizi>`)
>   `vehiclePartitionKeys`e dâhil (yarım GC kalkanı) ve anahtarı **ECU parmak
>   izidir, adres değil** — bir araçta öğrenilen rol başkasının aynı CAN
>   kimliğine uygulanamaz. Yalnız CANLI kanıt yazılır; **ölçüm kaybı
>   kanıtlanmış rolü DÜŞÜRMEZ**, `UNKNOWN` sonraki turda `PROVEN` olabilir.
>   **REPLAY:** `did_read` kanonik iz operasyonu eklendi; çok-ECU golden
>   korpusu (ECM·TCM·ABS·SRS·BCM·UNKNOWN, LİTERAL hex) aynı motoru oynatıp
>   **birebir aynı envanteri** üretiyor — ama replay rolü ürün gerçeği
>   SAYILMIYOR ve öğrenmeye YAZILMIYOR.
>   **GÜVENLİK:** yalnız salt-okunur `0x22` kimlik DID'i (ISO 14229-1
>   F197·F18C·F191·F187, hepsi repoda ZATEN tanımlı); `27` SecurityAccess,
>   kodlama, rutin, aktüatör, reset, silme YOK — destructive matris 0 PDU.
>   **AÇIK BORÇ:** ağ geçidi topolojisi ölçülemiyor (`GATEWAY_EXPOSED`/
>   `GATEWAY_REQUIRED` tanımlı ama ÜRETİLMEZ); `CAPABILITY_SIGNATURE` ve
>   `CALIBRATION_MATCH` kanıt türleri modelde var ama bu turda ÜRETİLMİYOR
>   (kanıtlanabilir eşleme tablosu repoda yok — uydurulmadı).
>   **DURUM: ENTEGRE** — **SAHADA DOĞRULANMADI** (kütük 🔴 #932–#937)

> ℹ️ **P0-VDK-F1-A … F5-H ve V-16 bölümleri:** anlatımları yukarıdaki veri kaybında
> gitti. Kod, testler ve kütük maddeleri (#700–#931) yerinde — bu bölümler onlardan
> yeniden yazılacak. O ana kadar bu turlar için **kütük tek otoritedir**.

> **2026-08-03 öncesi başlık (korundu):**
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
| `docs/CAROS_MAVI_ULTIMATE_OEM_ARCHITECTURE_SPEC_v1.md` | **Mavi hedef MİMARİSİ (OEM++)** — repo denetimi (ölçülmüş) · KEEP listesi · Capability Fabric · streaming konuşma · gecikme bütçesi · F0–F13 fazları · ADR'ler | Mavi **mimari "nasıl"** sorusunda birincil; **saha durumu bu belgede DEĞİL** (kütük mutlak) |
| `docs/MAVI_FLAG_EXIT_CRITERIA.md` | **16 Mavi feature flag'inin exit criteria'sı** — açılma ölçütü · `default ON` şartı · kaldırma şartı · rollback sözleşmesi · ≤2 hedefine giden migration planı | Bayrak açma/kapama/kaldırma kararında **birincil**; saha durumu bu belgede DEĞİL (kütük mutlak) |
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

- **MAVI-F13/4 · KONSOLİDASYON KAPANIŞ TURU — MİMARİ KAPANIŞ HAZIR, SAYISAL
  HEDEFLER MUAFİYET ÖNERİLİYOR (2026-08-30, kütük 🔴 #1039-#1042):**
  **Durum: ENTEGRE. SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR. F13 KAPANMADI.**

  **1) İKİ ÖLÜ UZAK BAYRAK BULUNDU VE BESLENDİ (#1039 — bu turun asıl bulgusu).**
  `mavi_semantic_endpoint` (F3) ve `mavi_streaming_response` (F4) uzak
  anahtarlarının setter'ı tanımlıydı, `MAVI_FLAG_EXIT_CRITERIA` ikisi için de
  filo rollout + rollback **sözü veriyordu**, `voiceService` yorumu tüketiciyi
  adıyla gösteriyordu — ama **iki setter de üretimde hiç çağrılmıyordu**.
  Yani belgedeki "AŞAMA 1 · default ON → kaldır" adımı **uygulanamaz**
  durumdaydı. Bayraklar silinmedi (silmek, ölçülmemiş bir yeteneği çöpe atmak
  olurdu); F0'ın birebir aynı deseniyle beslendi ve söküm yolunda kapatıldı.
  Bilinmeyen anahtar → `false` → varsayılan KAPALI; cihaz davranışı bayt bayt aynı.

  **2) BAYRAK DENETİMİ TAMAMLANDI — 16 ŞALTERİN 16'SI CANLI (#1042).**
  Her bayrağın üretim tüketicisi tek tek ölçüldü:
  **DEAD/LEGACY 0 · MERGEABLE 0 · DEFAULT ON ELIGIBLE 0 · MUST STAY 16.**
  Güvenle kaldırılabilecek ölü bayrak **yok**; sayı ancak saha ölçümüyle düşer.
  Bu tur sayıyı düşürmedi ama **dürüstleştirdi**: artık 16 şalterin 16'sı
  gerçekten çalışan bir dalı kontrol ediyor (önce 14 gerçek + 2 hayalet idi).

  **3) `companionChatProvider` 2512 → 2352 satır (−%6,4; F13 toplamı −%23,8).**
  Çıkarılanlar: `companionBrainParser` (model JSON → kanonik `SemanticResult`
  **önerisi**; SAF — modül durumu YOK · `fetch` YOK · `Date.now`/`Math.random`
  YOK · sağlayıcıya **yalnız `import type`** ile bağlı → çalışma zamanı kenarı
  yok) ve persona'ya bağlı deterministik metinler → `companionAnswerShaping`.
  Ayrıştırma sağlayıcıya özgü değildi: Gemini · Groq · Haiku · gateway
  **dördü de** aynı fonksiyonu paylaşıyordu. Filler kapısı (`isGenericFiller`)
  da oraya taşındı — zaten PARSE SINIRINDA olmalıydı (F2 · I11).
  **Yetki dağıtılmadı:** ayrıştırıcı ÖNERİ üretir; kapı, onay ve yürütme
  kanonik zincirdedir.

  **4) PLAN ÖNEKİ SÖZLEŞMESİ TİPE ALINDI (#1041 — QA F13/3 bulgusu).**
  `itemId.split(':')[1]` ile adım↔yük eşlemesi yapılıyordu ama önek serbest
  `string`di: iki nokta içeren bir önek **yanlış komutu çalıştırırdı**. Artık
  `MaviPlanIdPrefix = 'p' | 'c'` kapalı kümesi + çalışma zamanı fail-closed
  kapısı var. Bugünkü davranış değişmedi.

  **5) `voiceService`E DOKUNULMADI (2689 satır — bilinçli).**
  `processTextCommand` · `startListening` · tur sahipliği · UI `VoiceState`
  sahipliği · kanonik dispatch · barge-in · TTS-bitiş sahipliği **kökte kaldı**.
  Bunlar orkestrasyonun ta kendisidir; bölmek yetkiyi dağıtır ve F13'ün
  tek-otorite kazanımını geri alır. **Dosyayı küçültmek için otorite bölmek
  bu projede kabul edilebilir bir bedel DEĞİLDİR.**

  **6) DÖRT KİLİT YENİDEN BAĞLANDI, BİRİ DAVRANIŞA YÜKSELTİLDİ.**
  Kod taşınınca körleşen dört kaynak-çapalı kilit (`regression.guards` ×2 ·
  `capabilityPlan` #42 · `evidenceAndNetworkNoise` #669) **silinmeden** yeni
  sahiplerine bağlandı ve güçlendirildi — ör. `capabilityPlan` #42 artık
  sağlayıcıda **ikinci bir alan çıkarıcısı doğmadığını** da tarıyor; #669'a
  gerçek çağrı yapan bir davranış kilidi eklendi (REASK metni ile NET_DOWN
  metni hiçbir kişilikte aynı olamaz). `voiceRuntimeSeparation.guards`
  506 → 696 satır. **Dört mutasyonun dördü de kırmızıya döndü.**

  **AÇIK BORÇLAR (dürüstçe):**
  1. **Sayısal hedefler karşılanmadı ve bu turda karşılanmaya ÇALIŞILMADI:**
     `voiceService` 2689 (hedef ≤900) · `companionChatProvider` 2352
     (hedef ≤1200) · bayrak 16 (hedef ≤2). Gerekçe §5 ve #1042.
  2. **`routeIntent` gözlem borcu duruyor** (#1028) — bileşik planda UI/medya
     adımları `UNKNOWN` kalıyor ve parser yedek metni kullanılıyor.
  3. **Hiçbir bayrak ölçütü ölçülmedi** (#1034, #1042); F3/F4 filo şalterinin
     gerçekten çalıştığı da henüz kanıtlanmadı (#1039).
  4. **Hiçbiri cihazda doğrulanmadı** (#1035-#1041).

  **Sonraki atomik PR:** (a) `mavi_latency_trace` açılma ölçütünün gerçek
  head unit'te ölçülmesi — bayrak zincirinin ilk halkası odur ve ondan önce
  hiçbir bayrak ilerleyemez; (b) `routeIntent` kanonik gözlem borcunun
  kapatılması (#1028).

  ---

  ### F13 KAPANIŞ DEĞERLENDİRMESİ (iki eksen AYRI okunur)

  | ARCHITECTURAL CLOSURE | Durum |
  |---|---|
  | Tek Mavi authority | ✅ |
  | Duplicate truth yok | ✅ |
  | Duplicate state yok | ✅ |
  | Legacy/ikinci assistant stack yok | ✅ |
  | Guard'lar canlı (kör guard yok, mutasyonla kanıtlı) | ✅ |
  | Bayrak yaşam döngüsü tanımlı **ve her bayrağın besleyicisi var** | ✅ |
  | Açık cihaz borçları kütükte 🔴 | ✅ |
  | **ARCHITECTURAL CLOSURE READY** | **EVET** |

  | NUMERICAL TARGETS | Hedef | Bugün | Durum |
  |---|---|---|---|
  | `voiceService.ts` | ≤ 900 | 2689 | ❌ |
  | `companionChatProvider.ts` | ≤ 1200 | 2352 | ❌ |
  | Açık bayrak | ≤ 2 | 16 | ❌ |
  | **NUMERICAL TARGETS MET** | | | **HAYIR** |

  ### 🔶 NUMERICAL TARGET WAIVER RECOMMENDED — gerekçe (sessiz muafiyet DEĞİL)

  Üç sayısal kapının üçü de **ancak güvenli mimari sınırlar bozularak**
  kapatılabilir; bu, spec §29'un kendi "Korunacak authority: **Hepsi**"
  şartıyla doğrudan çelişir:

  1. **`voiceService` ≤ 900** → kalan kütlenin çoğu `processTextCommand`
     (~670 satır) ve `startListening` (~380 satır); ikisi de karar sırasının
     ve dinleme yaşam döngüsünün KENDİSİDİR. Bölmek tur/konuşma/dispatch
     otoritesini dağıtır → F13'ün asıl kazanımını geri alır.
  2. **`companionChatProvider` ≤ 1200** → kalan kütle sağlayıcı zinciri,
     prompt kompozisyonu, dört model çağrısı, grounding sentezi ve Safety
     PRE/POST sarmalayıcılarıdır. Bunları bölmek **ikinci bir assistant
     runtime** doğurur (spec §28.2'nin açık yasağı).
  3. **Bayrak ≤ 2** → 16 şalterin 16'sı canlı, ölü/birleştirilebilir bayrak
     **yok** (#1042). Sayıyı düşürmenin iki yolu vardır ve ikisi de kanıtsızdır:
     ölçülmemiş davranışı filoya dayatmak (`default ON`) ya da yazılmış bir
     yeteneği ölçmeden silmek. `MAVI_FLAG_EXIT_CRITERIA` üçüncü yolu tarif eder
     ve o yol **saha ölçümünden geçer**, refactor'dan değil.

  **Öneri:** F13'ün kapanışı **ARCHITECTURAL CLOSURE** ekseninden verilsin;
  sayısal kapılar **iptal edilmesin**, `MAVI_FLAG_EXIT_CRITERIA` ve
  `DEVICE_VALIDATION_LEDGER`e bağlı **açık hedef** olarak kalsın ve saha
  ölçümleri geldikçe kapansın. Bu bir hedef indirimi değil, **hedefin doğru
  kapıya bağlanmasıdır**. Kararın sahibi kullanıcıdır; bu belge yalnız kanıtı sunar.
- **MAVI-F13/3 · BİLEŞİK PLAN MEKANİĞİ TEK KAYNAĞA İNDİ + `companionChatProvider`
  DEEP ROLE İNDİRGENDİ (2026-08-30, kütük 🔴 #1035-#1038):**
  **Durum: ENTEGRE. SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR. F13 KAPANMADI.**

  **1) Bileşik plan MEKANİĞİ tek yere alındı — YETKİ DAĞITILMADAN.**
  F13 iki bileşik yolu (beyin · yerel ayrıştırıcı) kanonik plana bağlamıştı ama
  mekaniği **iki kez yazmıştı** (~120 satır ikiz kod: plan kimliği ·
  `buildCapabilityPlan` · `runCapabilityPlan` · adım↔yük eşlemesi ·
  `summarizePlan` · telemetri şekli · `renderPlanOutcome`). İkiz kod ikiz kusur
  demektir: birinde düzeltilen sıra hatası ötekinde sessizce yaşar.
  Mekanik `voice/maviCompoundPlanRuntime.ts`e alındı ve sözleşmesi kilitlendi:
  **konuşmaz** (cümleyi yalnız DÖNER; söyleme kararı ve cevap slotu kökte) ·
  **tur açmaz/kapatmaz** (`isTurnCurrent` PORTUNDAN sorar) · **yürütmez**
  (`execute` portu; `commandExecutor`/`intentEngine` bilmez) · **kapı kurmaz**
  (`evaluateLegacyIntent` kökte kaldı) · **telemetri yazmaz** (yalnız şekil).
  Import yüzeyi kilitli: YALNIZ `capability/fabric/*`.

  **2) `companionChatProvider` DEEP sağlayıcıya yaklaştı: 3086 → 2512 satır (−%19).**
  Dört sorumluluk çıkarıldı — hiçbiri model·prompt·ağ işi değildi:
  · `companionProactiveAlert` — proaktif kritik arıza uyarısı (bağımsız alt sistem);
  · `companionAnswerShaping` — token bütçesi · karakter tavanı · cümle-sınırı kırpma (SAF);
  · `companionProviderHealth` — üç sağlayıcı-bazlı 429 penceresi · AYRI grounding
    penceresi · kimlik reddi (401/403) ve kredi (402) işaretleri · dürüst arıza
    metinleri · LAB kota anlık görüntüsü (**yaprak**: import YOK · `fetch` YOK ·
    konuşma YOK · rota seçimi YOK · telemetri YOK · `Date.now` YOK → monotonik saat);
  · `companionOfflineReplies` — smalltalk anahtar kelimeleri · hazır cevap tablosu ·
    deterministik rotasyon (**tam yaprak**, `Math.random` YOK).
  **Kalan (kasıtlı) sorumluluklar — DEEP rolünün kendisi:** sağlayıcı zinciri ve
  aday sırası · prompt kompozisyonu (kimlik · araç bağlamı · Driver DNA · konu
  ipucu) · model çağrıları (Gemini/Groq/Haiku/gateway) · JSON ayrıştırma ve
  `SemanticResult` normalizasyonu · grounding sentezi · sohbet geçmişi ve kısa
  süreli konu bağlamı · Safety Kernel PRE/POST sarmalayıcıları.

  **3) İKİNCİ ASİSTAN STACK OLUŞMADI.** Çıkarılan modüllerin hiçbiri konuşamaz,
  tur açamaz, rota seçemez, eylem yürütemez. Kimlik reddi künyesini (`pushTrail`)
  hâlâ KÖK yazar; sağlık defteri yalnız **sağlayıcı ADINI** döner (anahtar/PII asla).

  **4) DIŞ YÜZEY DEĞİŞMEDİ.** `RATE_LIMIT_COOLDOWN_MS` · `getProviderQuotaSnapshot` ·
  `classifySmalltalk` sağlayıcıdan yeniden dışa verildi → LAB (`maviConsoleSources`)
  ve tanı (`diagnosticSections`) tüketicileri dokunulmadan çalışıyor.
  **Yeni LAB ekranı AÇILMADI** — sorumluluk taşındı, yeni durum doğmadı
  (ekran enflasyonu yasağı; gözlem yüzeyi zaten Mavi Konsolu kota bölümü).

  **5) KİLİTLER KAYNAK TARAMASINDAN DAVRANIŞA TAŞINDI.** F13/2'de plan bloğuna
  çapalı kilitler körleşme riski taşıyordu. Üç `regression.guards` kilidi
  (grounding penceresi · sağlayıcı-bazlı 429 · aday atlama) **silinmeden** yeni
  yapıya bağlandı ve **güçlendirildi** — artık yalnız "Gemini penceresi kuruluyor
  mu" değil, "Groq/Haiku dalı Gemini penceresini KURAMAZ" da taranıyor.
  `voiceRuntimeSeparation.guards` 295 → 506 satır: plan mekaniğinin **davranış**
  kilitleri (adım sırası · devralınan turda yan etki başlatmama · gözlem yokken
  cümle uydurmama · plan kimliği artışı) ve sağlık defterinin davranış kilitleri
  (çapraz kirlenme · ayrık grounding penceresi · kredi-önce-anahtar sırası ·
  künyede yalnız sağlayıcı adı · kota görüntüsünün alan kümesi).
  **Dört mutasyon** kilitleri gerçekten kırmızıya çevirdi: yasak otorite import'u ·
  uydurma başarı cümlesi · deftere `fetch` + çapraz kirlenme · çağrı yerinde
  çapraz kirlenme. **Kör guard bırakılmadı.**

  **AÇIK BORÇLAR (dürüstçe):**
  1. **F13 KAPANMADI.** `voiceService` **2689** satır (hedef ≤900) ·
     `companionChatProvider` **2512** (hedef ≤1200) · bayrak **16** (hedef ≤2,
     hiçbiri açılmadı — ölçüt yok). Bu turun hedefi sayısal kapı DEĞİLDİ.
  2. **Kökte kalan iki büyük sorumluluk hâlâ bölünmedi (bilinçli):**
     `processTextCommand` ve `startListening` — orkestrasyonun ta kendisidir;
     bölmek yetkiyi dağıtır ve F13'ün tek-otorite kazanımını geri alır.
  3. **`routeIntent` gözlem borcu duruyor** (#1028): UI/medya adımları gözlem
     yazmadığı için bileşik planda `UNKNOWN` kalıyor ve parser yedek metni
     kullanılıyor. F13/3 bunu kapatmadı — kapsam borcudur, mekanik borç değil.
  4. **Hiçbiri cihazda doğrulanmadı** (#1035-#1038): çapraz kirlenmenin gerçekten
     bittiği, grounding 429'unun beyni öldürmediği ve dürüst anahtar/kredi
     mesajlarının duyulduğu gerçek araçta ÖLÇÜLMEDİ.

  **Sonraki atomik PR:** (a) `routeIntent` kanonik gözlem borcunun kapatılması
  (#1028) — bileşik planın yedek metne düşmesini bitiren tek iş; (b)
  `mavi_latency_trace` açılma ölçütünün gerçek cihazda ölçülmesi — bayrak
  zincirinin ilk halkası odur ve ondan önce hiçbir bayrak ilerleyemez.
- **MAVI-F13/2 · `voiceService` AYRIŞTIRMASI + BAYRAK EXIT CRITERIA
  (2026-08-30, kütük 🔴 #1032-#1034):**
  Durum: **ENTEGRE** (tam suite 716 dosya / 16 424 test yeşil · `npm run guard`
  804/804 · tsc temiz · değişen dosyalarda lint 0 hata · production build yeşil ·
  native değişiklik YOK) — **SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR.
  F13 HÂLÂ AÇIK.**

  **1) `voiceService` üç sorumluluğa ayrıldı — 3139 → 2712 satır (−%14).**
  Kök **bileşim kökü (orchestration root) olarak KALDI**; yetki dağıtılmadı.

  | Yeni modül | Sahiplendiği | Satır |
  |------------|--------------|-------|
  | `voice/voiceCommandPolicy` | SAF sınıflandırma/sezgi: ACK sınıfı · söylem sınıflandırması (sohbet-kapatma · onay/ret · bağlaç) · AI-istek sezgisi · n-best seçimi · UI sıfırlama gecikmeleri. **Durum·timer·I/O·`Date.now` YOK** | 214 |
  | `voice/voicePerceptionRuntime` | Ses seviyesi göstergesi (AudioContext · sentetik dalga · native RMS) · asistan ducking'i · MAVI-F3 kısmi transkript oturumu | 346 |
  | `voice/voiceConversationRuntime` | Sohbet oturumu bayrağı · takip dinlemesi · iki emniyet penceresi. **Hiçbir platform modülü import ETMEZ** — tamamı port | 315 |

  **2) Yetki DAĞITILMADI (yapısal kilit).** Üç modülün hiçbiri `maviTurn`,
  `maviSpeech`, `commandExecutor`, `capabilityFabric`, `maviActionAuthority`,
  `intentEngine` veya `processTextCommand`a dokunamaz — 17 kilit
  (`voiceRuntimeSeparation.guards.test.ts`) bunu tarar ve **5 mutasyonla**
  kör olmadığı kanıtlandı.

  **3) Durum çoğaltması YOK (tek sahip kuralı).** `_convSession` ·
  `_followUpArmed` · `_convIdleOnTtsEnd` · üç zamanlayıcı **yalnız** sohbet
  runtime'ında; `_audioCtx` · `_volumeSimTimer` · `_rmsListenerHandle` ·
  `_f3SessionId` · `_assistantDuckedMusic` **yalnız** algı runtime'ında;
  `VoiceState` **yalnız** kökte. Kilit kökte ikinci kopya arar ve bulursa DÜŞER.
  `push({…})` çağrısı çıkarılan modüllerin hiçbirinde YOKTUR.

  **4) Bulunan ve düzeltilen GERÇEK kusur (zero-leak):** TTS bitişindeki 350 ms'lik
  yeniden-dinleme gecikmesi **handle'ı tutulmayan** bir `setTimeout` idi —
  `dispose` sonrası kuyrukta iş kalıyordu. Gözlenebilir davranış güvendeydi
  (`_convSession` kapısı yakalıyordu) ama sahiplik eksikti. Handle artık tutuluyor
  ve söküm onu da iptal ediyor (kütük #1033).

  **5) TTS-bitiş aboneliği TEK kaldı.** Abonelik bileşim kökündedir: kök
  `speech_end` olayını ve F0 gecikme izini kapatır, **sohbet kararını** sahibine
  devreder. İkinci bir `registerTtsEndListener` kilitle yasaklıdır.

  **6) Port bağlamaları TEMBEL sarılır.** Doğrudan referans (`isTtsSpeaking,`)
  modül YÜKLENİRKEN dış bağlamayı okur ve kısmi mock'lanmış `ttsService` ile
  **18 test dosyasını modül yükleme aşamasında düşürdü**. `() => fn()` sarması
  taşımadan önceki çağrı-zamanı davranışını birebir korur ve testlere yeni mock
  yüzeyi getirmez. (Bu, ayrıştırmanın ürettiği ve aynı turda kapatılan tek
  gizli kuplajdır.)

  **7) YENİDEN BAĞLANAN yedi kilit (kaldırma DEĞİL) — beşi GÜÇLENDİ:**
  `regression.guards` ×2 (emniyet pencereleri artık **portun gerçekten bağlı
  olduğunu** da doğruluyor — port kör bağlanırsa kilit düşer; `armConvIdleOnTtsEnd`
  tanımının varlığı da aranıyor) · `maviFakeAck` ×2 (ACK listesi + tanım artık
  politikada aranıyor, çağrı dalları kökte) · `maviDrivingWorkload` #42 (bütçe
  kapısı **hem runtime'da hem kökteki port bağlamasında** doğrulanıyor) ·
  `maviBargeInControl` (ad kanonikleşti) · `maviContextGrammar` (AFFIRM/NEGATE
  artık **kaynak metni yeniden ayrıştırmak yerine GERÇEK regex nesnesini**
  çalıştırıyor — kırılgan yol tümüyle kalktı).

  **8) BAYRAK EXIT CRITERIA YAZILDI — `docs/MAVI_FLAG_EXIT_CRITERIA.md`.**
  16 Mavi şalterinin **her biri** için: neyi açtığı · default · rollback değeri ·
  kütük bağı · **ölçülebilir açılma ölçütü** · `default ON` şartı · kaldırma şartı.
  Ayrıca ortak yaşam döngüsü (TANIMLI → PİLOT → DEFAULT ON → KALDIRILDI), ölçüm
  kaynakları tablosu ve ≤2 hedefine giden **üç aşamalı migration planı**.
  **Sayım düzeltildi:** F13 raporu "12" demişti; gerçek sayı **16**'dır
  (`mavi_latency_trace` · `mavi_semantic_endpoint` · `mavi_streaming_response` ·
  `mavi.mediaNextTakeover.enabled` o sayıma girmemişti). Kütük #1031 güncellendi.

  **AÇIK BORÇLAR (dürüstçe):**
  1. **F13 KAPANMADI.** `voiceService` **2712** satır (hedef ≤900) ·
     `companionChatProvider` **3086** (hedef ≤1200, bu turda DOKUNULMADI) ·
     bayrak **16** (hedef ≤2, hiçbiri açılmadı — ölçüt yok).
  2. **Kökte kalan iki büyük sorumluluk BİLİNÇLİ olarak bölünmedi:**
     `processTextCommand` (~670 satır · karar sırasının kendisi) ve
     `startListening` (~380 satır · dinleme oturumu yaşam döngüsü). Bunlar
     **orkestrasyonun ta kendisidir**; bölmek yetkiyi dağıtır ve F13'ün tek-otorite
     kazanımını geri alır. Ayrıca F6/F13 bileşik plan bloğu (~380 satır) da
     taşınmadı: içine **beş kaynak kilidi** çapalanmış taze F13 kodudur ve
     cihazda henüz doğrulanmamıştır — taşıma F13/3'e bırakıldı.
  3. **Hiçbir bayrak ölçütü ölçülmedi.** Belge bir PLANDIR, kanıt DEĞİLDİR (#1034).
  4. **Ayrıştırma cihazda doğrulanmadı** — sohbet döngüsü, uzun cevabın
     kesilmemesi, ducking, ses göstergesi ve hard-kill sonrası sessizlik gerçek
     head unit'te ölçülmedi (#1032, #1033).

  **Sonraki atomik PR:** F13/3 — (a) bileşik plan bloğunun taşınması (beş kilidin
  birlikte yeniden bağlanmasıyla), (b) `companionChatProvider`ın DEEP sağlayıcısına
  indirgenmesi. Öncesinde `mavi_latency_trace` açılma ölçütünün gerçek cihazda
  ölçülmesi — bayrak zincirinin ilk halkası odur.

- **MAVI-F13 · KANONİK RUNTIME KONSOLİDASYONU — ÜÇ HAT TEK OTORİTEYE BAĞLANDI
  (2026-08-29, kütük 🔴 #1027-#1031):**
  Durum: **ENTEGRE** (canlı hatta bağlı · tam suite 715 dosya / 16 407 test yeşil ·
  `npm run guard` 804/804 · tsc temiz · değişen dosyalarda lint 0 hata ·
  production build yeşil · native değişiklik YOK) —
  **SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR. F13 KAPANMADI (bkz. kütük #1031).**

  **1) ÜÇ HAT DENETİMİ — ölçüm, varsayım değil.**
  Statik import grafiği (`src/` altındaki her `.ts/.tsx`, test/üretim ayrımıyla)
  şunu ölçtü:

  | Hat | Gerçek durum | Sınıf |
  |-----|--------------|-------|
  | **HAT-1 `voiceService`** | Kullanıcıya ulaşan **TEK** hat | `CANONICAL_KEEP` |
  | **HAT-2 `maviCore`** | `wiring/*` üretimde CANLI ama **gözlem/kanıt** rolünde (`maviEvidence` · `maviOwnership` · `takeoverArbiter`); `actionRegistry`/`actionSafety` **tip+güvenlik defteri** olarak `maviActionAuthority` ve `companionActions` tarafından okunuyor | `ADAPT_INTO_CANONICAL` |
  | **HAT-2 gölge çekirdeği** | `intentResolver` · `navActions` · `appSafeActions` · `discoveryActions` · `index.ts` → **üretim tüketicisi 0** | `DEPRECATE` |
  | **HAT-3 `ai/`** | Tek kök: `companionChatProvider → maviOrchestratedChat`. **İkinci bir asistan yolu DEĞİL**, kanonik DEEP sağlayıcısı | `CANONICAL_KEEP` (bayraklı) |
  | `commandExecutor.executeSequence` | Üretim çağıranı **0**, test çağıranı **0** | `DELETE_SAFE` → **SİLİNDİ** |

  **2) KANONİK RUNTIME — tek giriş zinciri:**
  `ses/metin → maviTurn (tek tur otoritesi) → anlama/plan → capabilityFabric →
  maviActionAuthority → commandExecutor → maviSpeech (tek konuşma otoritesi) →
  maviMemory (tek izdüşüm)`. Bu zincirin dışında ikinci yürütme hattı yok.

  **3) Denetimde bulunan ve KAPATILAN üç gerçek açık:**

  | # | Açık | Kanıt | Kapatma |
  |---|------|-------|---------|
  | 1 | **İKİ bileşik yürütücü.** `dispatchChain` parser metnini **yürütmeden ÖNCE** seslendiriyor, gözlem HİÇ okumuyordu → F7 sözleşmesinin dışındaydı | `voiceService.ts` eski `dispatchChain` gövdesi | Zincir kanonik `buildCapabilityPlan → runCapabilityPlan → renderPlanOutcome` yoluna bağlandı; cümle artık yürütmeden SONRA kurulur |
  | 2 | **ÜÇÜNCÜ (ölü) bileşik yürütücü.** `executeSequence` `Promise.all` ile PARALEL dağıtıyor, tur kapısı/onay/gözlem uygulamıyordu | statik tarama: 0 üretim + 0 test çağıranı | **Silindi** (kanonik karşılığı `capabilityPlanRunner`) |
  | 3 | **Çift prompt enjeksiyonu.** Prompt kanonik araç bağlamı + F10 hafıza izdüşümünü taşırken orkestratör AYNI kanonik kaynaklardan İKİNCİ birer blok ekliyordu | `maviOrchestratedChat.askOrchestratedChat` → `withVehicleContext` + `withMemory` | `systemCarriesCanonicalProjection: true` → ikinci enjeksiyon kapalı; telemetri `canonical_upstream` |

  **4) Yol boyu bulunan ve YENİ DOĞRU DAVRANIŞA GÜNCELLENEN iki kilit (kaldırma DEĞİL):**
  `maviTurnGuard` #37 sabit 1200 karakterlik pencereye bakıyordu ve zincir uzayınca
  **körleşecekti** → pencere bir sonraki fonksiyon başlığına bağlandı, üstüne kapının
  plan yürütücüsünün **adım-başı portu** olduğu da doğrulandı ·
  `carosLabMaviConsole` bölüm sayısı 10 → 11 ve **fail-soft kilidine F13 kaynağı da
  mock'landı** (defter patlarsa "gölge çalışmadı" DENMEZ).

  **5) Regresyon kilidi ürünü DÜZELTTİ (test uğruna ürün bozulmadı):**
  `multiHardwareConfirmationRace` #15 düştü ve HAKLIYDI: plan adımını
  `requiresConfirmation` işaretlemek **ÜÇÜNCÜ bir onay politikası** kuruyordu —
  adım hiç dağıtılmıyor, kanonik `needs_confirmation` yolu hiç çalışmıyor ve
  *"müziği aç ve aracı kilitle"* denince kilit **sessizce askıda** kalıyordu.
  Onay yetkisi kanonik iki otoriteye geri verildi (SIRA: `classifySequenceConfirmationPolicy`
  · EYLEM: `maviActionAuthority` → bekleyen eylem) ve bu yeni kilitle sabitlendi.

  **6) Guard'lar — 22 kilit, 7 mutasyonla doğrulandı** (`maviCanonicalRuntime.guards.test.ts`):
  tek bileşik yürütücü · ön-ACK yasağı · `executeSequence` dirilemez · tek konuşma
  otoritesi · tek hafıza/bağlam izdüşümü · gölge hat yürütme yetkisi alamaz ·
  ayrıştırıcı/LLM doğrudan alt sisteme dokunamaz · plan katmanı onay politikası
  kurmaz · deprecate edilen modüllerin üretim importu yok · LAB hüküm üretmez.
  Her kilit ÖNCE çapasının varlığını doğrular (kör guard yasağı); mutasyon testleri
  7/7 kırmızı verdi.

  **7) LAB:** yeni ekran AÇILMADI — mevcut **Mavi Konsolu**'na
  *K · Kanonik Runtime / Konsolidasyon (F13)* bölümü eklendi. Yeni telemetri
  KURULMADI: `maviEvidence`in ZATEN tuttuğu bounded defterler sayılır
  (gölge kararları · eski hat yürütmeleri · **çift yürütme anahtarları** · köprü
  yaşam döngüsü · açık bayrak listesi). Defter tavana dayanırsa LAB bunu AÇIKÇA
  yazar — *"0 gördüm = hiç olmadı"* çıkarımı yalnız `bounded=false` iken geçerlidir.

  **AÇIK BORÇLAR (dürüstçe):**
  1. **F13 KAPANMADI.** Spec §29 kabul ölçütleri karşılanmadı: `voiceService`
     **3139 satır** (hedef ≤900) · `companionChatProvider` **3086** (hedef ≤1200) ·
     Mavi bayrağı **12** (hedef ≤2). Bunlar bilinçli olarak kapatılmadı: 900 satır
     hedefi çok-sistemli rewrite'tır (`AI.md` ihlali), bayrak indirimi ise cihazda
     hiç doğrulanmamış özellikleri kanıtsız açmak/silmek demektir (kütük #1031).
  2. **`routeIntent` yolu gözlem YAZMIYOR** (F7'den devralınan kapsam borcu):
     UI/medya/tema adımları planda `UNKNOWN` kalır, bu yüzden parser'ın birleşik
     metni **yedek** olarak KORUNDU — aksi hâlde zincirde sessizliğe düşülürdü
     (kütük #1028).
  3. **`maviCore` hâlâ ayrı bir runtime olarak kayıtlı**: gölge köprü üretimde her
     komutu GÖZLER (handler'ları no-op). Silinmedi — spec §28.2 onu MCX L0/L4/L7'ye
     taşımayı öngörüyor. Sızma yasağı guard'la kilitlendi.
  4. **Deprecate edilen dört modül SİLİNMEDİ** (`intentResolver` · `navActions` ·
     `appSafeActions` · `discoveryActions`): üretim tüketicisi 0 ama kendi testleri
     var; test kapsamını yok etmek F13'ün işi değil. Yeni üretim importu guard'la
     yasaklandı.
  5. **Hiçbir F13 sayacı gerçek cihazda okunmadı** — `shadow invocation = 0`
     iddiası bugün ÖLÇÜM DEĞİL, HEDEFTİR (kütük #1030).

  **Sonraki atomik PR:** (F13/2 TAMAMLANDI — yukarı bakın.) Eski plan: `voiceService` ayrıştırması (algı / karar / yürütme),
  spec F13 satır kapılarına doğru ATOMİK turlarla; öncesinde bayrak açılma
  kriterlerinin yazılması (spec §28.4).

- **MAVI-F12 · FULL-DUPLEX BARGE-IN / KONUŞMA KONTROLÜ — KESME KARARI ARTIK
  KANITA BAĞLI (2026-08-29, kütük 🔴 #1022-#1026):**
  Durum: **ENTEGRE** (canlı hatta bağlı · hedefli testler yeşil · `npm run guard`
  804/804 · tsc temiz · değişen dosyalarda lint 0 hata · native değişiklik YOK) —
  **SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR.**

  **1) Önce ÖLÇÜM — gerçek duplex sınıfı `HALF_DUPLEX_INTERRUPT`.**
  Kod denetimi ses yolunun gerçeğini kanıtladı ve sınıf o kanıttan türetildi
  (`voice/duplexCapability`, SAF, hiçbir import):

  | Kanıt | Ölçülen | Kaynak |
  |-------|---------|--------|
  | TTS sırasında yakalama açık mı | **HAYIR** | `wakeMicMustYield()` → `nativeTtsSpeaking` iken wake thread mikrofonu HİÇ açmaz |
  | Aktif STT TTS ile örtüşür mü | **HAYIR** | `startListening()` İLK İŞ `ttsCancel()` çağırır — yapısal olarak imkânsız |
  | Duplex yolunda AEC var mı | **HAYIR** | `AcousticEchoCanceler` YALNIZ `runVoskListening`te; wake yolunda HİÇBİR efekt kurulmaz |
  | Echo referans sinyali bağlı mı | **HAYIR** | Repoda TTS çıkışını iptal ediciye veren kod YOK |
  | İptal zinciri hazır mı | **EVET** | `ttsCancel` + `cancelActiveResponseStream` + `_f3CloseSession` + tur supersede |

  → **`TRUE_FULL_DUPLEX` İLAN EDİLMEDİ.** Sahte duplex üretmek yerine spec §9.7'nin
  fail-soft maddesi uygulandı. Sınıf dört değerlidir
  (`TRUE_FULL_DUPLEX · AEC_GATED_DUPLEX · HALF_DUPLEX_INTERRUPT · UNSUPPORTED`)
  ve kanıt eksikken **yükselmez**.

  **2) Tek konuşma kontrolü — yeni otorite KURULMADI.**
  `assistant/maviBargeIn` yalnız **KESME ÖNERİSİ** değerlendirir ve bir HÜKÜM
  üretir; turu `maviTurn`, sesi `ttsService`, akışı `maviResponseStream` kapatır.
  Hakem `ttsCancel · startListening · beginMaviTurn · dispatchIntent` adlarının
  hiçbirini içermez (kaynak kilidi).

  **3) Ölçüm sırasında bulunan ve kapatılan ÜÇ gerçek açık:**

  | # | Açık | Kanıt | Kapatma |
  |---|------|-------|---------|
  | 1 | **Ölü otorite:** `supersedeActiveMaviTurn()` M5'te yazılmış, testlenmiş ama **üretimde HİÇ ÇAĞRILMIYORDU** → barge-in eski turun yetkisini ancak yeni komutla düşürüyordu; arada dönen geç sağlayıcı sonucu konuşabiliyordu | `grep` sonucu: yalnız testlerde | Kabul edilen kesme yetkiyi ANINDA düşürür |
  | 2 | **Sözleşme ↔ uygulama çelişkisi:** `continueIfTurnCurrent` dokümanı "devralınma susturulur" diyordu, uygulama yalnız kimlik eşitliğine bakıyordu | `maviTurn.ts:153` | Kapı artık kendi metnini uygular; `beginMaviTurn` yolunda davranış BİREBİR aynı |
  | 3 | **Self-echo deliği:** `vs.status !== 'idle'` kapısı yalnız kullanıcı turunu koruyordu; proaktif/navigasyon sözleri `idle`de seslendirilir ve **WebView ses yolları** `nativeTtsSpeaking` kurmadığı için wake thread mikrofonu açık tutar | `wakeWordService.onWakeWordDetected` + `edgeTtsService` HTMLAudio yolu | Wake tetiği artık hakemden geçer; kanıtsız tetik `SUPPRESSED_SELF_ECHO` ile düşer |

  **4) Sahte kesme yasakları (kilitli):** VAD/enerji **TEK BAŞINA ASLA** kabul
  edilmez · ölçülmemiş konuşma süresi "yeterli" sayılmaz · kısa spike reddedilir ·
  kesme sonrası eko kuyruğu debounce ile ikinci kez kesemez.

  **5) Öncelik PAZARLIKSIZ:** `ttsService` uçuştaki sözün KANALINI izler;
  `SAFETY · HAZARD · NAVIGATION` barge-in ile **kesilemez** — kullanıcının Mavi'yi
  kesebilmesi o kanalları susturma yetkisi DEĞİLDİR. İş yükü (F8) bu kararın
  girdisi değildir: hakem `maviWorkload` import etmez (kilit).

  **6) Gecikme DÜRÜST isimlendirildi:** ölçülen `TTS durdurma **İSTEĞİ**
  gecikmesi`dir — `TextToSpeech.stop()` bir isteği kuyruklar, hoparlörün sustuğu
  an JS'ten görülemez (F0'ın `requested`/`confirmed` ayrımıyla aynı sınır).
  Ölçüm yokken `-1` taşınır ve LAB **"ÖLÇÜM YOK"** yazar; sahte `0 ms` üretilmez.

  **7) LAB:** yeni ekran AÇILMADI — mevcut **Mavi Konsolu**'na
  *J · Barge-in ve Konuşma Kontrolü (F12)* bölümü eklendi (duplex sınıfı + üç
  kanıt · öneri/kabul · hüküm dağılımı · kanıt türü dağılımı · iki gecikme).
  LAB hüküm ÜRETMEZ, yalnız defteri okur (kilit).

  **F12'de yeniden bağlanan kilitler (kaldırma DEĞİL):**
  `maviDrivingWorkload` #45 penceresi `interruptAndListen` gövdesi uzadığı için
  fonksiyon sonuna kadar genişletildi (körleşmesin diye üst sınır yerine bir
  sonraki `export function`a bağlandı) · `carosLabMaviConsole` bölüm sayısı
  9 → 10 · fail-soft kilidine F12 kaynağı da mock'landı ·
  `companionConversationLoop` TTS taklidi yeni sözleşmeyi (`isTtsSpeaking` +
  kanal) yansıtacak şekilde güncellendi ve **yeni bir kilit eklendi**: korunan
  ses çalarken kesme mikrofonu AÇMAZ.

  **AÇIK BORÇLAR (dürüstçe):**
  1. **Gerçek akustik barge-in YOK.** `TRUE_FULL_DUPLEX` için `CarLauncherPlugin`de
     duplex yakalama döngüsü + AEC + referans sinyali gerekir; **yüksek riskli**
     ve masa başında doğrulanamaz → bu turda YAPILMADI, `wakeMicMustYield`
     yarım-duplex davranışı BİREBİR korundu (kilit). Hakem girişi (`setMaviDuplexEvidence`)
     hazırdır; kanıt gelince mimari değişiklik GEREKMEZ.
  2. Native `wakeWord` olayı **konuşma süresi ve güven taşımıyor** → duplex açılsa
     bile hakem `speechMs` olmadan kabul etmez; o alanları native'e taşımak
     F12 sonrası işidir.
  3. **ASR_PARTIAL kanıt türü tanımlı ama üretimde beslenmiyor** — F3 kısmi
     transkript oturumu TTS sırasında zaten açılmıyor (yarım-duplex). Sahte
     besleme EKLENMEDİ.
  4. **Telefon çağrısı sinyali hâlâ YOK** (F8'den devralınan borç): `DuckReason
     'PHONE'` tanımlı ama üretimde çağıran yok → korunan kanal sınıflandırması
     telefon için TTS kanalından türetilemiyor. Sahte alan eklenmedi.
  5. `HEAD_UNIT_MATRIX`e **cihaz bazlı AEC sonucu yazılamadı** — ölçüm yok.

  **Sonraki atomik PR:** (F13 TAMAMLANDI — yukarı bakın; kapanmadı, kütük #1031.) F12'nin native
  duplex borcu (#1026) F13'ün ÖNKOŞULU DEĞİLDİR; ayrı bir native turda ele alınır.

- **MAVI-F11 · UI DURUM MİMARİSİ v2 — AMBIENT MAVİ + WAKE/PRESENCE AYRIMI
  (2026-08-29, kütük 🔴 #1016-#1021):**
  Durum: **ENTEGRE** (canlı hatta bağlı · hedefli testler yeşil · `npm run guard`
  804/804 · tsc temiz · değişen dosyalarda lint 0 hata · native değişiklik YOK) —
  **SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR.**

  **Denetimde ölçülen dört kusur:**

  | # | Kusur | Kanıt |
  |---|-------|-------|
  | 1 | UI durum modeli **4 durum** (`idle·listening·processing·speaking`); `ambient·action·confirmation·proactive·deferred·degraded` YOK | `livingThemeState.ts:33` |
  | 2 | **Görsel "thinking" ihlali**: tam ekran yüzey `processing`te modelin iç işleyişini anlatıyordu; sürüş pilinde de süreç-anlatan etiket | `VoiceAssistant.tsx` (F2 sesli kanalı temizlemiş, görsel kanal ATLANMIŞ) |
  | 3 | Tam ekran overlay `fixed inset-0` ile **navigasyon/müzik ekranını kapatıyordu** | spec §21.2 ihlali |
  | 4 | **F1 borcu iki yerde AYAKTA**: `companionEnabled && companionWakeWordEnabled` + wake ayarının TAMAMI presence bloğunun içinde render ediliyordu | `wakeWordService.ts:929` · `SettingsPage.tsx:437` |

  **Kanonik model:** `assistant/maviSurfaceState` — 11 bounded durum
  (`IDLE · AMBIENT · LISTENING · UNDERSTANDING · SPEAKING · ACTION ·
  CONFIRMATION · PROACTIVE · DEFERRED · DEGRADED · ERROR`) + bounded geçiş
  sebebi + bounded yetenek kaybı sınıfı. Öncelik sırası: hata → onay → canlı tur
  → süren iş → proaktif → erteleme → yetenek kaybı → ambient → idle.

  **UI OTORİTE DEĞİLDİR (yapısal kilit):** model I/O·timer·`Date.now`·store·React
  İÇERMEZ; eylem yürütmez, gerçek üretmez, capability kaydına dokunmaz; kanonik
  otoriteler (`maviActionAuthority` · `assistantSafetyKernel` · `maviWorkload` ·
  `maviMemory` · `capabilityFabric`) bu modülü **okumaz** (ters yön kilitli).

  **"Thinking" gösterilmez (F2/I7):** koruma yoruma değil KODA bağlandı —
  `MAVI_FORBIDDEN_LABEL_STEMS` (düşün · bakıyor · kontrol ediyor · analiz ·
  yorumluyor · hesaplıyor · muhakeme · akıl yürüt …) hem durum hem yetenek-kaybı
  etiketlerinde taranır; ayrıca kilit üretim dosyasının **ham kaynağını** tarar →
  metnin yorum içinde bile yeniden belirmesi kilidi düşürür. `UNDERSTANDING`
  nötr bir **ALINDI bildirimidir** ("Seni duydum"), düşünme göstergesi değil.

  **Sürüş / park yüzeyi:** `COMPACT` ⟺ iş yükü ELEVATED+ **VEYA** doğrulanmış
  hareket **VEYA** hareket BİLİNMİYOR (`unknown` park sayılmaz — fail-safe).
  `EXPANDED` yalnız doğrulanmış duruş + düşük iş yükü. **Tam ekran yalnız
  `EXPANDED`**; sürüşte overlay alt şeride iner, karartma ve tıklama-yakalayıcı
  devre dışı kalır → **navigasyon/müzik görünür ve dokunulabilir kalır.**
  Sürüşte dokunma hedefi tabanı 76 px (park 56 px). **İş yükü yüzeyi daraltır
  ama capability KAPATMAZ** (F8 sınırı korundu, kilitli).

  **F1 borcu KAPATILDI — yeni invaryant:** wake ayarı presence'tan bağımsızdır.
  Yol Arkadaşı OFF + Wake ON → wake **çalışır**; Yol Arkadaşı ON + Wake OFF →
  wake **dinlemez**. Ayar sayfasında wake kendi bölümüne alındı → presence
  kapatılınca ayar **kaybolmuyor** (erişilemeyen gizli durum ortadan kalktı).
  `_wakeKey`den `companionEnabled` çıkarıldı (presence değişimi wake'i gereksiz
  yere yeniden kurmaz). **Ayar anahtarları değişmedi — migration yapılmadı.**

  **Onay / gözlem dürüstlüğü (F5/F6/F7):** bounded etiket tablosu —
  `REQUESTED` *gönderildi* · **`ACCEPTED` *iletildi — doğrulanmadı*** ·
  `EXECUTED` *yapıldı* · `OBSERVED` *doğrulandı* · `FAILED` *başarısız* ·
  `UNKNOWN` *sonuç bilinmiyor* · `CANCELLED` *iptal edildi*.
  `observationCountsAsDone()` yalnız `OBSERVED` için `true`. Otomatik kapanma
  kilidi **genişletildi**: `followUp`a ek olarak `CONFIRMATION` ve `ACTION` da
  kapanmayı engeller; dar hâl (`voiceOverlayShouldAutoClose`) **aynen korundu**
  ve testi değişmeden yeşildir.

  **Degraded yalan söylemez:** her sınıf **ayakta kalanı** söyler
  (*"Çevrimdışı — yerel komutlar çalışıyor"*). *"AI çalışmıyor"* gibi genelleme
  yasaktır ve kilitlidir. Rozet duruma **dik** eksendir (dinleme sırasında da
  görünür) ve hiçbir yeteneği kapatmaz.

  **Proaktif / erteleme:** yüzey bu kararları **yeniden üretmez** — `PROACTIVE`
  yalnız F9'un salt-okunur `isProactiveDeliveryInFlight()` sorgusundan,
  `DEFERRED` yalnız F8'in `peekDeferredResponse()` otoritesinden gelir; bayatlık
  kararı orada verilir → **bayat öneri yüzeyde gösterilemez** ve `DEFERRED`
  hiçbir koşulda "tamamlandı" gibi yazılmaz.

  **Gözlemlenebilirlik:** yeni LAB ekranı **açılmadı**; mevcut **CAROS LAB → AI
  → Mavi Konsolu** ekranına *I · Kullanıcıya Görünen Durum (F11)* bölümü eklendi
  (son durum + sebep · durum dağılımı · yüzey kipi · engellenen tam ekran ·
  yetenek kaybı · wake/presence bağımsızlığı). Etiket metni, cevap içeriği ve
  transkript **taşınmaz**.

  **Açık borçlar (açıkça beyan edilir):**
  1. `PROVIDER_COOLDOWN` · `STT_FALLBACK` · `TTS_FALLBACK` sınıfları modelde
     tanımlı ama **canlı köprüde üretilmiyor** (bugün yalnız `OFFLINE` ve
     `CLOUD_UNAVAILABLE` besleniyor) — sahte sınıf üretilmedi.
  2. `ACTION` durumu semantik ACK bayrağından türetilir; **F6 plan
     yürütücüsünün adım ilerlemesi** yüzeye bağlanmadı.
  3. `CONFIRMATION` durumu var ama **onay kartı bileşeni** (parametre tekrarı)
     bu turda yazılmadı — mevcut onay akışı sesle sürüyor.
  4. Tema ekseni **4 durumda kaldı** (spec 10 diyordu). Gerekçe: tüm temalarda
     görsel regresyon riski. İkinci gerçek kurulmadığı için borç sınırlıdır —
     `deriveCompanionStatus` artık kanonik türetmeden **daraltılır**.
  5. `VoiceAssistant` → `MaviSurface` **yeniden adlandırılmadı** (spec F11 öyle
     diyordu); ad değişimi dört layout'ta çağrı yeri değişimi demekti ve F11'in
     davranış hedefine katkısı yoktu.
  6. **Ambient (`AMBIENT`) durumu için görsel bileşen yazılmadı** — durum
     üretiliyor ve LAB'da görünüyor, ama wake dinlerken ekranda kalıcı bir
     "küçük nabız" göstergesi henüz yok.

  **F11'de güncellenen kilitler (kaldırma DEĞİL):** `carosLabMaviConsole` bölüm
  sayısı 8 → 9 (I bölümü) ve I bölümünün kaynağı fırlatma testine eklendi;
  `livingThemeState` testleri **değişmeden** yeşildir (tema ekseni davranışı
  birebir korundu).

  **Saha durumu:** `UNKNOWN / DEVICE VALIDATION REQUIRED` — görsel dikkat yükü,
  dokunma davranışı, wake'in gerçek akustik çalışması, overlay çakışmaları ve
  gece/gündüz okunabilirlik **masa başında ölçülemez** (kütük #1016-#1021).

- **MAVI-F10 · HAFIZA v2 — TURN / TRIP / LONG_TERM + EXPLICIT↔INFERRED
  (2026-08-29, kütük 🔴 #1009-#1015):**
  Durum: **ENTEGRE** (canlı hatta bağlı · hedefli testler yeşil · `npm run guard`
  804/804 · tsc temiz · değişen dosyalarda lint 0 hata · native değişiklik YOK) —
  **SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR.**

  **Denetimde ölçülen beş paralel hafıza yığını** (hiçbiri diğerini bilmiyordu):

  | # | Yığın | Kapsam | Kalıcılık | Ölçülen durum |
  |---|-------|--------|-----------|----------------|
  | 1 | `companionChatProvider._history` | 8 tur HAM transkript | RAM | CANLI — her prompt'a doğrudan gömülüyor |
  | 2 | `companionMemory` (`companion_memory_v1`) | 15 × 120 karakter açık fact | `safeStorage` | CANLI — **kapısız** |
  | 3 | `ai/memory/*` (`memoryEngine`) | görev politikalı, kapılı motor | DI | **ÖLÜ** — üç kapı arkasında |
  | 4 | `aiCore/vehicleMemory` | araç-teknik, fingerprint anahtarlı | `safeStorage` | CANLI — **ayrı gizlilik sınıfı** |
  | 5 | `maviCore/contextStore` | son eylem/ekran + tur halkası | RAM | **GÖLGE** — üretimde çağıranı yok |

  **Kapatılan üç gerçek kusur:**
  1. **Gizlilik kapısı canlı yolda HİÇ YOKMUŞ.** `sensitiveMemoryGuard` yazılı ve
     testliydi ama yalnız bayrağı KAPALI motorun üzerindeydi. `REMEMBER` →
     `addFact()` sadece `trim` + 120 karakter kırpma yapıyordu; okuma yolu
     (`buildMemoryPromptSection`) da kapısızdı. Yani *"beni 0532 … diye
     kaydet"* kalıcı depoya **ve her prompt'a** giriyordu.
  2. **Canlı hafıza bloğunda *"VERİdir, TALİMAT DEĞİLDİR"* etiketi yoktu**
     (etiket de yalnız ölü motorda).
  3. **"Unut" gerçekten unutturmuyordu.** `forgetFact` yalnız kalıcı listeden
     siliyordu; aynı bilgi `_history` içinde kalıp **8 tur daha** modele
     gidiyordu.

  **Kanonik model (tek cephe, altıncı yığın YOK):** `assistant/maviMemory`
  mevcut otoritelerin ÜSTÜNDE tek giriş/çıkış kapısıdır. Kayıt bounded ve tam:
  `id · scope · kind · domain · origin · source · provenance · value ·
  confidence · evidenceCount · createdAt · lastConfirmedAt · decayHalfLife ·
  expiresAt · correction · privacyClass · schemaVersion · tripKey`.
  **conversation text ≠ fact ≠ preference ≠ learned pattern** — dördü ayrı
  taşınır, tek listede tutulmaz. Eski `companion_memory_v1` **bir kez** (kapı
  uygulanarak) içe aktarıldı; sonrasında üretim okuma yolunda bir daha okunmaz.

  **Üç kapsam:**

  | Kapsam | Ömür | Kalıcılık | Sınır |
  |--------|------|-----------|-------|
  | `TURN` | tur | RAM | sahibi `companionChatProvider`; cephe KOPYA tutmaz, yalnız TEMİZLEME portu |
  | `TRIP` | yolculuk | **YALNIZ RAM** | 40 kayıt · yolculuk anahtarlı · yeni yolculuk eskisini DEVRALMAZ |
  | `LONG_TERM` | kalıcı | `mavi_memory_v2` | EXPLICIT 15 + INFERRED 15, **ayrı listeler** |

  **Yolculuk kimliği UYDURULMADI:** ölçüm gösterdi ki `tripLogService`'te aktif
  yolculuğun kimliği yoktur (`generateTripId()` yalnız yolculuk biterken
  çağrılır). Kapsam anahtarı mevcut ve gerçek bir olgudan türetildi:
  `trip:{ActiveTrip.startTime}`. Kaynak bağlı değilse ya da aktif yolculuk yoksa
  anahtar `null`dur ve TRIP hafızası yazmaz/okumaz.

  **EXPLICIT ↔ INFERRED (pazarlıksız):** beyan güven 1 ve **DECAY YOK** (yalnız
  düzeltilebilir); çıkarım güveni kanıttan türetir (`n/(n+2)`, tavan 0.9 —
  zero-trust), **en az 3 kanıt** olmadan prompt bloğuna giremez, 14 günlük
  yarı-ömürle zayıflar, 0.35 altında düşer. Projeksiyonda beyan çıkarımdan önce
  sıralanır ve blokta ayrı etiketlenir.

  **Düzeltme ve çelişki:** düzeltme **kör silmez** — güven sıfırlanır, kayıt
  `CORRECTED` işaretlenir, projeksiyondan düşer ve aynı ifade **30 gün** çıkarımla
  yeniden üretilemez; açık beyan bu mührü kaldırır (fikir değiştirme hakkı).
  Çelişen iki açık beyan **ikisi de durur**: eski `CONTRADICTED` işaretlenir,
  blokta `ÇELİŞKİLİ` görünür ve Mavi *"hangisi geçerli?"* diye **sorar**,
  kendisi seçmez.

  **Prompt izdüşümü:** her turda tüm hafıza dökülmez — kullanıcının o turdaki
  metninden bounded bir ALAN çıkarılır (`navigation · media · vehicle ·
  personal · general`) ve yalnız o alan + alanı bilinmeyen kayıtlar taşınır;
  üstüne 6 kayıt / 600 karakter tavanı uygulanır. Her satır kökenini, kapsamını,
  güvenini ve çelişki durumunu taşır.

  **Kalıcılaştırma dürüstlüğü:** `safeStorage.safeSetRaw` `void` döner ve kota
  hatasını kendi içinde yutar — "yazdım" iddiası tek başına hiçbir şey
  kanıtlamaz. F10 yazımı `immediate` yapar ve **geri okuyup karşılaştırır**;
  doğrulanmazsa *"hatırladım"* denmez. **Dürüst sınır:** bu doğrulama web
  yolunda gerçek bir dayanıklılık kanıtıdır; NATIVE yolda `safeSetRaw` dosya
  yazımından önce `_fsCache`e koyduğu için geri okuma önbellekten döner →
  orada kanıt zayıftır (gizlenmiyor).

  **Gözlemlenebilirlik:** yeni LAB ekranı **açılmadı**; mevcut **CAROS LAB → AI
  → Bellek Gezgini** yedi bounded satırla genişletildi (uzun dönem kayıt ·
  öğrenme kaynağı · düzeltme/çelişki · unutma · kalıcılaştırma · gizlilik
  kapısı · prompt izdüşümü + yolculuk hafızası). Metin, uzunluk, özet ve hash
  **hiçbiri** taşınmaz.

  **Açık borçlar (açıkça beyan edilir):**
  1. **Çıkarım ÜRETİCİSİ yok.** `observeInferred` portu açık ama üretimde
     çağıranı yok: repoda bir tercihi davranıştan çıkaracak güvenilir ve
     gizlilik-temiz bir üretim sinyali ölçülemedi. Olmayan sinyalden öğrenme
     uydurulmadı; LAB *"BAĞLI DEĞİL — çıkarım üretilmiyor"* der.
  2. **Koşullu tercih (bağlam) modellenmedi.** *"işe giderken hızlı rota"*
     gibi koşul, iki kaydı uzlaştırmak için kullanılmaz; çelişki yalnız
     **görünür kılınır**.
  3. **Yolculuk sonu ÖZETİ uzun döneme taşınmıyor** (spec §14.4 "yalnız
     izinle"). İzin yüzeyi yok → sessiz kalıcılaştırma yasak olduğu için taşıma
     da yapılmadı.
  4. **`maviCore/contextStore` hâlâ gölge** — F10 onu canlandırmadı ve
     kullanmadı; ölü paralel yığın olarak kayıtlıdır.
  5. **`ai/memory/memoryEngine` bayrağı AÇILMADI.** Spec F10 "bayrak açılır"
     diyordu; kanonik okuma katmanı olarak `maviMemory` seçildi ve `memoryEngine`
     onu okuyacak biçimde yeniden bağlandı (tek gerçeklik), ama üç kapılı bayrak
     zinciri bilinçli olarak dokunulmadan bırakıldı — açmak, gateway yolunu da
     üretime sokan ayrı bir karardır.
  6. **NATIVE yolda kalıcılaştırma doğrulaması zayıf** (yukarıda).

  **F10'da yeniden bağlanan iki kilit (kaldırma DEĞİL):**
  `maviMemoryEngine.test` #"companionMemory SALT-OKUNUR" ve `maviMemoryWiring.test`
  #"kullanıcı tercihleri mevcut otoriteden okunur" kilitleri `getFacts` adını
  arıyordu. F10 gerçeklik kaynağını cepheye taşıdığı için bu kilitler ya kırmızı
  kalır ya da eski adı geri koymaya zorlardı — ikisi de iki-gerçeklik kusurunu
  geri getirirdi. Kilitler aynı invaryantı (**salt-okunurluk + tek otorite**)
  koruyacak biçimde yeni tek-kaynağa bağlandı ve üstüne *"beyan ile çıkarım ayrı
  etiketle taşınır"* şartı EKLENDİ.

  **Saha durumu:** `UNKNOWN / DEVICE VALIDATION REQUIRED` — gerçek araç ve
  gerçek uzun yol oturumu ölçümü yapılmadı; yolculuk sürekliliği ve öğrenilmiş
  tercih davranışı masa başında "doğrulandı" sayılmaz (kütük #1009-#1015).

- **MAVI-F9 · PROACTIVE POLICY ENGINE — PROAKTİF KONUŞMA İZNİNİN TEK KAPISI
  (2026-08-29, kütük 🔴 #1003-#1008):**
  Durum: **ENTEGRE** (canlı hatta bağlı · hedefli testler yeşil · `npm run guard`
  804/804 · tsc temiz · değişen dosyalarda lint 0 hata · native değişiklik YOK) —
  **SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR.**

  **Kapatılan kusur (G9):** proaktiflik hem üretiliyor hem karara bağlanıyordu ve
  ikisi de `companionEngine.tick()` içindeydi — sekiz tetik, sabit bir `if/return`
  merdiveni, tetik başına modül-içi cooldown değişkeni. Dört sonucu ölçüldü:
  (1) dışarıdan kaynak **bağlanamıyordu** (tek yol dokuzuncu bir `if`);
  (2) **global sesli proaktif tavanı yoktu** — bağımsız beş güvenlik tetiği aynı
  yarım saatte sırayla konuşabilirdi; (3) kullanıcı bir öneriyi kaç kez keserse
  kessin **öğrenme yoktu**; (4) *"neden konuşmadı?"* sorusunun kanıtı kaynağı
  okumaktan başka hiçbir yerde yoktu.

  **Yeni akış:** kaynak **teklif** verir → motor **karar** verir → çağıran
  seslendirir. `companionEngine` motor olmaktan çıkıp **teklif üreticisine**
  indirgendi; cooldown ve sıklık defteri tek sahibe (`proactivePolicyEngine`)
  taşındı — companionEngine'de paralel zaman defteri **kalmadı** (kaynak kilidi).

  **Sınıf tablosu tek otoritedir** (`PROACTIVE_CLASS_RULES`; sınıf bir etiket
  değil **yetki seviyesidir**):

  | kind | iş yükü tavanı | presence | saatlik tavan | öğrenmeyle susturulabilir |
  |------|----------------|----------|---------------|---------------------------|
  | `safety` | **CRITICAL** (hiç kapanmaz) | gerekmez | **hayır** | **HAYIR** |
  | `operational` | HIGH | gerekmez | evet | evet |
  | `informational` | ELEVATED | gerekir | evet | evet |
  | `social` | NORMAL | gerekir | evet | evet |

  `social` tavanının NORMAL olması, F8'in `allowProactiveChatter` kapısının
  **birebir sınıf karşılığıdır** (ELEVATED ve üstünde sohbet susar). Beş güvenlik
  tetiği (yakıt menzili · kapı/bagaj · lastik basıncı · kötü havada far · uyku
  önleme) `safety` olarak beyan edilir ve bütçe/presence/tavan/öğrenme
  yollarının **hiçbiri** onları düşüremez.

  **Spam'in üç katmanlı yapısal freni:** (1) cooldown — mevcut değerler aynen
  taşındı (15/3/30/25/25/45 dk); (2) sıklık bütçesi — chattiness aralığı
  (az 45 · normal 20 · sık 10 dk), `az` bütçeli teklifleri tamamen kapatır;
  (3) **saatlik tavan (YENİ)** — son 1 saatte en fazla **6** güvenlik dışı sesli
  proaktif; değer keyfî değil, bugünkü en gevezelik ayarından türetildi (sık =
  10 dk → saatte en çok 6), yani **mevcut davranışı kısıtlamaz**. Ayrıca **tek
  konu kuralı**: aynı tick içinde en yüksek skorlu tek teklif konuşur, kalanı
  `not_top` ile düşer — **kuyruk yok**, bayat öneri yapısal olarak imkânsız.

  **Öğrenme dürüsttür, kabul UYDURULMADI:** üretimde *"kullanıcı bu öneriyi
  kabul etti"* diyen **hiçbir sinyal yok** (proaktif cümleler beyandır, takip
  dinlemesi açmaz; `_isConversationEnd` yalnız açık sohbet oturumunda çalışır).
  Gözlenebilen tek şey **kesinti**dir: kullanıcı uçuştaki proaktif konuşma
  sırasında mikrofonu açar ya da oturumu durdurur. Bu *"ret"* değil *"kesinti"*
  olarak kaydedilir: skoru kademeli düşürür (1.00 → 0.75 → 0.50 → 0.25) ve
  eşikte (3 kesinti / 2 saatlik decay) kaynağı **geçici** olarak (6 saat)
  susturur — kalıcı değil, `safety` ise **asla**. LAB'daki `kabul oranı` satırı
  bu yüzden sayı göstermez: **`ÖLÇÜLEMİYOR — kabul sinyali YOK`**
  (`acceptRateMeasurable: false` tip düzeyinde beyan edilir; `acceptRate` diye
  bir alan hiç tanımlanmamıştır).

  **Otorite sınırı:** motor **seslendirmez** (ikinci TTS kanalı açmaz),
  **metin üretmez** (şablon teklif sahibinindir, LLM'e gitmez), **eylem
  yürütmez**, güvenlik eşiği **yeniden hesaplamaz**. Karar çekirdeği saftır
  (`Date.now` · timer · store · React yok; **tek import type-only**) ve
  `commandExecutor` · `maviActionAuthority` · `assistantSafetyKernel` ·
  `capabilityFabric` · `ttsService` bu motoru **okumaz** (ters yön kilitli).
  Kritik arıza hattı motorun **kapısından geçmez** — kendi kanonik güvenlik
  kapısı vardır; oraya yalnız **gözlem** yazılır (`noteExternalProactiveSpoken`),
  böylece LAB tablosu eksik/yalan kalmaz ama ikinci bir susturma otoritesi
  kurulmaz.

  **Gözlemlenebilirlik:** yeni LAB ekranı **açılmadı**; mevcut **CAROS LAB → AI
  → Mavi Konsolu** ekranına *H · Proaktif Konuşma Politikası (F9)* bölümü
  eklendi: karar/kabul adedi · saatlik tavan kullanımı · **düşme gerekçeleri**
  (14 bounded kod — *"neden konuşmadı?"* sorusunun kanıtı) · kaynak bazlı
  konuşma · sınıf dağılımı · kesinti/öğrenme · son karar. Bölüm salt-okunur
  (susturma/geri açma API'leri okuma katmanında **geçmez** — kilitli) ve
  gizlilik yapısaldır: seslendirilen metin motorda **hiç saklanmaz**, kaynak
  kimlikleri kodda sabittir ve okuma katmanı ayrıca `[a-z0-9._-]`/48 karakter
  süzgeci uygular.

  **Açık borçlar (açıkça beyan edilir):**
  1. **Yeni proaktif kaynak eklenmedi.** F9 portu açtı; navigation/vehicle/fleet
     için **konuşan** adaptör yazılmadı — yeni proaktif ses, sıfır saha kanıtıyla
     yeni ürün davranışı demekti.
  2. **Görsel proaktif kanal yok.** Spec §17.4 presence kapalıyken
     `informational` için görsel kanal öngörür; üretimde yoktur → `deliver:
     'visual'` teklifi sessizce sesli kanala kaydırılmaz, `no_visual_channel`
     ile dürüstçe düşer ve sayılır.
  3. **Mola önerisi `social` kaldı.** `informational`a yükseltmek onu ELEVATED
     iş yükünde de konuştururdu — bu bir davranış değişikliğidir ve F9'un
     *"mevcut tetik davranışı aynen geçmeli"* kısıtını ihlal ederdi.
  4. **`companionEnabled` kapalıyken companionEngine'in tamamı hâlâ susuyor**
     (motorun kendi şalteri). Sistem düzeyinde güvenlik uyarıları presence'tan
     bağımsız çalışmaya devam ediyor (`SystemOrchestrator` ve kritik arıza hattı
     `companionEnabled` okumaz), ama bu beş tetik susuyor — F9'da bilinçli
     olarak değiştirilmedi.
  5. **Açık susturma talebinin ("bunu bir daha söyleme") üretimde çağıranı yok**
     — ayar/intent yüzeyi F9 kapsamında açılmadı.
  6. **Kesinti sinyalinin yoğunluğu ölçülmedi:** sahada bu yolun kaç kez
     gerçekten tetiklendiği bilinmiyor; sinyal seyrekse öğrenme fiilen çalışmaz.

  **Yol boyu bulunan ve kapatılan F8 borcu:** `carosLabMaviConsole.test.tsx`
  Mavi Konsolu bölüm sayısını hâlâ **6** sayıyordu; F8'in G bölümü eklendiğinde
  güncellenmemişti ve test **üç noktada kırmızıydı** (F9 öncesi de kırmızıydı —
  `git show HEAD` ile doğrulandı). Sayı 8'e taşındı, G/H kaynaklarının fırlatma
  davranışı da kilide eklendi.

  **F8 kilidinin yeniden bağlanması (kaldırma DEĞİL):** `maviDrivingWorkload`
  testi #36, `companionEngine.ts` içindeki beş cooldown değişkeninin
  `allowProactiveChatter` kapısından ÖNCE geçtiğini kaynak metin sırasıyla
  doğruluyordu. F9 o değişkenleri motora taşıdığı için `indexOf` her biri için
  `-1` dönerdi ve `-1 < gate` **daima doğru** olurdu → kilit sessizce boş kümeye
  düşer ve hiçbir şeyi korumazdı (*"kör guard = düşen guard"*). Kilit, aynı
  invaryantı daha güçlü kilitleyecek biçimde yeni tek-kaynağa bağlandı: sınıf
  tablosu + tetiklerin `safety`/`social` beyanı.

  **Saha durumu:** `UNKNOWN / DEVICE VALIDATION REQUIRED` — gerçek araç ölçümü
  yapılmadı; saatlik tavan (6) ve 3-kesinti eşiği masa başında "doğrulandı"
  sayılmaz (kütük #1003-#1008).

- **MAVI-F8 · DRIVING WORKLOAD AWARENESS — AYNI MAVİ, BAĞLAMA UYGUN İLETİŞİM
  YOĞUNLUĞU (2026-08-29, kütük 🔴 #997-#1002):**
  Durum: **ENTEGRE** (canlı hatta bağlı · hedefli testler yeşil · `npm run guard`
  804/804 · tsc temiz · değişen dosyalarda lint 0 hata · native değişiklik YOK) —
  **SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR.**

  **Kapatılan kusur:** Mavi'nin konuşma yoğunluğunu belirleyen tek sinyal
  `isDriving` boolean'ıydı — ya ≤8 kelime ya sınırsız. F8 bunu bounded bir durum
  modeline çevirdi: `LOW · NORMAL · ELEVATED · HIGH · CRITICAL · UNKNOWN`.

  **Sinyal → kanıt matrisi (ölçüldü, uydurulmadı):**

  | Sinyal | Kaynak | Tazelik | Güvenilirlik | Mevcut otorite |
  |--------|--------|---------|--------------|----------------|
  | Hareket / hız | `maviVehicleContext` üç durumlu hüküm | OBD `obdFreshWindowMs` · GPS `GPS_STALE_MS` | Kanıta dayalı; `unknown` ≠ duruyor | `maviVehicleContext` |
  | Rehberlik | `navigationService.isGuidanceActive` | store | Yalnız ACTIVE/REROUTING (önizleme değil) | `navigationService` |
  | Manevra yakınlığı | `routingService.distanceToNextTurnMeters` + `distanceToNextTurnSource` | rota tick'i | `ALONG_ROUTE` güvenilir · `STRAIGHT_LINE` kısa çıkar (güvenli yön) · `UNKNOWN` **kanıt değil** | `routingService` |
  | Geri vites | `useSystemStore.isReverseActive` | anlık | Pozitif sinyal | `SystemOrchestrator` |
  | Kritik güvenlik | `assistantSafetyKernel.evaluatePreGate` | tek-atım OBD/DTC | Yorumlanmış karar | `assistantSafetyKernel` |
  | Bilişsel mod | `useCognitiveStore` (`CognitivePriorityEngine`) | 1 sn poll + histerezis | Termal + DAB + risk | `CognitivePriorityEngine` |
  | Sürücünün konuşması | `voiceService` oturum/`followUp` durumu | anlık | Gerçek | `voiceService` |
  | **Telefon görüşmesi** | **YOK** | — | — | — |
  | **Audio focus / duck** | `getActiveDuckReasons()` var ama **üretimde hiç dolmuyor** | — | Kanıt olarak kullanılmadı | `CarosAudioFocusManager` |
  | **`driverAttentionBudget`** | `hazardService` — **yalnız aktif tehlike varken güncelleniyor** | tehlike yoksa bayat | Genel iş yükü sinyali DEĞİL | `hazardService` |

  **Cevap bütçesi:** LOW/NORMAL → tam sohbet + takip dinlemesi · ELEVATED →
  ≤24 kelime, takip ve güvenlik-dışı proaktiflik kapalı · HIGH → ≤8 kelime,
  akış açılmaz · CRITICAL → yalnız gerekli iletişim, serbest sohbet ertelenir.
  **`UNKNOWN` NORMAL bütçesini alır** (bilinçli): iletişim politikası bir
  güvenlik otoritesi değildir ve `unknown`da susmak, OBD'siz head unit'lerde
  asistanı sıfır güvenlik kazancıyla sakat bırakırdı — gerçek fail-closed
  davranış zaten eylem kapılarındadır. `UNKNOWN` yine de **LOW olduğunu iddia
  etmez** ve ayrı ölçülür.

  **Otorite sınırı:** workload aracı kontrol etmez, navigasyon kararını
  değiştirmez, capability kapatmaz, açık komutu reddetmez. Yalnız **tavan**
  koyar ve hiçbir kısıtı **gevşetmez** — ISO 15008 sürüş kısıtı yerinde kalır,
  iki tavandan küçük olan kazanır. Saf çözümleyici **hiçbir modül import etmez**
  (kilitli); yürütücü/kapı hatları da workload'u okumaz (ters yön kilitli).

  **Presence ≠ workload (F1 korundu):** Yol Arkadaşı ON + HIGH → yetenekler
  açık, gereksiz sohbet kapalı. Companion OFF + LOW → tam yetenekli asistan.
  Workload katmanı `companionEnabled`e hiç bakmaz (kaynak kilidi).

  **Güvenlik önceliği değişmedi:** `speakSafetyAlert`, proaktif kritik arıza
  hattı ve `speakNavigation` bu bütçeden **geçmez**; duck öncelikleri
  (EMERGENCY · SAFETY · PHONE · NAVIGATION) **aynen** korundu.

  **Gerçek zamanlı değişim:** akış cevabı sürerken iş yükü yükselirse yeni parça
  alınmaz ve kuyruktaki parça **doğal olarak bitirilir** — kelime ortasından
  kesme, audio otoritesi bozma ve sahte tamamlanma yok; kesme bounded sayaca
  yazılır.

  **Erteleme (F2 korundu):** `CRITICAL`da serbest sohbet **durum olarak**
  ertelenir; "şimdi yola odaklan" gibi kalıp cümle üretilmez (kaynak kilidi).
  Erteleme 60 sn TTL ile düşer, yeni tur/barge-in onu temizler ve
  **kendiliğinden tekrar oynatılmaz** (`DEFERRED ≠ COMPLETED`).

  **Gözlemlenebilirlik:** yeni LAB ekranı **açılmadı**; mevcut **CAROS LAB → AI
  → Mavi Konsolu** ekranına *G · Sürüş İş Yükü ve Konuşma Bütçesi* bölümü
  eklendi (canlı kaynak · son seviye · seviye dağılımı · kanıt dağılımı ·
  kısaltma/erteleme · susturulan sohbet). Ölçüm yokken "LOW" değil **"Ölçüm
  yok"** yazılır. Telemetri yeni sistem kurmadı: F0 izine 5 bounded alan eklendi
  ve ham sürüş verisi ize **girmez**.

  **Açık borçlar:** telefon görüşmesi sinyali repoda **yok** (uydurulmadı);
  `driverAttentionBudget` yalnız aktif tehlike varken güncellendiği için genel
  iş yükü sinyali sayılmadı; audio-focus duck kanalı üretimde hiç dolmadığı için
  kanıt olarak kullanılmadı; eşikler (200 m · 70 km/h) mevcut sabitlerin aynası
  olsa da **iletişim politikası için sahada hiç ölçülmedi**.

  **Saha durumu:** `UNKNOWN / DEVICE VALIDATION REQUIRED` — gerçek araç ölçümü
  yapılmadı; eşikler masa başında "doğrulandı" sayılmaz (kütük #997-#1002).

- **MAVI-F7 · UNIVERSAL OBSERVATION / OUTCOME TRUTH — "GÖNDERDİM" İLE "OLDU"
  ARTIK AYNI CÜMLE DEĞİL (2026-08-29, kütük 🔴 #991-#996):**
  Durum: **ENTEGRE** (canlı hatta bağlı · hedefli testler yeşil · `npm run guard`
  804/804 · tsc temiz · değişen dosyalarda lint 0 hata · native değişiklik YOK) —
  **SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR.**

  **Kapatılan kusur:** F5 dürüstlük TAVANINI (`observationCeiling`) kurmuştu ama
  tavanın ALTINI dolduracak gerçek kanıt yoktu — yürütücü ne dediyse gözleme o
  yazılıyordu. F7 `PROPOSED ≠ REQUESTED ≠ ACCEPTED ≠ EXECUTED ≠ OBSERVED`
  sözleşmesini kodla zorlar: bağımsız alan kanıtı varsa **alan otoritesi kazanır**
  ve yürütücünün iyimser dönüşünü ezer; kanıt yoksa ya da bayatsa hiçbir seviye
  değişmez; zaman aşımı **asla** başarıya dönüşmez.

  **Alan → gözlem kaynağı matrisi (ölçülmüş, uydurulmamış):**

  | Alan | Bağımsız gerçeklik kaynağı | Ulaşılabilen en yüksek seviye | Not |
  |------|---------------------------|-------------------------------|-----|
  | Navigation | `destinationOwnershipModel` hedef sahiplik defteri | `EXECUTED` (**gecikmeli**) | Kanıt asenkron doğar → bekleyen gözlem; anlık tavan dürüstçe `ACCEPTED` bırakıldı |
  | Media (transport) | `playbackTruth` → `mediaCommandGateway.CommandTruth` | `OBSERVED` | Tek medya gerçeği; paralel "Mavi medya durumu" kurulmadı |
  | Media (arama/uygulama/ses) | **YOK** | `ACCEPTED` | Açık borç — sahte yükseltme yapılmadı |
  | Settings | Ayar deposundan **geri okuma** (`applySetting` port kanıtı) | `OBSERVED` | WiFi/BT native köprüsü kanıt döndürmez → `ACCEPTED` |
  | Phone | **YOK** (yalnız `bridge.callNumber` sonucu) | `ACCEPTED` | Arama başladıktan sonrası gözlenmiyor — açık borç |
  | Vehicle / Diagnostics | Gerçek okuma + `dtcAuthority` | `OBSERVED` | M4'te zaten kanıta bağlıydı; değiştirilmedi |
  | UI / Surface | **YOK** | `ACCEPTED` | Açılışı doğrulayan yüzey gerçeği yok — açık borç |

  **Kapanan sahte başarı yolları:** (1) `SET_SETTING` port bağlı olmasa bile
  koşulsuz *"Ayar uygulandı"* diyordu (F5'in açık borcu #986/b) → artık yalnız
  geri okunmuş kanıtla söylenir; (2) `PLAY_MEDIA`/`PAUSE_MEDIA` ateşle-unut olup
  koşulsuz *"Devam ediyor"/"Duraklatıldı"* diyordu → artık `playbackTruth`
  sonucunu bekler; (3) `navigateToPlace` portu yokken yalnız harita açılıp yine
  *"… adresine gidiyoruz"* deniyordu → artık *"Haritayı açtım; hedefi oradan
  seçmen gerekiyor"* denir.

  **Otorite sınırı:** gözlem katmanı **yürütme otoritesi değildir · güvenlik
  otoritesi değildir · ikinci gerçeklik kaynağı kurmaz.** Kaynak kilidiyle
  zorlanır: `dispatchIntent · executeIntent · startNavigation ·
  mediaCommandGateway · evaluateVehicleAction · createAiSafetyGate` adlarının
  hiçbiri üç yeni dosyada geçmez. Sözleşme katmanı saftır (yalnız TİP import
  eder); defter **timer/abonelik/`Date.now` kullanmaz** — süre dolumu tembel
  süpürmeyle yakalanır (sıfır sızıntı), kuyruk 8 kayıtla, pencere 20 sn ile
  sınırlıdır.

  **F6 ile ilişki:** plan adımlarının gözlemi zaten tek kanaldan geliyordu; F7 o
  kanala giren değeri uzlaştırılmış seviyeyle değiştirdi — **yeni kanal
  açılmadı**, `capabilityPlanRunner` değişmedi ve `ACCEPTED ≠ ALL_SUCCEEDED`
  invaryantı korundu. Bekleyen (gecikmeli) gözlem F6 yuvasına **yazmaz**.

  **Gözlemlenebilirlik:** yeni LAB ekranı **açılmadı** (ekran enflasyonu yasağı);
  mevcut **CAROS LAB → AI → Capability Fabric** ekranı üç satırla genişletildi:
  `Gözlem kaynağı` · `Dürüstlük düzeltmesi` (düşürme/yükseltme) · `Bekleyen
  gözlem`. Ölçüm yokken "0" değil **"ölçüm yok"** yazılır. Hedef adı · kişi adı ·
  parça adı · VIN · transkript · ayar değeri bu katmana **girmez** (kaynak kilidi).

  **Çelişki kaydı:** kütük #984'ün "ayar komutlarında hiç `EXECUTED`
  görünmeyecek" ölçütü F7 ile **geçersizdir** — o ölçüt kanıtın yokluğunu
  varsayıyordu, kanıt artık var. Yerine #992'nin ölçütü geçerlidir.

  **Açık borçlar:** phone/surface/`searchAndPlay` alanlarında bağımsız kaynak yok;
  yerel ayrıştırıcı yolunun (`commandParser.settingFeedback` → `routeIntent`)
  ayar geri bildirimi hâlâ yürütmeden önce üretilir ve kanıta bağlı değildir.

  **Saha durumu:** `UNKNOWN / DEVICE VALIDATION REQUIRED` — gerçek head unit
  ölçümü yapılmadı (kütük #991-#996).

- **MAVI-F6 · BİLEŞİK KOMUT + KANONİK ORKESTRASYON — MAVİ TEK CÜMLEDEKİ
  BİRDEN FAZLA İŞİ TEK PLAN ALTINDA YÖNETİYOR (2026-08-29, kütük 🔴 #987-#990):**
  Durum: **ENTEGRE** (canlı hatta bağlı · test yeşil · tsc temiz · lint 0 hata ·
  native değişiklik YOK) — **SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR.**

  **Kapatılan kusur:** bileşik komut **yalnız yerel ayrıştırıcı yolunda** vardı
  (`tryHandleChain` → bağlaç bölmesi → `dispatchChain`). Beyin (LLM) yolu tek
  intent üretiyordu: `parseBrainJson` tek `intent` alanı okuyor,
  `fromSemanticResult` tek `AppIntent` dönüyordu → "Eve rota aç, müziği kıs,
  annemi ara" cümlesinde **tek iş yapılıp diğerleri sessizce düşüyordu**.

  **Yeni hat:** beyin `{"type":"action","actions":[…]}` döndürebiliyor; adımlar
  tek tipli plan altında yönetiliyor. Zincir:
  `plan item → Capability Fabric (F5) → kanonik onay defteri → maviActionAuthority
  → AiSafetyGate → dispatchIntent → observation`.

  **Yeni yürütücü kurulmadı:** her adım mevcut `_aiHandlers` → `executeAIResult`
  → `dispatchIntent` hattından geçer. Plan katmanının üç dosyası `dispatchIntent`
  · `executeIntent` · `navigationService` · `mediaService` · `appLauncher` ·
  `obdService` · `evaluateVehicleAction` · `evaluateActionIdSafety` ·
  `createAiSafetyGate` adlarının **hiçbirini içermez** (kaynak kilidi) — yetki
  plan katmanında DOĞMAZ.

  **Plan modeli:** `planId · turnId · items[] · suppressed[] · resultClass ·
  refusalReason`; her adım `capabilityId · operation · parameters · dependencies ·
  order · confirmationRequirement · safetyClass · cancellable · reversible ·
  executionState · observationState · failureClass`. **PROPOSAL ≠ EXECUTION ≠
  OBSERVATION** üç ayrı alanda tutulur.

  **Onay:** adım bazlıdır. Tek onay adımı varsa güvenli adımlar akar, o adım
  `AWAITING_CONFIRMATION`ta bekler. **Birden fazla onay adımı varsa plan tümüyle
  reddedilir** — P1 `sequenceConfirmationPolicy` kararının aynısı (yeni politika
  icat edilmedi). Onay gerçeği **kanonik defterden** okunur; katalog alanı yalnız
  bilgidir ve çelişkide kanonik kazanır.

  **Dürüstlük:** sonuç gözlemlerden üç kovayla türetilir — `verified`
  (EXECUTED/OBSERVED) · `delivered` (ACCEPTED, doğrulanmadı) · kalanı.
  `ALL_SUCCEEDED` yalnız TÜM adımlar kanıtlıysa verilir. Birleşik cümlede fiil
  seçimi dürüstlük kararıdır: `ACCEPTED` için **"açtım" asla denmez**,
  "başlattım" denir. Metin parametre değeri taşımaz (kişi adı/adres sızmaz).

  **İptal:** başlamamış adımlar iptal edilir, uçuşta olup iptal edilemeyen adım
  dürüstçe raporlanır, **tamamlanmış adım "geri alındı" gösterilmez**. Her adım
  `reversible:false` — katalogda geri-alma sözleşmesi yok, **sahte rollback
  üretilmedi**.

  **Determinizm:** tekrar (`DUPLICATE`) ve çakışma (`CONFLICT_SUPERSEDED`,
  **LAST_WINS**) sabit politikayla elenir; elenen adım silinmez, gözlemde kalır.
  Yürütme **ardışıktır** (kilitli) — paralel yürütme audio focus, tek-onay slotu
  ve gözlem devrini aynı anda zorlar.

  **Streaming (F4) izolasyonu:** `actions[]` da `type:"action"`tır → çıkarıcı
  akışı `STRUCTURED`'a çeker ve **plan durumu, adım listesi, capability JSON'ı
  tek karakter bile konuşulmaz**. Plan başında `answer` slotu tutulduğu için adım
  başına gelen yürütücü geri bildirimleri susturulur ve sonda **tek** birleşik
  cümle söylenir (duplicate speech yok).

  **Telemetri:** F0 izine 7 bounded alan (`planItemCount · planDependencyCount ·
  planConfirmationCount · planExecutedCount · planFailedCount ·
  planCancelledCount · planResultClass`) + fabric tanısına plan sayaçları.
  Parametre değeri · adım metni · kişi · adres bu katmana girmez.
  LAB: AI → **Capability Fabric** → "Bileşik plan" satırı (salt-okunur).

  **Bağımsız QA (aynı üretim diff'i üzerinde):** 12 mutasyon testi uygulandı,
  11'i mevcut kilitler tarafından yakalandı. Kaçan 1 mutasyon
  (`ACCEPTED`'i kanıtlı başarı saymak) bir **kapsama boşluğuydu — üretim
  davranışı doğruydu**; eksik kilit (`17b`/`17c`) kapanış turunda eklendi ve
  mutasyonu yakaladığı doğrulandı. Full suite **16108/16108**, `tsc -b` temiz,
  production build ✓, native değişiklik yok.

  **Kasıtlı olarak DEĞİŞMEYENLER:** `AiSafetyGate` · `assistantSafetyKernel` ·
  `maviActionAuthority` defteri ve kapı sırası · `dispatchIntent` yürütücüsü ·
  F0 telemetri · F1 presence · **F2 filler=0** · F3 kısmi-transkript yetki
  sınırı · F4 akış sınırları · F5 capability kapısı.

  **Bu turun YAPMADIĞI (onaylı kapsam):** compound planner genişletmesi YOK (F7) ·
  eski intent parser SİLİNMEDİ · `maviCore` (frozen) DOKUNULMADI.

  **Kalan eksik (açık borç — QA tarafından tek tek doğrulandı):**
  (a) **Yerel `dispatchChain` hâlâ AYRI** — iki bileşik yol yan yana duruyor
  (yerel bağlaç bölmesi + beyin planı); kanonik plana taşınması ayrı bir tur.
  (b) **Gerçek model `actions[]` kapsaması UNKNOWN** — prompt öğretimi eklendi,
  ama modelin sahada dizi üretme oranı ölçülmedi.
  (c) **Rollback YOK** — hiçbir capability geri-alma sözleşmesi taşımıyor.
  (d) **Clarification YOK** — çakışmada LAST_WINS uygulanıyor, kullanıcıya
  sorulmuyor.
  (e) **F5 `SET_SETTING` sahte-ACK borcu AÇIK** — `ctx.applySetting?.()` opsiyonel
  porta rağmen koşulsuz "Ayar uygulandı" deniyor.
  (f) **DEVICE VALIDATION:** kütük **#987–#990** bekliyor; hiçbir head unit
  ölçümü yapılmadı. Bileşik kapsama, `actions[]` oranı ve birleşik cevap
  doğruluğu **UNKNOWN**'dır.
  (g) Gözlem (önceden var olan, F6 regresyonu DEĞİL): `_aiHandlers` beklemesinde
  timeout yok — asılan bir handler `answer` slotunu tutar; aynı risk tekil yolda
  da mevcut.

  **Sonraki atomik PR:** F7 (bu turda BİLİNÇLİ olarak başlanmadı). Tam mimari:
  `docs/CAROS_MAVI_ULTIMATE_OEM_ARCHITECTURE_SPEC_v1.md` §9 · §29.

- **MAVI-F5 · UNIVERSAL CAPABILITY FABRIC — MAVİ ARTIK CarOS'un GERÇEK YETENEK
  KATALOĞUNA BAĞLI (2026-08-29, kütük 🔴 #981-#986):**
  Durum: **ENTEGRE** (canlı hatta bağlı · test yeşil · tsc temiz · lint 0 hata ·
  native değişiklik YOK) — **SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR.**

  **Kapatılan kusur:** iki ayrı gerçek yan yana duruyordu ve birbirini görmüyordu.
  `capabilityRegistry` SystemBoot'ta besleniyordu ama dosyanın kendi başlığında
  yazdığı gibi **"kimse tüketmez — migrasyon AYRI PR"** durumundaydı; Mavi'nin ne
  yapabileceği ise prompt'a gömülü **sabit intent listelerinden** geliyordu. Üstelik
  o bilgi **üç ayrı listede** tutuluyor ve **üçü de birbirinden farklıydı**
  (29 / 29 / 26) — bir intent eklenip biri güncellenmeyince beyin geçerli bir komut
  üretiyor, doğrulayıcı onu **sessizce düşürüyordu**.

  **Yeni hat:**
  `Mavi önerisi → şema doğrulaması → capability çözümlemesi → izin → availability
  kanıtı → [KANONİK ZİNCİR: maviActionAuthority → AiSafetyGate → onay] →
  [KANONİK YÜRÜTÜCÜ: dispatchIntent] → gözlem sınıflandırması`.
  Köşeli parantezli iki adım **başka modüllere aittir ve taklit edilmez**.

  **En kritik ayrım — AVAILABILITY ≠ PERMISSION ≠ AUTHORITY:** üçü tek bayrağa
  indirilmedi. *Availability* `capabilityRegistry` kanıtıdır · *permission*
  katalogdaki `exposedToBrain`tir · *authority* YALNIZ kanonik zincirden doğar.
  Canlı örnek: `diagnostics.dtc#clear` katalogda görünür, araçta availability'si
  AVAILABLE olabilir, yine de Mavi bunu **öneremez**; önerse bile kanonik kapı açık
  onay ister. Fabric kanonik güvenliği **kopyalamaz** (kaynak kilidi) — kopyalasaydı
  iki karar kaynağı doğar ve hangisinin kazandığı çağrı sırasına kalırdı.

  **Tipli eylem sözleşmesi:** LLM `capabilityId · operation · parameters ·
  confidence · provenance · confirmationState` üretse bile **yetki kazanmaz**.
  Şema düşerse yürütücüye ulaşamaz; **şemada olmayan bir alan da reddedilir**
  (LLM'in uydurduğu `deleteAllData:true` gibi bir alanın sızması tipli sözleşmenin
  tamamını anlamsız kılardı).

  **Gözlem dürüstlüğü:** sonuç yedi bounded sınıfa eşlenir ve **"yaptım" denebilecek
  tek seviye `EXECUTED`/`OBSERVED`tir**. Her işlemin bir `observationCeiling`i vardır:
  yürütücü "başarılı" dese bile tavan `ACCEPTED` ise sonuç `ACCEPTED` yazılır
  (`SET_SETTING` kanıt döndürmez → tavan `ACCEPTED`; `QUERY_SENSOR` gerçek değeri
  okur → tavan `OBSERVED`). Tavan yalnız başarı iddiasını sınırlar, hatayı gizlemez.

  **Availability politikası (kilitli):** yalnız **kanıtlı olumsuz**
  (`unavailable`/`unsupported`/`restricted`) yolu kapatır; `UNKNOWN` **kapatmaz** ve
  **bayat kanıt AVAILABLE saymaz**. Fail-closed yapmak, registry'nin henüz kanıt
  toplamadığı her cihazda çalışan komutları sessizce öldürürdü.

  **Varsayılan GÖLGE kip:** kapı karar üretir ve **ölçer** ama hiçbir eylemi
  **engellemez** → cihaz davranışı bugünküyle **birebir** aynıdır ve kapının gerçek
  trafikte ne kadar doğru karar verdiği, çalışan bir komutu öldürmeden ölçülebilir.
  Zorlayıcı kipte kapı reddederse tur **sessizce ölmez**: akış yerel zincire düşer.

  **Kapsam (bu tur migrate edilenler):** navigasyon (6 işlem) · medya (7) · ayarlar
  (4) · araç salt-okunur (3) · tanılama (1, beyne kapalı) · telefon (1) · yüzey (3)
  = **25 işlem · 16 capability · 7 alan**. Prompt intent listesi artık **elle
  yazılmaz**; katalogdan türetilir ve **kapsam regresyonu yoktur** (eski 29 intent'in
  tamamı korunur — kilitli).

  **Telemetri:** F0 izine 7 bounded alan — `capabilityRoute` · `capabilityId` ·
  `capabilityOperation` · `capabilityAvailability` · `capabilityValidation` ·
  `capabilityObservation` · `capabilityEnforced`. **Yeni telemetri sistemi
  kurulmadı; parametre değeri · transkript · kişi · adres · VIN · konum bu katmana
  hiç girmez.** LAB: AI → **Capability Fabric** (salt-okunur).

  **Kasıtlı olarak DEĞİŞMEYENLER:** `AiSafetyGate` · `assistantSafetyKernel` ·
  `maviActionAuthority` defteri ve kapı sırası · onay politikaları · navigasyon ve
  medya kanonik otoriteleri · `dispatchIntent` yürütücüsü · F0 telemetri · F1
  presence · **F2 filler=0** · F3 kısmi-transkript yetki sınırı · F4 akış sınırları.

  **Bu turun YAPMADIĞI (onaylı kapsam):** compound command / planner genişletmesi
  YOK (F6) · eski intent parser SİLİNMEDİ · büyük executor rewrite YOK.

  **Kalan eksik (açık borç):**
  (a) medya · ayarlar · yüzey · telefon işlemlerinin `capabilityRegistry`de karşılığı
  olan bir kimlik **yok** → availability `UNKNOWN` görünür; **sahte kapı kurulmadı**,
  borç yazıldı.
  (b) `SET_SETTING` yürütücüsü port yokken bile "Ayar uygulandı" diyor — **sahte-ACK
  kusuru**. F5 bunu gözlem tavanıyla dürüstçe raporlar ama **konuşma metnini
  düzeltmez** (yürütücü sözleşmesi değişikliği gerekir; F5 kapsamı dışı).
  (c) `REMEMBER · FORGET · SHOW_WEATHER · ENABLE_DRIVING_MODE · TOGGLE_SLEEP_MODE`
  henüz katalogda değil → `LEGACY_FALLBACK`.
  (d) `ai/semanticAiService` ve `aiVoiceService` içindeki uykudaki `VALID_INTENTS`
  doğrulayıcıları hâlâ kendi listelerini taşıyor (canlı Mavi yolunda değiller —
  yalnız tip import ediliyorlar — bu yüzden dokunulmadı).
  (e) **DEVICE VALIDATION:** hiçbir head unit ölçümü yapılmadı; kapsama oranı ve kapı
  doğruluğu **UNKNOWN**'dır. Kapı gölge kipte olduğu için cihazdaki bugünkü davranış
  da değişmemiştir.

  **Sonraki atomik PR:** F6 — compound command / planner (bu turda BİLİNÇLİ olarak
  başlanmadı). Tam mimari:
  `docs/CAROS_MAVI_ULTIMATE_OEM_ARCHITECTURE_SPEC_v1.md` §9 · §29.

- **MAVI-F4 · STREAMING LLM + PARÇALI TTS — MAVİ CEVABIN TAMAMINI BEKLEMEDEN
  KONUŞUYOR (2026-08-29, kütük 🔴 #975-#980):**
  Durum: **ENTEGRE** (canlı hatta bağlı · test yeşil · tsc temiz · lint 0 hata ·
  native değişiklik YOK) — **SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR.**

  **Kapatılan kusur:** hat tümüyle seriydi —
  `final transcript → TAM LLM cevabı → TAM TTS sentezi → çalma`.
  `openRouterProvider`ın SSE ayrıştırıcısı GERÇEKTİ ama Mavi hattı `onToken`
  VERMİYORDU (yani akış kurulmuyordu bile); `geminiProvider` ise dosya başlığında
  açıkça "NON-STREAMING, `onToken` ÇAĞRILMAZ" diyordu. Kullanıcı, model son
  token'ı üretene kadar **tam sessizlik** duyuyordu.

  **Yeni hat:** `final transcript → streaming LLM → yapısal ayrım → güvenli
  konuşma parçaları → parçalı TTS → sıralı çalma`. Zincir tek yerde kurulur
  (`maviResponseStream`): `token → streamSayExtractor → speechChunker →
  maviSpeechStream → TTS`.

  **En kritik sınır — LLM AKIŞI OTORİTE DEĞİLDİR:** Mavi'nin beyni JSON döndürür
  (`{"type":"chat","say":…}` · `{"type":"action",…}` · `{"type":"web",…}`).
  `streamSayExtractor` `type` görülene kadar **tek karakter bile yayınlamaz**
  (fail-closed) ve `chat` DEĞİLSE akışı `STRUCTURED`'a çekip **tümüyle susturur**
  → `action` gövdesi ("intent OPEN_NAVIGATION destination …") asla seslendirilmez.
  Akış katmanı `processTextCommand` · `dispatchIntent` · `commandExecutor` ·
  `navigationService` · `mediaService` · `appLauncher` · `obdService` adlarının
  hiçbirini içermez (kaynak kilidi) — eylem YALNIZ kanonik zincirden
  (parse → planner → safety → executor) doğar.

  **İlk ses değil, ilk ANLAMLI ses:** `speechChunker` kelime ortasında ASLA
  kesmez ve içeriksiz giriş kalıbını ("Tabii," · "Elbette,") tek başına ilk parça
  olarak yayınlamaz — arkasındaki gerçek içerikle birleştirir. Kullanıcının
  duyduğu ilk şey "Tabii…" değil "Yaklaşık 83 kilometre…" olur. Metin SİLİNMEZ,
  yalnız bölünme noktası değişir → **F2 filler=0 korunur** (bu katman metin
  ÜRETMEZ, yalnız BÖLER).

  **Audio authority — akış TEK konuşma oturumudur:** en sinsi tuzak, parçaların
  ayrı ayrı "cevap bitti" yayınlamasıydı; o hâlde Mavi ilk parçadan sonra
  mikrofonu açıp **kendi cevabının kalanını keserdi**. `ttsService`e sayılı
  konuşma oturumu eklendi: parça bitişleri yutulur, bitiş bildirimi yalnız SON
  parçadan sonra bir kez yapılır, sıradaki parçaya geçiş AYRI kanaldan gelir.
  Böylece audio focus/duck akış boyunca **tek sefer** alınır ve
  navigasyon/telefon/güvenlik ses önceliği DEĞİŞMEZ.

  **Semantik ACK ile duplicate YOK:** `claimMaviAnswerStream` tur başına tek
  `answer` slotunu bir kez tutar → nihai metnin ayrıca konuşulması **yapısal
  olarak imkânsızdır**. Akış konuşmadan kapanırsa slot BIRAKILIR (sessiz ölüm
  koruması) ve kanonik yol normal çalışır.

  **Barge-in / iptal zinciri:** `araya girme → kuyruk temizlenir → TTS kesilir →
  sağlayıcı akışı abort → tur iptal`. İptalde bitiş bildirimi YAPILMAZ (ikinci bir
  "bitti" yeni turun mikrofonunu kapatırdı) ve `ttsCancel` konuşma oturumunu
  sıfırlar. Geç gelen parçalar eskimiş kimlikle sessizce düşer → **yarım kalan
  eski cevap sonradan konuşmaya başlayamaz** (F3 stale sözleşmesi akışa da
  uygulanır).

  **Bu turda BULUNAN VE KAPATILAN KUSUR (#980):** `tickSpeechStream` açlık kapısı
  yazılmış ve birim testi geçiyordu ama **üretimde hiç çağrılmıyordu** — kapı bir
  timer'la ilerletilmezse yoktur. Sağlayıcı ya da native TTS yarıda ölseydi akış
  sonsuza kadar açık kalır, konuşma oturumu kapanmaz ve **Mavi oturumun kalanında
  tümüyle susardı**. `voiceService` bileşim kökünde tek bir bekçi bağlandı (yalnız
  akış açıkken yaşar, her terminal yoldan sökülür) ve kapı ikiye ayrıldı: AÇLIK
  (`UPSTREAM_STALLED`, 6 sn) + ASILMIŞ SESLENDİRME (`SPEECH_STALLED`, 30 sn —
  parça tavanı ≈12 sn olduğu için normal cümle asla kesilmez). Regresyon kasasına
  "ölü güvenlik yasağı" kilidi eklendi.

  **Yetenek matrisi — sahte streaming ÜRETİLMEZ:**
  LLM `TOKEN_STREAM` (openrouter/gateway · gemini SSE) · `FINAL_ONLY`
  (gemini_direct · groq · haiku · offline).
  TTS: **hiçbir katman `TRUE_STREAMING` DEĞİLDİR** (dürüst tespit) —
  edge/online/native/web `CHUNKED_SYNTHESIS`, klip `FULL_SENTENCE_ONLY`.
  F4'ün kazancı "ses akışı" değil, **cevabın tamamının beklenmemesidir**.

  **Varsayılan KAPALI:** şalter (`mavi.streamingResponse.enabled`) kapalıyken
  `beginResponseStream` `null` döner, `onToken` sağlayıcıya HİÇ verilmez ve istek
  akış kipine bile geçmez → davranış bugünküyle **birebir aynıdır**. Sürüşte akış
  AÇILMAZ (ISO 15008 — cevap zaten 8 kelimeye iner).

  **Telemetri:** F0 izine bounded ek — `brain_first_token` ·
  `first_speech_chunk_ready` · `first_tts_chunk_request` · `first_tts_chunk_ready` ·
  `llm_stream_complete` · `tts_stream_complete` · `stream_cancelled` damgaları +
  `llmCapability` · `ttsCapability` · `streamEndReason` · `chunkCount` alanları.
  **Yeni telemetri sistemi kurulmadı; token/transkript metni bu katmana HİÇ
  girmez.** LAB: AI → **Mavi Gecikme** (salt-okunur).

  **Kasıtlı olarak DEĞİŞMEYENLER:** `AiSafetyGate` · `assistantSafetyKernel` ·
  `maviActionAuthority` · onay politikaları · `maviTurn`/`maviSpeech` tek-cevap
  otoritesi · F0 telemetri · F1 presence · **F2 filler=0** · F3 kısmi-transkript
  yetki sınırı · audio focus öncelik düzeni.

  **Bu turun YAPMADIĞI (onaylı kapsam):** Capability Fabric entegrasyonu YOK (F5) ·
  full-duplex barge-in YOK (F9.7) · offline klip sözlüğü YOK · gerçek
  `TRUE_STREAMING` TTS sağlayıcısı YOK (mevcut sağlayıcılarda böyle bir yol
  bulunmuyor — uydurulmadı).

  **Kalan eksik (açık borç):** **DEVICE VALIDATION** — hiçbir head unit ölçümü
  yapılmadı. `konuşma sonu → ilk onaylı ses` kazancı **UNKNOWN**'dır ve hiçbir
  hızlanma rakamı iddia EDİLMEMİŞTİR; şalter varsayılan kapalı olduğu için
  cihazdaki bugünkü davranış da değişmemiştir. Sahada önce taban (şalter kapalı)
  ölçülmeli, sonra şalter açık ölçüm alınmalıdır. F0/F1/F3 borçları
  (`wakeWordService` bileşik kapısı · `speech_end` türetilmişliği · APK doğrulaması)
  açık kalmaya devam ediyor.

  **Sonraki atomik PR:** F5 — Capability Fabric (bu turda BİLİNÇLİ olarak
  başlanmadı). Tam mimari:
  `docs/CAROS_MAVI_ULTIMATE_OEM_ARCHITECTURE_SPEC_v1.md` §9 · §29.

- **MAVI-F3 · STREAMING ASR + SEMANTİK CÜMLE-SONU (2026-08-29, kütük 🔴 #970-#974):**
  Durum: **ENTEGRE** (canlı hatta bağlı · test yeşil · tsc temiz · lint 0 hata ·
  native `compileDebugJavaWithJavac` EXIT=0) —
  **SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR.**

  **Kapatılan kusur:** Mavi, cümlenin BİTMESİNİ bekleyip sonra anlamaya başlayan
  klasik bir komut sistemiydi. Kısmi transkript JS'e **hiç ulaşmıyordu**
  (`onPartialResults` gövdesi BOŞ + `EXTRA_PARTIAL_RESULTS` istenmiyor; Vosk'un
  `getPartialResult()`'ı yalnız wake thread'inde) ve cümle-sonu kararı **tek
  sensörlüydü** (akustik VAD 1100 ms). O eşik bilinçli olarak 900'den 1100'e
  ÇIKARILMIŞTI — tek sensörle "kesmemek" ancak "yavaş olmak" pahasına alınıyordu.

  **Yeni hat:** `MIC → kısmi ASR → artımlı anlama → kanıt temelli endpoint →
  kanonik final`. Karar artık **akustik sessizlik + ASR kararlılığı + Türkçe anlam
  tamamlanmışlığı + asgari konuşma süresi + histerezis (≥2 tik)** birleşimidir.

  **En kritik sınır — KISMİ SONUÇ EYLEM YETKİSİ TAŞIMAZ (spec K5/I4):**
  `sttPartialStream` hiçbir CarOS yolunu import etmez/çağırmaz (kaynak kilidi);
  yapabildiği tek yan etki `finalize()` portudur ve o da **yalnız mikrofonu
  kapatır**. Eylem YALNIZ kanonik nihai transkriptten doğar → kendini düzeltme
  ("Ankara'ya… yok Mersin'e götür") yapısal olarak korunur.

  **Sözü kesmeme garantileri:** ASKIDA kontrolü FİİL kontrolünden **ÖNCE** çalışır
  (kilitli — "beni eve götür **ama**" tamamlanmış sayılamaz) · belirsizlik daima
  DEVAM lehine çözülür · semantik eşik (900 ms) akustik tabanı (1100 ms)
  **aşamaz** · histerezis olmadan karar verilmez.

  **Risk yönetimi (spec Risk: YÜKSEK):** erken bitirme komutu **VARSAYILAN
  KAPALIDIR**. Karar üretilir ve ÖLÇÜLÜR ama sağlayıcıya gönderilmez → cihaz
  davranışı bugünküyle **birebir aynıdır** ve `prematureEndpointRate` gerçek
  kullanıcıyı KESMEDEN sahada ölçülebilir. Spec'in kademeli indirimi
  (1100→900→700→500→350) ancak bu gölge ölçüm geçtikten sonra ilerler.

  **Sağlayıcı yeteneği BİLDİRİLİR, varsayılmaz:** `STREAMING_WITH_VAD` (Vosk) ·
  `STREAMING_TEXT_ONLY` (Google/web — sessizlik kanıtı yok, **sahte VAD
  kurulmaz**) · `FINAL_ONLY` (bulut STT / eski plugin → bugünkü davranış aynen).

  **Telemetri:** F0 izine bounded ek — `first_partial` · `stable_partial` ·
  `semantic_complete_candidate` · `endpoint_decision` · `final_transcript_ready`
  damgaları + `partialCount` · `endpointReason` · `endpointCompleteness` ·
  `endpointCommanded` · `sttCapability` alanları. **Yeni telemetri sistemi
  kurulmadı; transkript metni bu katmana HİÇ girmez.**

  **Kasıtlı olarak DEĞİŞMEYENLER:** `AiSafetyGate` · `assistantSafetyKernel` ·
  `maviActionAuthority` · onay politikaları · `maviTurn`/`maviSpeech` tek-cevap
  otoritesi · F1 presence · **F2 filler=0** (kısmi/endpoint yolunda hiçbir ara söz
  üretilmez — kilitli).

  **Bu turun YAPMADIĞI (onaylı kapsam):** streaming LLM/TTS yok (F4) ·
  full-duplex barge-in yok (F9.7) · Capability Fabric'e dokunulmadı (F5).

  **Kalan eksik (açık borç):** **BUILD REQUIRED / DEVICE VALIDATION** — native
  değişiklik derlendi (EXIT=0) ama **APK cihaza kurulup çalıştırılmadı**; kısmi
  olayın gerçek head unit'te aktığı, `konuşma başı → ilk kısmi` gecikmesi ve
  `prematureEndpointRate` **UNKNOWN**'dır. Latency kazancı **iddia edilmemiştir**:
  komut kipi kapalıyken endpoint süresi bugünküyle aynıdır. `wakeWordService`
  bileşik kapısı (F1 borcu) ve `speech_end` türetilmişliği (F0 sınırı) açık.

  **Sonraki atomik PR:** F4 — streaming LLM + streaming TTS + offline klip sözlüğü.
  Tam mimari: `docs/CAROS_MAVI_ULTIMATE_OEM_ARCHITECTURE_SPEC_v1.md` §9 · §29.

- **MAVI-F2 · YAPAY ARA SÖZ (FILLER) İMHASI + DÜRÜST ACK POLİTİKASI (2026-08-29, kütük 🔴 #966-#969):**
  Durum: **ENTEGRE** (canlı hatta bağlı · test yeşil · tsc temiz · lint 0 hata) —
  **SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR.**

  **Kapatılan kusur (I11 ihlali):** Mavi gecikmeyi *"Bakıyorum hemen… / Bir saniye… /
  Kontrol ediyorum…"* diyerek örtüyordu. Bu bir UX tercihi değil, seri hattın
  gecikmesini gizleyen bir yara bandıydı: cümle hiçbir bilgi taşımıyor, tipik tur
  1500 ms eşiğini zaten aştığı için **neredeyse her turda** çalışıyor ve geç
  ateşlediğinde **başlamış cevabı kesiyordu** (kodda `KESİLME FIX` notuyla belgeli).

  **Kaldırılan filler yolları (altısı da kaynaktan silindi/değiştirildi):**
  `voiceService` düşünme timer'ı + `THINKING_PHRASES` + `_speakThinking` (**silindi**) ·
  `voiceService` sensör bypass'ı `"Bakıyorum..."` · `commandExecutor` QUERY_SENSOR
  `"Bakıyorum"` · `voiceInfoService` `"Hava durumuna bakıyorum."` · `maviFeedback`
  STAGE tablosu `understanding`/`planning` satırları · `companionChatProvider` prompt
  örneklerindeki `feedback:"Bakıyorum"`.

  **Korunan semantik ACK'ler (§9.6 — filler DEĞİL):** `Araç sistemleri taranıyor` ·
  `Arıza kayıtları siliniyor` · `Araç bakım durumu kontrol ediliyor` ·
  `<sensör adı> okunuyor` · `Araçtan okuyorum.` (EXTENDED okuma 12 sn'ye kadar) ·
  `Hava durumunu alıyorum.` (gerçek ağ çekimi). Hepsi **gerçek ve süren bir işin
  BAŞLADIĞINI** bildirir; hiçbiri bittiğini iddia etmez (**ACK ≠ BAŞARI**).

  **Yapısal ayrım (tekrar filler'a düşülemesin diye):** yeni saf modül
  `assistant/maviAckPolicy` içeriksiz bekletme kalıplarını **ÇAPALI (tam eşleşme)**
  regex'lerle tanır; `maviSpeech` bunu **YALNIZ `progress` katmanında** zorunlu kılar.
  Nihai cevap, gerçek hata mesajı, belirsizlik sorusu ve yetenek reddi (`answer`)
  kapıdan **hiç geçmez** — F2 bir susturma değil, dürüstlük kapısıdır. Model prompt
  kuralına rağmen filler üretirse `parseBrainJson` sınırında süzülür.

  **Telemetri:** `filler_trigger` **kaldırılmadı** (F2'nin işi onu sıfırlamaktı,
  gizlemek değil); damga artık ara sözün yakalanıp **düşürüldüğü** anda basılır →
  üretimde beklenen değer **0**, sıfırdan büyük her değer regresyon kanıtıdır. Mevcut
  F0 izine bounded `ack_emitted` + `ackCount` eklendi ki ACK filler sayılmasın.
  **Yeni telemetri sistemi kurulmadı**; transcript/prompt/PII taşınmıyor.

  **Kasıtlı olarak DEĞİŞMEYENLER:** `AiSafetyGate` · `assistantSafetyKernel` ·
  `maviActionAuthority` · onay politikaları · `maviTurn`/`maviSpeech` tek-cevap
  otoritesi · F1 presence davranışı (Yol Arkadaşı AÇIK/KAPALI fark etmez, ikisinde de
  filler yasak).

  **Bu turun YAPMADIĞI (onaylı kapsam):** streaming ASR/LLM/TTS eklenmedi (F3/F4) ·
  semantic endpointing yok · Capability Fabric'e dokunulmadı (F5).

  **Kalan eksik (açık borç):** F2 riski spec'te **ORTA** olarak kayıtlıdır —
  streaming gelmeden filler kalkınca **algılanan sessizlik artar**. Bu bilinçli kabul
  edildi: sessizlik dürüsttür, filler yalandı; gecikme F3/F4'te **yapısal olarak**
  azaltılacak. Cihazda algılanan gecikme kabul edilemez çıkarsa çözüm filler'ı geri
  getirmek DEĞİL, F3/F4'ü öne almaktır. `wakeWordService` bileşik kapısı (F1 borcu)
  ve `speech_end` türetimi (F0 sınırı) aynen açık.

  **Sonraki atomik PR:** ~~F3 — streaming ASR + semantic endpointing~~
  **TAMAMLANDI** (yukarı bkz.) → F4.
  Tam mimari: `docs/CAROS_MAVI_ULTIMATE_OEM_ARCHITECTURE_SPEC_v1.md` §9 · §29.

- **MAVI-F1 · YOL ARKADAŞI ARTIK BİR CAPABILITY ŞALTERİ DEĞİL (2026-08-29, kütük 🔴 #963-#965):**
  Durum: **ENTEGRE** (canlı hatta bağlı · test yeşil · tsc temiz) —
  **SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR.**

  **Kapatılan kusur (vizyon anayasası ihlali):** `companionEnabled !== true` **dört**
  ayrı yerde erken `null` döndürüyordu (`runCompanionBrain` · `tryCompanionBrain` ·
  `runCompanionChat` · `tryCompanionChat`). `voiceService` bu `null`'ı "beyin yok"
  sayıp yerel regex zincirine düşüyordu. Sonuç: bir **kişilik ayarı** kapalıyken Mavi
  doğal dil anlamayı, sohbeti ve beyin kararlı CarOS komutlarını (navigation · media ·
  settings · vehicle) **kaybediyordu**. Ürün tanımı bunun tam tersini şart koşar.

  **Yeni invaryant:** `companionEnabled` **yetenek kapatmaz**; yalnız **presence**
  (konuşma tonu + kendiliğinden konuşma isteği) yönetir. Aynı tek beyne giden sistem
  prompt'unun ton satırları değişir — ikinci beyin/zincir/hafıza **açılmadı**.

  **Kasıtlı olarak DEĞİŞMEYENLER:** `companionEngine`'in proaktiflik kapısı
  (kendiliğinden konuşma presence'ın gerçek işidir) · `assistantSafetyKernel` ·
  `AiSafetyGate` · `maviActionAuthority` · tek-cevap sözleşmesi. Üçünün de kaynağında
  `companionEnabled` **hiç geçmediği** yapısal kilitle kanıtlandı.

  **Bu turun YAPMADIĞI (onaylı kapsam):** filler kaldırılmadı (**F2'de kaldırıldı**) ·
  streaming eklenmedi (F3/F4) · Capability Fabric'e dokunulmadı (F5) · isim/refactor yapılmadı.

  **Kalan eksik (açık borç):** `wakeWordService._applyWakeFromSettings` hâlâ
  `companionEnabled && companionWakeWordEnabled` bileşik kapısını kullanıyor — yani
  Yol Arkadaşı kapalıyken **uyandırma kelimesi de kapanıyor**. Bu tur **bilinçli
  olarak dokunulmadı**: wake alt-ayarı ayarlar ekranında companion panelinin
  **içinde** render ediliyor (`companionEnabled && (...)`), dolayısıyla kapıyı UI
  değişikliği olmadan ayırmak **erişilemez bir ayar** yaratırdı (kullanıcı wake'i
  açık bırakıp paneli kapatırsa geri kapatamaz). Ayrım F11 (UI durum mimarisi)
  turunda, panel yeniden düzenlenirken yapılacak. Ayrıca `speech_end` türetimi ve
  diğer F0 sınırları aynen geçerli.

  **Sonraki atomik PR:** ~~F2 — filler imhası~~ **TAMAMLANDI** (yukarı bkz.) → F3.
  Tam mimari: `docs/CAROS_MAVI_ULTIMATE_OEM_ARCHITECTURE_SPEC_v1.md` §29.

- **MAVI-F0 · UÇTAN UCA GECİKME TELEMETRİSİ (2026-08-29, kütük 🔴 #959-#962):**
  Durum: **ENTEGRE** (canlı hatta bağlı · test yeşil · tsc temiz) —
  **SAHADA DOĞRULANMADI. ÜRÜN HAZIR: HAYIR.**

  **Kapatılan boşluk:** Mavi'nin `speech-end → ilk duyulabilir ses` değeri
  **UNKNOWN**'dı. Repoda iki ölçüm katmanı vardı ama ikisi de bu soruyu
  cevaplayamıyordu: `sttLatencyTelemetry` yalnız **native STT fazlarını** ölçüyor
  (zincir orada bitiyor), `maviCore/latencyTelemetry` ise **SHADOW orkestratöre**
  bağlı olduğu için canlı turda hiç çalışmıyor ve marker sözlüğünde STT/beyin/TTS/
  ses/filler/route/outcome kavramları bulunmuyordu. Yani optimizasyon kararlarının
  dayanağı yoktu.

  **Yapılan:** `assistant/maviLatencyTrace` (bağımsız · bayraklı · bounded) canlı
  hattın **18 kanonik damgasını** tek `turnId` altında toplar; `devtools/maviLatencyModel`
  (saf) segment/percentile/hüküm türetir; CAROS LAB → AI → **Mavi Gecikme** ekranı
  salt-okunur gösterir. **Yeni ölçüm üretilmedi:** konuşma başı/sonu JS'te gözlenemediği
  için `sttLatencyTelemetry`nin ZATEN ölçtüğü native VAD deltaları türetilmiş damga
  olarak zincire bağlanır ve `derived` işaretlenir.

  **Üç dürüstlük kilidi (bu turun asıl değeri):**
  1. **Proxy ≠ kanıt.** `first_audio_requested` (`play()` çağrıldı) ile
     `first_audio_confirmed` (platform `playing`/`onstart` bildirdi) AYRI damgalardır
     ve birleştirilmez. **Android native TextToSpeech bu derlemede başlangıç bildirimi
     VERMEZ** → native yolda doğrulama YAPILAMAZ ve ekran bunu açıkça söyler.
  2. **İstatistik yalnız `completed` turlardan çıkar** — iptal/timeout/devralınan tur
     "hızlı" görünüp p50'yi yanlış iyileştirirdi.
  3. **Ölçüm yoksa sayı uydurulmaz** — `KAYNAK YOK` gösterilir.
  4. **Yabancı ses kapısı.** `ttsService` tek otoritedir ve Mavi'nin cevabı dışında
     da konuşur (navigasyon · güvenlik · tehlike · bildirim). Bir iz açıkken bunlardan
     biri çalarsa "ilk gerçekleşme kazanır" kuralı ana metriği kalıcı olarak bozardı;
     bu yüzden ses damgaları yalnız `tts_request` sonrası kabul edilir ve düşen damga
     `Yabancı ses damgası` sayacında **görünür kalır**.

  **Bu turun YAPMADIĞI (onaylı kapsam):** filler kaldırılmadı · streaming eklenmedi ·
  endpoint eşiği değiştirilmedi · hiçbir karar/akış/TTS/UI davranışı değiştirilmedi.
  Bayrak varsayılan KAPALI; kapalıyken üretim davranışı birebir aynıdır.

  **Kalan eksik:** gerçek araç ölçümü (#959-#962) · web/Google STT yolunda `speech_end`
  türetilemiyor (native telemetri gelmiyor — sahte taban bilinçli olarak üretilmedi) ·
  `brain_first_token` damgası streaming olmadığı için hiç basılmıyor (F4'e ayrılmış).

  **Sonraki atomik PR:** F1 — Yol Arkadaşı'nı capability şalteri olmaktan çıkarma
  (`companionChatProvider` dört `companionEnabled` guard'ı). Tam mimari:
  `docs/CAROS_MAVI_ULTIMATE_OEM_ARCHITECTURE_SPEC_v1.md` §29.

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

- **NAV-V3-F8 · Navigasyon v3 — saha ölçüm hazırlığı / enstrümantasyon / replay kanıt paketi (2026-09-04):**
  Durum: **ENTEGRE (F3–F7 teşhisi tek zaman ekseninde, sınırlı kayıt + replay)**
  — saha kanıtı YOK, **ÜRÜN HAZIR: HAYIR** (bu madde zaten ürün özelliği
  DEĞİLDİR — ölçüm altyapısıdır). Kütük: 🔴 **#1273** (recorder cihazda
  çalışıyor mu) · 🔴 **#1274** (taşma saha kanıtı) · 🔴 **#1275** (gizlilik
  redaksiyonu gerçek koordinatla doğrulanmalı). Belge:
  `docs/NAVIGATION_ARCHITECTURE_SPEC_v3.md` → **§F8**.

  **F8'İN TEK VAADİ:** araç geldiğinde F4–F7 zincirini TEK sürüşte, sonradan
  tekrar analiz edilebilir ve kanıtlanabilir şekilde ölçen canonical bir
  paket HAZIR olsun — **hiçbir ürün kararı DEĞİŞMEDİ.**

  **Mevcut ölçüm otoritesi genişletildi, YENİDEN İCAT EDİLMEDİ:**
  `navFieldBridge.ts` (F0–F2 döneminden, `window.__CAROS_NAV_FIELD__`) ile
  `nav-field-record.mjs`/`nav-field-analyze.mjs` (CDP over adb, 1 Hz, JSONL)
  ZATEN vardı ama F3–F7'nin ürettiği hiçbir teşhis yüzeyini (CEH · graf
  sakinliği · sınırlı koridor · denetim eşleştirme · gölge · rota gerekçesi ·
  sıcak-yol maliyeti) İÇERMİYORDU. F8 bu ALTI yüzeyi TEK zaman eksenine
  taşıdı — hepsi ZATEN salt-okunur getter olarak vardı.

  **İncelenip REDDEDİLEN alternatif:** `platform/fieldValidation/longRoad*`
  (6 154 satır, OBD/araç-sağlığı alanının kendi `setInterval`li black-box
  sistemi). Yeniden kullanmak yabancı bir alanın özel zamanlayıcısını ithal
  etmek ya da navigasyona İKİNCİ zamanlayıcı kurmak olurdu (CLAUDE.md
  §CROSS-DOMAIN 8/15). Tasarım DESENİ esinlenildi, kod PAYLAŞILMADI.

  **Yapılan:** (1) `NavFieldSample` yedi yeni bölümle genişledi, her biri
  `_safe()` ile sarılı (bir bölüm patlarsa örnek çökmez). (2) Sample/event
  ayrımı: event'ler `deriveFieldEvents` ile İKİ ARDIŞIK ÖRNEĞİN farkından
  türetilir (SAF, geçiş-tabanlı, dokuz tür) — **yeni zamanlayıcı KURULMADI**,
  kayıt mevcut dış CDP kadansına "piggyback" eder. (3) Sınırlı kayıt: tavan
  (3 600 örnek / 512 olay) dolunca yeni girdi REDDEDİLİR, en eski veri
  KORUNUR, taşma `overflow.*` ile AÇIKÇA işaretlenir (sessiz kayıp yok).
  (4) Varsayılan dışa aktarım koordinat TAŞIMAZ (`fieldDebug: true` açıkça
  istenmeden `lat/lon` `null`e redakte edilir; `coordinatesRedacted` alanı
  bunu BEYAN eder). (5) `navFieldTraceReplay.ts` (SAF) — saha kaydını F3–F7'nin
  ZATEN kodda var olan beş sözleşmesine karşı denetler (belirsiz kolda MPP
  olamaz · kesik koridor "yok" diyemez · gölge fark sayısı tutarlı olmalı ·
  her eşleşme yönü bilinir sınıflanır · gerekçe↔seçim tutarlı) — GPS/Guardian
  TAKLİT ETMEZ, ikinci runtime DEĞİLDİR.

  **LAB entegrasyonu bilinçli olarak GÖRSEL LAB DEĞİL:** mevcut kilit
  (`navFieldBridge` LAB okuma katmanına SIZAMAZ) pazarlıksızdır — köprü ham
  koordinat taşır. F8 görevinin kendi kaçış maddesini kullandı: kontrol
  yüzeyi `window.__CAROS_NAV_FIELD__` (zaten var olan kanal) genişletildi,
  ikinci kontrol yüzeyi İCAT EDİLMEDİ.

  **CLI:** `nav-field-record.mjs`/`nav-field-analyze.mjs` **davranışları
  DEĞİŞMEDEN** çalışmaya devam eder; ek olarak koşum sonunda `.trace.json`
  yazılır ve analiz çıktısına F3–F7 kanıt özeti eklenir (yalnız GÖZLEM, eşik
  İCAT ETMEZ). Sentetik JSONL ile uçtan uca doğrulandı (host); gerçek cihaz
  DEĞİL (kütük #1273).

  **#1232–#1272 kanıt haritası:** her madde için trace TEK BAŞINA yeterli mi
  sorusu yanıtlandı (spec §F8.10). Genel kural: trace *"veri neydi"*yi
  cevaplar, *"kabul edilebilir mi"* kalibrasyon kararını ASLA otomatik
  vermez — özellikle **#1266** (yanlış carriageway, güvenlik kritik)
  telemetri TEK BAŞINA hiçbir zaman yeterli SAYILMAZ; bölünmüş yolda insan
  gözlemi ZORUNLU kalır.

  **Üretim otoritesi (değişmedi):** CEH hâlâ SHADOW · Guardian hâlâ
  PRODUCTION · kayıt açık/kapalıyken navigasyon hükümleri BİREBİR AYNI
  (kaynak taramasıyla kilitli — kayıt hiçbir navigasyon/CEH/Guardian
  fonksiyonu ÇAĞIRMAZ).

  **Doğrulama:** `tsc -b --force` PASS · değişen dosyalarda lint temiz ·
  nav F0–F8 **497 PASS** (F8 dosyası **41 kilit**, T1–T12 mimari kilitler
  dâhil) · regresyon kasası **981 PASS** (F8 öncesi köprü kilitleri
  bozulmadı) · `nav-field-record.mjs`/`nav-field-analyze.mjs` `node --check`
  + sentetik JSONL ile uçtan uca (host). Full suite/production build/native
  build KOŞULMADI.
  Hüküm: **`F8 CODE PASS`.**
  **`F8 FIELD = NOT EXECUTED`** — araç yoktu; hiçbir gerçek kayıt alınmadı.

- **NAV-V3-F7 · Navigasyon v3 — L4 rota: "neden bu rota?" hesap verebilirliği (2026-09-04):**
  Durum: **ENTEGRE (rota seçimi artık gerekçe taşıyor)** — saha kanıtı YOK,
  **ÜRÜN HAZIR: HAYIR**. Kütük: 🔴 **#1269** (gerekçe kayıtlı) · 🔴 **#1270**
  (doğrulama kapısının ödettiği süre) · 🔴 **#1271** ("açıklanamadı" sahada
  görülmemeli) · 🔴 **#1272** (kullanıcı tercihi ayrı işaretleniyor).
  Belge: `docs/NAVIGATION_ARCHITECTURE_SPEC_v3.md` → **§F7**.

  **ÖNCE BİR DÜZELTME (kanıtla):** v3 belgesinde **F7 diye tanımlanmış bir faz
  YOKTU** — "F7" yalnız borç tablolarında geçiyordu. Kanonik faz planı
  `NAVIGATION_ARCHITECTURE_SPEC_v2.md` §12'dedir ve farklı numaralandırır
  (v2/F4 = ROTA). v3, v2/F3'ü (CEH) üç turda karşıladı (F3 · F4 · F6) ve araya
  bir güvenlik fazı ekledi (F5 gölge). Katman planında sıradaki faz **L4 —
  ROTA**'dır; F7 bu kapsamla ilk kez tanımlandı.

  **ÖLÇÜLEN KUSUR:** `routingService` sağlayıcıdan `alternatives=3` istiyor,
  hepsini doğruluyor ve `pickBestRoute` birini AKTİF ROTA yapıyordu — ama
  seçim hiçbir yapısal iz bırakmıyordu (yalnız bir `console.warn`). Sıralama
  anahtarı `[failCount, warnCount, durationS]` olduğu için **süre ÜÇÜNCÜ
  ölçüttür**: bir uyarısı az olan aday çok daha yavaş olsa bile kazanır. Yani
  sistem sürücü adına bir takas yapıyor ve *"neden?"* sorusunun cevabı yoktu.

  **YAPILAN:** saf `routeRationaleModel` — adaylar · seçilen · belirleyici
  etken · **süre takası** (`durationPenaltyS`: seçilen rota, KABUL EDİLEN en
  hızlı adaydan kaç sn uzun; ölçülemezse `null`, sahte 0 YOK). Sıralama anahtarı
  tek otoriteye çıkarıldı (`routeRankKey`) — seçimi YAPAN ile AÇIKLAYAN
  ayrışırsa açıklama gerçeğin ikinci otoritesi olurdu. Etken sözlüğü **gerçek
  karar fonksiyonundan** türetildi (`ONLY_OPTION · VALIDATION_FAIL ·
  VALIDATION_WARN · DURATION · TIE_PROVIDER_ORDER · USER_SELECTED ·
  NO_CANDIDATE · UNKNOWN`), v2 §5.5'in araç-maliyet sözlüğünden DEĞİL — çarpan
  motoru bu binary'de yok, **kaynağı olmayan etken uydurulmaz**.

  **AÇIKLAYICI KARAR VERMEZ (pazarlıksız):** rotayı `pickBestRoute` seçer ve
  öyle KALIR; gerekçe hiçbir koşulda okunmaz (kilit R3/R7). Seçim anahtarla
  çelişirse hüküm `UNKNOWN`tır — uydurma açıklama yerine **görünür arıza**.

  **Bilinçli olarak KAPSAM DIŞI (gerekçeli):** maliyet modeli / `CostContext` /
  araç-farkında çarpanlar **EKLENMEDİ** — tüketicisi yok (A* ham metre üzerinden
  arıyor), bağlamak rota çıktısını değiştirirdi (araç yok → doğrulanamaz) ve
  çarpanların kanıt kaynağı olmadığı için hepsi 1.0 olurdu. F5'in çok adımlı ağ
  mesafesini ertelediği gerekçenin aynısı. Ayrıca: hiyerarşik A* (tetikleyici
  eşikle açılır) · yerel daemon kaldırma (FIELD FIREWALL: legacy sağlayıcı
  kaldırma yasak) · reroute FSM davranışı · CEH cutover · hız limiti/viraj/eğim.

  **Üretim otoritesi (değişmedi):** aday seçimi → `pickBestRoute` · sağlayıcı
  merdiveni → `routingService` (yerel daemon KALDIRILMADI) · denetim uyarısı →
  LEGACY `guardianRuntime` · cutover kapısı **KAPALI**. Rota davranışı
  DEĞİŞMEDİ; F7 yalnız KAYIT ekledi.

  **LAB:** yeni ekran AÇILMADI — mevcut Navigation Core → **6 · Doğrulama**
  kartı dört satırla genişletildi (`Neden bu rota` · `Aday havuzu` ·
  `Süre takası` · `Karar defteri`). Hiç karar yokken satır **`ölçülmedi`** der.

  **Doğrulama:** `tsc -b --force` PASS · değişen 7 dosyada lint PASS ·
  nav F0–F7 **456 PASS** (F7 dosyası **30 kilit**, R1–R8 mimari kilitler dâhil) ·
  LAB/rota/oturum/Guardian **276 PASS** · regresyon kasası **981 PASS**.
  Full suite / production build / native build KOŞULMADI.
  Hüküm: **`F7 CODE PASS` — `IMPLEMENTATION COMPLETE / QA REQUIRED`.**
  **`F7 FIELD = NOT EXECUTED`** — araç yoktu, hiçbir saha maddesi 🟢 yapılmadı.
  ⚠️ **F8 blocker'ı:** F4/F5/F6 saha kampanyası (#1232–#1268) hâlâ tek gerçek
  engeldir; maliyet modeli bağlama, CEH cutover ve daemon kaldırma onun
  ARDINDAN gelir.

- **NAV-V3-F6 · Navigasyon v3 — sınırlı topoloji koridoru + kenar-tabanlı denetim noktası (2026-09-04):**
  Durum: **ENTEGRE (CEH artık gerçek bir enforcement ahead nesnesi üretiyor)** —
  saha kanıtı YOK, **ÜRÜN HAZIR: HAYIR**. Kütük: 🔴 **#1261** (bounded koridor) ·
  🔴 **#1262** (kesilme oranı / tavan kalibrasyonu) · 🔴 **#1263** (kesik koridor
  yokluk demiyor) · 🔴 **#1264** (boş liste ölçülmüş yokluğa çevrilmiyor) ·
  🔴 **#1265** (eşleştirme dağılımı) · 🔴 **#1266** (yanlış carriageway koruması —
  güvenlik kritik) · 🔴 **#1267** (yol-boyu ≠ kuş uçuşu) · 🔴 **#1268** (sıcak-yol
  CPU/bellek). Belge: `docs/NAVIGATION_ARCHITECTURE_SPEC_v3.md` → **§F6**.

  **F6'NIN TEK VAADİ:** `MatchedRoadPose → bounded topology corridor →
  edge-based enforcement match → along-network distance → CEH enforcement ahead
  object → F5 shadow comparison` zinciri gerçek canonical graf verisiyle,
  bounded, deterministik ve fail-closed çalışır. **CEH üretim otoritesi
  OLMADI** — Guardian uyarısı hâlâ legacy'de, cutover kapısı hâlâ KAPALI.

  **Kapatılan F5 borçları:** ① CEH denetim-noktası öznitelik portu artık BAĞLI
  (`navEgoHorizonBridge` → `cehAuthority.bindAttributePorts`, yalnız
  `ENFORCEMENT`); ② çok adımlı ağ mesafesi eklendi — ama **yalnız bounded
  koridor kapsamında** (arama değil, koridor tablosu okuması; F4/E5).

  **ÖLÇÜMÜN BULDUĞU İKİ GERÇEK KUSUR (testler yeşilken vardı):**
  **(1)** `corridorIsScanComplete()` tam bu amaçla yazılmıştı ama üretimde
  HİÇBİR YERDE ÇAĞRILMIYORDU: koridor bir tavanla KESİLMİŞ olsa bile boş sonuç
  `NO_OBJECTS_IN_RANGE` (ölçülmüş yokluk) diye sunuluyordu. Gerçek grafta
  ölçüldü: 2 000 m bütçeyle **300 örneğin 74'ü (%24,7)** `NODE_LIMIT` ile
  kesiliyor — teorik kenar durum değil, **olağan hâl**. **(2)** `readCehAhead`,
  alan kaynağının BAĞLI olmasını ÖLÇÜM yerine sayıyordu; port `NOT_MEASURED`
  dese bile bu bilgi kola taşınmadığı için tüketicide yokluk hükmüne
  dönüşüyordu. İkincisi `divergenceRatio`ya — yani **cutover kapısının
  girdisine** — sahte kanıt besleyebilecek türdendi. İkisi de kapatıldı;
  sözleşmeye `HorizonPath.measuredKinds` eklendi ve `pathMeasuresDomain()`
  fail-closed'dır.

  **Kurulan katmanlar:** (1) `map/graph/boundedCorridor.ts` — SAF, deterministik,
  **dört bağımsız tavan** (96 kenar · 64 düğüm genişletme · 32 derinlik · 5 km
  sert bütçe); `BUDGET_EXHAUSTED` (tasarım sınırı) ile `EDGE/NODE/DEPTH_LIMIT`
  (KESME) ayrı hükümler. (2) `enforcement/enforcementEdgeIndex.ts` — SAF, **beş
  ayrı hüküm**; yalnız `OUTSIDE_COVERAGE` bir yokluk ölçümüdür; belirsizlik
  marjı yanlış carriageway'e kamera bindirmeyi yapısal olarak engeller. (3) L1
  cephesi: `expandCorridor` · `alongCorridorDistanceM` · `corridorContainsEdge`
  — kuş uçuşuna sessiz düşüş YOK, konum koridorda değilse `null`. (4)
  `enforcementHorizonPort.ts` — bileşim kökü; hiçbir kararı yeniden üretmez,
  yalnız sıralı bağlar; fail-soft ama `NOT_MEASURED`i `NO_OBJECTS_IN_RANGE` gibi
  SUNMAZ. (5) LAB → Navigation Core kart 16 genişletildi (**yeni ekran
  AÇILMADI**): koridor hükmü + `KESİLDİ / eksiksiz tarandı` + eşleştirme
  dağılımı + port sıcak-yol maliyeti.

  **Üretim otoritesi (değişmedi):** denetim uyarısı → legacy `guardianRuntime` →
  `enforcementMapSource` · `CEH_CUTOVER_DEFAULT_OPEN === false` (kapı hiçbir
  girdiyle açılamaz) · `ATTRIBUTE_PORTS_BOUND` şartı DÖRT alanın DÖRDÜNÜ ister,
  F6 yalnız `ENFORCEMENT` bağladı → şart hâlâ karşılanmıyor (kasıtlı) ·
  gölge katmanının yan etki sayısı yapısal olarak **0**.

  **Dürüstlük sınırı (ölçülerek beyan):** hız limiti · viraj · eğim portları
  BAĞLANMADI — kaynakları bu binary'de (`RTG2`) YOKTUR ve uydurulmayacaktır.
  Koridor tavanları ve eşleştirme eşikleri (25 m · 8 m · 40 m) **politikadır,
  sahamızdan kalibre EDİLMEMİŞTİR**.

  **Host ölçümü (cihaz ölçümü DEĞİL):** graf 238 252 düğüm · 295 346 kenar ·
  tipli dizi 5,48 MB + CSR komşuluk 4,07 MB; koridor genişletme p50
  0,008–0,020 ms · p95 0,041–0,089 ms · max 0,052–0,231 ms; 1 800 genişletmeden
  sonra sızıntı imzası YOK.

  **Doğrulama:** `tsc -b --force` PASS · değişen 9 dosyada lint PASS ·
  F0–F6 nav paketleri **426 PASS** (F6 dosyası **61 kilit**) · LAB navigasyon
  **95 PASS** · Guardian/oturum **249 PASS** · regresyon kasası **981 PASS**.
  Full suite / production build / native build KOŞULMADI.
  Hüküm: **`F6 CODE PASS` — `IMPLEMENTATION COMPLETE / QA REQUIRED`.**
  `F6 FIELD PASS` YAZILAMAZ (gerçek araç kullanılmadı).
  ⚠️ **F7 ön koşulu (F5'ten devrediyor):** cutover kapısının
  `F4_FIELD_VALIDATION` şartı (kütük #1232–#1243) gerçek araçta ölçülmeden
  hiçbir tüketici CEH'e taşınamaz. Ayrıca #1266 (yanlış carriageway) 🟢
  olmadan CEH denetim çıktısı hiçbir tüketiciye bağlanamaz.

- **NAV-V3-F5 · Navigasyon v3 — CEH tüketici göçü / gölge otorite / cutover kapısı (2026-09-03):**
  Durum: **ENTEGRE (gölge ölçümü + cutover kapısı)** — saha kanıtı YOK,
  **ÜRÜN HAZIR: HAYIR**. Kütük: 🔴 **#1244** (gölge canlı akışta) · 🔴 **#1245**
  (gölge sunum üretmiyor) · 🔴 **#1246** (manevra fark ölçümü) · 🔴 **#1247**
  (denetim noktası "yalnız legacy") · 🔴 **#1248** (Guardian otoritesi değişmedi) ·
  🔴 **#1249** (cutover kapısı KAPALI) · 🔴 **#1250** ("ölçülmedi" ≠ "yok") ·
  🔴 **#1251** (belirsizlik kesin iddia üretmiyor).
  Belge: `docs/NAVIGATION_ARCHITECTURE_SPEC_v3.md` → F5 bölümü.

  **F5'İN TEK VAADİ:** üretim kararı **DEĞİŞMEDEN** CEH aynı soruyu gölgede
  cevaplar ve fark ÖLÇÜLÜR. Legacy = üretim · CEH = gölge · tek cutover kapısı.
  Legacy hiçbir yerden SÖKÜLMEDİ.

  **Kurulan katmanlar:** (1) `horizon/cehConsumerContract.ts` — tüketicinin TEK
  okuma noktası; `CLAIM · NO_OBJECT_IN_HORIZON · AMBIGUOUS · HORIZON_UNAVAILABLE
  · NOT_MEASURED` hükümleri yapısal olarak ayrı ve **hiçbirinde `NOT_MEASURED →
  NONE` dönüşümü mümkün değil**. (2) `shadow/cehShadowModel.ts` — dokuz ayrı fark
  sınıfı (mesafe farkı · varlık çelişkisi · tek taraflı · ortak bilgisizlik ·
  belirsizlik · karşılaştırılamaz…); "fark" tek kova DEĞİL. (3)
  `shadow/cehShadowRuntime.ts` — ego/ufuk tikine bağlı, **timer/abonelik YOK**,
  yan etki yapısal olarak **0**. (4) `shadow/cehGuardianShadowAdapter.ts` —
  Guardian'ın hiçbir sağlayıcısını/kuralını/motorunu çağırmaz; `RawMapData`
  ÜRETMEZ (yanlışlıkla bağlanamasın diye). (5) `shadow/cehSuppressionContract.ts`
  — bastırılan olay için `validUntil`/defer semantiği (bugün yalnız gölgede
  tüketiliyor; `guardianAlertRanker` davranışı DEĞİŞMEDİ). (6)
  `shadow/cehCutoverGate.ts` — **varsayılan KAPALI**, altı şart üç değerli,
  **ölçülmemiş şart kapıyı AÇMAZ**.

  **Üretim otoritesi (değişmedi):** Guardian uyarısı → legacy
  `guardianRuntime` zinciri · sesli yönlendirme → `voiceGuidanceRuntime`
  (`owner: 'NAV_SESSION_RUNTIME'`) · manevra mesafesi → `routingService` ·
  hız limiti → `speedLimitService` / `useEffectiveSpeedLimit`.

  **Dürüstlük sınırı (ölçülerek beyan):** CEH öznitelik portu HÂLÂ BAĞLI DEĞİL
  (`productionHorizonAttributePorts === UNAVAILABLE_HORIZON_ATTRIBUTE_PORTS`) →
  denetim/limit/viraj/eğim alanlarında CEH iddia ÜRETMEZ. Bugün gerçekten
  karşılaştırılabilen TEK alan **manevra**dır. Limit/viraj/eğim ise üretimde
  "İLERİDE" sorusunu cevaplayan otorite OLMADIĞI için `NOT_COMPARABLE` sayılır
  ve **oranın paydasına girmez** — hiç sormayarak %100 uyum kazanmak yasaktır.

  **Bilinçli ödünç (F6'ya devredildi, gerekçeli) — ①② 2026-09-04'te F6'DA
  KAPATILDI, ③ AÇIK:** ① CEH denetim-noktası
  öznitelik portu bağlanmadı — bağlamak için "ego kenarından ileriye bounded
  koridor genişletme + kenar-bazlı denetim noktası indeksi" gerekir; ikisi de
  bugün YOK ve yarısını yapmak yarım mantık bırakırdı. ② Çok adımlı ağ mesafesi
  EKLENMEDİ — ①'siz gerçek bir CEH tüketici senaryosu yok, dolayısıyla
  "bütçesiz/kanıtsız özellik ekleme yasak" kuralı gereği eklenmedi.
  ③ `guardianAlertRanker` hâlâ `validUntil` taşımıyor (sözleşme kuruldu,
  davranış parite kanıtı olmadan değiştirilmedi).

  **Doğrulama:** `tsc -b` temiz · `navV3CehShadowF5.test.ts` **69 kilit**
  (14 mimari kilit dâhil) · F0–F4 paketleri **309 PASS** · regresyon kasası
  **972 PASS** · Guardian/guidance/oturum paketleri **345 PASS** · LAB alan
  denetimi yeşil · değişen dosyalarda lint temiz.
  Hüküm: **`F5 CODE PASS`** — `F5 FIELD PASS` YAZILAMAZ (saha ölçümü yok).
  ⚠️ **F6 blocker'ı:** cutover kapısı `F4_FIELD_VALIDATION` şartı ölçülmediği
  için KAPALIdır; kütük #1232–#1243 gerçek araçta gözlenmeden hiçbir tüketici
  CEH'e taşınamaz.

- **NAV-V3-F4 · Navigasyon v3 — L1/L2 topoloji aktivasyonu (RTG2 okuyucu + canlı yol eşleşmesi) (2026-09-03):**
  Durum: **ENTEGRE (L1 kenar/topoloji gerçeği + L2 canlı eşleşme)** — saha kanıtı
  YOK, **ÜRÜN HAZIR: HAYIR**. Kütük: 🔴 **#1232** (okuyucu taşındı) · 🔴 **#1233**
  (routing paritesi) · 🔴 **#1234** (graf sakinliği/bellek) · 🔴 **#1235** (kenar
  metadatası) · 🔴 **#1236** (topoloji portu) · 🔴 **#1237** (aday üretimi) ·
  🔴 **#1238** (geometri sınırı) · 🔴 **#1239** (canlı MatchedRoadPose) ·
  🔴 **#1240** (CEH fiziksel doğrulama) · 🔴 **#1241** (bozuk graf fail-closed) ·
  🔴 **#1242** (kalibrasyon) · 🔴 **#1243** (kod kapanışı ≠ saha hükmü).
  Belge: `docs/NAVIGATION_ARCHITECTURE_SPEC_v3.md` → F4 bölümü.

  **KAPATILAN BLOCKER (F1/B2):** `RTG2` ayrıştırma mantığı
  `NavigationCompute.worker.ts` İÇİNDE gömülüydü. Bu yalnız bir konum sorunu
  değildi: ana iş parçacığı grafı okuyamadığı için `MapStore.getEdgeMetadata`
  daima `UNAVAILABLE` dönüyor, aday üretilemiyor, `MatchedRoadPose` doğmuyor ve
  F3 CEH fiziksel doğrulama yapamıyordu — **zincirin tamamı tek dosyanın içinde
  kilitliydi.** Ayrıştırma tek kanonik okuyucuya (`map/graph/rtg2Reader.ts`)
  taşındı; worker da AYNI okuyucuyu kullanıyor. Böylece F2/C3 ve F3/D3 borçları
  da kapandı.

  **BINARY FORMAT DEĞİŞMEDİ:** yeni sürüm çıkarılmadı, artefakt yeniden
  üretilmedi, üretici betiğe dokunulmadı. Gerçek artefakt ölçülerek doğrulandı:
  **7 651 542 bayt · 238 252 düğüm · 295 346 kenar** (%75'i tek yönlü);
  sınıf dağılımı 1→8 013 · 2→73 099 · 3→52 169 · 4→111 639 · 7→50 426.

  **ROUTING PARİTESİ (en riskli nokta, ölçülerek kapatıldı):** A*'ın eşit
  maliyetli rotalar arasındaki seçimi komşu SIRASINA bağlıdır. Nesne grafiği
  bitişik CSR yapıya taşınırken bu sıra birebir korundu ve parite testi
  **gerçek graf üzerinde** eski gösterimi yeniden kurup karşılaştırıyor: aynı
  komşu sırası · aynı düğüm dizisi · aynı mesafe · aynı ulaşılabilirlik.
  A*, `HEURISTIC_WEIGHT = 1.2` ve `MAX_CLOSED` DEĞİŞMEDİ; worker rota YÜRÜTME
  sahibi olarak kaldı.

  **L1 cephesi genişledi:** `getEdgeTopology` (komşuluk — **yalnız kanonik
  `EdgeId` ile**, ham düğüm indeksi L1 dışına ÇIKMAZ) · `queryEdgesNear`
  (yarıçap sorgusu) · `networkDistanceM`. **Zorla en yakın yola snap yapısal
  olarak imkânsız:** yarıçap dışı kenar sonuca girmez ve boş sonuç bir
  ÖLÇÜMDÜR (`NO_COVERAGE`), ölçülmemişlikten (`NOT_MEASURED`) ayrıdır.

  **Dürüstlük sınırı (format):** `RTG2` ara poliline geometrisi TAŞIMAZ —
  kenar iki düğüm arası DÜZ segmenttir; hız limiti · yol adı · şerit · eğim ·
  viraj yarıçapı bu binary'de YOKTUR ve UYDURULMAZ. `roadClass = 0` bir sınıf
  değil "BİLİNMİYOR"dur.

  **Bellek/güç:** graf uygulama açılışında yüklenmez; navigasyon oturumuyla
  alınır ve bırakılır (jiro beslemesiyle aynı desen). Komşuluk · ters komşuluk ·
  yakınlık indeksi TEMBEL kurulur; görünüm `WeakRef`te tutulur.

  **Bilinçli ödünç (beyan):** CEH hâlâ **hiçbir ürün kararını beslemiyor** —
  F5'e devrediyor. Guardian denetim-noktası tüketicisi taşınmadı (E2), ufuk
  öznitelik portu bağlanmadı (E3 — ADAS verisi bu binary'de yok), çok adımlı
  ağ mesafesi üretilmiyor (E5 — hot-path bütçesi).

  **Doğrulama:** `tsc -b` temiz · `navV3GraphTopologyF4.test.ts` **69 kilit**
  (gerçek artefakt üzerinde parite dâhil) · regresyon kasası **+6 kilit**
  (972 PASS) · F0–F3 paketleri yeşil · navigasyon/LAB paketleri yeşil ·
  değişen dosyalarda lint temiz.
  Hüküm: **`F4 CODE PASS`** — `F4 PASS` YAZILAMAZ (saha ölçümü yok).
  ⚠️ **F5 için saha ön koşulu:** tüketiciler CEH'in fiziksel hükmüne
  güvenecektir; eşleşme doğruluğu (#1237 · #1239 · #1240) ölçülmeden ürün
  kararlarını CEH'e bağlamak, ölçülmemiş bir eşleşmeyi uyarı üretmekte yetkili
  kılmak demektir.

- **NAV-V3-F3 · Navigasyon v3 — L3 CEH / Electronic Horizon + canlı ego (2026-09-03):**
  Durum: **İSKELET → ENTEGRE (L3 ufuk otoritesi + L2 canlı akış)** — saha kanıtı
  YOK, **ÜRÜN HAZIR: HAYIR**. Kütük: 🔴 **#1220** (canlı ego) · 🔴 **#1221**
  (jiro işaret öğrenme) · 🔴 **#1222** (orientation ömrü) · 🔴 **#1223** (CEH
  otoritesi) · 🔴 **#1224** (niyet ≠ fiziksel gerçek) · 🔴 **#1225** (belirsizlik)
  · 🔴 **#1226** (UNKNOWN ≠ NONE) · 🔴 **#1227** (bayat ego) · 🔴 **#1228**
  (tünelde jiro) · 🔴 **#1229** (LAB yüzeyi) · 🔴 **#1230** (kalibrasyon) ·
  🔴 **#1231** (kod kapanışı ≠ saha hükmü).
  Belge: `docs/NAVIGATION_ARCHITECTURE_SPEC_v3.md` → F3 bölümü.

  **ÖLÇÜLEN VE KAPATILAN KUSUR — F2 üretimde ÖLÜYDÜ:** `egoAuthority.observe()`
  `src/` içinde **hiçbir üretim çağrısına sahip değildi**. EKF/HMM çekirdeği
  kuruluydu, testleri yeşildi ve sahada **hiç çalışmıyordu** — yani kütükteki ego
  maddeleri ölçülemez durumdaydı. Aynı şekilde `yawRateRadPerSec` sabit `null`dı.
  F3 ikisini de canlı akışa bağladı: tik sahibi `navigationSessionRuntime` hem
  gerçek GPS fix'inde hem 1 Hz DR tick'inde `tickEgoHorizon()` çağırır —
  **yeni GPS aboneliği YOK, yeni timer YOK** (kilit: navigasyon ağacında
  `onGPSLocation(` tam 1 dosyada, `subscribeMotion(` tam 1 dosyada).

  **L3 CEH (`navigation/horizon/`)** — "önümde ne var?" sorusunun TEK cevaplayıcısı:
  - `cehAuthority` timer/abonelik SAHİPLENMEZ; monotonik saat yoksa hiçbir ufuk
    yayınlamaz; her ufuk MONOTONİK artan `generation` taşır (eski ufuk yeni
    sanılamaz).
  - **Rota niyeti İTİLİR, çekilmez.** F0 bağımlılık yasası yönlüdür (`L4 → L3`);
    L3'ün `routingService`i import etmesi grafiği DÖNGÜLÜ yapardı. Niyeti
    bileşim kökü (`navEgoHorizonBridge`) taşır → `horizon/**` ağacında tek bir
    L4 importu bile yoktur (kilit).
  - **Niyet ≠ fiziksel gerçek (pazarlıksız):** "rota var → araç bu yolda"
    çıkarımı yapısal olarak reddedilir. Rota kolu `ROUTE_INTENT` kökeni taşır,
    `physicallyConfirmed = false` kalır, güveni **0,6 tavanını aşamaz** ve ufuk
    `HORIZON_AVAILABLE` değil `HORIZON_PARTIAL`dır.
  - **Zorla MPP YASAK:** fiziksel eşleşme rotayla çelişirse (L4'ün KENDİ sapma
    eşiği ile ölçülür) iki kol da korunur ve `mppPathId = null` olur.
  - **UNKNOWN ≠ NONE:** öznitelik portu (limit · viraj · eğim · denetim noktası)
    kuruldu ama **bilinçli olarak BAĞLANMADI** — Guardian'ın mevcut denetim-noktası
    hesabının yanına ikinci bir hesap koymak paralel otorite olurdu. Boş nesne
    listesi "ileride bir şey yok" DEĞİL, "ölçülmedi" demektir (tipte ayrı).

  **Jiro (F2 borcu C1) — eksen ÖLÇÜLÜR, işaret ÖĞRENİLİR:** sapma ekseni açısal
  hız vektörünün yerçekimi eksenine izdüşümüdür (montajdan bağımsız, varsayım
  değil vektör cebiri). İzdüşümün İŞARETİ platforma bağlı olduğu için sabit
  varsayılmaz; GNSS yön değişimiyle korelasyondan öğrenilir (≥15° dönüş + oran
  bandı + 2 ardışık tutarlı karar) ve kanıt gelene kadar sapma hızı `null`
  kalır. **Yanlış işaret, jirosuz çalışmaktan daha kötüdür** (fail-closed).
  Abonelik L2'de değil runtime kenarındadır; oturum kapanınca hem abonelik hem
  öğrenilen işaret düşer (cihaz başka açıyla takılmış olabilir).

  **Gözlemlenebilirlik:** yeni ekran AÇILMADI — mevcut `Navigation Core` ekranı
  **16 · L2 Ego · L3 Ufuk** kartıyla genişletildi (LAB yüzey politikası). Kart
  komut göndermez, kendi hükmünü üretmez, **koordinat taşımaz**; 14 alanın
  tamamı alan denetimi kaydına bağlandı.

  **Bilinçli ödünç (beyan):** CEH bugün **hiçbir ürün kararını beslemiyor** —
  gözlem fazındadır (D4). Guardian'ın denetim-noktası tüketicisi F5'te TEK
  hamlede taşınacak (D1). Kol topolojisi F1/B2 kapanmadan kurulamaz (D3) →
  **F4'ün tek gerçek blocker'ı budur.**

  **Doğrulama:** `tsc -b` temiz · `navV3HorizonF3.test.ts` **66 kilit** ·
  regresyon kasası **+6 kilit** (966 PASS) · F0/F1/F2 paketleri (1115) yeşil ·
  navigasyon oturum/DR/LAB paketleri (11 dosya / 319 + 47) yeşil · değişen
  dosyalarda lint temiz. **Mevcut navigasyon davranışı DEĞİŞMEDİ.**
  Hüküm: **`F3 CODE PASS`** — `F3 PASS` YAZILAMAZ (saha ölçümü yok).

- **NAV-V3-F2 · Navigasyon v3 — L2 Ego/Localization (EKF + HMM) (2026-09-03):**
  Durum: **İSKELET → ENTEGRE (L2 çekirdeği)** — saha kanıtı YOK,
  **ÜRÜN HAZIR: HAYIR**. Kütük: 🔴 **#1212** (monotonik zaman) · 🔴 **#1213**
  (EKF) · 🔴 **#1214** (DR iki tavan) · 🔴 **#1215** (HMM) · 🔴 **#1216**
  (aday sınırı) · 🔴 **#1217** (tek L2 otoritesi) · 🔴 **#1218** (mimari
  kilitler) · 🔴 **#1219** (saha kapanış listesi).
  Belge: `docs/NAVIGATION_ARCHITECTURE_SPEC_v3.md` → F2 bölümü.

  **F2.0 — ÖLÇÜLEN VE KAPATILAN KUSUR (F1 borcu B4):** `offlineRoutingStatus`
  yalnız `Date.now()` damgası taşıyordu ve ARCH-01 runtime adaptörü bu
  **duvar saatiyle** yaş hesaplıyordu. Araçta akü kesintisi/NTP düzeltmesi
  saati geriye attığında bu hesap **sessizce yanlışlanır**. Artık monotonik
  damga (`lastAttemptAtMonoMs`) taşınıyor ve navigasyon tazeliği YALNIZ onu
  kullanıyor. NAV v3'ün tek monotonik saat okuma noktası kuruldu
  (`navigation/time/navClock.ts`) — `performance.now` yoksa **sahte sayaç
  üretilmez**, `null` döner ve hiçbir poz yayınlanmaz. F1 borcu **B7** (bayat
  docblock) da kapatıldı.

  **EKF ego füzyonu** (`navigation/ego/egoKalman.ts`, SAF):
  `x = [pE, pN, ψ, v, b_ω]` — v2 §3.1 ile birebir. Geodezi için ikinci otorite
  KURULMADI (`geo.ts` ile aynı R). **Yeni sensör uydurulmadı** — yalnız
  GNSS konum/hız/yön, araç bus hızı ve ZUPT. Kapılar: doğruluk > 50 m RED ·
  Mahalanobis `d² > 9.21` RED · doğruluk bilinmiyorsa RED · durakta GNSS yönü
  reddedilir. **Reddedilen ölçüm başarı sayılmaz** — aynı durum nesnesi geri
  döner (kilit referans eşitliğini denetler). Belirsizlik büyümesi durumun
  parçasıdır; jiro yokken yön σ'sı daha hızlı büyür.

  **DR iki bağımsız tavanla sınırlı:** ① süre `DR_TOTAL_MAX_MS = 90 sn`
  (spec invaryantı, kilitli) · ② **belirsizlik** — 90 sn tek başına yeterli
  güven şartı DEĞİLDİR; σ eşiği aşarsa mod **daha erken** düşer. Eşikler
  uydurulmadı, deponun sabitlerinden türetildi: `50 m = GNSS_ACCURACY_REJECT_M`
  ("reddedeceğimiz bir ölçümden kötüysek karar kalitesinde değiliz") ve
  `95 m = CORRIDOR_BASE_M + CORRIDOR_ACC_CAP_M` (eşleştirme koridoru tavanı).
  σ ölçülemezse kötümser. **Güven yalnız σ'dan gelir — "GPS var → güven 1"
  yapısal olarak üretilemez.**

  **HMM/Viterbi yol eşleştirme** (`navigation/matching/hmmMatchModel.ts`, SAF):
  emisyon + yön cezası (yalnız ikisi de biliniyorsa), geçiş terimi ağ mesafesi
  bilinmiyorsa UYGULANMAZ (uydurma mesafe yasak), pencere `W=10` sınırlı,
  aday tavanı 8, yayın gecikmesi `L=2` (yayınlanmış akış değişmez — v2 P8).
  **Zorla snap yapısal olarak imkânsız:** `candidate` yalnız `MATCHED` iken
  dolu; `AMBIGUOUS`/`INSUFFICIENT_METADATA`/`NO_CANDIDATES` → **null**.
  ⚠️ `σ_z` ve `β` kalibre EDİLMEDİ — saha kaydından yeniden kestirilmeden
  üretim değeri sayılmaz.

  **Aday üretimi yalnız L1 sınırından** (`matching/roadCandidateSource.ts`):
  raw graph binary · tile store · MapLibre · routing worker internals ·
  Overpass — beşi de kaynak taramasıyla YASAK. **Üretimdeki dürüst durum:**
  F1 borcu B2 açık olduğu için (RTG2 okuyucusu worker içinde) bugün aday
  üretilemiyor → `MatchedRoadPose.matchState = 'UNAVAILABLE'`, `edgeId = null`.
  Bu bir gerileme değil — bugün de ağ-göreli eşleştirme yoktu; motor ve sınır
  kuruldu, aday akışı F4'te açılacak.

  **Tek L2 otoritesi** (`navigation/ego/egoAuthority.ts`): F0'ın
  `RealtimeEgoPose`/`MatchedRoadPose` tiplerinin **tek üreticisi** (F0'da tip
  vardı, üretici yoktu). Dört kanıt kaynağı ayrı taşınıyor; map-lock koruması
  (`rawPose` daima dolu) yapısal. **İkinci otorite yok:** rota-göreli
  `mapMatchModel` (L4 ilerleme zincirinin sahibi) DEĞİŞTİRİLMEDİ ve L2
  ağacındaki hiçbir dosya `matchToRoute` içermiyor (kilit).

  **Açık borçlar (kayıtlı):** jiro beslenmiyor — abonelik sahipliği gerektirir
  (F3) · `observe()` üretimde çağrılmıyor, tik sahipliği ayrı tur (F3) ·
  aday akışı yok (F4) · σ_z/β/gürültü parametreleri kalibre edilmedi (saha) ·
  ARCH-01 runtime adaptörü hâlâ duvar saatiyle yaş gösteriyor (ayrı domain).

  **Doğrulama:** `tsc -b` temiz · `navV3EgoLocalizationF2.test.ts` **77 kilit** ·
  regresyon kasası **+4 kilit** · navigasyon test dosyaları (24 dosya / 611)
  yeşil · değişen dosyalarda lint temiz. **Runtime davranışı DEĞİŞMEDİ** —
  L2 üretimde henüz çağrılmıyor.

- **NAV-V3-F1 · Navigasyon v3 — L1 MapStore / Map Truth Authority (2026-09-03):**
  Durum: **İSKELET → ENTEGRE (L1 sınırı)** — saha kanıtı YOK, **ÜRÜN HAZIR: HAYIR**.
  Kütük: 🔴 **#1208** (karo matematiği tek kaynağa indi) · 🔴 **#1209** (L1 cephesi) ·
  🔴 **#1210** ("ölçülmedi" ≠ "yok") · 🔴 **#1211** (`EdgeId` precision-safe).
  Belge: `docs/NAVIGATION_ARCHITECTURE_SPEC_v3.md` → F1 bölümü.

  **ÖLÇÜLEN VE KAPATILAN KUSUR — aynı karo formülü ÜÇ YERDE, üç FARKLI davranışla:**
  `mapTileProbe.ts:11` sonucu `[0,n-1]`e kırpıyordu, `CorridorSyncEngine.ts:48`
  `1 << z` kullanıp `z ≥ 31`de NEGATİF üretiyordu, `offlineTileDownloader.ts:82`
  `2 ** z` ile kırpmıyordu. Üçü "aynı" matematiği iddia ediyordu. Karo kimliği
  yanlışsa "bu bölge önbellekte var" hükmü de yanlıştır. Tek kaynak
  `navigation/map/store/tileGrid.ts`; üç çağıran delege edildi, **sayısal
  sonuçları BİREBİR korundu** (eski gövdeler kilit testte referans kâhin).

  **L1 MapStore (`navigation/map/store/`)** — statik harita gerçeğinin TEK cephesi:
  - `getDatasetStatus` · `hasTile` · `getEdgeMetadata` · `getSnapshot`, hepsi F0
    `Evidenced<T>` döner. `MapDataPorts` arayüzü gerçek kaynakları cepheden ayırır;
    **mevcut altyapı SİLİNMEDİ — SARILDI** (`offlineRoutingStatus` graf yeteneği
    otoritesi · `mapSourceStore` karo deposu). Hiçbir kaynak başlatılmaz/tetiklenmez.
  - **Timer YOK · abonelik YOK · saat okuma YOK** (`nowMonoMs` çağırandan gelir).
  - **Kendi bozulma otoritesini KURMAZ:** L1 yalnız epistemik durum üretir;
    `NavDegradation` eşlemesi çağıranın işidir.
  - **Köken maskesi** (`MapSourceMask` bitset) eklendi — kanıt sınıfının KOPYASI
    değil, `Evidenced<T>` ile BİRLİKTE taşınır.

  **Beş hâlli dürüstlük:** `AVAILABLE_FRESH` · `AVAILABLE_STALE` · `UNAVAILABLE` ·
  `INVALID` + **"hiç ölçülmedi"**. Ölçülen gerçek: `initializeMapSources()` üretimde
  **hiç çağrılmıyor** (`MapCore.ts:44` yazıyor) → `hasOfflineMapData()` `false`
  dönüyordu; bu "karo yok" DEĞİL "ölçülmedi"dir ve artık ayrılıyor. Kökensiz
  kesinlik ve tanımsız eşikle bayatlık üretimi YASAK (kilitli).

  **`EdgeId` geçişi — gerçek artefakt ölçüldü:** `routing-graph.bin` = `RTG2`,
  **238 252 düğüm · 295 346 kenar · 7 651 542 bayt**. Monolit graf için
  `tileId = 0xFFFFFFFF` nöbetçisi + kenar sıra numarası; ölçülen kenar sayısı
  23-bit kimlik uzayının %3,5'i (~28× başlık). Sessiz truncate YASAK →
  `RangeError`. **Binary format DEĞİŞMEDİ, worker okuyucusu TAŞINMADI, A* hâlâ
  `number` düğüm indeksleriyle çalışıyor.**

  **Açık borçlar (kayıtlı):** karo-başına envanter yok → `hasTile` üretimde
  `UNAVAILABLE` (F3) · kenar metadatası okunamıyor, okuyucu worker içinde (F4) ·
  POI yetenek otoritesi yok (F3/F4) · `offlineRoutingStatus` duvar saati taşıyor,
  monotonik tazelik yapılamıyor (F2) · harita paketi için tanımlı TTL yok, bu
  yüzden `AVAILABLE_STALE` üretimde erişilemez (F3).

  **Doğrulama:** `tsc -b` temiz · `navV3MapStoreF1.test.ts` 44 kilit ·
  regresyon kasası +3 kilit · harita/karo/rota/navigasyon testleri (33 dosya / 649)
  yeşil · değişen dosyalarda lint temiz. **Runtime davranışı DEĞİŞMEDİ.**

- **NAV-V3-F0 · Navigasyon v3 — Mimari Kilit + Çekirdek Sözleşmeler (2026-09-03):**
  Durum: **İSKELET** (sözleşme omurgası) — saha kanıtı YOK, **ÜRÜN HAZIR: HAYIR**.
  Bağlayıcı hedef mimari: `docs/NAVIGATION_ARCHITECTURE_SPEC_v3.md`
  (`CAROS-NAV-ARCH-SPEC-3.0`); v2 baseline/geçiş referansı.
  Kütük: 🔴 **#1205** (kanonik sözleşme omurgası) · 🔴 **#1206** (mimari guard'lar) ·
  🔴 **#1207** (davranış değişmedi).

  `src/platform/navigation/contracts/**` — dokuz saf sözleşme dosyası:
  - **Katman bağımlılık yasası** (`navLayers.ts`): L1 MapStore · L2 Ego · L3 CEH ·
    L4 Routing · L5 Guidance · L6 Arbitration · L7 Presentation · L8 Outcome.
    Döngüsüz; **L4–L6 MapStore'a (L1) DOKUNAMAZ** — yol gerçeğini L3'ten alır.
  - **`Evidenced<T>` kanıt sözleşmesi** (`navEvidence.ts`): değer + `EvidenceGrade`
    (`OBSERVED·DERIVED·UNAVAILABLE·STALE` — `sessionInspectorModel.Observability`
    ile **birebir**, paralel tip YOK) + kaynak + gerekçe + güven + monotonik
    gözlem anı + tazelik bütçesi. `UNAVAILABLE`→güven ≤ 0.3, `STALE`→ ≤ 0.5
    (kurucular zorlar).
  - **Kanonik bozulma matrisi** (`navDegradation.ts`): `FULL · NO_TRAFFIC ·
    NO_NETWORK · STALE_MAP_DATA · NO_MAP_DATA · NO_POSITION · SAFE_STOP` — her
    seviyenin hangi iddiaları susturduğu **TEK** matriste; kümülatif.
  - **Ego semantiği** (`navEgoPose.ts`): `RealtimeEgoPose` (ham, yola oturmamış)
    ↔ `MatchedRoadPose` (grafiğe oturmuş TÜREV; ham pozu **DAİMA** taşır —
    map-lock koruması). Algoritma YOK.
  - **JS-güvenli `EdgeId`** (`navEdgeId.ts`): `{hi, lo}` iki uint32 —
    `tileId(32)|localIdx(23)|dir(1)` = 56 bit JS'in 53-bit güvenli sınırını aşar;
    hiçbir ara sayı 2^32'yi geçmez.
  - **Monotonik zaman** (`navMonotonicTime.ts`): `MonotonicMs`/`WallClockMs` marka
    tipleri; navigasyon süre/yaş/tazelik hesabında `Date.now()` YASAK.
  - **L8 Outcome CONTRACT'ı** (`navOutcomeContract.ts`): tahmin/gözlem/geçiş
    kavramları — **öğrenme/geri besleme YOK**; gözlem otoritatif harita gerçeğini
    EZEMEZ (`NAV_OUTCOME_CONTRACT.canWriteAuthoritativeMap = false`).
  - **`VehicleEvidenceBus`** (`vehicleEvidenceBus.ts`): yalnız arayüz; acquisition
    authority bağlanana kadar **fail-closed `UNAVAILABLE`**. CAN mimarisi
    DEĞİŞMEDİ.

  **Aktif mimari guard'lar:** `contracts/**` saflığı (dosya-tabanlı tarama) ·
  kanonik sembol tek dosyada (ikinci authority yok) · L4 truth sahipleri ham
  kaynak import etmez · bağımlılık yasası döngüsüz.
  **Bilinçli ertelenen (açık borç):** tam L4–L6 taraması → F3 · `components/map/**`
  timer/abonelik yasağı → F5.

  **Doğrulama:** `tsc -b` temiz · `navV3ContractsF0.test.ts` 34 kilit · regresyon
  kasası (+2 kilit) · ilgili navigasyon testleri (19 dosya / 426) yeşil · değişen
  dosyalarda lint temiz. **Üretim kodu davranışı DEĞİŞMEDİ** — sözleşme dosyaları
  runtime tarafından import edilmiyor.

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
  | **Kurtarma merdiveni (`recovery-monitor`)** | ✅ **KAPATILDI (2026-08-21, kütük #689)** — `PLACEHOLDER→AVAILABLE` | Borç kapandı: merdivenin sekiz kapısı **kod sırasıyla**, **ilk DURDURAN kapı** adıyla, kullanılan deneme/tavan, ardışık sessizlik ve eşiği, sıradaki/son basamak, cooldown kalanı, native ATPC sayaçları + **kanıt yaşı**, reconnect yaşam döngüsü ve kopma defterinden **ölçülmüş** kurtarma süresi artık sahada GÖRÜNÜYOR. Motorun tek çıktısı `console.info` idi. **Asıl kazanım:** ekran aktif protokolde kurtarmanın **SAHİBİNİ** söyler (CAN merdiveni ↔ native ATPC) — *"kurtarma çalışmıyor"* sanılan vakaların çoğu aslında *"bu protokolde o motor bilerek devre dışı"*dır. **Yeni sayaç üretilmedi**; `getEcuRecoveryLadder()` mevcut durumdan türetir. **Kalan borç:** saha koşumu yapılmadı (#689 kabul ölçütleri 🔴). |
  | UDS Gezgini · Kıyaslama | Ekran PLACEHOLDER (İKİSİ DE BİLİNÇLİ) | **Araç Çağrısı bu listeden ÇIKTI** — 2026-08-21'de açıldı (kütük #694): telemetri zaten üretiliyordu, çağırana dönüp kayboluyordu. Kalan ikisi **gözlemlenebilirlik borcu DEĞİLDİR**: `uds-explorer` istek ÜRETEN bir gezgindir ve güvenlik incelemesi olmadan yazılmaz (Faz A2); `benchmark` motoru gerçekten yoktur ve ölçüm için araca/sisteme YÜK BİNDİRMESİ gerekir — bu, `stress-test` ile aynı güvenlik gerekçesine girer. İkisi de "yazılmayı bekleyen ekran" değil, **bilinçli kapsam kararı**dır. |
  | **Fleet sunucu köprüleri** | ✅ **KISMEN KAPATILDI (2026-08-21, kütük #691)** — 1/6 bağlandı, 5/6 yetki sınırı olarak BEYAN EDİLDİ | Kök neden ölçüldü: head unit'in kullanıcı OTURUMU yok, yalnız cihaz API anahtarı var. `get_active_driver_assignment` **anon GRANT** taşıyor → **`fleet-driver-identity` gerçekten bağlandı** (`fleetReadbackService`: trip başına TEK çağrı, timer YOK, eşleşmemiş cihazda ağa çıkmaz). Diğer beşi `authenticated` istiyor (`list_vehicle_presence_history` `anon`'u AÇIKÇA REVOKE ediyor) → **bozuk değil, bu cihazın yetkisinde değil**; şirket kapsamlı yönetici verisi. **`anon` GRANT açılmadı (bilinçli):** açmak sürücü karakterini ve tüm filo içgörüsünü araçtaki herkese verirdi. Beş ekran artık `FleetScopeNotice` ile uç · GRANT · otorite · gerekçe gösteriyor → "boş ekran" ile "yetki dışı ekran" ayrıldı. Kilit tabloyu migration GRANT'lerine bağlar (belge koddan sapamaz). **Kalan borç:** saha koşumu (#691 🔴) · `fleet-driver-authentication` için üretici donanım (NFC/PIN/BT) hâlâ yok. |
  | **Adres sağlayıcı katmanı (`geocodingProviders` · BYOK)** | ✅ **KAPATILDI (2026-08-11, kütük #543)** — LAB ekranı **Adres Arama Kanıtı** (`address-search-evidence`) açıldı | Borç kapandı: cevabı ÜRETEN katman (premium/Nominatim/gevşetilmiş/Overpass/cihaz-içi/önbellek), kullanıcının SEÇİP SEÇMEDİĞİ, başarısızlık sebep sınıfı + `confidence`, iki yüzeyin ayrışması ve eksik kanıt sayacı artık sahada GÖRÜNÜYOR. **Gizlilik sınırı korundu:** sorgu metni hiç saklanmıyor (yalnız `AddressQueryShape` bayrakları), anahtar değeri ve koordinat taşınmıyor. **Kalan borç (ölçüldü, düzeltilmedi):** ürün "veri OSM'de var mı" sorusunu SORMUYOR → `GROUND_TRUTH` kanıt boşluğu; sorgunun ayrıştırıcıda bozulup bozulmadığı ölçülmüyor → `QUERY_INTEGRITY` boşluğu. |
  | **Servis kalp atışı izleyicisi (`SystemHealthMonitor`)** | **Motor var + `getHeartbeatEvidence()` export'u var, LAB ekranı YOK** | Servis başına **beat yaşı · eşik · saat tabanı · alarm/recovered sayısı** hiçbir LAB ekranında gösterilmiyor; `LongRoadFieldValidationScreen` yalnız türetilmiş "GPS kaybı olayı / en uzun kayıp" sayaçlarını gösteriyor. Sonuç: sahte alarm ile gerçek kesinti **ancak `cl_crash_log` ham kaydı elle okunarak** ayrılabildi (2026-08-02, kütük #327). Borç bu turda KAPATILMADI — GPS beat kaynağı DEĞİŞİM'den VARIŞ'a taşındı ama gözlem yüzeyi hâlâ yok. |

  Katalog kapsamı bugün: **55 AVAILABLE · 2 PLACEHOLDER · 2 DISABLED** (59 araç)
  — sayılar `carosLabCatalog.ts`ten SAYILDI (2026-08-21). Buradaki eski
  "18 · 8 · 2 (28)" ve "41 · 7 · 2 (50)" ifadeleri koddan sapmıştı: elle artırılan
  bir sayı sessizce yanlışlaşır, o yüzden bir daha artırma — SAY.
  Aynı turda **katalog ↔ ekran haritası ayrışması ölçüldü: 51/51, fark YOK**
  (`AVAILABLE` diyip ekranı olmayan tek araç bile yok — host kilidi mevcut; 2026-08-21 son ölçüm **55/55**).
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


### ARCH-05 — Security / Trust / Capability · ÜRETİM YAPTIRIMI (2026-09-01)

**Durum: ENTEGRE** (QA/full-suite yeşil). **SAHADA DOĞRULANDI DEĞİL** — kütük
#205–#210 maddeleri 🔴'dır ve bu bölüm onları YÜKSELTMEZ.

**Çözülen asıl kusur:** ARCH-05 sözleşmesi (`security/authorization.ts`) güçlüydü
ama **hiçbir üretim yoluna bağlı değildi**. Bağlanmamış bir sözleşme güvenlik
değildir; bu tur o boşluğu kapatır.

**Kurulan tek yeni katman:** `security/enforcement.ts` — bir ADAPTÖR'dür, motor
değil. Karar kuralı hâlâ TEK yerdedir (`authorize`); burada yalnız kanıt
toplanır: principal sınıfı, araç kapsamı (`capabilityStore`), doğrulanmış hareket
(`obdService.getObdSpeedFresh` — **GPS hızı buraya giremez**) ve native yüzey
kanıtı (alan sahibinin kendi ölçümü).

**Yetki gerçeği tek tabloda (`PRINCIPAL_GRANTS`):**

| Çağıran sınıfı | Yetkiler |
|---|---|
| `LOCAL_UI` | MEDIA · NAVIGATION · VEHICLE_READ · DIAGNOSTIC_READ · CLEAR_DTC · SETTINGS_WRITE · STORAGE_ADMIN · HARDWARE_MEDIA |
| `MAVI` | MEDIA · NAVIGATION · VEHICLE_READ · DIAGNOSTIC_READ |
| `PHONE_LINK` | yalnız oturumda ANLAŞILAN companion yeteneğinden türer (bugün: BOŞ) |
| `PHONE_REMOTE` | VEHICLE_READ · DIAGNOSTIC_READ · SETTINGS_WRITE (+ CLEAR_DTC yalnız E2E kanıtıyla) |
| `SYSTEM_INTERNAL` | yalnız RUNTIME_ADMIN |
| `LAB` · `REPLAY` · `IMPORTED` · `UNKNOWN` | **YOK** |

`DIAGNOSTIC_PRIVILEGED` ve `REMOTE_INPUT` **hiçbir sınıfa verilmez**
(`DENY_DEFAULT`) — bu üründe privileged teşhis desteklenmiyor ve yol yapısal
olarak kapalıdır. `MAVI_ACTION` ve `MEDIA_CAST` sözleşmede YOKTUR; LAB'da dürüst
`NOT_SUPPORTED` yazar, uydurulmaz.

**Ürün yoluna bağlanan altı kapı:** `dtcService.clearDTCCodes` (CLEAR_DTC +
TOCTOU) · `genericPduTransport.send` (teşhis sınıflandırması, native kapıdan
bağımsız birinci kapı) · `companionSessionManager.send` (`companion.control.*`) ·
`runtimeRecoverySupervisor.request` (yalnız `MANUAL_INTERNAL`) ·
`commandListener` ayar uygulama · `tripLogService.clearAllTrips` (STORAGE_ADMIN).

**Bilinçli davranış değişikliği:** sesli asistanla DTC silme artık REDDEDİLİR —
`MAVI` sınıfının `CLEAR_DTC` yetkisi yoktur. Silme yalnız ekrandaki iki aşamalı
onaydan yapılır (kütük #205, saha kabulü ayrıca ölçülecek).

**Sözleşmede yapılan üç politika düzeltmesi (gevşetme DEĞİL, döngü kırma):**
`DIAGNOSTIC_READ` artık araç kapsamı ve native izin İSTEMEZ — aracın kimliği
ancak okuyarak çözülür, kimlik şartı koymak kimliği üreten işlemi yasaklardı;
`RUNTIME_ADMIN` ve `STORAGE_ADMIN` native izin İSTEMEZ — ikisi de süreç-içi /
uygulama-özel eylemdir ve JS'ten ölçülebilir bir OS izni yoktur. Üçünde de
**yetki kapısı yerinde durur** ve native `DiagnosticServiceGate` bağımsız ikinci
kapı olarak GEVŞETİLMEDİ.

**Gözlemlenebilirlik:** CAROS LAB → Runtime → *Security / Trust / Capability*
artık gerçek üretim kararlarını gösterir (sentetik demo yok); salt-okunur,
yetki üretmez, hiçbir değeri üretim kararına geri beslemez.

**Kilitler:** `src/__tests__/arch05ProductionEnforcement.test.ts` (72 kilit,
A–M blokları) + mevcut `arch05SecurityAuthorization.test.ts` (14).


### ARCH-06/F1 — Performance Measurement + Baseline (2026-09-01)

**Durum: ENTEGRE** (hedefli doğrulama yeşil). **SAHADA DOĞRULANDI DEĞİL** —
kütük #211–#216 🔴'dır. Full suite ve production build **ARCH-06 FINAL**
kapanışına bırakıldı (faz planı gereği).

**F1'in tek işi ÖLÇMEKTİ — hiçbir optimizasyon yapılmadı.** Boot ertelemesi,
timer taşıma, CAN delta yazımı, rota/render iyileştirmesi, worker taşıma,
artwork cache tasarımı, bellek merdiveni, termal degradasyon ve storage
debounce değişimi **bilinçli olarak F2+'ya bırakıldı**.

**Kurulan ölçüm düzlemi (yeni mega depo YOK — sahip-yerel kanıt):**

| Katman | Ne ölçüyor | Sahip |
|---|---|---|
| `perfContract` | kanonik `PerfMetric` şekli · ARCH-01/F8 tazelik sözlüğü REUSE | saf sözleşme |
| `perfCounters` | **T0** 32 kapalı-listeli tamsayı sayaç | sıcak yol sahipleri |
| `bootTimingRecorder` | 12 kilometre taşı + servis süreleri (tavan 96) | SystemBoot/main.tsx |
| `perfSeriesRecorder` | **T1** fps · lag · longtask · heap (DEĞİŞTİRİLMEDİ) | mevcut |
| `canBridgeMetrics` | native CAN coalescing kanıtı (6 monotonik sayaç) | CarLauncherPlugin |
| `timerInventory` | 26 timer bildirimi + F2 kararı | statik bildirim |
| `memoryInventory` | 19 kaynak + sınıf + tavan (`targetBytes` = `null`) | statik + ucuz okuyucu |
| `hotPathLogAudit` | sıcak **BÖLGE** log riski (dosya değil bölge) | statik bildirim |
| `performanceAggregator` | **T2** salt-okunur projeksiyon (12 bölüm) | LAB açıkken |
| `perfBaselineExport` | gizlilik-güvenli JSON taban paketi | LAB düğmesi |

**Dürüstlük kararları (F1'in asıl değeri):**
- `null ≠ 0` **yapısal** olarak garanti: `NaN`/`Infinity`/`undefined` otomatik
  `UNMEASURED`'a düşer ve tazelik iddiası `UNAVAILABLE` olur.
- Ölçülemeyen metrik **listeden düşürülmez**, `UNMEASURED` olarak durur —
  "metrik yok" ile "ölçemiyoruz" ayrı şeylerdir.
- `render.gpuDroppedFrames` · `jsthread.longTaskOwner` · `memory.nativeTotalMb`
  · `timers.wakeRate` · `artwork.decodedBytes` **açıkça ölçülemez** ilan edildi;
  tarayıcının vermediği hiçbir sayı uydurulmadı.
- `INITIALIZED ≠ AVAILABLE`: alt yapının kurulması kullanılabilirlik kanıtı
  SAYILMAZ. Araç bağlı değilken `VEHICLE_DATA_FIRST_OBSERVATION` düşmez.
- Eski APK CAN metrik köprüsünü taşımıyorsa durum `NOT_SUPPORTED`; sayaçlar
  **0 gösterilmez**.

**F0 kilitli kararlarının hiçbiri geri alınmadı:** ARM tek kaynak otoritesi ·
SystemBoot tek boot otoritesi · OBD native `AdaptivePidScheduler` · GPS
`GPS_NAV_MAX_INTERVAL_MS = 500` tabanı · CAN 80 ms native coalescing (JS'e
ikinci throttle **eklenmedi**) · MapLibre kendi render loop'u · SAB/COEP
varsayılmadı · timer'lar körce ARM'e taşınmadı.

**Ölçülen ilk gerçek bulgu:** sıcak **bölge** log denetimi dört yolda da
(CAN geri çağrısı · GPS `handlePosition` · OBD veri geri çağrısı · medya
interpolasyonu) pahalı argüman deseni **bulmadı** → P0/P1 sıcak log borcu **0**.
`obdService.ts` içindeki `JSON.stringify` log'ları olay-tetikli yollardadır
(ECU kurtarma · durum geçişi · foreground resume) ve sıcak yol değildir.

**Kilitler:** `src/__tests__/arch06PerformanceMeasurement.test.ts` — 64 kilit
(A–L blokları), enstrümantasyon bütçesi (T0/T1/T2) dâhil.

**Sonraki adım: F2 (Boot + Timer Governance).** F1 çıkış kapısının 10 şartından
9'u kod tarafında sağlandı; onuncusu (**12 senaryonun gerçek cihaz baseline'ı**)
sahada alınacak — kütük #211–#216.


### ARCH-06/F2 — Boot + Timer Governance (2026-09-01)

**Durum: ENTEGRE** (hedefli doğrulama yeşil). **SAHADA DOĞRULANDI DEĞİL** —
kütük #217–#220 🔴. Full suite ve production build ARCH-06 FINAL'e ait.

**Kurulan tek yeni sınır:** `platform/boot/bootDeferral.ts` — ikinci boot
otoritesi DEĞİL. İşi `SystemBoot` teslim eder; runtime yalnız "ne zaman"
sorusunu F1'in ZATEN ölçtüğü kilometre taşlarına bağlar. Kendi rAF döngüsü,
periyodik tiki veya boot bayrağı YOKTUR; nesli `SystemBoot._diagStarts`tan
alır (yeni epoch otoritesi kurulmadı).

**Ertelenen 11 servis:**

| Tetikleyici | Servisler |
|---|---|
| `AFTER_FIRST_FRAME` | UiActivityRecorder · DiagnosticTrail |
| `AFTER_SHELL_INTERACTIVE` | RadarEngine (statik radar DB yüklemesi) |
| `AFTER_VEHICLE_CORE` | MaintenanceBrain · FuelAdvisor · VehicleClassRuntime |
| `IDLE` | CommunityService · TripUpload · FleetReadback · OtaUpdateService · PushService |

**ERTELENMEYENLER ve gerekçeleri (F0 önerisi ÇÜRÜTÜLDÜ):**
- `hydrateExpertTrustStore` — **GÜVENLİK.** `assertWritesAllowed()` ilk
  satırında `if (!s.hydrated) return;` yapar: hidrasyon bitmeden yazma kapısı
  **AÇIKTIR**. Ertelemek fail-open penceresini ilk kareye kadar uzatırdı.
  ARCH-05 invariant'ı boot hızının üstündedir.
- `startPerfSeries` — boot'un KENDİSİNİ ölçer; ertelenirse açılışın en pahalı
  penceresi ölçüm dışı kalır ve öncesi/sonrası karşılaştırması anlamsızlaşır.
- Wave 3'ün 9 VEHICLE_CORE servisi — kaynak kodun kendi yorumlarındaki sıra
  bağımlılıkları kanıtlandı ve kilitlendi: `BatteryEvidenceSource →
  BatteryVerdictService` (abonelik yakalama), `LocationEngine →
  NavigationSessionRuntime` (LIFO kapanış), `VehicleKnowledgeBase →
  VehicleLearningEvidenceBridge`.

**Timer yönetişimi:** 3 `RUNTIME_BUDGETABLE` görev ARM tik-wheel'ine taşındı
(`mapSource.ping` · `device.statusPoll` · `passenger.stateSync`), hepsi
`criticality: 'NORMAL'` + `deferIdle`. **ARM API'si genişletilmedi** —
sözlük `SAFETY | NORMAL` olarak kaldı. Söküm thunk'ı **tip düzeyinde**
zorunlu: değişken tipi artık `(() => void) | null`, yani `clearInterval`
çağırmak DERLENMEZ (sızıntı yapısal olarak imkânsız).

**Dokunulmayanlar:** OBD oturum/PID zamanlaması · native heartbeat · kamera
kare beslemesi · dashcam segmentasyonu · navigasyon DR · GPS sessizlik
izleyicisi · CAN bayatlık kapısı · medya 5 s watchdog'u. Bunlar protokol/
izleme zamanlamasıdır ve 3 Hz'lik bir wheel'e yuvarlanamaz.

**Kaldırılan:** `main.tsx`'teki gövdesi boş `obdData` dinleyicisi — her OBD
olayında bir köprü dağıtımı + JS çağrısı hiçbir şey için ödeniyordu. Geri
vites davranışı değişmedi (`canData` yolu aynen duruyor).

**Kilitler:** `bootDeferF2.test.ts` (40) + `bootTimerGovernanceF2.test.ts` (34).

**ÖLÇÜM NOTU:** bu ortam `DESKTOP_BENCH`tir. Boot iyileşmesinin gerçek
rakamı yalnız head unit'te alınabilir — **öncesi/sonrası deltası saha
kanıtıdır ve kütük #217'de beklemektedir.** Bu belge hiçbir ms iyileşmesi
İDDİA ETMEZ.


### ARCH-06/F3 — Render + Map Performance (2026-09-01)

**Durum: ENTEGRE.** **SAHADA DOĞRULANDI DEĞİL** — kütük #221–#224 🔴.

**F3'ün dürüst sonucu: harita/render katmanı ZATEN optimize edilmişti.**
Repo okunduğunda üç ayrı ölçülmüş saha düzeltmesi bulundu ve hepsi
yerindeydi:

| Mekanizma | Kanıt | Ne zaman ölçülmüş |
|---|---|---|
| Kamera epsilon dedup + "yapılan iş" idle ölçütü | `FullMapView.tsx` `CAM_EPS_M/BEAR` · `NO_WORK_IDLE_MS` | 2026-07-11 (boşta %43-212 CPU kök nedeni) |
| Çoklu WebGL bağlamı önleme | `DrawerPanel` koşullu mount | 2026-06-14 (DevTools profili) |
| Rota geometri dedup (hash + styleKey + navStatus) | `useRouteDrawingLifecycle.ts` | mevcut |

**Bu yüzden F3 hiçbir şeyi YENİDEN YAZMADI.** F0 §36 açıktır: "fazı doldurmak
için problem uydurma". F3'ün katkısı **ölçmek ve kilitlemektir**.

**F0'ın açık sorusu cevaplandı:** FullMap + MiniMap **aynı anda iki MapLibre
bağlamı yaşatmıyor** — üç ayrı yerde karşılıklı dışlama var
(`NewHomeLayout` koşullu render · `DrawerPanel` koşullu mount ·
`SplitScreen` erken dönüş). Artık bu bir İDDİA değil, `peakConcurrent`
sayacıyla **ölçülüyor**.

**Eklenen ölçüm (9 yeni sayaç + 2 yeni saf modül):**
`map.cameraTargetComputed` · `cameraDedupSkipped` · `cameraSuppressedByUser` ·
`routeGeometryDedupSkip` · `routeProgressUpdate` · 3 render sayacı +
`mapInstanceEvidence` (active/peak/created/destroyed, harita nesnesi TUTMAZ) +
`renderClassContract` (etiket, zamanlayıcı DEĞİL).

**Bilinçle ÖLÇÜLMEYEN:** bileşen render sayaçları üretim yoluna
TAKILMADI — sıcak render yolunda bir sayaç bile maliyet üretir. LAB'da
`UNMEASURED` görünür, sahte 0 gösterilmez.

**Değişmeyenler:** GPS/CAN/OBD kadansları · MapLibre render loop sahipliği ·
rAF idle-uyku davranışı · 200 ms resize pump · F2 boot/timer davranışı ·
navigasyon truth otoritesi. Global UI scheduler **kurulmadı** (yasaklı adlar
statik kilitte).

**Kilitler:** `mapRenderPerformanceF3.test.ts` — 31 kilit (A–E blokları).

**PERFORMANS İDDİASI YOK:** bu ortam `DESKTOP_BENCH`tir; hiçbir ms/FPS
kazancı iddia edilmiyor. Yapısal kanıt (dedup sayaçları, peak instance)
sahada okunacak — kütük #221–#224.


### ARCH-06/F4 — Streams + Bridge Performance (2026-09-01)

**Durum: ENTEGRE.** **SAHADA DOĞRULANDI DEĞİL** — kütük #225–#228 🔴.

**Fazın amacı akış hızlarını körce düşürmek DEĞİLDİ**: aynı truth ve aynı
alan kadansıyla daha az gereksiz köprü/JS/VDL işi yapmaktı. Kadans, nesil
kapıları ve poll otoritesi **hiç değişmedi**.

**Bulunan tek gerçek israf:** `vehicleDataLayer/index.ts` her CAN emit'inde
22 alanlı YENİ bir nesne literali tahsis ediyordu; nesne yalnız
`updateCanExtras` tarafından okunup atılıyordu. Native 80 ms penceresiyle
bu, saniyede ~12 kısa ömürlü nesne demektir. **Ön-tahsisli zarfa çevrildi** —
`CanAdapter`ın `_data`/`_tpmsBuffer` için zaten uyguladığı desen.

**Değişen-alan yaması ZATEN vardı:** `updateCanExtras` store sınırında
alan-alan karşılaştırma yapıyor, yalnız değişenleri `u`ya koyuyor ve
`dirty` değilse `set()`i **hiç çağırmıyordu**. F4 bunu değiştirmedi;
**ölçülebilir yaptı** (`vdlWriteRatio` · `vdlAvgPatchFields`).

**Truth semantiği kilitlendi (9 kilit):** UNKNOWN sıfıra çevrilmez ·
ölçülmüş 0 yazılır · değişmeyen alan silinmez · TPMS eleman-eleman
kıyaslanır · provenance yalnız değişen alana damgalanır.

**Köprü sözleşmesi:** 13 yüzey sınıflandırıldı. En önemli kural —
`safetyCritical` bir yüzey **asla** `COALESCED`/`BATCHED` olamaz; kilit
testi bunu zorlar. `COALESCED` (ara değeri kasten düşürür) ile `BATCHED`
(hiçbirini düşürmez) ayrımı yazıya döküldü.

**OBD:** native `PollCostLedger` salt-okunur projeksiyonla profiler'a
bağlandı — **ikinci OBD gerçeği kurulmadı**. Canlı telemetri ile burst/derin
teşhis ayrı sayılır.

**GPS:** F1'de bildirilip **bağlanmamış** olan `publishedToStore` sayacı
takıldı; zincir tamamlandı. Kadans ve guard'lar değişmedi.

**Kilitler:** `streamsBridgeF4.test.ts` — 34 kilit (A–F blokları).

**PERFORMANS İDDİASI YOK:** ortam `DESKTOP_BENCH`. Tahsis azalması yapısal
bir kazançtır (ölçülebilir), ama ms/FPS iddiası saha kanıtı ister.


### ARCH-06/F5 — Memory + Cache + Storage (2026-09-01)

**Durum: ENTEGRE.** **SAHADA DOĞRULANDI DEĞİL** — kütük #229–#232 🔴.

**Çözülen gerçek kusur:** bellek baskısı yönetimi İKİLİYDİ — `CRITICAL`
gelince kayıtlı TÜM purge fonksiyonları aynı anda çağrılıyordu. Bu iki ayrı
sorun üretir: **aşırı yıkım** (ucuz prefetch ile pahalı arama veritabanı aynı
anda gider) ve **kör sıra** (en çok yer açan değil, listede ilk olan silinir).

**6 kademeli merdiven** (`memoryWatchdog` otorite olarak KALDI; native sinyal
DEĞİŞMEDİ, kademeler ondan TÜRETİLİR):

```
NORMAL → TRIM_DEVTOOLS → TRIM_PREFETCH → TRIM_PRESENTATION
       → PAUSE_BACKGROUND → CRITICAL_PROTECT
MODERATE  ⇒ TRIM_PREFETCH'e kadar    (önceden: HİÇBİR ŞEY)
CRITICAL  ⇒ CRITICAL_PROTECT'e kadar (önceden: HEPSİ BİRDEN)
```

**En önemli tasarım kararı — truth koruması YAPISAL:**
`NON_EVICTABLE_TRUTH` bir katılımcı sınıfı olarak **tanımlanmadı**. Canlı araç
gerçeği, aktif navigasyon oturumu, medya oturumu ve güvenlik durumu
**kaydedilemez** → silinemez. Koruma bir `if` koşuluna değil **tipe** dayanır;
bir gelecek turda yanlışlıkla "truth'u da trim edelim" demek derlenmez.

**Sıralama kuralı:** ölçülmüş bayt ÖNCE (büyükten küçüğe), `estimatedBytes
=== null` olan SONRA — bilinmeyeni önce silmek, ne kadar yer açtığını bilmeden
pahalı bir şeyi yok etmek olabilir.

**Geri uyumluluk:** eski `registerCachePurge` çalışmaya devam ediyor; sınıfı
bilinmediği için en güvenli kademeye (`CRITICAL_PROTECT`) konur — yani
MODERATE'te artık gereksiz yere tetiklenmez.

**Depolama:** flush GEREKÇESİ ve dayanıklılık SINIFI eklendi. **5 s debounce
uzatılmadı** (uzatmak veri kaybı penceresini büyütürdü), `CRITICAL_SYNC`
double-lock yolu aynen duruyor. Sınıf mevcut kapıları ADLANDIRIR, yeni
politika üretmez.

**Artwork — cache KURULMADI:** §5 "kanıtlanırsa kur" der. Denetim üç mevcut
mekanizma buldu (djb2 hash dedup · 16×16 accent downsample · IntersectionObserver
lazy yükleme) ve **çoklu decode problemi kanıtlanmadı**. Ölçülmemiş bir soruna
cache yazmak, bilinmeyen bir kazanç için bilinen bir karmaşıklık eklemek olurdu.
`artwork.decodedBytes` dürüstçe `UNMEASURED` kalır; ölçüm sahadan gelirse F7'de
açılır (kütük #232).

**Kilitler:** `memoryCacheStorageF5.test.ts` — 33 kilit (A–F blokları).

---

### ARCH-06/F6 — Thermal + Low-End + Background (2026-09-01)

**Durum: ENTEGRE.** **SAHADA DOĞRULANDI DEĞİL** — kütük #233–#235 🔴.

**Önce denetim:** repoda degradasyon makinesinin büyük bölümü ZATEN VARDI ve
DOĞRU çalışıyordu — `_THERMAL_CEILING` termal L1/L2/L3'ü `RuntimeMode` tavanına
çeviriyor (BALANCED / BASIC_JS / POWER_SAVE), `RuntimeConfig` sekiz düğmeyi
(`gpsUpdateMs` · `obdPollingMs` · `uiFpsTarget` · `enableBlur` · `enableAnimations`
· `enableShadows` · `loggingLevel` · `suspendWorkers`) alanlara sunuyor,
`getDeviceTier()` açılış modunu kapıyor. **Bunların hiçbiri yeniden
yazılmadı.**

**Gerçek eksik şuydu:** üç baskı kaynağı (termal · bellek · cihaz sınıfı) ayrı
ayrı karar veriyordu ve hangi İŞLERİN hangi sırayla feda edileceğine dair
**ortak bir sözleşme yoktu**. Üç ayrı tablo demek, üçünün birbiriyle
çelişebilmesi demektir: biri "prefetch açık" derken öteki "kapat" diyebilir.

**L7 — tek saf projeksiyon** (`workloadCeilings.ts`):

```
girdi:  ARM RuntimeMode · thermalWatchdog · memoryWatchdog · getDeviceTier()
çıktı:  WorkloadCeilings = FULL | REDUCED | MINIMAL | OFF   (8 iş yükü)
feda sırası (sabit):
  labSampling → telemetrySampling → prefetch → backgroundIndexing
  → nonCriticalAnimations → mapDecoration → artworkQuality → maviVisualFx
```

**L7 karar verir, işi kendisi UYGULAMAZ.** Zamanlayıcı kurmaz, `Date.now`
kullanmaz, hiçbir sahibin durumunu yazmaz. Otoriteler yerinde kaldı.

**Çelişki yapısal olarak imkânsız:** her iş yükü için dört kaynağın
önerdiği tavanlardan **EN KISITLAYICI olanı** kazanır. Bir kaynağın gevşekliği
ötekinin sıkılığını ezemez (kilit D3/D4).

**Asla kısılmayanlar — F5'teki desenle aynı, YAPISAL:** araç gerçeği · dokunma
yanıtı · navigasyon rehberliği · ses çalma · kritik uyarılar · komut yürütme ·
güvenlik kapıları bir "iş yükü" olarak **tanımlı değildir**. Tavanı olmayan
kısılamaz; koruma bir `if` koşuluna değil, **listede bulunmamaya** dayanır.

**Termal bir ARIZA DEĞİLDİR:** tavan düşürmek `reportFailure` üretmez
(kilit A4). Sıcak bir araç bozuk bir araç değildir.

**Histerezis — UNCALIBRATED:** sözleşme kuruldu, **eşik sayıları yazılmadı**.
Saha tabanı olmadan eşik uydurmak, ölçülmemiş bir sayıyı ürün kararına
dönüştürmek olurdu. `observedTier` DAİMA `null`dır ve `staticTier`ı **otomatik
değiştirmez** — ölçüm gürültüsü ürün davranışını sallamamalıdır. Kalibrasyondan
BAĞIMSIZ olan tek şey **asimetridir**: yükseltme düşürmeden 3× daha fazla kanıt
ister (düşürmek ucuz ve geri alınabilir; yükseltmek kasmayı geri getirir).
**Yeni zamanlayıcı kurulmadı** — mevcut `perfSeries` 12 s tiki kullanılır.

**Bilinmeyen cihaz MID sayılır:** `getDeviceTier()` hiçbir zaman UNKNOWN dönmez;
sınıflandırılamayan cihaz `else` dalında MID'e düşer (kilit F2). Bilinmeyeni LOW
saymak, güçlü ama tanınmayan bir head unit'i kalıcı olarak sakatlardı.

**Worker doygunluğu ÖLÇÜLMÜYOR:** F6 §1 bunu girdi olarak ister; repoda kuyruk
derinliği ölçümü YOKTUR — `getWorkerSnapshot()` yalnız yaşam döngüsü verir.
"Hepsi active → doygun" demek sahte bir sinyal olurdu (sağlıklı sistemde de
hepsi active'tir). Alan `UNMEASURED` kalır ve **karara girmez** (kilit H1/H2).

**Tek gerçek tüketici — dürüst kapsam:** bugün tavanı GERÇEKTEN uygulayan tek
yol `communityService._idlePull` (7 dk'da bir bulut zenginleştirme çekimi).
GİDEN kullanıcı kuyruğu (`_idleSync`) **bilinçli olarak kısılmadı**: kullanıcının
kendi bildirimlerini taşır, atlanması geri getirilemez veri kaybı olurdu.
Kalan 7 kategori BİLDİRİLDİ ama tüketici bağlanmadı — **açık borç (F7)**.

**LAB:** yeni ekran AÇILMADI (ekran enflasyonu yasağı). Mevcut
Performance/Runtime Profiler'a `workload_ceilings` bölümü eklendi; cihaz
MODELİ/SKU taşınmaz, yalnız türetilmiş sınıf görünür (kilit J4).

**Ölçülmemiş sayı iddiası YOK:** bu fazda hiçbir ms/FPS/°C kazancı iddia
edilmedi — ortam `DESKTOP_BENCH`, saha değil.

**Kilitler:** `thermalLowEndF6.test.ts` — 41 kilit (A–J blokları).

---

### ARCH-06/F7 — Mavi + Media + Phone Link + LAB (2026-09-01)

**Durum: ENTEGRE.** **SAHADA DOĞRULANDI DEĞİL** — kütük #236–#239 🔴.

**F7'nin asıl işi bağlamak değil, DÜRÜSTÇE AYIRMAKTI.** F6 sekiz degradasyon
kategorisi bildirmiş ama yalnız birini bağlamıştı. Kolay yol "sekizini de
bağlayıp 8/8 demek"ti; denetim bunun **yanlış** olduğunu gösterdi.

**Kategori kategori denetim sonucu:**

| Kategori | Uygulayıcı | Neden |
|---|---|---|
| `backgroundIndexing` | **WORKLOAD_CEILING** | F6'da bağlandı (bulut çekimi) |
| `labSampling` | **WORKLOAD_CEILING** | F7'de bağlandı (aşağıda) |
| `nonCriticalAnimations` | ARM `RuntimeConfig` | `enableAnimations` ZATEN bağlı |
| `mapDecoration` | ARM `RuntimeConfig` | `enableShadows`/`uiFpsTarget` ZATEN bağlı |
| `maviVisualFx` | ARM `RuntimeConfig` | `enableBlur` ZATEN bağlı (Mali-400 koruması) |
| `prefetch` | **NO_CONSUMER** | Repoda prefetch alt sistemi YOK |
| `telemetrySampling` | **DELIBERATELY_UNBOUND** | Ölçümün KENDİSİ — kısmak körleşmek olurdu |
| `artworkQuality` | **DELIBERATELY_UNBOUND** | Çoklu-decode problemi KANITLANMADI (#232) |

Üç kategoriye ikinci tavan bağlamak, `MainLayout` · `MediaScreen` ·
`livingThemeState` tarafından GERÇEKTEN okunan `RuntimeConfig`in üstüne ikinci
bir kapı takmak olurdu — **Cross-Domain §1 · §5 · §8 · §15 ihlali.** Bu yüzden
`WorkloadCeilings` o kategoriler için yalnız **birleşik GÖRÜNÜM** sağlar
(LAB'da "şu an ne kısıtlı?" tek yerden okunur); **uygulama otoritesi taşımaz.**

**LAB örneklemesi bağlandı — yeni zamanlayıcı YOK.** Aralık zaten cihaz
sınıfına aboneydi ama MOUNT ANINDA bir kez seçiliyordu: cihaz 65 °C'ye
çıktığında LAB dokuz bölümü aynı hızda yoklamaya devam ediyordu. Çözüm tik
aralığını değiştirmek değil, **adım atlamak**:
`FULL`=1 · `REDUCED`=2 · `MINIMAL`=4 · `OFF`=tur yok.

> **ELLE YENİLE tavandan ETKİLENMEZ.** Baskı, kullanıcının bilinçli niyetini
> kısmaz; kısılan yalnız kullanıcının İSTEMEDİĞİ otomatik turdur.

**`labClosedBehavior` sözleşmeye bağlandı.** Davranış zaten doğruydu (unmount
cleanup + `visibilitychange`), ama **hiçbir yerde yazılı değildi** → sessizce
bozulabilirdi. Artık kilitli: timer `STOPPED` · abonelik `DETACHED` · yoklama
`NOT_INVOKED` · arka plan `STOPPED` · **üretim etkisi `NONE`**.
"Gözlemlenemeyen özellik tamamlanmış değildir" kuralının bedeli, LAB'ın ürünü
yavaşlatması olamaz.

**Mavi: ÖLÇÜLDÜ, DOKUNULMADI.** Bağlam bütçesi (`maxChars` 700 · `maxFields` 10
· `FIELD_PRIORITY` sırası) ve serializer **değiştirilmedi**; serializer SAF
kaldı (sayaç/tavan/saat girmedi). Eklenen tek şey, serializer'ın ZATEN
hesapladığı sayıların oturum boyunca biriktirilmesidir — `_lastContextTelemetry`
tek bir anı tutuyordu, eğilimi göstermiyordu.

> **Mavi bağlamı BASKIYA GÖRE kısılmaz** (kilit E3). Cross-Domain §7:
> performans truth'u değiştiremez. Baskı altında alan düşürmek, Mavi'ye
> yanlış araç durumu göstermek olurdu — bu bir performans kazancı değil,
> sessiz bir doğruluk kaybıdır.

**Media ve Phone Link: BİLİNÇLE DOKUNULMADI.** `playbackTruth`,
`mediaCommandGateway` ve `companionSessionManager` performans tavanı OKUMAZ
(kilit F1/F2/G1). ARCH-05'in `CAPABILITY_NOT_GRANTED` kapısı yerinde
(kilit G2); kalp atışı/telemetri baskıya göre atlanmaz (G3).

**Ölçülmemiş sayı iddiası YOK:** bu fazda da hiçbir ms/FPS/RAM kazancı iddia
edilmedi.

**Kilitler:** `maviMediaPhoneLabF7.test.ts` — 36 kilit (A–I blokları).

---

### MUSIC-F2 — YEREL KÜTÜPHANE OTORİTESİ + KAPAK KATMANI (2026-09-01)

**Durum: ENTEGRE** (kod + test + tsc + lint + üretim build yeşil).
**SAHADA DOĞRULANDI DEĞİL** — kütük 🔴 #1069–#1076 bekliyor; saha durumunda
`docs/DEVICE_VALIDATION_LEDGER.md` mutlak otoritedir.

**Kapatılan gerçek açık:** `mediaStoreRefreshPlanner` bir politikaydı ama
**üretim çağıranı yoktu** — planlayıcı yazılmış, hiçbir yere bağlanmamıştı;
her açılış tam tarama koşuyordu. Artık `mediaStoreRefreshExecutor` MediaStore
taramasının TEK yürütücüsüdür ve zincir uçtan uca bağlıdır:
`MediaStore volumes → native refresh executor → planner kararı → MusicIndex
uzlaştırma → UI`; kapak için `UI → ArtworkResolver → bellek → disk → native
sampled decode`.

**Bu turda kapatılan sekiz blocker:** ① gerçek native refresh executor ·
② volume başına kalıcı refresh durumu (başarısız tarama generation'ı ilerletmez) ·
③ çok-volume kimliği `media:<volumeIdentity>:<mediaStoreId>` + eski kimlik göçü ·
④ tak/çıkar + izin yaşam döngüsü (detach → STALE, izin geri gelirse FULL) ·
⑤ sınırlı kalıcı disk kapak LRU (atomik yazım · tahliye · bozuk kurtarma · şema) ·
⑥ gerçek hedef boyutlu (sampled) decode · ⑦ base64 olmayan dosya-URL taşıması ·
⑧ ara katman bırakılmadan gerçek entegrasyon.

**Otorite sınırı korundu:** `MusicIndex` = kütüphane truth · `CarosPlaybackService`
= playback truth · `ArtworkCache` = kapak önbelleği otoritesi · `MediaCommandGateway`
= komut yolu · UI = projeksiyon. Kütüphane erişilebilirliği (STALE) bir playback
durumu ÜRETMEZ (Cross-Domain §1, §7, §16). F0/F1 mimarisi yeniden tasarlanmadı;
AI öneri kapsam DIŞINDA bırakıldı.

**Ölçülmemiş sayı iddiası YOK:** bellek/FPS kazancı iddia edilmedi; sampled
decode'un etkisi kütükte #1074'ün cihaz ölçütü olarak bekliyor.

**Gözlemlenebilirlik:** yeni LAB ekranı açılmadı; mevcut `media-authority`
ekranı `11 · Yerel Kütüphane (F2)` ve `12 · Kapak Önbelleği (F2)` kartlarıyla
genişletildi (salt-okunur · tarama tetiklemez · kullanıcı içeriği taşımaz).

**Kilitler:** `musicF2ClosureRefresh.test.ts` (16) · `musicF2ClosureArtwork.test.ts`
(13) · `musicIndexF2.test.ts` · `mediaStoreRefreshPlannerF22.test.ts` ·
`ArtworkStoreTest.java` (JVM · sampled decode ve cache anahtarı).

### MUSIC-F3 — PLAYQUEUE + LISTENING SESSION (2026-09-01)

**Durum: ENTEGRE / SAHA BEKLİYOR.** Desired queue, observed timeline ve
reconciliation ayrı tutulur. `PlayQueue` yalnız istenen sıranın otoritesidir;
observed sıra kanıtı yoksa projeksiyon `UNKNOWN` kalır. `ListeningSession` yalnız
kullanıcının niyetini taşır; playback truth değildir.

Yerel kütüphane seçimi artık `MusicIndex identity → ListeningIntent + DesiredQueue
→ MediaCommandGateway → F0` zincirinden gider. Now Playing yalnız kuyruk konumu,
uyum ve süreklilik projeksiyonu gösterir; MiniPlayer iş mantığı taşımaz.

`MediaIdentity` EXACT/STRONG/WEAK/NO_MATCH/UNKNOWN kanıt derecelerini üretir.
Süreklilik yalnız EXACT/STRONG ile `CARRIED`/`DEGRADED` olabilir; belirsiz veya
zayıf aday otomatik çalmaya yol açmaz. Kalıcı session/queue kaydı bounded'dır ve
recovery hiçbir koşulda PLAYING iddiası üretmez.

**Açık saha kapısı:** kod tarafındaki üç boşluk MUSIC-F3.2 ile kapandı (aşağı);
kalan kapı yalnız gerçek araç kanıtıdır. Kütük 🔴 #1077.

---

### MUSIC-F3.2 — LIVE EVIDENCE + HANDOVER COMMIT + LAB (2026-09-01)

**Durum: ENTEGRE / SAHA BEKLİYOR.** F3'ün üç üretim boşluğu gerçek kodla kapatıldı.

**1) Canlı gözlenen kuyruk.** Media3 timeline'ı artık kanıt portuna BAĞLI:
`Player.getMediaItemAt(i).mediaId` → `CarosPlaybackService.getDiagnostics()` →
`CarosPlaybackBridge` → `nativeAuthorityBridge.sanitizeAuthoritySnapshot` →
`mediaAuthorityRuntime.publishObservedQueue` → `publishObservedQueueEvidence`.
Kanıt DesiredQueue'dan TÜRETİLMEZ. Otorite yoksa, kaynak sınıfı tanınmıyorsa,
sağlayıcı çok öğeli kuyruk semantiğini desteklemiyorsa (YouTube · Spotify Connect ·
Bluetooth) veya timeline hiç bildirilmediyse sonuç `UNAVAILABLE` + gerekçedir —
"boş kuyruk" ile "kuyruk görünmüyor" ayrı teşhislerdir. Native'e yazılan pencere
`PREFIX` olarak işaretlenir; kısaltılmış liste `FULL` diye sunulmaz. Kanıt 15 sn
sonra bayatlar ve canlı gözlem sayılmaz. Böylece MATCHED/PREFIX/DRIFT hizalaması
artık gerçek gözlemden üretilir.

**2) Doğrulanmış devir → oturum commit'i.** Üretim zinciri kuruldu:
`carryToSource → ContinuityDecision → mediaCommandGateway.playSource →
sourceCoordinator.switchTo → handoverMachine → CommandTruth(VERIFIED) →
commitCarriedSourceAfterHandover → ListeningSession.currentSource`. Devir komutu
YALNIZ `sessionContinuity` otomatik devama izin verdiğinde gönderilir; kanıt
yetersizse komut hiç gönderilmez ve rastgele parça başlatılmaz. Commit kapısı
bilet tabanlıdır: yeni devir eskisini SUPERSEDE eder, süreç yeniden başladığında
bilet YOKTUR — restart öncesine ait bir tamamlanma oturumu değiştiremez.
`ACCEPTED_UNVERIFIED` · `FAILED` · `TIMED_OUT` · rollback · bayat kuşak commit
YAPAMAZ; yinelenen `VERIFIED` sonuç idempotent düşer. Kuyruk hedef kaynağın
ADAYLARINDAN kurulur (eski kaynağın ölü URI'lerinden değil) ve devam noktası
taşınan liste içindeki gerçek konumdur.

**3) Telemetri + CAROS LAB.** Bounded, salt-okunur `sessionTelemetry` eklendi:
gözlem yayını/tazelik/köken/bütünlük, hizalama, sağlayıcı karşılama, kimlik kanıt
derecesi (en zayıf halka), süreklilik, devir sonucu, commit ve bayat/yinelenen
düşme sayaçları. Mevcut Medya Otoritesi ekranı GENİŞLETİLDİ — yeni ekran
açılmadı (LAB yüzey politikası): `13 · Dinleme Bağlamı`, `14 · Gözlenen Kuyruk
Kanıtı`, `15 · Devir → Oturum Commit`. LAB komut göndermez, kendi gerçeğini
üretmez ve okuması hiçbir üretim sayacını değiştirmez; PII (başlık · sanatçı ·
albüm · URI · öğe kimliği) taşınmaz.

**Açık saha kapısı:** kod/test/build yeşil olması saha doğrulaması DEĞİLDİR.
Kütük 🔴 #1078 · 🔴 #1079 · 🔴 #1080 gerçek araçta gözlenene kadar bu
başlık **DOĞRULANDI** seviyesine yükseltilmez.

---

### MUSIC-F4 — PREMIUM NOW PLAYING + QUEUE EXPERIENCE (2026-09-01)

**Durum: ENTEGRE / SAHA BEKLİYOR.** Bu faz görsel makyaj değil, **dürüstlük ve
dikkat** fazıdır: ekranda görünen her öğe ya kanıtlıdır ya da hiç çizilmez.

**Bilgi hiyerarşisi.** Artwork → başlık → sanatçı → bağlam → transport → ilerleme
→ kuyruk/oturum → kaynak. Kaynak bilgisi görünür ama baskın değildir: kullanıcı
müziği dinler, backend'i değil.

**Capability dürüstlüğü.** Transport kontrolleri `nowPlayingModel` tarafından tek
yerde kapılanır: kaynak yeteneği yoksa tuş **hiç render edilmez** — kalıcı sönük
"disabled mezarlığı" kurulmaz. Spotify Connect ve Bluetooth'ta önceki/sonraki ve
karıştır/tekrar çizilmez; yerel kaynakta hepsi açılır.

**İlerleme dürüstlüğü.** Konum/süre bildirilmiyorsa çubuk, yüzde ve saat **hiç
çizilmez** — sahte `0:00` üretmek yerine boşluk bırakılır. Seek yalnız kaynak
gerçekten destekliyorsa bağlanır; dokunma alanı çubuktan geniştir (sürüşte yanlış
dokunma riski düşer). `PLAYING` iddiası yalnız kanonik duyulabilir kanıttan gelir;
komut gönderilip ses doğrulanmadıysa yüzey iyimser çalma göstermez, sakin bir
"Başlatılıyor" ipucu verir.

**Kapak.** F2 `ArtworkCache` `now-playing` kullanımıyla çözülür; bileşen kendi
native çözümünü yapmaz ve ikinci önbellek kurmaz. Yeni kimlik çözülene kadar
önceki kapak durur → parça geçişinde boş kareye düşüp geri dolan "flash" olmaz.
Kapak rengi zemine **sınırlı** sızar (opacity + vignette) ve UI renk otoritesine
dönüştürülmez; metin kontrastı her kapakta korunur.

**Kuyruk deneyimi.** Now Playing'den **tek dokunuşla** açılır. Geçerli öğe yalnız
renkle değil kenar çubuğu, kalın metin ve `aria-current` ile ayrılır. Uzun
kuyrukta 60 satırlık pencere çizilir (satırlar **gerçek kuyruk indeksini** taşır),
kullanıcı listeyi incelerken auto-follow durur ve "Çalana dön" düğmesi çıkar.
Mutasyonlar UI'dan doğrudan `playQueue`'ya gitmez: `jumpToQueueIndex ·
removeQueueEntryAt · reorderQueueEntry · playQueueEntryNext` kapısından geçer,
mutasyon uygulanır ve pencere kanonik komut yolundan native'e **yeniden yazılır**.
Böylece "listede seçili görünüp başka parça çalma" ayrışması kapanır; duraklatılmış
kuyruğun düzenlenmesi müziği başlatmaz (autoPlay kanonik ses kanıtından okunur).

**Süreklilik UX'i.** F3 durumları kullanıcıya **insan dilinde** anlatılır:
CARRIED → "Dinlemeye devam ediliyor", DEGRADED → "Bazı parçalar bu kaynakta yok",
BROKEN → "Bu dinleme burada devam ettirilemiyor". INTACT ve UNKNOWN **sessizdir**
(gereksiz alarm üretilmez). Teknik durum adları, hizalama sınıfları ve provenance
yalnız CAROS LAB'da kalır.

**Sürüş sözleşmesi.** Sürüş dikkat düzeyi **mevcut** `smartEngine` otoritesinden
kabuk üzerinden gelir — yeni driving-state otoritesi kurulmadı. Sürüşte ikincil
kontroller ve kuyruk düzenleme kapanır; atlama ve okuma açık kalır; süregiden
animasyonlar (kapak halesi, nabız) durur. Dokunma hedefleri ≥ 48 px, kuyruk
satırları 64 px.

**Otorite sınırı.** UI bir projeksiyondur: ikinci kuyruk deposu yok, bileşen-yerel
playback state yok, UI'dan native köprü/sağlayıcı çağrısı yok, component artwork
fetch yok, UI continuity kararı yok, iyimser kuyruk gerçeği yok. Bu altı yasak
kaynak taraması kilidiyle korunur.

**Performans telemetrisi.** `musicUiPerf` genişletildi: Now Playing ve kuyruk
açılış gecikmesi, kuyruk projeksiyonu, satır render maliyeti, metadata commit
gecikmesi, render sayaçları, son pencere satır sayısı. Bu turda **eski bir ölçüm
hatası da düzeltildi**: `nowPlayingOpenMs` her okumada yeniden hesaplandığı için
yüzey açık kaldıkça büyüyordu (açılış gecikmesi değil, açık kalma süresi). Artık
ilk çizimde sabitlenir; çizim olmadıysa `null` kalır.

**Açık saha kapısı:** host render süresi cihaz performansı DEĞİLDİR. Kütük
🔴 #1081 · 🔴 #1082 · 🔴 #1083 gerçek araçta gözlenene kadar bu başlık
**DOĞRULANDI** seviyesine yükseltilmez.

---

### MUSIC-F5 — UNIFIED SEARCH + DISCOVERY (2026-09-01)

**Durum: ENTEGRE / SAHA BEKLİYOR.** Kullanıcı artık "önce kaynak seç, sonra ara"
modeline zorlanmıyor; kaynak teknik bir detay olarak sonucun yanında duruyor.

**Birleşik arama birleşik TRUTH DEĞİLDİR.** `LOCAL` gerçeği `musicIndex`'ten,
sağlayıcı sonucu ilgili sağlayıcıdan gelir. `musicSearchCoordinator` yalnız
sorgular, normalize eder, sıralar, gruplar ve **provenance** taşır: playback ·
library · provider gerçeği üretmez, kuyruk yazmaz, komut göndermez.

**Yetenek dürüstlüğü.** `sourceCapabilities`'e `supportsSearch` eklendi.
Desteklemeyen kaynağa (Bluetooth, harici MediaSession) sorgu **gitmez**; şu an
kullanılamayan kaynak (Spotify oturumu yok) ayrı bir teşhistir. İkisi de "sonuç
bulunamadı" diye sunulmaz — LAB'da `SKIPPED_UNSUPPORTED` / `SKIPPED_UNAVAILABLE`
olarak ayrılır.

**Dürüst durum modeli.** `SEARCHING · PARTIAL · COMPLETE · DEGRADED`. Yerel
sonuçlar hemen görünür, ama **"tamamlandı" iddiası tüm uygun kaynaklar bitmeden
kurulmaz**. Bir sağlayıcının düşmesi diğerlerinin sonucunu yok etmez. Boş
sonucun gerçek nedeni ayrılır: sorgu yok · gerçekten sonuç yok · uygun kaynak
yok · hepsi erişilemez · hepsi düştü. Kullanıcıya teknik hata kodu gösterilmez.

**Türkçe normalizasyon.** NFD → birleşen işaret düşürme → `tr-TR` küçültme →
**sonra** ı/i katlaması. Sıra kritikti ve bu turda bir hata düzeltildi: katlama
önce yapılınca "İstanbul" → "ıstanbul" oluyordu, yani kullanıcı "istanbul"
yazınca bulamıyordu. Normalizasyon **yalnız arama anahtarıdır**; kanonik
metadata değiştirilmez — listede başlık her zaman "Şarkı" görünür.

**Sıralama deterministik ve açıklanabilir.** Sinyaller: tam başlık > başlık öneki
> sanatçı+başlık > tam sanatçı > albüm bağlamı > kelime kapsaması > alt dizge;
erişilebilirlik yalnız **eşitlik bozucudur**. **Sağlayıcı popülerliği puan
vermez** — eski `_PROVIDER_RANK` tablosu (YouTube 50 > Spotify 48 > local 40)
kullanıcının aradığını gizleyebiliyordu. LOCAL sırf yerel diye birinci yapılmaz,
sağlayıcı sırf çevrimiçi diye öne çıkarılmaz. AI tahmini yok. Her puanın
gerekçesi (`signals`) LAB'da incelenebilir.

**Tekilleştirme.** F3 `mediaIdentityMatching` kullanılır ve **yalnız EXACT /
STRONG** kanıtta birleştirilir. WEAK · belirsiz · aynı ad-farklı sanatçı ·
farklı süre AYRI kalır ve bu sayılır: **yanlış birleştirme, çift göstermekten
daha kötüdür.** Birleşen sonuçta alternatif kaynaklar korunur ("+1" rozeti).

**Bayatlık.** Her arama bir kuşak taşır. "sezen" sorgusunun geç gelen sonucu
"sezen aksu" durumunu değiştiremez; bayat sonuç düşürülür ve sayılır. İptal
edilen arama durumu temizler.

**Türetilmiş arama indeksi.** 5.000+ parçalık kütüphanede `searchMusicLibrary`
her tuş vuruşunda tüm parçaları yeniden normalize ediyordu. Artık indeks
kütüphane revizyonu başına bir kez kurulur ve revizyon değişince yeniden
kurulur. **İkinci library truth değildir**: yalnız `trackId` + normalize metin
saklar, sonuçlar kanonik anlık görüntüden çözülür.

**Seçim akışı.** `SearchResult → kanonik MediaRef → ListeningIntent +
DesiredQueue → F3 oturum yolu → MediaCommandGateway → F0`. Arama backend
seçmez. Yerel sonuç seçilince `musicIndex` yeniden doğrulanır; bayat referans
reddedilir — arama sonucu bir çalma garantisi değildir.

**Keşif.** AI önerisi yok. Yalnız gerçek kanıt: dinlemeye devam · son çalınan ·
albümler · sanatçılar · klasörler. **Kanıt yoksa bölüm render edilmez** — boş
bir "Senin için" başlığı üretilmez. Sürüşte klasör gezintisi kapanır ve satır
sayısı azalır. Arama geçmişi bounded, yerel, açıkça temizlenebilir ve **öneri
otoritesi değildir**.

**Telemetri + LAB.** Yerel/sağlayıcı gecikmesi, ilk sonuç, tamamlanma,
projeksiyon, indeks arama, sonuç/dedup/bayat/iptal sayaçları, kaynak turları ve
sıralama gerekçesi. **Sorgu metni telemetriye girmez** — yalnız uzunluk. Mevcut
Medya Otoritesi ekranı genişletildi: `16 · Birleşik Arama` (yeni ekran açılmadı,
LAB arama tetiklemez).

**Açık saha kapısı:** host ölçümü cihaz performansı DEĞİLDİR. Kütük
🔴 #1084 · 🔴 #1085 · 🔴 #1086 gerçek araçta gözlenene kadar bu başlık
**DOĞRULANDI** seviyesine yükseltilmez.

---

### MUSIC-F5.1 — SEARCH UNIFICATION + DISCOVERY SURFACE (2026-09-01)

**Durum: ENTEGRE / SAHA BEKLİYOR.** F5'in üç açık borcu kapandı.

**1) Sağlayıcı kapsamı.** Birleşik arama artık tek hattan tüm uygun kaynakları
yürütür: `local · youtube(piped) · radio(radioBrowser) · spotify`. Spotify portu
eklendi ve **oturum gözlenir** — bağlı değilse sorgu gitmez, `SKIPPED_UNAVAILABLE`
görünür; sahte boş sonuç `COMPLETE` hükmünü yanlış etkilemez. Global kataloglar
(audius · jamendo · archive) ürün politikası gereği (`WORLDWIDE_SOURCES_ENABLED
= false`) kayda alınmaz; **bayrak ezilmez**, gerekçe `policy_worldwide_disabled`
olarak LAB'da görünür. Yeni sağlayıcı yazılmadı, yetenek uydurulmadı.

**2) Sesli arama birleştirmesi.** İki arama otoritesi kaldırıldı.
`playByQuery` artık `MusicSearchCoordinator.searchOnce → kanonik sıralama +
tekilleştirme → güvenli seçim → selectSearchResult → F3 → F0` hattını kullanır.
Sese özel sıralama, normalizasyon veya dedup **yoktur**; eski `_PROVIDER_RANK`
popülerlik tablosu sesli yolda da devre dışıdır. Sesli arama **ekrandaki arama
durumunu değiştirmez** (ayrı kuşak; tek orkestrasyon, iki giriş kapısı).
**Belirsiz sonuçta otomatik çalma yoktur** — metin kanıtı hiç tutmayan sonuç
çalınmaz, `AMBIGUOUS` döner. Sağlayıcıya doğrudan çalma komutu gönderilmez.

**3) Eski arama yolu.** `carosMediaLayer.searchMedia` artık **arama otoritesi
değildir**: `@deprecated` işaretli, hiçbir üretim yolundan çağrılmıyor (YouTube
kurtarma da kanonik koordinatöre taşındı) ve çağrılırsa sayaca yazılıp LAB'da
görünüyor — sessiz mimari kaçak bırakılmadı. Kaynak taraması kilidi beş üretim
dosyasında çağrı olmadığını doğrular.

**4) Keşif yüzeyi.** `MusicDiscoverySurface` ayrı bir bileşendir (MediaScreen
monoliti büyütülmedi) ve iş mantığı taşımaz — bölümler `discoveryRuntime`den,
seçim kanonik F3 yolundan gelir. Bölümler: Devam et · Son çalınanlar · Son
eklenenler · Albümler · Sanatçılar · Klasörler. Arama alanı boşken keşif,
yazmaya başlayınca sonuçlar; alan temizlenince keşif geri gelir. **Arama
koordinatörü keşif otoritesi değildir** — iki projeksiyon yan yana yaşar.

**5) Son çalınanlar.** Bounded (12), yerel, privacy-safe bir projeksiyon:
yalnız **kimlik + kaynak + zaman** saklanır — başlık, sanatçı, albüm ve URI
saklanmaz; gösterim anında kanonik kütüphaneden çözülür ve çözülemeyen kayıt
**gösterilmez** (silinmiş parça için satır uydurulmaz). Playback truth değildir
("çalma başlatıldı" kanıtıdır), öneri otoritesi değildir. Yeni analitik sistemi
kurulmadı.

**6) Son eklenenler.** MediaStore `dateAdded` bu katmanda yoktur; tek
sıralanabilir kanıt `generationModified`'dır. Bölüm **ancak kütüphanenin
çoğunda bu kanıt varsa** üretilir — azınlık bir kanıtla "son eklenenler" demek
sıralamayı uydurmak olurdu.

**7) Sürüş.** Mevcut `smartEngine` otoritesi kullanılır (yeni driving-state
otoritesi yok): sürüşte bölüm sayısı ≤ 3, klasör gezintisi kapalı, satır sayısı
20 → 8, sonuç listesi 60 → 12, dokunma hedefleri büyük.

**8) Telemetri + LAB.** Kayıtlı/dışlanan sağlayıcı, sesli sorgu/çalma/belirsiz
tutma, sesli arama ve seçim gecikmesi, **eski yol çağrı sayacı**, keşif
bölüm/satır/**bastırılan bölüm** sayısı ve keşif projeksiyon süresi. LAB arama
veya keşif mutasyonu tetiklemez.

**Açık saha kapısı:** host ölçümü cihaz performansı DEĞİLDİR. Kütük
🔴 #1087 · 🔴 #1088 · 🔴 #1089 gerçek araçta gözlenene kadar bu başlık
**DOĞRULANDI** seviyesine yükseltilmez.

---

### MUSIC-F6 — SES DENEYİMİ / DSP OTORİTESİ (2026-09-02)

**Durum: ENTEGRE / SAHA BEKLİYOR.** Kod + test + tsc + değişen dosya lint +
Android derleme yeşil. **SAHADA DOĞRULANDI DEĞİL** — kütük 🔴 #1090–#1099
bekliyor; saha durumunda `docs/DEVICE_VALIDATION_LEDGER.md` mutlak otoritedir.

**ÜRÜN HAZIR: HAYIR.**

**Kapatılan gerçek açık — karşılıksız bir "premium ses" yüzeyi.** Repo ölçümü
şunu gösterdi: uygulamada **hiçbir `AudioEffect` yoktu**. Ayarlar'daki
"Crystal Cabin DSP" paneli (Akıllı Ses Dengeleme / AGC · Sürücü Odaklı Ses ·
Hıza Bağlı Ses) Web Audio tabanlı `audioService` zincirine bağlıydı; ama
üretimde o zincire **hiçbir ses kaynağı `connectSource()` ile bağlanmıyordu**
ve kanonik oynatma F0 gereği native ExoPlayer'dan gidiyordu. Yani üç anahtar da
**duyulur hiçbir şeyi değiştirmiyordu**. Bu, capability-honesty kuralının açık
ihlaliydi; anahtarlar ürün yüzeyinden kaldırıldı ve yerine cihazda gerçekten
ölçülen bir DSP katmanı kondu.

**Ne kuruldu.** `AudioExperienceAuthority` (tek DSP otoritesi · saf karar modeli
+ I/O katmanı) · `CarosAudioEffects` (player'ın gerçek `audioSessionId`'sine
bağlanan `Equalizer` + `LoudnessEnhancer`) · `CarosBalanceAudioProcessor`
(ExoPlayer ses zincirinde örnek düzeyinde denge + güvenlik preamp'i) ·
`CarosAudioGain` (saf, JVM'de kilitlenen kazanç matematiği) · yedi gerçek EQ
profili (Düz · Vokal · Rock · Elektronik · Akustik · Bas · Gece) ve `Özel`.

**Otorite sınırı korundu.** DSP yalnız **ses renginin** sahibidir: playback truth
`CarosPlaybackService`'te · kullanıcı sesi `volumePolicy`/`userVolume`'de ·
ducking `duckPolicy` + `CarosAudioFocusManager`'da · kaynak devri
`sourceCoordinator`'da KALDI. Bu sınır bir import-grafı kilidiyle regresyon
kasasına yazıldı. F0–F5 yeniden tasarlanmadı.

**Dürüstlük kararları — uydurulmayanlar.**
- **Fader yok.** Uygulama ses yolu stereodur; gerçek ön/arka kanal olmadığı için
  `supportsFader` daima `false` ve gerekçesi (`stereo_output_only`) taşınır.
  Kontrol hiç çizilmez.
- **LUFS uydurulmadı.** Kaynak normalizasyonu için ölçülmüş metadata yok →
  `volumePolicy.sourceNormalization` nötr bırakıldı; ikinci bir normalizasyon
  sistemi kurulmadı.
- **"AI Sound" / "Studio Quality" iddiası yok.** Her preset ölçülebilir bir EQ
  eğrisidir; bant sayısı cihazın bildirdiğidir, "premium görünsün" diye
  artırılmaz.
- **Üretici DSP tespiti DERIVED'dır** (AOSP dışı equalizer implementor'ü), kesin
  donanım iddiası değildir.

**Güvenlik.** Pozitif EQ boost + loudness'in ürettiği tepe artışı, ses zincirinin
içinde **ayrı ve sınırlı** bir preamp'le ([-12 dB, 0]) telafi edilir; kullanıcı
sesine ve duck çarpanına DOKUNULMAZ. Denge yalnız uzak kanalı kısar (hiçbir
kanal 1.0 üstüne çıkmaz) → denge tek başına clipping üretemez. Örnek ölçeklemesi
tavanda sature olur, wrap-around yapmaz.

**Fail-safe.** Efekt kurulamaz/uygulanamazsa sonuç tek şeydir: **BYPASS** —
oynatma, kuyruk ve focus etkilenmez, yalnız ses rengi düzleşir. Desteklenmeyen
format işlemciyi tamamen pasif bırakır (tampon dokunulmadan geçer). Audio session
değişince efektler yeniden bağlanır; eski kuşağın ayarı yeni oturuma
`stale_session` ile yazılamaz.

**Sürüş politikası.** Sürüşte ince adım etkileşimi kapanır; preset seçimi ve
açma/kapama büyük dokunma hedefiyle açık kalır. Kısıtlanan zekâ değil, yalnız
etkileşimdir. Panelde sürükleme yoktur — her ayar ± adım düğmesiyle değişir.

**Gözlemlenebilirlik.** Yeni LAB ekranı açılmadı; mevcut `media-authority`
ekranı tek kartla genişletildi: `17 · Ses Deneyimi / DSP (F6)` — yetenek,
session/kuşak, attach durumu, bypass gerekçesi, **istenen ↔ uygulanan** bant
kazançları, güvenlik payı, kanal kazançları, yazım/birleştirme/gecikme sayaçları.
Salt-okunur; hiçbir probe/apply tetiklemez.

**Kilitler.** `musicF6AudioExperience.test.ts` (49) · `musicF6AudioSurface.test.tsx`
(12) · `mediaAuthorityLab.test.tsx` (F6 kartı + gizlilik) ·
`regression.guards.test.ts` (3 yeni kilit) · `CarosAudioGainTest.java` (JVM).

**Ölçülmemiş sayı iddiası YOK.** Duyulur ses kalitesi, gerçek DSP attach
gecikmesi ve bypass davranışı host'ta ÖLÇÜLEMEZ; hepsi kütükte cihaz ölçütü
olarak bekliyor.

**Açık borç (kapatılmadı, gizlenmedi):** ① kaynak normalizasyonu ölçülmedi ·
② SVC yeniden yapılmadı (kanonik yeri `volumePolicy.speedCompensation`) ·
③ `audioService.ts` ölü Web Audio ducking yolu duruyor — TTS/Mavi hattı hâlâ
`duckMedia`/`unduckMedia` çağırıyor ama zincirde kaynak olmadığı için bugün
etkisiz; temizliği ayrı atomik tur ·  ④ Virtualizer yalnız raporlanıyor.

**Sonraki atomik PR:** kütük #1090–#1099'u gerçek head unit'te koş. Özellikle
#1091 (duyulur EQ), #1092 (fail-safe bypass) ve #1094 (session değişiminde
yeniden bağlanma) atlanmamalı.

---

### MUSIC-F6.1 — ÖLÜ SES YOLU TEMİZLİĞİ / TEK DUCK OTORİTESİ (2026-09-02)

**Durum: ENTEGRE / SAHA BEKLİYOR.** Kütük 🔴 #1100–#1104 bekliyor.
**ÜRÜN HAZIR: HAYIR.**

**Kapatılan gerçek açık — CarOS konuşurken müzik GERÇEKTE kısılmıyordu.**
`ttsService` · `voiceService` · `voiceClips` · `edgeTtsService` ·
`onlineTtsService` `audioService.duckMedia()` çağırıyordu; o fonksiyon
üretimde **hiçbir kaynağın bağlı olmadığı** bir Web Audio `masterGain`'ini
kısıyordu → **duyulur hiçbir etkisi yoktu**. Kanonik `duckPolicy` vardı ama
üretimde `mediaCommandGateway.duck()`'ın **tek bir çağıranı bile yoktu**.

Beş yol yeni `duckRequest` adaptörüne taşındı (token güvenli · fail-soft ·
durum tutmaz). `audioService.ts` **tümüyle silindi** (ölü Web Audio DSP · SVC ·
AGC · driver-focus · `STREAM_MUSIC` yazıcısı); `theaterModeService`'in
karşılıksız ses profili sorumluluğu kaldırıldı.

**Ölçüm sırasında bulunan GERÇEK hata — çift duck.** Kapı, native `setVolume`
alanına duck DAHİL değeri yazıyordu; native `userVolume` ise açıkça duck
ÖNCESİ seviyedir ve duck'ı AYRICA uygular. Yol ilk kez F6.1'de canlandığı için
sahada duyulmamıştı: NAVIGATION duck'ında ses %30 yerine **%9**'a düşerdi.
Düzeltildi (`nativeUserVolume`) ve kilitle korundu.

**Açık borç (gizlenmedi):** ① native `duckMusicForListening()` `STREAM_MUSIC`e
doğrudan yazıyor — **ölü değil, canlı** yol (üçüncü taraf sesi de kısar);
kanonik hâle getirmenin doğru yolu TTS/STT için native
`AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` isteğidir · ② `radarEngine` sistem
sesiyle duck ediyor (aynı gerekçe) · ③ native duck reddi JS kaydına geri
beslenmiyor (LAB'da ayrışma yan yana GÖRÜNÜR).

---

### MUSIC-F7 — YOUTUBE DENEYİMİ (F7.1–F7.6) (2026-09-02)

**Durum: ENTEGRE / SAHA BEKLİYOR.** Kütük 🔴 #1105–#1116 bekliyor.
**ÜRÜN HAZIR: HAYIR.**

Gömülü YouTube/Piped sistemi **yeniden yazılmadı**; kanonik Music
otoritelerinin İÇİNE alındı. Ölçülen ve kapatılan gerçek açıklar:

1. **Çalma kapının dışındaydı** — `carosMediaLayer` doğrudan `playYouTube()`
   çağırıyor, `playYouTube` de diğer backend'leri **doğrulamasız** durduruyordu
   (ikinci devir yürütücüsü). Artık `playSource({source:'YOUTUBE'})` →
   `sourceCoordinator` (durdur + DOĞRULA) → adaptör.
2. **Transport kapının dışındaydı** — kapı play/pause/seek'i KOŞULSUZ native
   köprüye yolluyordu. Artık yürütme backend SAHİBİNE dağıtılır
   (`BackendTransport`); sunmayan backend `unsupported_capability` ile
   REDDEDİLİR (sessiz yutma yok).
3. **YouTube duraklatılamıyordu** — IFrame kaynağında `transport` hiç `PLAYING`
   olmuyordu; düğme hep "çal" gösterip `play` gönderiyordu. IFrame'in KENDİ
   `PLAYING` olayı bu backend için ulaşılabilir en yüksek kanıttır ve artık
   transporta yansır. **Native yolun dürüstlük kuralı gevşetilmedi.**
4. **Sonraki/önceki çizilmiyordu** — düğmeler yalnız `supportsQueue` ile
   açılıyordu; YouTube'da o (doğru biçimde) `false`. Artık sıra **backend'in
   veya üst katmanın** olabilir; ikisi de yoksa düğme çizilmez. Ekran · split ·
   theater · donanım tuşları AYNI kuyruk-farkında girişten geçer.
5. **Kapak boş kalıyordu** — sağlayıcı `https` küçük resmi native MediaStore
   decode'una gönderiliyordu. Artık GEÇİRİLİR (`REMOTE`), diske yazılmaz.
6. **Sürüşte video açıktı — GÜVENLİK.** Video modu koşulsuzdu ve tam ekran
   video (z-index 2147483000) araç hareket hâlindeyken de görünüyordu. Yeni SAF
   `videoSafetyPolicy`: duruş **kanıtlanmadan** görüntü açılmaz; **ses
   etkilenmez**; gerekçe kullanıcıya gösterilir; sesli komut sahte onay vermez.

7. **Sağlayıcı sırası ikinci otoriteydi (F7.6).** Sağlayıcı kuyruğu
   `carosMediaLayer._queue/_qIndex/_qRevision` içinde tutuluyordu; kanonik
   `PlayQueue` yalnız kütüphane seçimleri için kuruluyor, sağlayıcı çalmasında
   `ListeningSession` **hiç doğmuyordu**. **ÜRÜN KARARI (2026-09-02):
   SAME-PROVIDER (Seçenek 1)** — kanonik kuyruk tek `SourceClass` taşımaya
   devam eder; kuyruk **seçilen parçanın kaynak sınıfıyla sınırlanır**,
   karışık-sağlayıcı `PlayQueue` modeli KURULMAZ. Artık sağlayıcı seçimi de
   `buildProviderQueueContext → PlayQueue → ListeningSession →
   MediaCommandGateway` zincirinden geçer; medya katmanında kalan tek şey
   **sunum önbelleğidir** (sıra/imleç TUTMAZ). Dışarıda kalan satırlar sessizce
   düşürülmez (`excludedIds` → LAB `Sağlayıcı sınırı (F7.6)`).

**Sahte durum üretilmedi:** sağlayıcı timeline'ı olmadığı için gözlenen kuyruk
kanıtı `UNAVAILABLE + gerekçe` kalır (uydurma kuyruk yok), playlist desteği
**iddia edilmez** ve kuyruk DÜZENLEMESİ bu kaynaklarda hâlâ
`unsupported_capability` ile reddedilir — yalnız **gezinme** meşrudur.

**Sonraki atomik PR:** kütük #1105–#1116'yı gerçek head unit'te koş. Özellikle
#1107 (sürüşte video kapalı — güvenlik), #1105 (tek audible backend), #1109
(duraklat çalışıyor) ve #1113/#1115 (kanonik sağlayıcı kuyruğu + same-provider
sınırı) atlanmamalı.

**SAHA BUGFIX (2026-09-03) — 3 gerçek saha kusuru düzeltildi (kütük #1202–#1204,
CODE FIXED · DEVICE PENDING):**

- **YouTube/Piped ses hiç başlamıyordu.** Kök neden: `start()` kanıtı
  `activePackage===YOUTUBE_PKG` bayrağından alınıyordu — bu bayrak
  `loadVideoById` çağrılmadan ÖNCE koşulsuz yazılıyordu, yani otoyoklama
  engeli/embed reddi sessizce COMMIT'e sürüklüyordu. Kanıt artık IFrame
  player'ın KENDİ durumundan (`getYouTubePlaybackState`) okunuyor; sınırlı
  (2600ms) bekleme `PLAYING`/`BUFFERING` beklerse, yoksa dürüst FAIL+rollback.
- **MiniPlayer DockBar'ı eziyordu.** `bottom: 12` ham piksel yerine kanonik
  `--lp-dock-h` çapası benimsendi (ikinci yerleşim otoritesi kurulmadı).
- **Madde 6 GÜNCELLENDİ — ürün kararı değişti:** CarOS artık hareket/hız
  nedeniyle videoyu **otomatik engellemez**. `videoSafetyPolicy`/
  `useVideoSafety` **silinmedi** (LAB gözlemi + gelecekteki opt-in ülke/
  mevzuat politikası için saf sınıflandırma olarak kalır) ama bugün hiçbir
  üretim yolu onu playback/görüntü GATE'i olarak kullanmıyor.

Detay: `docs/DEVICE_VALIDATION_LEDGER.md` #1202–#1204 ·
`musicFieldBugfixYtMiniplayerVideo.test.ts` (17 kilit).

### MUSIC-F8 — SÜRÜŞ-FARKINDA MÜZİK ZEKÂSI (2026-09-02)

**Durum: ENTEGRE / SAHA BEKLİYOR.** Kütük 🔴 #1117–#1122 bekliyor.
**ÜRÜN HAZIR: HAYIR.**

CarOS Music'i sıradan bir çalardan ayıran katman. **AI/LLM YOKTUR, bulut
YOKTUR, "sana özel / ruh hâlini biliyorum" iddiası YOKTUR** — yalnız ölçülen
araç bağlamı ve sayılabilir yerel kanıt.

**Ne yapar:** hız · yolculuk · rehberlik · saat sinyallerinden bir bağlam
(`PARKED/CITY/HIGHWAY` × `DAY/NIGHT` × yolculuk evresi) sınıflandırır; aynı
bağlamda **korunan** dinlemelerden sınırlı bir tercih kanıtı biriktirir; müzik
durmuşken bağlama uygun TEK bir öneri sunar ve büyük çal tuşunu bağlam-farkında
yapar.

**Neyin sahibi DEĞİLDİR:** playback (F0) · kuyruk/oturum (F3) · arama (F5) ·
sağlayıcı (F7) · sürüş durumu (`smartDrivingEngine`/VDL). İkinci otorite,
ikinci scheduler, ikinci öneri deposu KURULMADI.

**Fail-closed kapılar (sıra önemli):** ses çıkıyorsa DOKUNMA → açık kullanıcı
niyeti varsa SUS (20 dk) → bağlam kanıtsızsa SUS → kanıt yok/zayıfsa SUS →
ancak hepsi geçilirse öner; otomatik devam yalnız yolculuk başlangıcı + yüksek
güven + ≥3 korunmuş dinleme + açık oturum yokken. **Kullanıcı dokunmadan
kendiliğinden ses BAŞLAMAZ.**

**Gizlilik (pazarlıksız):** kalıcı tercih kanıtına parça/albüm/sanatçı adı ·
URI · kapak · sorgu · konuşma · konum · rota · hedef · sağlayıcı içerik kimliği
**YAZILMAZ**. Yalnız kova · niyet türü · cihaz-yerel kütüphane kimliği · kaynak
sınıfı · sayaçlar. Sınırlı (48 satır LRU) · TTL 45 gün · kullanıcı silebilir ·
şema testle kilitli.

**Performans:** timer YOK · polling YOK · hot-path'e maliyet YOK. Karar yalnız
yüzey değerlendirmesinde ve dinleme oturumu değişiminde üretilir; latency LAB'da
ölçülür. **Host ölçümü cihaz performansı SAYILMAZ** (kütük #1122).

**LAB:** yeni ekran AÇILMADI — `media-authority` ekranına `18 · Sürüş-Farkında
Müzik (F8)` kartı eklendi (bağlam kanıtı · eksik sinyal · güven · tercih kanıtı ·
en güçlü aday · son karar · bastıran kapılar · açık niyet · sayaç · latency).
Kullanıcıya skor/gerekçe GÖSTERİLMEZ; bunlar yalnız LAB'dadır.

**Açık borç (bilinçli):** ① kontak/yolculuk başlangıcında UI olmadan otomatik
çalma YAPILMADI (arka plan aktörü gerektirirdi — timer-kurma yasağı korundu);
② Mavi entegrasyonu bu fazda YAPILMADI (karar katmanı saf olduğu için Mavi
ileride *requester* olarak kullanabilir).

**Sonraki atomik PR:** kütük #1117–#1122'yi gerçek araçta koş. Özellikle #1119
(çalan müziğe karışmama) ve #1121 (kendiliğinden ses başlamaması) atlanmamalı.

### MUSIC-F9 — MAVİ MUSIC COMPANION (2026-09-02)

**Durum: ENTEGRE / SAHA BEKLİYOR.** Kütük 🔴 #1123–#1129 bekliyor.
**ÜRÜN HAZIR: HAYIR.**

Mavi'nin müzik tarafı yeniden yazılmadı; F0–F8 kanonik otoritelerine BAĞLANDI.
Mavi **requester**dır — ikinci playback · kuyruk · arama · sıralama · öneri
otoritesi KURULMADI.

**Yeni:** UI-bağımsız tek `MusicIntent` sözleşmesi (taşıma · arama · kuyruk ·
devam · bağlamsal · ses), **yerel ve deterministik** niyet çözümü (bulut/LLM
GEREKTİRMEZ) ve kanonik yönlendirici.

**Düzeltilen GERÇEK kusurlar:**
1. Sesli **"sonraki"** sağlayıcı kuyruğunda düşüyordu — `commandExecutor`
   F7.3'ün kuyruk-farkında girişini ATLIYORDU (`mediaService`e doğrudan
   iniyordu). Kanonik giriş artık kanıt döndürür; tek giriş korundu.
2. **Üç ayrı koşulsuz iddia** ("<başlık> çalınıyor" · "Müzik açılıyor" ×2)
   kaldırıldı; cümle artık YALNIZ kanıt derecesinden doğar.

**İddia ↔ kanıt kilidi:** `VERIFIED` → "çalıyor" · `ACCEPTED_UNVERIFIED` →
"başlatmayı deniyorum" (**asla "çalıyor" değil**) · `AMBIGUOUS` → "hangisi?" ·
diğerleri → neden + teklif. Teknik hata kodu kullanıcıya OKUNMAZ.

**Ürün kararları:** kaynak niteleyicisi yalnız FİLTREdir ve **sessiz kaynak
değişimi YOKTUR** · belirsizde **kör autoplay YOK** (F5 kanıt eşiği korunur) ·
açık bağlamsal istek F8'in otomasyon kapılarını aşar ama **kanıt kapısını
aşmaz** · **ruh hâli/tempo ölçümü YOKTUR** ve uydurulmaz · sorgusuz "müzik aç"
rastgele bir şey çalmaz · kuyrukta olmayan işlem uydurulmaz.

**Güvenlik:** Mavi F7.2 sürüş video kapısını BYPASS EDEMEZ (video bir müzik
niyeti değildir) · duck F6.1 kanonik otoritesindedir.

**LAB:** yeni ekran AÇILMADI — `media-authority` → `19 · Mavi Müzik Niyeti (F9)`
(niyet · rota · komut gerçeği · iddia sınıfı · neden kodu · kaynak · netleştirme ·
bağlam kanıtı · kuyruk · bayat tur · **iddia uyuşmazlığı 0 olmalı** · latency).
Söylenen metin telemetriye YAZILMAZ.

**Açık borç:** mood/tempo tabanlı öneri (ölçüm kaynağı yok) · kanonik playlist
modeli · `commandParser` eski müzik niyetlerinin F9 sözleşmesine tam göçü.

**Sonraki atomik PR:** kütük #1123–#1129'u gerçek araçta koş. Özellikle #1123
(iddia ↔ gerçek oynatma) ve #1128 (sürüşte video kapısı) atlanmamalı.

### MUSIC-F10 — MOOD / ENERGY INTELLIGENCE (2026-09-02)

**Durum: İSKELET+ / KANIT KAYNAĞI BAĞLI DEĞİL.** Kütük 🔴 #1130–#1135 bekliyor.
**ÜRÜN HAZIR: HAYIR.**

**Bu fazın en önemli çıktısı bir ÖLÇÜMDÜR:** CarOS'ta bugün hiçbir kaynak
gerçek enerji/tempo ölçümü VERMİYOR — MediaStore projeksiyonunda `GENRE`/`YEAR`
sorgulanmıyor, Piped/YouTube trait vermiyor, Spotify `audio-features`
çağrılmıyor. Bu yüzden F10 **ölçüm uydurmadı**; ölçüm geldiğinde hazır olan bir
kanıt sözleşmesi kurdu ve bugün yalnız AÇIKÇA ETİKETLİ zayıf türetimler
kullanıyor.

**Kanıt modeli:** `MusicTraitEvidence` (energy · tempoBpm · mood · confidence ·
provenance · signals). Zorlanan kurallar: **BPM yalnız gerçek ölçümden** ·
**sezgisel kanıt `LOW` tavanlı** · **birleştirme güveni yükseltmez** · değersiz
kanıt `NONE`a düşer · modelde parça/sanatçı ADI taşınmaz.

**Seçim fail-closed:** "daha sakin/enerjik" GÖRECELİDİR — çalanın kanıtı yoksa
kıyas UYDURULMAZ; algılanabilir fark (≥0.20) yoksa seçim yapılmaz; kanıtsız
adaylar sessizce düşmez, sayılarak elenir; seçim güveni en ZAYIF halkadır.

**Yürütme kanonik:** F9 niyet → F10 (yalnız KİMLİK) → F3 `startLibraryListening`
→ PlayQueue/ListeningSession → Gateway/F0. F10 çalma başlatmaz, kuyruğa/
kütüphaneye/F8 kanıtına yazmaz, timer kurmaz. Gömülü YouTube deneyimi
DEĞİŞMEDİ.

**Dil dürüstlüğü:** kanıt zayıfken "daha sakin olabilecek bir şey deneyeyim";
kesin dal bugün ULAŞILAMAZDIR (sezgisel kanıt `LOW` tavanlı) ve bu LAB'da
sayaçla görünür.

**LAB:** yeni ekran AÇILMADI — `media-authority` → `20 · Karakter / Enerji
Kanıtı (F10)`.

**AÇIK BORÇ — F10 tamamlandı SAYILAMAZ:** ① MediaStore `GENRE`/`YEAR`
projeksiyona eklenmedi (native + cihaz doğrulaması) · ② Spotify `audio-features`
bağlanmadı (ağ bütçesi/oran sınırı/sağlayıcı politikası) · ③ sağlayıcı tarafında
trait yok (ürün sınırı). Kütük **#1135** bu borcu açık tutar.

**Sonraki atomik PR:** kütük #1130–#1135'i gerçek araçta koş; özellikle #1130
(kanıtsızken sahte seçim yok) ve #1133 (kanonik zincir) atlanmamalı.

### MUSIC-F10.1 — GERÇEK KARAKTER KANITI KAPANIŞI (2026-09-02)

**Durum: ENTEGRE / SAHA BEKLİYOR.** Kütük 🔴 #1136–#1141 bekliyor.
**ÜRÜN HAZIR: HAYIR.**

F10'un açık blocker'ı (#1135 — "gerçek trait kaynağı bağlı değil") **kod
tarafında KAPATILDI**. F10 mimarisi yeniden yazılmadı; kanıt kaynakları bağlandı.

**Bağlanan GERÇEK kaynaklar:** ① MediaStore `GENRE` (API 30+) + `YEAR`
projeksiyona eklendi · ② dosyaya gömülü ID3 `TBPM` / Vorbis `BPM` **media3
`MetadataRetriever`** ile okunuyor (dosya DECODE EDİLMEZ; 24 dosya toplu iş,
dosya başına 1,5 sn zaman aşımı, ayrı arka plan havuzu).

**Bağlanmayanlar (uydurulmadı):** YouTube/Piped trait alanı YOK
(`UNSUPPORTED`) · Spotify `audio-features` sözleşmesi doğrulanamadı
(`UNVERIFIED` — varmış gibi davranılmadı) · ses analizi yapılmıyor
(`MEASURED_AUDIO` KULLANILMIYOR).

**Sıkılaştırılan kural:** F10'da `LIBRARY_METADATA` BPM taşıyabiliyordu;
F10.1'de **tür/yıl BPM YAZAMAZ**. BPM yalnız gömülü etiket/gerçek ölçümden.

**Dürüstlük:** tür TEK BAŞINA ruh hâli iddiası kuramaz (destekleyici · `LOW`) ·
BPM'den mood üretilmez · birleştirme güveni yükseltmez · bozuk etiket (40–250
dışı) kanıt sayılmaz · dosya değişirse bayat kanıt kullanılmaz (şema + kuşak
anahtarda).

**Ürün etkisi:** iki tarafta da gömülü BPM varsa seçim güveni `MEDIUM`a çıkar →
Mavi artık "Daha sakin bir şey açıyorum" gibi **kesin dil** kurabilir. Etiketsiz
kütüphanede dil **temkinli** kalır.

**Bu turda yakalanan gerçek kusur:** LAB alanı `peekReferenceEvidence` üretim
önbelleğine/sayaçlarına yazıyordu; F3.2'nin salt-okunurluk kilidi yakaladı →
saf hesaplayıcı ayrıştırıldı + kalıcı kilit eklendi.

**Açık sınır:** sağlayıcı tarafı hâlâ kanıtsız (#1141).

**Sonraki atomik PR:** kütük #1136–#1141'i gerçek cihazda koş; özellikle #1136
(Android 10'da çökme yok) ve #1137 (gerçek BPM okunuyor) atlanmamalı.

### MUSIC-F13 — FAVORİLER / MUSIC COLLECTION AUTHORITY (2026-09-02)

**Durum: ENTEGRE / SAHA BEKLİYOR.** Kütük 🔴 #1142–#1147 bekliyor.
**ÜRÜN HAZIR: HAYIR.**

**Ölçülen gerçek:** repoda bir favori/koleksiyon otoritesi hiç YOKTU. Tek iz
F11'de kaldırılan `onClick`siz kalp düğmesi (süs, hiçbir state'e bağlı değildi)
ve `commandParser`nin ölü `ADD_MUSIC_FAVORITE` dalıydı ("bu özellik şu an
desteklenmiyor"). F13 **TEK** `musicCollectionAuthority`yi kurdu; F0–F12'nin
hiçbir otoritesi (playback · PlayQueue · ListeningSession · MusicIndex ·
arama sıralaması · sağlayıcı devri · öneri/F8 · trait/F10) ele geçirilmedi.
**"Favori olmak = çalıyor olmak DEĞİLDİR. Favori olmak = öneri kanıtı
DEĞİLDİR."**

**Kimlik modeli:** F3'ün ZATEN var olan `CanonicalMediaIdentity`si YENİDEN
KULLANILDI — yeni bir kimlik icat edilmedi. Anahtar LOCAL'de `libraryId`,
PROVIDER'da `providerNamespace+providerId`dir; **başlık/sanatçı hiçbir zaman
anahtarın parçası değildir**. Kanıt yetersizse (yalnız başlık/sanatçı varsa)
favori KURULMAZ.

**Kalıcılık:** LOCAL kayıt yalnız `libraryId` taşır — başlık/sanatçı/kapak her
zaman `MusicIndex`ten CANLI çözülür. PROVIDER kayıt bounded görüntü
metadata'sı (title/artist/artwork/contentUri) taşır — F7.6'nın kuyruk
girdilerinde zaten yaptığının AYNISI, çünkü sağlayıcı içeriği için geriye
dönük kanonik bir dizin yok. Sorgu/sesli komut metni/konum/rota şemaya
GİRMEZ. Bozuk/şema-uyumsuz kayıt fail-closed atlanır.

**Oynatma sınırı (yapısal):** `resolvePlaybackTarget` yalnız VERİ döndürür —
kendisi hiçbir zaman dispatch etmez. Gerçek dispatch ÇAĞIRANDA olur (F9
router'ın `runCollection`ı / Discovery'nin seçim akışı) ve her çağrı tek-öğe
tek-sağlayıcı bir kuyruk kurar — bu, "favoriler playback otoritesi olamaz" ve
"karışık-sağlayıcı favori listesi ≠ karışık-sağlayıcı PlayQueue"
kısıtlarının YAPISAL güvencesidir.

**Now Playing:** F11'de kaldırılan kalp düğmesi GERİ GELDİ — ama artık gerçek
`useFavoriteStatus` projeksiyonuna bağlı. Kimlik kanıtsızsa düğme hiç
çizilmez; iyimser sahte state yok, `toggle()` senkron doğrulanmış otorite
sonucunu yansıtır.

**Discovery:** yeni bir `FAVORITES` bölümü — YALNIZ gerçek favori varken
çizilir (F5'in "kanıt yoksa bölüm yok" kuralı burada da geçerli). Seçim LOCAL
favoride `startLibraryListening`, PROVIDER favoride `UnifiedSearchView`nin
`PROVIDER_PATH` sınırıyla BİREBİR aynı desenle kanonik medya katmanına
(`playMedia`) devreder.

**Mavi/F9:** `MusicIntent` sözleşmesi üç yeni niyetle GENİŞLETİLDİ (yeniden
yazılmadı): `ADD_FAVORITE` · `REMOVE_FAVORITE` · `PLAY_FAVORITES`. "Bunu"
kimliği F3'ün ZATEN var olan `ListeningSession.currentItem`ından gelir —
yoksa istek dürüstçe reddedilir (`no_current_item`), favori UYDURULMAZ.
"Eklendi/çıkarıldı" YALNIZ otoritenin doğruladığı mutasyonda söylenir ve
konuşma katmanında GENEL "X çalıyor." dalına asla düşmez (favori mutasyonu
bir çalma iddiası değildir). Legacy `commandExecutor`'daki tek somut ölü uç
(`ADD_MUSIC_FAVORITE`) bu kanonik yola bağlandı; F9'un `handleMusicUtterance`
serbest-metin çözümleyicisinin canlı sesli girişe henüz bağlanmadığı (önceki
fazlardan kalma, F13'ün kapsamı dışında bırakılan) bilinen sınır DEĞİŞMEDİ.

**Performans:** üyelik sorgusu (`isFavorite`) bir `Map` üzerinde O(1)'dir;
render hot-path'inde tarama/sıralama yok. Timer/polling/global zamanlayıcı
kurulmadı — yalnız mutasyon-tetiklemeli abonelik.

**LAB:** yeni ekran AÇILMADI — `media-authority` → `21 · Favoriler /
Koleksiyon (F13)`. Kart salt-okunurdur, parça adı/URI taşımaz, mutasyon
tetiklemez.

**Sonraki atomik PR:** kütük #1142–#1147'yi gerçek cihazda koş; özellikle
#1142 (kalp düğmesi anında/senkron durum) ve #1145 (karışık-sağlayıcı kuyruk
KURULMUYOR) atlanmamalı.

### MUSIC-F14 — MAVİ LIVE MUSIC INTENT WIRING (2026-09-02)

**Durum: ENTEGRE / SAHA BEKLİYOR. ÜRÜN HAZIR: HAYIR.**

**Ölçülen gerçek:** F9'un `handleMusicUtterance/resolveMusicIntent/MusicIntentRouter`
hattı doğruydu ama canlı ses girişine BAĞLI DEĞİLDİ — yalnız birim testlerinden
çağrılıyordu. F14 bunu `voiceService.processTextCommand`'a yeni bir yerel/
deterministik bypass katmanı ("1c0") ile bağladı: yalnız yerel parser hiçbir şey
BULAMADIĞINDA (`result.command === null`) VE `resolveMusicIntent`'in ürettiği
niyet dar-güvenli bir kümedeyse (kuyruk/bağlamsal/koleksiyon niyetleri) devreye
girer — kritik/hava/sensör bypass'larından SONRA, Gemini-first'ten ÖNCE. Yeni
parser/playback yolu/otorite KURULMADI. Legacy `routeIntent` çift-yürütme yolu
kaldırılmadı ama `useVoiceCommandHandler`'ın `_MUSIC_INTENT_TYPES` dalıyla artık
aynı kanonik `dispatchIntent`'e yönlendirilir ve `noteLegacyRouteIntentMusicCall`
sayacıyla izlenir (sıfır kalması beklenir — kaldırılmadı, izlenen uyumluluk
adaptörüne indirildi).

**Kalan gerçek risk:** çift-yürütme imkânsızlığı YAPISAL erişilemezlikle
sağlandı (runtime dedup kontrolüyle DEĞİL) — kanıt kütükte AÇIK madde olarak
BEKLİYOR (bu belgeye MUSIC-F14 kütük satırları eklenmedi; **açık borç**: F14
kapanışı için kütük maddeleri yazılmalı — F15 bu boşluğu KAPATMAZ).

### MUSIC-F15 — PLAYLIST / COLLECTION AUTHORITY (2026-09-02)

**Durum: ENTEGRE / SAHA BEKLİYOR.** Kütük 🔴 #1148–#1153 bekliyor.
**ÜRÜN HAZIR: HAYIR.**

**Ölçülen gerçek:** repoda "playlist" YALNIZ F5/F9'un `PLAY_PLAYLIST`i
anlamına geliyordu — bir sağlayıcı playlist'ini adla arayıp çalmak; CarOS'un
KENDİ sahiplendiği, kalıcı bir koleksiyon kavramı hiç YOKTU. F15 **TEK**
`musicPlaylistAuthority`yi kurdu — F13 favori otoritesinden TAMAMEN ayrı bir
depoda (`caros.music.f15.playlists.v1`), F13'ün deposunu (`...f13.favorites.v1`)
ele geçirmeden.

**Kimlik/kalıcılık:** F3/F13'ün ZATEN var olan `CanonicalMediaIdentity`si
YENİDEN KULLANILDI (`playlistItemKeyFor` = F13'ün `favoriteKeyFor`ının kendisi).
Şema F13'le AYNI ilkeyi izler: LOCAL yalnız `libraryId`, PROVIDER bounded
görüntü metadata'sı + `contentUri` taşır; sorgu/ses/konum/rota şemaya GİRMEZ;
bozuk kayıt fail-closed atlanır (playlist'in geri kalanı KORUNUR).

**Karma-sağlayıcı playlist ≠ karma-sağlayıcı PlayQueue:** bir playlist yerel VE
sağlayıcı öğelerini birlikte tutabilir, ama `resolvePlaylistStartPlan`/
`resolvePlaylistStart` yalnız VERİ ÖNİZLEMESİ döner (başlangıç öğesinin
sınıfıyla AYNI sınıftaki öğeler) — gerçek zorlama F7.6'nın ZATEN var olan
`buildProviderQueueContext`ı içinde, `playMedia`'nın kendi kuyruk kurulumunda
gerçekleşir. İkinci bir kuyruk otoritesi KURULMADI; dispatch her zaman
ÇAĞIRANDA (router/UI) kalır.

**Oynatma zinciri:** LOCAL öğe F3 `startLibraryListening`, PROVIDER öğe
kanonik medya katmanı (`playMedia`) — F13'ün `resolvePlaybackTarget` desenini
BİREBİR izler. Çözülemeyen tek öğe listede atlanır; hiçbir çözülebilir öğe
kalmazsa oynatma dürüstçe REDDEDİLİR (sahte çalma iddiası YOK).

**UI:** Discovery'ye F13'ün `FAVORITES`iyle AYNI ilkede yeni bir `PLAYLISTS`
bölümü eklendi (yalnız gerçek playlist varken çizilir). `PlaylistDetailPanel`
(oynat/kaldır/sırala/yeniden adlandır/sil) ve Now Playing'deki
`AddToPlaylistSheet` YENİ ekranlar DEĞİL — mevcut `MusicDiscoverySurface` ve
`MediaScreen`in GENİŞLEMESİdir (ekran enflasyonu yasağına uyar). Sürüş modunda
düzenleme kontrolleri gizlenir (F5.1/Discovery'nin sürüş-daralma desenini
izler), oynatma erişilebilir kalır. Tüm dokunma hedefleri ≥48px.

**Mavi/F9:** `MusicIntent` sözleşmesi dört yeni niyetle GENİŞLETİLDİ:
`CREATE_PLAYLIST` · `ADD_TO_PLAYLIST` · `REMOVE_FROM_PLAYLIST` ·
`PLAY_MY_PLAYLIST` — F14'ün canlı ses hattına (`voiceService`'in "1c0" bypass
katmanı, `PLAYLIST_KINDS` eklenerek) bağlı. Aynı adda birden fazla playlist
varsa AMBIGUOUS ile netleştirme istenir (yanlış liste ASLA seçilmez); adsız
"bunu listeden çıkar" F3'ün ZATEN var olan kuyruk-çıkar anlamını KORUR (ÇAKIŞMA
yok — playlist çıkarma isim ZORUNLU kılar). Mavi kendi başına depo yazmaz;
"oluşturdum/ekledim/çıkardım" YALNIZ otoritenin doğruladığı mutasyonda söylenir.

**LAB:** yeni ekran AÇILMADI — `media-authority` → `22 · Playlist Otoritesi
(F15)`. Kart salt-okunurdur, playlist/parça adı/URI taşımaz, mutasyon
tetiklemez.

**Test kanıtı (masa başı):** `musicF15PlaylistCollectionAuthority.test.ts`
(32 hedefli test) + `regression.guards.test.ts`'e eklenen 9 F15 otorite kilidi
+ ilgili F5/F5.1/F13/F14/F9/F7.6/F3/F12 regresyon dosyaları (262 test) yeşil;
`tsc -b --force` temiz. **Bu masa başı doğrulamadır — cihaz kanıtı DEĞİLDİR.**

**Sonraki atomik PR:** kütük #1148–#1153'ü gerçek cihazda koş; özellikle #1149
(karma-sağlayıcı kuyruk KURULMUYOR) ve #1152 (Mavi belirsiz playlist adında
yanlış liste SEÇMİYOR) atlanmamalı. F14'ün kütük borcu (yukarı bakın) da AYRICA
kapatılmalı — F15 onu ÖRTMEZ.

### MUSIC-F16 — LYRICS / ŞARKI SÖZLERİ EXPERIENCE (2026-09-03)

**Durum: ENTEGRE / SAHA BEKLİYOR.** Kütük 🔴 #1154–#1160 bekliyor.
**ÜRÜN HAZIR: HAYIR.**

**Ölçülen gerçek:** repoda lyrics/altyazı otoritesi hiç YOKTU (`grep -ri lyric`
sıfır sonuç). Kaynak taraması sonucu:
- **LOCAL — AVAILABLE (gerçek, doğrulanmış):** media3 1.4.1'in `media3-extractor`
  AAR'ı açılıp `Id3Decoder.class` bayt kodu incelendi — USLT/SYLT için ÖZEL
  tipli çerçeve YOK (`decodeXxxFrame` metot listesinde yalnız Text/Comment/
  UrlLink/Priv/Geob/Apic/Chapter/ChapterToc/Mllt/Binary var), ikisi de ham
  `BinaryFrame`e düşüyor. F16 bu boşluğu **yeni** bir native sınıfla
  (`TrackLyricsExtractor.java`) doldurdu — ID3v2 §4.9 (SYLT)/§4.10 (USLT)
  spesifikasyonuna göre elle çözer; Vorbis `LYRICS`/`UNSYNCEDLYRICS` yorumu
  media3'ün ZATEN çözdüğü `VorbisComment`tan (F10.1'in `BPM` okumasıyla AYNI
  mekanizma) okunur.
- **Spotify — UNSUPPORTED:** `spotifyService.ts` yalnız `api.spotify.com/v1`
  kullanır; genel Web API'de lyrics uç noktası YOK.
- **YouTube/Piped — UNSUPPORTED:** `pipedProvider.ts`nin Piped/Invidious
  sözleşmesinde (`PipedSearchItem`/`PipedAudioStream`/`InvidiousVideo`/
  `InvidiousFormat`) lyrics alanı YOK.
- Kalıcı lyrics/cache modeli YOKTU (yeni modül, F13/F15 ile AYNI kalıcılık
  ilkesi).

**Karar kuralı uygulandı (spec §15):** gerçek/erişilebilir kaynak (LOCAL
gömülü etiket) VARDI → güvenli şekilde bağlandı. Sağlayıcı kaynağı
(Spotify/YouTube) YOKTU → **sahte lyrics sistemi kurulmadı**, dürüst
`UNAVAILABLE` + açık blocker olarak kütük #1157'ye yazıldı.

**Otorite:** `musicLyricsAuthority.ts` — TEK lyrics otoritesi. Kimlik F13/F15
ile AYNI `CanonicalMediaIdentity`/`lyricsKeyFor` (F13'ün `favoriteKeyFor`ının
kendisi — yeniden İCAT EDİLMEDİ). Playback/PlayQueue/ListeningSession/
MusicIndex'in HİÇBİRİNİ ele geçirmez — yalnız `getListeningSession()`i ve
`getMusicLibrarySnapshot()`i OKUR.

**Senkron projeksiyon (İKİNCİ playback clock YOK):** `activeLyricsLineIndex`
saf, İKİLİ ARAMA (O(log n)) yapan bir fonksiyondur — mevcut playback
pozisyonunu (`music.progress.positionSec`, F7.3'ün ZATEN var olan 2 Hz
interpolasyon döngüsünden) PARAMETRE olarak alır, kendi zamanlayıcısını
KURMAZ. Seek → pozisyon değişir → aynı fonksiyon aynı render turunda yeni
indeksi verir. Timestamp yalnız GERÇEK milisaniye (SYLT `timestampFormat==2`)
ise `SYNCED`; MPEG-frame formatı (1) TAHMİNİ ms'ye ÇEVRİLMEZ, `null` döner —
tahmini zamanlama UYDURULMAZ.

**Cache/offline:** `caros.music.f16.lyrics.v1` — F13/F15 ile AYNI
`safeStorage` deseni, AYRI anahtar. Yalnız LOCAL kaynaklı POZİTİF sonuçlar
kalıcı olur (bugün tek gerçek kaynak budur — üçüncü taraf ToS'u söz konusu
DEĞİL). Dosya değişince (`generationModified`) bayat kanıt DÜŞÜRÜLÜR. Negatif
sonuç ("bu parçada söz yok") da önbelleğe alınır — aynı parça için native
tekrar tekrar sorgulanmaz.

**Now Playing:** yeni bağımsız ekran AÇILMADI — `LyricsPanel.tsx` mevcut
`MediaScreen`in genişlemesidir (kalp/playlist düğmeleriyle AYNI `favorite.
available` kimlik kapısı). Sürüşte yalnız tek büyük aktif satır (senkron
varsa) veya kısıtlama notu gösterilir — tam liste gezintisi/scroll GİZLENİR
(spec §7, mevcut `drivingMode`i okur, İKİNCİ sürüş otoritesi KURMAZ). Söz
yoksa/aranıyorsa dürüst durum metni gösterilir, boş panel ile kandırma YOK.

**Mavi/F9:** `MusicIntent` üç yeni niyetle genişletildi: `SHOW_LYRICS` ·
`HIDE_LYRICS` · `QUERY_LYRICS_AVAILABILITY` — F14'ün canlı ses hattına
(`voiceService`'in "1c0" bypass katmanı, `LYRICS_KINDS` eklenerek) bağlı.
Mavi kendi başına depoya yazmaz; panel görünürlüğü `lyricsPanelVisibility.ts`
(yeni, `videoModeStore.ts` ile BİREBİR aynı hafif presentation-store deseni)
üzerinden TALEP edilir. "Açıyorum/buldum" YALNIZ gerçekten bulunduğunda
söylenir — söz yoksa panel yine açılır (dürüst boş durum) ama Mavi dürüstçe
"bulamadım" der.

**LAB:** yeni ekran AÇILMADI — `media-authority` → `23 · Şarkı Sözleri
Otoritesi (F16)`. Kart salt-okunurdur, **söz metni/satır/URI TAŞIMAZ**,
mutasyon tetiklemez.

**Native doğrulama (masa başı):** `TrackLyricsExtractor.java` bu turda gerçek
`media3-extractor-1.4.1`/`media3-common`/`media3-exoplayer`/Capacitor-Android/
guava sınıf yollarına karşı `javac` ile DERLENDİ (temiz, hatasız) — tam
Gradle/Android build ÇALIŞTIRILMADI (F16 test politikası: yalnız hedefli
native doğrulama).

**Sonraki atomik PR:** kütük #1154–#1160'ı gerçek cihazda koş; özellikle
#1155 (SYLT senkron zamanlama + seek doğruluğu) ve #1157 (Spotify/YouTube'da
sahte söz ASLA görünmüyor) atlanmamalı.

### MUSIC-F17 — SONIC AUDIO INTELLIGENCE (2026-09-03)

**Durum: ENTEGRE · ÜRÜN HAZIR: HAYIR** (kod PASS · saha 🔴 #1161–#1167)

**Ölçülen başlangıç:** `MEASURED_AUDIO` provenance F10'dan beri TANIMLIYDI ama
HİÇ KULLANILMIYORDU. Native tarafta yalnız `TrackTraitExtractor` (media3
`MetadataRetriever`) vardı — bu bir **etiket okumasıdır**, dosya DECODE
EDİLMİYORDU. Ayrıca `traitTelemetry` switch'inde `EMBEDDED_METADATA` dalı
YOKTU: F10.1 kanıtı `evidenceNone`a düşüyor ve LAB onu **"kanıt yok" diye
sayıyordu** (bu turda kapatılan gerçek kusur).

**Yapılan:** `SonicAudioAnalyzer.java` — `MediaExtractor` + `MediaCodec`
(AOSP; yeni bağımlılık/lisans YOK). Mono downmix + ~11 kHz decimation +
512 nokta Hann/FFT. Ölçülenler: tepe/RMS dBFS · crest · ZCR · spektral merkez ·
%85 rolloff · spektral akı · 8 bant normalize enerji · onset zarfı
otokorelasyonundan tempo + güven. Tur başına 4 dosya · dosya başına 4 sn
bütçe · en çok 20 sn ses · `AtomicInteger` iptal kuşağı · ayrı
`sonicAnalysisExecutor` havuzu (kütüphane taramasını bile bloklamaz).
TS tarafı: `src/platform/media/sonic/` (SAF sözleşme + kabul modeli + tek
okuma katmanı + tek dikiş + bounded telemetri).

**Dürüstlük sınırları:** dalga formundan **mood ÜRETİLMEZ** (native tarafta
böyle bir alan hiç yok); zayıf otokorelasyon tepesi (`< 0.35`) **tempo
SAYILMAZ**; `energy` açıkça bir PROXY'dir (girdileri ölçüm, birleştirmesi
yorum); termal/bellek baskısında karar **HİÇ ölçmemektir** (kaba ölçüm kanıt
değildir); sağlayıcı içeriği ölçülemez (dürüst sınır, #1167).

**LAB:** yeni ekran AÇILMADI — `media-authority` → `24 · Ses Ölçümü / Sonic (F17)`.

### MUSIC-F18 — SMART RADIO / ENDLESS MIX (2026-09-03)

**Durum: ENTEGRE · ÜRÜN HAZIR: HAYIR** (kod PASS · saha 🔴 #1168–#1174)

**Ölçülen başlangıç:** CarOS tek parça açıp bitiyordu; "bunun gibi devam et"
karşılanamıyordu. `PlayQueue.addToQueue` VARDI ama kütüphane parçalarını
MEVCUT kuyruğa ekleyen kanonik bir seam YOKTU.

**Yapılan:** `src/platform/media/radio/` — SAF sıralama politikası + tek dikiş
+ bounded telemetri. F3'e **yeni otorite değil**, kanonik bir uzantı eklendi:
`appendLibraryTracksToQueue` (girdi inşası `buildLibraryQueueContext`,
mutasyon `addToQueue`, native yazım `runQueueCommand`, `forcePlay: false`).
Dört kanonik niyet: `CONTINUE_LIKE_THIS` · `START_RADIO` ·
`PLAY_FAVORITES_MIX` · `LONG_DRIVE_MIX`.

**Dürüstlük sınırları:** Smart Radio **kuyruk otoritesi DEĞİLDİR** (yalnız
aday sırası üretir); **ses varken EKLENİR**, çalan parça baştan alınmaz;
"benzer/sana özel" iddiası YALNIZ `MEASURED` sınıfında (F17 ölçümü ≥4 ve
adayların ≥%50'si); kanıtsız sıra **deterministiktir** (`Math.random` yok);
havuz yalnız yereldir (karma-sağlayıcı kuyruk üretilmez); kalıcı "radyo
state" YOKTUR (istek başına ≤40 öğe).

**LAB:** `media-authority` → `25 · Kesintisiz Akış / Smart Radio (F18)`.

### MUSIC-F19 — LOUDNESS / REPLAYGAIN / VOLUME CONSISTENCY (2026-09-03)

**Durum: ENTEGRE · ÜRÜN HAZIR: HAYIR** (kod PASS · saha 🔴 #1175–#1181)

**Ölçülen başlangıç (fazın en önemli bulgusu):** `volumePolicy` formülündeki
`sourceNormalization` alanı **F0'dan beri VARDI ama HİÇ beslenmiyordu**
(daima 1). Yani seviye tutarlılığı kodda tanımlıydı, üretimde YOKTU.

**Yapılan:** `TrackTraitExtractor` GENİŞLETİLDİ (yeni native yüzey AÇILMADI):
ID3 `TXXX` · MP4/iTunes `----` (`InternalFrame`) · Vorbis/Opus yorumlarından
`replaygain_track_gain` · `_peak` · `r128_track_gain` (Q7.8 → dB).
`src/platform/media/loudness/` + gateway'de TEK yazar
(`setSourceNormalization`). `SystemBoot` → `music-loudness`.

**Dürüstlük sınırları:** **LUFS UYDURULMAZ** (elde etiket ya da düz RMS var;
RMS referansı −14 dBFS bir mühendislik sabitidir ve saha kalibrasyonu bekler);
**YALNIZ KISILIR** (pozitif kazanç `BOOST_NOT_SUPPORTED` ile nötr bırakılır —
headroom/clipping güvenliği); kısma ≤ 12 dB, çarpan ≥ 0.25; **kullanıcı sesi
ve duck DEĞİŞMEZ**, DSP güvenlik preamp'i AYRI kalır; karar parça sınırında ve
bir kez alınır (pumping yok); katman kapanırken çarpan nötre geri çekilir.

**LAB:** `media-authority` → `26 · Seviye Tutarlılığı (F19)`.

### MUSIC-F20 — GAPLESS / CROSSFADE / INTELLIGENT TRANSITIONS (2026-09-03)

**Durum: ENTEGRE · ÜRÜN HAZIR: HAYIR** (kod PASS · saha 🔴 #1182–#1188)

**Ölçülen platform gerçeği:** (1) **gapless ZATEN VAR** — ExoPlayer kuyruğu
`setMediaItems` ile alır ve kodlayıcı gecikme/dolgu bilgisini kendisi uygular;
CarOS `setPauseAtEndOfMediaItems` KULLANMAZ → F20'nin işi **bozmamaktı**.
(2) **GERÇEK CROSSFADE MÜMKÜN DEĞİL** — tek `ExoPlayer` örneği vardır; üst
üste binme ikinci bir player/mikser ister = ikinci playback otoritesi (yasak).
(3) **BEAT MATCHING / TIME STRETCH altyapısı YOK.**

**Yapılan:** native `transitionGain` çarpanı
(`userVolume × duck × transitionGain`) + sınırda doğrusal rampa +
`setTransitionPolicy` komutu; TS'te `src/platform/media/transition/`
(yetenek tablosu + politika + HAFİF kalıcı tercih + tek dikiş + telemetri);
UI'da "Parça geçişi" bölümü (Ses Deneyimi). `SystemBoot` → `music-transition`.

**Dürüstlük sınırları:** yapılan şey **crossfade DEĞİL, sınırda FADE**'dir ve
öyle adlandırılır (`TRUE_CROSSFADE: UNSUPPORTED` · `BEAT_MATCHED: UNSUPPORTED`,
UI'da böyle bir kontrol ÇİZİLMEZ); albüm devamlılığında fade UYGULANMAZ;
canlı içerikte ve duck etkinken uygulanmaz (TS + native çift kapı); "akıllı"
kısım yalnız SÜREdir ve yalnız `MEASURED_AUDIO` kanıtından gelir; varsayılan
KAPALI; geçiş kazancı **playback truth ÜRETMEZ**.

**Bu turda yakalanan gerçek kusur:** geçiş tercihi ağır politika modülünde
durduğu için bir UI bileşeni termal/bellek gözcüsünü ve kütüphane indeksini
transitif olarak yüklüyordu → tercih hafif `transitionPreference` modülüne
AYRILDI ve sınır kilitle korundu.

**LAB:** `media-authority` → `27 · Parça Geçişi (F20)`.

### MUSIC-F21 — OFFLINE / CACHE / RECOVERY / IGNITION CONTINUITY (2026-09-03)

**Durum: ENTEGRE · ÜRÜN HAZIR: HAYIR** (kod PASS · saha 🔴 #1189–#1195)

**Ölçülen başlangıç:** kurtarma mimarisi ZATEN sağlamdı ve KORUNDU —
`restoreListeningSession` bağlamı geri yükler ama **ASLA ÇALMAZ**
(`playbackClaim: 'NONE'`), süreklilik `UNKNOWN` başlar, YouTube kuyrukta
`piped://` **sentinel** taşır (adres çalma anında çözülür), bayat kütüphane
girdileri `revalidateAgainstLibrary` ile düşer.

**Kapatılan gerçek açık:** doğrudan `http(s)` akış adresi taşıyan sağlayıcı
girdileri (Jamendo · Audius · doğrudan akış) kalıcı kayda giriyordu ve saatler
sonra "canlı" muamelesi görüyordu → basınca ölen satır. Artık
`classifyEntryFreshness` ile sınıflandırılır ve `EXPIRING_REMOTE`/`UNKNOWN`
geri yüklemede DÜŞÜRÜLÜR (sayılarak).

**Yapılan:** `src/platform/media/recovery/` — SAF sınıflandırma + fail-closed
`decideAutoResume` + tek okuma katmanı + bounded telemetri.

**Dürüstlük sınırları:** **kontak UYDURULMAZ** (kanıt yalnız RPM/akü
geriliminden; eşik OBD `linkLossLedger` ile BİREBİR aynı 13.0 V; yoksa
`UNKNOWN`); otomatik devam FAIL-CLOSED ve üretimde politika **KAPALI**
(`POLICY_ALLOWS_AUTO_RESUME = false`) → kullanıcı dokunmadan ses BAŞLAMAZ;
kullanıcı duraklattıysa kendiliğinden açılmaz; çevrimdışıyken ağ gerektiren
kaynak dürüstçe TEKLİF edilir; **ikinci kurtarma motoru KURULMAZ** (§18).

**LAB:** `media-authority` → `28 · Süreklilik / Kurtarma (F21)`.

### MUSIC-F22 — FINAL COMPLETENESS AUDIT + HEAVY QA (2026-09-03)

**Durum: ENTEGRE (kod kapandı) · ÜRÜN HAZIR: HAYIR** (saha 🔴 #1196–#1198)

**Denetimde kapatılan gerçek açıklar:** (1) eski `musicCommandParser` shuffle
dalı yürütmeden ÖNCE `"…karışık çalınıyor"` diyordu → `"…çalmayı deniyorum"`
(#1196); (2) ölü kod (`isSonicResolved` · `getTransitionCapabilities`)
kaldırıldı; (3) native derleme kusurları — `SonicAudioAnalyzer` import
edilmemişti ve `JSArray.put(double)` `JSONException` bildirdiği için bant
vektörü yazımı derlenmiyordu (#1197). **Üçüncüsü yalnız gerçek Android
derlemesinde göründü; host testi yakalayamazdı.**

**Denetimde temiz çıkanlar (kanıtlı):** UI'dan sağlayıcı/native doğrudan
çalma 0 · yeni önbeleklerin hepsi sınırlı · 5 yeni telemetride ad/URI/metin
yok · `SystemBoot` cleanup kayıtları tam · duck token deposu yapısal sınırlı.

**AĞIR DOĞRULAMA (bir kez):** full suite **806 dosya / 17.949 test PASS** ·
`tsc -b --force` PASS · değişen dosya lint PASS · production build **PASS**
(9 dk 25 sn) · Android `compileDebugJavaWithJavac` · `testDebugUnitTest` ·
`assembleDebug` **BUILD SUCCESSFUL**.
*Kanıt ↔ diff notu:* full suite ve production build native düzeltmeden ÖNCE
koştu; o düzeltme yalnız iki Java dosyasına dokundu (TS/Vite çıktısı
etkilenmedi), bu yüzden TS kanıtı geçerlidir ve tekrar koşulmadı.

**Hüküm:** `MUSIC-CODE: PASS` · `MUSIC-BUILD: PASS` · `MUSIC-NATIVE: PASS` ·
`MUSIC-DEVICE: PENDING`.

**Sonraki atomik PR:** kod tarafında Music işi KALMADI. Sıradaki iş bir
**FIELD VALIDATION kampanyasıdır**: kütük #1161–#1198 gerçek head unit'te
koşulmalı. Atlanamayacak maddeler: #1162 (analiz sırasında ses kesilmemesi) ·
#1163 (uydurma BPM yok) · #1169 (çalan müziğe karışmama) · #1178 (kullanıcı
sesi/duck değişmemesi) · #1184 (fade'in gerçekten düzgün duyulması) ·
#1190 (phantom PLAYING yok) · #1192 (kendiliğinden ses başlamaması).

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

---

## CAROS LAB DENETİMİ — "Gözlemlenemeyen motor" ve "beslenmeyen ekran" (2026-08-21)

CAROS LAB'ın tamamı katalog → ekran → kaynak → üretici zinciri boyunca tarandı.
Sorulan tek soru: **"çalışmayan yer var mı?"**

### Sağlam çıkanlar (negatif bulgu da kanıttır)

- **Katalog ↔ ekran ayrışması YOK** — 51 `AVAILABLE` aracın 51'inin de gerçek
  ekran eşlemesi var; `renderAvailableTool` hiçbir arac için `null` dönmüyor.
- **Lazy import hedeflerinin tamamı tutarlı** — 51 dinamik `import()` yolunun
  dosyası mevcut ve beklenen named/default export'u taşıyor (host kilidi).
- **Kapı fail-closed ve ALTI giriş noktasında da doğru sarılı** — `AppGrid` ·
  `DockBar` · `DrawerPanel` + dört tema yerleşimi; hepsi `useCarosLabAllowed()`
  ile korunuyor, satış build'inde dallar ölü kod olarak eleniyor.
- **Zero-leak temiz** — LAB ağacındaki her `setInterval` karşılığında
  `clearInterval` var; `mountedRef` deseni tutarlı uygulanmış.
- **Sahte veri YOK** — taramada tek bir uydurma sabit/örnek veri bulunmadı;
  `mock` geçen her yer *"mock KANIT DEĞİLDİR"* kuralını UYGULAYAN koddu.

### Kapatılan iki kusur

1. **Kurtarma merdiveni gözleme bağlandı (kütük #689).** CAN ECU-silent kurtarma
   motoru sahada çalışıyordu ama tek çıktısı `console.info` idi → cihazda
   `adb logcat` olmadan *"merdiven neden tırmanmıyor"* sorusunun yanıtı YOKTU.
   `recovery-monitor` `PLACEHOLDER→AVAILABLE`. **Yeni sayaç üretilmedi.**
2. **Kod yorumundaki yalan temizlendi (kütük #690).** `driverSnapshotRuntime.capture()`
   *"Çağıran: trip başlangıcı"* diyordu; repoda çağıran YOKTU. Yorum, kablonun
   yazılmadığını açıkça söyleyecek şekilde düzeltildi — **kablo KURULMADI**,
   borç açık bırakıldı (uydurma veriyle boş ekran doldurmak riskliydi).

### Kapsam dürüstlüğü düzeltmesi

`TÜMÜNÜ YENİLE` turu LAB'ın **9 kanıt bölümünü** kapsıyor, 51 ekranı değil; ama
hüküm rozeti düz **"TÜMÜ TAZELENDİ"** yazıyordu. Bir gözlem yüzeyinde "tümü"
kelimesi tehlikelidir: tazelenmemiş bir ekranın bayat değeri, yeşil rozetin
altında TAZE sanılır. Etiket **"KAPSAMIN TÜMÜ TAZELENDİ"** oldu ve bar'a kapsamı
sayıyla söyleyen kalıcı bir satır eklendi (sayı `CAROS_LAB_REFRESH_SECTIONS`ten
TÜRETİLİR — elle yazılmadığı için ayrışamaz).

### Açık kalan borçlar (kapatılmadı, gizlenmedi)

| Borç | Sınıf |
|---|---|
| Altı Fleet ekranı yapısal olarak boş — sunucu köprüleri hiç çağrılmıyor | **Kablo yok** (kütük #690) |
| `memory-explorer` · `knowledge-explorer` — motor ÜRÜNDE var, LAB ekranı yok | **Gözlemlenebilirlik borcu** |
| `benchmark` · `stress-test` · `uds-explorer` · `tool-calling` — motor da yok | Dürüst placeholder (borç DEĞİL) |
| Testi olmayan LAB ekranları: `AiMechanic` · `CapabilityGates` · `EnforcementPoints` · `LiveData` · `RemoteCommand` · `ThemeRuntime` · `BackgroundPower` · `RecoveryMonitor` dışındaki yeni turlar | Mandate madde 7 |
| Shell'de arama/filtre yok — 59 kart yalnız kategori sekmesiyle bulunuyor | UX (Faz A'da düşük öncelik) |

**Host kanıtı:** `tsc --noEmit` temiz · lint 0 error · **583 dosya / 12.789 test yeşil**.
**Saha kanıtı: YOK.** #689 ve #690 kütükte 🔴; hiçbiri "çalışıyor" diye sunulamaz.

**Bir sonraki atomik PR:** #689'un kabul ölçütlerini gerçek araçta koş. Özellikle
**(d)** (motor KAPALIYKEN hiçbir kurtarma tetiklenmemeli — park dalgalanması kilidi)
ve **(e)** (KWP aracında hüküm `BU PROTOKOLDE DEVRE DIŞI`, kırmızı DEĞİL) atlanmamalı:
ikisi de "kurtarma bozuk" yanlış teşhisini üreten vakalardır.

---

## MAVI WAKE GÜVENİLİRLİK ZİNCİRİ — saha kampanyası (2026-09-03/04)

**Neden burada:** "Hey Mavi çalışmıyor" iki gün boyunca TEK bir arıza sanıldı;
gerçekte **dört ayrı katmanda dört ayrı kök neden** vardı ve üçü uygulama kodunda
bile değildi. Bu, vizyon belgesinin "gözlemlenemeyen özellik tamamlanmış değildir"
kuralının en pahalı kanıtı oldu.

| Katman | Kök neden | Nerede çözüldü | Durum |
|--------|-----------|----------------|-------|
| Donanım/HAL | Yanlış mikrofon girişi seçili (`key_double_mic=0`) → konuşma RMS eşiğin ALTINDA, Vosk'a hiç gitmiyordu | cihaz ayarı | 🟢 #1255 |
| Sistem | Varsayılan TTS motoru HİÇ seçili değil (`tts_default_synth=null`) → Mavi konuşuyor, ses çıkmıyor | cihaz ayarı | 🟢 #1256 |
| OEM | Bozuk BT yığını mikrofon yolunu kurcalıyor (katkıda bulunan etken; "kök neden" iddiası GERİ ÇEKİLDİ) | OEM — bizde değil | 🔴 #1254 |
| Uygulama | Takip döngüsünün UI aynası sahibinden ayrışıp wake'i KALICI kilitliyor + sohbet turu deftere hiç kapanış yazmıyor | `voiceConversationRuntime` · `wakeWordService` · `voiceService` | 🔴 #1258 (KOD DÜZELTİLDİ · CİHAZ BEKLİYOR) |

**Uygulama katmanının iki dersi (mimari):**

1. **Aynı olgunun iki temsili sessizce ayrışır.** `followUp` hem runtime'da
   (`_followUpArmed`) hem UI durumunda tutuluyordu; bayrağı kapatan üç yerden
   yalnız biri aynayı da temizliyordu. Ayna artık hiçbir yerde ELLE yazılmaz —
   sahibin hükmüne eşitlenir. (CLAUDE.md §1)
2. **Karar bir projeksiyondan okunamaz.** Wake kapısı UI rozetini okuyordu;
   rozet yanlış kalınca kapı kalıcı olarak kapandı. Kapı artık sahibi sorar.
   (CLAUDE.md §14)
3. **Ölçüm boşluğu, arızanın kendisi kadar pahalıdır.** Sohbet yolu hiçbir
   terminal lifecycle fazı üretmediği için defter "kabul → komut dönen 0" diyordu
   ve teşhis iki gün yanlış yöne gitti. Sohbet artık ayrı ve dürüst bir terminal
   faz (`conversation_result`) üretir — `execution_result` KULLANILMAZ, çünkü
   sohbet bir komut yürütmesi değildir ve o faz sahte yürütme kanıtı olurdu.

### Gözlemlenebilirlik borçlarının kapatılması (aynı tur, 2026-09-04)

Bu kampanyanın en pahalı dersi şuydu: **üç kök nedenin üçü de ürünün DIŞINDAKİ
araçlarla bulundu** (`tinycap`, mikser dökümü, `settings get secure`). Ürün
kendi arızasını gösteremiyordu. Aynı turda iki borç kod olarak kapatıldı:

| Borç | Ne eksikti | Ne eklendi | Kütük |
|------|------------|------------|-------|
| #1256-a | `toplam seslendirme` "çağrı gitti" der, "ses çıktı" DEMEZ | TTS motor sonuç defteri: `NO_ENGINE_REPORT` (motor hiç cevap vermedi) · `SUSPECT_INSTANT_DONE` (süre fiziksel alt sınırın altında) — Mavi Konsolu **F** bölümü | 🔴 #1259 |
| #1255-a | OEM mikrofon yönlendirme ayarı okunmuyor; "RMS düşük" görünüyor ama SEBEBİ görünmüyor | `key_double_mic` **salt-okunur** raporlanıyor + `seviye ↔ eşik` oranı — STT/Mikrofon ekranı | 🔴 #1260 |

**Dürüstlük sınırı korundu:** JS'ten hoparlöre erişim yoktur, bu yüzden hiçbir
yerde "ses duyuldu" İDDİA EDİLMEZ; ölçülen yalnız *motorun cevap verip vermediği
ve seslendirmenin gerçek süresidir*. Aynı şekilde OEM ayarı okunamadığında `0`
UYDURULMAZ — "0" (yanlış giriş) ile "bilinmiyor" ayrı tutulur, çünkü karıştırılırsa
teşhis ters döner. Her iki tur da **yeni ekran AÇMADI**: mevcut iki LAB ekranı
genişletildi (ekran enflasyonu yasağı).

**Durum seviyesi:** Mavi wake word → **ENTEGRE** (kod/test/tsc yeşil).
**SAHADA DOĞRULANDI DEĞİL:** son ölçülen isabet oranı **%40** (5 denemede 2 kabul);
hedef ≥%80. Kütük **#1254 · #1258** 🔴 kaldıkça bu satır yükseltilemez.

**Bir sonraki atomik PR:** kod tarafında bu zincirde yapılacak iş KALMADI.
Sıradaki iş **tek bir saha turudur** ve üç kütük maddesi AYNI oturumda ölçülmeli:
**#1258** (10 ardışık denemede `SUPPRESSED_FOLLOWUP` ARTMAMALI + sürekli sohbet
döngüsü BOZULMAMALI), **#1259** (motoru kasıtlı seçimsiz bırakıp `motor HİÇ cevap
vermedi` sayacının artışını görmek), **#1260** (`key_double_mic` 0↔1 arasında
`seviye ↔ eşik` alanının ALTINDA↔ÜSTÜNDE dönmesi). Üçü de aynı ünitede, aynı
turda ölçülürse zincirin tamamı tek seferde kapanır.

---

### NAV-CARTO — TİCARİ KARTOGRAFİ YENİDEN TASARIMI (2026-09-05)

**Durum seviyesi: ENTEGRE** (kod + kilit + tarayıcı piksel kapısı yeşil).
**SAHADA DOĞRULANDI DEĞİL** — kütük **#1278–#1283** 🔴 kaldıkça yükseltilemez.
**ÜRÜN HAZIR: HAYIR** (gerçek head unit görüntüsü alınmadı; oturumda `adb devices`
boştu).

#### Sorun ifadesi

Kullanıcı gerçek cihaz görüntüsüyle ürün hedefinin karşılanmadığını bildirdi:
*"sokak ağı fazla baskın · çok sayıda yol aynı görsel ağırlıkta · yol sınıfları
ayrışmıyor · label yoğunluğu yüksek · coğrafi semantik zayıf · chrome haritayı
boğuyor · oyuncak/aftermarket Android hissi · dekoratif krem/bronz yaklaşım
profesyonel kartografiye dönüşmemiş."* Aynı turda **önceki oturumun krem/altın
palet kararı geri alındı**: kayıtlı ilke artık şudur —
**dashboard teması ≠ kartografi paleti.**

#### Yöntem: önce ölç, sonra tasarla

Renk seçmeden önce gerçek vektör şeması ölçüldü. Kaynak `VITE_VECTOR_TILE_URL`
= OpenFreeMap planet (değiştirilmemiş OpenMapTiles). TileJSON + üç Türk şehrinin
(İstanbul · Siverek · Mersin) **z8/10/11/12/13/14 karoları indirilip
`@mapbox/vector-tile` ile çözüldü**; katman × property × değer × zoom envanteri
ve karo başına yoğunluk sayıldı. Bu ölçüm dört SESSİZ kusuru buldu — dördü de o
güne dek hiçbir testi düşürmüyordu:

| # | Ölçülen gerçek | Sonuç |
|---|----------------|-------|
| 1 | `landuse.class` içinde `park` · `grass` · `meadow` · `golf` **YOK** (gerçek değerler: school 102 · industrial 75 · cemetery 42 · commercial 40 …) | Harita **park ve orman çizmiyordu**; yeşil, hiç kullanılmayan `landcover` ve `park` katmanlarındaydı |
| 2 | `ramp = 1` oranı: motorway **%72** · trunk %58 · primary %25 | Ekrandaki "otoyol" mürekkebinin çoğu kavşak rampasıydı ve ana arterle **aynı genişlikteydi** |
| 3 | `transportation_name` içinde `class = ferry` var; `road-label` sınıf süzgeci taşımıyordu | Boğaz'ın üstü feribot hattı adlarıyla **kaplıydı** (render'da görüldü) |
| 4 | `place` z10'da karo başına **124–389** kayıt; `place-town` zoom/rank süzgeci taşımıyordu | Köy/mahalle adları düşük zoomda ekranı dolduruyordu |

Yan bulgu: `mapDeclutterModel` POI'lere `icon-opacity` yazıyordu ama POI katmanları
`circle` tipinde — MapLibre reddediyor, `try/catch` yutuyordu. **POI geri çekilmesi
hiç uygulanmamıştı**; kilit yeşildi, ekranda karşılığı yoktu.

#### Yapılan

- **Tek kartografi otoritesi korundu** (`mapStyleBuilders`): tek katman listesi,
  iki renk kümesi. Zoom × özellik görünürlük matrisi (`ROAD_VISIBILITY` ·
  `AREA_VISIBILITY` · `LABEL_VISIBILITY`) **dışa aktarıldı** ki kilitler stille
  aynı tek kaynaktan okusun — ikinci eşik tablosu yok.
- **Yol hiyerarşisi**: `tertiary` · `service` · `path` kendi katmanlarına ayrıldı,
  rampa `RAMP_WIDTH_FACTOR = 0,55`, çizim sırası küçükten büyüğe düzeltildi
  (eskiden `road-minor` EN SON çiziliyordu — tali sokak otoyolun üstüne biniyordu).
- **Etiket motoru**: ana yol adı / yerel sokak adı ayrıldı; feribot ve kavşak adı
  dışlandı; yer adları class + rank + zoom ile kademelendi; `symbol-sort-key` ve
  çakışma önceliği kuruldu (MapLibre yerleşimi listeyi SONDAN tarar — sıra buna
  göre ters kuruldu).
- **Coğrafi semantik**: `landcover` ailesi · gerçek `park` katmanı · `railway` ·
  `aeroway` · `boundary` · `water_name` ilk kez çiziliyor; havuz denizden ayrıldı.
- **Ego işaretçisi**: şampanya-metalik oyuncak SUV → **disk + yön oku** (OEM HMI).
- **Chrome**: KAPAT kırmızı alarm dilinden nötr yüzeye; mod seçicide etiket yalnız
  seçili modda; sol rapor düğmesi nötr yüzeye. Dokunma hedefleri ≥44 px korundu.

#### Mimari sınırlar (hiçbiri ihlal edilmedi)

`cameraFollowAuthority` · `cameraEngine` · `MapInteractionManager` ·
`navMarkerMotionRuntime` · `routeColorModel`/`routeEmphasisModel`/`routeWidthModel` ·
MapStore · F0-B8 · #1276 · #1277 **DEĞİŞMEDİ**. Yeni GPS aboneliği, navigasyon
timer'ı, kamera FSM'i, rota otoritesi veya harita veri otoritesi **eklenmedi**.

Turda yakalanan bir **iki-otorite riski bilinçli olarak geri alındı**: yoğunluk
bütçesi için `road-tertiary`/`road-secondary`/`road-label` üzerine zoom-bağımlı
opaklık rampaları yazılmıştı; bu üç katmanın `line-opacity`/`text-opacity`
özelliği `NAV_SUPPRESS_TIERS` + `MapLayerManager`'a AİTTİR ve düz sayıyla yazılır
— stile ifade koymak ilk yazımda onu kalıcı silerdi. Genelleştirme `minzoom`,
`text-size` ve genişlik merdivenine taşındı; kural kilitle sabitlendi.

#### Kanıt

- **Kilit:** `cartographyAuthority.test.ts` **39 PASS** (9 bölüm: tek otorite ·
  ölçülmüş şema · genelleştirme · yol hiyerarşisi · etiket motoru · POI bütçesi ·
  yüzey bütçeleri · semantik palet · üretim yüzeyi). Stil ayrıca **resmî MapLibre
  şema doğrulayıcısından** (`validateStyleMin`) geçiriliyor — kütük #552'deki
  "geçersiz katman sessizce düşer" sınıfı bir daha sessiz kalamaz.
- **Mevcut kilitler:** 18 harita/rota test dosyası **364 PASS**; regresyon kasası
  **981 PASS**; `tsc -b` temiz.
- **Piksel kapısı (yeni):** stil JSON'u dışa alınıp Playwright/Chromium'da GERÇEK
  MapLibre ile render edildi — 13 sahne (FULL gün/gece z10–z17 · MINI · 800×480 ·
  pitch 55 sürüş görünümü), öncesi/sonrası karşılaştırmalı. Bu kapı **gerçek cihaz
  doğrulamasının YERİNE GEÇMEZ**; WebGL swiftshader, gerçek head unit GPU'su değildir.

#### Açık borç

1. **Gerçek head unit / gerçek araç görüntüsü alınmadı** (#1278–#1283).
2. **CAROS LAB gözlem yüzeyi yok:** kartografi kararlarının (yürürlükteki zoom
   bandı, hangi katmanların bastırıldığı, stil doğrulama sonucu) salt-okunur bir
   LAB kartı YOKTUR. Bu, §👁️ Zorunlu Gözlemlenebilirlik kuralına göre **açık
   borçtur**; mevcut bir Navigation/Map LAB ekranının GENİŞLETİLMESİYLE
   kapatılmalıdır (yeni ekran açılmamalı).
3. **Bir sonraki atomik PR:** ya (a) tek saha turu — aynı konumda FULL DAY/NIGHT
   browse + MINI + aktif rota ekran görüntüleri, ya da (b) LAB kartografi kartı
   (borç 2). Saha turu önceliklidir: kod kanıtı doygunluğa ulaştı, eksik olan
   gerçek ekran.

#### DÜZELTME — GÜNDÜZ SÖZLEŞMESİ TERSİNE ÇEVRİLDİ (aynı gün, akşam · gerçek cihaz kararı)

Yukarıdaki tur gündüz için **"binalar en açık · zemin ortada · yollar en koyu"**
sözleşmesini korumuştu ve bunu bilinçli bir CarOS kararı olarak yazmıştı.
Kullanıcı aynı gün gerçek head unit'ten aynı konumun iki görünümünü yan yana
gönderdi, **gri-yollu / soğuk-zeminli olanı işaretleyip reddetti** ve
beyaz-yollu / sıcak-krem-zeminli olanı seçti.

**Yeni gündüz sözleşmesi:** yollar en açık (otoyol saf beyaz) · zemin sıcak krem
`#f2efe6` · bina kütlesi zeminden koyu · **yol/zemin ayrımını GÖVDE değil KASA
taşır** (kasa/zemin 1,76–2,65 · gövde/kasa 1,84–3,05).

Bu, gece paletiyle de tutarlıdır: gece zaten açık-yol/koyu-zemin yönündeydi.
Artık iki tema sürücüden **iki ayrı okuma alışkanlığı istemiyor.**

Dört kilit **yeniden hedeflendi, silinmedi** (`mapDayPaletteContrast.test.ts`):
rol dağılımı · monotonluk yönü · gövde/zemin → kasa/zemin + gövde/kasa · kasa
eşlemesi. Ayrıca 2026-08'deki 1,38 fiyaskosunun gerçek kökünü (açık kasa)
yakalayan bir **karşıt-örnek testi** eklendi. Bronz/altın yasağı korunuyor ama
artık zemin sıcaklığını değil **yol gövdesinin doygunluğunu** ölçüyor — reddedilen
somut tonlar (`#5e4a34` … `#f2c877`) ayrıca çıpalandı.

**Ek teşhis (kütük #1285):** kullanıcının bildirdiği "iki farklı görünüm" bir stil
hatası değil **kaynak değişimidir** — yerel `.pbf` olmadığı için vektör yalnız
çevrimiçi kullanılabilir; ağ yoksa ya da karo hatası eşiği aşılırsa raster OSM'e
düşülür ve o oturumda geri dönülmez. Kapı fail-soft olduğu için DEĞİŞTİRİLMEDİ;
yapılan şey iki yolun artık **aynı görsel dili konuşmasıdır.** Hangi kaynağın
yürürlükte olduğunu gösteren bir LAB alanı **YOKTUR — açık borç.**

**Durum seviyesi:** hâlâ **ENTEGRE**. Kütük **#1284 · #1285** 🔴 kaldıkça
yükseltilemez; bu paletin gerçek head unit'te görülmesi şarttır.

#### SAHA TURU 1 — İLK APK'DAN GELEN İKİ KUSUR (2026-09-05 akşamı)

Yeni kartografi APK'sı gerçek head unit'e kuruldu. Kartografinin kendisi kabul
gördü; iki BAŞKA kusur ortaya çıktı ve ikisi de *"kod doğru görünüyor ama
ekranda olmuyor"* sınıfındandı — hiçbiri mevcut testleri düşürmüyordu.

**1 · Rota rengi tam ekranda hiç yazılmıyordu (#1286).** Ürün canlı İKİ
MapLibre örneği taşır (mini + tam ekran), ama boya dedup anahtarları modül
düzeyinde, örnekten bağımsız tutuluyordu: mini boyanınca tam ekran çağrısı
dedup'a takılıp hiç boyanmıyordu. **Dört boya yolunu birden** etkiliyordu
(renk · vurgu · gürültü · boyanmış ok) — yani rehberlikte POI/bina bastırması
da tam ekranda uygulanmıyor olabilirdi. Defter `WeakMap` ile harita örneğine
bağlandı; karar hâlâ tek modelden gelir.

**2 · ORTALA sonrası kamera yaklaşıp geri çekiliyordu (#1287).** Giriş
animasyonu (1 sn) ile takip döngüsü (~120 ms) arasında kapı yoktu; durakta
takip döngüsü zoom'u `map.getZoom()`ten okuduğu için animasyonun ortasındaki
değeri sabitliyordu. Kapı eklendi ve **kullanıcı girdisini kilitlemeyecek**
biçimde tasarlandı (`map.isEasing()` düşünce kapı anında kalkar).

**Ders:** ikisi de tekil-örnek varsayımından doğdu. Bu sınıf için kalıcı kilit
`mapTwoInstanceFieldBugs.test.ts` (13 kilit) — biri gerçekten iki sahte harita
nesnesine boya yazdırıp ikisinin de boyandığını ölçer.

**Durum seviyesi:** **ENTEGRE**. #1286 · #1287 🔴 kaldıkça yükseltilemez.


## NAV-RUNTIME — HARİTA STİLİ VE KAMERA DETERMİNİZMİ (2026-09-06, kütük #1298–#1302)

**Durum seviyesi: DOĞRULANDI** (kod + kilit + **gerçek cihaz ölçümü**).
**SAHADA DOĞRULANDI DEĞİL** — ölçüm duran araçta/tezgâhta yapıldı; hareketli
araçta GPS akarken tekrar edilmedi. **ÜRÜN HAZIR: HAYIR.**

Cihaz: Xiaomi 23090RA98I · Android 13 (API 33) · 1220×2712 @480 dpi ·
`com.cockpitos.pro` 1.0.3 (versionCode 7). Ölçüm sırasında Android
`Thermal Status: 3` (SEVERE, SKIN 52,1 °C) — yani koşullar iyimser değildi.

### Bu tur neyi kanıtladı

Önceki oturum (Codex Astra) iki P0'ı gerçek cihazda **ölçtü** ve düzeltmeleri
ayrı bir worktree'de hazırladı ama ana ağaca almadı, cihazda denemedi. Bu tur o
düzeltmeleri denetleyip taşıdı, **eksik kalan kök nedeni buldu**, ve sonucu aynı
cihazda yeniden ölçtü.

**Astra'nın kaçırdığı kök neden — kendi kanıtının içindeydi.** `trace-before-final.json`
şunu taşıyordu:

    tileRender-intent  vector → raster   thermalLock=true   deviceTier='high'
    tileRender-intent  raster → vector   (+3442 ms)
    çağıran yığın: FullMapView → mapSourceManager.notifyLowFPS

Yani `Vector → OSM Map → Vector` parlamasını üreten şey **ısı değildi**: tam
ekran haritanın *açılış saniyesi* doğal olarak <20 FPS ölçülüyor ve FPS
örnekleyicisi bu tek örneği "termal boğulma" sanıyordu. Termal mandalın
sözleşmesi asimetrikti — **çıkışta** 2500 ms istikrarlı yüksek FPS kanıtı
isteniyordu, **girişte** hiç kanıt istenmiyordu. Düzeltme politikayı değiştirmedi;
girişin kanıt eşiğini çıkışınkiyle simetrik yaptı (`fpsThermalLatchModel`, saf).

**Ders (kalıcı):** *bir koruma mekanizmasının girişi ile çıkışı farklı kanıt
standardına tabiyse, koruma er ya da geç yanlış tetiklenir.* Bu, aynı ailenin
(#634 · #640 · #604) dördüncü örneği.

### Ölçülen sonuç (ÖNCE → SONRA, aynı cihaz)

| Ölçüt | ÖNCE | SONRA |
|-------|------|-------|
| MINI→FULL `setStyle` / `style.load` | 4 / 3 | **2 / 1** (biri eski örneğin yıkımı) |
| Ara raster ("OSM Map") | VAR | **0** (27 anlık görüntü) |
| `tileRender-intent` olayı | vector→raster→vector | **0** (2948 olaylık oturum) |
| Gün↔gece geçişi | tam restyle | **0 setStyle / 0 style.load** — canlı palet |
| UI ↔ MapLibre tema mutabakatı | UI DAY iken MapLibre NIGHT | **27/27 sapmasız** |
| Sürüş girişinde kamera komutu | 2 × `easeTo` (Δ 6 ms) | **1** |
| <400 ms özdeş tekrar (18 komut) | — | **0** |
| Programatik olay → `USER_PANNING` | üretiyordu | **0 / 33** |
| Gerçek parmak pan | — | `origin=USER` → `USER_PANNING` → `FOLLOW_SUSPENDED` |
| ORTALA / otomatik dönüş | — | `FOLLOWING` (USER_BUTTON / AUTO_TIMEOUT) |

### İkinci ders: düzeltme yeni bir "sessiz yalan" doğurdu

Canlı palet `setStyle` çağırmadığı için `map.getStyle().name` bayat kalıyordu:
boya GÜNDÜZ iken ad "Vector (Automotive Night)". Render doğruydu, **etiket
yanlıştı** — ve bu alan tam da bu turun kök nedenini bulurken okunan alandı.
Gözlemlenebilirlik kuralı gereği (kanıtsız/yanlış bilgi üretilmez) ad tek kaynağa
(`vectorStyleName()`) bağlandı ve canlı palet yolu onu da yazıyor. **Bir teşhis
alanı, ürün davranışını değiştirmese bile, yalan söylemesine izin verilemez.**

### Aynı turda kullanıcı sahadan bir kusur bildirdi (#1301)

*"üst üste termal koruma bildirileri geliyor, telefon sıcak değil."* Ölçüm:
Android gerçekten SEVERE diyordu (SKIN 52 °C) — **bildirim yanlış değildi,
tekrarı kusurluydu.** `autoBrightnessService` bir OTOMASYON olduğu hâlde
KULLANICI API'sini (`setBrightness`) çağırıyor, o da kap üstü talebi reddedip
toast atıyordu; servis 60 saniyede bir tick attığı için ekran bildirimle
doluyordu. Daha sinsi ikinci sonuç: **tünel karartması ve kapanış onarımı termal
kap aktifken hiç uygulanmıyordu** (erken return). Dört otomasyon yolu, zaten var
olan `setBrightnessAuto()`'ya alındı.

**Ders:** *aynı domaine iki kapı açıldığında (kullanıcı yolu / otomasyon yolu),
yanlış kapıyı kullanan çağıran yalnız gürültü üretmez — sessizce işlevini de
kaybeder.*

### Açık borçlar (kapatılmadı, gizlenmedi)

- **#1302** — sesli komut yolu (`useVoiceCommandHandler`) parlaklığı doğrudan
  native plugin'e yazıyor; termal kapı görmüyor. CLAUDE.md §1 (ONE DOMAIN = ONE
  AUTHORITY) ihlali. Ayrı atomik yama gerektirir.
- **Gerçek araç sahası** — bu turun tamamı duran araçta ölçüldü. Hareket hâlinde
  GPS akarken MINI↔FULL geçişi, rota katmanının korunması ve takip kamerasının
  davranışı ÖLÇÜLMEDİ. `REAL VEHICLE FIELD = NOT EXECUTED`.
- **MINI/FULL mood ayrışması** — FULL yüzeyinde arka plan `rgb(233,238,243)`,
  MINI'de `#f2efe6` ölçüldü (mood denetleyicisi yalnız FULL'de yazıyor). İkisi de
  doğru gün paleti içinde; ayrışma bu turun kapsamında DEĞİLDİ, kayda geçirildi.

---

## NAV-CARTO/3D — CONCEPT-TO-PRODUCTION MAPLIBRE, ADIM 1 (2026-09-06, kütük #1311)

**Durum: ENTEGRE** (kod + kilit + tip + kasa yeşil) · **SAHADA DOĞRULANDI: HAYIR**
· **ÜRÜN HAZIR: HAYIR**. Yükseltme yalnız `DEVICE_VALIDATION_LEDGER.md` #1311
maddesindeki beş ölçütün cihazda gözlenmesiyle olur.

### Bağlam

`docs/HANDOFF_2026-09-06_NAV_CARTOGRAPHY.md` §7, ticari navigasyon görsel
sisteminin kavramdan üretime aktarım sırasını verir. **Adım 1 = `building-3d`
menzil + solma.** Devir belgesi bunu *"KOLAY — paint ifadesiyle"* diye
işaretlemişti.

### Bu tur neyi kanıtladı: "KOLAY" değerlendirmesi YANLIŞTI

Kod yazmadan önce MapLibre style-spec'i ve repo otorite haritası ölçüldü:

| Varsayım | Ölçüm | Sonuç |
|----------|-------|-------|
| Opaklığa mesafe/zoom ifadesi yazılır | `fill-extrusion-opacity` = **data-constant** (spec'ten okundu) | Bina başına solma İMKANSIZ |
| Tasarımdaki 900 m menzil çevrilir | `distance-from-center` · `pitch` ifadeleri MapLibre 4.7.1 bundle'ında **YOK** (0 eşleşme) | Metre menzili birebir çevrilemez |
| Opaklık boş bir alan | **ÜÇ yazar**: stil `bldg3dOpacity` · `mapDeclutterModel` profilleri · `MapLayerManager` 80 km/h mandalı | Oraya yazmak runtime tarafından EZİLİRDİ |
| — | `fill-extrusion-height`/`-base` **data-driven** ve stil **TEK yazar** (repo tarandı) | Rampanın doğru yeri BURASI |

> **DERS:** Devir belgesindeki "aktarma zorluğu" sütunu bir TAHMİNDİR, ölçüm
> değildir. §7'nin kalan adımları (özellikle *"gök katmanı — KOLAY"* ve
> *"ad kısaltma — ORTA"*) aynı şekilde kod yazılmadan ÖNCE spec'ten
> doğrulanmalıdır.

### Yapılan

`BUILDING_3D_RISE` sabiti + `building-3d` paint'inde zoom rampası. Rampa uçları
seçilmedi, **`cameraEngine.ts` hız→zoom eğrisinden türetildi**:

- `start` = katmanın KENDİ `minzoom`'u (16) — ikinci eşik tablosu kurulmadı.
- `end` = **16,4** = eğride **70 km/h**'ye düşen zoom (şehir içi bandın alt sınırı).

Davranış: ≤70 km/h tam boy ve **sabit** (sürüşte boy oynaması yok) · 70–83 km/h
alçalarak çekilme (80 km/h'de hız mandalı opaklığı keser — sert mandal artık
yumuşak geçişin üstüne biniyor) · serbest yakınlaşma z15→16'da yerden yükselerek
girme (pop-in yok).

### Mimari sınırlar (hiçbiri ihlal edilmedi)

- **ONE DOMAIN = ONE AUTHORITY:** opaklık alanına DOKUNULMADI; declutter ve hız
  mandalı tek yazar olarak kaldı. Bir kilit bunu açıkça koruyor.
- **Yeni otorite/scheduler/god object YOK** — tek bir stil sabiti eklendi.
- **Performans:** `minzoom` DEĞİŞMEDİ → ek karo/geometri maliyeti yok, DeviceTier
  bütçesi aynı. Truth cadence ile render cadence ayrımı etkilenmedi.
- **CAROS LAB:** yeni ekran AÇILMADI. Bu değişiklik kendi durumu/sağlığı/zamanlaması
  olan bir alt sistem değil, tek bir stil ifadesidir — CLAUDE.md'nin "yalnız görsel
  değişiklik" istisnası kapsamındadır (ekran enflasyonu yasağı).

### Kanıt

- `cartographyAuthority` +4 kilit; **körlük kanıtlandı**: rampa kaldırılınca 2
  kilit düştü, opaklık ifadeye çevrilince 1 kilit düştü, geri alınınca geçtiler.
- `validateStyleMin` (mevcut kilit) ifadenin MapLibre spec'ine göre GEÇERLİ
  olduğunu doğruluyor — kütük #552'deki "stil sahada reddedildi" tuzağına karşı.
- `tsc -b` temiz · `npm run guard` 998/998 · ilgili 6 harita test dosyası 159/159.

### Açık borç

- **#1311 cihazda gözlenmedi.** Beş kabul ölçütü kütükte 🔴.
- Tasarımdaki **metre cinsinden menzil** MapLibre'de karşılanamadı; derinlik
  algısının kalan kısmı §7 Adım 2'ye (gök + ufuk bandı) bırakıldı.
- **800×480 head unit** ve **gerçek araç sahası** hâlâ ❌.

---

## NAV-CARTO/SKY — §7 ADIM 2: ÖLÇÜLDÜ, UYGULANAMAZ (2026-09-06, kütük #1312)

**Durum: KAPSAM DIŞI (kanıtlı)** · Üretim kodu **DEĞİŞMEDİ** · **ÜRÜN HAZIR: —**

Bu, bir başarısızlık kaydı değil; **uydurulmamış bir implementasyonun** kaydıdır.
Kullanıcı talimatı açıktı: *"Destek yoksa bunu açıkça raporlamak implementasyon
uydurmaktan daha doğrudur."*

### Ölçüm zinciri

| # | Soru | Ölçüm | Sonuç |
|---|------|-------|-------|
| 1 | MapLibre sürümü | `maplibre-gl` **4.7.1** · style-spec **20.4.0** | — |
| 2 | `sky` bir katman mı? | Layer tipleri: fill·line·symbol·circle·heatmap·fill-extrusion·raster·hillshade·**background** | **Katman DEĞİL** — root-level obje |
| 3 | `sky` runtime'da var mı? | `map.setSky()`/`getSky()` API + `drawSky` bundle'da | **VAR** |
| 4 | Terrain'e bağlı mı? | `drawSky` **ana** framebuffer'a çiziyor (`bindFramebuffer.set(null)` sonrası) | **Bağımsız** — terrain P0'ı geri gelmez |
| 5 | Ufkun altını boyar mı? | Shader: `if (y > u_horizon) {...}` | **HAYIR** — ufkun altına hiç piksel yazmaz |
| 6 | Ufuk ne zaman kadrajda? | `getHorizon() = tan(90°−pitch)·1,5·h·0,85` → eşik **pitch > 68,59°** | Yükseklik/dpr'den bağımsız |
| 7 | Bu ürünün kamera bandı? | `MapCore` `maxPitch` **50** · `PITCH_HIGHWAY` **47** | **Eşiğin ALTINDA** |
| 8 | Sonuç | pitch 50'de `u_horizon` ≈ 1912 px, ekran 1218 px | **Sky tam no-op** |

### Neden zorlamadık

Sky'ı görünür kılmanın tek yolu pitch tavanını 68,6°'nin üstüne çıkarmaktı.
O tavan bir **cihaz gözlemiyle** konmuştur (`MapCore.ts`: *"50°+ üzerinde
MapLibre siyah köşe oluşturur"*) ve kamera davranışını değiştirmek bu turun
kapsamı dışındaydı. **Fake sky · DOM overlay · ikinci renderer · kamera hack'i
üretilmedi.**

### Yan bulgu (kütüğe geçti)

`background` katmanı MapLibre'de **tile-tabanlı** çizilir
(`transform.coveringTiles`), full-screen DEĞİL. *"50°+ siyah köşe"*
gözleminin muhtemel mekanizması budur — cihazda doğrulanmalı (#1312 ölçüt 1).

### Authority haritası (bu tur çıkarıldı)

`background-color`un **üç** yazarı var ve hepsi tek token kaynağından okur
(`MAP_BG_DAY = #e9eef3` · `MAP_BG_NIGHT = #222c3c`, `_mapIds.ts`):

1. **Stil (build-time)** — `buildVectorStyle` (`P.bg`) · `_mapState` raster stilleri
2. **`applyMapDayNight`** (`MapLayerManager:481`) — raster yolunda gün/gece
3. **Mood/risk** (`MapLayerManager:1465`) — riskle ≤%18 koyulaştırma, taban paletten (#622)

`mapDeclutterModel` zemine **dokunmuyor**. `setStyle` tek çağrı yerinde
(`MapCore:564`) — P0-A'nın determinizmi korunuyor. `sky` eklenseydi bu üç
yazarlı alana **dördüncü paralel yüzey** eklenmiş olurdu.

### Kalıcılaştırma

`cartographyAuthority` +5 kilit. **İki yönlü** ve körlüğü kanıtlandı:
- Stile `sky` eklenince → ölü stil yasağı kilidi **düştü**.
- `maxPitch` 50→70 yapılınca → *"pitch tavanı ufuk eşiğini AŞTI — `sky` kararı
  yeniden değerlendirilmeli"* mesajıyla **2 kilit düştü**.

### Açık borç

- §7'nin kalan adımları (ad kısaltma · manevra kartı · etiket oklüzyonu) aynı
  şekilde **kod yazılmadan ÖNCE** spec'ten doğrulanmalı. Adım 1 ve Adım 2'de
  devir belgesinin zorluk tahmini **iki kez** yanlış çıktı.
- Derinlik algısının kalan kısmı MapLibre stil katmanında üretilemez: 4.7.1'de
  ekran-uzaklığına bağlı **hiçbir** stil primitifi yok (`distance-from-center` ·
  `pitch` ifadeleri yok — Adım 1'de de ölçülmüştü).

---

## NAV-CARTO/LABEL — §7 ADIM 3: YOL HİYERARŞİSİ + ETİKET MOTORU (2026-09-07, kütük #1313–#1314)

**Durum: ENTEGRE** · **SAHADA DOĞRULANDI: HAYIR** · **ÜRÜN HAZIR: HAYIR**

### Kapasite bulguları (kod yazmadan ÖNCE ölçüldü)

| Alan | MapLibre 4.7.1 | Sonuç |
|------|----------------|-------|
| `symbol-sort-key` | **data-driven** | Sınıf önceliği YAPILABİLİR |
| `text-field` | **formatted · data-driven** | Kısaltma YAPILABİLİR |
| String ifadeleri | `let·var·case·concat·slice·index-of·length·max·to-string` **var**, regex **YOK** | Son-token eşlemesi |
| `symbol-spacing` · `text-padding` | data-constant (zoom alır) | Tekrar/collision ayarlanabilir |
| `text-opacity` | data-constant | **Kullanılamaz** — dört yazarı var |

### Yazar haritası (bu tur çıkarıldı)

| Alan | Yazar sayısı | Kim |
|------|--------------|-----|
| `road-label.text-opacity` | **4** | stil · mood/risk (`MapLayerManager:1433`) · `NAV_SUPPRESS_TIERS` · `mapDeclutterModel` |
| `road-*.line-opacity` | **3** | stil · `NAV_SUPPRESS_TIERS` · declutter |
| `road-*.line-color` | **2** | stil · mood/risk (`MapLayerManager:1474+`) |
| **`road-label*` LAYOUT** | **1 — yalnız stil** | `applyMapDayNight` layout diff'i yalnız gün↔gece FARKLI alanları yazar; ortak alanlara dokunmaz |

> Bu tabloya dayanarak turun tamamı **LAYOUT** tarafında yapıldı. Adım 1'de bina
> opaklığı için verilen karar buradaki `text-opacity` için de aynen geçerli.

### Uygulananlar

1. **Yol adı tür eki kısaltması** — 10 sonek, özel ad korunuyor (`Caddesi→Cd.`).
2. **Yerel ağda sınıf önceliği** — `road-label` `symbol-sort-key` (tertiary 1 ·
   minor 2 · service 3). Ölçüm: `transportation_name` z14 karoda minor **101**,
   tertiary **14** — sıra verilmezse ekranı en düşük değerli sınıf dolduruyordu.
3. **Arter adı tekrarı kesildi** — `road-label-major` `symbol-spacing` 260→420
   (904 px görüntü alanı ölçüsü; 260'ta aynı ad ekranda 3–4 kez).

### Uygulanmayanlar ve teknik gerekçe

- **Yol hiyerarşisi (A) DEĞİŞTİRİLMEDİ** — çünkü zaten hedefteydi: `trunk`
  MapLibre filtresinde `motorway` ile gruplu, merdiven 5 kademe
  (motorway+trunk > primary > secondary > tertiary > minor > service > path) ve
  cihazda ölçülmüş (gece z16: 14,5 · 7,35 · 4,96 · 2,88 px). Kullanıcı görsel
  onayı **#1308**'de zaten açık — o kapanmadan aynı yere ikinci kez dokunmak
  ölçümü geçersiz kılardı.
- **Bağlama göre etiket SAYISI (BROWSE 8 / NAV 6 / MINI 1–2) yapılamadı.**
  Sayıyı ancak `minzoom`/`filter`/`spacing` (LAYOUT) belirler; navigation durumu
  ise yalnız RUNTIME'da bilinir ve runtime yolları (`NAV_SUPPRESS_TIERS` ·
  `mapDeclutterModel`) **paint-only**'dir — opaklık azaltmak etiketi
  soluklaştırır, SAYISINI düşürmez. Bunu düzeltmek ya paralel bir label
  renderer ya da mevcut context authority'yi layout yazacak şekilde genişletmek
  demekti; **ikisi de yapılmadı** (yeni authority/FSM yasağı). **AÇIK BORÇ.**
- **Bina oklüzyonlu etiket eleme** yapılamadı: MapLibre collision motoru
  `fill-extrusion` kütlesini hesaba katmaz, `distance-from-center` de yok
  (Adım 1 ve 2'de ölçüldü).

### Kanıt

`cartographyAuthority` +7 kilit (toplam 58). Kısaltma kilitleri ifadeyi
**gerçekten değerlendiriyor** (`createExpression` + `evaluate`), metin
eşleştirmesi değil. **Beş mutasyonun beşi de** ilgili kilidi düşürdü:
kısaltma kaldırıldı · sort-key kaldırıldı · spacing 260'a döndürüldü ·
opaklık ifadeye çevrildi (biri önceden var olan kilidi de tetikledi) ·
kısaltma `place-town`'a sızdırıldı.

Hedefli 10 kartografya/stil/label dosyası **210/210** · `guard` **998/998** ·
`tsc -b` temiz · lint 0 hata. Adım 1 bina rampası ve Adım 2 sky kararı
regresyonsuz.

---

## NAV-HUD/LANE — §7 ADIM 4: MANEVRA + ŞERİT REHBERİ (2026-09-07, kütük #1315)

**Durum: ENTEGRE** · **SAHADA DOĞRULANDI: HAYIR** · **ÜRÜN HAZIR: HAYIR**

### Authority audit — istenenlerin ÇOĞU zaten vardı

| Alan | Otorite | Durum |
|------|---------|-------|
| Manevra gerçeği | `routingService` → `useRouteStore.steps` | ✅ tek kaynak |
| Manevra mesafesi | `route.distanceToNextTurnMeters` + **`distanceToNextTurnSource`** (yol-boyu / kuş uçuşu dürüstlük etiketi) | ✅ |
| Manevra tipi/çevirisi | `maneuverSemanticsModel` | ✅ tek otorite |
| **Şerit kanıtı** | OSRM `intersections[].lanes` → `extractLanes` → `RouteStep.lanes` | ✅ **GERÇEK veri** |
| ETA / kalan mesafe | `TripSummary` | ✅ |
| Hız / hız limiti | `useDisplaySpeed` · `useEffectiveSpeedLimit` | ✅ |
| Mesafe biçimi | `formatManeuverDistance` (saf, presentation-only) | ✅ |
| **Bağlam yoğunluğu** | `hudPresentationModel`: `ACTIVE_NORMAL → MANEUVER_APPROACH → ARRIVING`, `emphasis`, `showLaneGuidance = showManeuver && hasLaneData && emphasis` | ✅ **FSM zaten var** |
| 800×480 / dar ekran | `useDenseHud` (`HUD_DENSE_MAX_H = 520`), üst bant şerit bütçesi | ✅ tek kaynak |

> **Lane verisi UYDURULMUYOR.** Ürün bunu daha önce bir denetimde düzeltmiş:
> "gerçek `lanes` varsa gösterilir, yoksa panel hiç çıkmaz". Bu tur o sözleşmeyi
> **korudu**, yalnız kapıyı bileşenden saf modele taşıdı.

### Bu turda kapatılan iki ÖLÇÜLMÜŞ kusur

1. **İki gerçek alan tek boolean'a çöküyordu.** `ln.active && ln.valid` →
   *"dönebilirsin ama önerilen değil"* ile *"bu şeritten dönemezsin"* ekranda
   aynıydı. Artık **ROUTE_SELECTED · ALLOWED · NOT_ALLOWED**.
2. **U dönüşü düz ok çiziliyordu.** Ölçüldü: `['uturn'] → straight`. Eski
   `_laneDir` yalnız `left`/`right` alt dizesi arıyordu. Artık sekiz gösterge
   sekiz ayrı açı; tanınmayan gösterge düz ok **uydurmaz**.

Ayrıca şerit kutusundaki **gradient + glow kaldırıldı** (canonical `f-Maneuver`
düz dolgu · ince kenar · gölgesiz kutu kullanır) ve satır sarması eklendi.

### Mimari

`laneGuidanceModel` **yeni bir otorite değildir** — saf sunum katmanıdır
(I/O · timer · `Date.now` · React yok; kilitle korunuyor). Şerit gerçeği tek
kaynaktan gelmeye devam eder. Yeni GPS aboneliği · tick · scheduler ·
route/CEH/maneuver/lane-inference/camera/style otoritesi **kurulmadı**.

### Uygulanmayanlar

- **Manevra kartı tipografisi** (canonical'da "120" büyük + "m" küçük) —
  `formatManeuverDistance` tek string döndürüyor; sayı/birim ayrımı `ManeuverPanel`
  yeniden yerleşimi ister. Kazanç kozmetik, risk yerleşim regresyonu → **borç**.
- **HUD → kamera padding** ilişkisi bu turda ölçülmedi; mevcut
  `cameraCompositionModel` yolu duruyor, **kamera davranışına dokunulmadı**.

### Kanıt

`laneGuidanceModel.test.ts` **17/17** (deterministik, saf model + bileşen
sözleşmesi). **Yedi mutasyonun yedisi de** ilgili kilidi düşürdü: uturn haritası
kaldırıldı · semantik tek boolean'a çöküldü · glow geri kondu · fail-closed
kırıldı · `flex-wrap` kaldırıldı · modelden kapı kaldırıldı (guard) · bileşen
modeli atladı (guard).

Hedefli 9 navigation/HUD dosyası **170/170** · `guard` **998/998** ·
`tsc -b` temiz · lint 0 hata.

> `regression.guards`'taki şerit kilidi **kaldırılmadı, yeniden bağlandı**:
> taradığı metin modele taşındığı için kilit sessizce kör kalacaktı. Yeni hâli
> hem bileşenin modelden okuduğunu hem modelin fail-closed olduğunu doğruluyor.

---

## NAV-HUD/TYPO + HUD↔CAMERA — §7 ADIM 5 (2026-09-07, kütük #1316–#1317)

**Durum: ENTEGRE** (tipografi) · **KAPSAM DIŞI, KANITLI** (kamera) ·
**SAHADA DOĞRULANDI: HAYIR**

### A · Manevra mesafesi tipografisi (#1316)

Canonical hedef mesafeyi **büyük değer + küçük birim** dizer; ürün tek string
basıyordu ve birim değerle aynı görsel ağırlıktaydı.

**İkinci mesafe otoritesi kurulmadı:** parçalama `splitManeuverDistance` içinde
yapılır, `formatManeuverDistance` artık onun `fullText` alanını döndüren ince
sarmalayıcıdır — eşikler ve yuvarlama tek yerde kalır. Navigasyon gerçeği
(`distanceToNextTurnMeters`) değişmedi; yalnız sunum yuvarlaması.

**Ölçülen yan etki (gizlenmedi):** eski `(m/1000).toFixed(1)` ikilik taban
kusuru taşıyor — `(2.05).toFixed(1) === "2.0"`. Yeni `Math.round(m/100)/10`
matematiksel doğru yuvarlıyor. 1–40 km arası **39.001 tam metrenin 156'sında
(%0,40)** ayrışma var; hepsi tam `.5` sınırında, sapma tek sunum basamağı
(0,1 km) ve yukarı yönde. Kilit bu oranı **sabitliyor** — sessizce büyürse
yuvarlama bozulmuş demektir.

**Açık borç:** ondalık ayırıcı nokta kaldı. `toFixed(1)` deseni ürünün her
yerinde böyle (`TripCostScreen` · `RadarAlertHUD` · `HorizonLayout` …); Türkçe
virgüle geçiş **ürün çapında** bir karardır, tek kartta yapılırsa tutarlılık
bozulur.

### B · HUD ↔ kamera kompozisyonu (#1317) — ölçüldü, DEĞİŞTİRİLMEDİ

Zincir kanıtlandı:

    cameraPolicyModel.SPEED_BANDS[*].anchorY   (0,50 durak → 0,68 otoyol)
      → MapInteractionManager:631  resolveTopPadForAnchor({anchorY, containerHeight, lookAheadPx})
      → MapLibre padding.top

**`resolveTopPadForAnchor` girdisinde HUD'un kapladığı alan YOKTUR.**
Kompozisyon yalnız hıza ve ölçülen ileri-bakış yanlılığına bakar — "manevra
kartı + şerit paneli ne kadar yer kaplıyor" bilgisi kameraya hiç ulaşmıyor.

**Risk bandı:** manevra yaklaşımında kart büyür (316→360 px, punto 40→52, şerit
paneli açılır) ve aynı anda araç yavaşladığı için `anchorY` 0,50'ye iner —
kartın en büyük olduğu an, aracın en yukarıda olduğu andır.

**Kamera değiştirilmedi.** En küçük canonical genişletmenin sahibi kanıtlandı
(`cameraCompositionModel` — "nasıl çerçeveleniyor"un tek sahibi), ama
uygulanmadı çünkü: **(a)** gerçek çakışmanın cihaz kanıtı yok, **(b)** HUD
bütçesini `anchorY`ye karıştırmak hız kompozisyonuyla HUD bütçesini tek sayıya
çöker, **(c)** `cameraShadowRuntime`'ın ölçtüğü `anchorYDelta` anlamını
kaybeder. İkinci kamera sistemi · FSM · timer · viewport watcher **kurulmadı**.

### P0 invariant durumu

Bu turda `src/platform/map/` altında **hiçbir dosya değişmedi**. Doğrulandı:
React bileşenlerinde `easeTo`/`jumpTo` çağrısı **yok** (yalnız yorumlarda
geçiyor); `resolveTopPadForAnchor` guard kilidi yerinde; `cameraAuthorityParity`
· `navigationCameraShadow` · `navigationMotionCamera` · `cameraDampingCadence`
testleri yeşil.

### Kanıt

`maneuverDistancePresentation.test.ts` **15/15**. **Altı mutasyonun altısı da**
ilgili kilidi düşürdü: sarmalayıcı bağımsızlaştırıldı · gereksiz ondalık geri
geldi · birim değerle aynı punto · `aria-label` kaldırıldı · kart kendi eşiğini
kurdu · mesafe span'ından `flexShrink` kaldırıldı.

> ⚠️ **Bir kilit önce KÖR çıktı ve düzeltildi:** `flexShrink: 0` tüm dosyada
> aranıyordu ve manevra okunun span'ında da geçtiği için mesafeden kaldırılsa
> bile test geçiyordu. Mutasyon bunu yakaladı; kilit artık yalnız mesafe
> span'ına bakıyor ve MUT-6 onu düşürüyor.

Hedefli 11 HUD/kamera dosyası **211/211** · `guard` **998/998** · `tsc -b`
temiz · lint 0 hata.

---

## NAV/CARTOGRAPHY — DEVICE CLOSURE (2026-09-07)

**Durum: ENTEGRE → kısmen SAHADA DOĞRULANDI** · **ÜRÜN HAZIR: HAYIR**

Tek APK (HEAD `dd7861e5`, SHA-256 host↔cihaz eşleşti) ile #1308–#1317 arası
dokuz açık ledger maddesi Xiaomi 23090RA98I'de toplu ölçüldü. Detaylı sonuç
tablosu ve kanıt: `docs/DEVICE_VALIDATION_LEDGER.md` §"2026-09-07 DEVICE
CLOSURE" · `field-runs/nav-visual-device-20260907/`.

**SAHADA DOĞRULANDI'ya yükseltilen (9/17 ölçüt):** yol hiyerarşisi (#1308) ·
3B bina yükselme rampası + floating-yok + stil hatası yok (#1311, 3 ölçüt) ·
sky no-op (#1312) · ad kısaltması (#1313) · lane fail-closed (#1315) · mesafe
tipografisi temel hiyerarşi (#1316) · HUD/kamera çakışması yok @ 0 km/h (#1317).

**PENDING kalan, EN KRİTİK açık madde:** **#1317 cruise/approach hızında
(60-100 km/h) HUD↔kamera çakışması** — Adım 5'te ölçülen risk (kart büyürken
+ hızlanınca `anchorY` aynı anda değişir) hiç cihazda sınanmadı; bu yalnız
GERÇEK SÜRÜŞLE ölçülebilir. **800×480 tamamı PENDING** — test cihazı telefon,
gerçek head unit yok. Lane pozitif görselleştirme (ROUTE_SELECTED/ALLOWED/
NOT_ALLOWED ayrımı) bu GPS bölgesinde lane-data içeren kavşak bulunamadığı için
PENDING.

**Yan bulgu (kod değiştirilmedi, ayrı tur gerektirir):** Kokpit Teması Gündüz/
Gece toggle'ı ile harita gün/gece paleti ilişkisi tutarsız gözlemlendi —
muhtemelen #1309 açık borcuyla ilişkili, kök neden araştırılmadı.

**Hüküm ayrımı (karıştırılmadı):**
- **CODE PASS:** Adım 1-5 commit'leri (`6e032576`·`1b8012c2`·`3a8149e3`·
  `fa05d611`·`dd7861e5`) — targeted QA + mutation proof zaten yeşildi.
- **DEVICE PASS:** yukarıdaki 9 ölçüt için verildi, GERÇEK gözlemle.
- **REAL VEHICLE FIELD PASS:** VERİLMEDİ. Bu tur duran araçla (0 km/h) yapıldı;
  hareket halindeki hiçbir davranış (kamera takibi, hız bandına bağlı bina/HUD
  tepkisi) gerçek sürüşle doğrulanmadı.

---

## MAPDATA F0–F6 — AÇIK KAYNAK HİBRİT HARİTA VERİ PLATFORMU (2026-09-07)

**Durum: ENTEGRE** (sözleşme + ölçüm + sınırlı fusion) · **ÜRÜN HAZIR: HAYIR**
Üretim davranışını değiştiren tek madde kapı numarası katmanıdır ve o
**🔴 cihazda doğrulanmadı** (kütük #1318).

### Neden bu tur açıldı

`field-runs/map-data-coverage-20260907` Tarsus'ta üç ayrı kusur ölçtü:
bina kapsamı boşluğu (uydu görüntüsündeki üç çatı ne OSM'de ne production
karosunda vardı; en yakın OSM bina köşesi 111–128 m), 426/564 adsız yerel
yol, ve karoda VAR olan `housenumber` verisinin stilde hiç tüketilmemesi.
Tek bir "kaynağı değiştir" hamlesi bu üçünü birden çözmez — çünkü üçü farklı
katmanların kusurudur.

### Ölçülen gerçek (MAPDATA-F1 · `field-runs/mapdata-shootout-20260907`)

Aynı z14/9778/6381 karosu, aynı bbox, Overture 2026-08-19.0 (public S3, DuckDB):

| | OSM | OpenFreeMap (üretim) | Overture | Dedup edilmiş artış |
|---|---:|---:|---:|---|
| Bina | 340 way | 11 feature / 351 polygon | **2627** | **+2290** (Microsoft ML Buildings) |
| Bina (yakın 400×400 m) | 11 | 11 polygon | **123** | **+112** |
| Yol adı (ayrık) | 138 | 117 ad feature | 527 segment | **+3** (hiçbiri yerel sokak değil) |
| Adres | 3 `addr:*` | 7 housenumber | **0** | **−7 (Overture DAHA KÖTÜ)** |
| POI/Place | — | 120 poi | 337 | +217 (permissive lisans) |

Uydu çatı örnekleri: en yakın bina köşesi **111–128 m → 6.3 / 14.7 / 8.0 m**;
her noktanın 30 m çevresinde 4–9 Overture binası. Yani **cihazda görülen
footprint boşluğunun gerçek doldurucusu Overture bina temasıdır.**

**Yol adı ve adres Overture ile ÇÖZÜLMÜYOR** — bu yüzden o temalar için
adapter YAZILMADI (kanıtsız ingestion yasağı).

### Lisans bulgusu (ürün riski)

Overture'ın **dağıtım** lisansı CDLA-Permissive-2.0'dır, ama **kayıt düzeyinde**
buildings 2627/2627 ve transportation 1627/1627 **ODbL-1.0** taşır; places ise
CDLA-Permissive-2.0 / CC0-1.0 / Apache-2.0. Yani permissive dağıtım bina/yol
temasında share-alike'ı KALDIRMAZ. Lisans kapısı bu ölçümden sonra **kayıt
düzeyine** indirildi (`effectiveLicensePolicy`). Pratik sonuç: bina
footprint'lerini kullanmak satışı ENGELLEMEZ (ODbL ticari kullanıma izinli)
ama dağıtılan **veri paketi** için ODbL atıf + share-alike yükümlülüğü doğurur —
uygulama kodu etkilenmez.

### Kurulan mimari (L1 MapStore'un ALTINDA)

```
Kaynak (OSM · OpenFreeMap · Overture · TUCBS · belediye · lisanslı)
   → SourceAdapter (saf; ağ/saat yok, reddedilen kayıt gerekçeli döner)
   → LİSANS KAPISI (fail-closed; UNKNOWN hak = RED; kayıt düzeyi lisans üstün)
   → CandidateMapFeature (gözlemler YAN YANA, üst üste YAZILMAZ)
   → Resolver (alan alan; tazelik+mutabakat+kalite+yetki önseli EŞİT ağırlık)
   → CanonicalMapFeature (her alan için "neden bu?" puan dökümü)
```

**Otorite sınırı:** ikinci harita gerçeği otoritesi KURULMADI — çalışma zamanı
truth sahibi `navigation/map/store` olarak kalır. `EvidenceGrade` navEvidence'ten
gelir; kopyalanmaz (kilit denetler). `MapSourceMask` (fiziksel düzlem) ile
`MapDataSourceId` (üretici) ayrı eksenlerdir.

**Sabit öncelik listesi YOK:** `municipality > Overture > OSM` gibi kör sıralama
yasaktır. Yetki önseli yalnız dörtte bir ağırlıktadır; taze ve mutabık bir OSM
gözlemi bayat bir "yüksek yetkili" gözlemi yenebilir (kilit bunu ölçüyor).

**Uydurma geometri YASAK:** bina fusion'ı iki footprint'i ortalamaz/birleştirmez;
canonical geometri DAİMA gerçek bir kaynak kaydıdır (123/123 kilitli).

### Üretim davranışında ne değişti

**Tek değişiklik:** `housenumber` kaynak katmanının stil tüketicisi eklendi
(z17, çakışma önceliğinde en altta, `mapDeclutterModel` sahipliğinde,
`text-field` doğrudan `['get','housenumber']` — türetme YOK). Kaynak kapsamı
çok seyrek olduğu için bazı sahnelerde HİÇ numara görünmemesi DOĞRU davranıştır.

**Bilinçli olarak DEĞİŞTİRİLMEYEN:** yerel sokak adı eşiği (z16) ve aralığı
(460 px). Host deneyi 460→100'de z16'da 10→16 ad gösterdi ama deney DPR1/pitch0
ortamındadır ve kaybolan ad ölçülmedi → cihaz deneyi kütüğe yazıldı (#1319).

### Gözlemlenebilirlik

CAROS LAB → Araç → **Harita Veri Platformu** (`map-data-platform`). Salt-okunur;
lisans kapısı her açılışta gerçekten çalıştırılır; üç portun (adres · yer ·
canlı koşul) hiçbiri BAĞLI DEĞİLDİR ve ekran bunu böyle söyler.

### Açık borçlar

- **#1318** kapı numarası cihazda görülmedi (üretim davranışı değişti).
- **#1319** yerel sokak adı aralığı cihaz deneyi yapılmadı.
- **#1320** LAB ekranı cihazda açılmadı (800×480 taşma kanıtı yok).
- Overture bina fusion'ı **renderer'a BAĞLANMADI** — bugün yalnız fixture/gölge
  karşılaştırmasıdır. Üretim karosuna girmesi için ayrı bir tile üretim hattı
  (ve ODbL share-alike'lı veri paketi kararı) gerekir.
- ML footprint doğruluğu **yer gerçeğiyle ölçülmedi**: "2290 bina var" ≠
  "2290 bina doğrudur". Overture bina yüksekliği YOKTUR (0/2627).
- Adres kapsamı için kaynak YOK; yerel yol adı için kaynak YOK. İkisi de
  ayrı veri tedariki (kamu/belediye/saha toplama) gerektirir.

**Hüküm ayrımı:** bu tur **CODE PASS**'tir. `DEVICE PASS` verilmedi,
`REAL VEHICLE FIELD PASS` verilmedi.

### MAPDATA — İKİNCİ TUR ÖLÇÜMLERİ (2026-09-07, aynı gün)

**Durum değişmedi: ENTEGRE · ÜRÜN HAZIR: HAYIR.** Bu tur yeni yetenek
eklemedi; açık borçların **ölçülebilir olanlarını ölçtü** ve bir kusur düzeltti.

**1) ML footprint doğruluğu — kapı KAPANMADI (kararsız).**
Kör örneklem (20 ML + 5 OSM kontrol): açık yanlış pozitif **%5 (1/20)**, ama
%95 GA **[%0,9 – %23,6]** → "%10 üstüyse askıya al" kapısı ne geçildi ne
elendi. **%25 belirsiz** oranı veri değil GÖRÜNTÜ kusurudur (Esri bu konumda
z18 tavanı, 0,48 m/px). **Örneklem gerektirmeyen bulgu:** ML medyan alanı
**73 m²**, insan çizimi OSM medyanı **162 m²** → ML binayı uydurmuyor,
**~2,2 kat küçük çiziyor**. Renderer entegrasyonu **askıda** (kütük #1321).

**2) Etiket aralığı — üretim DEĞİŞTİRİLMEDİ, ama artık kör değil.**
144 varyantlık tarama: aralık düşürmek **her zaman kazandırmıyor** (800×480 ·
pitch 0 · z17'de 460→380 net **−2**). Aday 240 pitch 0'da +3…+4 ve kayıpsız,
pitch 45'te +2 ama bir ad kayboluyor. Arter adı **144/144** korundu. Eşik
(z16) ölçümle doğrulandı: minzoom 15'te z15 ekrana 29–41 ad basıyor.
Kazancı güvenle almak pitch'e duyarlı aralık ister; `symbol-spacing` LAYOUT
olduğu için bu runtime layout yazarı gerektirir ve `road-label` LAYOUT'unun
yazarsız olduğu invaryantını kırar → **uygulanmadı** (kütük #1319).

**3) ÜRETİM DÜZELTMESİ — kapı numarası alanındaki telefon numarası.**
Ölçüm, dokuz üretim karosundaki 32 `housenumber` kaydının birinin upstream'de
kapı numarası alanına yazılmış bir **telefon numarası** olduğunu gösterdi
(`03246245701`). Dün eklenen katman filtresizdi. `length <= 8` filtresi
eklendi: 31/32 geçiyor, en uzun meşru değer `22/D`. İki kilit mutasyonla
kanıtlandı. Ayrıca #1318'in host'ta ölçülebilen ölçütleri kapandı:
**48/48 sahnede sıfır etiket kaybı**, z16'da 0 numara, numara kümesinde
z17'de 2 / z18'de 4 numara yerleşiyor.

> **Cihaz testi uyarısı:** kanonik noktada (36.9175/34.8621) hiç kapı numarası
> YOKTUR; #1318 testi **34,87115 / 36,92690** noktasında yapılmalıdır.

**4) Lisans disiplini kendimize uygulandı.** Ölçümde kullanılan Esri uydu
karoları ve ekran görüntüleri **repoya alınmadı** — yeniden dağıtım hakkı
kanıtlanmadı, `mapDataLicense` kapısının fail-closed kuralı burada da geçerli.
Artefaktlar provenance (URL + SHA-256) ile yeniden üretilebilir.

---

## MAPDATA — #1321 BİNA DOĞRULUK KAPISI: COVERAGE PASS / GEOMETRY FAIL (2026-09-07)

**Durum: VERİ KARARI TAMAMLANDI** · **Building Fusion → Shadow Tile: BAŞLATILMADI**

Sabah vardiyası, gece vardiyasının bıraktığı "kararsız" kapıyı KAPATTI. Kör
örneklem n=20'den n=215'e (189 ML + 26 OSM), tek bölgeden (Tarsus) iki farklı
kentsel dokuya (Tarsus düşük yoğunluk + Mersin merkez yoğun apartman)
genişletildi.

**COVERAGE PASS:** ML yanlış pozitif %95 GA `[%0,83–%5,31]` — %10 eşiği
kesin altında, iki bölgede de tutarlı.

**GEOMETRY FAIL:** footprint alan sistematik küçültmesi (Tarsus 2,19× ·
Mersin 3,16×) İKİ dokuda da doğrulandı ve yoğun dokuda DAHA KÖTÜLEŞTİ —
bu "genelleniyor mu" sorusunun kesin kanıtıdır.

**Karar:** Building Fusion → Shadow Tile Pipeline aşamasına GEÇİLMEDİ.
Politika koşuldur (VE), coverage tek başına yeterli değildir. Ayrık hüküm
gizlenmedi — tek "PASS" altında sunulmadı.

**Yeni öneri (test kanıtlı, kod DEĞİŞTİRİLMEDİ):** OSM-kökenli Overture
gözlemleri (VAR %93–100) ile ML-kökenli gözlemler (VAR %72–83 + sistematik
küçültme) resolver'da AYNI güven seviyesinde değerlendirilmemeli. Somut bir
puan/katsayı bu turda YAZILMADI — kanıt yönü gösteriyor, büyüklüğü değil.

**Açık kalan (bu turda ölçülmedi):** üçüncü kentsel doku (kırsal/yeni
gelişen) · ikinci bağımsız değerlendirici (inter-rater güvenilirliği) ·
#1318/#1319'un cihaz ayağı (bu sabah bağlı cihaz YOKTU — `adb devices` boş
döndü, dürüstçe denenmedi).

Detay: `docs/DEVICE_VALIDATION_LEDGER.md` #1321 ·
`field-runs/mapdata-ml-accuracy-20260907/REPORT.md` (ek bölüm).

---

## MAPDATA — #1318/#1319 CİHAZ TESTLERİ (2026-09-07, sabah devamı)

**Durum:** #1318 KISMEN DOĞRULANDI (800×480 ve rehberlik-soluklaşma hariç) ·
#1319 cihaz deneyi tamamlandı, **460 KORUNUR** (üretim değişmedi).

Cihaz bağlandıktan sonra APK provenance ile (`npm run apk:safe`, host↔cihaz
SHA-256 eşleşti) Xiaomi 23090RA98I'de test edildi.

**#1318 — housenumber:** kanonik nokta (34,87115/36,92690) doğrulandı: z16'da
0 numara, z17'de 2, z18'de 4 — host tahminiyle birebir tutarlı. DAY+NIGHT
ikisinde de sokak adıyla çakışma yok, MINI'de hiç görünmedi, telefon numarası
filtresi canlı stilde doğrulandı. **800×480 ve rota-üstü collision bu turda
da kapanmadı** — gerçek head unit yok, rota kanonik kareden geçmedi (zorlanmadı).

**#1319 — 460 vs 240:** canlı `map.setLayoutProperty` ile üç zoom/pitch
kombinasyonunda A/B test edildi (üretim kodu değişmedi, test sonunda 460'a
geri alındı). **904×406'da 3/3 senaryoda 240 sadece kazanç sağladı, sıfır
kayıp gözlemlendi** — host sweep'in pitch45 kaybı bu cihaz/viewport'ta
tekrarlanmadı (farklı spacing değeri test edilmişti, 380 değil 240).
**Karar değişmedi: 460 korunur** — mimari gerekçe (spacing statik LAYOUT,
yazarsız invaryant) tek başına yeterli VE 800×480 (host'un kaybı bulduğu tek
viewport) hâlâ hiç test edilmedi. Tek viewport'ta kayıp bulunmaması, test
edilmeyen viewport'taki kaybı geçersiz kılmaz.

Kanıt: `field-runs/mapdata-device-20260907/` (ekran görüntüleri, PROVENANCE.md,
device-results.json). Detay: `docs/DEVICE_VALIDATION_LEDGER.md` #1318 · #1319.

---

## MAPDATA — GAP OBSERVATORY + AÇIK KAYNAK BENCHMARKI (2026-09-07)

**Hüküm: NO VERIFIED OPEN CANONICAL BUILDING SOURCE FOUND · SHADOW BLOCKED.**
Microsoft ML'nin önceki `GEOMETRY RESCUE FAIL` hükmü değişmedi; doğrulanmamış
ML footprint yalnız `PotentialBuildingGap` kanıtıdır.

**QA blocker kapandı.** Vitest 4, göreli `setupFiles` değerini Windows'ta
çalışma dizininin kökünden `/src/__tests__/setup.ts` diye çözüyordu. Yol config
dosyasına `import.meta.url` + `fileURLToPath` ile sabitlendi; test/guard
gevşetilmedi ve ana `npm run guard` gerçek testleri çalıştırarak geçti.

**Gözlemlenebilirlik:** mevcut CAROS LAB → Araç → Harita Veri Platformu ekranı
genişletildi. `BuildingGapDetector` çıktısının toplamı, kaynak/kalite ailesi,
reason, `EvidenceGrade`, confidence varlığı, release/tazelik, canonical mesafe,
overlap/containment/alan oranı ve mevcut license gate hükmü gösterilir.
`publishable` daima `FALSE`; veri akışı bağlı değilse `0` yerine `UNAVAILABLE`.
Ekran **GAP EVIDENCE ≠ MAP TRUTH** sınırını ilan eder; MapStore, resolver,
renderer, routing veya CEH davranışına yazmaz ve timer/polling açmaz.

**Aynı-region shootout:** Tarsus/Mersin/Erdemli bounded AOI'lerinde upstream
OSM sırasıyla **11/28/1** footprint nesnesi; Overture 2026-08-19.0 sırasıyla
**123/435/113** bina taşıdı. Overture ayrımı: OSM-derived **11/28/1**,
ML-derived **112/407/112**, diğer family **0/0/0**. OSM kimlik uyumu **40/40**,
duplicate **0/40**; eşleşmiş geometrilerde medyan centroid farkı **0 m** ve
yaklaşık IoU **1,00**. Doğrulanmış açık alternatif artış **0**.

TUCBS/yerel belediye CBS envanteri ve HGM TOPOVT gerçek veri ihtimalini
kanıtlıyor; ancak bu turda belirli bir bina WFS/download ile ticari kullanım,
offline paketleme ve yeniden dağıtım hakları birlikte doğrulanamadı. Google Open
Buildings V3 Türkiye'yi kapsamıyor; OpenBuildingMap ve GlobalBuildingAtlas'ın
Türkiye footprint'leri yeni bağımsız ground truth değil, OSM/Microsoft veya
ticari kullanıma kapalı ML birleşimleridir. Bu nedenle yeni adapter yazılmadı,
canonical bounded dataset ve shadow tile üretilmedi.

Kanıt: `field-runs/mapdata-source-benchmark-20260907/` · cihaz yerleşim borcu:
`docs/DEVICE_VALIDATION_LEDGER.md` #1323.

---

## MAPDATA — GOVERNMENT/MUNICIPAL SOURCE BENCHMARK + DEV/RELEASE GATE (2026-09-07)

**Hüküm: TECHNICAL RESEARCH PASS · PRODUCTION BINDING YOK · RELEASE FAIL-CLOSED.**

Tarsus, Mersin dense ve Erdemli bounded AOI'lerinde OSM baseline ile resmî
Overture `2026-08-19.0` ve GeoNames ölçüldü. Kanıtlanmış OSM üstü gerçek artış
building/road/name/address/POI/boundary kategorilerinde **0** kaldı; Mersin'de
Overture Places için 31 kalite-adayı ikinci doğrulama kuyruğuna alındı. ML
footprint kararı korunur: **GEOMETRY RESCUE FAIL → yalnız GAP EVIDENCE**.

Ticari hak ile geliştirme erişimi ayrıldı: resmî ve bounded erişim commercial
belge kapanmamış olsa da DEV benchmark'a girebilir; release ise pinli sürüm,
hak/record-license audit, attribution/NOTICE, offline redistribution ve
Türkiye izin dokümanı tamamlanmadan geçemez. OSM baseline'ın canonical teknik
rolü ve mevcut MapStore/renderer otoritesi değiştirilmedi.

Yeni `mapDatasetGovernance` iki kapıyı ve gelecekteki
**Ayarlar → Hakkında → Harita Verileri / Kaynaklar ve Lisanslar** metadata
projection'ını kurar. Bounded `overturePlaceAdapter` provenance-korumalıdır;
MapStore, Navigation, Search, CEH, MapLibre veya production renderer'a bağlı
değildir. Ayrıntılı kanıt ve source matrix:
`field-runs/mapdata-government-benchmark-20260907/report-source.md`.
## Turkey address readiness (2026-09-07)

Address readiness is a separate product axis from building geometry. The
canonical chain remains Search → destination handoff → route; address sources
enter only through SourceAdapter → evidence/provenance → resolver → shadow
comparison. Development eligibility and commercial-release eligibility are
separate gates. Unknown commercial permission is fail-closed for release, but
does not block a lawful bounded development benchmark. See
`field-runs/turkey-address-readiness-20260907/report-source.md`.
## Routing Graph v2 — 2026-09-07

Durum: İSKELET. Builder default kapsamı tertiary, unclassified, residential ve
living_street’i hedefleyecek şekilde ayrıştırıldı; erişim politikası
fail-closed olarak ortak saf modüle çıkarıldı. Yeni production graph
üretilmedi ve route authority değişmedi. RTG2 access-role, bridge/tunnel/layer
ve turn restriction metadata taşımadığı için full door-to-door graph hâlâ
ölçüm/format kararı bekliyor. Device/field doğrulaması yapılmadı.
## RTG3 bounded full-drivable validation — 2026-09-07

Tarsus, Mersin dense ve Erdemli sabit AOI'lerinde gerçek OSM Overpass verisinden major-only ve full-drivable RTG3 shadow artefact'ları üretildi. Local road endpoint corpus'u bounded CODE PASS verdi; production `routing-graph.bin` değiştirilmedi. RTG3 road/access/direction/structure/source/restriction truth taşır ve tek kanonik reader/worker authority içinde RTG2 geriye uyumluluğunu korur. Gerçek AOI'lerde restriction, bridge/tunnel ve destination-only örneği çıkmadığından overall durum PARTIAL; DEVICE/FIELD kırmızıdır. Kanıt: `field-runs/routing-graph-v3-20260907/report-source.md`.
## Turkey regional RTG3 platform — 2026-09-08

İki gerçek Mersin corridor RTG3 partition, reciprocal-neighbor manifest, stable OSM portal merge ve SHA doğrulamalı mevcut residency authority entegrasyonu shadow olarak üretildi. Gerçek 6.007 km cross-region route desktop benchmark'ta PASS. PBF streaming builder ve production worker manifest handoff eksik olduğundan overall PARTIAL; production RTG2 değişmedi. Kanıt: `field-runs/turkey-regional-rtg3-20260908/report-source.md`.
