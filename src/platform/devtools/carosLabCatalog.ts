/**
 * carosLabCatalog.ts — CAROS LAB araç kataloğu (SAF · React'siz · tek kaynak).
 *
 * FAZ A / DEVELOPER FIRST (docs/CAROS_LAB_DEVELOPER_PLATFORM_STRATEGY.md): geliştirici
 * araçları tek çatı altında toplanır. Bu dosya YALNIZ katalogdur — hiçbir servis
 * başlatmaz, hiçbir şey import etmez (platform-saf, yan etkisiz, monomorfik sabitler).
 *
 * DURUM DOĞRULUĞU (görev §E — pazarlıksız):
 *  - AVAILABLE   : ekran GERÇEKTEN var, açılıyor ve güvenli. (Ekran içinde ayrıca
 *                  FOUNDATION_ONLY / NOT_WIRED alt-durumu gösterilebilir.)
 *  - PLACEHOLDER : henüz ekranı YOK. "Yakında/çalışıyor" gibi belirsiz ifade YASAK —
 *                  kart neyin eksik olduğunu açıkça yazar.
 *  - DISABLED    : ekran teknik olarak mümkün olsa bile GÜVENLİK POLİTİKASI gereği
 *                  kapalı (ECU write / ham komut / stres). Karta basmak İŞLEM ÇALIŞTIRMAZ.
 *
 * Route adları type-safe: `CarosLabToolId` union → yeni paralel router YOK, tek host
 * bileşeni bu id'yi çözer (CarosLabToolHost).
 */

/* ── Kategoriler ─────────────────────────────────────────────────────────── */

export type CarosLabCategory = 'vehicle' | 'communication' | 'runtime' | 'ai' | 'developer';

export const CAROS_LAB_CATEGORIES: readonly CarosLabCategory[] = [
  'vehicle', 'communication', 'runtime', 'ai', 'developer',
] as const;

export const CAROS_LAB_CATEGORY_LABEL: Readonly<Record<CarosLabCategory, string>> = {
  vehicle:       'Araç',
  communication: 'İletişim',
  runtime:       'Çalışma Zamanı',
  ai:            'Yapay Zekâ',
  developer:     'Geliştirici',
} as const;

/* ── Durum ───────────────────────────────────────────────────────────────── */

export type CarosLabToolStatus = 'AVAILABLE' | 'PLACEHOLDER' | 'DISABLED';

/**
 * Durumun EKRANDA görünen Türkçe karşılığı.
 *
 * Enum DEĞERİ (`AVAILABLE`…) makine sözleşmesidir — `data-status` özniteliğinde ve
 * testlerde AYNEN kalır; kullanıcı yalnız Türkçe etiketi görür. Böylece dil değişimi
 * dürüstlük kilitlerini (sahte "çalışıyor" yasağı) zayıflatmaz.
 */
export const CAROS_LAB_STATUS_LABEL: Readonly<Record<CarosLabToolStatus, string>> = {
  AVAILABLE:   'HAZIR',
  PLACEHOLDER: 'EKRAN YOK',
  DISABLED:    'KAPALI',
} as const;

/* ── Araç kaydı ──────────────────────────────────────────────────────────── */

export type CarosLabToolId =
  // Vehicle
  | 'live-data' | 'pid-did-explorer' | 'signal-authority' | 'fleet-kb' | 'service-routines'
  | 'fleet-connectivity' | 'trip-engine' | 'trip-cost'
  | 'location-engine' | 'navigation-core' | 'map-data-platform'
  | 'address-search-evidence' | 'enforcement-points'
  | 'discovery-capability' | 'capability-learning' | 'gap-resolver'
  | 'early-vehicle-identity'
  | 'ecu-endpoint-inventory'
  | 'multi-ecu-dtc-coverage'
  | 'remote-command'
  | 'fleet-identity' | 'fleet-driver-identity' | 'fleet-presence-history'
  | 'fleet-driver-authentication' | 'fleet-driver-dna' | 'fleet-intelligence' | 'ai-evidence-engine'
  | 'deep-scan' | 'vehicle-fingerprint' | 'prediction-engine' | 'signal-provenance'
  | 'obd-data-bridge'
  | 'mode06-monitors'
  | 'dtc-coverage'
  | 'ecu-capability'
  | 'dtc-clear-evidence'
  | 'pid-discovery'
  | 'dtc-authority'
  | 'ecu-inventory'
  | 'oem-ecu-profiles'
  | 'vehicle-identity-vin'
  | 'device-identity'
  // Communication
  | 'raw-obd-traffic' | 'can-monitor' | 'kwp-monitor' | 'uds-explorer'
  | 'session-inspector' | 'phone-hub-probe' | 'phone-hub-field-validation' | 'phone-hub-link'
  | 'adapter-diagnostics'
  | 'obd-signal-health'
  | 'vdk-replay'
  // Runtime
  | 'queue-monitor' | 'poll-scheduler' | 'recovery-monitor' | 'evidence-viewer'
  | 'performance' | 'capability-gates' | 'media-authority' | 'guardian-runtime' | 'theme-runtime'
  | 'runtime-mode'
  | 'runtime-authority-map'
  | 'security-trust-capability'
  | 'performance-profiler'
  | 'runtime-lifecycle-contract'
  | 'runtime-service-registry'
  | 'native-boundary-hal'
  | 'background-power'
  | 'route-layer-inspector'
  // AI
  | 'mavi-console' | 'mavi-reasoning-engine' | 'ai-mechanic' | 'action-registry'
  | 'stt-mic' | 'tool-calling' | 'memory-explorer' | 'knowledge-explorer'
  | 'mavi-latency' | 'capability-fabric'
  // Developer
  | 'decoder-registry' | 'discovery-database' | 'raw-command-console' | 'replay-log' | 'pid-timing-experiment'
  | 'cddl-inventory'
  | 'profile-candidates'
  | 'benchmark' | 'stress-test' | 'long-road-field-validation';

export interface CarosLabTool {
  readonly id:       CarosLabToolId;
  readonly category: CarosLabCategory;
  /** Teknik ad — sadeleştirilmez (FAZ A: teknik isim serbest). */
  readonly name:     string;
  /** Kısa teknik açıklama — ne okur / neye bakar. */
  readonly desc:     string;
  readonly status:   CarosLabToolStatus;
  /** Protokol / katman etiketi (varsa) — ör. 'ELM327', 'KWP2000', 'UDS'. */
  readonly layer:    string | null;
  /**
   * PLACEHOLDER → neyin eksik olduğu; DISABLED → neden kapalı olduğu.
   * AVAILABLE → null (ekran içi alt-durum ekranın kendi sorumluluğu).
   */
  readonly note:     string | null;
}

/* Sıra = ekranda görünen sıra. Tüm alanlar aynı sırada yazılır (V8 hidden-class
   kararlılığı — CLAUDE.md §V8 Template Object Literals). */
