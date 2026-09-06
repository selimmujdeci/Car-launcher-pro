import type { StyleSpecification, LayerSpecification, FilterSpecification } from 'maplibre-gl';
import type { MapSource } from './mapSourceTypes';
/* #552 — kimlikler `_mapState`'ten DEĞİL, döngüsüz `_mapIds`'ten alınır.
 * `_mapState` bu dosyadan `RASTER_PAINT_*` aldığı için eski import bir döngü
 * kuruyordu ve paletler `shieldImage: undefined` ile donuyordu. */
import { SHIELD_IMG_DAY, SHIELD_IMG_NIGHT } from './map/_mapIds';

/**
 * Navigation Focus Mode — 3-tier tiered road suppression manifest (Faz 3.2).
 *
 * Tier 0 — Normal navigation  : moderate suppression, full context awareness.
 * Tier 1 — Approaching (50-200m): deeper suppression, route starts to dominate.
 * Tier 2 — Junction (<50m)   : maximum suppression, only route corridor visible.
 *
 * Her tier aynı layer ID setine sahip → tier geçişleri tam restore sağlar.
 * Motorway ve trunk kasitleri hiçbir zaman baskılanmaz (otoyol bağlamı).
 */
type SuppressEntry = readonly [string, 'line-opacity' | 'text-opacity', number];

/**
 * #621 — BASTIRMA ŞEHRİ SİLİYORDU: "böyle saçma harita olamaz" (kullanıcı, gece,
 * gerçek navigasyon ekran görüntüsüyle; hedef açıkça konuldu: *"Google Maps
 * seviyesinde olacak"*).
 *
 * ÖLÇÜLEN KUSUR — bastırma opaklığının EKRANDA bıraktığı kontrast (gece paleti
 * `#161c28` zemin · tali yol `#6a6b70` · #620 sonrası `brightness(0.8)` filtresi;
 * 1,00 = tamamen görünmez):
 *     Tier 0 normal seyir     → tali yol **1,15** · etiket 1,69
 *     Tier 1 dönüşe yaklaşma  → tali yol **1,05** · etiket **1,21**   ← kullanıcının ekranı
 *     Tier 2 kavşak (<50 m)   → tali yol **1,02** · etiket 1,08
 *     (bastırma yokken           tali yol  2,47  · etiket  7,16)
 * Yani navigasyon açılır açılmaz sokak ağı ve sokak adları pratikte YOK oluyordu;
 * ekranda rota + birkaç bina kalıyordu. Kullanıcının "saçma harita" dediği tablo
 * tam olarak budur ve bu, önceki turlarda ölçülen palet kazançlarından bağımsız
 * ÜÇÜNCÜ bir karartma otoritesiydi (palet → CSS filtresi → bastırma).
 *
 * YENİ SÖZLEŞME — "rota BASKIN olur, şehir SİLİNMEZ":
 *   · Rotanın baskınlığı zaten KENDİ genişliği, rengi ve kılıfından gelir
 *     (`routeWidthModel` + `routeColorModel`); bunu şehri silerek üretmek
 *     sürücüyü bağlamsız bırakır — dönülecek sokağın kendisi de sönüyordu.
 *   · Tier 0 (normal seyir): bastırma YOK. Google navigasyonda tam ağı gösterir.
 *   · Tier 1 (50–200 m): hafif geri çekilme — tali yol 0,75 → **1,91**, etiket 0,70 → **4,15**.
 *   · Tier 2 (<50 m): orta — tali yol 0,60 → **1,64**, etiket 0,55 → **3,05**.
 *     Kavşakta bile ÇAPRAZ SOKAKLAR görünür kalır: manevra tam onların arasından
 *     yapılır; %3 opaklıkta silmek güvenlik açısından yanlıştı.
 *   · Motorway/trunk kasetleri hiçbir kademede bastırılmaz (otoyol bağlamı) —
 *     bu kural korunur.
 *
 * Kademeler MONOTONİK azalır ve aynı katman kimliklerini taşır (tam restore).
 * Eşikler `navSuppressionContrast.test.ts` ile kilitlidir; değer bilinçli
 * değişirse kilit GÜNCELLENİR, kaldırılmaz.
 */
export const NAV_SUPPRESS_TIERS: ReadonlyArray<ReadonlyArray<SuppressEntry>> = [
  /* 2026-09-05 — kartografi turunda yol sınıfları ayrıştı (`road-tertiary`,
     `road-service`, `road-secondary-casing`) ve manifest onları da kapsayacak
     şekilde GENİŞLETİLDİ. Eksik bırakılsalardı manevrada geri çekilen yol
     ailesi yarım kalır, ekranda "bazı yollar sönüyor bazıları sönmüyor"
     tutarsızlığı doğardı. Değer sözleşmesi (Tier 0 = bastırma YOK, kademeler
     monotonik) DEĞİŞMEDİ. `road-motorway*` hiçbir kademede bastırılmaz —
     otoyol bağlamı korunur; `road-label-major` de bastırılmaz: manevra
     sırasında sürücünün ihtiyacı olan tam odur (yerel sokak adı `road-label`
     kimliğiyle ayrıldı ve bastırma onun üzerinde kaldı). */
  // ── Tier 0: Normal navigation — bastırma YOK (tam bağlam) ─────────────────
  [
    ['road-primary-casing',   'line-opacity', 1.00],
    ['road-secondary-casing', 'line-opacity', 1.00],
    ['road-minor-casing',     'line-opacity', 1.00],
    ['road-primary',          'line-opacity', 1.00],
    ['road-secondary',        'line-opacity', 1.00],
    ['road-tertiary',         'line-opacity', 1.00],
    ['road-minor',            'line-opacity', 1.00],
    ['road-service',          'line-opacity', 1.00],
    ['road-label',            'text-opacity', 1.00],
    ['place-town',            'text-opacity', 1.00],
  ],
  // ── Tier 1: Turn approach (50-200m) — hafif geri çekilme ──────────────────
  [
    ['road-primary-casing',   'line-opacity', 0.85],
    ['road-secondary-casing', 'line-opacity', 0.82],
    ['road-minor-casing',     'line-opacity', 0.78],
    ['road-primary',          'line-opacity', 0.90],
    ['road-secondary',        'line-opacity', 0.82],
    ['road-tertiary',         'line-opacity', 0.80],
    ['road-minor',            'line-opacity', 0.75],
    ['road-service',          'line-opacity', 0.70],
    ['road-label',            'text-opacity', 0.70],
    ['place-town',            'text-opacity', 0.70],
  ],
  // ── Tier 2: Junction (<50m) — rota koridoru öne çıkar, çapraz sokak KALIR ─
  [
    ['road-primary-casing',   'line-opacity', 0.72],
    ['road-secondary-casing', 'line-opacity', 0.66],
    ['road-minor-casing',     'line-opacity', 0.62],
    ['road-primary',          'line-opacity', 0.80],
    ['road-secondary',        'line-opacity', 0.70],
    ['road-tertiary',         'line-opacity', 0.66],
    ['road-minor',            'line-opacity', 0.60],
    ['road-service',          'line-opacity', 0.56],
    ['road-label',            'text-opacity', 0.55],
    ['place-town',            'text-opacity', 0.55],
  ],
] as const;

/** Backward compat — NAV_SUPPRESS_LAYERS = tier 0 */
export const NAV_SUPPRESS_LAYERS = NAV_SUPPRESS_TIERS[0];

/**
 * Vector tile style — automotive dark theme, OMT schema.
 *
 * Tile source priority:
 *   1. smart-tile://{z}/{x}/{y}  (local .pbf via Filesystem / APK asset)
 *   2. VITE_VECTOR_TILE_URL env  (custom server / MapTiler / etc.)
 *
 * Glyphs:
 *   Online: MapLibre demo CDN (Noto Sans, always accessible)
 *   Offline: no symbol layers — NavigationHUD already shows turn text
 *
 * If no vector source is available, calls onFallback() (→ buildRoadStyle).
 */
/**
 * Vektör taban paleti — TEK katman listesi, iki renk kümesi.
 *
 * NEDEN BÖYLE (saha 2026-08-08, Siverek): gündüz vektör paleti hiç yazılmamıştı
 * ve `buildVectorStyle` gündüzde `onFallback()` ile RASTER OSM'e düşüyordu.
 * Raster karolar önceden pişmiş resimlerdir: binalar bej, yollar sarı/turuncu,
 * otoyol pembe — yeniden renklendirilemez. Sürücünün tarifi: *"Google'da yollar
 * gri, her yer beyaz, çok güzel duruyor; biz OEM seviyesinde hiç değiliz."*
 *
 * Katman listesini ÇOĞALTMIYORUZ: aynı ID'ler, aynı filtreler, aynı genişlikler
 * — yalnız renk yuvaları değişir. Bu kritik, çünkü `NAV_SUPPRESS_TIERS`
 * (navigasyon odak modu) katman ID'lerine isimle bağlıdır; ikinci bir liste
 * doğsaydı gündüz odak modu sessizce ölürdü.
 */
