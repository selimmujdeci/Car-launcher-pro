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
  | 'location-engine' | 'navigation-core' | 'address-search-evidence' | 'enforcement-points'
  | 'remote-command'
  | 'fleet-identity' | 'fleet-driver-identity' | 'fleet-presence-history'
  | 'fleet-driver-authentication' | 'fleet-driver-dna' | 'fleet-intelligence' | 'ai-evidence-engine'
  | 'deep-scan' | 'vehicle-fingerprint'
  // Communication
  | 'raw-obd-traffic' | 'can-monitor' | 'kwp-monitor' | 'uds-explorer'
  | 'session-inspector' | 'phone-hub-probe' | 'phone-hub-field-validation' | 'phone-hub-link'
  | 'adapter-diagnostics'
  // Runtime
  | 'queue-monitor' | 'poll-scheduler' | 'recovery-monitor' | 'evidence-viewer'
  | 'performance' | 'capability-gates' | 'media-authority' | 'guardian-runtime' | 'theme-runtime'
  | 'background-power'
  | 'route-layer-inspector'
  // AI
  | 'mavi-console' | 'mavi-reasoning-engine' | 'ai-mechanic' | 'action-registry'
  | 'stt-mic' | 'tool-calling' | 'memory-explorer' | 'knowledge-explorer'
  // Developer
  | 'decoder-registry' | 'discovery-database' | 'raw-command-console' | 'replay-log' | 'pid-timing-experiment'
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
    desc: 'Navigasyon çekirdeğinin salt-okunur gözlemi: navigasyon durumu · rota sağlayıcı ve hazırlığı (yerel OSRM tek yoklama) · map matching durumu/güveni/dik mesafesi ve koridoru · sapma durum makinesi (kanıt/gereken, uyarlanabilir pencere) · yeniden rota istek yaşam döngüsü (aktif kimlik, iptal edilen, reddedilen bayat yanıt, bastırılan tekrar) ve gecikme ayrıştırması (sapma→istek→yanıt→uygulandı→ilk talimat) · rota doğrulama kapısı denetim tablosu · manevra mesafesi yöntemi (yol-boyu vs kuş uçuşu) ve çapa çözünürlüğü · şerit/dönel kavşak dürüstlük sayaçları.',
    status: 'AVAILABLE', layer: 'GNSS / OSRM',
    note: 'Hiçbir şey BAŞLATMAZ: navigasyon başlatma/durdurma, hedef seçme, rota isteği, reroute zorlama, sağlayıcı değiştirme, alternatif seçme ve ağ çağrısı YOK. ENLEM/BOYLAM GÖSTERİLMEZ — konum kişisel veridir (Location Engine ile aynı karar); ham fix yalnız VAR/YOK + yaş, oturtulmuş konum yalnız VAR/YOK + rotaya dik mesafe olarak görünür. Hedef adı, adres ve rota geometrisi TAŞINMAZ. KAPSAM SINIRI: map matching rota-görelidir, tam yol-ağı eşleştirmesi DEĞİLDİR (routing-graph.bin cihazda yok) — "koridor dışı" aracın hangi yolda olduğunu SÖYLEMEZ. Trafik verisi yoktur. Bilinmeyen alan UNAVAILABLE; sahte 0 / sahte "sağlıklı" üretilmez. Gerçek araç doğrulaması YAPILMADI (FIX_PENDING_REAL_VEHICLE_RETEST).',
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
    desc: 'KWP2000/ISO9141 uygulanabilirliği, oturum tazeliği ve native kurtarma merdiveni (ATPC) sayaçlarının salt-okunur izlenmesi.',
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
    id: 'adapter-diagnostics', category: 'communication', name: 'Adaptör Tanılama',
    desc: 'ELM327/Bluetooth taşıma ve OBD oturum sağlığının salt-okunur görünümü: transport, oturum bayrakları, yaşam döngüsü sayaçları ve iki AYRI sağlık motorunun ayrı ayrı hükmü.',
    status: 'AVAILABLE', layer: 'ELM327',
    note: 'AT/OBD komutu GÖNDERMEZ (adaptör kimlik sorgusu ATI/ATZ dahil), reconnect/reset/recovery tetiklemez. Adaptör adı/adresi/seri numarası GÖSTERİLMEZ. RSSI, native buffer doluluğu, klon/orijinal hükmü ve gelişmiş BLE tanısı için JS kaynağı YOKTUR — KAYNAK YOK gösterilir.',
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
    desc: 'Mavi sesli asistanın RAM durumunun salt-okunur konsolu: yaşam döngüsü bayrakları, son teşhis aşamaları (en yeni→en eski), AI devre kesici ve sağlayıcı soğuma pencereleri.',
    status: 'AVAILABLE', layer: null,
    note: 'Dinleme/TTS başlatmaz, AI sağlayıcısına istek atmaz, komut çalıştırmaz. GİZLİLİK: transcript metni, son komut metni, konuşma geçmişi ve öneri metinleri GÖSTERİLMEZ — yalnız VAR/YOK ve ADET. Sağlayıcı soğumaları AYRI tutulur, tek toplamda birleştirilmez.',
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
