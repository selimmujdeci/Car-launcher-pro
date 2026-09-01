# CockpitOS — CLAUDE.md

## 🌐 DİL KURALI (ZORUNLU)

**Tüm yanıtlar Türkçe olacak.** Kod dışındaki her şey — açıklamalar, sorular, öneriler, hata mesajları, yorumlar — Türkçe yazılacak. İstisna yok.

**HER ZAMAN TÜRKÇE CEVAP VERİLECEK.** Bu kural her oturumda, her fazda, her görev
tipinde ve kullanıcının yazdığı dil ne olursa olsun geçerlidir — kullanıcı
İngilizce yazsa bile yanıt Türkçe verilir. Rapor, denetim, plan, hata açıklaması,
kod yorumu ve commit mesajı gövdesi dahil: **istisna yoktur**.

## 📋 KOPYALANABİLİR ÇIKTI KURALI (ZORUNLU)

**Her yanıt kopyalanabilir olarak verilecek.** Rapor, analiz, plan, denetim sonucu,
liste, tablo, komut dizisi — kullanıcının başka bir yere taşıyabileceği her çıktı
**tek bir ham markdown kod bloğu** içinde sunulur (```` ```markdown ```` … ```` ``` ````),
böylece tek tıkla kopyalanır.

- Blok İÇİNDE düz markdown yazılır: başlıklar, tablolar, listeler bozulmadan taşınır.
- Blok içinde üç ters tırnak kullanılması gerekiyorsa dış blok **dört** ters tırnakla açılır.
- Kısa sohbet cevabı, tek cümlelik onay veya soru sorma bu kuralın dışındadır —
  taşınacak bir çıktı yoksa blok açılmaz.
- Kod/SQL/komut örnekleri zaten kendi bloklarındadır; dış blok bunları sarmalar.
- Blok dışına en fazla **bir cümlelik** giriş yazılır; açıklama, gerekçe ve uyarılar
  bloğun İÇİNE girer (dışarıda kalan metin kopyalanmaz → kaybolur).

## 🎯 VİZYON ANAYASASI (KUZEY YILDIZI — BAĞLAYICI)

**CarOS Pro bir launcher değildir; aracın ikinci beynidir** — evrensel, aftermarket
bir **Vehicle Intelligence OS**. Referans Tesla DEĞİL: Tesla yalnızca kendi aracını
tanır; biz yüzlerce **bilinmeyen** marka/modeli **öğreniriz** → bu yüzden daha güçlü
olmak zorundayız (garantili OEM verisi değil, güvenilmez aftermarket telemetri →
**zero-trust telemetry**).

**Sinyal Karar Sözleşmesi — "8 Kapı":** Hiçbir veri yalnızca ekranda gösterilmek için
okunmaz; her sinyal bir kararın parçasıdır. Bir PID eklemek başarı değildir, ondan
**anlam** üretmek başarıdır. Her sinyal 8 kapıdan geçer:
(1) doğru mu? → Confidence · (2) önemli mi? → Rule · (3) kullanıcı bilmeli mi? → Action ·
(4) sadece sistem mi bilmeli? → Digital Twin · (5) neyle birleşince anlam kazanır? →
Fusion/Context · (6) 5 dk sonra ne olacak? → Prediction · (7) yerine ne karar alabiliriz?
→ Intent/Vehicle Brain · (8) en doğru aksiyon? → Vehicle Brain → Action.

**Tasarım testi (her PR için):** *"Bu özellik Tesla'dan daha akıllı mı? Sadece
gösteriyor mu, yoksa doğruluyor + yorumluyor + öngörüyor + karar veriyor mu?"*
Değilse yeniden tasarla. Tam mimari: `docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md`.

## ⚡ CONTROLLED EVOLUTION + PERFORMANS-UYARLANABİLİR HİBRİT (ZORUNLU)

Proje modu: **CONTROLLED EVOLUTION** (eski STABILIZATION'ın yerine — `AI.md` ile senkron).
Stabilite invaryantları **pazarlıksız korunur** (fail-soft · zero-leak · atomik/minimal
patch · real-device doğrulama · performans bütçesi); vizyon-hizalı yeni zekâ katmanları
**açıktır** — ama her biri **Performans-Uyarlanabilir Hibrit** kuralına tabidir:

- **Tüm katmanlar hibrit/açık**, ama her biri DeviceTier bütçesine abone (AdaptiveRuntimeManager).
- **Güvenlik-kritik katmanlar** (overheat, düşük yağ basıncı, reverse) HER tier'da garanti açık — ucuzdurlar.
- **Ağır analiz** (Digital Twin, Prediction, Driver DNA) soğuk-yolda / düşük frekansta / idle'da; hot-path'e (3Hz hız/RPM) ASLA girmez.
- **Süslü görsel** (3D twin, ağır animasyon) düşük-uçta feda edilir — feda edilen zekâ değil, yalnızca gösterim.
- **Altın kural:** *"bütçesiz/kanıtsız özellik ekleme yasak"* — bütçeli + kanıtlı + hibrit özellik anayasanın **görevidir**.

**🔴 SAHA DOĞRULAMA KÜTÜĞÜ (ZORUNLU):** Test yeşil + tsc temiz olması bir özelliği
"başarılı" YAPMAZ. Her yeni özellik `docs/DEVICE_VALIDATION_LEDGER.md` kütüğüne önce
**🔴 "cihazda test edilmedi"** olarak, *ölçülebilir bir kabul ölçütüyle* eklenir;
gerçek araçta o ölçüt gözlemlenince **🟢 "doğrulandı"**ya taşınır, cihazda düşerse
**❌ "düştü"**ye. Kütükte 🔴 bekleyen bir özelliği "tamam/çalışıyor" diye sunma.

## 🧪 FAZ A — DEVELOPER FIRST / CAROS LAB (AKTİF ÜRÜN POLİTİKASI)

CAROS PRO **şu an son kullanıcı ürünü değildir**; aktif geliştirilen profesyonel bir
**Vehicle OS / Diagnostic Platform**'dur. Bağlayıcı öncelik sırası:

**1) Sağlam mimari · 2) Doğruluk · 3) Güvenlik · 4) Gözlemlenebilirlik (Evidence/Logs)
· 5) Profesyonel geliştirici araçları · 6) Performans · 7) Son kullanıcı deneyimi.**