/* ═══════════════════════════════════════════════════════════════════════════
   TİCARİ KARTOGRAFİ YENİDEN TASARIMI — 2026-09-05 (OEM++ / COMMERCIAL)
   ═══════════════════════════════════════════════════════════════════════════

   ÖNCEKİ TURUN GERİ ALINAN KARARI: 2026-09-05 sabahı zemin ve yol ailesi
   "CarOS'un krem/altın gösterge paneli kimliği" gerekçesiyle sıcak bronz/krem
   eksenine taşınmıştı (`#f6f2e9` zemin · `#5e4a34`→`#a99a7f` toprak yollar ·
   gecede `#f2c877` altın otoyol). Kullanıcı gerçek cihazda bakıp bunu
   REDDETTİ: *"dekoratif krem/bronz yaklaşımı profesyonel kartografiye
   dönüşmemiş"*. Karar kaydı: **dashboard teması ≠ kartografi paleti.**
   Haritanın renk sistemi dekorasyon için değil SEMANTİK AYRIM için kurulur.

   ── ÖLÇÜLEN ŞEMA (varsayım değil) ───────────────────────────────────────────
   Kaynak: `VITE_VECTOR_TILE_URL=https://tiles.openfreemap.org/planet` —
   DEĞİŞTİRİLMEMİŞ OpenMapTiles şeması. TileJSON + 3 Türk şehrinin (İstanbul ·
   Siverek · Mersin) z8/10/11/12/13/14 karoları indirilip `@mapbox/vector-tile`
   ile ÇÖZÜLDÜ. Ölçümün bulduğu üç sessiz kusur bu turun gerekçesidir:

   1. **HARİTADA PARK/ORMAN YOKTU.** Eski `landuse-park` katmanı `landuse`
      kaynağında `class in [park, grass, meadow, pitch, playground, golf]`
      arıyordu. Ölçülen `landuse.class` değerleri: school(102) · industrial(75) ·
      cemetery(42) · commercial(40) · university(26) · military(23) ·
      hospital(17) · pitch(14) · residential(12) · quarry · railway · track ·
      retail · bus_station · garages · theme_park · stadium · playground(1).
      **`park` · `grass` · `meadow` · `golf` bu katmanda HİÇ YOK.** Yeşil,
      hiç kullanılmayan `landcover` (grass 156 · farmland 34 · wood 28) ve
      `park` (national_park/nature_reserve/historic/sustainable) katmanlarında
      duruyordu. Yani "yeşil alan yok" bir renk tercihi değil, YANLIŞ KAYNAK
      ADRESİYDİ.
   2. **`landuse-residential` da neredeyse boştu** (`suburb`/`neighbourhood`
      `landuse`'da değil `place`te; `residential` yalnız 12 poligon) — üstünde
      turlarca kontrast tartışılan dolgu ekranda pratikte çizilmiyordu.
   3. **RAMPALAR TAM SINIF GENİŞLİĞİNDE ÇİZİLİYORDU.** Ölçülen `ramp=1` oranı:
      motorway %72 · trunk %58 · primary %25 · secondary %15 · tertiary %9.
      Yani ekrandaki "otoyol" çizgilerinin çoğu aslında kavşak rampasıydı ve
      ana arterle AYNI ağırlıktaydı — "yol ağı fazla baskın, yollar aynı
      ağırlıkta" şikâyetinin matematiksel karşılığı budur.

   ── TON SÖZLEŞMESİ (KORUNDU, ZAYIFLATILMADI) ───────────────────────────────
   Gündüz: **binalar en açık (beyaz) · zemin ortada · yollar en koyu**, otoyol →
   tali monoton açılan gri. Gece: zemin sabit `MAP_BG_NIGHT`, yollar zeminden
   monoton açılır. Bu iki sözleşme saha turlarında kazanıldı ve BU TURDA DA
   GEÇERLİ — değişen yalnız HUE ailesidir: bronz/altın bırakıldı, nötr grafit
   yol ailesi + GERÇEK mavi su + GERÇEK yeşil doğa geldi.

   Ölçülen kontrastlar (WCAG, kendi zeminine karşı — hepsi eski eşiklerin
   ÜSTÜNDE; kilitler yukarı güncellendi, hiçbiri gevşetilmedi):
     GÜNDÜZ  otoyol 4.29 · ana 2.91 · ikincil 2.26 · tali 1.70 · su 1.49
     GECE    otoyol 9.32 · ana 6.80 · ikincil 4.67 · tali 3.03 · su 1.61
     GECE    park↔konut 1.44 · su↔bina 1.26 (ikisi de ayrı hue ekseninde)

   CarOS kimliği renkte değil DAVRANIŞTA aranır: nötr, sakin, teknik bir zemin
   üzerinde tek doygun öğe AKTİF ROTADIR (`routeColorModel`). Google/Yandex/OEM
   paleti KOPYALANMADI; onlardan alınan şey kartografik disiplindir.           */

/**
 * Vektör gündüz zemini — SICAK kâğıt/krem. Saf beyaz DEĞİL, soğuk gri de DEĞİL.
 *
 * 2026-09-05 akşamı kullanıcı gerçek head unit'te soğuk beyaza yakın zemini
 * (`#edeeea`) işaretleyip reddetti, sıcak krem zemini seçti. Zeminin sıcaklığı
 * artık bir DEKORASYON değil, kullanıcı tarafından cihazda seçilmiş bir
 * okunabilirlik tercihidir: beyaz yol gövdeleri ancak sıcak/kırık bir zeminde
 * zeminden ayrılabilir (bkz. `DAY_PALETTE` §4).
 */
export const MAP_BG_DAY_VECTOR = '#f2efe6';

interface VectorPalette {
  readonly bg: string;
  readonly water: string;
  readonly park: string;
  /** Orman/ağaçlık — parktan bir ton koyu (`landcover.class = wood`). */
  readonly forest: string;
  /** Tarım alanı — en sakin doğa tonu (`landcover.class = farmland`). */
  readonly farmland: string;
  readonly residential: string;
  /** Sanayi/ticaret/kurum alanları — konuttan ayrı, nötr "yapılı alan" tonu. */
  readonly urban: string;
  readonly buildingFill: string;
  readonly buildingOutline: string;
  readonly bldg3d: readonly [string, string, string];
  readonly bldg3dOpacity: number;
  /**
   * Bina tabanı kararma şiddeti (ambient occlusion).
   *
   * ⚠️ ŞU AN UYGULANMIYOR (kütük #552): `fill-extrusion-ambient-occlusion-*`
   * Mapbox GL özelliğidir; MapLibre GL 4 tanımaz ve stili reddeder. Değer
   * KORUNUYOR çünkü tasarım kararı geçerli — MapLibre desteklediğinde tek
   * satırla geri bağlanacak.
   */
  readonly bldg3dAO: number;
  /** Yol numarası kalkanı zemini (E-5 · D-100) — çalışma zamanı imajıyla eşleşir. */
  readonly shieldImage: string;
  /** Tünel gövdesinin görünürlüğü — yüzeyin ALTINDA olduğu okunmalı. */
  readonly tunnelOpacity: number;
  /** Köprü kasası — güverte kenarı, altındaki yolu kesmeli. */
  readonly bridgeCasing: string;
  readonly motorwayCasing: string;
  readonly primaryCasing: string;
  /** İkincil/üçüncül yol kasası — tertiary bu turda ayrı sınıf oldu. */
  readonly secondaryCasing: string;
  readonly minorCasing: string;
  readonly motorway: string;
  readonly primary: string;
  readonly secondary: string;
  readonly minor: string;
  /** Demiryolu — `transportation.class = rail`; yol ailesinden AYRI okunur. */
  readonly railway: string;
  /**
   * Yaya yolu / patika çizgisi.
   *
   * Kendi tokeni ZORUNLU: gündüz gövde rengi (beyaz) açık zeminde görünmez,
   * gece kasa rengi (neredeyse siyah) koyu zeminde görünmez — iki temada da
   * doğru olan tek bir mevcut token YOKTU.
   */
  readonly pathLine: string;
  readonly labelText: string;
  readonly labelHalo: string;
  readonly townText: string;
  readonly townHalo: string;
  readonly cityText: string;
  readonly cityHalo: string;
  /** Su adı etiketi — su gövdesiyle aynı hue ailesinde, metin ağırlığı düşük. */
  readonly waterText: string;
  /** POI noktalarının dolgu şeffaflığı — açık zeminde soluk kalmamalı. */
  readonly poiStrong: number;
  readonly poiWeak: number;
  /* POI aileleri — DOYGUN DEĞİL. Eski `#f59e0b/#3b82f6/#ef4444/#8b5cf6`
     dörtlüsü z13–14'te yüzlerce parlak nokta üretiyordu (ölçüldü: tek bir
     İstanbul z14 karosunda 978 POI, yalnız `pharmacy` 151 adet) — ekranın
     "oyuncak" görünmesinin ana kaynaklarından biriydi. */
  readonly poiFuel: string;
  readonly poiMedical: string;
  readonly poiParking: string;
  readonly poiCivic: string;
}

/**
 * OEM gece paleti — nötr grafit yol merdiveni, gerçek mavi su, gerçek yeşil doğa.
 *
 * ── KORUNAN SÖZLEŞME ──────────────────────────────────────────────────────
 *   1. **Zemin `MAP_BG_NIGHT` SABİT** — kimliktir; kontrast zemini açarak değil
 *      üstündeki öğeleri yükselterek kazanılır.
 *   2. **Yol hiyerarşisi TONLA okunur** — her kademe bir altından ≥1,25 ayrılır.
 *   3. **Kasa gövdeden KOYU** — ince tali yolu görünür kılan kasadır.
 *   4. **Geniş ALAN dolguları sakin kalır** (zemine karşı ≤2,5) ve `minor`
 *      yolundan koyudur — parlarlarsa yol ağı içlerinde kaybolur.
 *   5. **Yollar Google gece stilinden ≥2× keskin** (kullanıcı kararı, 2026-08-17).
 *   6. `minor` parlaklığı, rota çekirdeğiyle (`ROUTE_CORE_STOPS_DARK_BASEMAP`)
 *      ≥1,9 kontrast bırakacak DAR bir bantta kalır (ölçülen tavan L≈0,1875);
 *      bu yüzden gece yol merdiveni 4 tondur — 5. bir ton bu bandı kırar.
 *      `tertiary` bu yüzden `secondary` TONUNU paylaşır, ayrımı GENİŞLİK ve
 *      ZOOM bandıyla taşır (bkz. `ROAD_VISIBILITY` matrisi).
 *
 * ── BU TURDA DEĞİŞEN ──────────────────────────────────────────────────────
 * Altın/bronz yol ailesi (`#f2c877`…`#7f7461`) bırakıldı: dekoratifti ve
 * gecede aktif rotayla (mavi/turkuaz) renk yarışına giriyordu. Yerine nötr
 * mavi-grafit merdiven geldi — rota artık gecede tek doygun öğedir.
 * Su/park/konut/bina dörtlüsü hem TON hem HUE ekseninde ayrıştı.
 */
