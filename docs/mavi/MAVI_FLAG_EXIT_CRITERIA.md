# CAROS PRO — MAVİ FEATURE FLAG EXIT CRITERIA

**Tarih:** 2026-08-30 · **Faz:** MAVI-F13/2 · **Kütük maddesi:** #1031
**Otorite:** `docs/mavi/CAROS_MAVI_ULTIMATE_OEM_ARCHITECTURE_SPEC_v1.md` §28.4 (bayrak disiplini)
**Saha gerçeği:** `docs/DEVICE_VALIDATION_LEDGER.md` (bu belge kütüğü EZMEZ)

---

## 0. BU BELGE NEDEN VAR

Spec §29 F13 kapanışı için **"açık bayrak ≤ 2"** diyor. Bugün **16 Mavi şalteri**
tanımlı ve hepsi varsayılan KAPALI.

Bu sayıyı kovalamak için bayrak silmek **yasaktır** — bir bayrağı silmenin iki
yolu vardır ve ikisi de kanıtsızdır:

- **Kalıcı AÇ** → cihazda hiç doğrulanmamış bir davranışı tüm filoya dayatmak;
- **Kodla birlikte SİL** → yazılmış ve test edilmiş bir yeteneği ölçmeden çöpe atmak.

Spec §28.4 üçüncü yolu tarif ediyor ve F13/2 onu **yazıya döküyor**: her bayrak
için **ölçülebilir açılma ölçütü** ve **emeklilik ölçütü**. Bayrak sayısı bu
belgeyle değil, ölçütler **gerçek araçta karşılandıkça** düşer.

> **Kesin kural:** Bir bayrak, ölçütlerini gerçek cihazda geçmeden `default ON`
> yapılamaz; `default ON` olduktan sonra **iki temiz sürüm** geçmeden koddan
> kaldırılamaz. Kaldırılamayan bayrak = **kararsız özellik** → ya bitirilir ya silinir.

---

## 1. YAŞAM DÖNGÜSÜ (her bayrak için aynı)

```
TANIMLI (default OFF)
   │  ① açılma ölçütü gerçek araçta ÖLÇÜLDÜ
   ▼
PİLOT (geliştirici cihazında local override ile ON)
   │  ② soak süresi tamamlandı · regresyon 0 · kütük maddeleri 🟢
   ▼
DEFAULT ON (uzak bayrak filoya açık, rollback tek şalter)
   │  ③ İKİ temiz sürüm (yeni saha kusuru yok, rollback kullanılmadı)
   ▼
KALDIRILDI (kod tek yol olur, bayrak okuması silinir)
```

**Rollback sözleşmesi:** her bayrağın kapalı değeri **bugünkü davranıştır**.
`default ON` aşamasında bile kapalıya çekmek davranışı birebir eski hâline
döndürmelidir; bu doğrulanmadan ② aşamasına geçilmez.

**Zincirleme kapılar korunur:** `mavi_ai_*` ailesinin tamamı `mavi_ai_gateway`
kapalıyken açılamaz (fail-closed). Bir alt bayrak, üstündeki bayrak `default ON`
olmadan `default ON` YAPILAMAZ.

---

## 2. ÖLÇÜM KAYNAKLARI (yeni telemetri kurulmaz)

| Ölçüt | Nereden okunur |
|-------|----------------|
| Uçtan uca / segment gecikmesi | `assistant/maviLatencyTrace` → LAB **Mavi Konsolu** |
| Erken endpoint oranı | `voice/sttPartialStream` sayaçları → LAB *Streaming ASR* |
| Akış/iptal sayaçları | `voice/maviResponseStream` → LAB *Mavi Konsolu* |
| Capability kararı/rota | `capability/fabric/capabilityFabric` diagnostics |
| Gözlem doğruluğu | `capability/observation/observationLedger` |
| Gölge/eski hat sayaçları | `maviCore/wiring/maviEvidence` → LAB **K · Kanonik Runtime** |
| Sağlayıcı sağlığı / kota | `aiHealth` + `companionChatProvider` quota snapshot |
| Bağlam/hafıza enjeksiyon sonucu | `maviOrchestratedChat` context/memory telemetry |

