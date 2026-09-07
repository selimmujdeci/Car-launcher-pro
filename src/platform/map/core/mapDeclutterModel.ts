/**
 * mapDeclutterModel — P0-NAV-03 · HARİTA GÜRÜLTÜ SÖZLEŞMESİ (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK ·
 * MapLibre importu YOK. Yalnız "hangi katman, hangi özellik, hangi değer"
 * üçlülerini üretir; uygulamayı `MapLayerManager` yapar.
 *
 * ── ÖLÇÜLEN KUSUR ─────────────────────────────────────────────────────────
 * 1. **Mini harita tam ekranın birebir kopyasıydı.** `MiniMapWidget` hiçbir
 *    katman denetimi YAPMIYORDU (ölçüldü: dosyada tek bir `setPaintProperty` /
 *    `setLayoutProperty` çağrısı yok) — 220×160 px'lik bir kutuda bina, POI,
 *    şehir etiketi ve yol kalkanı tam ekrandaki yoğunlukla çiziliyordu.
 * 2. **Gürültü için sözleşme yoktu.** `NAV_SUPPRESS_TIERS` yalnız YOL
 *    katmanlarını ve yalnız manevra yaklaşımında yönetir; bina/POI/şehir
 *    etiketi/kalkan hiçbir koşulda geri çekilmiyordu.
 *
 * ── TEK OTORİTE KURALI (bu modülün en önemli sınırı) ──────────────────────
 * Yol gövdeleri/kasaları ve `road-label`/`place-town` **`NAV_SUPPRESS_TIERS`e
 * aittir**. Bu modül onları YENİDEN TANIMLAMAZ; tam ekranda o tabloyu OLDUĞU
 * GİBİ geçirir. İki tablo aynı katmana yazarsa hangisinin kazandığı çağrı
 * sırasına kalır — bu, depoda kayıtlı "iki otorite" kusur sınıfının ta kendisi.
 *
 * Mini haritada aynı tablo bir **zayıflatma çarpanıyla** geçirilir: değerler
 * hâlâ tek tablodan gelir, yalnız ölçeklenir. Yeni yol tablosu YAZILMAZ.
 *
 * ── SÖZLEŞME ÖZETİ ────────────────────────────────────────────────────────
 *  FULL  : bugünkü davranış — yol katmanları NAV_SUPPRESS_TIERS'ten AYNEN;
 *          gürültü katmanları gece/gündüze göre ölçülü geri çekilir.
 *  MINI  : agresif sadeleştirme — bina/POI/şehir etiketi/kalkan KAPALI,
 *          yol etiketi asgariye iner, yol ağı görünür KALIR.
 *  Navigasyon aktifken her iki yüzeyde de gürültü bir kademe daha geri çekilir.
 *
 * ── NEDEN "KAPALI" DEĞİL DE "GERİ ÇEKİLMİŞ" ───────────────────────────────
 * Tam ekranda hiçbir gürültü katmanı 0'a indirilmez: bina siluetleri ve
 * benzin/hastane POI'leri sürücü için BAĞLAMDIR. Mini haritada ise ekran
 * bütçesi yoktur ve bağlamı tam ekran verir — orada 0 meşrudur.
 */

/** Bir katman özelliğine yazılacak değer. */
export type DeclutterEntry = readonly [layerId: string, prop: DeclutterProp, value: number];

/** Yalnız opaklık özellikleri — geometri/renk DEĞİŞTİRİLMEZ. */
export type DeclutterProp =
  | 'line-opacity' | 'text-opacity' | 'fill-opacity'
  | 'icon-opacity' | 'fill-extrusion-opacity' | 'circle-opacity';

/** Hangi yüzey çiziyor. */
export type MapSurface = 'FULL' | 'MINI';

export const MAP_SURFACE_LABEL: Readonly<Record<MapSurface, string>> = {
  FULL: 'Tam ekran',
  MINI: 'Mini harita',
};

/** Sözleşme sürümü — herhangi bir satır değişince yükselir, LAB'da görünür. */
export const DECLUTTER_POLICY_VERSION = 'DCL-2026.09.05-CARTO' as const;