export const NIGHT_PALETTE: VectorPalette = {
  bg:              MAP_BG_NIGHT,
  water:           '#245e85',
  park:            '#36543f',
  forest:          '#2b4732',
  farmland:        '#3c3f31',
  residential:     '#333b4d',
  urban:           '#3a4052',
  buildingFill:    '#39445c',
  buildingOutline: '#485369',
  bldg3d:          ['#39445c', '#485369', '#57647e'],
  bldg3dOpacity:   0.78,
  bldg3dAO:        0.30,
  shieldImage:     SHIELD_IMG_NIGHT,
  tunnelOpacity:   0.42,
  bridgeCasing:    '#0b0e14',
  motorwayCasing:  '#1a212c',
  primaryCasing:   '#181e29',
  secondaryCasing: '#161c26',
  minorCasing:     '#141922',
  /* ── GECE YOLLARI BEYAZ (2026-09-05 akşamı · GERÇEK CİHAZ KARARI) ────────
   * Kullanıcı gece navigasyon ekran görüntüsüyle: *"yolları tam beyaz yap"*.
   * Eski merdiven `#ccd3dc`→`#6f757e` idi ve tali sokaklar koyu gri kalıyordu.
   *
   * ⚠️ BU DEĞİŞİKLİK TEK BAŞINA YAPILAMAZDI — rota sözleşmesiyle çakışıyordu.
   * `routeNightContrast` kilidi rota çekirdeğinin ÜSTÜNDE ÇİZİLDİĞİ YOLDAN
   * en az **1,9** kontrastla ayrılmasını ister. Yol beyazlaşınca eski açık-mavi/
   * turkuaz duraklar (`#72B6FF · #9CA2FF · #24D6C4`, parlaklık 0,40–0,52)
   * beyazın üstünde 1,83'e kadar düşüyordu → rota beyaz yolda KAYBOLURDU.
   * Bu yüzden gece rota durakları da AYNI turda derinleştirildi
   * (`routeColorModel`); iki değişiklik BİRLİKTE geçerlidir.
   *
   * ── HİYERARŞİ NEREYE GİTTİ ───────────────────────────────────────────────
   * Dört yol da beyaz aileye girince TON adımları küçülür (1,04–1,08) ve
   * hiyerarşiyi tek başına taşıyamaz. Bu, gündüz paletinde kullanıcının ZATEN
   * onayladığı sözleşmenin aynısıdır: hiyerarşiyi **GENİŞLİK + KASA** taşır
   * (z14'te tali 2,2 px → otoyol 9,0 px = 4,1×; kasalar zeminden ayırır).
   * Ton YÖNÜ korunur (otoyol en açık → tali en koyu) ve kilitlenir; ADIM
   * büyüklüğü kilidi kasa/genişliğe taşındı — kilit SİLİNMEDİ, hedefi
   * düzeltildi (bkz. `mapNightContrastAndTileError`).
   *
   * Ölçülen (zemine karşı): tali 11,96 · ara 12,85 · ana 13,55 · otoyol 14,06.
   * Rota ↔ yol ayrımı: en dar hâlde **1,95** (turkuaz durak ↔ tali yol). */
  motorway:        '#ffffff',
  primary:         '#f9fbfc',
  secondary:       '#f2f5f8',
  minor:           '#e9edf2',
  railway:         '#5a6274',
  pathLine:        '#5f6673',
  labelText:       '#e6eaf0',
  labelHalo:       '#0a0e16',
  townText:        '#e2eaf5',
  townHalo:        '#060c14',
  cityText:        '#ffffff',
  cityHalo:        '#060c14',
  waterText:       '#8fb8d8',
  poiStrong:       0.6,
  poiWeak:         0.45,
  poiFuel:         '#d9a44a',
  poiMedical:      '#d2726c',
  poiParking:      '#7c9dc0',
  poiCivic:        '#8f8aa6',
};

/**
 * OEM gündüz paleti — **BEYAZ YOL · SICAK KÂĞIT ZEMİN · GERİ ÇEKİLMİŞ BİNA.**
 *
 * ── SÖZLEŞME TERSİNE ÇEVRİLDİ (2026-09-05 akşamı · GERÇEK CİHAZ KARARI) ────
 * Kullanıcı gerçek head unit'ten AYNI konumun iki farklı görünümünü yan yana
 * gönderdi ve birini işaretleyip REDDETTİ:
 *
 *   ❌ REDDEDİLEN — soğuk beyaza yakın zemin + GRİ yol gövdeleri (o an cihazda
 *      kurulu olan vektör stili). *"işaretli olanı istemiyorum"*
 *   ✅ İSTENEN   — sıcak krem zemin + BEYAZ yol gövdeleri + gri kasa, mavi su,
 *      yeşil park (o an raster OSM yoluna düşülmüş kare). *"diğeri güzel"*
 *
 * Bu, eski gündüz sözleşmesinin (**"binalar en açık · zemin ortada · yollar en
 * koyu"**) doğrudan REDDİDİR. O sözleşme bir saha turunda kazanılmıştı ve
 * savunulabilirdi; ama kullanıcı bugün gerçek ekranda bakıp aksini seçti ve
 * ürün kararı kullanıcınındır. Kilitler SİLİNMEDİ — yeni doğru davranışa
 * GÜNCELLENDİ (`mapDayPaletteContrast.test.ts`).
 *
 * ── YENİ SÖZLEŞME (ölçülüp kilitlendi) ────────────────────────────────────
 *   1. **Yollar EN AÇIK** — otoyol saf beyaz, aşağı doğru hafifçe kırılan bir
 *      beyaz merdiven (otoyol 1,000 → tali 0,905 bağıl parlaklık).
 *   2. **Zemin ORTADA ve SICAK** — `#f2efe6` kâğıt/krem (L 0,863).
 *   3. **Binalar zeminden KOYU** — artık kütle geri çekilir, yol öne çıkar.
 *   4. **Yol/zemin ayrımını GÖVDE DEĞİL KASA taşır.** Bu, sözleşmenin en
 *      kritik maddesidir: beyaz gövdenin krem zemine kontrastı zaten düşüktür
 *      (tali 1,05) ve olması gereken budur — okunabilirliği kasa üretir:
 *          kasa↔zemin  otoyol **2,65** · ana 2,34 · ikincil 2,03 · tali **1,76**
 *          gövde↔kasa  otoyol **3,05** · ana 2,63 · ikincil 2,20 · tali **1,84**
 *      2026-08 turundaki *"yollar beyaz, hiçbir şey seçilmiyor"* (1,38) fiyaskosu
 *      beyaz gövdeden DEĞİL, o turda yolun kasasının da açık olmasından geliyordu.
 *      Kilit bu yüzden gövde/zemin oranını değil **kasa/zemin** ve **gövde/kasa**
 *      oranlarını ölçer — kusurun gerçek yeri orasıdır.
 *   5. **Hiyerarşi TON + KASA + GENİŞLİK üçlüsüyle** taşınır; kasa merdiveni
 *      monotoniktir (otoyol kasası en koyu → tali kasası en açık).
 *
 * Gece paletiyle artık AYNI EVRENSEL YÖNDE: her iki temada da **yol en açık,
 * zemin arkada, dolgular sakin**. Eski gündüz paleti bu yönün tersiydi ve iki
 * tema iki ayrı okuma alışkanlığı istiyordu.
 *
 * Aktif rota (`ROUTE_CORE_STOPS_LIGHT_BASEMAP`, doygun mavi) beyaz yol ağının
 * üstünde ESKİSİNDEN GÜÇLÜ okunur: eskiden koyu gri yolun üstündeydi, şimdi
 * beyazın. `routeColorModel` sözleşmesi DEĞİŞMEDİ — mod'a bakar, renge değil.
 */
export const DAY_PALETTE: VectorPalette = {
  bg:              MAP_BG_DAY_VECTOR,
  water:           '#9cc7dc',
  park:            '#c9e0b8',
  forest:          '#b4d3a0',
  farmland:        '#eeeada',
  // Yerleşim/sanayi dokusu zeminden bir tık koyu — bina kütlesinin altında kalır.
  residential:     '#ece8dc',
  urban:           '#e4dfd0',
  /* Bina artık haritanın en açık öğesi DEĞİL: yol ondan açıktır. Kütle zeminden
     koyu (1,26) ve konturuyla ayrılır (1,29) — "evler beyaz" ilkesi kullanıcının
     2026-09-05 cihaz kararıyla yerini "yollar beyaz"a bıraktı. */
  buildingFill:    '#ded6c6',
  buildingOutline: '#c6bda9',
  bldg3d:          ['#ded6c6', '#e7e0d2', '#efe9dd'],
  bldg3dOpacity:   0.95,
  bldg3dAO:        0.48,
  shieldImage:     SHIELD_IMG_DAY,
  tunnelOpacity:   0.34,
  bridgeCasing:    '#8e877a',
  /* Kasa merdiveni — gündüz okunabilirliğin TAŞIYICISI (bkz. §4). */
  motorwayCasing:  '#9a9384',
  primaryCasing:   '#a49d8e',
  secondaryCasing: '#b0a999',
  minorCasing:     '#bdb6a6',
  /* Gövde merdiveni — saf beyazdan sıcak beyaza doğru monoton kırılır. */
  motorway:        '#ffffff',
  primary:         '#fdfcf8',
  secondary:       '#faf8f1',
  minor:           '#f7f4ec',
  railway:         '#b9b2a3',
  /* Yaya yolu kendi tokenini taşır: gövde rengi (beyaz) açık zeminde
     görünmezdi, kasa rengi ise gecede siyah zeminde görünmezdi. */
  pathLine:        '#b0a999',
  labelText:       '#3f3a32',
  labelHalo:       '#ffffff',
  townText:        '#37322b',
  townHalo:        '#ffffff',
  cityText:        '#1e1a15',
  cityHalo:        '#ffffff',
  waterText:       '#3d7495',
  poiStrong:       0.9,
  poiWeak:         0.75,
  poiFuel:         '#b4801e',
  poiMedical:      '#c0504a',
  poiParking:      '#5b7fa6',
  poiCivic:        '#6f6a86',
};