export const CAROS_LAB_TOOLS: readonly CarosLabTool[] = Object.freeze([
  /* ── Vehicle ─────────────────────────────────────────────────────────── */
  {
    id: 'live-data', category: 'vehicle', name: 'Canlı Veri',
    desc: 'Tüm Mode-01 PID + marka DID canlı akışı; ham hex, yorumlanmış değer, tazelik ve durum.',
    status: 'AVAILABLE', layer: 'OBD-II / Mode 01',
    note: null,
  },
  {
    id: 'pid-did-explorer', category: 'vehicle', name: 'PID/DID Gezgini',
    desc: 'Salt-okunur PID/DID keşif koordinatörü: aday tarama, doğrulanan/şüpheli/reddedilen sayaçları.',
    status: 'AVAILABLE', layer: 'Mode 22 / DID',
    note: null,
  },
  {
    id: 'signal-authority', category: 'vehicle', name: 'Sinyal Otoritesi',
    desc: 'signalHub zarfları: değer + durum (geçerli/bayat/şüpheli/veri yok/desteklenmiyor) + tazelik + güven + kaynak.',
    status: 'AVAILABLE', layer: 'signalHub / SignalEnvelope',
    note: null,
  },
  {
    id: 'fleet-kb', category: 'vehicle', name: 'Filo Hafızası',
    desc: 'Araçtan öğrenilen ECU topolojisi profilleri: kimlik kaynağı, gözlem sayısı, güven, UDS kabiliyeti.',
    status: 'AVAILABLE', layer: 'fleetKb / öğrenme',
    note: null,
  },
  {
    id: 'service-routines', category: 'vehicle', name: 'Servis Fonksiyonları Kapısı',
    desc: 'DPF rejenerasyon / servis reset / gaz kelebeği adaptasyonu ÖNKOŞULLARI — salt gözlem, rutin çalıştırmaz.',
    status: 'AVAILABLE', layer: 'UDS 0x31 / WriteGate',
    note: null,
  },
  {
    id: 'fleet-connectivity', category: 'vehicle', name: 'Fleet Connectivity',
    desc: 'Head unit → Fleet backend bağlantı zincirinin salt-okunur gözlemi: tek eşleştirme otoritesi · kapatılan ölü yollar (410) · telemetri sözleşmesi (bulunan/reddedilen alanlar, OBD/GPS bayatlık atlama gerekçesi, gözlem yaşları) · "bilinmeyen ASLA 0 değil" kapısı · maskeli araç kimliği ve sunucu güveni.',
    status: 'AVAILABLE', layer: null,
    note: 'Hiçbir şey BAŞLATMAZ: eşleştirme, kod üretme/yenileme, telemetri push, kimlik bildirimi, OBD sorgusu, GPS düzeltmesi, ağ çağrısı ve kuyruk müdahalesi YOK. api_key değeri, ham 6 haneli kod, JWT, TAM VIN, TAM UUID ve GPS koordinatı GÖSTERİLMEZ — yalnız VAR/YOK, ADET, DURUM ve ZAMAN FARKI. Bilinmeyen alan UNAVAILABLE; sahte 0 / sahte "sağlıklı" üretilmez.',
  },
  {
    id: 'trip-engine', category: 'vehicle', name: 'Trip Engine',
    desc: 'Yolculuk motorunun salt-okunur gozlemi: aktif trip durumu ve canli mesafe/sure - yukleme kuyrugu (kuyrukta/yuklendi/tekrar/retry/basarisiz) - revizyon defteri (istemci vs sunucu revizyonu, deneme sayisi) - yerel istatistik. Tahmin edilmis metrikler "(tahmini)" etiketiyle gosterilir.',
    status: 'AVAILABLE', layer: null,
    note: 'Hicbir sey BASLATMAZ: trip baslatma/durdurma, trip silme, yukleme tetikleme/zorlama, kuyruk bosaltma, retry zorlama ve ag cagrisi YOK. Rota/koordinat GOSTERILMEZ (trip modeli zaten tasimaz). DURUSTLUK: head unit yakiti 8,5 L/100km sabiti ve maliyeti sabit birim fiyatla TAHMIN eder - bunlar olcum DEGILDIR ve "(tahmini)" olarak etiketlenir. Bilinmeyen metrik "Veri yok"; sahte 0 uretilmez. Dedupe (tekrar) bir HATA degildir - ayni yolculuk iki kez sayilmasin diye sunucu ikinci gonderimi reddeder.',
  },
  {
    id: 'trip-cost', category: 'vehicle', name: 'Trip Cost',
    desc: 'Rota → plan → maliyet raporu zincirinin salt-okunur gözlemi: aktif rotanın mesafe/süresi (fiyattan bağımsız okunur) · rota modelinde OLMAYAN alanların (başlangıç · hedef · gece sayısı · yolcu · araç profili) beyan edilip edilmediği · plan üretildi mi, üretilmediyse hangi beyanın engellediği · dört kategori kapısının (yakıt · ücretli geçiş · konaklama · otopark) neden açıldığı/açılmadığı · rapordaki dürüst alt sınır, toplama giren ve BİLİNMEYEN kalemler.',
    status: 'AVAILABLE', layer: null,
    note: 'Hiçbir şey BAŞLATMAZ: rota isteme, hedef seçme/değiştirme, plan kaydetme, fiyat sorgulama, kullanıcı beyanı yazma ve ağ çağrısı YOK. HEDEF ADI, BAŞLANGIÇ ADI, ADRES VE ROTA GEOMETRİSİ TAŞINMAZ (Navigation Core ile aynı karar) — hedef yalnız VAR/YOK. FİYAT KAYNAKLARI HENÜZ BAĞLI DEĞİL (TRIP-COST P2–P5): kaynağı olmayan kalem 0 YAZMAZ, "BİLİNMİYOR" der ve toplama girmez; üst sınır UYDURULMAZ. İKİ FARKLI "YOK" AYRI GÖSTERİLİR: kategori HİÇ AÇILMADI (plan girdisi beyan edilmedi — varsayılan atanmaz, "1 yolcu" varsayımı da uydurmadır) ile kategori AÇIK ama değer BİLİNMİYOR aynı şey DEĞİLDİR. Rota ücretli geçiş içerip tarife verisi yoksa bu ayrıca işaretlenir — sessiz "ücretli geçiş yok" YALANI üretilmez. Gerçek araç doğrulaması YAPILMADI (kütük #510).',
  },
  {
    id: 'location-engine', category: 'vehicle', name: 'Location Engine',
    desc: 'Çok kaynaklı konum motorunun salt-okunur gözlemi: aktif sağlayıcı ve önceliği · konum durumu (LIVE·STALE·LAST_KNOWN·OFFLINE·UNKNOWN) · güven (tek fix ASLA yüksek değil) · hassasiyet sınıfı · fix yaşı ve süreklilik zinciri · geçiş/fallback sayaçları ve geçiş kapısı gerekçesi · sağlayıcı öncelik tablosu ve hata sayaçları.',
    status: 'AVAILABLE', layer: 'GNSS',
    note: 'Hiçbir şey BAŞLATMAZ ve mevcut GPS akışına DOKUNMAZ: gpsService yalnız GÖZLENİR — başlatma/durdurma, yeni fix isteme, watchPosition açma, sağlayıcı kaydı, kaynak geçişi zorlama ve ağ çağrısı YOK. KOORDİNAT (enlem/boylam) GÖSTERİLMEZ — konum kişisel veridir. Bilinmeyen alan UNAVAILABLE; tek fix yüksek güven SAYILMAZ; son bilinen konum ASLA canlı sunulmaz. Harici GPS/Phone Hub taşıması bu pakete DAHİL DEĞİL — kayıtlı değilse HAZIR görünmez.',
  },
  {
    id: 'navigation-core', category: 'vehicle', name: 'Navigation Core',
    desc: 'Navigasyon çekirdeğinin salt-okunur gözlemi: navigasyon durumu · rota sağlayıcı ve hazırlığı (yerel OSRM tek yoklama) · map matching durumu/güveni/dik mesafesi ve koridoru · sapma durum makinesi (kanıt/gereken, uyarlanabilir pencere) · yeniden rota istek yaşam döngüsü (aktif kimlik, iptal edilen, reddedilen bayat yanıt, bastırılan tekrar) ve gecikme ayrıştırması (sapma→istek→yanıt→uygulandı→ilk talimat) · rota doğrulama kapısı denetim tablosu · manevra mesafesi yöntemi (yol-boyu vs kuş uçuşu) ve çapa çözünürlüğü · şerit/dönel kavşak dürüstlük sayaçları · NAV v3 L2 ego (EKF modu, 1σ belirsizlik, kabul/red edilen GNSS ölçümü, yol-ağı aday sonucu) · jiro işaret öğrenme (kabul/red kapıları, öğrenilen işaret, sapma hızı) · L3 CEH ufuk hükmü (MPP/belirsizlik, fiziksel doğrulama, ufuk nesnesi ve bütçesi) · F5 gölge karşılaştırma + cutover kapısı (legacy ↔ CEH farkı, kapı şartları) · F6 sınırlı koridor genişleme + kenar-tabanlı denetim noktası eşleştirme sayaçları (MATCHED/AMBIGUOUS/kapsam dışı/ölçülmedi dağılımı, port sıcak-yol maliyeti).',
    status: 'AVAILABLE', layer: 'GNSS / OSRM',
    note: 'Hiçbir şey BAŞLATMAZ: navigasyon başlatma/durdurma, hedef seçme, rota isteği, reroute zorlama, sağlayıcı değiştirme, alternatif seçme ve ağ çağrısı YOK. ENLEM/BOYLAM GÖSTERİLMEZ — konum kişisel veridir (Location Engine ile aynı karar); ham fix yalnız VAR/YOK + yaş, oturtulmuş konum yalnız VAR/YOK + rotaya dik mesafe olarak görünür. Hedef adı, adres ve rota geometrisi TAŞINMAZ. KAPSAM SINIRI: L4 rota ilerlemesi hâlâ ROTA-GÖRELİDİR — "koridor dışı" aracın hangi yolda olduğunu SÖYLEMEZ. F4 turunda AYRI bir yol-ağı eşleştirmesi (L2 HMM) açıldı: RTG2 grafı artık ana iş parçacığında da çözülüyor ve kenar/topoloji gerçeği okunabiliyor; ikisi FARKLI soruları yanıtlar ve karıştırılmaz. Yol-ağı eşleşmesinin saha doğruluğu HENÜZ ÖLÇÜLMEDİ (kütük #1232-#1243). Trafik verisi yoktur. Bilinmeyen alan UNAVAILABLE; sahte 0 / sahte "sağlıklı" üretilmez. NAV v3 KAPSAM SINIRI (F3): L3 CEH ufku bugün YALNIZ rota NİYETİNDEN beslenir ve fiziksel olarak DOĞRULANMAZ — aktif rota aracın o yolda olduğunu KANITLAMAZ; yol-ağı eşleşmesi üretimde yoktur (F1/B2: RTG2 okuyucusu worker içinde). Ufuk öznitelik portu F6\'da YALNIZ denetim noktası (`ENFORCEMENT`) için bağlandı — hız limiti/viraj/eğim kaynağı bu binary\'de YOKTUR ve BAĞLANMADI, boş nesne listesi bu üç alanda hâlâ "ölçülmedi" demektir. CEH F6 sonrasında da yalnız GÖLGEDİR: Guardian/sesli yönlendirme üretim kararı legacy\'de KALIR, cutover kapısı dört alanın DÖRDÜ de bağlanmadan (ve F4 saha kanıtı gelmeden) açılmaz. Jiro sapma hızı işaret kanıtlanana kadar YAYINLANMAZ (yanlış yön öğretmektense susulur). Bu kart komut GÖNDERMEZ ve kendi hükmünü ÜRETMEZ; kanonik otoritelerin hükmünü gösterir. Gerçek araç doğrulaması YAPILMADI (FIX_PENDING_REAL_VEHICLE_RETEST · kütük #1220-#1231, #1232-#1251, #1252+).',
  },
  {
    id: 'map-data-platform', category: 'vehicle', name: 'Harita Veri Platformu',
    desc: 'L1 MapStore’un ALTINDAKİ veri üretim/normalizasyon katmanının salt-okunur gözlemi: tanımlı kaynak sözlüğü (OSM · OpenFreeMap · Overture · TUCBS · belediye · lisanslı sağlayıcı · saha gözlemi · türetilmiş) · her kaynağın lisans politikası ve DÖRT kullanım niyeti için GERÇEKTEN çalıştırılmış kapı hükmü (ölçüm · çevrimiçi · offline paketleme · türev dağıtım) · share-alike ve atıf yükümlülüğü · tanınan SPDX etiketleri · kaynak başına tazelik bütçesi · fusion ağırlıkları (tazelik/mutabakat/kalite/yetki önseli) ve bina eşleştirme politikası (merkez mesafesi · alan oranı · içerme şartı) · PotentialBuildingGap toplamı/kaynağı/reason/kanıt sınıfı/güven/release/tazelik/mesafe/overlap/lisans özeti · adres/yer/canlı-koşul portlarına sağlayıcı BAĞLI MI ve bağlı değilse ÖLÇÜLMÜŞ gerekçesi · canlı yol koşulu tazelik bütçeleri.',
    status: 'AVAILABLE', layer: 'mapdata (saf sözleşme katmanı)',
    note: 'Hiçbir şey BAŞLATMAZ: sağlayıcı bağlama/çözme, veri kümesi indirme, ağ çağrısı, lisans kabulü, fusion çalıştırma, timer/polling/abonelik YOK — yalnız senkron kod sabitleri ve çağıranın verdiği mevcut gap çıktısı okunur. GAP EVIDENCE ≠ MAP TRUTH: PotentialBuildingGap BUILDING değildir; publishable daima FALSE’tur, MapStore’a yazamaz, resolver/renderer/routing/CEH davranışını değiştiremez. Gap evidence akışı bağlı değilse toplam 0 UYDURULMAZ, UNKNOWN gösterilir. ÇALIŞMA ZAMANI HARİTA GERÇEĞİ BURADA DEĞİLDİR: karo/graf/POI durumu NAV v3 L1 MapStore’un sahipliğindedir ve Navigation Core ekranında gözlenir; burada İKİNCİ bir harita gerçeği yüzeyi kurulmaz. İKİNCİ OTORİTE DEĞİL: hak, eşik ve politika değerleri kanonik modüllerden (mapDataLicense · mapDataResolution · buildingResolver · BuildingGapDetector) AYNEN okunur; ekranda hesaplanan hiçbir değer üretim kararına geri beslenmez. BUGÜNKÜ DURUM: adres, yer, canlı-koşul ve gap evidence akışları BAĞLI DEĞİLDİR — bu bir arıza değil, sözleşme fazının doğru hâlidir ve ekran bunu böyle söyler; "bağlı sağlayıcı" olması da veri KAPSAMI olduğu anlamına gelmez. Lisans kapısı sabit metin değildir, her açılışta evaluateLicenseGate ile GERÇEKTEN çalıştırılır ve UNKNOWN hak fail-closed RED üretir. GİZLİLİK: koordinat, adres, sorgu metni ve kullanıcı verisi bu ekrana GELMEZ. Ölçüm kaynağı: field-runs/map-data-coverage-20260907 · field-runs/mapdata-shootout-20260907 · field-runs/mapdata-source-benchmark-20260907. Gerçek cihazda ekran yerleşimi henüz doğrulanmadı (kütük #1320/#1323).',
  },
  {
    id: 'ecu-endpoint-inventory', category: 'vehicle', name: 'ECU Uç Noktaları ve Rol Kanıtı',
    desc: 'Tanı uç noktalarının ve rol çözümünün salt-okunur kanıt defteri: ölçülmüş uç nokta sayısı (cevap veren adres) · kimliklenen ECU sayısı · rolü BİLİNMEYEN uç nokta sayısı · rol çelişkisi sayısı · harcanan kimlik isteği ve uç nokta tavanı · aktif protokol ve adresleme ailesi · genel PDU köprüsünün varlığı · ISO 15765-4 standart fiziksel yoklama adedi ve bütçe nedeniyle sorulmayan adres · CDDL varyant deseni eşleşme sonucu (TEK · BELİRSİZ · EŞLEŞME YOK) · uç nokta başına ulaşılabilirlik, keşif kaynağı, adresleme, rol, GÜVEN SINIFI (KANITLI · GÜÇLÜ · ADAY · BİLİNMİYOR · ÇELİŞKİ), kanıt türleri, kimlik DID okuma adedi, ölçülen servis adedi, öğrenmeden gelip gelmediği ve rol yükselmediyse GEREKÇESİ · rol deposunun araç kapsamı, sağlığı, yetenek deposuyla PARİTESİ, öğrenilmiş rol adedi ve engellenen yazım sayısı.',
    status: 'AVAILABLE', layer: 'UDS 0x22 / CDDL / generic PDU',
    note: 'Hiçbir şey BAŞLATMAZ: keşif koşturma, kimlik çözme, PDU gönderme, araç bağlamı aktive etme, depoya yazma, timer ve ağ çağrısı YOK — yalnız mevcut kanıt defteri okunur. TEMEL AYRIM: ADRES BULMAK, ROL BİLMEK DEĞİLDİR. Uç nokta keşfi ile rol çözümü AYRI iki kavramdır ve rol adresten TÜRETİLMEZ; 7E1 = şanzıman gibi genellemeler YOKTUR. Rolü çözülemeyen uç nokta ÇÖPE ATILMAZ: envanterde BİLİNMİYOR olarak kalır, keşfe ve yetenek çizgesine girebilir, kimlik yoklaması alabilir — ama rol-özel hiçbir servis/prosedür çalıştıramaz. KÖR TARAMA YOK: aday adres uzayı adresleme ailesine göre KAPALIDIR — CAN11 yalnız ISO 15765-4 fiziksel çifti (7E0..7E7, standardın metni), CAN29 ve KWP icin standart aday uzayı TANIMSIZDIR ve uç nokta yalnız ÖLÇÜLMÜŞ responder/kaynak adresinden doğar; 0x000-0x7FF ya da 0x00-0xFF süpürmesi YAPILMAZ; OEM sihirli adres tablosu YOKTUR. GÜVENLİK: uç noktaya yalnız rol-bağımsız SALT-OKUNUR kimlik DID okumaları (ISO 14229-1 F197 · F18C · F191 · F187 — hepsi bu repoda ZATEN tanımlı) gönderilir; kodlama, adaptasyon, rutin, aktüatör, reset, silme ve SecurityAccess (0x27) bu yoldan AÇILAMAZ ve F4-A native DiagnosticServiceGate ayrıca/bağımsız son kapıdır. GÜVEN DÜRÜSTLÜĞÜ: yetenek/davranış benzerliği tek başına rol KANITI SAYILMAZ ve ADAY seviyesini GEÇEMEZ; iki güçlü kanıt farklı rol söylerse ÇELİŞKİ yazılır ve rol YÜKSELTİLMEZ (ilki seçilmez); birden çok CDDL varyant deseni tutarsa BELİRSİZ olur ve hiçbiri seçilmez. ÖLÇÜM KAYBI kanıtlanmış rolü DÜŞÜRMEZ (timeout PROVEN rolü ezmez), ama BİLİNMİYOR bir sonraki turda KANITLI olabilir. GİZLİLİK: ham seri, parça ve donanım numarası bu ekrana TAŞINMAZ ve hiçbir kalıcı yüzeye YAZILMAZ — yoklama satırında yalnız gövde uzunluğu görünür; kanonik izde ham yanıt null ve maskeleme REDACTED taşınır. ARAÇ İZOLASYONU: rol öğrenmesi araca göre BÖLÜMLENMİŞTİR (caros-ecu-roles-v1:<parmakizi>) ve anahtarı ECU PARMAK İZİDİR, adres değil — bir araçta öğrenilen rol başka bir aracın aynı CAN kimliğine UYGULANAMAZ; yalnız CANLI kanıt ürün rolü doğrular, replay/sentetik DOĞRULAMAZ. AĞ GEÇİDİ: topoloji bu turda ÖLÇÜLEMEZ; gateway bypass YOKTUR ve ULAŞILABİLİRLİK yalnız DOĞRUDAN ya da BİLİNMİYOR değerini alır — "uç nokta bulunamadı" ASLA "araçta o ECU yok" DEMEK DEĞİLDİR. Hiç ölçüm yoksa sayaçlar 0 DEĞİL KAYNAK YOK gösterir. Gerçek araç doğrulaması YAPILMADI.',
  },
  {
    id: 'multi-ecu-dtc-coverage', category: 'vehicle', name: 'Çoklu-ECU DTC Kapsamı',
    desc: 'ÖLÇÜLMÜŞ her tanı uç noktası için salt-okunur DTC kapsamının kanıt defteri: ölçülen uç nokta · DTC sorgusu GİDEN uç nokta · TAM/KISMİ/BİLİNMEYEN/ERTELENEN/ENGELLİ/ADRESLENEMEYEN dağılımı · rolü BİLİNMEYEN ama yine de sorgulanan uç nokta sayısı · toplam istek ve ürüne ulaşan DTC satırı · öğrenilmiş yetenekle atlanan sınıf · aktif protokol ve araç bölümü · uç nokta başına protokol, rol ve rol kanıtı, adreslenebilirlik, istek/DTC sayısı, on bir kapsam sınıfının (Mode 03/07/0A · UDS 19-01/02/03/04/06/0A · KWP 18/13) tek tek sonucu ve sorulmama gerekçesi · 19-02 status maskesinin ÖLÇÜLDÜĞÜ mü VARSAYILDIĞI mi · ECU’nun 19-01’de BEYAN ettiği kayıt sayısı ile çözülen sayının karşılaştırması · snapshot referans adedi · ham genişletilmiş verinin VAR/YOK’u · alt kod ve status baytı KORUNMUŞ kayıt sayısı · oturum/koşul isteyen okuma adedi · kapı/köprü ENGELLİ sınıflar · mevcut RAW→PARSER→AUTHORITY→UI sayım zinciri ve kayıp aşaması.',
    status: 'AVAILABLE', layer: 'UDS 0x19 / KWP 0x18-0x13 / Mode 03-07-0A',
    note: 'Hiçbir şey BAŞLATMAZ: tarama koşturma, PDU gönderme, self-healing tetikleme, depoya yazma, timer ve ağ çağrısı YOK — yalnız mevcut kanıt defteri okunur. TEMEL AYRIM: ECU BULUNDU ≠ SERVİS DESTEKLENİYOR ≠ DTC YOK ≠ ARAÇ TEMİZ. Sorulmayan servis TAM DEĞİLDİR; NO_RESPONSE "DTC yok" DEĞİLDİR; parser düşmesi "ECU temiz" DEĞİLDİR; kapı/köprü sınırı (ENGELLİ) ARACIN kararı DEĞİLDİR. ROL TABLOSU YOK: plan "ABS ise şunu gönder" gibi bir dal İÇERMEZ; protokol ailesi, adreslenebilirlik, taşıma yeteneği, CDDL servis tanımı ve native salt-okunur alt fonksiyon kümesinden TÜRER — rolü BİLİNMEYEN uç nokta, rolü kanıtlanmış uç noktayla BİREBİR aynı planı alır ve envanterden ATILMAZ. KÖR SÜPÜRME YOK: 0x19-06 yalnız ÖLÇÜLMÜŞ bir DTC kaydı için ve ECU başına TAVANLI gönderilir (tavan üstü SESSİZCE atılmaz, ERTELENMİŞ sayılır); snapshot kayıt numarası süpürülmez; 0x19-04 native DiagnosticServiceGate salt-okunur alt fonksiyon kümesinde OLMADIĞI için hattan HİÇ çıkmaz ve durum ENGELLİ yazılır (kapı ZORLANMAZ). BÜTÇE: her istek F1-A `consumeRequest` tek kapısından geçer; ikinci bütçe/zamanlayıcı/muhasebe motoru KURULMADI. GÜVENLİK: bu yoldan 04 clear · 14 · 10 oturum · 27 SecurityAccess · 2E · 2F · 31 rutin · 3E · 11 reset · 34/35/36/37 · 85 ÜRETİLEMEZ; ECU okuma için oturum/güvenlik isterse durum kanıtlanır, kapı zorlanmaz. GİZLİLİK: ham OEM gövdesi, ham DTC baytı, DTC KODU, VIN ve adaptör kimliği bu ekrana TAŞINMAZ — yalnız sayılar, kapalı sözlükten sınıflar ve uç nokta adresi. ANLAM UYDURULMAZ: 0x19-06 gövdesinin şeması OEM’e özgüdür; yalnız "ham genişletilmiş veri MEVCUT" kanıtı üretilir, bayta anlam verilmez. ARAÇ İZOLASYONU: kapsam defteri OTURUM MÜHÜRLÜDÜR — yeni oturumda eski araç kapsamı DÜŞER. Hiç ölçüm yoksa sayılar 0 DEĞİL KAYNAK YOK gösterir. Gerçek araç doğrulaması YAPILMADI.',
  },
  {
    id: 'early-vehicle-identity', category: 'vehicle', name: 'Erken Araç Kimliği',
    desc: 'Tam araç taramasından ÖNCE, bağlantı sonrası ölçülen araç kimliğinin salt-okunur kanıt defteri: turun değerlendirilip değerlendirilmediği · admisyon kararı ve gerekçesi · genel PDU köprüsünün varlığı · ölçülmüş protokol ve sınıfı · hedef ECU (tx→rx) · aday kimlik DID sırası ve her yoklamanın sonucu (ÖLÇÜLDÜ · 7F-11 YOK · oturum gerekir · koşullu · köprü taşımadı · deterministik değil) · NRC · gecikme · yanıt gövdesinin UZUNLUĞU (içerik DEĞİL) · kalibrasyon karmasının ölçülüp ölçülmediği ve kimliği üreten DID · kimliğin AYRIM GÜCÜ (örnek/varyant) · F4-C ölçülen eksenleri, güveni ve yeniden kullanılabilirliği · araç bağlamı aktivasyonu, kapsam durumu ve bölüm paritesi · tam tarama beklenmeden hydrate edilen boşluk/yetenek sayısı · erken kimlik ile tam tarama kimliğinin uzlaştırma sonucu (AYNI · AYNI ARAÇ · ÇELİŞKİ · KANITSIZ) ve kalıcılığın dondurulup dondurulmadığı.',
    status: 'AVAILABLE', layer: 'UDS 0x22 / CDDL / generic PDU',
    note: 'Hiçbir şey BAŞLATMAZ: kimlik turu koşturma, ECU keşfi, PDU gönderme, araç bağlamı aktive etme, depoya yazma, timer ve ağ çağrısı YOK — yalnız mevcut kanıt defteri okunur. DÖRT "YOK" AYRI: KAYNAK YOK (hiç değerlendirilmedi) ≠ DENENMEDİ (yapısal ön koşul yok, hatta bayt çıkmadı) ≠ BAŞARISIZ (denendi, deterministik sonuç yok) ≠ BAŞARILI. GİZLİLİK: ham kalibrasyon/seri/parça numarası ve VIN bu ekrana TAŞINMAZ ve hiçbir kalıcı yüzeye (bölüm · katalog · sicil · kanonik iz export) YAZILMAZ — yalnız mevcut `fingerprintHash` primitifiyle üretilmiş geri döndürülemez karma taşınır; yoklama satırında yanıt gövdesinin yalnız HEX HANE SAYISI görünür. GÜVENLİK: en çok ÜÇ salt-okunur UDS 0x22 isteği gönderilir; `10 xx` oturum komutu, `3E` keepalive, SecurityAccess (0x27) ve destructive hiçbir servis YOKTUR — F4-A native DiagnosticServiceGate ayrıca ve bağımsız olarak son kapıdır. KÖR TARAMA YOK: aday DID listesi ISO 14229-1 standardıdır ve üçü de bu repoda ZATEN tanımlıdır (F18C · F191 · F187); sihirli OEM DID/adres uydurulmaz, hedef ECU mevcut keşfin ölçtüğü ECU olarak alınır. KARARLILIK: yalnız ECU tarafından dönen `7F .. 11` beyanı bir sonraki adaya geçirir — sessizlik/zaman aşımı turu bitirir, çünkü aksi hâlde aynı araç her açılışta başka bir DID ile kimliklenip başka bir kalıcı bölüm açardı. KAPSAM SINIRI: yol YALNIZ CAN/UDS içindir — KWP/ISO kimlik LID tanımı repoda YOKTUR ve uydurulmaz (o araçlarda tur ENGELLİ biter, açık borç). AYRIM GÜCÜ DÜRÜSTLÜĞÜ: F191/F187 varyant seviyesidir; aynı model iki araç bu değerlerde AYNI olabilir (filo riski — kütükte açık borç). UZLAŞTIRMA: erken kimlik ile tam tarama kimliği YAPISAL OLARAK farklı ID üretir (erken turda yanıt imzası ölçülmemiştir); birleştirme YALNIZ aynı ECU üzerinde aynı DID aynı karmayı verdiğinde yapılır — protokol/adres/PID bitmap benzerliği birleştirme kanıtı SAYILMAZ; çelişkide kalıcılık DONDURULUR ve kanıtsız migration YAPILMAZ. Gerçek araç doğrulaması YAPILMADI.',
  },
  {
    id: 'capability-learning', category: 'vehicle', name: 'Araç Öğrenmesi / Yetenek Çizgesi',
    desc: 'Keşfin ölçtüğü yeteneklerin araç/ECU parmak iziyle bağlanmış, YEREL ve sürümlü öğrenme belleği: depo sağlığı (boş · geçerli · BOZUK · ŞEMA UYUŞMADI · erişilemedi) ve şema sürümü · öğrenilmiş araç/ECU/yetenek sayısı · ÜRÜN-GÜVENİLİR (canlı) ile güvenilmez (replay/sentetik) ayrımı · bayat kayıt · çözülmemiş çelişkiler (VAR↔YOK geçişleri ve kotaya kalan ölçüm) · öğrenme sayesinde ATLANAN yoklama ve TASARRUF EDİLEN istek sayısı · kenar başına varlık sınıfı, kaynak künyesi ve gözlem adedi.',
    status: 'AVAILABLE', layer: 'capability graph (yerel)',
    note: 'Hiçbir şey BAŞLATMAZ: keşif koşturma, PDU gönderme, depoya yazma/silme, timer ve ağ çağrısı YOK — yalnız mevcut bellek okunur. YALNIZ YEREL: Supabase/FleetKB/bulut yazımı YOKTUR (Cloud FleetMemory bu turun DIŞINDA). GİZLİLİK: ham VIN/MAC depoya GİRMEZ; kimlikler geri döndürülemez karmalardır ve mevcut `fingerprintHash` primitifi kullanılır (yeni anahtar sistemi kurulmadı). DÜRÜSTLÜK: yalnız CANLI araç kanıtı ürün öğrenmesi üretir — replay/sentetik/içe aktarılmış veri yeniden kullanıma AÇILMAZ; UNKNOWN ölçüm kanıtlı PRESENT/ABSENT sonucu EZEMEZ; PRESENT→ABSENT dönüşü tek ölçümle olmaz (kota) ve çelişki SESSİZCE çözülmez; taşıma/adaptör koşulu değişirse yetenek koşullu sayılıp yeniden ölçülür. Öğrenme hiçbir destructive servisi AÇMAZ ve F4-A native kapısını gevşetemez. Bozuk ya da şeması uyuşmayan depo yok sayılır, üstüne YAZILMAZ ve "öğrendik" DENMEZ. Hiç öğrenme yoksa sayaçlar 0 DEĞİL KAYNAK YOK gösterir. Gerçek araç doğrulaması YAPILMADI.',
  },
  {
    id: 'gap-resolver', category: 'vehicle', name: 'Self-Healing / Gap Resolver',
    desc: 'Tanı eksiklerinin (boşlukların) kanıta dayalı çözüm defteri: kaç boşluk AÇIK · her boşluğun sınıfı (mevcut ReplayGapSignal / yetenek çelişkisi / bayat kayıt sözlüğü) · kök katmanı (TRANSPORT · SESSION · PARSER · AUTHORITY · VERDICT · CONFORMANCE) ve kök nedeni · seçilen GÜVENLİ ölçüm adayı ve NEDEN seçildiği (bilgi kazancı / maliyet / risk / önceki deneme skoru) · deneme sayısı ve anti-döngü tavanları · harcanan ve öğrenmeyle KAZANILAN istek sayısı · son gözlenen sonuç · RESOLVED / BLOCKED / EXHAUSTED durumu · yetenek çizgesine etkisi.',
    status: 'AVAILABLE', layer: 'gap registry + capability graph',
    note: 'Hiçbir şey BAŞLATMAZ: çözüm turu koşturmaz, ölçüm yapmaz, PDU göndermez, boşluk sicilini değiştirmez, timer ve ağ çağrısı YOK — yalnız mevcut bellek okunur. ÇÖZÜCÜ KENDİ ÖLÇÜM MOTORUNU KURMAZ: her ölçüm mevcut F1-A işlem → F1-B oturum → F1-C ISO-TP tuning → F3/F4-A PDU köprüsü → F4-B keşif sınıflandırması → F4-C öğrenme politikası yolundan geçer; ikinci bir yetki katmanı YOKTUR. GÜVENLİK: destructive hiçbir aksiyon üretilemez (04 · 11 · 14 · 27 · 28 · 2E · 2F · 31 · 34-37 · 3B · 85); aday sözlüğünde yazma/aktüatör/güvenlik/kodlama eylemi YOKTUR, politika ikinci kapıdır ve TS bozulsa bile F4-A native DiagnosticServiceGate son kapıdır. Kör ECU/adres taraması YOKTUR — hedef çağırandan gelir, uydurulmaz; hedefe uyan CDDL tanımı yoksa ölçüm YAPILMAZ. DÜRÜSTLÜK: RESOLVED yalnız yeni CANLI kanıt boşluğu gerçekten kapattığında verilir — "komut gönderdim" ya da "yeniden denedim" çözüm SAYILMAZ; replay/sentetik/içe aktarılmış kanıt çözücünün davranışını test eder ama ürün güveni ÜRETMEZ. TAŞIMA sınırı araç sınırı SAYILMAZ: köprü taşıyamadıysa araç "desteklemiyor" İLAN EDİLMEZ. Kanıtlı ABSENT (NRC 0x11) için gereksiz yeniden yoklama ÜRETİLMEZ. ANTİ-DÖNGÜ: aynı boşluk + aynı aday + aynı gözlenen sonuç üçlüsü deterministik tavanı aşınca EXHAUSTED olur ve yeni CANLI kanıt gelmeden otomatik yeniden başlamaz. BU FAZDA yalnız salt-okunur ölçümler hatta çıkar; oturum açma, keepalive tetikleme, zaman aşımı bütçesi oynatma ve ham iz toplama aday olarak GÖRÜNÜR ama ÇALIŞTIRILMAZ (ENGELLİ gerekçesiyle kaydedilir). Çözücü hiç koşmadıysa sayaçlar 0 DEĞİL KAYNAK YOK gösterir; koştu ve açık boşluk gerçekten 0 ise AÇIK GAP 0 — ÖLÇÜLDÜ yazar. Gerçek araç doğrulaması YAPILMADI.',
  },
  {
    id: 'discovery-capability', category: 'vehicle', name: 'Keşif / Yetenek Haritası',
    desc: 'Bilinmeyen ECU\'da hangi SALT-OKUNUR servislerin gerçekten mevcut olduğunun ÖLÇÜLMÜŞ haritası: servis/alt fonksiyon başına varlık sınıfı (VAR · YOK(7F-11) · VAR-ama-koşullu · bilinmiyor · köprü taşıyamadı · adreslenemedi · yanıt tanınmadı · yarım kaldı · yoklanmaz) · istek künyesi · NRC · gecikme · oturum kanıtı · iz korelasyonu · gerekçe · kaç kez soruldu · keşif turu sayısı ve defter taşması · korpus dışı bırakılan adaylar ve gerekçeleri · taşıma sınırları ve yönlendirme politikası · boşluk sicili sayaçları.',
    status: 'AVAILABLE', layer: 'CDDL / generic PDU',
    note: 'Hiçbir şey BAŞLATMAZ: keşif turu tetikleme, PDU gönderme, oturum açma, bütçe değiştirme ve ağ çağrısı YOK — yalnız mevcut defter okunur. KÖR TARAMA YOK: adaylar yalnız CDDL tanımlarından gelir; 00..FF servis/alt fonksiyon taraması YAPILMAZ. Destructive servisler (04·11·14·27·28·2E·2F·31·34-37·3B·85) korpusa GİREMEZ ve F4-A native kapısı ayrıca/bağımsız olarak son sözü söyler. DÜRÜSTLÜK: NRC 0x11 DIŞINDA hiçbir negatif yanıt "servis yok" sayılmaz (0x12/0x22/0x31/0x33/0x7E/0x7F → VAR ama koşullu); köprünün taşıyamaması ARACIN sınırı DEĞİLDİR; bütçe/oturum bitince kalanlar "YOK" değil YARIM KALDI olarak yazılır. Hiç yoklama yapılmadıysa sayaçlar 0 DEĞİL KAYNAK YOK gösterir. Bu faz FleetMemory/öğrenme YAZMAZ, profil güveni YÜKSELTMEZ; defter süreç ömürlüdür. Ham yanıt gövdesi, VIN ve konum bu ekrana TAŞINMAZ. Gerçek araç doğrulaması YAPILMADI.',
  },
  {
    id: 'address-search-evidence', category: 'vehicle', name: 'Adres Arama Kanıtı',
    desc: 'Adres arama denemelerinin salt-okunur kanıt defteri: cevabı ÜRETEN katman (premium BYOK · Nominatim · gevşetilmiş varyant · Overpass sokak · cihaz-içi geçmiş/POI · geocode önbelleği) · deneme sonucu (doğrudan rota · kullanıcı seçti · seçim bekliyor · seçmeden kapattı · yargılanmadı · 0 sonuç · servis hatası) · başarısızlık sebep sınıfı ve kanıt sağlamlığı (confidence) · sorgu BİÇİMİ bayrakları (numaralı yol · ekli tip · kısaltma · kapı no · İ harfi) · iki arama yüzeyinin ayrışması · sağlayıcı gecikmesi ve fast-fail aşımı · eksik kanıt sayacı ve "önce bunu ölç" sırası.',
    status: 'AVAILABLE', layer: 'Nominatim / Overpass',
    note: 'Hiçbir şey BAŞLATMAZ: arama tetikleme, sağlayıcı seçme/değiştirme, sorgu değiştirme, rota kurma ve ağ çağrısı YOK (yalnız BYOK anahtar VAR/YOK okunur). ARANAN ADRES METNİ, SOKAK ADI VE KOORDİNAT GÖSTERİLMEZ — adres ev adresidir, kişisel veridir; defter metni hiç SAKLAMAZ, yalnız PII taşımayan biçim bayraklarını tutar. Defter RAM\'de yaşar, diske YAZILMAZ → oturum bitince kanıt gider. "Sonuç döndü" ile "aradığı yer bulundu" AYRI sayılır: kullanıcı seçmediyse deneme çözülmüş SAYILMAZ. Karara bağlanmış deneme yoksa oran ÜRETİLMEZ (sahte %0 yok); kanıt yetersizse sınıf UNKNOWN kalır. KAPSAM SINIRI: "veri OSM\'de var mı" sorusu üründe SORULMAZ (yer gerçeği sorgusu yok) → 0 sonuç, veri boşluğu ile geocoder körlüğünü AYIRT ETMEZ; bu GROUND_TRUTH kanıt boşluğu olarak sayılır. Sorgunun ayrıştırıcıda bozulup bozulmadığı da HENÜZ ölçülmüyor (QUERY_INTEGRITY borcu). Gerçek araç doğrulaması YAPILMADI.',
  },
  {
    id: 'enforcement-points', category: 'vehicle', name: 'Denetim Noktası Verisi',
    desc: 'Gömülü denetim noktası paketinin ve onu tüketen Guardian map dilimi üreticisinin salt-okunur gözlemi: paket kimliği · şema sürümü · ÜRETİM anı (fetchedAt) · sayılan nokta ve sorguya giren alt küme · ayrıştırmada elenen bozuk kayıt · tür dağılımı (bilinmeyen oranı dâhil) · uyarı politikası eşikleri (yarıçap · konum belirsizliği tavanı · ileri koni açısı · yön için en düşük hız · fix yaşı tavanı · minimum güven · severity) · KAPI SAYAÇLARI (paket hazır değil · konum yok · fix ölü · hız yok · konum belirsiz · yön güvenilmez · yarıçapta nokta yok) · son ölçülen konum belirsizliği ve son üretilen dilimin mesafesi.',
    status: 'AVAILABLE', layer: 'EGM EDS paketi',
    note: 'Hiçbir şey BAŞLATMAZ: paket indirme/yenileme, Guardian tick tetikleme, eşik/severity değiştirme, konum düzeltmesi isteme ve ağ çağrısı YOK — açılışta tek okuma + elle YENİLE. Cihaz kaynağa (EGM) DOĞRUDAN BAĞLANMAZ; okunan şey uygulamaya gömülü pakettir (karar K5). KOORDİNAT VE NOKTA ETİKETİ TAŞINMAZ — aracın konumu, noktaların enlem/boylamı ve kaynağın serbest metin açıklaması bu ekrana GELMEZ; yalnız sayılar, durumlar ve skaler mesafe görünür. DÜRÜSTLÜK: "uyarı çıkmıyor" ile "yolda denetim yok" AYRI gösterilir — bu ekranın tek işi ikisini ayırt etmektir. Boş/bozuk paket UNAVAILABLE\'dır, sıfır nokta "denetim yok" SAYILMAZ. Tür kayıtların %93\'ünde bilinmiyor → ürün dili "denetim noktası"dır, "radar" DEĞİLDİR (K3); hız limiti kaynakta HİÇ yoktur → uyarı hız eşiği İDDİA ETMEZ (K4). Mesafe KUŞ UÇUŞUDUR, rota boyunca değil. KAPSAM SINIRI: kaynak kapsamı ölçüldü ve eksiktir (Mersin ili 0 kayıt; Mersin–Tarsus koridoru üç kaynakta da 0); mobil radar hiçbir statik kaynakta YOKTUR ve kapsam dışıdır. Konum belirsizliği kapısı şartlı kilit #508\'in doğrudan izidir — sahada fix yaşı p50 19,5 s iken bu kapı otoyol hızında çoğunlukla KAPALI kalır ve düşüşler burada SAYILIR. Paket tazeleme politikası HENÜZ KARARLAŞTIRILMAMIŞTIR (ADR §6-D.3) — paket bugün statiktir. Gerçek araç doğrulaması YAPILMADI.',
  },
  {
    id: 'fleet-identity', category: 'vehicle', name: 'Fleet Identity',
    desc: 'Araç kimlik boru hattının salt-okunur gözlemi: kimlik durumu (UNKNOWN·PENDING·VERIFIED·CONFLICT·STALE) · maskeli VIN + marka/model/yıl/nesil · aktif OBD protokolü · parmak izi ön eki ve şema sürümü · yayıncı durumu, retry/dedupe/çakışma sayaçları · sunucu hükmü, güveni ve revizyonu.',
    status: 'AVAILABLE', layer: null,
    note: 'Hiçbir şey BAŞLATMAZ: kimlik yayını tetikleme, Mode 09 VIN sorgusu, handshake, parmak izi yeniden hesaplama, protokol değiştirme, retry zorlama, çakışma çözme ve ağ çağrısı YOK. HAM VERİ GÖSTERİLMEZ: TAM VIN (yalnız maskeli son 6), ham parmak izi (yalnız ilk 12), ECU adresi / PID bitmap / adaptör MAC, ham Mode 09 yanıtı ve api_key bu ekrana TAŞINMAZ. Güven ve revizyon SUNUCUDA üretilir — istemci kendi güvenini yükseltemez. VIN sahiplik otoritesi DEĞİLDİR.',
  },
  {
    id: 'fleet-driver-identity', category: 'vehicle', name: 'Fleet Driver Identity',
    desc: 'Sürücü kimliği ve araç ataması zincirinin salt-okunur gözlemi: aktif atama durumu · sınırlı sürücü/atama referansı · atama kaynağı, güveni ve revizyonu · anlık görüntü yaşı ve tazeliği · yakalama sayaçları ve son hata · zincirin hangi ucunun bağlı olduğu.',
    status: 'AVAILABLE', layer: null,
    note: 'Hiçbir şey BAŞLATMAZ ve sürücü SEÇTİRMEZ: head unit\'te güvenli kimlik doğrulama olmadığı için serbest sürücü seçimi BİLİNÇLİ olarak kapalıdır (aksi halde "kim olduğunu iddia eden herkes o kişi sayılır"). Atama oluşturma/bitirme, trip sürücüsü değiştirme, anlık görüntü yakalama (ağ çağrısı) ve timer YOK. KİŞİSEL VERİ TAŞINMAZ: sürücü ADI, ehliyet, telefon, e-posta ve kullanıcı kimliği bu ekrana GELMEZ — yalnız `drv:xxxxxxxx` biçiminde sınırlı teknik referans. Bayat anlık görüntü sürücü KANITI DEĞİLDİR; sunucu hükmü otoritedir. Gerçek head unit doğrulaması YAPILMADI (BLOCKED_REAL_DEVICE).',
  },
  {
    id: 'fleet-presence-history', category: 'vehicle', name: 'Presence History',
    desc: 'Sürücü varlığının zaman içindeki değişiminin salt-okunur defteri: şu anki ve bir önceki varlık segmenti · segment süresi (açıkken "şimdiye kadar") · el değiştirme sayısı · segment sayısı · dedupe ile yutulan tekrar gözlemler · kapanış gerekçesi (devredildi · süresi doldu · temizlendi) · sınır aşımında düşen segmentler. DAYANIKLILIK (P2): kalıcılık durumu · son geri yükleme · süre dolumu kipi · süresi dolan segment sayısı · araç bağı durumu · reddedilen gözlemler ve son arıza kodu.',
    status: 'AVAILABLE', layer: null,
    note: 'Hiçbir şey BAŞLATMAZ ve KARAR VERMEZ: gözlem üretme/kaydetme, segment kapatma/silme, sürücü seçme, ağ çağrısı ve timer YOK. Bu defter bir KARAR katmanı DEĞİLDİR — attribution kararını yalnız resolveDriverPresence verir ve o otorite bu deftere BAKMAZ; geçmiş kaydı hiçbir sürücüyü "kanıtlanmış" yapmaz. KİŞİSEL VERİ TAŞINMAZ: sürücü ADI, ehliyet, telefon, e-posta ve mutlak zaman damgası bu ekrana GELMEZ — yalnız `drv:xxxxxxxx` / `veh:xxxxxxxx` referansı, yaş ve süre. Açık segmentin süresi KESİN DEĞİLDİR; kapanış anı bilinmiyorsa süre UYDURULMAZ (UNAVAILABLE). Süre dolumu TİMER İLE DEĞİL, erişim anında TEMBEL uygulanır (`LAZY_ON_ACCESS`) — ekran bunu olduğu gibi gösterir, sahte "worker çalışıyor" YAZMAZ. Araç bağı kurulmadan hiçbir gözlem deftere yazılamaz ve gözlemin taşıdığı vehicleId KANIT SAYILMAZ. NFC/Bluetooth üreticisi bağlanmadığı için bu cihazda defter BOŞTUR. Gerçek cihaz doğrulaması YAPILMADI (BLOCKED_REAL_DEVICE).',
  },
  {
    id: 'fleet-driver-authentication', category: 'vehicle', name: 'Driver Authentication',
    desc: 'Sürücü kimlik doğrulama otoritesinin salt-okunur gözlemi: otorite durumu (UNBOUND · IDLE · ACTIVE · EXPIRED · DEGRADED) · aktif doğrulamanın kaynağı (NFC · PIN · Bluetooth · Telefon) ve seviyesi (VERIFIED · PARTIAL) · geçerlilik · oturum yaşı ve kalan süre · araç bağı · kabul/ret sayaçları ve son ret gerekçesi.',
    status: 'AVAILABLE', layer: null,
    note: 'Hiçbir şey BAŞLATMAZ ve KARAR VERMEZ: doğrulama üretme/kaydetme, oturum açma/kapatma, PIN sorma, sürücü seçme, ağ çağrısı ve timer YOK. PRESENCE ≠ AUTHENTICATION: bir NFC kartın okunması KARTI kanıtlar, KİŞİYİ değil — bu yüzden fiziksel varlık TEK BAŞINA VERY_HIGH ÜRETEMEZ; en yüksek güven yalnız kimlik doğrulaması + fiziksel varlık BİRLİKTEYKEN mümkündür ve iki katman farklı kişiyi gösterirse sonuç fail-closed olur. KİŞİSEL VERİ TAŞINMAZ: sürücü ADI, ehliyet, telefon, e-posta, PIN, kart numarası, token ve TAM oturum kimliği bu ekrana GELMEZ — yalnız `drv:xxxxxxxx` / `veh:xxxxxxxx` / `ses:xxxxxxxx` referansı, yaş ve süre. Nihai hüküm SUNUCUDADIR. NFC/PIN/Bluetooth/telefon üreticisi bağlanmadığı için bu cihazda doğrulama HİÇ ÜRETİLMEZ. Gerçek cihaz doğrulaması YAPILMADI (BLOCKED_REAL_DEVICE).',
  },
  {
    id: 'fleet-driver-dna', category: 'vehicle', name: 'Driver DNA',
    desc: 'Sürücü sürüş karakterinin salt-okunur gözlemi: öğrenme seviyesi (NONE·NASCENT·DEVELOPING·ESTABLISHED·MATURE) · güven · DNA yaşı ve tazeliği · metrik sayısı ve BİLİNMEYEN sayısı · sapma (drift) durumu ve kanıtı · metrik listesi (her biri MEASURED/DERIVED/UNKNOWN provenance ile) · araç üzerindeki TAHMİNİ etki.',
    status: 'AVAILABLE', layer: null,
    note: 'Hiçbir şey BAŞLATMAZ ve KARAR VERMEZ: DNA hesaplama/yazma, yolculuk işleme, sunucuya yazma, sürücü seçme, ağ çağrısı ve timer YOK. BU BİR PUAN TABLOSU DEĞİLDİR: sürücüye not verilmez, sıralanmaz, etiketlenmez. BU KATMAN AI ÜRETMEZ — model/tahmin/öneri/doğal dil yoktur; yalnız yapay zekanin gelecekte kullanacağı kanıtlanmış altyapı vardır. UNKNOWN GERÇEK BİR CEVAPTIR: kanıtı olmayan metrik 0 DEĞİL boş kalır ve gerekçesi yazılır (viraj stili ve akü bakımı için yolculuk modelinde SİNYAL KAYNAĞI YOK). Araç etkisi ÖLÇÜM DEĞİL TAHMİNDİR ve her satırda öyle işaretlenir. Yeterli yolculuk/mesafe birikmeden DNA BİLİNÇLİ OLARAK OLUŞMAZ. DNA sunucuda birikir; head unit tarafinda üretilmez — köprü bağlı değilse ekran dürüstçe "DNA yok" der. KİŞİSEL VERİ TAŞINMAZ: sürücü ADI, rota, konum, VIN ve plaka GELMEZ (yalnız `drv:xxxxxxxx`). Gerçek araç doğrulaması YAPILMADI (BLOCKED_REAL_VEHICLE).',
  },
  {
    id: 'fleet-intelligence', category: 'vehicle', name: 'Fleet Intelligence',
    desc: 'Filo zekâsı altyapısının salt-okunur gözlemi: içgörü ve kanıt sayaçları · aktif içgörüler ve HER BİRİNİN dayandığı kanıt satırları (araç/sürücü/yolculuk/metrik) · trendler ve yönleri · filo düzeyinde sapma (drift) kanıtı · filo sağlığı BOYUTLARI (tek puan YOK) · veri kapsamı · öğrenme yaşı · bilinmeyen sayısı.',
    status: 'AVAILABLE', layer: null,
    note: 'Hiçbir şey BAŞLATMAZ ve KARAR VERMEZ: içgörü üretme/yazma, kanıt ekleme, trend hesaplama, sunucuya yazma, ağ çağrısı ve timer YOK. BU KATMAN AI ÜRETMEZ — LLM, model, tahmin, öneri ve doğal dil YOKTUR; bir içgörü bir CÜMLE değil KANIT KÜMESİDİR ve hangi araçlardan/sürücülerden/yolculuklardan/metriklerden oluştuğu tek tek izlenebilir. KANITSIZ İÇGÖRÜ OLUŞMAZ ve TEK ARAÇTAN YÜKSEK GÜVEN ÇIKMAZ (bir aracın davranışı filo iddiası değildir). Filo sağlığında TEK PUAN ÜRETİLMEZ; ölçülemeyen boyut UNKNOWN kalır (0 DEĞİL). Veri kapsamı bir başarı ölçüsü değil bilgi ölçüsüdür: düşük kapsam "filo kötü" değil "BİLMİYORUZ" demektir. Üretim SUNUCUDADIR; head unit tarafında filo iddiası üretilmez — köprü bağlı değilse ekran dürüstçe boş görünür. KİŞİSEL VERİ TAŞINMAZ: araç/sürücü ADI, plaka, VIN, konum ve rota GELMEZ (yalnız kısaltılmış referans). Gerçek araç doğrulaması YAPILMADI (BLOCKED_REAL_VEHICLE).',
  },
  {
    id: 'ai-evidence-engine', category: 'vehicle', name: 'AI Evidence Engine',
    desc: 'Tüm AI sistemlerinin ortak kanıt omurgasının salt-okunur gözlemi: kanıt sayaçları (aktif · süresi dolmuş · reddedilmiş · güveni türetilememiş) · kaynak dağılımı · birleştirme ve tazeleme sayaçları · kanıt zinciri (hangi çıktı hangi kanıta dayanıyor) · kanıt kapsamı ve eksik kategoriler · bütünlük bayrağı.',
    status: 'AVAILABLE', layer: null,
    note: 'Hiçbir şey BAŞLATMAZ ve KARAR VERMEZ: kanıt üretme/yazma, zincir kurma, süre kapatma, sunucuya yazma, ağ çağrısı ve timer YOK. BU KATMAN AI CEVABI ÜRETMEZ — LLM, model, tahmin, öneri ve doğal dil YOKTUR; kanıt bir CÜMLE değil, kaynağı ve ölçüm kalitesi belli bir KAYITTIR. KAYNAKSIZ KANIT GEÇERLİ OLAMAZ (hangi modülden geldiği bilinmeyen iddia kanıt sayılmaz) ve GÜVEN DIŞARIDAN YAZILAMAZ: kaynak, ölçüm kalitesi ve örnek sayısının en zayıf halkasından TÜRETİLİR (tek gözlem MEDIUM tavanını aşamaz). Kanıt DEĞİŞMEZDİR ve süresi dolunca SİLİNMEZ — geçmiş bir iddianın dayanağı yok edilirse o iddia açıklanamaz. Kapsam UNAVAILABLE ise bu "sıfır ölçtük" değil "HİÇ BAKMADIK" demektir. Üretim SUNUCUDADIR; head unit tarafında kanıt üretilmez. KİŞİSEL VERİ TAŞINMAZ: araç/sürücü ADI, plaka, VIN ve konum GELMEZ. Gerçek araç doğrulaması YAPILMADI (BLOCKED_REAL_VEHICLE).',
  },
  {
    id: 'vehicle-identity-vin', category: 'vehicle', name: 'Araç Kimliği (VIN)',
    desc: 'VIN’in kanonik kimlik durumu: MASKELİ VIN · hangi kaynaklardan okundu (Mode 09 · UDS F190) · doğrulama hâli (okunmadı · tek kaynak · iki kaynak doğruladı · ÇELİŞKİ · önceki oturuma ait) · reddedilen okumalar · VIN’den standartla ÇIKARILABİLENLER (WMI · ISO 3780 bölge · model yılı · kontrol hanesi) ve ÇIKARILAMAYANLAR · araç sınıfı ile sınıfın gerekçesi.',
    status: 'AVAILABLE', layer: 'VIN kimliği + araç sınıfı',
    note: 'SALT-OKUNUR. GİZLİLİK: ham VIN EKRANA ÇIKMAZ — yalnız maskeli biçim (mevcut `maskVin` otoritesi; yeni maske yazılmadı). ÖLÇÜLEN KUSUR: VIN’in tek deposu 13 satırlık `safety/vinContext` idi ve HİÇBİR DOĞRULAMA yapmıyordu — kısmi/bozuk bir VIN depoyu doldurabiliyor, `persistHandshakeVin` profile yazmadan ÖNCE koşulsuz çağırdığı için `getHandshakeVin()` bozuk değeri döndürüyor ve o değer `saveObdFuelCalib` anahtarı olarak YANLIŞ ARACA kalibrasyon yazabiliyordu; kaynak/ECU/oturum bilgisi de yoktu. FAIL-CLOSED: 17 haneli ISO 3779 biçimi tutmayan girdi kimlik SAYILMAZ, reddedilir ve red NEDENİ sayılır (sessiz yutma yok; reddedilen ham değer TAŞINMAZ, yalnız uzunluğu). ÇELİŞKİ: iki kaynak farklı VIN bildirirse durum ÇELİŞKİ olur ve HİÇBİRİ kanonik sayılmaz — ’ilk gelen kazanır’ çakışmayı sessizce çözer ve yanlış araca yazardı. OTURUM: yeni OBD oturumunda kimlik BAYAT olur (adaptör başka araca takılmış olabilir). SINIF VIN’DEN ÇIKARILMAZ: aynı şasi hem M1 hem N1 tescillenebilir (kütükteki Doblo örneği); sınıf ayrı otoritededir (`legalVehicleClass` / `vehicleClassRuntime`) ve emin olunmadıkça BİLİNMİYOR kalır — belirsiz sınıfta ticari hız limiti UYDURULMAZ. VIN’den yalnız standardın garanti ettikleri çıkarılır; model yılı 30 yıllık döngü nedeniyle belirsizse iki aday da gösterilir, tek yıl uydurulmaz; kontrol hanesi yalnız Kuzey Amerika’da zorunlu olduğu için başka bölgede ’uygulanmaz’ denir (sahte başarısızlık üretilmez). Gerçek araç doğrulaması YAPILMADI (kütük #764-#768).',
  },
  {
    id: 'ecu-inventory', category: 'vehicle', name: 'ECU Envanteri',
    desc: 'Keşfedilen her ECU için adres · adresleme kipi (11/29-bit) · protokol · ROL ve rolün HANGİ KANITTAN çıktığı · ECU’nun beyan ettiği sistem adı (ISO 14229 DID F197) · seri (F18C) ve donanım (F191) numarası · kararlı kimlik anahtarı. Talep-güdümlü; mevcut ECU keşfini kullanır.',
    status: 'AVAILABLE', layer: 'ECU keşfi + ISO 14229 kimlik',
    note: 'SALT-OKUNUR: yazma · aktüatör · rutin · oturum değiştirme YOKTUR. İKİNCİ TARAMA SİSTEMİ KURULMADI: ECU listesi mevcut `multiEcuScan.discoverEcus` keşfinden gelir; bu katman yalnız ZENGİNLEŞTİRİR ve okuma mevcut `readObdDid` köprüsüyle yapılır (yeni native köprü yok). ROL KANITTAN ÇIKAR, ADRESTEN DEĞİL: SAE J1979 yalnız 7E8 → motor garantisi verir; 7E1’in şanzıman olması yaygın bir GELENEKTİR, kural DEĞİLDİR ve oradan rol üretmek yanlış teşhise yol açar. KANIT SIRASI (gevşetilemez): ECU’nun kendi beyanı (declared) > standart adres garantisi (standard) > doğrulanmış üretici profili (profile) > kanıt yok (unknown). Beyan en üsttedir çünkü 7E8’de oturan bir birim kendini ’TCM’ diye tanıtıyorsa o bir şanzımandır ve standart varsayımı YANILIR. ÜRETİCİ EŞLEMELERİ AYRI VERİ KATMANINDA (`ecuRoleProfiles`) ve tablo ŞU AN BOŞTUR — bir satır ancak gerçek araçta doğrulandıktan sonra, `verifiedOn` damgasıyla girer; damgasız satırı doğrulayıcı REDDEDER. KARARLI KİMLİK: adres anahtarı adresleme kipini içerir (11-bit 7E8 ile 29-bit 18DAF108 AYNI kanıt değildir); kimlik anahtarı ayrıca araç bağlamını (VIN) taşır — aynı 7E8 her araçta vardır ve bağlamsız kimlik iki farklı aracın motor ECU’sunu tek kayda düşürürdü. PROVENANCE KORUNUR: DTC ve Servis 06 sonuçları rolü ve kimlik anahtarını taşır; envanter yoksa ya da BAYATSA rol `unknown` kalır (bayat rolü sonuca yapıştırmak, başka aracın kimliğini bu araca yazmaktır). Gerçek araç doğrulaması YAPILMADI (kütük #759-#763).',
  },
  {
    id: 'oem-ecu-profiles', category: 'vehicle', name: 'OEM ECU Profilleri',
    desc: 'Üretici-özel ECU profil defterinin salt-okunur gözlemi: profil eşleşti mi ve NEDEN · hangi ECU profilden geldi · doğrulama kanıtı (verifiedOn/evidence) · protokol · adresleme kipi (11/29-bit CAN veya KWP) · tx/rx · KWP hedef baytı · gerekli tanı oturumu · salt-okuma servis kapsamı · DID/LID adedi · profil sonucunun envanterde KEŞFEDİLDİ / SORULDU-YANIT VAR / SORULDU-YANIT YOK / SORULMADI hâli · hâlâ UNKNOWN olan alanların dökümü.',
    status: 'AVAILABLE', layer: 'ISO 14229 / 14230 / 15765-4 profil defteri',
    note: 'SALT-OKUNUR: tarama BAŞLATMAZ, OBD komutu GÖNDERMEZ, oturum DEĞİŞTİRMEZ, timer KURMAZ; yalnız profil defterini ve son ECU envanterinin profil özetini açılışta bir kez ve elle YENİLE ile okur. NEDEN VAR: ECU keşfi bugüne kadar TEK yoldan çalışıyordu — fonksiyonel `0100` (7DF) isteğine yanıt veren ECU’lar. Bu yol ISO 15765-4’ün garanti ettiği kadarını bulur ve YALNIZCA onu; OBD-II kapsamı DIŞINDAKİ birimler (BCM · HVAC · BMS · gösterge) o isteği çoğu araçta HİÇ yanıtlamaz ve ürün için GÖRÜNMEZDİLER. Profil, o birimlerin fiziksel adresini taşıyabilecek ortak sözleşmedir. İKİNCİ KEŞİF OTORİTESİ KURULMADI: envanterin sahibi hâlâ `multiEcuScan.discoverEcus`’tur; profil yalnız o listeye ADAY ekler, kendi tarama döngüsü · timer’ı · native köprüsü YOKTUR. DUPLICATE ÜRETİLMEZ: aynı ECU hem 0100 hem profille bulunursa TEK kayıt kalır ve kaynağı `functional_0100` olur — gerçek yanıt kanıtı, profilin varsayımından üstündür. FAIL-CLOSED KANIT: bir ECU kaydı ürün yoluna ancak `verifiedOn` (YYYY-MM-DD) VE `evidence` damgasıyla girer; damgasız kayıt defterde DURUR ama araca adres OLMAZ ve satırında bunu açıkça yazar. Yarım damga (tarih var kanıt yok) doğrulayıcıda DÜŞER. ADRESTEN ROL UYDURULMAZ: profil kaydında `role: unknown` YASAKTIR — rolü bilinmeyen bir adres profile değil keşfe aittir; rol çıkarımı `ecuRoleModel` tek otoritesindedir ve `profile` kanıtı beyandan (declared) ve standart adres garantisinden (standard) SONRA gelir. SALT-OKUMA SINIRI KOD SEVİYESİNDE: `readServices` yalnız okuma servislerini kabul eder; SecurityAccess (0x27) · WriteDataByIdentifier (0x2E) · RoutineControl (0x31) · ClearDiagnosticInformation (0x14) · Mode 04 · ECUReset (0x11) doğrulayıcı tarafından REDDEDİLİR ve profil dosyasına yazılarak bile açılamaz. UNKNOWN GİZLENMEZ: KWP hedef baytı ve gerekli tanı oturumu ölçülmediyse `UNKNOWN` KALIR — yanlış hedef baytı K-line’da başka modülü uyandırır. KWP ECU’LARI ENVANTERE ALINMAZ: `DiscoveredEcu` sözleşmesi 11/29-bit CAN adres kipi ZORUNLU kılar, KWP’de böyle bir kip yoktur ve “11 diyelim” demek kayıt anahtarını yalanlardı; bu adet dürüstçe raporlanır. OTURUM MÜHRÜ: eşleşme OBD oturum numarasıyla damgalanır; yeniden bağlanmada envanter BAYAT olur ve profil sonucu canlı sanılmaz. GİZLİLİK: HAM VIN bu ekrana GELMEZ — yalnız VAR/YOK ve WMI öneki (3 hane, üretici tahsisi); ham komut/yanıt, konum ve kullanıcı verisi taşınmaz. LİSANS: her kayıt kaynağını ve lisansını taşır; kopyaleft/non-commercial lisanslı kayıt doğrulayıcıda REDDEDİLİR (ticari satış kuralı). DEFTERİN ŞU ANKİ HÂLİ: mevcut Renault/Dacia · Trafic (KWP) · Zoe Ph2 verileri bu sözleşmeye TAŞINDI ama hiçbirinin adresi bu üründe gerçek araçta doğrulanmadı → ürün yolundaki profil sayısı 0’dır ve profil yolu üretimde HİÇBİR davranışı değiştirmez. Gerçek araç doğrulaması YAPILMADI (kütük #814-#819).',
  },
  {
    id: 'mode06-monitors', category: 'vehicle', name: 'Servis 06 İzleme Testleri',
    desc: 'ECU ’nun kendi onboard izleme testlerinin (SAE J1979 Servis 06) salt-okunur gözlemi: ECU → monitör (MID) → test (TID) → ölçülen değer · ECU’nun KENDİ min/max sınırı · geçti/kaldı · sınıra kalan pay. Talep-güdümlü tarama (TARA düğmesi); ECU keşfi paylaşılır ve yalnız DESTEKLİ bildirilen MID’ler sorgulanır.',
    status: 'AVAILABLE', layer: 'OBD-II Mode 06',
    note: 'SALT-OKUNUR: yazma · aktüatör · servis rutini · oturum değiştirme YOKTUR. Tek aktif işi, kullanıcı TARA derse `06 <MID>` OKUMA istekleri göndermektir (Derin Tarama ekranıyla AYNI sözleşme); ekran açıkken kendiliğinden hatta ÇIKMAZ ve timer KURMAZ. NEDEN VAR: Mode 03 bir arızayı ancak ECU onu KOD olarak yazdıktan sonra gösterir; Servis 06 ise testin HAM sonucunu ve ECU’nun KENDİ sınırlarını verir, yani ’sınıra ne kadar yakınız’ sorusu kod yanmadan yanıtlanabilir. EŞİK UYDURULMAZ: geçti/kaldı bir yorum DEĞİL, ECU’nun beyan ettiği min/max’in doğrudan sonucudur. ÜÇ DURUM BİRLEŞTİRİLMEZ: GEÇTİ · KALDI · YORUMLANAMADI; ayrıca ECU SUSTU (NO DATA) ve YANIT BOZUK ayrı tutulur — hiçbiri ’geçti’ SAYILMAZ. Ölçek kimliği (UAS) tanınmayan testte hüküm VERİLMEZ ve değer HAM gösterilir: yanlış birimle ölçeklenmiş bir sayı, hiç sayı olmamasından tehlikelidir. PROVENANCE: her sonuç hangi ECU’dan geldiğini taşır; native `withEcuHeader` atomik header yönetimi sayesinde ECU’lar karışamaz. ÇOK-ÇERÇEVE: Mode 06 yanıtı CAN’de HER ZAMAN çok-çerçevelidir (tek kayıt 9 bayt + servis baytı > 7) — mevcut ISO-TP birleştiricisi (`splitResponseBodies`) yeniden kullanıldı, ikinci çözümleyici yazılmadı. OTURUM: sonuç OBD oturum numarasıyla damgalanır; reconnect sonrası eski sonuç BAYAT olarak işaretlenir. BÜTÇE: ECU başına en fazla 32 MID sorgulanır ve kesilen kuyruk ADEDİYLE bildirilir (sessiz kırpma yok). ERKEN UYARIYA BAĞLANMADI: bu tur Servis 06’yı bilinçli olarak GÖZLEM katmanında bıraktı — hiçbir gerçek araçta tek bayt okunmadan karar katmanına bağlamak, kanıtsız karar üretmek olurdu. Gerçek araç doğrulaması YAPILMADI (kütük #744-#748).',
  },
  {
    id: 'dtc-coverage', category: 'vehicle', name: 'DTC Kapsamı & ECU Adreslenebilirlik',
    desc: 'İKİ KANIT YAN YANA. (1) Standart OBD-II arıza kodu SINIFLARININ (Mode 03 onaylanmış · Mode 07 bekleyen · Mode 0A kalıcı) servis bazında salt-okunur kanıtı: hangi servis hangi ECU’ya soruldu, HAM yanıt ne geldi, ondan NE çözümlendi ve okuma hangi OBD oturumuna ait. (2) ECU KEŞİF & ADRESLENEBİLİRLİK: her ECU adayı için keşif kaynağı · rota (rx/tx) · tx türetme kuralı · protokol · prob sonucu · ADRESLENEBİLİRLİK (PROVEN / NOT_ADDRESSABLE / NOT_ATTEMPTED / UNKNOWN) ve o kararın GEREKÇESİ · servis denemeleri · ham yanıt · otorite yayını; ayrıca UDS 0x19 / KWP 0x18 gelişmiş kanıt.',
    status: 'AVAILABLE', layer: 'OBD-II Mode 03 / 07 / 0A',
    note: 'SALT-OKUNUR: hiçbir OBD komutu GÖNDERMEZ, tarama BAŞLATMAZ, timer KURMAZ; yalnız `dtcScanEvidence` defterini açılışta bir kez ve elle YENİLE ile okur. NEDEN VAR (saha kusuru): aynı araç + aynı adaptörle başka bir OBD uygulaması `P0089 — Fuel Pressure Regulator 1 Performance / BEKLİYOR` gösterirken CarOS aynı kodu göstermiyordu. Kök neden native DTC çözümleyicisiydi: "sayaç baytı var mı?" sorusu BAYT SAYISI PARİTESİYLE tahmin ediliyordu ve dolgulu (padded) / çok-çerçeveli (ISO-TP) yanıtlarda parite ters dönüyordu. ÖLÇÜLDÜ: "47 01 00 89" → [P0089] doğru; "47 01 00 89 00 00 00" → [P0100, B0900] — gerçek kod KAYBOLUYOR ve OLMAYAN kod ÜRETİLİYORDU. Bu hata hiçbir ekranda görünmediği için sessizce yaşadı; ekranın varlık sebebi budur — HAM yanıt ile ÇÖZÜMLENMİŞ kod YAN YANA durur. DÜRÜSTLÜK: "0 kod" ile "okunmadı" AYRI gösterilir ve hiçbiri "arıza yok" DEMEK DEĞİLDİR; düşen okuma ASLA yeşil gösterilmez (kapsam kaybıdır); hiç sorulmamış servis "temiz" değil "HİÇ SORULMADI" yazar; ham yanıt taşınmayan yolda `UNAVAILABLE` yazılır (boş string "ham geldi ama boştu" demek olurdu). SINIFLAR KARIŞMAZ: bekleyen bir onaylanmış DEĞİLDİR; aynı kod birden fazla sınıfta ve birden fazla ECU’da görülebilir ve hepsi ayrı gözlem olarak KORUNUR. OTURUM MÜHRÜ: her kayıt OBD oturum numarası taşır; yeni oturum kanıt yazmaya başladığında eski oturumun kayıtları DÜŞER — yeniden bağlanma veya araç değişimi eski kodları yeni oturuma taşıyamaz. GİZLİLİK: yalnız OBD protokol verisi (kod · servis · ECU adresi · ham hex); VIN, konum ve kullanıcı verisi bu deftere GİRMEZ. Gerçek araç doğrulaması YAPILMADI (kütük #794-#796).',
  },
  {
    id: 'ecu-capability', category: 'vehicle', name: 'ECU Yetenek Matrisi',
    desc: 'ECU BAŞINA TEK KÜNYE: rota (rx/tx) · adresleme bit genişliği · protokol · ADRES KANITI (PROVEN / NOT_ADDRESSABLE / UNKNOWN) ve gerekçesi · OTURUM durumu (OPENED / REFUSED / NOT_REQUIRED / UNKNOWN) · YEDİ kanonik DTC servisinin (03 · 07 · 0A · 19-02 · 19-0A · 18 · 13) ölçülen yeteneği · servis başına kod adedi, NRC ve ham yanıt · kapsam boşlukları · bu ECU hakkında görebildiğimiz oranı (güven) · silme KANIT ZİNCİRİNİN tamlığı.',
    status: 'AVAILABLE', layer: 'Kanıt projeksiyonu (OBD-II + KWP + UDS)',
    note: 'SALT-OKUNUR: hiçbir OBD komutu GÖNDERMEZ, tarama BAŞLATMAZ, timer KURMAZ, defter YAZMAZ; yalnız mevcut BEŞ defteri (`ecuAddressability` · `dtcAuthority` scans · `advancedDtcEvidence` · `kwpSessionProbe` · `dtcPipelineAccounting`) açılışta bir kez ve elle YENİLE ile okur. NEDEN VAR (ölçülen kusur): "bu ECU’ya ne sorabildik ve ne cevap verdi" sorusunun cevabı beş ayrı deftere dağılmıştı ve hiçbir yerde birleşmiyordu; sahada kimse beş ekranı yan yana koymadığı için "neden kod okuyamadık" sorusu pratikte YANITSIZ kalıyordu. İKİNCİ OTORİTE DEĞİLDİR: yeni ölçüm üretmez, hattan tek bayt istemez, "araç temiz/arızalı" DEMEZ — o hüküm `dtcAuthority.evaluateVehicleDtcVerdict` tekelindedir. DOKUZ DURUM KARIŞMAZ: DESTEKLİ-kayıt var · DESTEKLİ-kayıt yok · SERVİS YOK · ECU SUSTU · NEGATİF YANIT · OTURUM REDDİ · ÇÖZÜLEMEDİ · ADRESLENEMEDİ · SORULMADI ayrı ayrı durur; ikisini birleştirmek tam olarak ürünün geçmişte ürettiği kapsam yalanıydı ("soruldu ve yok" ile "hiç sorulmadı" AYNI görünüyordu). SORULMAYAN SERVİS GİZLENMEZ: kanonik yedi satır HER ZAMAN basılır, eksik olan "SORULMADI" yazar. TAM KAPSAM İDDİASI KANITA BAĞLI: "TAM KAPSAM KANITLANDI" yalnız (a) en az bir ECU künyesi varsa, (b) hiçbir künyede kapsam boşluğu yoksa ve (c) hiçbir künyenin güveni bilinmiyor değilse yazılır. GÜVEN UYDURULMAZ: hiç servis sorulmadıysa yüzde basılmaz, `UNAVAILABLE` yazar. SİLME SATIRI BİR İZİN DEĞİLDİR: "KANIT ZİNCİRİ TAM" ifadesi yalnız silme için gereken (adres × oturum × ölçülmüş servis) zincirinin eksiksiz olduğunu söyler; gerçek yazma kapısı `manufacturerClearGate`/`writeGate`tedir, bu ekran onu GEVŞETMEZ ve hiçbir destructive komut göndermez. OTURUM MÜHRÜ: yalnız ŞU ANKİ OBD oturumunun gözlemleri gösterilir; epoch okunamazsa hiçbir satır basılmaz (bayat kanıtı taze gibi sunmak YASAK). GİZLİLİK: yalnız OBD protokol verisi (adres · rol · servis · NRC · ham hex · adet); VIN, konum ve kullanıcı verisi bu ekrana GİRMEZ. Gerçek araç doğrulaması YAPILMADI (kütük #845-#848).',
  },
  {
    id: 'dtc-clear-evidence', category: 'vehicle', name: 'DTC Silme Kanıtı',
    desc: 'Mode 04 (arıza hafızasını sil) denemelerinin salt-okunur kanıtı: hatta gönderilen komut (TX) · ECU’nun HAM yanıtı (RX) · aktif protokol · hedef kapsam · sonuç sınıfı (pozitif / negatif+NRC / NO DATA / zaman aşımı / hat hatası) · komut süresi · yazma kapısı kararı · silme öncesi kodlar · silme SONRASI 03/07/0A yeniden okumasının sınıf bazında sonucu ve nihai hüküm.',
    status: 'AVAILABLE', layer: 'OBD-II Mode 04 + doğrulama okuması',
    note: 'SALT-OKUNUR: hiçbir OBD komutu GÖNDERMEZ, silme BAŞLATMAZ, tarama BAŞLATMAZ, timer KURMAZ; yalnız `dtcClearEvidence` defterini açılışta bir kez ve elle YENİLE ile okur. NEDEN VAR (saha kusuru P0-OBD-10): gerçek araçta P0089 BEKLEYEN (Mode 07) doğru okunuyordu ama "HAFIZAYI TEMİZLE" kodu silmiyordu ve ürün TEK BİR KANIT üretemiyordu. Uçtan uca ölçüm ÜÇ ayrı kusur buldu: (1) KOMUT HİÇ GİTMİYORDU — silme önkoşulu YALNIZ Mode 03 (onaylanmış) listesine bakıyordu; bekleyen-yalnız araçta liste boş olduğu için düğme kalıcı olarak pasifti ve servis erken dönüyordu, ECU’ya tek bayt gitmiyordu; (2) BAŞARI = "İSTİSNA FIRLATMADI" idi — ECU’nun ne cevapladığı okunmuyor, ham TX/RX plugin sınırında atılıyordu ve NO DATA · zaman aşımı · negatif yanıt · hat hatası hepsi tek bir `false` a düşüyordu; (3) SİLME SONRASI YENİDEN OKUMA YOKTU — UI listesi körlemesine boşaltılıyordu (`codes: []`), yani ekran "temizlendi" gösterirken araçta kod duruyordu; panelin bekleyen/kalıcı/freeze-frame durumu ise hiç tazelenmediği için ekranda eski kod olduğu gibi kalıyordu. DÜRÜSTLÜK: "ECU onayı (44)" ile "DOĞRULANMIŞ silme" AYRI sayılır — bu ekranın tüm meselesi ikisinin AYNI ŞEY OLMAMASIDIR; ECU onay verdiği hâlde doğrulanmış silme yoksa özet kırmızıya döner (sahadaki kusurun imzası budur). SINIFLAR KARIŞMAZ: bekleyen · onaylanmış · kalıcı ayrı ölçülür; KALICI (Mode 0A) kodun durması BAŞARISIZLIK DEĞİLDİR ve kırmızı gösterilmez — SAE J1979’a göre Mode 04 onu silemez, ECU koşullar sağlanınca kendi temizler. AYIRT EDİLEMEYEN DURUM GİZLENMEZ: ECU onay verip kodlar yine de duruyorsa ürün taraf TUTMAZ — "hiç silinmedi" ile "silindi ve arıza aktif olduğu için anında yeniden yazıldı" tek yeniden okumayla ayırt edilemez ve ekran bunu açıkça söyler. POZİTİF YANIT ALGILAMASI TAHMİN DEĞİL: SID 0x44 ham metinde `contains` ile DEĞİL, ISO-TP birleştirmesi + ÇİFT HİZALI arama ile bulunur (Mode 03/07/0A parser’ıyla AYNI disiplin) — eski kod "7F 04 44" (NRC 0x44) negatif yanıtını "silindi" sanardı. OTURUM MÜHRÜ: her kayıt OBD oturum numarası taşır; yeni oturum kanıt yazmaya başladığında eski oturumun kayıtları DÜŞER. GİZLİLİK: yalnız OBD protokol verisi (komut · ham hex · DTC kodu · protokol numarası · süre); VIN, konum ve kullanıcı verisi bu deftere GİRMEZ. Gerçek araç doğrulaması YAPILMADI (kütük #797-#803).',
  },
  {
    id: 'pid-discovery', category: 'vehicle', name: 'PID Keşif Kanıtı',
    desc: 'Mode 01 desteklenen-PID bitmap keşfinin (0100 · 0120 · 0140 · 0160 · 0180 · 01A0) salt-okunur kanıtı: blok başına gönderilen komut · HAM yanıt · sonuç sınıfı · 4 bitmap baytı · süreklilik biti · YAPILAN deneme sayısı (yeniden deneme dahil) · zincirin nerede ve neden durduğu · keşif bütünlüğü.',
    status: 'AVAILABLE', layer: 'OBD-II Mode 01 bitmap keşfi',
    note: 'SALT-OKUNUR: el sıkışması BAŞLATMAZ, OBD komutu GÖNDERMEZ, timer KURMAZ; yalnız `getHandshakeDiagnostics()` anlık kopyasını açılışta bir kez ve elle YENİLE ile okur. NEDEN VAR (saha şüphesi): `supportedCount ≈ 15` görülüyordu ve bu sayı İKİ TAMAMEN FARKLI gerçeğin AYNI görünümüydü — (a) ECU gerçekten yalnız ilk bloğu destekliyor (0100 süreklilik biti 0) ve (b) CarOS keşfi ilk blokta KIRILDI (0120 timeout/NO DATA). ÖLÇÜLEN KÖK NEDEN: `performHandshakeRaw` tek satırda karar veriyordu ve `handshakeBitmapRaw` → `safeSend` İSTİSNAYI YUTUP boş string döndürüyordu; `hasContinuationBit("")` fail-closed **false** döndüğü için `0100`ün süreklilik biti 1 OLSA BİLE tek bir timeout zinciri SESSİZCE bitiriyordu — ve ürün "araç 15 PID destekliyor" diye KANITSIZ bir iddia üretiyordu. DÜZELTME: yanıt artık "KESİN mi" diye sınıflandırılır (pozitif+4 bitmap baytı VEYA açık negatif 7F01 VEYA "?" → KESİN; boş/NO DATA/hat hatası/yarım yanıt → KESİN DEĞİL), kesin olmayan blok SINIRLI SAYIDA (tavan 2) yeniden denenir ve hâlâ kesin değilse zincir durur ama `failedBlockIndex` ile İŞARETLENİR. DÜRÜSTLÜK: `supportedCount` ARTIK TEK BAŞINA GÖSTERİLMEZ — keşif eksikse etiketi "Desteklenen PID (EN AZ)" olur, çünkü o sayı bir TAVAN değil ALT SINIRDIR; okunmayan blokların PID’leri BİLİNMİYOR ve "araç desteklemiyor" ÇIKARIMI YASAKTIR. DÖRT SINIF BİRLEŞTİRİLMEZ: zaman aşımı · NO DATA · açık negatif yanıt (araç bloğu bilmiyor) · hat hatası. "HİÇ SORULMADI" ile "soruldu ama cevap gelmedi" AYRI gösterilir. ÖNCEKİ BLOKLARIN DESTEĞİ KORUNUR: zincir yarıda kırılsa da o ana kadar okunan blokların PID’leri KAYBOLMAZ. GİZLİLİK: yalnız OBD protokol verisi (bitmap hex · blok adı · sonuç · deneme sayısı); **VIN GÖSTERİLMEZ**, yalnız VAR/YOK. Gerçek araç doğrulaması YAPILMADI (kütük #807-#809).',
  },
  {
    id: 'dtc-authority', category: 'vehicle', name: 'Kanonik DTC Otoritesi',
    desc: 'Ürünün TEK kanonik DTC gerçeği: her gözlem için kod · sınıf (ONAYLANMIŞ / BEKLEYEN / KALICI / UDS / KWP) · ECU anahtarı ve rolü · tx header · protokol · oturum numarası · kaynak servis · ölçüm zamanı ve provenance; ayrıca servis bazında tarama sonucu, kapsam kaybı ve "temiz denebilir mi" hükmü.',
    status: 'AVAILABLE', layer: 'DTC gözlem otoritesi (03/07/0A/19/18)',
    note: 'SALT-OKUNUR: tarama BAŞLATMAZ, OBD komutu GÖNDERMEZ, timer KURMAZ; yalnız `dtcAuthority` defterini açılışta bir kez ve elle YENİLE ile okur. NEDEN VAR (ölçülen kusur): DTC sonuçları SEKİZ ayrı state/store/model içinde yaşıyordu — `dtcService._state.codes` (yalnız Mode 03) · `_lastScan` · `dtcScanEvidence` · `dtcClearEvidence` · `multiEcuScan` raporu (panelin YEREL state’i) · DTCPanel yerel state · UDS 0x19 · KWP 0x18 — ve hiçbiri diğerini bilmiyordu. Yanlış tüketici yalnız klasik `codes` dizisine bakıyor, multi-ECU / bekleyen / kalıcı / üretici bulgularını KAÇIRIYORDU. DAHA KÖTÜSÜ: boş dizi sessizce "araç temiz" hükmüne dönüşüyordu — `commandExecutor._buildDTCSpeech`, `platformCoreMaviVoiceWiring`, `maviTools.read_dtc` ve `useAssistantContextStore` dört ayrı yerde `codes.length === 0` görünce "Araç sistemleri temiz, sorun yok" diyordu; bu dört yol da OKUMA YAPILIP YAPILMADIĞINA BAKMIYORDU, yani ECU sustuğunda ve tarama hiç koşmadığında da AYNI cümle çıkıyordu. SÖZLEŞME: "0 kod" YALNIZ ilgili servis GERÇEKTEN başarılı tarandıysa anlamlıdır; hiçbir tüketici `observations.length === 0` ile "temiz" DİYEMEZ — hüküm `evaluateVehicleDtcVerdict()` tek otoritesinden gelir ve dört değer üretir (issues · clean · unproven · not_scanned). BİLGİ KAYBI YASAK: dedup anahtarı kod + SINIF + ECU’dur, bu yüzden aynı kod iki farklı ECU’da İKİ gözlemdir ve aynı kod hem bekleyen hem onaylanmış olabilir — biri diğerini EZMEZ. ALTI SONUÇ SINIFI BİRLEŞTİRİLMEZ: ok · NO DATA · desteklenmiyor · zaman aşımı · düştü · hiç sorulmadı; `unsupported` KAPSAM KAYBI DEĞİLDİR (araçta o servis yok — ölçülmüş gerçek) ve temizliği engellemez, gerisi engeller. ROL KANITTAN ÇIKAR: `unknown` bir rol değil kanıt yokluğudur → `null` kalır, adresten rol UYDURULMAZ. OTURUM MÜHRÜ: yeni epoch yazmaya başladığında eski oturumun gözlemleri DÜŞER (araç değişmiş olabilir); aynı oturumda ikinci tarama (silme sonrası yeniden okuma dâhil) gözlemleri turun başında temizler ama servis sonuçlarını KORUR — hüküm tur ortasında "hiç taranmadı"ya kaçmaz. GİZLİLİK: yalnız OBD protokol verisi (kod · sınıf · ECU adresi/rolü · protokol numarası); VIN, konum ve kullanıcı verisi bu deftere GİRMEZ. Gerçek araç doğrulaması YAPILMADI (kütük #810-#812).',
  },
  {
    id: 'obd-data-bridge', category: 'vehicle', name: 'OBD Veri Köprüsü',
    desc: 'Zaten okunabilen OBD sinyallerinin kanonik VehicleDataLayer’a taşınmasının salt-okunur gözlemi: köprünün ayakta olup olmadığı · çekirdek ve genişletilmiş yoldan yapılan mağaza yazımı adedi · sentinel yüzünden elenen değer sayısı · 34 kanonik sinyalin her biri için ÖLÇÜM ve durum (AKIYOR · BAYAT · ARAÇ VERMİYOR · DESTEKLENMİYOR · SORULUYOR) · paylaşılan beş büyüklükte hangi kaynağın (CAN mı OBD mi) otorite olduğu · ELM327 hattına gerçekte kaç PID gittiği · SİNYAL BAŞINA tazelik: LIVE/STALE/UNAVAILABLE durumu, ölçümün yaşı, o sinyale özgü eşik ve son güncelleme saati.',
    status: 'AVAILABLE', layer: 'OBD-II Mode 01 -> VehicleDataLayer',
    note: 'SALT-OKUNUR: PID sorgulamaz, izleyici kurmaz, köprüyü başlatmaz/durdurmaz, mağazaya yazmaz, BURST açmaz, araca komut göndermez, timer kurmaz. NEDEN VAR: ölçüm, StandardPidRegistry’nin 101 PID çözebildiğini ama okunan değerlerin extendedPidService içinde KALDIĞINI gösterdi — ObdAdapterData yalnız 6 alan taşıyordu ve safetyStateMapper motor ısısı ile akü voltajını YALNIZ canCoolantTemp/canBatteryVolt’ten okuyordu; CAN’ı olmayan (aftermarket ELM327’li) araçta Guardian’ın aşırı ısınma ve akü kuralları KALICI OLARAK ÖLÜYDÜ. İKİNCİ ÖLÇÜM: _watchAllSupportedPids 16’lık tavanı ARTAN PID NUMARASIYLA dolduruyor, sekiz O2 voltajı (14-1B) slotları tüketiyor, yağ sıcaklığı (5C) · modül voltajı (42) · ortam ısısı (46) · yakıt debisi (5E) listeye HİÇ giremiyordu; ayrıca kayıtta TANIMI OLMAYAN PID’ler (02/03/13/1D) tele hiç gitmedikleri hâlde slot harcıyordu. ÜÇ DURUM BİRLEŞTİRİLMEZ: AKIYOR · ARAÇ VERMİYOR (bitmap destekli der ama ECU susuyor) · DESTEKLENMİYOR (araç PID’i hiç tanımıyor). SAHTE VERİ YASAK: -1 sentinel’i ve sonlu olmayan değer mağazaya YAZILMAZ; bağlantı düşünce anahtarlar 0’a çekilmez, KALDIRILIR (0 °C yağ sıcaklığı bir ÖLÇÜMDÜR ve kural tetikler). TEK OTORİTE: aynı fiziksel veri için CAN → OBD → yok kararı canonicalVehicleSignal.ts’te TEK yerdedir; useBatteryVoltage ve safetyStateMapper artık kendi önceliklerini yazmaz. TRAFİK BÜTÇESİ DEĞİŞMEDİ: katalog 30 genişletilmiş sinyal tanımlar ama native tur başına EN FAZLA 1 PID okur ve tele giden liste ELM_WATCH_CAP (16) ile kapılıdır — 101 PID sürekli poll EDİLMEZ. P0-OBD-02 (TAZELİK): eşik artık TÜM PID’lerde SABİT 15 sn DEĞİL — sinyalin kararının gerektirdiği sınıftan (hot · medium · slow · archival) ve GERÇEK okuma kadansından türer; genişletilmiş grup turda yalnız 1 PID okuduğu için 16 PID izlenirken sağlıklı yaş ~16 sn’dir ve eski sabit eşik çalışan bir PID’i ’bayat’ ilan ediyordu. İKİ AŞAMA: LIVE → STALE (eşik) → UNAVAILABLE (eşiğin 3 katı); STALE değer GÖSTERİLİR ama KARARA GİRMEZ (Guardian ve akü koruması resolveLiveCanonicalSignal kullanır). OTURUM KAPISI YAŞTAN ÖNCE: ölçüm başka bir OBD oturumuna aitse 2 saniyelik bile olsa DÜŞÜRÜLÜR (adaptör başka araca takılmış olabilir) — reconnect’te hem extendedPidService._values hem mağaza temizlenir. TIMER YOK: hüküm OKUMA ANINDA verilir, çünkü bayatlatma zamanlayıcısı WebView arka plandayken çalışmaz ve dönüşte donmuş değer canlı görünürdü. NEGATİF SICAKLIK: kabul kuralı artık ’v<0’ değil, TAM DEĞER sentinel (-1) + sinyale özgü fiziksel bant → soğuk iklimde gerçek −12 °C ortam sıcaklığı artık KAYBOLMUYOR (kör nokta 41 °C’den 1 °C’ye indi). Gerçek araç doğrulaması YAPILMADI (kütük #724-#733).',
  },
  {
    id: 'signal-provenance', category: 'vehicle', name: 'Sinyal Kaynak İzi',
    desc: 'Digital Twin\'in ilk gerçek katmanının salt-okunur gözlemi: izlenen her sinyalin ÜRETİCİSİ (OBD · CAN · GPS · harmanlanmış · türetilmiş · diskten) · yazım sayısı · son yazım yaşı ve durumu (AKIYOR · BAYAT · HİÇ YAZILMADI) · kaynağı bildirilmemiş sinyal adedi.',
    status: 'AVAILABLE', layer: null,
    note: 'SALT-OKUNUR: sinyal yazmaz, damga basmaz, defteri temizlemez, araca komut göndermez, timer kurmaz. NEDEN VAR: vizyon belgesi `UnifiedVehicleStore` için "gerçek Digital Twin değildir — yalnız anlık sinyal aynasıdır; provenance eksiktir" diyordu ve ölçüm bunu doğruladı — `gpsSource` DIŞINDA hiçbir sinyalde "bu değer nereden geldi, ne zaman ölçüldü" bilgisi YOKTU. Kaynağı bilinmeyen bir değerle KARAR vermek zero-trust telemetrinin ihlalidir. ÜÇ DURUM BİRLEŞTİRİLMEZ: AKIYOR · BAYAT · HİÇ YAZILMADI — sonuncusunu "bayat" saymak, hiç gelmemiş bir sinyali "gelmiş ama eskimiş" göstermek olurdu (iki tamamen farklı arıza) ve hiç yazılmamış alanda yaş HESAPLANMAZ (sahte 56 yıllık yaş üretilmez). "OKUNAMADI" ile "sinyal yok" da AYRIDIR. `speed` bilinçli olarak HARMANLANMIŞ (fused) işaretlenir — tek üreticiye indirgemek yalan olurdu. MİMARİ: kaynak izi PARALEL bir defterdir; değer alanları DEĞİŞTİRİLMEDİ, mağazayı okuyan hiçbir bileşen etkilenmedi (çok-sistemli refactor YASAĞI). HOT-PATH GÜVENLİĞİ: defter önceden dolu tutulur (sonradan anahtar eklenmez → V8 hidden-class geçişi yok), yazma yolunda TAHSİS YOKTUR ve zaman damgası yama başına BİR KEZ alınır. Gerçek araç doğrulaması YAPILMADI (kütük #708).',
  },
  {
    id: 'prediction-engine', category: 'vehicle', name: 'Öngörü Motoru',
    desc: 'Anayasanın 6. kapısının ("5 dk sonra ne olacak?") salt-okunur gözlemi: koşucunun çalışıp çalışmadığı · bütçe sınıfı ve periyodu · tik sayacı ve son tik yaşı · sinyal başına biriken örnek sayısı · kanıt eşikleri · atlanan örnekler (bayat / sensör yok) · tampon temizliği · kural başına durum ve gerekçe.',
    status: 'AVAILABLE', layer: null,
    note: 'SALT-OKUNUR: koşucuyu başlatmaz/durdurmaz, tik tetiklemez, örnek eklemez, tampon temizlemez, kural veya eşik değiştirmez, araca komut göndermez, timer kurmaz. ÜÇ DURUM BİRLEŞTİRİLMEZ: TAHMİN VAR · KANIT YETERSİZ · SİNYAL KAYNAĞI YOK. Üçüncüsü en önemlisidir — sessizce boş bırakmak "kural çalışıyor ama arıza yok" izlenimi verirdi; oysa gerçek "hiç bakılmıyor"dur. MOTOR FAIL-CLOSED: yetersiz örneklem, zayıf uyum (R² eşiği), yanlış yön veya ufuk dışı varışta SUSAR — sahte tahmin ÜRETİLMEZ ve bu ekran o kararı DEĞİŞTİRMEZ. ÖRNEKLEM DÜRÜSTLÜĞÜ: bayat veri örneklenmez (duran sayı sahte "trend yok" üretir ve gerçek yükselişi maskeler), sensör okunamazsa örnek alınmaz (sahte 0 bir ÖLÇÜM DEĞİLDİR), araç/bağlantı değişince tampon SIFIRLANIR (iki farklı aracın değerlerini aynı doğruya uydurmak uydurma trend üretir). Atlanan her örnek SAYILIR — sessiz atlama yoktur. BÜTÇE: koşucu SOĞUK YOLDA çalışır (15 sn) ve 3 Hz hot-path\'e HİÇ dokunmaz; ama görev SAFETY kritikliğindedir — aşırı ısınma uyarısı düşük-uç cihazda YAVAŞLATILMAZ (anayasa: güvenlik katmanı her tier\'da açık). Gerçek araç doğrulaması YAPILMADI (kütük #706).',
  },
  {
    id: 'deep-scan', category: 'vehicle', name: 'Derin Tarama',
    desc: 'Çok fazlı ECU/firmware derin tarama orkestrasyonunun SALT-OKUNUR gözlemi: iki ayrı akış (tarama runtime durum makinesi ve SystemBoot wiring) YAN YANA; durum · mod · faz · ilerleme · kontak · bulunan ECU/PID/DID adedi · yeni keşif · firmware/ECU değişimi · çevrimdışı geçiş tetik sayacı ve son sonuç.',
    status: 'AVAILABLE', layer: 'UDS',
    note: 'TARAMA BAŞLATMAZ: `startScan` · `triggerDeepScanOfflinePass` · `startPlatformCoreDeepScanWiring` · `reset` ve `cancel` ÇAĞRILMAZ; ekranı açmak araca tek bir sorgu bile göndermez. ESKİ GEREKÇE ARTIK GEÇERSİZ: katalog bu aracı "tek ve güvenli giriş noktası yok, iki ayrı akış var" diye PLACEHOLDER tutuyordu — o gerekçe taramayı ÇALIŞTIRMAK için geçerlidir, GÖZLEMLEMEK için değil; üstelik asıl teşhis değeri tam olarak o iki akışın yan yana görülmesindedir. YENİ ÜÇÜNCÜ GİRİŞ NOKTASI AÇILMADI. İLERLEME YALNIZ YÜRÜRKEN ANLAMLIDIR: boşta %0 bir İLERLEME DEĞİL, "hiç başlamadı" demektir ve öyle gösterilir. KONTAK FAIL-CLOSED: otoriter kaynak yoksa BİLİNMİYOR yazar, "kapalı" DEMEZ. Kablo kurulu değilse ekran bunu GİZLEMEZ (KABLO YOK — bu cihazda tetiklenemez). GİZLİLİK: VIN, ham ECU/PID/DID listesi, uyarı ve hata METİNLERİ bu ekrana GELMEZ — yalnız adet · enum · faz · yüzde · damga; parmak izi yalnız ilk 12 karakter. Damgasız alan yaş ÜRETMEZ. Gerçek araç doğrulaması YAPILMADI (kütük #693).',
  },
  {
    id: 'vehicle-fingerprint', category: 'vehicle', name: 'Araç Parmak İzi',
    desc: 'Kayıtlı araç kimliği (hash, öğrenilmiş protokol, ECU adresleri), desteklenen PID/DID kanıtları ve keşif deposunun salt-okunur özeti.',
    status: 'AVAILABLE', layer: null,
    note: 'Araca SORGU GÖNDERMEZ: VIN okuma / DID sorgusu / tarama tetiklenmez, yalnız zaten kalıcı olan kayıtlar okunur. Ham VIN, plaka ve adaptör MAC ekrana HİÇ gelmez — yalnız geri çevrilemez özetler. Kimlik kaydı yoksa fail-closed KAYNAK YOK gösterilir.',
  },
  {
    id: 'device-identity', category: 'vehicle', name: 'Cihaz Kimliği & E2E Anahtar',
    desc: 'Cihaz kimliğinin reinstall dayanıklılığı (kaynak · türetme · zayıf rastgelelik) ve E2E açık anahtar yayınının salt-okunur gözlemi.',
    status: 'AVAILABLE', layer: null,
    note: 'YAYIN TETİKLEMEZ: publish_device_public_key ÇAĞRILMAZ, kimlik üretilmez/sıfırlanmaz, eşleştirme yapılmaz, komut gönderilmez — ekranı açmak sunucuya tek istek bile göndermez. GİZLİLİK: veh_api_key, cihaz kimliğinin KENDİSİ, E2E açık anahtarın içeriği ve ham SSAID bu ekrana HİÇ gelmez; yalnız VAR/YOK · adet · durum adı · zaman farkı. FAIL-CLOSED: yayın kanıtı yoksa UNAVAILABLE yazar, "çalışıyor" DEMEZ. Gerçek araç doğrulaması YAPILMADI (kütük #723).',
  },
  /* ── Communication ───────────────────────────────────────────────────── */
  {
    id: 'raw-obd-traffic', category: 'communication', name: 'Ham OBD Trafiği',
    desc: 'Native adaptör trafiği: komut / yanıt / gecikme (ms). Yalnız OKUR — komut göndermez.',
    status: 'AVAILABLE', layer: 'ELM327',
    note: null,
  },
  {
    id: 'can-monitor', category: 'communication', name: 'CAN İzleyici',
    desc: 'Ham CAN frame kütüğü (id + payload), panel açıkken toplanır.',
    status: 'AVAILABLE', layer: 'CAN',
    note: null,
  },
  {
    id: 'kwp-monitor', category: 'communication', name: 'KWP İzleyici',
    desc: 'KWP2000/ISO9141 uygulanabilirliği, oturum tazeliği, native kurtarma merdiveni (ATPC) sayaçları ve TANI OTURUMU PROBU (servis 0x10 — `10 81` → `50 81`, gerekirse `10 C0` → `50 C0`) kanıtının salt-okunur izlenmesi: gönderilen istek · ham yanıt · ölçülen sonuç (POSITIVE / NEGATIVE+NRC / NO_RESPONSE / MALFORMED / TRANSPORT_ERROR / NOT_ATTEMPTED). Fiziksel adreslenebilirliği ve KWP 0x18 zincirini YALNIZ pozitif oturum kanıtı açar.',
    status: 'AVAILABLE', layer: 'KWP2000',
    note: 'Keep-alive (ATWM/ATSW/ATST) JS tarafına AÇILMAMIŞTIR — yalnız native ElmInitSequencer içinde yaşar; o alanlar KAYNAK YOK gösterilir. Ekran kurtarma TETİKLEMEZ, yalnız izler.',
  },
  {
    id: 'uds-explorer', category: 'communication', name: 'UDS Gezgini',
    desc: 'UDS servis/alt-fonksiyon gezgini, NRC çözümleme.',
    status: 'PLACEHOLDER', layer: 'UDS / ISO 14229',
    note: 'Ekran yok. İstek üreten bir gezgin güvenlik incelemesi gerektirir (Faz A2).',
  },
  {
    id: 'remote-command', category: 'communication', name: 'Uzak Komut Zinciri',
    desc: '"Arabam Cebimde" telefonundan gelen komutların araç tarafındaki salt-okunur kanıt defteri: dinleyici bağlı mı · alınan/tamamlanan/reddedilen/başarısız komut sayıları · yeniden deneme ve TTL aşımı · KAPI SAYAÇLARI (E2E şifre kapısı · sürüş güvenliği kapısı · tanımsız komut tipi) · son komutun TİPİ ve sonucu · hız otoritesi (abonelik durumu, işlenen örnek, güvenlik kapısına verilen ölçüm, hız ölçülemeyen anlar) · araçtaki geçerli hız uyarısı ayarı, üretilen ve cooldown ile bastırılan uyarılar, bildirim kanalının bağlı olup olmadığı.',
    status: 'AVAILABLE', layer: 'Supabase Realtime',
    note: 'Hiçbir şey BAŞLATMAZ: komut GÖNDERMEZ, dinleyiciyi yeniden BAĞLAMAZ, hız uyarısı ayarını DEĞİŞTİRMEZ, bildirim TETİKLEMEZ, ağ çağrısı YAPMAZ — açılışta tek okuma + elle YENİLE. GİZLİLİK: komut payload verisi, nonce, api_key, E2E anahtar malzemesi, komut ve araç kimliği (UUID), koordinat ve hedef adres bu ekrana TAŞINMAZ; yalnız sayılar, komut TİPİ, durumlar ve zaman yaşları görünür. DÜRÜSTLÜK: "komut çalışmadı" tek sebep değildir — dinleyici yok · şifre kapısı · güvenlik kapısı · tanımsız tip AYRI hükümlerdir. "Tamamlandı" sayacı aracın komutu YÜRÜTTÜĞÜNÜ gösterir, fiziksel eylemin (kapı gerçekten kilitlendi mi) olduğunu KANITLAMAZ. Sayaçlar oturumludur, diske yazılmaz. Telefon tarafındaki kuyruk burada GÖRÜNMEZ. Gerçek araç doğrulaması YAPILMADI.',
  },
  {
    id: 'session-inspector', category: 'communication', name: 'Oturum Denetçisi',
    desc: 'Oturum durumunun 6 katmanlı salt-okunur görünümü: transport · handshake · data gate · KWP · HAL · runtime. Her değer OBSERVED/DERIVED/UNAVAILABLE/STALE işaretli; kaynak çelişkileri ayrı gösterilir.',
    status: 'AVAILABLE', layer: null,
    note: null,
  },
  {
    id: 'phone-hub-probe', category: 'communication', name: 'Phone Hub Hardware Probe',
    desc: "Head unit'in gerçek Bluetooth/A2DP/HFP, üretici-MCU ve ses yolu yeteneklerinin salt-okunur gözlemi + OBD eşzamanlılık çakışma değerlendirmesi.",
    status: 'AVAILABLE', layer: 'Bluetooth',
    note: 'Hiçbir şey BAŞLATMAZ: keşif/tarama, eşleştirme, bağlantı, SCO, ses yolu değişimi, medya/çağrı komutu, izin isteği ve OBD müdahalesi YOK. "Bağlı görünmek" yetenek kanıtı DEĞİLDİR — kontrol otoritesi ayrı gösterilir. MAC, cihaz adı ve kişisel veri GÖSTERİLMEZ.',
  },
  {
    id: 'phone-hub-field-validation', category: 'communication', name: 'Phone Hub Saha Doğrulama',
    desc: "Araç geldiğinde Phone Hub donanım gerçeklerini adım adım doğrulayan saha test aracı: cihaz rolü kapısı, beş senaryo (baseline · telefon · telefon medyası · OBD · telefon+OBD), kanıta dayalı otorite kararları, OBD eşzamanlılık hükmü ve PII'siz JSON dışa aktarma.",
    status: 'AVAILABLE', layer: 'Bluetooth / Telecom / MediaSession',
    note: 'Hiçbir şey BAŞLATMAZ: eşleştirme, keşif/tarama, BLE scan, RFCOMM, SCO, ses yolu/modu değişimi, medya-transport komutu, çağrı, SMS, izin isteği ve vendor bind YOK. Her ölçümü KULLANICI elle başlatır. UNKNOWN varsayılandır; kanıt yoksa hiçbir alan başarılı gösterilmez. Cihaz TELEFON olarak doğrulanırsa saha aşamaları KİLİTLENİR — telefonda alınan ölçüm head unit sonucu SAYILMAZ. Kullanıcı beyanı yalnız kanıt kaydıdır, teknik kanıtın yerine GEÇMEZ. Kayıt YALNIZ yereldir (uzak sunucuya gönderim yok).',
  },
  {
    id: 'phone-hub-link', category: 'communication', name: 'Phone Hub Canlı Bağlantı',
    desc: "RFCOMM control-plane bağlantısının canlı tanısı: sunucu durumu, el sıkışma aşaması, protokol/yetenek anlaşması, şifreli oturum, kalp atışı, çerçeve ve güvenlik sayaçları, PII'siz olay defteri.",
    status: 'AVAILABLE', layer: 'RFCOMM / AES-GCM',
    note: 'Düğmeler YALNIZ CAROS\'un KENDİ Phone Hub sunucusunun yaşam döngüsünü yönetir; araca, ECU\'ya veya OBD\'ye hiçbir komut GÖNDERİLMEZ. Bluetooth açılmaz/kapatılmaz, tarama ve eşleştirme BAŞLATILMAZ, OBD soketine dokunulmaz. Doğrulama kodu, oturum anahtarı, MAC, cihaz adı ve ham yük bu ekranda GÖSTERİLMEZ. "Bağlandı" yalnız şifreli oturum gerçekten kurulduğunda yazılır. Telefon+OBD eşzamanlılığının gerçek etkisi FIELD_TEST_REQUIRED olarak AÇIK bırakılmıştır — kod izolasyonu bunu kanıtlamaz.',
  },
  {
    id: 'obd-signal-health', category: 'communication', name: 'OBD Sinyal Sağlığı',
    desc: 'Kritik PID’lerin sağlık gözlemi: son kabul edilen ölçümün YAŞI · gözlenen yenileme aralığı · o sinyale özgü stall eşiği · hata NEDENİ (NO DATA · reddedilen değer · yenileme durdu · yavaş) ve tek cümlelik hat hükmü (HEALTHY · DEGRADED · STALLED · DISCONNECTED). Tüm ölçümler MEVCUT poll akışından türetilir; ELM327’ye tek ek sorgu gitmez.',
    status: 'AVAILABLE', layer: 'OBD veri akışı',
    note: 'SALT-OKUNUR: sorgu göndermez, poll yapılandırmasını değiştirmez, reconnect tetiklemez, timer kurmaz. NEDEN AYRI EKRAN (Adaptör Tanılama varken): o ekran TAŞIMA sorusuna bakar (RFCOMM/BLE canlı mı, oturum bayrakları, yaşam döngüsü); bu ekran VERİ sorusuna bakar. İkisi AYNI ŞEY DEĞİLDİR ve bu turun kapattığı kusur tam olarak budur: taşıma açıkken TEK BİR PID donmuş olabilir ve o durumda ’Bluetooth bağlı’ cevabı yanıltıcıdır. İKİ AYRI SORU: STALL (beklenen yenileme GELMİYOR) bir arızadır; FREEZE (ölçüm geliyor ama değer sabit) TEK BAŞINA ARIZA DEĞİLDİR — park hâlinde hız ve devir sabit kalır, bu yüzden freeze bir GÖZLEM olarak gösterilir ve sağlık durumunu DÜŞÜRMEZ. SINIF FARKI: sıcak sinyaller (hız/devir/gaz kelebeği/manifold) saniyeler içinde stall sayılır, yavaş sinyaller kendi kadanslarına göre değerlendirilir — aksi hâlde 15 sn’de bir okunan bir sıcaklık haksız yere ’durdu’ görünürdü. DÖRT NEDEN AYRI: bağlantı yok · hiç ölçüm gelmedi · NO DATA · reddedilen değer · yenileme durdu · yavaş. İKİNCİ SAĞLIK SİSTEMİ KURULMADI: mevcut ObdHealthMonitor alan zamanlamasıyla genişletildi, eşik matematiği obdFreshnessPolicy’den yeniden kullanıldı, dataFresh/transportConnected otoritesi korundu. OTURUM: reconnect’te alan zamanlaması DÜŞER — yeni ölçüm gelmeden hiçbir alan taze sayılamaz. Gerçek araç doğrulaması YAPILMADI (kütük #749-#753).',
  },
  {
    id: 'adapter-diagnostics', category: 'communication', name: 'Adaptör Tanılama',
    desc: 'ELM327/Bluetooth taşıma ve OBD oturum sağlığının salt-okunur görünümü: transport, oturum bayrakları, yaşam döngüsü sayaçları ve iki AYRI sağlık motorunun ayrı ayrı hükmü.',
    status: 'AVAILABLE', layer: 'ELM327',
    note: 'AT/OBD komutu GÖNDERMEZ (adaptör kimlik sorgusu ATI/ATZ dahil), reconnect/reset/recovery tetiklemez. Adaptör adı/adresi/seri numarası GÖSTERİLMEZ. RSSI, native buffer doluluğu, klon/orijinal hükmü ve gelişmiş BLE tanısı için JS kaynağı YOKTUR — KAYNAK YOK gösterilir.',
  },
  {
    id: 'vdk-replay', category: 'communication', name: 'VDK Replay',
    desc: 'Doğrulanmış bir kanonik izin (caros.vdk.trace.v1) ürünün NORMAL tanı yolu üzerinde yeniden çalıştırılmasının salt-okunur sonucu: koşu kimliği ve modu (FAST/TIMED), teslim muhasebesi (eşleşen · uyuşmayan · tükenen · ölçülmemiş · iptal), parite hükmü, izolasyon (canlı defter kirlendi mi) ve ileride kullanılacak yapısal boşluk sinyalleri.',
    status: 'AVAILABLE', layer: 'VDK / iz',
    note: 'SALT-OKUNUR: replay BAŞLATMAZ/DURDURMAZ, iz dosyası okumaz/import etmez, AT/OBD komutu göndermez, timer kurmaz. Replay AKTİFKEN ürün hiçbir tanı çağrısını canlı hatta göndermez ve yazdığı iz satırları `replay` damgası taşır — canlı ölçümle karışmaz. Replay DTC ÜRETMEZ: ham yanıtı mevcut çözümleyiciye, hükmü mevcut otoriteye bırakır. ÖLÇÜLEN KATMAN SINIRI: fonksiyonel Mode 03/07/0A çözümleyicisi NATIVE taraftadır (ElmProtocol.parseDtcResponse); o yolda replay ham gövdeyi teslim eder ama kod üretemez ve sonucu fail-closed KAPSAM KAYBI sayar — "0 kod / temiz" DEMEZ. Üretici zinciri (UDS 0x19 · KWP 0x18/0x13) tam çalışır. Gerçek araç doğrulaması YAPILMADI (kütük #861-#865).',
  },
  {
    id: 'cddl-inventory', category: 'developer', name: 'CDDL Envanteri',
    desc: 'Tanı tanım katmanının (CDDL v1) salt-okunur envanteri: ServiceDef · EcuVariant · VariantPattern · DataObjectProp · ComParam · ProcedureDef · DtcCatalogEntry sayıları, belge doğrulama sonucu, kaynak güven sınıfı dağılımı (builtin/learned/byod) ve legacy köprü durumu.',
    status: 'AVAILABLE', layer: 'CDDL / tanım',
    note: 'SALT-OKUNUR: profil YÜKLEMEZ/İÇE AKTARMAZ, prosedür ÇALIŞTIRMAZ, AT/OBD komutu göndermez, timer kurmaz. MEVCUT PROFİL SİSTEMİ SİLİNMEDİ: oemEcuProfile/oemProfileMatch/oemProfileRegistry/vehicleDidProfile/protocolProfile OTORİTE olarak kalır; köprü TEK YÖNLÜDÜR (legacy → CDDL) ve CDDL belgesinin ayrı deposu YOKTUR (her okumada yeniden kurulur). Bu fazda ürün yoluna YALNIZ `builtin` kaynak girer — `learned`/`byod` modelde tanımlıdır ama ürün yoluna GİRMEZ (F4) ve doğrulayıcı onları reddeder. `ProcedureDef` yalnız BİLDİRİMDİR: yürütücü YAZILMADI ve yazılmadığı testle kilitli. `ComParam` zaman aşımlarını VERİ olarak temsil eder ama runtime davranışını SÜRMEZ (otorite protocolProfile). Destructive servisler (yazma/aktüatör/reset/security) varsayılan REDDEDİLİR ve PDU üretmez. Ham VIN ekrana GELMEZ (yalnız WMI öneki ve VDS deseni). Gerçek araç doğrulaması YAPILMADI (kütük #878-#881).',
  },
  /* ── Runtime ─────────────────────────────────────────────────────────── */
  {
    id: 'queue-monitor', category: 'runtime', name: 'Kuyruk İzleyici',
    desc: 'Çalışma Zamanı Zamanlama ortak görünümü: 6 ayrı runtime otoritesi (command execution · live polling · handshake · KWP · discovery/deep scan · CAN collection) salt-okunur listelenir.',
    status: 'AVAILABLE', layer: null,
    note: "Native komut kuyruğunun DERİNLİĞİ JS'e açılmamıştır; o alan UNAVAILABLE olarak gösterilir (boş kuyruk varsayılmaz).",
  },
  {
    id: 'poll-scheduler', category: 'runtime', name: 'Sorgu Zamanlayıcı',
    desc: 'Çalışma Zamanı Zamanlama ortak görünümü (Kuyruk İzleyici ile aynı ekran): poll zamanlayıcısı, tazelik kapısı ve native poll kanıtı salt-okunur.',
    status: 'AVAILABLE', layer: null,
    note: 'Aktif poll kadansı UNAVAILABLE: computeObdPollProfile saf bir fonksiyondur, hesaplanan profil hiçbir yerde saklanmaz.',
  },
  {
    id: 'recovery-monitor', category: 'runtime', name: 'Kurtarma İzleyici',
    desc: 'ECU susma kurtarmasının salt-okunur gözlemi: aktif protokolde kurtarmanın SAHİBİ hangi motor (CAN merdiveni mi native ATPC mi) · merdivenin sekiz kapısı KOD SIRASIYLA ve ilk DURDURAN kapı · kullanılan deneme / tavan · ardışık ECU sessizliği ve eşiği · sıradaki ve son tırmanılan basamak · cooldown kalanı · native ATPC sayaçları ve kanıt yaşı · reconnect yaşam döngüsü · kopma defterinden ÖLÇÜLMÜŞ kurtarma süresi (medyan/en kötü).',
    status: 'AVAILABLE', layer: 'ELM327 / CAN · KWP2000',
    note: 'Hiçbir şey BAŞLATMAZ ve KARAR VERMEZ: kurtarma tetikleme, kapı zorlama, cooldown sıfırlama, tavan açma, reconnect başlatma, ATPC gönderme, araca komut ve timer YOK. YENİ SAYAÇ ÜRETİLMEZ — mevcut durum değişkenleri yansıtılır (çift sayım imkânsız). İKİ MOTOR BİLEREK AYNI ANDA ÇALIŞMAZ: CAN\'de TS merdiveni, KWP/ISO9141\'de native ATPC otoritedir; "diğer motor sessiz" bir arıza DEĞİL tasarımdır (çift ATPC oturumu sürekli kapatır). İLK DURDURAN KAPIDAN SONRASI "GEÇTİ" DİYE GÖSTERİLMEZ — kodda erken `return` var, sonraki koşullar HİÇ hesaplanmaz; olmayan bir değerlendirme olmuş gibi sunulamaz. KANITSIZ GEÇİŞ AYRI İŞARETLENİR: ATRV okunamadığında kontak kapısı kurtarmayı engellemez ama bu "motor çalışıyor" DEMEK DEĞİLDİR (GEÇTİ (KANITSIZ)). Native KWP kanıtı BU EKRANDA TAZELENMEZ (async native pull; salt-okunur sözleşmesi) — "TÜMÜNÜ YENİLE" doldurur, bu yüzden kanıt YAŞI her zaman gösterilir (#642: bayat NOT_ATTEMPTED taze kanıt gibi sunulmuştu). Süre ve damga UYDURULMAZ: `lastRecoveryAt=0` "hiç" demektir ("0 ms önce" değil), saat geriye sıçrarsa cooldown kalanı hesaplanmaz. GİZLİLİK: VIN, adaptör MAC, cihaz adı, ham çerçeve ve ham komut GELMEZ. Gerçek araç doğrulaması YAPILMADI (kütük #689).',
  },
  {
    id: 'evidence-viewer', category: 'runtime', name: 'Kanıt Görüntüleyici',
    desc: 'Mevcut kanıt kaynaklarının birleşik salt-okunur görünümü: olay izi + AI Core kanıtları + doğrulama kütüğü.',
    status: 'AVAILABLE', layer: null,
    note: null,
  },
  {
    id: 'route-layer-inspector', category: 'runtime', name: 'Rota Katman Denetçisi',
    desc: 'Rota katman yığınının GERÇEK paint sözleşmesi: her katmanın line-color / line-gradient / line-opacity / line-blur / z-sırası, kaynağın lineMetrics durumu ve `resolveRouteColor` kararıyla karşılaştırma. #622\'de rota ekranda soluk ölçüldü ama kök CDP kapalı olduğu için teşhis edilemedi — bu ekran sebebi görünür kılar.',
    status: 'AVAILABLE', layer: 'MapLibre GL',
    note: null,
  },
  {
    id: 'performance', category: 'runtime', name: 'Performans',
    desc: 'FPS/bellek örnekleri, runtime modu ve hata sayaçları.',
    status: 'AVAILABLE', layer: null,
    note: null,
  },
  {
    id: 'runtime-mode', category: 'runtime', name: 'Mod Kapilari',
    desc: 'Calisma zamani modunun NEDENI: dort tespit kapisi (cihaz sinifi · GPU sinifi · Worker · SAB+crossOriginIsolated) ham gozlemleriyle, hangisinin KARARI VERDIGI, her birinin yazilimla acilip acilamayacagi; ayrica yururlukteki mod, tespit edilen mod, ikisi arasindaki FARK, guc tavani, kurtarma hedefi, arizali bilesenler ve son mod degisiminin nedeni.',
    status: 'AVAILABLE', layer: null,
    note: 'Hicbir MODU DEGISTIRMEZ: override yazmaz, kapi cevirmez, timer kurmaz - acilista tek okuma + elle YENILE. URETIM YOLU ilk engelleyen kapida DURUR; bu ekran TUMUNU degerlendirir. Tek kapiyi gosterip "onu duzeltirsek acilir" demek YANILSAMADIR: vizyon plani tam olarak buna dustu ve nedeni COEP sandi, oysa kapilar SIRALIDIR ve SAB SONUNCUDUR - hedef donanimda deviceTier/weakGpu cok daha once tetikler, yani COEP acilsa bile mod DEGISMEZ. Bu yuzden "yazilimla acilir mi" sorusuna ancak DONANIM ENGELI KALMADIYSA EVET denir. "Yururlukteki mod" ile "tespit edilen mod" AYRI gosterilir: farkliysa sebep kapilarda DEGIL, devralan bir otoritededir (termal · kullanici · guc tavani · ariza merdiveni). Mod hic degismediyse sahte bir "degisti" kaydi URETILMEZ. Okunamayan kaynak "BASIC_JS" ile KARISTIRILMAZ.',
  },
  {
    id: 'runtime-authority-map', category: 'runtime', name: 'Runtime Otorite Haritasi',
    desc: 'ARCH-01/F0 salt-okunur envanteri: boot, health, recovery, kaynak, domain lifecycle, timer ve shutdown sahipleri; çakışmalar açıkça KNOWN_DEBT olarak görünür.',
    status: 'AVAILABLE', layer: 'SystemBoot / Runtime',
    note: null,
  },
  {
    id: 'security-trust-capability', category: 'runtime', name: 'Security / Trust / Capability',
    desc: 'ARCH-05 principal sınıfı → yetki matrisi, yetenek sözleşmesi + ürün durumu, karar bağlamı (araç kapsamı · doğrulanmış hareket) ve GERÇEK ÜRETİM kararlarının sınırlı/maskelenmiş defteri.',
    status: 'AVAILABLE', layer: 'ARCH-05 / authorization',
    note: 'SALT-OKUNUR: capability grant/revoke, pair, authenticate, command/PDU gönderme, DTC silme, runtime restart, role impersonation ve motion override YOK. GERÇEK KARAR BESLEMESİ: defter sentetik değildir — UI (DTC silme), Mavi (sesli silme reddi), telefon (kontrol komutu), uzak kanal (E2E teşhis), OBD (PDU sınıflandırma), runtime (elle yeniden başlatma) ve ayar uygulama yollarının ÜRETİMDE aldığı kararlar buraya düşer. İKİNCİ OTORİTE DEĞİL: hüküm `security/authorization`, politika `security/enforcement`, araç kapsamı `capabilityStore`, hareket `obdService`, native yüzey ARCH-04 `nativeHalEvidence` sahipliğinde kalır ve bu ekranda hesaplanan hiçbir değer üretim kararına GERİ BESLENMEZ. DÜRÜSTLÜK: DIAGNOSTIC_PRIVILEGED ve REMOTE_INPUT hiçbir principal sınıfına verilmez (DENY_DEFAULT); MAVI_ACTION ve MEDIA_CAST sözleşmede YOK ve NOT_SUPPORTED yazar — uydurulmaz. GİZLİLİK: kimlik, token, VIN, konum, ham payload ve ham PDU gösterilmez; araç yalnız 16 hane parmak izi olarak görünür. Gerçek araç doğrulaması YAPILMADI.',
  },
  {
    id: 'performance-profiler', category: 'runtime', name: 'Performance / Runtime Profiler',
    desc: 'ARCH-06/F1 salt-okunur performans ölçüm düzlemi: boot kilometre taşları, servis başlatma süreleri, JS/render kanıtı, native köprü sayaçları, CAN coalescing kanıtı, timer envanteri ve bellek/cache envanteri.',
    status: 'AVAILABLE', layer: 'ARCH-06 / measurement plane',
    note: 'SALT-OKUNUR: benchmark ÇALIŞTIRMAZ, sayaç SIFIRLAMAZ, mod/tier DEĞİŞTİRMEZ, cache BOŞALTMAZ, servis BAŞLATMAZ, timer KURMAZ. ÖLÇÜM-ÖNCE İLKESİ: bu ekran F1 fazının çıktısıdır ve hiçbir optimizasyon içermez — yalnız "şu an ne kadar hızlıyız ve yük nerede" sorusunun ölçülmüş cevabını gösterir. SAHTE DEĞER YOK: ölçülmeyen her metrik "—" ile gösterilir ve 0 YAZILMAZ; "ölçülemiyor" ile "sıfır" AYRI şeylerdir (eski APK CAN metrik köprüsünü taşımıyorsa durum NOT_SUPPORTED olur, sayaçlar 0 gösterilmez). ENSTRÜMANTASYON BÜTÇESİ: T0 (daima açık tamsayı sayaçlar) · T1 (12 s perfSeriesRecorder) · T2 (YALNIZ bu ekran mount edildiğinde koşan pahalı projeksiyon) — LAB kapalıyken toplama YAPILMAZ. ATTRIBUTION DÜRÜSTLÜĞÜ: tarayıcı long-task için güvenilir sahip vermez; sahte sahip ATANMAZ, owner UNKNOWN kalır. CAN SAYACI YANLIŞ OKUNMASIN: bridge.canData sayacı HAM CAN FRAME HIZI DEĞİLDİR — native 80 ms coalescing + dedup SONRASI olaydır; ham giriş için CAN köprüsü bölümündeki inputCount okunur. TIMER ENVANTERİ BİLDİRİMDİR: bir timer’ın VARLIĞINI söyler, kaç kez UYANDIĞINI SÖYLEMEZ; global setInterval sarmalaması YAPILMADI (sarmak ölçülen sistemi değiştirirdi). BELLEK: targetBytes F1’de DAİMA null — baseline ölçülmeden hedef bayt konulmaz; estimatedBytes null olan kaynak baskı altında EN SON kırpılır. GİZLİLİK: koordinat, VIN, ham PDU, ham CAN yükü, transkript, telefon kimliği ve medya başlığı bu ekrana TAŞINMAZ — yalnız sayılar, birimler ve kapalı sözlükten sınıf adları. Gerçek araç/head-unit doğrulaması YAPILMADI.',
  },
  {
    id: 'runtime-lifecycle-contract', category: 'runtime', name: 'Lifecycle Sozlesmesi',
    desc: 'ARCH-01/F1 salt-okunur canonical state sözlüğü, whitelist transition matrisi, lifecycle/readiness/health ayrımı ve SystemBoot pilot adapter görünümü.',
    status: 'AVAILABLE', layer: 'Runtime lifecycle contract',
    note: null,
  },
  {
    id: 'runtime-service-registry', category: 'runtime', name: 'Servis Registry',
    desc: 'ARCH-01/F2 salt-okunur descriptor registry: SystemBoot kayıtları, lifecycle/readiness/health, dependency metadata, reason ve provenance.',
    status: 'AVAILABLE', layer: 'Runtime lifecycle registry',
    note: null,
  },
  {
    id: 'native-boundary-hal', category: 'runtime', name: 'Native Boundary / HAL',
    desc: 'ARCH-04 native sınırının salt-okunur gözlemi: sekiz kritik kaynak (GPS · MEDIA · PHONE_LINK · OBD · CAN · SAFE_STORAGE · FOREGROUND_SERVICE · HARDWARE_MEDIA) için sahip · köprü · izin · yetenek · hazırlık · oturum/nesil · bayat koruma · son sonuç sınıfı · yedek · köken; kritik native metot pazarlığı (eski APK riski); Phone native giriş merdiveni; OBD/CAN sınır kökeni; SafeStorage tamamlanma aşamaları ve uygunluk matrisi.',
    status: 'AVAILABLE', layer: 'ARCH-04 / HAL',
    note: 'Hiçbir şey BAŞLATMAZ ve hiçbir şey GÖNDERMEZ: izin isteme, servis başlat/durdur, PDU gönderme, oynat/duraklat, Bluetooth açma, geri çağrı enjeksiyonu, fallback zorlama, depo temizleme ve CAN dinleyicisi başlatma YOK — açılışta tek okuma + elle YENİLE. DÖRT AYRIM PAZARLIKSIZ: İZİN VERİLDİ ≠ YETENEK VAR ≠ SERVİS HAZIR ≠ İŞLEM BAŞARILI; ve YEDEK AKTİF ≠ ASIL YOL SAĞLIKLI. KAYNAK BAĞLI ≠ DOMAIN HAZIR: bu ekran kaynak seviyesinde konuşur, domain hükmü kanonik otoritelerde kalır ve buradan hesaplanan hiçbir değer üretim kararına GERİ BESLENMEZ. Köprü erişilebilirliği YETKİLENDİRME DEĞİLDİR — native DiagnosticServiceGate, Phone yetenek izni ve foreground kontrolleri kendi kapılarını korur. GİZLİLİK: VIN, MAC, token, anahtar, eşleştirme materyali, ham PDU/ham yanıt, ham GPS koordinatı, ham medya yolu ve telefon kimliği TAŞINMAZ — yalnız sınıf, sayı, nesil ve VAR/YOK. KAYNAK YOK ≠ false ≠ 0. Gerçek araç doğrulaması YAPILMADI.',
  },
  {
    id: 'capability-gates', category: 'runtime', name: 'Yetenek Kapilari',
    desc: 'Iki uyuyan yetenegin salt-okunur durumu: AI Gateway (izin var mi · izin kaynagi · ana salter · sirket izni · arac izni adedi · saglayici anahtari var mi · sunucu okuma zamani) ve Cevrimdisi Rota (grafik artefakti durumu · deneme sayisi · son deneme · beklenen dosya yolu).',
    status: 'AVAILABLE', layer: null,
    note: 'Hicbir KAPIYI CEVIRMEZ: izin vermez, bayrak degistirmez, ag cagrisi yapmaz, timer kurmaz — acilista tek okuma + elle YENILE. "IZIN VAR" ile "HAZIR" AYRI gosterilir: saglayici anahtari yokken sistem AKTIF GOSTERILMEZ, cunku zincir ilk cagrida duser. AI izni GLOBAL bayraktan gelmez — global bayrak yalniz ANA SALTERdir ve tek basina kimseyi acmaz; etkin izin sirket/arac kapsamli ai_gateway_access kaydindan gelir ve yalniz owner/admin verebilir. Sunucu okunmadiysa kapi KAPALIDIR (fail-closed); okunmadi ile kapali AYRI etiketlenir. Yerel gelistirici kaldiraci kullanildiginda kaynak LOCAL_OVERRIDE olarak ACIKCA gorunur — gizli acilis YOKTUR. Cevrimdisi rota icin SAHTE BASARI URETILMEZ: grafik artefakti (/maps/routing-graph.bin) yoksa durum GRAPH_MISSING yazar, duz-hat yedegi ACIKCA "duz hat" olarak etiketlenir ve ASLA "cevrimdisi rota" diye sunulmaz; kalici hatada worker bir daha bosuna ayaga kaldirilmaz. API ANAHTARI GOSTERILMEZ — yalniz VAR/YOK. Gercek arac dogrulamasi YAPILMADI (BLOCKED_REAL_VEHICLE).',
  },
  {
    id: 'media-authority', category: 'runtime', name: 'Medya Otoritesi',
    desc: 'Tek native playback authority (CarosPlaybackService · ExoPlayer · MediaSession · AudioFocus) salt-okunur gözlemi: oynatma gerçeği, ses odağı, ses yolu, ducking, kuyruk, komut kanıtı ve kurtarma kararı.',
    status: 'AVAILABLE', layer: 'Media3',
    note: 'Oynatma komutu GÖNDERMEZ (çal/duraklat/geç/seek yok), kaynak değiştirmez, ses/duck değiştirmez, kurtarma tetiklemez, servis başlatmaz. Parça başlığı, sanatçı, URI ve kapak bu ekrana TAŞINMAZ — yalnız "metadata var mı" bilgisi ile sayılar okunur. "Komut kabul edildi" ile "ses çıkıyor" AYRI gösterilir: ses kanıtı (render + odak + seviye) yoksa sonuç YALNIZ İSTEK olarak yazılır. YouTube, Spotify Connect ve harici MediaSession için duyulabilirlik doğrulaması TEKNİK OLARAK YAPILAMAZ.',
  },
  {
    id: 'guardian-runtime', category: 'runtime', name: 'Guardian Runtime',
    desc: 'Guardian AI motorunun TICK SAHİPLİĞİ ve BÜTÇESİNİN salt-okunur gözlemi: kadans sahibi (§L.0 tik-wheel) · taban/etkin periyot ve mod çarpanı · OBD anketiyle birlikte uçtan uca EN KÖTÜ tespit gecikmesi · bağlı/bağlı olmayan sağlayıcı envanteri (gerekçesiyle) · koşum ve hata sayaçları (hata SINIFI + boru hattı aşaması) · fiilen çalışan kural sayısı, risk olayı sayısı, en yüksek severity ve toplam risk skoru · koşum süresi dağılımı (son/p50/p95/en kötü) ile bütçe (8 ms) ve #494 tavanı (16 ms) aşım sayaçları.',
    status: 'AVAILABLE', layer: null,
    note: 'Hiçbir şey BAŞLATMAZ/DURDURMAZ: Guardian tick\'i tetiklemez, kadansı değiştirmez, kural/eşik/severity değiştirmez, OBD sorgusu veya GPS düzeltmesi istemez, ağ çağrısı yapmaz — açılışta tek okuma + elle YENİLE. KOORDİNAT TAŞINMAZ (Guardian GPS\'ten yalnız hız okur); risk olayları yalnız kimlik/tip/severity/güven/mesafe olarak görünür, serbest metin (başlık/mesaj) taşınmaz. DÜRÜSTLÜK: bu tur Guardian\'a KALP ATIŞI verir, SES vermez — çıktı sürücüye SUNULMAZ; aşırı ısınma/akü uyarısının ürün otoritesi hâlâ VehicleCompute.worker → SystemOrchestrator\'dır, ikinci eylem otoritesi doğmadı. 8 kuraldan bugün fiilen KOŞAN yalnız vehicle-health\'tir; GPS hızı okunur ama hiçbir kurala girmez (map dilimleri yok). Konum tabanlı kurallar şartlı kilit #508, yorgunluk #509 altında. Bütçe aşımı SAYILIR, katman KAPATILMAZ (güvenlik katmanı sessizce ölmez). Ölçülmemiş alan UNAVAILABLE; sahte 0 üretilmez. Gerçek araç doğrulaması YAPILMADI (kütük #539–#542).',
  },
  {
    id: 'theme-runtime', category: 'runtime', name: 'Tema Manifesti',
    desc: 'Arabam Cebimde Tema Stüdyo\'sundan gelen TEMA MANİFESTİ\'nin (schemaVersion 2) araç tarafındaki salt-okunur gözlemi: son uygulanan tema/sürüm/şema/kaynak ve zamanı · uygulanan CSS değişkeni, bileşen ve ekran override adedi · üretilen CSS boyutu ve DOM\'daki stil etiketinin varlığı · fail-closed kapısında REDDEDİLEN paket sayısı ve son red sebebi · kayıt defterindeki düzenlenebilir bileşen sayısı ile o an ekranda gerçekten bulunan `data-editable` düğüm sayısı · önizleme seçim modunun durumu · tema başına saklanan manifest listesi ve deponun okunabilirliği.',
    status: 'AVAILABLE', layer: null,
    note: 'Hiçbir şey UYGULAMAZ/GÖNDERMEZ: tema değiştirmez, manifest yazmaz/siler, önizleme köprüsünü tetiklemez, depoya yazmaz, ağ çağrısı yapmaz — açılışta tek okuma + elle YENİLE. Manifest İÇERİĞİ TAŞINMAZ: renk değerleri, üretilen CSS metni ve kullanıcının verdiği tema adı gösterilmez; yalnız SAYI, DURUM ve ZAMAN. DÜRÜSTLÜK: "manifest uygulandı" ile "görünüm değişti" ayrı hükümlerdir (içi boş manifest de başarıyla uygulanır ve ekranı değiştirmez); uygulama sayaçları OTURUM İÇİdir; DOM sayımı yalnız o an çizili ekranı ölçer, kapalı çekmecedeki bileşenler görünmez. Gerçek araç doğrulaması YAPILMADI.',
  },
  {
    id: 'background-power', category: 'runtime', name: 'Arka Plan Gücü',
    desc: 'Güç kapısının girdileri, kararı ve servislerin GERÇEK hâli yan yana; karar↔gerçek çelişkisi.',
    status: 'AVAILABLE', layer: 'backgroundPowerGate',
    note: null,
  },
  /* ── AI ──────────────────────────────────────────────────────────────── */
  {
    id: 'mavi-console', category: 'ai', name: 'Mavi Konsolu',
    desc: 'Mavi sesli asistanın RAM durumunun salt-okunur konsolu: yaşam döngüsü bayrakları, son teşhis aşamaları (en yeni→en eski), AI devre kesici ve sağlayıcı soğuma pencereleri, konuşma/tur otoritesi, sürüş iş yükü bütçesi, proaktif konuşma politikası, kullanıcıya görünen durum ve barge-in / duplex yetenek sınıfı.',
    status: 'AVAILABLE', layer: null,
    note: 'Dinleme/TTS başlatmaz, AI sağlayıcısına istek atmaz, komut çalıştırmaz, kesme önerisi ÜRETMEZ (yalnız defteri okur). GİZLİLİK: transcript metni, son komut metni, konuşma geçmişi ve öneri metinleri GÖSTERİLMEZ — yalnız VAR/YOK ve ADET. Sağlayıcı soğumaları AYRI tutulur, tek toplamda birleştirilmez. F12 bölümündeki duplex sınıfı bir HEDEF değil ÖLÇÜMDÜR: kanıt yoksa yükselmez ve TTS durdurma gecikmesi bir İSTEK damgasıdır — akustik susma yalnız cihazda doğrulanır.',
  },
  {
    id: 'mavi-reasoning-engine', category: 'ai', name: 'MAVI Reasoning Engine',
    desc: "CAROS PRO'nun TEK KARAR OTORİTESİNİN salt-okunur gözlemi: CANLI OLAY KUYRUĞU (bekleyen · çalışan · tamamlanan · düşen · yeniden denenecek · reddedilen · atlanan · bastırılan olaylar, ortalama kuyruk ve karar süresi, kuyruk sağlığı) · niyet dağılımı · karar dağılımı (SUPPORTED · UNSUPPORTED · INSUFFICIENT_EVIDENCE · CONFLICTED_EVIDENCE · EXPIRED_EVIDENCE · UNKNOWN · REJECTED) · karar güveni ve bounded GEREKÇE KODU · kaç kanıta dayandığı · çelişki · bilinmeyen · süresi dolmuş sayaçları · bastırılan tekrar ve geçersiz durum geçişi sayaçları · karar yaşı · karar zincirinin içgörü/DNA uçları · bütünlük bayrağı.",
    status: 'AVAILABLE', layer: null,
    note: 'Hiçbir şey BAŞLATMAZ ve KARAR VERMEZ: karar üretme/yazma, durum ilerletme, süre kapatma, sunucuya yazma, ağ çağrısı ve timer YOK. LLM KARAR VERMEZ — bu katmanda model, tahmin, öneri ve doğal dil YOKTUR; LLM yalnız burada ZATEN VERİLMİŞ kararı cümleye çevirir. KARAR KANITSIZ ÜRETİLEMEZ: "veri yok, o hâlde sorun yok" bir karar değildir; kanıtsız istek INSUFFICIENT_EVIDENCE olur. GÜVEN DIŞARIDAN YAZILAMAZ — kanıtların en zayıf halkasından TÜRETİLİR (formül kanıt omurgasından gelir, burada yeniden yazılmaz) ve tek kanıtlı karar MEDIUM tavanını aşamaz. ÇELİŞKİLİ KANITTA KARAR ÜRETİLMEZ: iki kaynağın çeliştiği yerde birini seçmek uydurmaktır. SÜRESİ DOLMUŞ KANIT KARARA KATILMAZ ama zincirden SİLİNMEZ; süresi dolan karar da silinmez, EXPIRED olur. AYNI KANITLA İKİNCİ KEZ DÜŞÜNMEK YENİ KARAR AÇMAZ (replay güvenliği) — bastırılan tekrar sessizce yutulmaz, sayılır. GEÇERSİZ DURUM GEÇİŞİ REDDEDİLİR (analiz edilmeden karar olmaz; sonuçlanmış karar sessizce değiştirilemez). İKİNCİ KARAR OTORİTESİ YASAKTIR: AI Mechanic · Driver Coach · Fleet Advisor · Predictive Maintenance · Trip/Diagnostic/Repair/Service Advisor · AI Negotiator · Vehicle Health Advisor kararı YALNIZ buradan alır. ÜRETİM AKIŞI BAĞLI (migration 058): 12 gerçek olay (yolculuk tamamlandı · DNA güncellendi · içgörü oluştu · araç kimliği/bağlantısı değişti · konum durumu değişti · sürücü doğrulaması/varlığı değişti · filo sağlığı güncellendi · kanıt eklendi/süresi doldu/geri çekildi) motoru KENDİLİĞİNDEN tetikler. VARSAYILAN RESOLVER YASAKTIR: eşlenmemiş niyet kuyruğa giremez. BOUNDED DEDUPE: aynı özne+niyet için bekleyen iş varken yeni iş açılmaz, bastırılan tekrar SAYILIR. RESOLVER KARAR ÜRETMEZ — yalnız özneyi seçip motora yönlendirir; eşik/oran/güven mantığı bir resolver a girerse doğrulama DÜŞER. HOT-PATH KORUNUR: konum ve bağlantı gibi yüksek frekanslı olaylar yalnız GERÇEK durum geçişinde (10 dk sessizlik sonrası) olay üretir ve karar üretimi telemetri yoluna SOKULMAZ (kuyruğa alınır, koşucu işler). HATA YALITIMI: reasoning düşerse trip yükleme · Fleet Insight · Driver DNA · Evidence Engine çalışmaya DEVAM EDER, ama hata sessizce yutulmaz (FAILED · RETRY_PENDING · REJECTED · SKIPPED · DEDUPED). Üretim SUNUCUDADIR; head unit tarafında karar üretilmez — köprü bağlı değilse ekran dürüstçe "karar yok" der. KİŞİSEL VERİ TAŞINMAZ: araç/sürücü ADI, plaka, VIN, konum ve rota GELMEZ (yalnız kısaltılmış referans). Gerçek araç doğrulaması YAPILMADI (BLOCKED_REAL_VEHICLE).',
  },
  {
    id: 'ai-mechanic', category: 'ai', name: 'AI Mechanic',
    desc: 'MAVI Reasoning Engine kararlarinin MEKANIK TESHIS diline cevrilmis salt-okunur gozlemi: analiz sayisi · kategori dagilimi (MOTOR · SOGUTMA · AKU · YAKIT · OBD/TANI · SICAKLIK · BAGLANTI · BILINMIYOR) · analiz durumu (SUPPORTED · UNSUPPORTED · UNKNOWN · INSUFFICIENT_EVIDENCE · CONFLICTED_EVIDENCE · EXPIRED_EVIDENCE) · MAVI tarafindan AYNEN tasinan guven ve bounded gerekce kodu · turetilmis siddet · kanit ve celiski sayisi · her analizin hangi karar ve hangi kanitlar uzerinden olustugunu gosteren muhakeme zinciri referansi · kapsam disi ve reddedilen karar sayaclari.',
    status: 'AVAILABLE', layer: null,
    note: 'AI MECHANIC KARAR URETMEZ: her satir MAVI Reasoning Engine tarafindan ZATEN URETILMIS bir kararin yorumudur. YENI KARAR MOTORU YOK · YENI GUVEN SISTEMI YOK · YENI KANIT SISTEMI YOK · LLM YOK. Guven MAVI tarafindan AYNEN tasinir, yeniden hesaplanmaz; siddet yalniz karar+guven ikilisinin SUNUM siralamasidir ve hicbir karari degistiremez. CELISKI WARNING DEGILDIR — celiski bir ariza kaniti degil bilgi eksikligidir; onu uyariya cevirmek "celiskide karar uretilmez" kuralini arkadan dolanmak olurdu. ONERI YOKTUR: tamir tavsiyesi, parca, maliyet, aciliyet talimati ve serbest metin bu katmanda YASAKTIR (P1 yalniz TESHIS katmanidir; Predictive Maintenance · Service Advisor · Repair Advisor ILERIDE bunun UZERINE kurulacaktir). YALNIZ IKI KAYNAK okunur: Reasoning Engine ve Evidence Engine — baska hicbir modul dogrudan okunmaz (kararin arkasindan ham sinyale bakmak MAVI otoritesini delerdi). KAPSAM DAR: DRIVER · FLEET · TRIP_STATUS · LOCATION niyetleri mekanik teshis DEGILDIR ve hic gosterilmez; sayilari kapsam disi olarak GORUNUR tutulur. SOGUTMA UYDURULMAZ: COOLING yalniz gercek sogutma kanit metrigi (coolant/radiator/thermostat/fan) varsa secilir, yoksa SICAKLIK kalir. REJECTED karar analiz URETMEZ (girdi hatasi, teshis degil); taninmayan karar kodu ise GIZLENMEZ, UNKNOWN olarak gorunur. Hicbir sey BASLATMAZ: karar/kanit yazma, durum ilerletme, ag cagrisi ve timer YOK — acilista tek okuma + elle YENILE. Liste bossa bu araç saglikli DEMEK DEGILDIR. KISISEL VERI TASINMAZ: arac/surucu ADI, plaka, VIN, konum GELMEZ (yalniz veh:xxxxxxxx biciminde kisaltilmis referans). Gercek arac dogrulamasi YAPILMADI (BLOCKED_REAL_VEHICLE).',
  },
  {
    id: 'action-registry', category: 'ai', name: 'Eylem Otoritesi',
    desc: "Mavi'nin TEK eylem otoritesinin salt-okunur görünümü: araç etkili eylem defteri (actionId · risk · onay · capability · vehicleScope · hareket politikası), son kapı kararları (en yeni→en eski, bounded) ve kapı sayaçları.",
    status: 'AVAILABLE', layer: null,
    note: 'Hiçbir eylem çalıştırmaz; bekleyen onayı onaylamaz/iptal etmez; kapı değerlendirmez. GİZLİLİK: ham kullanıcı komutu, kişi adı, telefon numarası ve sağlayıcı cevabı GÖSTERİLMEZ — bekleyen onay yalnız VAR/YOK. Karar halkası sabit boyutludur, sayaçlar doyar.',
  },
  {
    id: 'stt-mic', category: 'ai', name: 'Mavi STT / Mikrofon',
    desc: 'Gerçek mikrofon zincirinin salt-okunur gözlemi: seçilen/denenen Android AudioSource, örnekleme-kanal-buffer, AEC/NS/AGC için ayrı ayrı mevcut/oluşturuldu/etkin, anlık RMS + öğrenilmiş gürültü tabanı + KULLANILAN gerçek VAD eşiği, bounded RMS özeti (min/p50/ort/p95/max), aynı turda örneklenen araç hızı ve hareket durumu, grammar SINIFI ve son tanıma sonucu KATEGORİSİ.',
    status: 'AVAILABLE', layer: 'AudioRecord / Vosk',
    note: 'SALT-OKUNUR gözlem — hiçbir şey BAŞLATMAZ: mikrofon açma/kapama, STT veya wake motoru başlatma/durdurma, VAD eşiği değiştirme, AudioSource seçimi, AEC/NS/AGC aç-kapa ve izin isteği YOK. GİZLİLİK: transcript, n-best, wake sözcüğünün kendisi, grammar kelimeleri ve HAM SES bu ekrana HİÇ GELMEZ — yalnız sabit enum, adet ve normalize RMS skaleri. Klima/fan seviyesi için repoda KAYNAK YOKTUR (KAYNAK YOK gösterilir, sahte 0 üretilmez). Wake yolunda gürültü tabanı ÖĞRENİLMEZ ve efekt KURULMAZ — bu bir hata değil, kodun gerçeğidir. Otomatik yenileme VARSAYILAN KAPALIDIR.',
  },
  {
    id: 'mavi-latency', category: 'ai', name: 'Mavi Gecikme',
    desc: 'Mavi\'nin CANLI hattındaki uçtan uca gecikmesinin salt-okunur gözlemi: tur başına damga zinciri (dinleme → STT → endpoint → karar → beyin → TTS → ilk ses → cevap sonu), segment kırılımı, p50/p95/en kötü, yol/sağlayıcı kodu, sonuç sınıfı, yapay ara söz adedi ve barge-in.',
    status: 'AVAILABLE', layer: null,
    note: 'SALT-OKUNUR: Mavi\'yi TETİKLEMEZ, mikrofon AÇMAZ, TTS ÇALIŞTIRMAZ, telemetriyi açıp kapatmaz, defteri temizlemez, timer kurmaz. VARSAYILAN KAPALI — şalter: uzak bayrak `mavi_latency_trace` veya localStorage["mavi.latencyTrace.enabled"]="true"; kapalıyken üretim davranışı BİREBİR aynıdır ve iz üretilmez. İKİ AYRI "İLK SES" SATIRI VARDIR ve BİRLEŞTİRİLMEZ: PROXY (`play()`/`speak()` çağrıldı) bir KANIT DEĞİLDİR; DOĞRULANMIŞ yalnız platformun gerçek başlangıç bildirimidir (`HTMLAudioElement.playing` · `SpeechSynthesisUtterance.onstart`). Native TextToSpeech yolunda doğrulama ttsStarted olayından (UtteranceProgressListener.onStart) gelir — bu Android\'in AÇTIĞI en yakın playback-start sinyalidir, hoparlör/DAC çıkışı DEĞİLDİR ve öyle sunulmaz; olayı yayınlamayan eski APK\'da damga basılmaz ve satır PROXY kalır. KONUŞMA SONU TÜRETİLMİŞTİR: JS konuşma bitişini gözlemez; `sttLatencyTelemetry`nin ZATEN ölçtüğü native VAD deltası (`speechEndDetectedAtMs`) `stt_request_start` ankoruna eklenerek türetilir ve damga "türetilmiş" olarak İŞARETLENİR — yeni ölçüm üretilmez, mevcut ölçüm uçtan uca zincire bağlanır; Google STT yolunda telemetri gelmediği için `speech_end` HİÇ damgalanmaz (sahte taban yok). YABANCI SES KAPISI: `ttsService` tek seslendirme otoritesidir ve Mavi\'nin cevabı DIŞINDA da konuşur (navigasyon talimatı · güvenlik uyarısı · tehlike · bildirim okuma); bir iz AÇIKKEN bunlardan biri çalarsa ses damgası "ilk gerçekleşme kazanır" kuralıyla ana metriği KALICI OLARAK bozardı — bu yüzden ses damgaları yalnız `tts_request` (nihai cevap seslendirmeye verildi) damgalandıktan SONRA kabul edilir; düşen damga sessizce yutulmaz, `Yabancı ses damgası` sayacında görünür. Aynı kapı ARA SÖZÜN (filler) sesini de "cevabın ilk sesi" saymaz. MAVI-F2: yapay ara söz üretim yollarından KALDIRILDI ve `maviSpeech` I11 kapısı kalanı KONUŞMADAN düşürür → "Yapay ara söz (engellendi)" satırı seslendirilen ara sözü DEĞİL, YAKALANAN İHLALİ gösterir; beklenen değer 0, sıfırdan büyük her değer bir REGRESYON kanıtıdır. "Semantik ACK" ayrı satırdır ve bir kusur DEĞİLDİR: gerçek ve süren bir işin BAŞLADIĞINI bildirir ("Araç sistemleri taranıyor"), bittiğini İDDİA ETMEZ. MAVI-F3 · STREAMING ASR: kısmi transkript (partial) artık canlı hatta akar ve Mavi kullanıcı KONUŞURKEN anlamaya başlar; ekran yalnız ADET, SÜRE ve bounded enum gösterir — kısmi METİN bu katmana HİÇ GİRMEZ. "Cümle-sonu sebebi" kararın hangi kanıttan doğduğunu ayırır (FINAL_PROVIDER · ACOUSTIC_TIMEOUT · SEMANTIC_CONFIDENT · MAX_DURATION_FAILSAFE · CANCELLED). "Erken bitirme KOMUTU gönderildi" satırı KRİTİK bir ayrımdır: semantik karar VARSAYILAN OLARAK yalnız ÖLÇÜLÜR (gölge kip), sağlayıcıya gönderilmez → cihaz davranışı bugünküyle BİREBİR aynıdır ve erken kesme oranı gerçek kullanıcıyı KESMEDEN ölçülebilir; bu sayaç 0 iken SEMANTIC_CONFIDENT satırı "karar verilseydi burada biterdi" demektir. "STT akış yeteneği" VARSAYILMAZ, BİLDİRİLİR: sessizlik kanıtı olmayan yolda sahte VAD kurulmaz ve semantik endpoint çalışmaz. GECİKME KAZANCI İDDİA EDİLMEMİŞTİR — cihaz ölçümü alınana kadar UNKNOWN. İSTATİSTİK YALNIZ TAMAMLANMIŞ TURLARDAN çıkar: iptal/devralınan/timeout turlar "hızlı" görünüp ortancayı yanlış iyileştirirdi. TUR İZOLASYONU: aynı anda tek açık iz vardır; yeni dinleme açılırken eski iz `superseded` ile kapanır → iki turun damgaları karışamaz. GİZLİLİK: transcript, n-best, prompt, cevap metni, kişi, konum ve VIN bu katmana HİÇ GİRMEZ; route/provider alanları sanitize edilir (yalnız [a-z0-9_], 24 karakter). Defter süreç ömürlüdür ve sabit tavanlı halkadır (20 iz). GERÇEK ARAÇ DOĞRULAMASI YAPILMADI — cihaz ölçümü alınana kadar tüm hedefler UNKNOWN\'dır.',
  },
  {
    id: 'capability-fabric', category: 'ai', name: 'Capability Fabric',
    desc: 'Mavi\'nin CarOS yetenek kataloğuna bağlanmasının salt-okunur gözlemi: kapı kipi (gölge/zorlayıcı) · capability kapsama oranı (capability vs LEGACY_FALLBACK) · katalog işlem ve capability adedi · beyne açık intent adedi (katalogdan TÜRETİLİR) · katalog bütünlüğü (duplicate işlem/intent, boş enum) · gözlem seviyesi dağılımı · bounded kapı redleri · registry availability kanıtı; ve her işlem için alan · güvenlik sınıfı · onay gereksinimi · gözlem tavanı · beyne açıklık · kanonik intent köprüsü.',
    status: 'AVAILABLE', layer: null,
    note: 'SALT-OKUNUR: capability ÇALIŞTIRMAZ, Mavi\'yi tetiklemez, kapıyı zorlayıcı kipe ALMAZ, katalogu değiştirmez, sayaç sıfırlamaz, timer kurmaz. AVAILABILITY ≠ PERMISSION ≠ AUTHORITY — üç eksen AYRIDIR: availability `capabilityRegistry` kanıtıdır, permission katalogdaki `exposedToBrain`tir, AUTHORITY ise YALNIZ kanonik zincirden (`maviActionAuthority` → `AiSafetyGate` → açık onay → `dispatchIntent`) doğar; bu katman hiçbirini TAKLİT ETMEZ ve ikinci bir gerçeklik kaynağı KURMAZ. KAPI VARSAYILAN GÖLGE KİPTEDİR: karar üretilir ve ÖLÇÜLÜR ama hiçbir eylem ENGELLENMEZ → cihaz davranışı bugünküyle BİREBİR aynıdır; zorlayıcı kip şalteri localStorage["mavi.capabilityFabric.enforce"]="true". AVAILABILITY POLİTİKASI: yalnız KANITLI OLUMSUZ (unavailable/unsupported/restricted) yolu kapatır; `UNKNOWN` KAPATMAZ — registry\'nin henüz kanıt toplamamış olması bir yeteneğin yokluğu DEĞİLDİR ve çalışan bir komutu fail-closed ile öldürmek gerçek bir regresyon olurdu. Kanıt İSTEMEYEN işlemler (medya · ayarlar · yüzey · telefon) UNKNOWN görünür: `capabilityRegistry`de karşılığı olan bir kimlik BULUNMADIĞI için sahte kapı KURULMADI ve borç kütüğe yazıldı. GÖZLEM DÜRÜSTLÜĞÜ: "yaptım" denebilecek tek seviye EXECUTED ve OBSERVED\'dir; yürütücü "başarılı" dese bile işlemin `observationCeiling`i ACCEPTED ise sonuç ACCEPTED yazılır (doğrulanamayan başarı iddia EDİLMEZ). KAPSAMA ORANI gerçek trafikten gelir ve hiç tur geçmediyse "%0" DEĞİL "ölçüm yok" gösterilir. TEK KAYNAK: prompt intent listesi artık ELLE YAZILMAZ — önceden aynı bilgi ÜÇ ayrı sabit listedeydi (29 / 29 / 26) ve biri güncellenmeyince beyin geçerli komut üretiyor, doğrulayıcı onu SESSİZCE DÜŞÜRÜYORDU. GİZLİLİK: parametre DEĞERİ · transkript · kişi adı · adres · sensör sorgusu · VIN · konum bu katmana HİÇ GİRMEZ; yalnız katalog sabitleri, bounded enum ve ADET taşınır. GERÇEK ARAÇ DOĞRULAMASI YAPILMADI — kapsama oranı ve kapı doğruluğu cihazda ölçülene kadar UNKNOWN\'dır.',
  },
  {
    id: 'tool-calling', category: 'ai', name: 'Araç Çağrısı',
    desc: 'Tool call turlarının salt-okunur gözlemi: çağrı ve düşme sayacı · başarı oranı · tool loop turu ve TAVANA takılan tur adedi · son çağrı yaşı · baskın hata kodu · kanıt tamponu doluluk oranı ve araç başına dağılım (çağrı/düşme/ortalama süre).',
    status: 'AVAILABLE', layer: null,
    note: 'SALT-OKUNUR: araç ÇAĞIRMAZ, Mavi\'yi tetiklemez, tool loop BAŞLATMAZ, defteri temizlemez, timer kurmaz. YENİ VERİ ÜRETİLMEDİ: `runToolLoop` her çağrı için ZATEN gizlilik-güvenli `ToolTelemetry` üretiyordu (araç adı · etki sınıfı · başarı · hata kodu · süre · alan adedi) — ama yalnız çağırana dönüp KAYBOLUYORDU; bu tur onu bounded bir halka tampona yazıyor. GİZLİLİK: `ToolTelemetry` tasarımı gereği ARGÜMAN ve SONUÇ TAŞIMAZ; kullanıcı sorusu, araç argümanı, araç çıktısı, konum ve serbest metin bu ekrana GELMEZ — yalnız sabit tanımlayıcı · enum · sayaç · süre. HİÇ ÇAĞRI YOKSA BAŞARI ORANI UYDURULMAZ (KAYNAK YOK gösterilir): "%100 başarılı" demek hiç denenmemiş bir sistemi sağlıklı göstermek olurdu. TAVANA TAKILAN TUR AYRI SAYILIR ve hükümde SAĞLIKLI durumunu EZER: model araç istiyordu ama tur sınırına takıldı, yani cevap eksik veriyle üretildi — bu bir BAŞARISIZLIK DEĞİL ama sessizce geçiştirilmemesi gereken ayrı bir durumdur. Defter süreç ömürlüdür (kalıcı depo YOK; uygulama yeniden başlayınca boşalır) ve sabit tavanlı halkadır (sınırsız büyüme YOK). Kayıt yolu fail-soft: kanıt toplama sohbet akışını ASLA bozmaz. Gerçek cihaz doğrulaması YAPILMADI (kütük #694).',
  },
  {
    id: 'memory-explorer', category: 'ai', name: 'Bellek Gezgini',
    desc: 'Mavi hafıza katmanının salt-okunur gözlemi: kısa dönem halka tamponu (adet/kapasite, en eski kaydın yaşı, köken dağılımı) · kullanıcı tercihi adedi · araç geçmişi gerçekleri ve eşik üstü güvenli olanların adedi · hassas veri kapısının sınırları · blok bütçesi.',
    status: 'AVAILABLE', layer: null,
    note: 'Hiçbir şey BAŞLATMAZ ve YAZMAZ: hafızaya kayıt ekleme/silme/temizleme, bütçe değiştirme, hassas kapıyı gevşetme, asistanı çağırma ve timer YOK. İÇERİK GÖSTERİLMEZ — bu ekranın tanımlayıcı kuralıdır: hafıza kayıtları KULLANICI METNİDİR ve ne tamamı, ne kırpılmışı, ne ilk harfi, ne UZUNLUĞU, ne özeti, ne de hash değeri taşınır (uzunluk bile ayırt edicidir). Yalnız ADET · YAŞ · KÖKEN SINIFI · POLİTİKA görünür; bir hafıza gezgininin "gezinme" işlevi BİLİNÇLİ olarak YOKTUR (ham komut ve transkript LAB ekranına taşınamaz). "OKUNAMADI" ile "0 kayıt" AYRIDIR. Araç geçmişi otoritesi BAĞLI DEĞİLSE 0 bir ÖLÇÜM SAYILMAZ ve öyle işaretlenir. Damgasız kaydın yaşı HESAPLANMAZ. Kısa dönem hafıza yalnız RAM içindedir (uygulama yeniden başlayınca boşalır). Gerçek cihaz doğrulaması YAPILMADI (kütük #692).',
  },
  {
    id: 'knowledge-explorer', category: 'ai', name: 'Bilgi Tabanı Gezgini',
    desc: 'Araç bilgi tabanının salt-okunur gözlemi: öğrenilmiş araç sayısı ve LRU tavanı · doğrulanmış profil adedi · araç başına öğrenilen PID/DID/ECU · bağlantı ve gözlem sayısı · güven · maskeli VIN ve parmak izi ön eki · son görülme yaşı.',
    status: 'AVAILABLE', layer: null,
    note: 'Hiçbir şey BAŞLATMAZ ve YAZMAZ: kayıt ekleme/silme/temizleme, keşif tetikleme, araca sorgu gönderme, öğrenme motorunu başlatma ve timer YOK — ekranı AÇMAK öğrenme BAŞLATMAZ. TEK GÖZLEM KANIT DEĞİLDİR: bir kez görülmüş profil DOĞRULANMIŞ sayılmaz ve satırında açıkça öyle yazar (zero-trust telemetry — tekrar etmemiş sinyal kanıt değildir). GÜVEN 1 DEĞERİNE ASLA ULAŞMAZ; %100 gösterilmez. TAVAN UYARISI hüküm sırasında DOĞRULANMIŞ hükmünü EZER: depo dolduğunda öğrenme kaybı başlar ve bu iyi haberden önemlidir. GİZLİLİK: HAM VIN ekrana GELMEZ (yalnız WMI açık maske; maskelenemezse ham değer değil KAYNAK YOK gösterilir), tam parmak izi hash değeri taşınmaz (yalnız ilk 12 — tam hash araç-arası eşleştirmeye izin verirdi), ECU adres listesi ve firmware sürüm dizeleri ADET olarak geçer. "OKUNAMADI" ile "hiç araç öğrenilmedi" AYRIDIR. Damgasız kayıtta yaş HESAPLANMAZ. Gerçek cihaz doğrulaması YAPILMADI (kütük #692).',
  },
  /* ── Developer ───────────────────────────────────────────────────────── */
  {
    id: 'long-road-field-validation', category: 'developer', name: 'Uzun Yol Saha Doğrulama',
    desc: 'Uzun yol boyunca TAMAMEN OTOMATİK çalışan saha doğrulama oturumu: senaryo algılama (30 senaryo), sinyal defteri (ilk görülme · kapsama · en uzun boşluk · min/ort/max · geçersiz/bayat), OBD-KWP-CAN ve konum süreklilik sayaçları, bounded BlackBox olay pencereleri (öncesi 60 sn / sonrası 120 sn), cooldown+dedupe’lu snapshot politikası, uygulama kapansa bile aynı sessionId ile devam eden kalıcılık ve tek düğmeyle Türkçe + JSON saha raporu.',
    status: 'AVAILABLE', layer: null,
    note: 'YALNIZ PASİF GÖZLEM. Araca/OBD’ye komut GÖNDERMEZ · polling sırasını veya süresini DEĞİŞTİRMEZ · bağlantı KURMAZ/KESMEZ · reset/reconnect TETİKLEMEZ · GPS/Bluetooth/internet durumunu DEĞİŞTİRMEZ · müzik/navigasyon BAŞLATMAZ · yapay arıza ÜRETMEZ · sürüş sırasında POPUP AÇMAZ, ses çalmaz, kullanıcıdan işlem İSTEMEZ. Üç düğme (BAŞLAT/DURDUR/RAPOR) yalnız GÖZLEMCİYİ yönetir. Koordinat, TAM VIN, API anahtarı, JWT, e-posta ve ham komut TAŞINMAZ — yalnız VAR/YOK, ADET, DURUM ve SÜRE. Gözlenmeyen senaryo NOT_OBSERVED’dır (FAIL değil); backend yoksa BLOCKED_BACKEND. Kanıtsız PASS ÜRETİLMEZ; gerçek araç kanıtı yoksa karar BLOCKED_REAL_VEHICLE kalır.',
  },
  {
    id: 'decoder-registry', category: 'developer', name: 'Çözücü Kayıtları',
    desc: 'Repoda kayıtlı standart PID ve üretici DID çözücü tanımlarının salt-okunur envanteri: birim, aralık, bayt, çözücü sınıfı, formül özeti, profil ve derleme sonucu — arama ve filtre ile.',
    status: 'AVAILABLE', layer: null,
    note: 'STATİK katalog: ECU sorgusu, PID/DID keşfi, bağlantı, polling veya native çağrı YAPMAZ; araçta neyin desteklendiğini BİLMEZ. Çözücü fonksiyon gövdesi GÖSTERİLMEZ (toString kullanılmaz). Standart PID formülleri JS kapanışı olduğu için makine-okunur özet YOKTUR.',
  },
  {
    id: 'profile-candidates', category: 'developer', name: 'Üretici Profil Adayları',
    desc: 'Gözlemlerden türetilen manuel-onaya-hazır PID/DID adayları; ECU varyantları ve çakışmalar.',
    status: 'AVAILABLE', layer: 'manufacturerProfileBuilder',
    note: null,
  },
  {
    id: 'discovery-database', category: 'developer', name: 'Keşif Veritabanı',
    desc: 'Sahada yakalanan katalog-dışı PID/DID gözlemleri; filtre, arama, JSON dışa aktarma.',
    status: 'AVAILABLE', layer: null,
    note: null,
  },
  {
    id: 'raw-command-console', category: 'developer', name: 'Ham Komut Konsolu',
    desc: 'Serbest ham komut gönderimi.',
    status: 'DISABLED', layer: 'ELM327 / UDS',
    note: 'GÜVENLİK POLİTİKASI: ham yazma/komut gönderimi kapalı (ECU write · coding · SecurityAccess · actuator · DTC clear kapsam dışı). Kart işlem çalıştırmaz.',
  },
  {
    id: 'replay-log', category: 'developer', name: 'Kayıt Oynatma',
    desc: 'Kara kutu kayıt oynatımı — kaydedilmiş oturumun olay akışı.',
    status: 'AVAILABLE', layer: null,
    note: null,
  },
  {
    id: 'pid-timing-experiment', category: 'developer', name: 'H-A Deneyi (ATST)',
    desc: 'ELM327 yanıt bekleme süresinin (ATST) NO_DATA kaybına sebep olup olmadığını ölçen İKİ AŞAMALI deney: A) mevcut ayar (CAN tarafinda ATST hiç gönderilmiyor → ELM varsayılanı ~200 ms) · B) ATST FF (~1020 ms). Aynı bağlantı, aynı PID listesi, aynı tur sayısı. PID BAŞINA: NO_DATA oranı · başarılı yanıt p50/p95/max · NO_DATA süresi · aşama toplam süresi. 0x23 (yakıt rayı basıncı) AYRI raporlanır — Car Scanner okuyor, biz okumuyoruz.',
    status: 'AVAILABLE', layer: 'ELM327 / CAN',
    note: '⚠️ SALT-OKUNUR DEĞİL — LAB kuralının BİLİNÇLİ İSTİSNASI: bu ekran araca SORGU GÖNDERİR ve ATST ayarını GEÇİCİ değiştirir. SINIRLAR: yalnız KULLANICI başlatırsa koşar (açılışta hiçbir şey gönderilmez) · yalnız Mode-01 OKUMA (yazma/DTC silme/adaptasyon YOK) · ATST bitişte native finally ile GERİ ALINIR · ürünün eleme öğrenmesi (ExtendedNoDataTracker) BESLENMEZ (deney ölçtüğü şeyi bozmaz) · poll döngüsü DURDURULMAZ (çekişme iki aşamada da aynı → karşılaştırma geçerli) · iptal edilebilir · PID ve tur sayısı TAVANLI. Varsayılan PID listesi UYDURULMAZ — ürünün izlediği listeden gelir. Analiz native tarafinda DEĞİL, saf TS modelinde (18 birim testi). Gerçek araç doğrulaması YAPILMADI (kütük #518-HA).',
  },
  {
    id: 'benchmark', category: 'developer', name: 'Kıyaslama',
    desc: 'Poll turu, decode ve render bütçesi ölçümü.',
    status: 'PLACEHOLDER', layer: null,
    note: 'Ekran yok.',
  },
  {
    id: 'stress-test', category: 'developer', name: 'Yük Testi',
    desc: 'Yüksek yük altında adaptör/kuyruk dayanıklılık testi.',
    status: 'DISABLED', layer: null,
    note: 'GÜVENLİK POLİTİKASI: ECU/adaptör üzerinde kasıtlı yük üretir; canlı araçta çalıştırılabilir bir yüzey olarak açılmadı.',
  },
] as const);