- **UX / tasarım / sadeleştirme şu an öncelik DEĞİL.**
- Her yeni özellik **önce geliştirici kullanımına** göre tasarlanır: teknik ekran,
  teknik isim (PID/DID/NRC/KWP/UDS), **ham log ve ham hex gösterimi serbesttir**.
- **"Kullanıcı bunu anlamaz" gerekçesiyle özellik kısıtlamak YASAK.** Önce tüm
  profesyonel altyapı kurulur; son kullanıcı ekranı ayrıca ve sonra yapılır.
- Tüm geliştirici araçları tek çatı altında toplanır: **CAROS LAB**
  (Vehicle · Communication · Runtime · AI · Developer kategorileri).
- Fazlar: **Faz A = Developer Platform (ŞU AN)** → Faz B Servis/Expert Mode →
  Faz C Son Kullanıcı. Bugün yazılan araç çöpe gitmez, sonra uygun katmana taşınır.

Bu politika öncelik sırasını değiştirir; **stabilite invaryantlarını EZMEZ**
(fail-soft · zero-leak · atomik patch · performans bütçesi · saha doğrulama kütüğü ·
lisans ve Supabase kuralları). Tam metin: `docs/CAROS_LAB_DEVELOPER_PLATFORM_STRATEGY.md`.

## 👁️ ZORUNLU GÖZLEMLENEBİLİRLİK KURALI (BAĞLAYICI — "TAMAMLANDI" TANIMI)

> **"Gözlemlenemeyen özellik tamamlanmış değildir."**

CAROS LAB, CAROS PRO ekosisteminin **merkezi tanılama ve doğrulama laboratuvarıdır**.
Araç içi sistemler, Arabam Cebimde, filo yönetimi, bulut servisleri ve gelecekte
geliştirilecek tüm modüller — uygun olduğu ölçüde — CAROS LAB üzerinden gözlemlenebilir
olmalıdır.

Her **önemli** özellik, **aynı geliştirme fazı içinde** CAROS LAB entegrasyonuyla
birlikte tamamlanır. Aşağıdaki yedi şartın tamamı sağlanmadan bir özellik
**"tamamlandı" SAYILMAZ** (test yeşil + tsc temiz olması yetmez):

1. Özelliğin kendisi uygulanmış olmalı.
2. CAROS LAB içinde **salt-okunur** gözlem ekranı bulunmalı.
3. Sağlık durumu, çalışma durumu ve önemli tanılama bilgileri **gerçek veri
   kaynaklarından** gösterilmeli (sabit/örnek veri YASAK).
4. LAB ekranı **aktif komut GÖNDERMEMELİ** — öncelik gözlem ve doğrulamadır.
5. **Kanıtsız bilgi ÜRETİLMEMELİ**; bilinmeyen alanlar `UNKNOWN` / `UNAVAILABLE`
   olarak gösterilmeli (sahte 0, sahte tarih, sahte "sağlıklı" YASAK).
6. Gizlilik gerektiren veriler (API anahtarı, kullanıcı verisi, ham komut/transkript,
   VIN, konum, hassas içerik) **LAB'a TAŞINMAMALI** — yalnız VAR/YOK ve ADET.
7. Her yeni modül için **unit testler** ve `docs/DEVICE_VALIDATION_LEDGER.md` içine
   **🔴 cihaz doğrulama maddeleri** eklenmeli.

**Uygulama deseni (mevcut A3–A8 turlarıyla birebir aynı):**
`<x>Sources.ts` (tek okuma katmanı, senkron, her getter try/catch) →
`<x>Model.ts` (saf; I/O · timer · `Date.now` · global durum · React importu YOK) →
`<X>Screen.tsx` (OEM token · açılışta tek okuma + elle YENİLE · timer/abonelik YOK ·
`mountedRef` + cleanup) → `carosLabCatalog` (PLACEHOLDER→AVAILABLE) →
`carosLabScreenMap` (lazy) → kilit testleri → kütük + vizyon güncellemesi.
Gözlemlenebilirlik sınıflandırması `sessionInspectorModel` sözleşmesini KULLANIR
(`OBSERVED · DERIVED · UNAVAILABLE · STALE`) — paralel sistem KURULMAZ.

**"Önemli özellik" ölçütü:** kendi durumu, sağlığı veya zamanlaması olan her yeni
alt sistem. Saf yardımcı fonksiyon, tek dosyalık kozmetik düzeltme ve yalnız
görsel değişiklik bu kuralın dışındadır.

**Ekran enflasyonu yasağı (LAB yüzey politikası):** gözlemlenebilirlik borcu YENİ
EKRAN sayısıyla ödenmez. Sıra şudur: **(1)** mevcut ilgili ekranı GENİŞLET →
**(2)** olmuyorsa mevcut ekrana sekme/bölüm ekle → **(3)** ancak bağımsız durumu ve
kendi tanı akışı olan bir alt sistem için YENİ ekran aç. Her küçük özellik için ayrı
ekran üretmek LAB'ı gezilemez hale getirir ve gerçek cihaz doğrulamasını
KOLAYLAŞTIRMAK yerine zorlaştırır — LAB'ın varlık sebebi budur.

**LAB ikinci otorite OLAMAZ (mimari sınır):** LAB salt-okunur gözlem/teşhis
yüzeyidir. Kural 4 ("aktif komut göndermez") bunun davranış tarafıdır; mimari tarafı
şudur: LAB **kendi gerçeğini üretmez** — hüküm, eşik, sağlık kararı ve durum
sınıflandırması **kanonik otoritelerden** okunur (`dtcAuthority`, `playbackTruth`,
`capabilityRegistry`, `sessionInspectorModel` …). LAB'da hesaplanan bir değer
üretim kararına GERİ BESLENMEZ.