/**
 * Yüzey yolları için brunnel kapısı.
 *
 * OpenMapTiles `transportation` katmanında `brunnel` alanı bir yolun köprü mü,
 * tünel mi yoksa yüzey mi olduğunu söyler. Bu kapı OLMADAN üç durum da AYNI
 * çizilir → katlı kavşak düz bir gri yumak olur, sürücü hangi kolun üstten
 * geçtiğini okuyamaz.
 *
 * Alan YOKSA (`null`) `in` false döner → `!` true → yol yüzey sayılır. Yani
 * brunnel taşımayan karo setlerinde davranış BUGÜNKÜYLE BİREBİR aynıdır —
 * bu değişiklik veri yoksa hiçbir şeyi bozmaz.
 */
function surfaceOnly(classFilter: FilterSpecification): FilterSpecification {
  return ['all',
    classFilter,
    ['!', ['in', ['get', 'brunnel'], ['literal', ['bridge', 'tunnel']]]],
  ] as FilterSpecification;
}

/** Yalnız köprü ya da yalnız tünel — sınıf ayrımı genişlikte yapılır. */
function brunnelOnly(kind: 'bridge' | 'tunnel'): FilterSpecification {
  return ['==', ['get', 'brunnel'], kind] as FilterSpecification;
}

/**
 * Köprü/tünel katmanları TEK katmanda tüm yol sınıflarını taşır (katman sayısı
 * head unit'te bütçe kalemidir). Genişlik sınıfa göre `match` ile seçilir.
 */
function brunnelWidth(scale: number): FilterSpecification {
  /* ⚠️ SIRALAMA PAZARLIKSIZ (kütük #552 · 2026-08-12): zoom `interpolate` EN
     DIŞTA, sınıf `case` stop DEĞERLERİNİN içinde olmalı.
     Eskiden tersiydi (`case` dışta, her dalda ayrı `interpolate`) ve MapLibre
     stili sahada REDDEDİYORDU:
       `layers[7|8|16|17].paint.line-width: Only one zoom-based "step" or
        "interpolate" subexpression may be used in an expression.`
     Sonuç: tünel ve köprü katmanlarının dördü de düşüyor, gövdeler varsayılan
     1 px hat olarak çiziliyordu. Bir ifadede yalnız BİR zoom-bağımlı alt-ifade
     bulunabilir — dallanma stop'ların İÇİNE girer. */
  const atZoom = (mw: number, pri: number, other: number) => ['case',
    ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]], mw * scale,
    ['in', ['get', 'class'], ['literal', ['primary', 'secondary']]], pri * scale,
    other * scale,
  ];
  return ['interpolate', ['linear'], ['zoom'],
    8,  atZoom(4, 2.5, 1.2),
    14, atZoom(12, 9, 5),
    18, atZoom(20, 15, 9),
  ] as unknown as FilterSpecification;
}

/* ═══════════════════════════════════════════════════════════════════════════
   KARTOGRAFİK GENELLEŞTİRME — ZOOM × ÖZELLİK GÖRÜNÜRLÜK MATRİSİ
   ═══════════════════════════════════════════════════════════════════════════
   Profesyonel harita "veride ne varsa çiz" mantığıyla çalışmaz; her zoom
   seviyesinde NEYİN gösterileceğine karar verir. Aşağıdaki eşikler tahmin
   değil ÖLÇÜM sonucudur (OpenFreeMap/OpenMapTiles karoları çözülerek):

     · `transportation` z12'de karo başına 2.697 parça (İstanbul) — tali ağın
       z12'de çizilmesi bilgi değil mürekkeptir.
     · `building` z13'te karo başına 0–1 poligon döndürüyor; gerçek kütle z14.
     · `place` z10–11'de karo başına 124–389 kayıt (Siverek z10: 389) — köy ve
       mahalle adlarının o zoomda basılması etiket çöplüğüdür.
     · `poi` z14'te karo başına 978 kayıt.

   Hedef: DÜŞÜK zoom = şehir yapısı + ana arterler · ORTA zoom = ana + ikincil
   ağ · YÜKSEK zoom = yerel sokak + bina + ayrıntı. Her küçük sokak her zoomda
   bağırmaz.

   Bu tablolar DIŞA AKTARILIR ki kilitler (`cartographyGeneralization.test.ts`)
   stilin kendisiyle aynı tek kaynaktan okusun — ikinci bir matris YOKTUR.     */

/** Yol sınıflarının ilk görüneceği zoom. */
export const ROAD_VISIBILITY = {
  motorway:  { minzoom: 4  },
  primary:   { minzoom: 7  },
  secondary: { minzoom: 9  },
  tertiary:  { minzoom: 11 },
  minor:     { minzoom: 13 },
  service:   { minzoom: 15 },
  path:      { minzoom: 16 },
} as const;

/** Alan/dolgu katmanlarının ilk görüneceği zoom. */
export const AREA_VISIBILITY = {
  'landcover-wood':      5,
  'landuse-park':        5,
  'landcover-grass':     10,
  'landcover-farmland':  10,
  'landuse-residential': 11,
  'landuse-urban':       11,
  'landuse-green':       12,
  'water-pool':          16,
  building:              14,
  'building-3d':         16,
} as const;

/** Etiket ve POI katmanlarının ilk görüneceği zoom. */
export const LABEL_VISIBILITY = {
  'place-city':       4,
  'place-town':       9,
  'road-shield':      9,
  'water-label':      11,
  'place-village':    12,
  'road-label-major': 12,
  'place-suburb':     13,
  'road-label':       15,
  'poi-gas':          15,
  'poi-hospital':     15,
  'poi-police':       15,
  'poi-parking':      16,
} as const;

/**
 * Üst zoom sınırı — şehir adı sokak seviyesinde ekranın ortasında ASILI KALMAZ.
 * (Eski stilde `place-city` hiçbir üst sınır taşımıyordu.)
 */
export const LABEL_VISIBILITY_MAX = {
  'place-city': 15,
} as const;

/**
 * Rampa genişlik çarpanı.
 *
 * ÖLÇÜLEN: `transportation.ramp = 1` oranı motorway %72 · trunk %58 ·
 * primary %25 · secondary %15 · tertiary %9. Eski stil rampayı ana gövdeyle
 * AYNI genişlikte çiziyordu → ekrandaki "otoyol" mürekkebinin çoğu aslında
 * kavşak koluydu ve ana arter onun içinde kayboluyordu.
 */
export const RAMP_WIDTH_FACTOR = 0.55;

/** `class` alanı verilen değerlerden biri mi. */
function classIn(...values: readonly string[]): FilterSpecification {
  return ['in', ['get', 'class'], ['literal', values]] as FilterSpecification;
}

/** `rank` alanı (yoksa 99) en fazla `n` — OMT önem sırası; küçük = önemli. */
function rankAtMost(n: number): FilterSpecification {
  return ['<=', ['coalesce', ['get', 'rank'], 99], n] as FilterSpecification;
}

/** Türkçe ad varsa o, yoksa varsayılan ad. */
const localizedName = ['coalesce', ['get', 'name:tr'], ['get', 'name']] as unknown as string;

/**
 * Zoom→genişlik merdiveni; rampalar `RAMP_WIDTH_FACTOR` ile daraltılır.
 *
 * ⚠️ SIRALAMA PAZARLIKSIZ (kütük #552): zoom `interpolate` EN DIŞTA, rampa
 * `case`'i stop DEĞERLERİNİN içinde. Bir ifadede yalnız BİR zoom-bağımlı
 * alt-ifade bulunabilir; tersi MapLibre tarafından REDDEDİLİR ve katman
 * sessizce 1 px'e düşer.
 */
function roadWidth(
  stops: ReadonlyArray<readonly [zoom: number, width: number]>,
): FilterSpecification {
  const expr: unknown[] = ['interpolate', ['linear'], ['zoom']];
  for (const [z, w] of stops) {
    expr.push(z, ['case',
      ['==', ['get', 'ramp'], 1], Math.round(w * RAMP_WIDTH_FACTOR * 100) / 100,
      w,
    ]);
  }
  return expr as unknown as FilterSpecification;
}
/* ── Hibrit kaynak kapısı ───────────────────────────────────────────────────
 *
 * Öncelik: **yerel .pbf > çevrimiçi vektör > raster.**
 *
 * NEDEN GEREKLİ: `VITE_VECTOR_TILE_URL` tanımlıyken ağ yoksa vektör karolar
 * indirilemez ve harita BOŞ kalır — raster'a kendiliğinden düşmez. Raster yolu
 * ise `caros-tile://` önbelleği sayesinde çevrimdışında da bir şeyler gösterir.
 * Bu yüzden çevrimiçi vektör yalnız KULLANILABİLİR olduğunda seçilir.
 *
 * İki kapı vardır:
 *   1. `navigator.onLine === false` → açılışta hiç denenmez.
 *   2. Karo hataları eşiği aşıldıysa (`blockOnlineVector()`) → oturum boyunca
 *      denenmez. Bu ikincisi ŞART: aksi hâlde raster'a düşen fallback yeniden
 *      `getMapStyle()` çağırır, o yine vektör döner ve **sonsuz döngü** olur.
 *      "Bağlı ama internet yok" durumunu `navigator.onLine` yakalayamaz;
 *      gerçek kanıt karo hatasıdır.
 */
let _onlineVectorBlocked = false;

/** Karo hatası eşiği aşıldı — bu oturumda çevrimiçi vektör bir daha denenmez. */
export function blockOnlineVector(): void { _onlineVectorBlocked = true; }

/** Ağ geri geldi / kullanıcı kaynağı değiştirdi — kapıyı yeniden aç. */
export function unblockOnlineVector(): void { _onlineVectorBlocked = false; }

export function isOnlineVectorBlocked(): boolean { return _onlineVectorBlocked; }