export interface DeclutterInput {
  readonly surface: MapSurface;
  readonly night: boolean;
  /** Rehberlik sürüyor mu (`ACTIVE`/`REROUTING`). */
  readonly navActive: boolean;
  /**
   * Kavşak bastırma kademesi (`NAV_SUPPRESS_TIERS` indeksi). Bu modül tabloyu
   * SEÇMEZ, yalnız hangi kademenin geçirileceğini bilir.
   */
  readonly tier: number;
}

/* ── Gürültü katmanları (yol DIŞI — tek sahibi bu modül) ──────────────────── */

interface NoiseLayer {
  readonly id: string;
  readonly prop: DeclutterProp;
  /** Tam ekran, seyir dışı taban değeri. */
  readonly full: number;
  /** Tam ekran, rehberlik sürerken. */
  readonly fullNav: number;
  /** Mini harita (rehberlikten bağımsız taban). */
  readonly mini: number;
  /** Mini harita, rehberlik sürerken — sürüş bağlamı dışındaki her şey susar. */
  readonly miniNav: number;
}

/**
 * Gündüz taban tablosu.
 *
 * Gündüz zemin açıktır ve bina dolgusu BEYAZDIR (`DAY_PALETTE` sözleşmesi):
 * bina kütlesi zaten düşük kontrastlıdır, bu yüzden gündüz daha az
 * bastırılabilir. POI ve şehir etiketi ise açık zeminde en çok göze çarpan
 * öğelerdir — asıl gürültü onlardır.
 *
 * ── 2026-09-05 · TİCARİ KARTOGRAFİ TURU ───────────────────────────────────
 * 1. **POI özelliği DÜZELTİLDİ: `icon-opacity` → `circle-opacity`.** POI
 *    katmanları `type: 'circle'`tır; `icon-opacity` bir daire katmanında
 *    tanımsızdır. Yani POI geri çekilmesi bugüne kadar HİÇ UYGULANMAMIŞTI —
 *    `MapLayerManager` çağrıyı `try/catch` içinde yaptığı için sessizce
 *    düşüyordu. Kilitler değeri ölçüyordu, ekranda karşılığı yoktu.
 * 2. **Yeni kartografi katmanları tabloya eklendi** (landcover ailesi,
 *    `landuse-urban`/`landuse-green`, `railway`, `aeroway`, `boundary`,
 *    `water-label`, `place-village`, `place-suburb`, `road-label-major`,
 *    `road-path`, `waterway-stream`). Eklenmeselerdi mini haritada ve
 *    rehberlikte YENİ katmanlar tam güçte kalır, sözleşme yarım olurdu.
 * 3. **Etiket hiyerarşisi mini haritada da korunur:** ana yol adı
 *    (`road-label-major`) mini'de 0,55 · yerel sokak adı (`road-label`,
 *    yol tablosundan gelir) `MINI_ROAD_LABEL_FACTOR` ile 0,35'e iner —
 *    yani mini haritada da ana arter adı yerel sokaktan ÖNDE.
 */