**Kanıtsız sayı yasağı:** bir ölçüt için LAB *"Ölçüm yok"* diyorsa o ölçüt
**karşılanmamış** sayılır. Ölçüm yokluğu ölçüm değildir.

---

## 3. BAYRAK TABLOSU — AÇILMA VE EMEKLİLİK ÖLÇÜTLERİ

### 3.1 Çalışma zamanı / algı bayrakları (gateway ailesinin DIŞINDA)

| # | Bayrak | Neyi açar | Default | Rollback | Kütük bağı | Açılma ölçütü (ölçülebilir) | `default ON` şartı | Kaldırma şartı |
|---|--------|-----------|---------|----------|-----------|------------------------------|--------------------|----------------|
| 1 | `mavi_latency_trace` · `mavi.latencyTrace.enabled` | F0 uçtan uca gecikme izi (salt gözlem) | OFF | OFF = iz yok, davranış aynı | #959-#962 | Gerçek head unit'te **≥100 tur** iz toplandı · segment toplamı uçtan uca ölçümle **±%5** uyumlu · hot-path'e (3 Hz) ek yük **ölçülemedi** (FPS düşüşü < 1) | Üç ölçüt 🟢 · bir sürüm boyunca crash/ANR yok | İz **kalıcı gözlem yüzeyi** olduğu için bayrak KALDIRILMAZ; `default ON` son durak. Yalnız ölçüm maliyeti bütçeyi aşarsa DeviceTier'a abone edilir |
| 2 | `mavi_semantic_endpoint` · `mavi.semanticEndpoint.command` | F3 **erken cümle-sonu KOMUTU** (karar zaten üretiliyor; bu şalter sağlayıcıya dokunmayı açar) | OFF | OFF = karar ölçülür, mikrofon erken kapanmaz | #970-#974 | **RİSK: YÜKSEK.** Şalter kapalıyken sahada **≥500 tur** ölçüm: `prematureEndpointRate ≤ %2` · endpoint kararı p50 **≤ 450 ms** · `STREAMING_WITH_VAD` yeteneği en az iki farklı head unit'te doğrulandı | Yukarıdaki üçü 🟢 **ve** pilot cihazda 200 turda kullanıcı sözü kesilme şikâyeti **0** | Spec'in kademeli eşik indirimi (1100→900→700→500→350) tamamlanıp son eşik iki sürüm temiz kaldıktan sonra |
| 3 | `mavi_streaming_response` · `mavi.streamingResponse.enabled` | F4 akış cevabı + parçalı TTS | OFF | OFF = akış hiç kurulmaz, istek akış kipine bile geçmez | #975-#980 | FAST yolda **ilk ses p50 ≤ 900 ms** (bugünkü tam-cevap beklemesine göre ölçülen kazanç ≥ %30) · akış iptali (barge-in) **p95 ≤ 120 ms** · **yarım cümle kalma = 0** (100 tur) · akış bekçisinin kurtardığı asılma sayısı raporlanır | Dört ölçüt 🟢 · bir sürüm pilot · offline klip kapsaması ≥ %80 | `default ON`dan sonra iki temiz sürüm; kaldırıldığında **akış tek yol** olur ve tam-cevap yolu SİLİNİR |
| 4 | `mavi.mediaNextTakeover.enabled` | `maviCore` gölge hattının **yalnız `media.next`** eylemini gerçek handler'a bağlar | OFF | OFF = gölge, eski hat çalışır | #1030 (K bölümü) | LAB **K · Kanonik Runtime**'da: gölge kararları **> 0** (ölçüm gerçekten yapıldı) · **çift yürütme = 0** · gölge ile eski hattın `media.next` kararı **200 turda sapmasız** | Üç ölçüt 🟢 · gölge/gerçek karşılaştırması bir hafta gözlendi | **Bu bayrak spec §28.2'nin taşıma aracıdır.** `maviCore` MCX'e taşınınca allowlist genişletilir; taşıma bitince bayrak ve gölge hat BİRLİKTE kaldırılır |
| 5 | `mavi_capability_fabric_enforce` · `mavi.capabilityFabric.enforce` | F5 capability kapısının **gölge → zorlayıcı** kipe geçmesi (karar artık engelleyebilir) | OFF | OFF = karar üretilir, hiçbir eylem engellenmez | #981-#986 | Gölge kipte sahada **≥1000 karar** toplandı · `wouldBlock` oranı ölçüldü ve **yanlış-blok = 0** (her `wouldBlock` elle incelendi) · katalog kapsaması ≥ 6 domain | İki ölçüt 🟢 · pilot cihazda bir hafta zorlayıcı kip, kullanıcı komutu düşmesi 0 | Zorlayıcı kip iki sürüm temiz kaldıktan sonra; kaldırıldığında kapı **daima zorlayıcı** olur |