/* ── Sorgular (saf) ──────────────────────────────────────────────────────── */

/** Kategoriye ait araçlar (katalog sırası korunur). */
export function toolsByCategory(category: CarosLabCategory): CarosLabTool[] {
  return CAROS_LAB_TOOLS.filter((t) => t.category === category);
}

/** id → araç; bilinmeyen id için null (fail-soft, throw YOK). */
export function getCarosLabTool(id: string): CarosLabTool | null {
  for (const t of CAROS_LAB_TOOLS) if (t.id === id) return t;
  return null;
}

/**
 * Karta basınca ekran AÇILABİLİR mi? Yalnız AVAILABLE açılır.
 * PLACEHOLDER → bilgi kartı gösterilir (ağır servis başlatılmaz).
 * DISABLED → hiçbir işlem çalıştırılmaz.
 */
export function isToolOpenable(tool: CarosLabTool | null): boolean {
  return !!tool && tool.status === 'AVAILABLE';
}

/**
 * Karta basıldığında hangi ekran AKTİF olmalı?
 *  - AVAILABLE   → gerçek ekran (id)
 *  - PLACEHOLDER → bilgi ekranı (id) — hiçbir ağır servis başlatılmaz
 *  - DISABLED    → null (HİÇBİR İŞLEM ÇALIŞMAZ)
 */
export function resolveToolActivation(tool: CarosLabTool | null): CarosLabToolId | null {
  if (!tool) return null;
  if (tool.status === 'DISABLED') return null;
  return tool.id;
}

/** Durum rozetinin görsel sınıfı için kararlı anahtar (UI tarafında eşlenir). */
export function statusTone(status: CarosLabToolStatus): 'ok' | 'muted' | 'blocked' {
  return status === 'AVAILABLE' ? 'ok' : status === 'PLACEHOLDER' ? 'muted' : 'blocked';
}