const NOISE_DAY: readonly NoiseLayer[] = [
  { id: 'building',            prop: 'fill-opacity',           full: 1.00, fullNav: 0.85, mini: 0,    miniNav: 0 },
  { id: 'building-3d',         prop: 'fill-extrusion-opacity', full: 1.00, fullNav: 0.70, mini: 0,    miniNav: 0 },
  { id: 'landuse-park',        prop: 'fill-opacity',           full: 1.00, fullNav: 1.00, mini: 0.55, miniNav: 0.40 },
  { id: 'landcover-wood',      prop: 'fill-opacity',           full: 0.90, fullNav: 0.90, mini: 0.55, miniNav: 0.40 },
  { id: 'landcover-grass',     prop: 'fill-opacity',           full: 0.80, fullNav: 0.80, mini: 0.45, miniNav: 0.32 },
  { id: 'landcover-farmland',  prop: 'fill-opacity',           full: 0.75, fullNav: 0.70, mini: 0.35, miniNav: 0.25 },
  { id: 'landuse-residential', prop: 'fill-opacity',           full: 1.00, fullNav: 1.00, mini: 0.60, miniNav: 0.45 },
  { id: 'landuse-urban',       prop: 'fill-opacity',           full: 1.00, fullNav: 0.90, mini: 0.55, miniNav: 0.40 },
  { id: 'landuse-green',       prop: 'fill-opacity',           full: 0.70, fullNav: 0.70, mini: 0.35, miniNav: 0.25 },
  /* POI: benzin/hastane sürüşte BAĞLAMDIR → tam ekranda susturulmaz, yalnız
     geri çekilir. Otopark/polis seyir kararına girmez → daha çok geri çekilir. */
  { id: 'poi-gas',             prop: 'circle-opacity',         full: 0.90, fullNav: 0.75, mini: 0,    miniNav: 0 },
  { id: 'poi-hospital',        prop: 'circle-opacity',         full: 0.90, fullNav: 0.75, mini: 0,    miniNav: 0 },
  { id: 'poi-parking',         prop: 'circle-opacity',         full: 0.75, fullNav: 0.50, mini: 0,    miniNav: 0 },
  { id: 'poi-police',          prop: 'circle-opacity',         full: 0.75, fullNav: 0.50, mini: 0,    miniNav: 0 },
  { id: 'place-city',          prop: 'text-opacity',           full: 1.00, fullNav: 0.75, mini: 0,    miniNav: 0 },
  { id: 'place-village',       prop: 'text-opacity',           full: 1.00, fullNav: 0.70, mini: 0,    miniNav: 0 },
  { id: 'place-suburb',        prop: 'text-opacity',           full: 0.80, fullNav: 0.55, mini: 0,    miniNav: 0 },
  { id: 'water-label',         prop: 'text-opacity',           full: 1.00, fullNav: 0.70, mini: 0,    miniNav: 0 },
  { id: 'road-label-major',    prop: 'text-opacity',           full: 1.00, fullNav: 1.00, mini: 0.55, miniNav: 0.45 },
  /* KAPI NUMARASI (z17+): varış/park kararının bilgisidir, seyir bilgisi değil.
     Tam ekranda tam güçte; rehberlik sırasında geri çekilir ama SÖNDÜRÜLMEZ —
     varışın son metrelerinde tam olarak buna bakılır. Mini haritada (220 px)
     okunamaz → 0. */
  { id: 'housenumber',         prop: 'text-opacity',           full: 1.00, fullNav: 0.75, mini: 0,    miniNav: 0 },
  { id: 'road-shield',         prop: 'icon-opacity',           full: 1.00, fullNav: 1.00, mini: 0,    miniNav: 0 },
  { id: 'road-path',           prop: 'line-opacity',           full: 0.70, fullNav: 0.45, mini: 0,    miniNav: 0 },
  { id: 'railway',             prop: 'line-opacity',           full: 0.80, fullNav: 0.65, mini: 0.35, miniNav: 0.25 },
  { id: 'aeroway',             prop: 'line-opacity',           full: 1.00, fullNav: 0.80, mini: 0,    miniNav: 0 },
  { id: 'boundary',            prop: 'line-opacity',           full: 0.55, fullNav: 0.35, mini: 0,    miniNav: 0 },
  { id: 'waterway',            prop: 'line-opacity',           full: 1.00, fullNav: 1.00, mini: 0.50, miniNav: 0.40 },
  { id: 'waterway-stream',     prop: 'line-opacity',           full: 0.75, fullNav: 0.60, mini: 0,    miniNav: 0 },
];

/**
 * Gece taban tablosu.
 *
 * Gece kartografisi gündüzün koyulaştırılmışı DEĞİLDİR (`NIGHT_PALETTE` ayrı
 * bir palettir) ve gürültü sözleşmesi de ayrıdır: karanlık kabinde parlayan her
 * öğe göz yorar. Bina kütlesi gece gündüzden DAHA ÇOK geri çekilir; POI
 * ikonları gece daha az sayıda ama daha parlak algılanır → onlar da iner.
 * Su yolu gece zaten düşük kontrastlıdır, ek bastırma gerekmez.
 */