### 3.2 AI Gateway ailesi (`aiGatewayFlag.ts` — zincirleme fail-closed)

> **Ana şalter kuralı:** `mavi_ai_gateway` tek başına kimseyi açmaz —
> `ETKİN = ana şalter AND (şirket izni VEYA araç izni)`. Kapsam izni sunucudan
> okunur; okunmadıysa kapı **KAPALIDIR**. Aşağıdaki her alt bayrak ayrıca kendi
> kapısını uygular ve üstündeki bayrak kapalıyken açılamaz.

| # | Bayrak | Neyi açar | Default | Rollback | Ek izin | Açılma ölçütü (ölçülebilir) | `default ON` şartı | Kaldırma şartı |
|---|--------|-----------|---------|----------|---------|------------------------------|--------------------|----------------|
| 6 | `mavi_ai_gateway` | Sağlayıcı-bağımsız gateway (zincirin BAŞINA aday ekler; kalan zincir yedek DURUR) | OFF | OFF = mevcut Gemini→Groq→Haiku zinciri birebir | kapsam izni (şirket/araç) | Pilot filoda **≥500 istek**: gateway yolu hata oranı mevcut zincire **eşit veya daha iyi** · p95 cevap süresi **regresyon yok** · kota/429 davranışı mevcut zincirle aynı · kapsam izni kaldırılınca erişim **anında kapandı** (fail-closed doğrulandı) | Dört ölçüt 🟢 · bir sürüm pilot | Gateway tek sağlayıcı yolu olduğunda ve eski zincir SİLİNDİĞİNDE; ondan önce kaldırılamaz (rollback yolu yok olur) |
| 7 | `mavi_ai_orchestrator` | Görev sınıflandırma + model seçimi (gateway'in ALT tercihi) | OFF | OFF = tek-sağlayıcı gateway davranışı | — | #6 `default ON` olmuş olmalı · orkestre yolda **model seçimi doğruluğu** ölçüldü (görev sınıfı ↔ seçilen model tutarlılığı ≥ %95, 200 istek) · sağlayıcı devre kesici davranışı regresyonsuz | İki ölçüt 🟢 · bir sürüm pilot | #6 kaldırıldıktan sonra, iki temiz sürüm |
| 8 | `mavi_ai_context` (+ `consent = vehicle_context`) | Araç bağlamının prompt'a ETİKETLİ blok olarak eklenmesi | OFF + izin YOK | OFF = araç verisi AI'ya gitmez | **kullanıcı izni** | #6 `default ON` · **F13 tek-izdüşüm kilidi geçerli**: LAB telemetrisi `canonical_upstream` gösteriyor (çift enjeksiyon yok, #1029) · bağlam bloğunda **VIN/konum/kişisel veri 0** (kanıt: serileştirici testleri + prompt denetimi) · cevap kalitesinde regresyon yok | Üç ölçüt 🟢 · **gizlilik denetimi imzalı** · bir sürüm pilot | İzin modeli kalıcıdır; **bayrak kaldırılabilir ama İZİN kaldırılamaz** — kaldırma sonrası kapı yalnız `consent`e bağlanır |
| 9 | `mavi_ai_memory` (+ `consent = memory`) | Hafıza bloğunun prompt'a eklenmesi | OFF + izin YOK | OFF = kişisel tercih AI'ya gitmez | **kullanıcı izni (ayrı)** | #8 ile aynı ölçütler · ek: aynı olgu prompt'ta **tam bir kez** geçiyor (#1029) · `sensitiveMemoryGuard` reddi > 0 gözlendi (kapı gerçekten çalışıyor) · "unut" komutu sonrası blok **anında** boşalıyor | Üç ölçüt 🟢 · gizlilik denetimi imzalı · bir sürüm pilot | #8 ile aynı kural (izin kalır, bayrak gider) |
| 10 | `mavi_ai_tools` (+ `consent = tools`) | Tool calling — model uygulama içinde EYLEM önerebilir | OFF + izin YOK | OFF = araç hiç bildirilmez | **kullanıcı izni** | #6 `default ON` · **F13 kilidi:** araç yönlendiricisi `commandExecutor`a doğrudan bağlanmıyor (kaynak kilidi geçiyor) · 200 tool çağrısında **yetkisiz eylem = 0** · her tool çağrısı `capabilityFabric` → `maviActionAuthority` kapısından geçti (kanıt: `toolCallEvidence`) | Üç ölçüt 🟢 · **güvenlik denetimi imzalı** · bir sürüm pilot | Araç yolu kanonik kapıdan geçtiği kanıtlandıktan ve iki temiz sürüm sonrası |
| 11 | `mavi_ai_planner` | Çok adımlı plan üretimi (yalnız KARAR; yürütmez) | OFF | OFF = plan boş | — | #10 `default ON` (pratikte tool izni olmadan plan boş kalır) · plan adımlarının **%100'ü** kanonik `capabilityPlan` modeline dönüşebiliyor · yarım plan (kısmi yürütme) **= 0** | İki ölçüt 🟢 · bir sürüm pilot | #10 kaldırıldıktan sonra iki temiz sürüm |
| 12 | `mavi_ai_mechanic` | AI Usta teşhis bloğu (mevcut `aiCore` sonucunu Mavi'ye taşır; yeni ölçüm YAPMAZ) | OFF | OFF = blok eklenmez | — | #6 `default ON` · teşhis bloğunda **uydurma kod/değer = 0** (100 örnek elle denetlendi) · `UNKNOWN` alanlar dürüstçe `UNKNOWN` görünüyor · DTC'li gerçek araçta bir kez doğrulandı | Üç ölçüt 🟢 (**DTC'li araç şartı** — bugün yok) · bir sürüm pilot | İki temiz sürüm |
| 13 | `mavi_ai_mechanic_history` | Geçmiş/eğilim yorumu (salt-okunur) | OFF | OFF = yorum yok | — | #12 `default ON` · en az **3 servis geçmişi olan** gerçek araçta yorum doğruluğu elle onaylandı · geçmiş yorumu teşhisi/güveni **değiştirmiyor** (kaynak kilidi) | İki ölçüt 🟢 | #12 ile birlikte |
| 14 | `mavi_ai_mechanic_knowledge` | Bilgi notu (bundled DTC kataloğu + `diagnosticKnowledgeEngine` yorumu) | OFF | OFF = not yok | — | #12 `default ON` · bilgi notunun kaynağı **daima deterministik katalog** (LLM uydurması 0, 100 örnek) · lisans denetimi: gömülü katalog permissive | İki ölçüt 🟢 | #12 ile birlikte |
| 15 | `mavi_ai_operator` | Operatör modu — mevcut katmanları çok adımlı görevde orkestre eder | OFF | OFF = operatör hiç çalışmaz | — | #11 ve #12 `default ON` · operatör alt katmanların kapılarını **BYPASS etmiyor** (kaynak kilidi + 50 görev denetimi) · yarım kalan görev = 0 | İki ölçüt 🟢 · bir sürüm pilot | Alt bayraklar kaldırıldıktan sonra |
| 16 | `mavi_ai_operator_chat` | Operatörün sohbet akışına bağlanması (niyet motoru → görev) | OFF | OFF = sohbet davranışı bayt bayt aynı | — | #15 `default ON` · niyet motoru yanlış görev tetikleme oranı **≤ %1** (200 mesaj) · tetiklenen her görev salt-okunur ya da kanonik kapıdan geçti | İki ölçüt 🟢 | #15 ile birlikte |

> **Sayım notu — F13 raporundaki "12" DÜZELTİLDİ.**
> `aiGatewayFlag.ts` **11 şalter** tanımlar (#6-#16); `mavi.capabilityFabric.enforce`
> ile birlikte **12** eder — F13 raporunun saydığı küme buydu. Ama repoda ayrıca
> `mavi_latency_trace`, `mavi_semantic_endpoint`, `mavi_streaming_response` ve
> `mavi.mediaNextTakeover.enabled` şalterleri de var: **toplam tanımlı Mavi
> şalteri 16'dır** ve bu belge hepsini kapsar.
> F13 raporunun sayımı **eksikti** — algı/telemetri şalterleri sayıma girmemişti.
> Spec F13'ün "≤ 2" kapısı bu 16 üzerinden ölçülür; bu belge o kapıya giden
> tek meşru yolu tanımlar.

---

## 4. SPEC F13 HEDEFİNE GİDEN YOL (≤ 2 bayrak)

Ölçütler karşılandıkça bayraklar şu sırayla düşer:

```
BAŞLANGIÇ: 16 tanımlı şalter

AŞAMA 1 — algı/telemetri (bağımsız, en düşük risk)
   #3 streaming_response · default ON → kaldır                    16 → 15
   #2 semantic_endpoint ·· default ON → kaldır                    15 → 14

AŞAMA 2 — capability zinciri
   #5 fabric.enforce ····· default ON → kaldır                    14 → 13
   #4 mediaNextTakeover ·· maviCore MCX taşıması; bayrak + gölge
                           hat BİRLİKTE kaldırılır                13 → 12

AŞAMA 3 — AI gateway ailesi (zincirleme, ÜSTTEN ALTA)
   #6 gateway ············ default ON (en son kaldırılır)
   #16 → #7 sırayla ······ default ON → alttan üste kaldırılır    12 → 2
   #6 gateway ············ eski sağlayıcı zinciri silinince kaldırılır  2 → 1
                           (izin modelleri KALIR, bayraklar gider)

KALAN: #1 `mavi_latency_trace` — kalıcı gözlem şalteri (kaldırılmaz)
HEDEF: ≤ 2 · ULAŞILAN: 1  ✅ (ölçütlerin TAMAMI gerçek araçta geçerse)
```

⚠️ Bugün bu zincirin **hiçbir adımı** tamamlanmamıştır: 16 şalterin 16'sı
`default OFF` ve hiçbirinin açılma ölçütü gerçek araçta ölçülmemiştir.

**Bu plan bir takvim DEĞİLDİR.** Her adımın önkoşulu gerçek araç ölçümüdür;
ölçüm gelmediği sürece bayrak sayısı **düşmez ve düşürülmeye çalışılmaz**.

---

## 4b. ⚠️ F13/4 DÜZELTMESİ — İKİ UZAK BAYRAĞIN BESLEYİCİSİ YOKTU (2026-08-30)

Bu belge §3.1'de **#2 `mavi_semantic_endpoint`** ve **#3 `mavi_streaming_response`**
için filo çapında rollout ve rollback sözü veriyordu. MAVI-F13/4 denetiminde
ölçüldü ki o söz **kodda karşılıksızdı**: her iki bayrağın uzak değerini
enjekte eden setter tanımlıydı ama **üretimde hiç çağrılmıyordu**. Yani
`mavi_semantic_endpoint` ve `mavi_streaming_response` anahtarları hiçbir dalı
kontrol etmiyordu; yalnız cihaz-yerel `localStorage` kaldıracı çalışıyordu.

Sonuç: §4'teki **AŞAMA 1** (bu iki bayrağı `default ON` yapıp kaldırmak)
uygulanamaz durumdaydı — filo şalteri yoktu.

**Düzeltme (F13/4):** bayraklar SİLİNMEDİ; `mavi_latency_trace` ile birebir aynı
desenle bileşim kökünde (`platformCoreMaviVoiceWiring`) beslendi ve söküm
yolunda kapatıldı. Bilinmeyen anahtar → `getFlag` `false` → varsayılan KAPALI;
cihaz davranışı bayt bayt aynı kaldı.

**Yeni önkoşul (kütük #1039):** bu iki bayrağın `default ON` aşamasına
geçebilmesi için önce **filo şalterinin gerçekten çalıştığı** gerçek bir head
unit'te kanıtlanmalıdır (uzak anahtar `true` → şalter açılıyor; `false` →
kapanıyor). O kanıt alınmadan §3.1'deki açılma ölçütleri ölçülemez.

**Bakım kuralı (yeni):** bu tabloya bir bayrak eklenirken **uzak yarısının
besleyicisi de aynı PR'da bağlanır**. Besleyicisi olmayan bir uzak bayrak,
tabloda satırı olsa bile **var sayılmaz** — bu bir plan değil, hayalettir.

---

## 4c. ⚠️ F13 FINAL — ÜÇÜNCÜ HAYALET (F5) VE KİLİDİN GENELLEŞTİRİLMESİ (2026-08-30)

F13/4'ün düzeltmesi **eksik kaldı** ve bunu F13/4 Final QA ölçtü: aynı kusur
**`setCapabilityFabricEnforceRemoteFlag`te hayatta kaldı**. Sebep, düzeltmenin
kendisiydi: `F13/4-4` kilidi **üç sabit ada** bağlanmıştı, dolayısıyla listeye
eklenmeyen bir setter'ı göremiyordu. *Sabit listeli bir kilit, listeyi
güncellemeyi unutan geliştiriciyi yakalayamaz — yani asıl korunması gereken hâli.*

Ayrıca LAB, F5'i `mavi_capability_fabric_enforce` adıyla AÇIK bayraklar listesine
yazıyordu; oysa o adla hiçbir yerden açılamıyordu (filodan çevrilemeyen bir
filo şalteri adı).

**Düzeltme (F13 final dar fix):**
- F5'e kanonik uzak anahtar sabiti eklendi (`MAVI_F5_ENFORCE_REMOTE_FLAG`,
  değeri LAB'ın zaten bildirdiği dize → etiket ile gerçek aynı anda doğrulanır);
- bileşim kökünde F0/F3/F4 ile **birebir aynı** desenle beslendi ve söküm
  yolunda `false` ile kapatıldı;
- **kilit sabit listeden çıkarıldı**: `voiceRuntimeSeparation.guards`
  §`F13-GHOST` artık sözleşmeyi `src/platform` kaynaklarından TÜRETİR —
  her `export function set<X>RemoteFlag` için üretim besleyicisi **ve** söküm
  yolu arar, anahtarın satır içi dize olmasını yasaklar ve **boş kümede PASS
  VEREMEZ**. Yeni bir setter eklenip bağlanmazsa kilit kırmızıya döner.

**Neden silinmedi de bağlandı:** F5, kullanıcı komutunu gerçekten
ENGELLEYEBİLEN tek Mavi bayrağıdır. Böyle bir kapının geri alma yolu cihaz-yerel
`localStorage` olamaz — §1 her bayrak için "DEFAULT ON (uzak bayrak filoya açık,
**rollback tek şalter**)" ve "İKİ temiz sürüm" aşamalarını şart koşar; satır 5'in
kaldırma şartı da "zorlayıcı kip iki sürüm temiz kaldıktan sonra" der.
Bunların hiçbiri filo şalteri olmadan ölçülemez.

⚠️ **Bu düzeltme F5'i AÇMAZ.** Bilinmeyen uzak anahtar → `getFlag` `false` →
kapı **GÖLGE** kipte kalır (hiçbir eylem engellenmez) ve bugünkü cihaz davranışı
birebir korunur. Açılma ölçütleri §3.1 satır 5'te ve **hiçbiri ölçülmedi**.

---

## 5. BU BELGENİN BAKIM SÖZLEŞMESİ

- Yeni bir Mavi bayrağı eklenirken **aynı PR'da** bu tabloya satır eklenir;
  ölçütsüz bayrak eklemek yasaktır (spec §28.4).
- Bir bayrak `default ON` yapıldığında satırına **tarih + kütük kanıtı** yazılır.
- Bir bayrak kaldırıldığında satır **silinmez**, "KALDIRILDI (tarih)" olarak
  işaretlenir — hangi ölçütle kapandığı kayıtta kalır.
- Bu belge saha durumunun otoritesi **değildir**; çelişki hâlinde
  `docs/DEVICE_VALIDATION_LEDGER.md` kazanır.