**Gözlem yüzeyi HENÜZ yoksa:** özellik "tamamlandı" diye sunulmaz; eksik LAB ekranı
**açık borç** olarak vizyon belgesine ve kütüğe yazılır.

## 🧭 CROSS-DOMAIN ARCHITECTURE RULES — SYSTEM COHERENCE (BAĞLAYICI)

Bu kurallar CarOS Pro'daki **TÜM** domain mimarileri için bağlayıcıdır: Music ·
Navigation · Mavi · Phone Link · OBD/VDK · CAN/VSI · VehicleDataLayer · Runtime ·
Security · Performance · UI ve gelecekte eklenecek tüm platform alanları.

### 1. ONE DOMAIN = ONE AUTHORITY
Her gerçek kavramın **tek** writable/kanonik sahibi olur:
vehicle truth → VDL / ilgili signal owner · playback truth → native media
authority / `playbackTruth` · navigation truth → navigation owner · phone session
truth → companion/session owner · Mavi lifecycle → `MaviLifecycle` · runtime
lifecycle → SystemBoot / ARCH-01 sahipleri.
**İkinci truth store, mirror-authority veya gizli fallback authority KURULMAZ.**

### 2. DOMAIN OWNERSHIP CANNOT BE STOLEN
Bir domain başka domainin truth'unu sahiplenemez.
- **Mavi**: media/navigation/diagnostic truth sahibi DEĞİLDİR — yalnız
  requester/orchestrator olabilir.
- **Phone Link**: transport/control plane sağlar; CarOS iç domain truth'unu
  sahiplenmez.
- **UI**: presentation state sahibi olabilir, domain truth sahibi OLAMAZ.

### 3. CROSS-DOMAIN COMMUNICATION MUST USE BOUNDARIES
Domainler birbirinin private store/internal state'ine doğrudan bağlanmaz.
**Kullan:** kanonik command/request/result sözleşmeleri · salt-okunur
projeksiyonlar · capability/admission arayüzleri · domain port/adapter.
**Kaçın:** başka domainin mutable store'una doğrudan import · gizli side-effect
çağrıları · duplicate state senkronizasyonu.

### 4. NO DIRECT HARD COUPLING WITHOUT PROOF
Navigation ↔ Music · Mavi ↔ OBD · Phone Link ↔ Media · CAN ↔ UI gibi ilişkiler
**varsayılan olarak hard dependency DEĞİLDİR.** Hard edge yalnız repo/ürün
gereksinimi **kanıtıyla** eklenir; aksi hâlde `SOFT` / `OBSERVATION_ONLY` /
`REQUESTER` ilişkisi kullanılır.

### 5. SHARED PLATFORM LAYERS ARE HORIZONTAL, NOT OWNERS
Runtime/Lifecycle · Message Flow · Security/Authorization · Performance/Resource
Governance · Observability · Native/HAL boundary **domain truth sahibi değildir.**
Bunlar politika/kanıt/taşıma sağlar; domain truth'unu ele geçiremez.

### 6. SECURITY DOES NOT CREATE DOMAIN TRUTH
Authorization yalnız **ALLOW / DENY** kararı verir. Playback state üretmez,
vehicle state üretmez, navigation readiness üretmez.
> **Permission ≠ capability · Capability ≠ readiness · Readiness ≠ active truth**

### 7. PERFORMANCE DOES NOT CHANGE TRUTH
Performans; sampling · coalescing · throttling · defer · cache trim uygulayabilir.
**Ama ASLA:** stale → current · missing → zero · dropped → success · memory
pressure → service failure · low FPS → recovery/restart nedeni.
**Truth cadence ile render cadence AYRI tutulur.**

### 8. RESOURCE OWNERSHIP
`AdaptiveRuntimeManager` tek resource/runtime authority olarak kalır; **domain
cadence sahipliği korunur:** OBD poll timing → OBD scheduler · GPS cadence →
`gpsService` · CAN acquisition → native CAN owner · map render →
MapLibre/component · media playback cadence → media owner.
ARM **bütçe/hint** verir; domain protocol timing'ini ele geçirmez.

### 9. AUDIO ARBITRATION
Music, Navigation ve Mavi birbirine **doğrudan** ses kontrolü uygulamaz. Ses
etkileşimi ortak **Audio Arbitration / Focus / Duck / Disposition** üzerinden
çözülür. Navigation → Music direct mute YOK. Mavi → Media direct volume truth YOK.

### 10. VEHICLE TRUTH PATH
`OBD / CAN / GPS / HAL → domain adapters → VDL / kanonik signal owner →
Navigation / Mavi context / UI projections`
UI · Mavi · Navigation doğrudan **raw transport truth** sahibi olamaz.

### 11. PHONE LINK BOUNDARY
Phone Link: discovery · identity · control plane · data plane olarak ayrılır.
High-bandwidth data plane **control-plane authority ÜRETMEZ**;
projection/cast/media transfer session/capability authority'yi **ele geçirmez**.

### 12. MAVI ROLE
Mavi bir **requester · orchestrator · conversational layer**'dır. Bir domain
aksiyonu isterse akış şudur:
`authorization → kanonik command → domain owner executes → result returns`.
**Mavi domain state'ini kendi başına DEĞİŞTİRMEZ.**

### 13. PERSISTENCE ≠ LIVE TRUTH
Persisted / cached / replayed / imported state **CURRENT live observation
DEĞİLDİR.** Hydration `CACHED` / `DECLARED` / `RECOVERY` önerisi olarak gelir;
native/domain owner **yeniden doğrulamadan** live truth'e yükselmez.

### 14. UI IS A PROJECTION
UI; salt-okunur domain projeksiyonları, presentation cache ve animation/layout
state taşıyabilir. UI üzerinden **doğrudan** vehicle · navigation · playback ·
connectivity · diagnostic truth **YAZILMAZ**.