const NOISE_NIGHT: readonly NoiseLayer[] = [
  { id: 'building',            prop: 'fill-opacity',           full: 0.78, fullNav: 0.50, mini: 0,    miniNav: 0 },
  { id: 'building-3d',         prop: 'fill-extrusion-opacity', full: 0.72, fullNav: 0.40, mini: 0,    miniNav: 0 },
  { id: 'landuse-park',        prop: 'fill-opacity',           full: 0.85, fullNav: 0.75, mini: 0.50, miniNav: 0.35 },
  { id: 'landcover-wood',      prop: 'fill-opacity',           full: 0.85, fullNav: 0.75, mini: 0.45, miniNav: 0.32 },
  { id: 'landcover-grass',     prop: 'fill-opacity',           full: 0.70, fullNav: 0.60, mini: 0.38, miniNav: 0.26 },
  { id: 'landcover-farmland',  prop: 'fill-opacity',           full: 0.65, fullNav: 0.55, mini: 0.30, miniNav: 0.20 },
  { id: 'landuse-residential', prop: 'fill-opacity',           full: 1.00, fullNav: 0.90, mini: 0.55, miniNav: 0.40 },
  { id: 'landuse-urban',       prop: 'fill-opacity',           full: 0.95, fullNav: 0.80, mini: 0.50, miniNav: 0.36 },
  { id: 'landuse-green',       prop: 'fill-opacity',           full: 0.45, fullNav: 0.40, mini: 0.25, miniNav: 0.18 },
  { id: 'poi-gas',             prop: 'circle-opacity',         full: 0.85, fullNav: 0.65, mini: 0,    miniNav: 0 },
  { id: 'poi-hospital',        prop: 'circle-opacity',         full: 0.85, fullNav: 0.65, mini: 0,    miniNav: 0 },
  { id: 'poi-parking',         prop: 'circle-opacity',         full: 0.60, fullNav: 0.40, mini: 0,    miniNav: 0 },
  { id: 'poi-police',          prop: 'circle-opacity',         full: 0.60, fullNav: 0.40, mini: 0,    miniNav: 0 },
  { id: 'place-city',          prop: 'text-opacity',           full: 1.00, fullNav: 0.70, mini: 0,    miniNav: 0 },
  { id: 'place-village',       prop: 'text-opacity',           full: 0.95, fullNav: 0.65, mini: 0,    miniNav: 0 },
  { id: 'place-suburb',        prop: 'text-opacity',           full: 0.75, fullNav: 0.50, mini: 0,    miniNav: 0 },
  { id: 'water-label',         prop: 'text-opacity',           full: 0.90, fullNav: 0.60, mini: 0,    miniNav: 0 },
  { id: 'road-label-major',    prop: 'text-opacity',           full: 1.00, fullNav: 1.00, mini: 0.55, miniNav: 0.45 },
  /* Gece: parlayan küçük yazı göz yorar → gündüzden DAHA ÇOK geri çekilir. */
  { id: 'housenumber',         prop: 'text-opacity',           full: 0.85, fullNav: 0.60, mini: 0,    miniNav: 0 },
  { id: 'road-shield',         prop: 'icon-opacity',           full: 1.00, fullNav: 1.00, mini: 0,    miniNav: 0 },
  { id: 'road-path',           prop: 'line-opacity',           full: 0.55, fullNav: 0.35, mini: 0,    miniNav: 0 },
  { id: 'railway',             prop: 'line-opacity',           full: 0.75, fullNav: 0.55, mini: 0.30, miniNav: 0.20 },
  { id: 'aeroway',             prop: 'line-opacity',           full: 0.90, fullNav: 0.70, mini: 0,    miniNav: 0 },
  { id: 'boundary',            prop: 'line-opacity',           full: 0.50, fullNav: 0.30, mini: 0,    miniNav: 0 },
  { id: 'waterway',            prop: 'line-opacity',           full: 1.00, fullNav: 1.00, mini: 0.45, miniNav: 0.35 },
  { id: 'waterway-stream',     prop: 'line-opacity',           full: 0.70, fullNav: 0.55, mini: 0,    miniNav: 0 },
];