function onlineVectorUsable(): boolean {
  if (_onlineVectorBlocked) return false;
  // `navigator.onLine` yalnız KESİN çevrimdışıyı bildirir; true olması
  // internet garantisi DEĞİLDİR — o yüzden tek dayanak değil, ilk kapıdır.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return true;
}

export function buildVectorStyle(
  sources: Map<string, MapSource>,
  onFallback: () => StyleSpecification,
  night = true,
): StyleSpecification {
  /* Gündüzde artık raster'a DÜŞÜLMEZ — gündüz paleti yukarıda tanımlı.
     (Eski davranış: `if (!night) return onFallback();` → sürücü gündüz hep
     ham OSM raster'ı görüyordu.) */
  const P = night ? NIGHT_PALETTE : DAY_PALETTE;

  const hasLocalPbf = sources.get('local')?.isAvailable === true;
  const customUrl   = (import.meta.env['VITE_VECTOR_TILE_URL'] ?? '') as string;

  // Determine tile URL — must serve .pbf
  /* Kaynak iki biçimde gelebilir:
       · KARO ŞABLONU — `{z}/{x}/{y}` içerir, doğrudan `tiles` olarak verilir.
       · TileJSON UCU — şablon içermez; MapLibre'ye `url` olarak verilir ve
         gerçek karo adresini O çözer.

     TileJSON desteği ZORUNLU: sağlayıcılar karo yoluna veri sürümü damgası
     koyar (ör. OpenFreeMap `/planet/20260802_080001_pt/{z}/{x}/{y}.pbf`).
     Damgalı şablonu sabitlemek, sağlayıcı veriyi tazelediği gün haritayı
     sessizce kırardı — TileJSON her açılışta güncel adresi verir. */
  let vectorTiles: string[] | null = null;
  let vectorTileJson: string | null = null;

  if (hasLocalPbf) {
    // Yerel .pbf ağdan BAĞIMSIZDIR → çevrimdışında da vektör kalitesi korunur.
    vectorTiles = ['smart-tile://{z}/{x}/{y}'];
  } else if (customUrl && onlineVectorUsable()) {
    if (customUrl.includes('{z}')) vectorTiles = [customUrl];
    else vectorTileJson = customUrl;
  } else {
    // No vector source → fall back to raster (smart-tile handles online OSM)
    return onFallback();
  }

  // Glyph-cache protokolü offline'da da etiket render eder (cache'den veya boş döner).
  // 'includeLabels = isOnline' koşulu artık gerekmez — her zaman aktif.
  const includeLabels = true;
  const glyphsUrl = 'glyph-cache://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

  const style: StyleSpecification = {
    version: 8,
    /* Ad TEMAYA göre verilir. Eskiden sabit "Vector (Automotive Dark)" idi;
       gündüz paleti yazıldıktan sonra (#482) gündüzde de bu ad dönüyordu ve
       teşhis çıktısı "koyu vektör" diye okunuyordu. Ad, ne çizildiğini
       söylemeli. */
    name: night ? 'Vector (Automotive Night)' : 'Vector (Automotive Day)',
    ...(includeLabels ? { glyphs: glyphsUrl } : {}),
    sources: {
      omv: {
        type: 'vector',
        ...(vectorTileJson ? { url: vectorTileJson } : { tiles: vectorTiles! }),
        minzoom: 0,
        maxzoom: 14,
        // ODbL gereği atıf ZORUNLU. TileJSON kendi atfını taşısa da kaynak
        // yerel .pbf olduğunda o metin gelmez — taban atıf her hâlde durur.
        attribution: '© OpenMapTiles © OpenStreetMap katkıcıları',
      },
      // ── Terrain DEM — rgb-terrarium encoding (Mapzen/AWS) ──────────────────
      // 3D yüzey render'ı için: fill-extrusion + hill-shade
      // Android WebView WebGL2 desteği varsa aktif olur; yoksa sessizce atlanır.
      'terrain-rgb': {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        tileSize: 256,
        encoding: 'terrarium' as const,
        maxzoom: 14,
        attribution: '© Mapzen',
      },
    },
    // terrain opsiyonu — WebGL2 varsa arazi yüksekliği aktif
    terrain: { source: 'terrain-rgb', exaggeration: 1.2 },
    layers: [
      /* ═══════════════════════════════════════════════════════════════════
         ÇİZİM SIRASI = ANLAM SIRASI
         ───────────────────────────────────────────────────────────────────
         zemin → doğa → yapılı alan → su → hava/demiryolu → bina → tünel →
         yol KASALARI (küçükten büyüğe) → yol GÖVDELERİ (küçükten büyüğe) →
         köprü → POI → ETİKETLER (en düşük öncelikliden en yükseğe).

         ⚠️ İKİ SIRA KURALI PAZARLIKSIZ:
         1. Yol gövdeleri KÜÇÜKTEN BÜYÜĞE çizilir. Eski listede `road-minor`
            EN SON geliyordu → tali sokaklar otoyolun ÜSTÜNE biniyordu ve
            kavşaklarda ana arter kesiliyordu. "Yol ağı fazla baskın, yollar
            aynı ağırlıkta" şikâyetinin görsel yarısı buydu.
         2. Etiket katmanları TERS öncelikli sıralanır: MapLibre yerleşimi
            (`pauseable_placement.ts`, `_currentPlacementIndex = order.length-1`)
            listeyi SONDAN BAŞA tarar → listede EN SONDAKİ sembol katmanı
            çakışmayı KAZANIR. Bu yüzden en düşük öncelikli etiket (POI/mahalle)
            başta, en yüksek öncelikli (şehir/kalkan) sonda durur.          */

      // ── Zemin ────────────────────────────────────────────────
      { id: 'background',
        type: 'background',
        paint: { 'background-color': P.bg } },

      /* ── Doğa (landcover) — bu turda İLK KEZ çiziliyor ─────────
         Eski stil yeşili `landuse` katmanında arıyordu; ölçüm o katmanda
         `park`/`grass`/`meadow` sınıflarının HİÇ OLMADIĞINI gösterdi.
         Gerçek kaynak `landcover` (grass · wood · farmland · sand) ve ayrı
         `park` katmanıdır. */
      { id: 'landcover-wood',
        type: 'fill',
        source: 'omv',
        'source-layer': 'landcover',
        minzoom: AREA_VISIBILITY['landcover-wood'],
        filter: classIn('wood', 'forest'),
        paint: { 'fill-color': P.forest, 'fill-opacity': 0.9 } },
      { id: 'landcover-farmland',
        type: 'fill',
        source: 'omv',
        'source-layer': 'landcover',
        minzoom: AREA_VISIBILITY['landcover-farmland'],
        filter: classIn('farmland'),
        paint: { 'fill-color': P.farmland, 'fill-opacity': 0.75 } },
      { id: 'landcover-grass',
        type: 'fill',
        source: 'omv',
        'source-layer': 'landcover',
        minzoom: AREA_VISIBILITY['landcover-grass'],
        filter: classIn('grass', 'meadow', 'heath', 'scrub'),
        paint: { 'fill-color': P.park, 'fill-opacity': 0.8 } },
      /* `landuse-park` KİMLİĞİ KORUNDU (gürültü sözleşmesi ve kilitler bu ada
         bağlı) ama artık DOĞRU kaynağı okuyor: ayrı `park` katmanı. */
      { id: 'landuse-park',
        type: 'fill',
        source: 'omv',
        'source-layer': 'park',
        minzoom: AREA_VISIBILITY['landuse-park'],
        paint: { 'fill-color': P.park, 'fill-opacity': 0.85 } },

      // ── Yapılı alan ───────────────────────────────────────────
      { id: 'landuse-residential',
        type: 'fill',
        source: 'omv',
        'source-layer': 'landuse',
        minzoom: AREA_VISIBILITY['landuse-residential'],
        filter: classIn('residential'),
        paint: { 'fill-color': P.residential } },
      { id: 'landuse-urban',
        type: 'fill',
        source: 'omv',
        'source-layer': 'landuse',
        minzoom: AREA_VISIBILITY['landuse-urban'],
        filter: classIn('industrial', 'commercial', 'retail', 'quarry',
          'garages', 'railway', 'military', 'bus_station', 'school',
          'university', 'hospital'),
        paint: { 'fill-color': P.urban } },
      { id: 'landuse-green',
        type: 'fill',
        source: 'omv',
        'source-layer': 'landuse',
        minzoom: AREA_VISIBILITY['landuse-green'],
        filter: classIn('cemetery', 'pitch', 'playground', 'theme_park',
          'stadium', 'track', 'golf'),
        paint: { 'fill-color': P.park, 'fill-opacity': 0.7 } },

      // ── Su ────────────────────────────────────────────────────
      /* Havuzlar (`class = swimming_pool`, ölçülen: tek karoda 18 adet) su
         gövdesiyle AYNI katmanda çizilince şehir bahçelerinde mavi benekler
         oluşuyordu — ayrıldı ve yalnız yakın zoomda gösteriliyor. */
      { id: 'water-fill',
        type: 'fill',
        source: 'omv',
        'source-layer': 'water',
        filter: ['!=', ['get', 'class'], 'swimming_pool'] as FilterSpecification,
        paint: { 'fill-color': P.water } },
      { id: 'water-pool',
        type: 'fill',
        source: 'omv',
        'source-layer': 'water',
        minzoom: AREA_VISIBILITY['water-pool'],
        filter: ['==', ['get', 'class'], 'swimming_pool'] as FilterSpecification,
        paint: { 'fill-color': P.water, 'fill-opacity': 0.75 } },
      { id: 'waterway',
        type: 'line',
        source: 'omv',
        'source-layer': 'waterway',
        minzoom: 8,
        filter: classIn('river', 'canal'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.water,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 12, 1.6, 16, 4],
        } },
      { id: 'waterway-stream',
        type: 'line',
        source: 'omv',
        'source-layer': 'waterway',
        minzoom: 13,
        filter: classIn('stream', 'ditch', 'drain'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.water,
          'line-opacity': 0.75,
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 17, 2],
        } },

      // ── İdari sınır — düşük zoomda "şehir yapısı" okunabilirliği ─
      { id: 'boundary',
        type: 'line',
        source: 'omv',
        'source-layer': 'boundary',
        minzoom: 3,
        filter: ['<=', ['coalesce', ['get', 'admin_level'], 99], 4] as FilterSpecification,
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': P.buildingOutline,
          'line-opacity': 0.55,
          'line-dasharray': [3, 2],
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 8, 1.2, 12, 1.6],
        } },

      // ── Havaalanı ve demiryolu ────────────────────────────────
      { id: 'aeroway',
        type: 'line',
        source: 'omv',
        'source-layer': 'aeroway',
        minzoom: 11,
        filter: classIn('runway', 'taxiway'),
        layout: { 'line-cap': 'butt' },
        paint: {
          'line-color': P.urban,
          'line-width': ['interpolate', ['linear'], ['zoom'],
            11, ['case', ['==', ['get', 'class'], 'runway'], 2, 0.6],
            14, ['case', ['==', ['get', 'class'], 'runway'], 7, 2],
            17, ['case', ['==', ['get', 'class'], 'runway'], 20, 6],
          ],
        } } as LayerSpecification,
      /* Demiryolu yol ailesinden AYRI okunur: kesikli, düşük ağırlık. Ölçümde
         `transportation.class = rail` vardı ama HİÇ çizilmiyordu. */
      { id: 'railway',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        minzoom: 11,
        filter: classIn('rail', 'transit'),
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': P.railway,
          'line-opacity': 0.8,
          'line-dasharray': [2.5, 2],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 14, 1.4, 17, 2.6],
        } } as LayerSpecification,

      // ── Binalar ───────────────────────────────────────────────
      /* z13 → z14: ölçümde `building` katmanı z13'te karo başına 0–1 poligon
         döndürüyordu (yani z13 görünürlüğü hiçbir bilgi taşımıyor, yalnız
         karo çözme maliyeti üretiyordu); gerçek kütle z14'te başlıyor.
         `hide_3d` alanı OMT'de vardı ve kullanılmıyordu — 3B'de artık dikkate
         alınır (kule/çatı çift çizimini önler). */
      { id: 'building',
        type: 'fill',
        source: 'omv',
        'source-layer': 'building',
        minzoom: AREA_VISIBILITY.building,
        paint: { 'fill-color': P.buildingFill, 'fill-outline-color': P.buildingOutline } },
      { id: 'building-3d',
        type: 'fill-extrusion',
        source: 'omv',
        'source-layer': 'building',
        minzoom: AREA_VISIBILITY['building-3d'],
        filter: ['!=', ['get', 'hide_3d'], true] as FilterSpecification,
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'],
            ['coalesce', ['get', 'render_height'], ['get', 'height'], 5],
            0,  P.bldg3d[0],
            20, P.bldg3d[1],
            60, P.bldg3d[2],
          ],
          'fill-extrusion-opacity':           P.bldg3dOpacity,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
          'fill-extrusion-base':   ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
          /* Hacim hissini veren TEK desteklenen araç bu (taban→tepe koyu→açık).
             `fill-extrusion-ambient-occlusion-*` BİLEREK YOK: Mapbox GL'e aittir,
             MapLibre GL 4 tanımaz ve stili sahada REDDEDİYORDU (kütük #552).
             `P.bldg3dAO` tokeni KORUNDU — açık borç. */
          'fill-extrusion-vertical-gradient': true,
        },
      } as LayerSpecification,

      // ── Tüneller — yüzey yollarının ALTINDA ───────────────────
      // Sıra kasıtlı: tünel önce çizilir, üstüne yüzey yolları biner.
      { id: 'road-tunnel-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: brunnelOnly('tunnel'),
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': P.minorCasing,
          'line-width': brunnelWidth(1.15) as unknown as number,
          'line-dasharray': [2.4, 1.6],
          'line-opacity': P.tunnelOpacity,
        } } as LayerSpecification,
      { id: 'road-tunnel',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: brunnelOnly('tunnel'),
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': P.bg,
          'line-width': brunnelWidth(0.82) as unknown as number,
          'line-opacity': P.tunnelOpacity + 0.24,
        } } as LayerSpecification,

      /* ── YOL KASALARI — küçükten büyüğe ─────────────────────────
         Kasa, ince yolu zeminden ayıran öğedir; gövdeden bir ton koyudur ve
         gövdeden GENİŞTİR. Kasa merdiveni gövde merdiveniyle aynı sırada
         çizilir ki kavşakta üst sınıf altı sınıfı kessin.                  */
      { id: 'road-minor-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(classIn('minor', 'service', 'track')),
        minzoom: ROAD_VISIBILITY.minor.minzoom + 1,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.minorCasing,
          'line-width': roadWidth([[14, 2.6], [16, 4.6], [18, 9]]) as unknown as number,
        } },
      { id: 'road-secondary-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(classIn('secondary', 'tertiary')),
        minzoom: ROAD_VISIBILITY.tertiary.minzoom,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.secondaryCasing,
          'line-width': roadWidth([[11, 1.6], [14, 5.2], [18, 13]]) as unknown as number,
        } },
      { id: 'road-primary-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(classIn('primary')),
        minzoom: ROAD_VISIBILITY.primary.minzoom + 1,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.primaryCasing,
          'line-width': roadWidth([[8, 2.2], [14, 8.4], [18, 18]]) as unknown as number,
        } },
      { id: 'road-motorway-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(classIn('motorway', 'trunk')),
        minzoom: ROAD_VISIBILITY.motorway.minzoom + 1,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.motorwayCasing,
          'line-width': roadWidth([[5, 2.4], [10, 5], [14, 11.5], [18, 24]]) as unknown as number,
        } },

      /* ── YOL GÖVDELERİ — küçükten büyüğe ────────────────────────
         Genişlik merdiveni her zoomda AYRIK: z14'te tali 2,2 · üçüncül 3,2 ·
         ikincil 4,2 · ana 6,4 · otoyol 9,0 px. Rampalar (`ramp = 1`; ölçülen
         oran otoyolda %72) `RAMP_WIDTH_FACTOR` ile daraltılır — bağlantı kolu
         asla ana arterle aynı ağırlıkta olamaz.                            */
      { id: 'road-path',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(classIn('path')),
        minzoom: ROAD_VISIBILITY.path.minzoom,
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': P.pathLine,
          'line-opacity': 0.7,
          'line-dasharray': [1.6, 1.6],
          'line-width': ['interpolate', ['linear'], ['zoom'], 16, 0.8, 19, 2],
        } } as LayerSpecification,
      { id: 'road-service',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(classIn('service', 'track', 'busway')),
        minzoom: ROAD_VISIBILITY.service.minzoom,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.minor,
          'line-opacity': 0.85,
          'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.9, 18, 3.4],
        } },
      { id: 'road-minor',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(classIn('minor')),
        minzoom: ROAD_VISIBILITY.minor.minzoom,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.minor,
          'line-width': roadWidth([[13, 0.9], [14, 2.2], [16, 4], [18, 7.4]]) as unknown as number,
        } },
      { id: 'road-tertiary',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(classIn('tertiary')),
        minzoom: ROAD_VISIBILITY.tertiary.minzoom,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.secondary,
          /* Üçüncül yol `secondary` TONUNU paylaşır (gece 4-ton merdiven
             zorunluluğu, bkz. NIGHT_PALETTE §6); ayrımı YALNIZ GENİŞLİK taşır.
             ⚠️ Opaklık rampası BİLEREK KULLANILMADI: `road-tertiary`
             `NAV_SUPPRESS_TIERS`in sahibi olduğu bir katmandır ve bastırma
             `line-opacity`ye DÜZ SAYI yazar — stile zoom ifadesi koymak o
             yazımla birlikte kalıcı olarak silinirdi (iki otorite çatışması).
             Ölçüm: tertiary karo başına 808 parça, secondary'den (633) FAZLA;
             bu yüzden orta zoomda belirgin biçimde İNCE tutulur (z12'de ~0,95 px
             karşılık secondary 2,2 px = 2,3×). */
          'line-width': roadWidth([[11, 0.5], [13, 1.5], [14, 3.0], [18, 8.8]]) as unknown as number,
        } },
      { id: 'road-secondary',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(classIn('secondary')),
        minzoom: ROAD_VISIBILITY.secondary.minzoom,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.secondary,
          'line-width': roadWidth([[9, 0.8], [12, 2.2], [14, 4.2], [18, 10.5]]) as unknown as number,
        } },
      { id: 'road-primary',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(classIn('primary')),
        minzoom: ROAD_VISIBILITY.primary.minzoom,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.primary,
          'line-width': roadWidth([[7, 0.9], [12, 3.2], [14, 6.4], [18, 15]]) as unknown as number,
        } },
      { id: 'road-motorway',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(classIn('motorway', 'trunk')),
        minzoom: ROAD_VISIBILITY.motorway.minzoom,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.motorway,
          'line-width': roadWidth([[4, 0.8], [10, 3], [14, 9], [18, 20]]) as unknown as number,
        } },

      // ── Köprüler — yüzey yollarının ÜSTÜNDE ───────────────────
      { id: 'road-bridge-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: brunnelOnly('bridge'),
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': P.bridgeCasing,
          'line-width': brunnelWidth(1.42) as unknown as number,
        } } as LayerSpecification,
      { id: 'road-bridge',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: brunnelOnly('bridge'),
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          // Gövde rengi sınıfı izler → köprüde de yol hiyerarşisi korunur.
          'line-color': ['case',
            ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]], P.motorway,
            ['==', ['get', 'class'], 'primary'], P.primary,
            ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary']]], P.secondary,
            P.minor,
          ] as unknown as string,
          'line-width': brunnelWidth(1.0) as unknown as number,
        } } as LayerSpecification,

      /* ── SÜRÜŞE İLİŞKİN POI ─────────────────────────────────────
         ÖLÇÜLEN KUSUR: `poi` katmanı tek bir İstanbul z14 karosunda 978
         nokta taşıyor ve eski stil bunların `pharmacy`(151) · `parking` ·
         `hospital` · `police` alt kümesini z13–14'te DOYGUN renklerle
         (#f59e0b/#3b82f6/#ef4444/#8b5cf6) çiziyordu. Ekranın "oyuncak"
         görünmesinin kaynaklarından biri buydu.
         YENİ SÖZLEŞME: sürüş kararına giren dört aile · `rank` ile
         sınırlandırılmış · sönük renkli · daha yakın zoomda. `pharmacy`
         KALDIRILDI (sürüş kararı değil, en kalabalık POI sınıfıydı).       */
      { id: 'poi-gas',
        type: 'circle',
        source: 'omv',
        'source-layer': 'poi',
        minzoom: LABEL_VISIBILITY['poi-gas'],
        filter: ['all', classIn('fuel'), rankAtMost(15)] as FilterSpecification,
        paint: {
          'circle-color':        P.poiFuel,
          'circle-radius':       ['interpolate', ['linear'], ['zoom'], 14, 3, 17, 5],
          'circle-opacity':      P.poiStrong,
          'circle-stroke-color': P.labelHalo,
          'circle-stroke-width': 0.8,
        } } as LayerSpecification,
      { id: 'poi-hospital',
        type: 'circle',
        source: 'omv',
        'source-layer': 'poi',
        minzoom: LABEL_VISIBILITY['poi-hospital'],
        filter: ['all', classIn('hospital'), rankAtMost(25)] as FilterSpecification,
        paint: {
          'circle-color':        P.poiMedical,
          'circle-radius':       ['interpolate', ['linear'], ['zoom'], 14, 3, 17, 5],
          'circle-opacity':      P.poiStrong,
          'circle-stroke-color': P.labelHalo,
          'circle-stroke-width': 0.8,
        } } as LayerSpecification,
      { id: 'poi-police',
        type: 'circle',
        source: 'omv',
        'source-layer': 'poi',
        minzoom: LABEL_VISIBILITY['poi-police'],
        filter: ['all', classIn('police', 'fire_station'), rankAtMost(25)] as FilterSpecification,
        paint: {
          'circle-color':        P.poiCivic,
          'circle-radius':       ['interpolate', ['linear'], ['zoom'], 15, 2.6, 17, 4],
          'circle-opacity':      P.poiWeak,
          'circle-stroke-color': P.labelHalo,
          'circle-stroke-width': 0.8,
        } } as LayerSpecification,
      { id: 'poi-parking',
        type: 'circle',
        source: 'omv',
        'source-layer': 'poi',
        minzoom: LABEL_VISIBILITY['poi-parking'],
        filter: ['all', classIn('parking'), rankAtMost(12)] as FilterSpecification,
        paint: {
          'circle-color':        P.poiParking,
          'circle-radius':       ['interpolate', ['linear'], ['zoom'], 16, 2.6, 18, 4],
          'circle-opacity':      P.poiWeak,
          'circle-stroke-color': P.labelHalo,
          'circle-stroke-width': 0.8,
        } } as LayerSpecification,

      /* ═══ ETİKET MOTORU — ÖNCELİK SIRASI (düşükten yükseğe) ═══════════════
         MapLibre yerleşimi listeyi SONDAN tarar; bu yüzden aşağıdaki sıra
         "en son yazılan kazanır" demektir:
             mahalle < yerel sokak < köy < su adı < ana yol < kasaba <
             yol numarası kalkanı < şehir
         Ayrıca her katman `symbol-sort-key` ile KENDİ İÇİNDE de sıralanır
         (`place.rank` / `poi.rank` — ikisi de ölçülüp doğrulandı).

         ÖLÇÜLEN KUSUR: `place` katmanı düşük zoomda karo başına 124–389
         özellik taşıyor (Siverek z10: 389) ve eski `place-town` katmanı
         town+village+hamlet'i SABİT 13 px ile, minzoom/maxzoom ve rank
         süzgeci OLMADAN çiziyordu. `road-label` ise minzoom 12'den itibaren
         TÜM yol sınıflarını aynı boyda basıyordu; ölçümde `transportation_name`
         sınıf dağılımı minor 565 · trunk 238 · motorway 151 · primary 77 —
         yani ekrandaki yazının çoğu yerel sokak adıydı. Üstelik motorway/trunk/
         primary kayıtlarının %61–84'ü `subclass = junction` (kavşak adı) idi
         ve bunlar da sokak adı gibi basılıyordu.                            */
      ...(includeLabels ? ([
        { id: 'place-suburb',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'place',
          minzoom: LABEL_VISIBILITY['place-suburb'],
          filter: ['all',
            classIn('suburb', 'quarter', 'neighbourhood'),
            rankAtMost(30),
          ] as FilterSpecification,
          layout: {
            'text-field': localizedName,
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 12.5],
            'text-letter-spacing': 0.05,
            'text-padding': 8,
            'text-transform': 'uppercase',
            'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
          },
          paint: {
            'text-color': P.townText,
            'text-opacity': 0.8,
            'text-halo-color': P.townHalo,
            'text-halo-width': 1.4,
          } } as LayerSpecification,
        /* `road-label` KİMLİĞİ KORUNDU ama artık YALNIZ YEREL sokaklar:
           bastırma tabloları (`NAV_SUPPRESS_TIERS`), mini harita çarpanı ve
           yüksek hız gizlemesi hep bu kimliğe bağlıydı ve hepsinin doğru
           hedefi zaten yerel sokak adıdır. Ana yol adları ayrı katmana
           (`road-label-major`) taşındı ve manevrada SUSTURULMAZ. */
        { id: 'road-label',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'transportation_name',
          minzoom: LABEL_VISIBILITY['road-label'],
          filter: ['all',
            classIn('minor', 'tertiary', 'service'),
            ['!=', ['get', 'subclass'], 'junction'],
          ] as FilterSpecification,
          layout: {
            'text-field': localizedName,
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 17, 12],
            'symbol-placement': 'line',
            'text-max-angle': 30,
            'text-padding': 6,
            'symbol-spacing': 340,
            'text-letter-spacing': 0.01,
          },
          paint: {
            'text-color': P.labelText,
            /* ⚠️ SABİT DEĞER, ZOOM İFADESİ DEĞİL: `road-label.text-opacity`
               `NAV_SUPPRESS_TIERS` + `MapLayerManager` (yüksek hız gizlemesi,
               mood) tarafından DÜZ SAYIYLA yazılır. Buraya zoom ifadesi
               koymak ilk yazımda kalıcı olarak silinirdi — genelleştirme
               bu yüzden `minzoom` ve `text-size` ile taşınır.
               Ölçüm: `transportation_name` içinde en kalabalık sınıf `minor`
               (565); eski stil bunları z12'den itibaren basıyordu — "sokak
               isimleri haritayı domine ediyor" şikâyetinin doğrudan kaynağı.
               Artık z15'ten önce HİÇ çizilmiyorlar. */
            'text-opacity': 0.85,
            'text-halo-color': P.labelHalo,
            'text-halo-width': 1.3,
            'text-halo-blur': 0.4,
          } } as LayerSpecification,
        { id: 'place-village',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'place',
          minzoom: LABEL_VISIBILITY['place-village'],
          filter: ['all', classIn('village', 'hamlet'), rankAtMost(20)] as FilterSpecification,
          layout: {
            'text-field': localizedName,
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10.5, 16, 13],
            'text-padding': 10,
            'text-letter-spacing': 0.02,
            'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
          },
          paint: {
            'text-color': P.townText,
            'text-halo-color': P.townHalo,
            'text-halo-width': 1.6,
          } } as LayerSpecification,
        { id: 'water-label',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'water_name',
          minzoom: LABEL_VISIBILITY['water-label'],
          layout: {
            'text-field': localizedName,
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 13],
            'text-padding': 10,
            'text-letter-spacing': 0.08,
          },
          paint: {
            'text-color': P.waterText,
            'text-halo-color': P.labelHalo,
            'text-halo-width': 1.2,
          } } as LayerSpecification,
        { id: 'road-label-major',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'transportation_name',
          minzoom: LABEL_VISIBILITY['road-label-major'],
          filter: ['all',
            classIn('motorway', 'trunk', 'primary', 'secondary'),
            ['!=', ['get', 'subclass'], 'junction'],
          ] as FilterSpecification,
          layout: {
            'text-field': localizedName,
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 13.5],
            'symbol-placement': 'line',
            'text-max-angle': 30,
            'text-padding': 5,
            'symbol-spacing': 260,
            'text-letter-spacing': 0.02,
            'symbol-sort-key': ['match', ['get', 'class'],
              'motorway', 1, 'trunk', 2, 'primary', 3, 4],
          },
          paint: {
            'text-color': P.labelText,
            'text-halo-color': P.labelHalo,
            'text-halo-width': 1.7,
            'text-halo-blur': 0.4,
          } } as LayerSpecification,
        { id: 'place-town',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'place',
          minzoom: LABEL_VISIBILITY['place-town'],
          filter: ['all', classIn('town'), rankAtMost(22)] as FilterSpecification,
          layout: {
            'text-field': localizedName,
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 9, 11.5, 14, 15],
            'text-padding': 12,
            'text-letter-spacing': 0.03,
            'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
          },
          paint: {
            'text-color': P.townText,
            'text-halo-color': P.townHalo,
            'text-halo-width': 1.9,
            'text-halo-blur': 0.4,
          } } as LayerSpecification,
        /* ── Yol numarası kalkanı (E-5 · D-100 · O-4) ──────────────────────
           Sürücü tabelayı haritayla EŞLEŞTİRİR: yol adı yeterli değildir,
           numara birincil referanstır. Kavşak kayıtları (`subclass = junction`)
           DIŞLANIR — ölçümde motorway/trunk/primary kayıtlarının %61–84'ü
           kavşaktı ve kalkanlar kavşak adlarıyla doluyordu. */
        { id: 'road-shield',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'transportation_name',
          minzoom: LABEL_VISIBILITY['road-shield'],
          filter: ['all',
            ['has', 'ref'],
            classIn('motorway', 'trunk', 'primary'),
            ['!=', ['get', 'subclass'], 'junction'],
          ] as FilterSpecification,
          layout: {
            'text-field': ['get', 'ref'],
            'text-font': ['Noto Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 12.5],
            'text-letter-spacing': 0.04,
            'icon-image': P.shieldImage,
            'icon-text-fit': 'both',
            'icon-text-fit-padding': [2, 5, 2, 5],
            'symbol-placement': 'line',
            'symbol-spacing': 300,
            'text-padding': 3,
            'icon-allow-overlap': false,
            'text-allow-overlap': false,
            'symbol-sort-key': ['match', ['get', 'class'],
              'motorway', 1, 'trunk', 2, 3],
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': 'rgba(0,0,0,0.35)',
            'text-halo-width': 0.8,
          } } as LayerSpecification,
        { id: 'place-city',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'place',
          minzoom: LABEL_VISIBILITY['place-city'],
          maxzoom: LABEL_VISIBILITY_MAX['place-city'],
          filter: classIn('city'),
          layout: {
            'text-field': localizedName,
            'text-font': ['Noto Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 5, 12, 10, 16, 14, 19],
            'text-padding': 14,
            'text-letter-spacing': 0.05,
            'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
          },
          paint: {
            'text-color': P.cityText,
            'text-halo-color': P.cityHalo,
            'text-halo-width': 2.2,
            'text-halo-blur': 0.4,
          } } as LayerSpecification,
      ] as LayerSpecification[]) : []),
    ],
  };

  return style;
}