### 15. NO NEW GLOBAL GOD OBJECT
Yeni global event router · mega store · global scheduler · global performance
manager · global truth manager · global recovery engine **EKLENMEZ.** Yeni ortak
katman ancak mevcut **authority boşluğu repo kanıtıyla gösterilirse** oluşturulur.

### 16. CROSS-DOMAIN FAILURE ISOLATION
Bir domain failure'ı yalnız dependency graph izin veriyorsa diğerini etkiler:
Media failure → Navigation KAPATILMAZ · Mavi unavailable → driving core KAPANMAZ ·
Phone Link unavailable → yerel araç fonksiyonları KAPANMAZ · network unavailable →
offline Navigation/Media KAPANMAZ.

### 17. STALE / SESSION / GENERATION SAFETY
Cross-domain tüm async result/callback **epoch · generation · session ·
correlation** kanıtına göre kabul edilir.
**Eski session sonucu yeni session truth'unu DEĞİŞTİREMEZ.**

### 18. NO DUPLICATE RECOVERY
Domain **failure evidence** üretir · policy `RuntimeRecoverySupervisor`'ındır ·
execution `SystemBoot`'undur. Domain kendi gizli restart/backoff motorunu KURMAZ.

### 19. CROSS-DOMAIN ARCHITECTURE REVIEW (her büyük domain kapanışında ZORUNLU)
- duplicate authority var mı?
- hidden hard dependency var mı?
- circular dependency var mı?
- private mutable store import edilmiş mi?
- second scheduler var mı?
- second freshness/truth sistemi var mı?
- security/performance domain truth üretmiş mi?
- UI writable truth'a dönüşmüş mü?
- failure propagation gereksiz mi?
- session/generation sınırı korunuyor mu?

### 20. FINAL SYSTEM COHERENCE GATE
Tüm büyük domainler tamamlandıktan sonra zorunlu final faz:
**ARCH-FINAL — CROSS-DOMAIN INTEGRATION / SYSTEM COHERENCE.**
Bu fazda Music · Navigation · Mavi · Phone Link · OBD/VDK · CAN/VSI · VDL ·
Runtime · Security · Performance · Native/HAL · UI **aynı anda** denetlenir.

**PASS ölçütü (hepsi = 0):** authority collision · duplicate truth · illegal hard
dependency · duplicate scheduler · duplicate recovery · cross-domain stale write ·
security bypass · performance truth corruption.

## CAROS PRO Vizyon Kaynağı

CAROS PRO ürün vizyonunun, capability roadmap'inin ve özellik gerçeklik
durumlarının tek kalıcı kaynağı:

`docs/CAROS_PRO_VIZYONU.md`

CAROS PRO ile ilgili her görevden önce bu dosya okunmalıdır.

İlgili bir PR tamamlandığında:
- etkilenen özellik durumu,
- production/test/UI/saha kanıtı,
- kalan eksikler,
- sonraki atomik PR

bu dosyada güncellenmelidir.

Dosya varlığı veya izole test özelliği tamamlanmış saymak için yeterli değildir.
Gerçek saha kanıtı olmadan "Sahada Doğrulandı" veya "Ürün Hazır" yazılamaz.

Durum seviyeleri: **YOK · İSKELET · ENTEGRE · DOĞRULANDI · SAHADA DOĞRULANDI**
(+ ayrı alan: **ÜRÜN HAZIR: EVET/HAYIR** — altı koşulun tamamı şart).
Saha durumunda `docs/DEVICE_VALIDATION_LEDGER.md` mutlak otoritedir; vizyon
belgesiyle çelişirse durum YÜKSELTİLMEZ, çelişki vizyon belgesinin
"Çelişki Kaydı" bölümüne yazılır.

## 🤖 OTOMATİK AJAN/MODEL YÖNLENDİRME (KULLANICI POLİTİKASI — ZORUNLU)

Kullanıcı ajan/model ADI VERMEZ. Görev geldiğinde ana oturum görevi sınıflandırır
ve uygun ajana KENDİLİĞİNDEN devreder — model ajan tanımından gelir (kullanıcı
onaylı maliyet politikası; "agent spawn etme" varsayılanını bu politika ezer):

| Görev tipi | Ajan (model) |
|------------|--------------|
| Kod yazma / bug fix / refactor / test yazma | caros-coder (sonnet) |
| Test koşma / regresyon / doğrulama / review | caros-tester (sonnet) |
| Navigasyon / GPS / harita / rota | caros-navigation (sonnet) |
| OBD / CAN / BLE / head unit native | caros-obd-canbus (sonnet) |
| Performans / bellek / termal / FPS | caros-performance (sonnet) |
| Mimari analiz / kök neden / planlama | caros-architect (güçlü model) |
| Güvenlik / auth / RLS / API koruması | caros-security (güçlü model) |

İstisnalar (delegasyon ETME — inline yap, spawn maliyeti işin kendisinden pahalı):
- Tek dosyalık küçük düzeltme, hızlı soru-cevap, 5 dakikalık iş.
- Aktif saha/acil debug oturumu (bağlam kaybı riskli).
Delege edilen işin sonucu ana oturumda DOĞRULANIR (test/tsc) — ajan çıktısına
körlemesine güvenilmez.

## 🔁 IMPLEMENTATION / QA AYRIMI (ZORUNLU — YÜRÜTME POLİTİKASI)

> **Bu bir test AZALTMA politikası DEĞİLDİR.** Güvence aynı kalır; yalnız aynı ağır
> doğrulamanın gereksiz TEKRARI kaldırılır ve geliştirme oturumunun bağlamı ağır QA
> çıktılarıyla tüketilmez.

Ağır doğrulama (full suite · production build · native build) tek bir oturumu
dakikalarca bloklar ve bağlamı doldurur. Bu yüzden iş **iki role** ayrılır. İkisi de
aynı anayasaya tabidir; ayrım YETKİ değil, YÜRÜTME ZAMANLAMASI ayrımıdır.