/** Bu modülün SAHİP OLDUĞU katmanlar — yol tablosuyla kesişmediğinin kanıtı. */
export const DECLUTTER_OWNED_LAYERS: readonly string[] =
  NOISE_DAY.map((n) => n.id);

/**
 * Mini haritada yol katmanlarına uygulanan zayıflatma çarpanı.
 *
 * Yol tablosu YENİDEN YAZILMAZ; `NAV_SUPPRESS_TIERS`ten gelen değer bu çarpanla
 * ölçeklenir. Böylece yol hiyerarşisinin tek sahibi hâlâ o tablodur.
 *
 * Yol GÖVDELERİ mini haritada da güçlü kalmalıdır (sürüş bağlamının kendisi);
 * asıl inen ETİKETTİR — 220 px genişlikte okunamayan bir sokak adı yalnız
 * mürekkeptir.
 */
export const MINI_ROAD_BODY_FACTOR  = 0.92;
export const MINI_ROAD_LABEL_FACTOR = 0.35;

/** Yol tablosundaki bir girdinin ETİKET mi GÖVDE mi olduğu. */
function _isLabelProp(prop: string): boolean {
  return prop === 'text-opacity';
}

export interface DeclutterDecision {
  readonly policyVersion: string;
  readonly surface: MapSurface;
  readonly night: boolean;
  readonly navActive: boolean;
  readonly tier: number;
  /** Uygulanacak TÜM girdiler — yol (devredilmiş) + gürültü (bu modülün). */
  readonly entries: readonly DeclutterEntry[];
  /** Yalnız gürültü girdileri — kilitler ve LAB için ayrık. */
  readonly noiseEntries: readonly DeclutterEntry[];
  /** Yol girdileri — kaynağı `NAV_SUPPRESS_TIERS`, burada YENİDEN TANIMLANMAZ. */
  readonly roadEntries: readonly DeclutterEntry[];
  readonly reason: string;
}

/**
 * Gürültü sözleşmesini çöz.
 *
 * @param roadTable `NAV_SUPPRESS_TIERS[tier]` — çağıran geçirir. Bu modül o
 *   tabloyu İTHAL ETMEZ ki "tek sahiplik" derleme düzeyinde de görünsün:
 *   burada yol değeri ÜRETİLMEZ, yalnız (mini'de) ölçeklenir.
 */
export function resolveDeclutter(
  input: DeclutterInput,
  roadTable: ReadonlyArray<readonly [string, string, number]>,
): DeclutterDecision {
  const mini = input.surface === 'MINI';
  const table = input.night ? NOISE_NIGHT : NOISE_DAY;

  const noiseEntries: DeclutterEntry[] = table.map((n) => {
    const v = mini
      ? (input.navActive ? n.miniNav : n.mini)
      : (input.navActive ? n.fullNav : n.full);
    return [n.id, n.prop, v] as DeclutterEntry;
  });

  const roadEntries: DeclutterEntry[] = roadTable.map(([id, prop, val]) => {
    if (!mini) return [id, prop as DeclutterProp, val] as DeclutterEntry;
    const f = _isLabelProp(prop) ? MINI_ROAD_LABEL_FACTOR : MINI_ROAD_BODY_FACTOR;
    /* Ölçekleme; yuvarlama sabit basamağa yapılır ki aynı girdi aynı çıktıyı
       versin (kilitlenebilirlik) ve gereksiz `setPaintProperty` üretilmesin. */
    return [id, prop as DeclutterProp, Math.round(val * f * 1000) / 1000] as DeclutterEntry;
  });

  const reason = mini
    ? `mini · ${input.night ? 'gece' : 'gündüz'}${input.navActive ? ' · rehberlik' : ''} — bağlam tam ekranda`
    : `tam ekran · ${input.night ? 'gece' : 'gündüz'}${input.navActive ? ' · rehberlik' : ''}`;

  return {
    policyVersion: DECLUTTER_POLICY_VERSION,
    surface: input.surface,
    night: input.night,
    navActive: input.navActive,
    tier: input.tier,
    entries: [...roadEntries, ...noiseEntries],
    noiseEntries,
    roadEntries,
    reason,
  };
}