/* ═══════════════════════════════════════════════════════════════════════════
   HARİTA GÜN/GECE TOKEN SİSTEMİ — TEK KAYNAK
   ═══════════════════════════════════════════════════════════════════════════
   Gündüz ve gece görünümü AYNI token setinden üretilir; bileşen içinde
   rastgele renk YOKTUR. `buildRoadStyle` (stil kurulumu) ve `applyMapDayNight`
   (canlı geçiş) ikisi de buradan okur → tek bir yerde değiştirilir.

   ⚠️ RASTER SINIRI (dürüstlük notu): ürünün varsayılan yolu RASTER OSM
   tile'ıdır (`buildVectorStyle` yalnız yerel .pbf veya `VITE_VECTOR_TILE_URL`
   varsa devreye girer; yoksa raster'a düşer). Raster'da **katman başına**
   (bina / ara yol / ana yol / etiket / POI / su) ayrı renk vermek MÜMKÜN
   DEĞİLDİR — elde yalnız tüm görüntüye uygulanan parlaklık/kontrast/doygunluk
   vardır. Bu yüzden "sokak isimleri okunsun ama arka plan koyu kalsın"
   dengesi burada KONTRAST ile kurulur, katman renkleriyle değil. Gerçek
   katman-bazlı gece paleti vektör stildedir (`buildVectorStyle`).

   ── SAHA GEÇMİŞİ ──────────────────────────────────────────────────────────
   • 2026-06-13: "çok koyu, yazı okunmuyor" → koyulaştırma brightness ile
     yapılır, contrast düşürülerek etiketler EZİLMEZ.
   • 2026-08-02 (Mersin, gerçek cihaz `adb screencap`): brightness-max .50
     gündüz parlaklığındaydı; .08 fazla sönük; **.16 seçildi.**
   • 2026-08-04 (bu tur): kullanıcı mini haritada "gece çok karanlık,
     okunamıyor" bildirdi. .16 tam ekranda kabul edilebilirken mini haritada
     (küçük alan, ince yol çizgileri, küçük etiketler) yol ağı seçilemiyordu.
     Okunabilirlik profili yükseltildi: parlaklık .16 → .25, kontrast .30 → .40
     (ana/ara yol ayrımı ve etiket kenarları), doygunluk -.70 → -.58 (su/yeşil
     ipuçları geri gelir, neon olmaz). Gündüze DÖNMEZ: .25, gündüzün 1.0'ının
     dörtte birinden azdır ve medya kartından parlak değildir.
   • ÜST SINIR .25 PAZARLIKSIZ: `regression.guards` içindeki saha kilidi
     (2026-08-02, ölçülen 180/255 piksel) bunu bağlar. Okunabilirlik artışı bu
     zarfın İÇİNDE yapılır — kilit zayıflatılarak DEĞİL.                      */