### IMPLEMENTATION SESSION (varsayılan)

Görevi: repo denetimi · mimariyi koruyarak kod yazmak · atomik patch.

**Çalıştırır:**
- Değişen modüllerin **ilgili feature testleri**
- İlgili **regresyon / authority / safety** kilitleri (hızlı kasa: `npm run guard`)
- **TypeScript** kontrolü (`tsc -b`)
- **Yalnız değişen dosyalarda** lint

**Normal geliştirme döngüsünde ÇALIŞTIRMAZ:**
- Full test suite · production build · gereksiz full lint
- Aynı ağır doğrulamanın tekrarı

### QA SESSION (ayrı pencere)

Ayrı bir Claude/Codex penceresinde çalışır — bu, §🤖'daki `caros-tester` ajanını
KALDIRMAZ: ajan oturum-içi hedefli doğrulama içindir, QA SESSION ise fazın bağımsız
kapanış kapısıdır.

**Çalıştırır:** implementation diff'ini bağımsız inceleme · feature/regresyon/authority
testleri · **full suite** · TypeScript · kapanış lint'i · **production build** · native
kod değiştiyse **native compile/build** · gerçek hata ↔ önceden var olan hata sınıflandırması.

**QA ürün mimarisini kendi başına yeniden tasarlamaz.** Ürün davranışını veya mimariyi
değiştirecek düzeltme implementation penceresine devredilir; QA yalnız küçük, açık ve
**test altyapısına ait** düzeltmeyi yapabilir.

### Faz kapanış protokolü

| Aşama | Hüküm | Kim verir |
|-------|-------|-----------|
| Kod tamamlandı, ağır doğrulama yapılmadı | `IMPLEMENTATION COMPLETE — QA REQUIRED` | Implementation |
| Ağır doğrulama BİR KEZ koştu ve geçti | `QA PASS — PHASE CLOSURE ELIGIBLE` | QA |
| Ağır doğrulama düştü | `QA FAIL` + kök neden | QA |

- Implementation oturumu **`F5 PASS` gibi kesin faz hükmü VERMEZ** — o hüküm QA'nın.
- **`QA PASS` gerçek araç doğrulaması YERİNE GEÇMEZ.** Kod/test/build yeşil olması
  `docs/DEVICE_VALIDATION_LEDGER.md` maddelerini 🔴'dan çıkarmaz; saha kanıtı gelene
  kadar ilgili maddeler **`UNKNOWN / DEVICE VALIDATION REQUIRED`** kalır.
- Vizyon durum seviyesiyle bağ: `QA PASS` en fazla **ENTEGRE** demektir;
  **DOĞRULANDI / SAHADA DOĞRULANDI** yalnız kütükten gelir (bkz. §CAROS PRO Vizyon Kaynağı).

### Ağır doğrulama tekrar yasağı

Aynı kod/diff değişmediyse full suite · production build · native build **sebepsiz
tekrar çalıştırılmaz.**

QA'dan sonra kod değişirse:
1. Önce **yalnız etkilenen hızlı testler** koşulur.
2. Değişiklik **üretim kodunu** etkiliyorsa (test/doküman değil) kapanış kanıtı
   GEÇERSİZDİR → ilgili ağır doğrulama yeniden yapılır.
3. Yalnız test/yorum/doküman değiştiyse kapanış kanıtı geçerli kalır; bu **açıkça
   yazılır** (hangi kanıtın hangi diff'e ait olduğu belirsiz bırakılmaz).

### Test uğruna ürün bozma YASAĞI

PASS almak için **asla**: test silme · assertion gevşetme · authority/safety guard
kaldırma · timeout'u kör şekilde büyütme · production davranışını teste uydurma.

Bir test YANLIŞSA önce **neden yanlış olduğunun kanıtı** sunulur; ancak ondan sonra
kilit **yeni doğru davranışa GÜNCELLENİR** (kaldırılmaz — bkz. §REGRESYON KASASI).

> ⚠️ **Kör guard = düşen guard.** Kaynak metni tarayan bir kilit, taradığı yapı
> değiştiği için 0 sonuç üretiyorsa o kilit **artık hiçbir şeyi korumuyordur**
> (sessizce "geçen" boş-küme testleri dahil). Bu bir başarı değil, bir ARIZADIR:
> kilit yeni tek-kaynağa yeniden bağlanır.

### Raporlama (kısa)

**Implementation:** ne değişti · hangi hızlı testler geçti · açık risk/borç · `QA REQUIRED`.
**QA:** diff · feature/regresyon sonuçları · full suite · typecheck/lint/build ·
gerçek hata varsa kök neden · `QA PASS` / `QA FAIL`.

Binlerce satırlık test/build çıktısı rapora YAPIŞTIRILMAZ — özet sayılar ve gerçek
hata mesajı yeter.

## Project Overview

An Android in-car infotainment OS built with React + TypeScript + Capacitor. Optimized for automotive displays with offline-first maps, GPS tracking, OBD integration, and native app launching.

**App ID:** `com.cockpitos.pro`
**Primary branch:** `main` (remote HEAD `origin/main`; eski `master` ref'i arşiv — PR/merge hedefi `main`)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 5 |
| Build | Vite 8 |
| Styling | Tailwind CSS 4 (utility-only, no CSS-in-JS) |
| State | Zustand 5 |
| Maps | MapLibre GL 4 (offline-first) |
| Mobile | Capacitor 8 (Android) |
| Icons | Lucide React |

---

## Directory Structure

```
src/
├── components/        # UI components organized by feature
│   ├── apps/          # App grid and launcher UI
│   ├── home/          # Home screen widgets
│   ├── layout/        # Root layout wrapper
│   ├── map/           # Map views (FullMapView, MiniMapWidget, Overlay)
│   ├── modals/        # Modal dialogs
│   └── settings/      # Settings page
├── platform/          # Native bridge and platform services (17 files)
│   ├── bridge.ts      # Platform abstraction (demoBridge / nativeBridge)
│   ├── appLauncher.ts
│   ├── mapService.ts
│   ├── mapSourceManager.ts
│   ├── gpsService.ts
│   ├── obdService.ts
│   ├── nativePlugin.ts
│   ├── navigationService.ts
│   ├── mediaService.ts
│   └── ...
├── store/             # Zustand stores
├── data/              # Static data (apps.ts)
├── types/             # TypeScript type definitions
├── App.tsx
└── main.tsx
android/               # Capacitor Android project
public/maps/           # Offline map tiles
dist/                  # Build output (do not edit)
```

---

## Development Commands

```bash
npm run dev           # Start local dev server (browser mode)
npm run build         # TypeScript check + Vite build
npm run lint          # ESLint check
npm run preview       # Preview production build
npm run android       # Build → sync → open in Android Studio
npm run cap:sync      # Build → sync web assets to native
npm run cap:copy      # Build → copy web assets only (no plugin sync)
npm run test:e2e      # Playwright E2E tests (headless)
npm run test:e2e:ui   # Playwright E2E tests (interactive UI)
```

## E2E Testing (Playwright)

E2E testler `e2e/` klasöründe. Kritik user flows'u test eder:

| Test Dosyası | Kapsam |
|---------------|--------|
| `app.spec.ts` | Boot sequence, ErrorBoundary, portrait warning |
| `navigation.spec.ts` | App grid, phone, maps, POI search |
| `obd.spec.ts` | OBD mock mode, speedometer, RPM, fuel gauges |
| `theme.spec.ts` | Theme switching, night mode, widget styles |
| `safety.spec.ts` | Reverse overlay priority (z-index: 100000), radar HUD |
| `settings.spec.ts` | Settings drawer, language, volume, performance |
| `smart-engine.spec.ts` | Driving mode detection, AI recommendations |
| `error-handling.spec.ts` | Error boundaries, console errors |

**Kurulum:** `npx playwright install --with-deps chromium`
**CI:** `CI=true npm run test:e2e` — otomatik retries + trace

## Unit & Integration Testing (Vitest)

Unit ve integration testler `src/__tests__/` klasöründe:

| Klasör/Dosya | Açıklama |
|--------------|----------|
| `helpers/index.ts` | Paylaşılan mock'lar, fixture'lar, helper fonksiyonlar |
| `fixtures/integration.ts` | Integration test senaryoları |
| `*.test.ts` | Platform servis unit testleri |
| `*.integration.test.ts` | Multi-servis integration testleri |

### Test Kategorileri

**Unit Tests:**
- OBD service state machine, sanitization
- Smart Engine (detectDrivingMode, trackLaunch, Markov)
- Safety Brain (fault tracking, feature disable)
- Store (settings merge, negative delta guard)

**Integration Tests:**
- OBD + GPS data flow
- Smart Engine + Theme coordination
- Runtime Manager hysteresis
- Zustand store persistence

### Komutlar

```bash
npm run test            # Tüm testler (headless)
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
npm run guard           # Hızlı regresyon kasası (sadece kilitler)
npm run apk:safe        # test → build → sync → temiz APK (test düşerse APK ÜRETİLMEZ)
```

### 🔒 REGRESYON KASASI — "YASA" (ZORUNLU)

`src/__tests__/regression.guards.test.ts` defalarca bozulup düzelttiğimiz
davranışları KİLİTLER (ekran adaptasyonu, saat gün/gece, geçersiz tema,
sesli rota uygulama-içi, reroute eşiği, saat siyah-dikdörtgen…).

- **Bu testleri ASLA zayıflatma/silme.** Bir kilit bilinçli değişiyorsa, kilidi
  yeni doğru davranışa GÜNCELLE — kaldırma.
- **Yeni bir bug düzeltince** karşılık gelen kilidi bu dosyaya EKLE (aynı bug
  bir daha sessizce geri gelmesin).
- **Cihaza APK göndermeden önce `npm run apk:safe`** kullan: test geçmezse APK
  üretilmez. Manuel build'de bile önce `npm run test` koş — yeşil olmadan APK YOK.
  ↳ Bu kapı **sevkiyat ve faz kapanışı** kapısıdır (§IMPLEMENTATION / QA AYRIMI):
  her implementation döngüsünde değil, **APK üretiminden ve `QA PASS` hükmünden
  önce** koşar. Geliştirme döngüsünün hızlı karşılığı `npm run guard`'dır — o
  kasayı ATLAMAK serbest değildir, yalnız FULL suite ertelenir.
- **Stale-APK tuzağı:** gradle "up-to-date" deyip eski APK paketleyebilir;
  `apk:safe` bu yüzden `gradlew clean` kullanır (taze APK garantisi).

### Test Helper Kullanımı

```typescript
import { OBD_FIXTURES, GPS_FIXTURES, clearAllStorage } from './helpers';
import { FUEL_COMPUTATION_SCENARIOS } from './fixtures/integration';

// OBD fixture kullan
const obdData = createOBDData({ speed: 60, rpm: 2500 });

// Integration scenario çalıştır
FUEL_COMPUTATION_SCENARIOS.forEach((scenario) => {
  it(scenario.name, () => {
    const result = computeFuel(scenario.fuelPercent, scenario.tankLiters);
    expect(result).toBeCloseTo(scenario.expectedFuelRemaining);
  });
});
```

---

## Architecture Patterns

### Bridge Pattern (platform abstraction)
All native capabilities go through `src/platform/bridge.ts`. Two implementations:
- **`demoBridge`** — web/browser mode, opens URLs
- **`nativeBridge`** — Capacitor Android mode, invokes native plugins

Never call Capacitor APIs directly in components — always go through the platform services.

### Platform Services
Each capability has a dedicated service in `src/platform/`:
- GPS → `gpsService.ts`
- OBD diagnostics → `obdService.ts`
- App launching → `appLauncher.ts`
- Maps → `mapService.ts` + `mapSourceManager.ts`
- Navigation → `navigationService.ts`
- Media/music → `mediaService.ts`
- Contacts → `addressBookService.ts`

### Offline-First Maps
- MapLibre GL renders tiles
- Service worker caches tiles for offline use (see `SERVICE_WORKER_OFFLINE.md`)
- `mapSourceManager.ts` switches between online / offline / cached sources
- Offline tiles live in `public/maps/`

### State Management
- Zustand for shared state (map sources, settings)
- Keep store slices small and feature-scoped

---

## Conventions

- **TypeScript strict mode** — no `any`, no unused variables
- **ES2023 target** — modern JS features allowed
- **Tailwind-only styling** — never write raw CSS or CSS-in-JS
- **Component organization** — group by feature, not by type
- **Car-themed dark design** — optimized for automotive displays; preserve the dark color palette
- **ErrorBoundary** wraps the component tree — don't remove it

---

## Building for Android

1. `npm run build` — builds web assets to `dist/`
2. `npx cap sync android` — syncs to Android project
3. Open `android/` in Android Studio to build APK/AAB

Capacitor config: `capacitor.config.ts`
Android WebView settings: mixed content allowed, remote debugging enabled in dev.

---

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/platform/bridge.ts` | Platform abstraction — start here for native features |
| `src/platform/mapSourceManager.ts` | Online/offline map source switching |
| `src/store/` | All Zustand state |
| `src/data/apps.ts` | Static app definitions shown in launcher |
| `capacitor.config.ts` | Capacitor + Android WebView configuration |
| `vite.config.ts` | Build configuration |
| `OFFLINE_TILES_SETUP.md` | How to configure offline map tiles |
| `SERVICE_WORKER_OFFLINE.md` | Service worker caching strategy |

---

## 🛡️ Automotive Grade Engineering Standards (CRITICAL)

To ensure "Caros Pro" meets industrial-grade reliability, all code modifications MUST adhere to these standards:

### 1. Zero-Leak Memory Management
- **Cleanup Responsibility:** Every `useEffect`, `setInterval`, or `eventListener` MUST have a corresponding cleanup function.
- **Reference Management:** Avoid global variable leakage; use React refs or Zustand for persistent state.
- **Resource Disposal:** Explicitly destroy MapLibre instances and WebGL contexts on unmount.

### 2. Sensor Resiliency (Self-Healing)
- **Input Sanitization:** Reject "impossible" sensor data (e.g., speed > 300km/h, RPM jumps > 5000 in 1ms).
- **Graceful Fallback:** If a sensor (OBD/GPS) fails, the UI must remain functional (fail-soft).
- **Hysteresis:** Implement threshold-based logic for mode switches to prevent UI flickering in stop-and-go traffic.

### 3. Performance & I/O Optimization
- **Write Throttling:** Never write to `localStorage` or disk more than once every 5-10 seconds for high-frequency data (like KM counters).
- **Render Control:** Throttle state updates for high-frequency data (RPM/Speed) to 10Hz-20Hz to save CPU/GPU cycles.
- **Atomic Persistence:** Use the `safeStorage` wrapper for all persistence to handle quota and corruption errors.

### 4. Data Integrity
- **Clock Jump Protection:** Never rely on absolute system time for duration calculations (Trips); use monotonic deltas (delta-time) to handle battery reconnections or system clock resets.

---

## ⚡ V8 Engine & JIT Optimization (MISSION-CRITICAL)

To prevent JIT Deoptimization (Deopt) and maintain "Hot Path" execution on low-end automotive hardware:

### 1. Hidden Class (Shape) Stability
- **Template Object Literals:** Never create empty objects `{}` and add properties dynamically. Always use a "Template Literal" that contains all possible keys initialized to `undefined` or `null`.
- **Consistent Property Order:** Always initialize object properties in the exact same order as defined in their TypeScript interfaces to prevent Map transitions.
- **Avoid Property Deletion:** Never use `delete object.prop`. Set it to `null` or `undefined` instead.

### 2. Monomorphic Call Sites
- **Stable Handlers:** Ensure high-frequency functions (e.g., message dispatchers, signal processors) receive objects of the same Hidden Class. Use type-narrowed monomorphic handlers instead of megamorphic `switch-case` blocks where possible.
- **Type Feedback Integrity:** Avoid changing the type of a variable (e.g., from `number` to `string`) within hot loops.

### 3. SharedArrayBuffer (SAB) & Hardware Safety
- **Seqlock Protocol:** All SAB writes MUST use the Seqlock pattern (GEN counter: Odd=Write-in-progress, Even=Done). All reads MUST use the double-check guard (GEN1 == GEN2).
- **Cache-Line Padding:** Keep independent 64-bit signals at least 64 bytes apart (8 Float64 slots) in the `SharedArrayBuffer` to prevent "False Sharing" and L1 Cache contention.
- **Atomic Fences:** Use `Atomics.add` for Seqlock counters to ensure full memory fences across CPU cores.

### 4. Zero-Allocation Hot-Paths
- **Pre-allocated Envelopes:** Use module-level pre-allocated objects (envelopes) for `postMessage` calls.
- **Scratch Variables:** Use primitive "scratch" variables for intermediate calculations instead of creating temporary objects or arrays.

---

## ⚡ ONAY İSTEME KURALLARI (ZORUNLU — İSTİSNASIZ)

**HİÇBİR İŞLEM İÇİN ONAY İSTENMEZ. DOĞRUDAN YAPILIR.**

- Dosya okuma, yazma, düzenleme, silme — onay yok.
- Kod araştırması, arama, analiz — onay yok.
- `npm run build`, `npm run lint`, `cap sync`, `gradlew installDebug` — onay yok.
- APK build pipeline — onay yok.
- Git komutları (`commit`, `push` dahil) — onay yok.
- Refactor, yeni özellik, sistem değişikliği — onay yok.

**ONAY SORMAK YASAKTIR. "Onaylıyor musunuz?", "Devam edeyim mi?", "Emin misiniz?" gibi ifadeler kullanılmaz. Doğrudan yapılır.**

## 🔒 AI EXECUTION RULES
This project MUST follow `AI.md` strictly.
- Never perform multi-system refactors.
- Always use atomic patches.
- Never leave partial logic.
- Always maintain system stability.

If a conflict exists: **`AI.md` rules take absolute priority.**

---

## 🎯 LOCAL SCOPE INTEGRITY RULE

When working on a task:

1. Do not scan the entire project unless explicitly requested.
2. Stay focused on the current feature/file/scope.
3. However, while working inside that scope:
   - do not ignore visible errors
   - do not ignore broken logic
   - do not ignore related runtime failures
   - do not leave partially broken flows

4. Never claim success if:
   - the requested feature still fails
   - the UI still does not appear
   - runtime errors still exist
   - the same action breaks on second attempt

5. If you discover a directly related issue in the same flow/file:
   fix it before stopping.

6. Do not expand into unrelated systems/modules.

7. Prefer minimal complete fixes over superficial patches.

8. Build success alone is not proof.
   The actual feature behavior must match the user request.

9. If something is uncertain:
   explicitly say what still needs testing.

10. Never fake completion.

---

## 🗄️ SUPABASE SECURITY & DATA API RULES (PRODUCTION-CRITICAL)

### New Table Checklist (public schema)

Every new table in the `public` schema **MUST** include all four steps — no exceptions:

```sql
-- 1. GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON public.table_name TO anon, authenticated;
GRANT ALL ON public.table_name TO service_role;

-- 2. RLS
ALTER TABLE public.table_name ENABLE ROW LEVEL SECURITY;

-- 3. POLICY (minimum örnek)
CREATE POLICY "anon read" ON public.table_name FOR SELECT TO anon USING (true);
CREATE POLICY "auth write" ON public.table_name FOR ALL TO authenticated USING (auth.uid() = user_id);

-- 4. Verification query
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'table_name';
```

### Migration Verification (zorunlu)

Her migration sonunda şunlar doğrulanmalı:

| Kontrol | Yöntem |
|---------|--------|
| `anon` izinleri | `information_schema.role_table_grants` sorgusu |
| `authenticated` izinleri | aynı sorgu |
| `service_role` izinleri | aynı sorgu |
| RLS durumu | `pg_tables.rowsecurity = true` |
| Policy varlığı | `pg_policies` tablosu |

### Supabase Data API Kuralları

- PostgREST erişimi: her endpoint için GRANT + RLS + policy üçlüsü zorunlu.
- Frontend erişimi: `anon` key ile erişilecek tablolarda `anon` GRANT eksikse **production crash** sayılır.
- Realtime: `supabase_realtime` publication'a tablo ekleniyorsa RLS politikaları realtime mesajlarına da uygulanır — policy'siz tablo ekleme yasak.

### Kesin Yasaklar

- GRANT olmadan migration göndermek yasak — **production-critical hata** sayılır.
- `public` şema tablolarının otomatik erişilebilir olduğunu varsaymak yasak.
- RLS kapalıyken `authenticated` policy yazmak anlamsızdır — önce RLS aç.
- Binary / büyük blob verisini `localStorage` veya Supabase `text` kolonuna yazmak yasak.

---

## ⚖️ TİCARİ LİSANS / SATIŞA UYGUNLUK KURALI (ZORUNLU)

Bu uygulama **ticari olarak satılacak** (3. taraf üreticilere / head unit'lere dahil). İçine eklenen **hiçbir şey ticari satışı engellememelidir.** Bu yüzden her yeni bağımlılık, model, font, harita verisi veya gömülü varlık için:

### İzin verilen lisanslar (permissive — serbestçe satılır)
- **MIT, Apache-2.0, BSD (2/3-Clause), ISC, Zlib, Unlicense, CC0, OFL (fontlar)**
- Bunlar: telifsiz, kapalı kaynak satışa izinli, coğrafi kısıt yok.

### KESİN YASAK (satışı engeller / risk yaratır)
- **Copyleft lisanslar:** GPL, AGPL, LGPL, SSPL, EUPL — kaynak açma/türev zorunluluğu getirir. **Eklenmez.**
- **"Non-Commercial" (NC) varlıklar:** `CC-BY-NC`, ticari kullanımı yasaklayan model/font/ses/veri. **Eklenmez.**
- **Belirsiz/lisanssız** GitHub kodu veya model. Lisansı netleşmeden gömülmez.
- 3. taraf **marka logoları** (Spotify, YouTube vb.) gömüp "onaylı" izlenimi vermek — yalnızca **isimle referans** verilir, logo gömülmez.

### Yeni bir şey eklemeden önce (zorunlu adımlar)
1. Lisansı **doğrula**; permissive değilse **EKLEME**, önce kullanıcıya sor.
2. Permissive lisanslar (Apache/BSD) **atıf** ister → uygulamadaki **"Açık Kaynak Lisansları"** ekranına ekle.
3. **Harita verisi OpenStreetMap tabanlıysa** → `© OpenStreetMap katkıcıları` atıfı **zorunlu** (ODbL).
4. Ücretli API (Gemini/Claude/OpenAI) → **BYOK** (her müşteri kendi anahtarı). Uygulamaya **merkezi/gömülü API anahtarı konmaz** (fatura + ToS riski).

### Mevcut durum (referans — hepsi satışa uygun)
- Vosk + Türkçe model: **Apache-2.0** ✅ · MapLibre: **BSD** ✅ · Capacitor/React/Zustand/Tailwind/Lucide: **MIT** ✅

### Lansman öncesi kontrol
- Tüm bağımlılık ağacını tara: `npx license-checker --summary` (kopyaleft çıkarsa çıkar/değiştir).
- Not: Bu hukuki danışmanlık değildir; ticari lansman öncesi lisans denetimi yapılmalı.