/** Profil adı — CAROS LAB `mapContrastProfile` alanı bunu gösterir. */
export type MapContrastProfile = 'NIGHT_READABLE' | 'DAY_NATURAL';

/** Gece token seti (raster). Tek kaynak — canlı geçiş de bunu kullanır. */
export const RASTER_PAINT_NIGHT = {
  'raster-opacity': 1,
  'raster-contrast': 0.40,
  'raster-brightness-min': 0.02,   // saf siyah YOK — 0 blokları detayı yutuyordu
  'raster-brightness-max': 0.25,
  'raster-saturation': -0.58,
  'raster-hue-rotate': 15,
} as const;

/** Gündüz token seti — ham OSM'nin doğal renkleri, koyulaştırma YOK. */
export const RASTER_PAINT_DAY = {
  'raster-opacity': 1,
  'raster-contrast': 0.05,
  'raster-brightness-min': 0,
  'raster-brightness-max': 1,
  'raster-saturation': -0.05,
  'raster-hue-rotate': 0,
} as const;

/** Arka plan token'ları — TEK KAYNAK `map/_mapIds.ts` (DÖNGÜSÜZ sabitler evi).
 *  Burada yalnız yeniden dışa aktarılır ki stil kurucuları tek yerden okusun.
 *
 *  ⚠️ Kaynak `_mapState` DEĞİL, `_mapIds`tir (kütük #605): `_mapState` bu
 *  dosyadan `RASTER_PAINT_*` aldığı için oradan okumak döngü kurar ve
 *  `NIGHT_PALETTE` modül üst seviyesinde kurulduğundan TDZ ile ÇÖKER. */
export { MAP_BG_NIGHT, MAP_BG_DAY } from './map/_mapIds';
import { MAP_BG_NIGHT, MAP_BG_DAY } from './map/_mapIds';

/** Yürürlükteki kontrast profili — LAB gözlemi için. */
export function getMapContrastProfile(night: boolean): MapContrastProfile {
  return night ? 'NIGHT_READABLE' : 'DAY_NATURAL';
}

export function buildRoadStyle(
  activeSourceId: string | null,
  sources: Map<string, MapSource>,
  getTileUrls: () => string[],
  night = true,
): StyleSpecification {
  const tiles = getTileUrls();
  const hasLocal = sources.get('local')?.isAvailable === true;
  const usingSmart = hasLocal || activeSourceId === 'local';

  return {
    version: 8,
    name: usingSmart ? 'Smart Offline/Online Map' : 'OSM Map',
    sources: {
      'map-tiles': {
        type: 'raster',
        tiles,
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        minzoom: 0,
        maxzoom: 19,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': night ? MAP_BG_NIGHT : MAP_BG_DAY }  // token seti — tek kaynak
      },
      {
        id: 'tiles-layer',
        type: 'raster',
        source: 'map-tiles',
        paint: { ...(night ? RASTER_PAINT_NIGHT : RASTER_PAINT_DAY) },
      },
    ],
  };
}

export function buildSatelliteStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'Uydu',
    sources: {
      'satellite-tiles': {
        type: 'raster',
        // SAHA FİX 2026-06-12: ham https → caros-tile:// protokolü. Capacitor Android
        // WebView MapLibre'nin iç XHR'ını (CORS/mixed-content) blokluyordu → uydu boş
        // geliyordu. Yol karoları gibi caros-tile JS fetch()'ten geçer + LRU cache.
        tiles: ['caros-tile://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri',
        // maxzoom 17: ESRI World_Imagery bazı bölgelerde z18-19'da görüntüye sahip değil →
        // "Map data not yet available" placeholder karosu döner. Düşük maxzoom ile MapLibre
        // mevcut karoyu OVER-ZOOM eder (hafif bulanık ama gerçek görüntü, placeholder yok).
        maxzoom: 17,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0d1628' } },
      { id: 'satellite-layer', type: 'raster', source: 'satellite-tiles', paint: { 'raster-opacity': 1 } },
    ],
  };
}

export function buildHybridStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'Hibrit',
    sources: {
      'satellite-tiles': {
        type: 'raster',
        // SAHA FİX 2026-06-12: ham https → caros-tile:// protokolü. Capacitor Android
        // WebView MapLibre'nin iç XHR'ını (CORS/mixed-content) blokluyordu → uydu boş
        // geliyordu. Yol karoları gibi caros-tile JS fetch()'ten geçer + LRU cache.
        tiles: ['caros-tile://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri',
        // bkz. buildSatelliteStyle — ESRI placeholder karosunu önlemek için over-zoom
        maxzoom: 17,
      },
      'road-overlay': {
        type: 'raster',
        // caros-tile:// — WebView XHR bloklamasını aşar (yukarıdaki uydu notu).
        tiles: ['caros-tile://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        maxzoom: 19,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0d1628' } },
      { id: 'satellite-layer', type: 'raster', source: 'satellite-tiles', paint: { 'raster-opacity': 1 } },
      {
        id: 'road-overlay-layer',
        type: 'raster',
        source: 'road-overlay',
        paint: {
          // Opacity 0.38 — uydu görüntüsünü açık tutar, yol etiketleri hâlâ okunur
          'raster-opacity': 0.38,
          // Tam renk silme: OSM'nin yeşil parkları / mavi suyu kalkar,
          // sadece siyah/gri yol çizgileri ve beyaz yazılar kalır
          'raster-saturation': -1,
          // Kontrast maksimum: açık zemin → tam beyaz, yollar → tam siyah
          // Sürüş güvenliği: gece modunda bile şerit/kavşak ayrımı net
          'raster-contrast': 0.75,
          // Beyaz OSM zemini → orta gri (0.55) → uydu renkleriyle harmoniyi artırır
          'raster-brightness-max': 0.55,
          'raster-brightness-min': 0,
        },
      },
    ],
  };
}
