/**
 * destinationIntegrityModel — HEDEFİN BÜTÜNLÜĞÜ (SAF KATMAN · P0-NAV-09).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK (zaman DIŞARIDAN) · React YOK ·
 * global durum YOK · ağ YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (ölçüm 2026-08-24, koddan) ──────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Ürünün koordinat kapısı `addressBookService.isValidDestination` ZATEN VARDI
 * ve doğruydu (sonlu · aralık · Null Island). Ama **YALNIZ Ev/İş hızlı-hedef
 * yolunda** çağrılıyordu. Tüm hedeflerin geçtiği TEK kapı olan
 * `navigationService.startNavigation` onu **HİÇ ÇAĞIRMIYORDU**:
 *
 *   startNavigation → judgeDestinationChange (SAHİPLİK) → setDestination
 *                   → setRerouteContext → _sealNavState
 *
 * Yani sahiplik sorgulanıyor ("bu hedefi kim koydu?") ama **geçerlilik
 * sorulmuyordu** ("bu koordinat gerçek bir yer mi?"). `NaN`, `0,0`, aralık
 * dışı ya da takas edilmiş bir koordinat sessizce hedef olur, `_sealNavState`
 * ile diske MÜHÜRLENİR ve rota motoruna sorulurdu.
 *
 * Bu, deponun tekrar eden kusuru: **"motor var, besleyen yok"** — kapı doğru
 * yazılmış ama asıl otorite ondan geçmiyor.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · FAIL-CLOSED: geçersiz hedefle rota BAŞLATILMAZ. "Belki doğrudur" YOK.
 *  · SESSİZ DÜZELTME YASAK: takas ŞÜPHESİ yalnız KANIT olarak taşınır,
 *    koordinat ASLA kendiliğinden çevrilmez (bkz. `SwapSuspicion`).
 *  · Ölçülemeyen alan `null` — sahte `resolvedAt`, sahte `precision` YASAK.
 *  · Bu modül KARAR VERMEZ, HÜKÜM ÜRETİR; uygulamak çağıranın işidir.
 */

/* ══════════════════════════════════════════════════════════════════════════
   1) KANONİK HEDEF SÖZLEŞMESİ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Koordinatın NE KADAR kesin olduğu — sağlayıcıdan gelen kanıt.
 *
 * `UNKNOWN` bir eksiklik değil dürüst cevaptır: Nominatim serbest metin
 * araması kesinlik SÖYLEMEZ, uydurmak yanlış güven üretir.
 */
export type DestinationPrecision =
  /** Kapı numarası düzeyinde (bina/çatı). */
  | 'ROOFTOP'
  /** Sokak/cadde düzeyinde — bina bilinmiyor. */
  | 'STREET'
  /** Mahalle · ilçe · il gibi ALAN merkezi — nokta DEĞİL. */
  | 'AREA'
  /** Sağlayıcı kesinlik bildirmedi. */
  | 'UNKNOWN';

export const DESTINATION_PRECISION_LABEL: Readonly<Record<DestinationPrecision, string>> = {
  ROOFTOP: 'bina / kapı düzeyi',
  STREET:  'sokak düzeyi',
  AREA:    'alan merkezi (nokta değil)',
  UNKNOWN: 'sağlayıcı kesinlik bildirmedi',
} as const;

/**
 * Rota motoruna gidecek hedefin KANONİK künyesi.
 *
 * ⚠️ `Address` tipinin YERİNE GEÇMEZ — o ürünün taşıyıcı tipidir ve
 * değiştirilmesi çok geniş bir kırılma olurdu. Bu tip, hedefin **kanıtını**
 * taşır: aynı kimlik ve koordinat zinciri arama sonucundan rota isteğine
 * kadar izlenebilsin diye.
 */
export interface DestinationIdentity {
  /** Kanonik yer kimliği (arama sonucunun kimliği). */
  readonly placeId: string;
  /** Kullanıcıya gösterilen ad. */
  readonly displayName: string;
  readonly latitude: number;
  readonly longitude: number;
  /** Ayrı adres satırı; yoksa `null`. */
  readonly address: string | null;
  /**
   * Hedefi ÜRETEN sağlayıcı/katman etiketi (`geo/searchChainModel`in
   * `SearchProviderId`i ya da `'HANDOFF'`/`'MAP_LONGPRESS'` gibi yüzey adı).
   * Bildirilmediyse `null` — UYDURULMAZ.
   */
  readonly provider: string | null;
  /** Hedefin ÇÖZÜLDÜĞÜ an (ms). Bildirilmediyse `null`. */
  readonly resolvedAtMs: number | null;
  readonly precision: DestinationPrecision;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) RED SEBEPLERİ
   ══════════════════════════════════════════════════════════════════════════ */

export type DestinationRejection =
  /** Koordinat sayı değil ya da sonsuz/NaN. */
  | 'NOT_FINITE'
  /** Enlem/boylam fiziksel aralığın dışında — kesin bozulma. */
  | 'OUT_OF_RANGE'
  /** (0,0) Atlantik'te bir noktadır; üründe her zaman "konum yok" imzasıdır. */
  | 'NULL_ISLAND'
  /** Kimlik yok — zincir izlenemez, tekrar isteği eşleştirilemez. */
  | 'MISSING_ID'
  /** Görünen ad yok — sürücüye "nereye gidiyoruz" denemez. */
  | 'MISSING_NAME'
  /** Çözüm çok eski: kullanıcı o sonucu görmüş olamaz (bayat arama sonucu). */
  | 'STALE_RESOLUTION';

export const DESTINATION_REJECTION_LABEL: Readonly<Record<DestinationRejection, string>> = {
  NOT_FINITE:       'koordinat sayı değil (NaN / sonsuz)',
  OUT_OF_RANGE:     'koordinat fiziksel aralığın dışında',
  NULL_ISLAND:      'koordinat 0,0 — "konum yok" imzası',
  MISSING_ID:       'kanonik kimlik yok — zincir izlenemez',
  MISSING_NAME:     'görünen ad yok',
  STALE_RESOLUTION: 'arama sonucu çok eski — kullanıcı bunu görmüş olamaz',
} as const;

/**
 * Bir arama sonucunun hedef olarak kabul edilebileceği en uzun süre (ms).
 *
 * NEDEN 15 DAKİKA: kullanıcı bir sonucu görüp seçmesi saniyeler sürer; ama
 * uygulama arka plandayken tutulan bir liste saatler sonra "seçilmiş" gibi
 * uygulanabilir (oturum geri yükleme yolu bunu yapabilir). 15 dk, gerçek
 * kullanım için fazlasıyla geniş, bayat kayıt için dar bir penceredir.
 * `resolvedAtMs` BİLDİRİLMEDİYSE bu kural ÇALIŞMAZ — "bilinmiyor" ≠ "bayat".
 */
export const DESTINATION_STALE_MS = 15 * 60_000;

/* ══════════════════════════════════════════════════════════════════════════
   3) TAKAS ŞÜPHESİ — KANIT, DÜZELTME DEĞİL
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Enlem/boylamın yer değiştirmiş OLABİLECEĞİNE dair kanıt.
 *
 * ── NEDEN OTOMATİK DÜZELTME YOK ───────────────────────────────────────────
 * Türkiye'de enlem ~36–42, boylam ~26–45'tir: takas edilmiş bir koordinat
 * **hâlâ geçerli aralıktadır** ve aralık denetimiyle YAKALANAMAZ. Genel bir
 * takas dedektörü matematiksel olarak imkânsızdır — koordinatı kendiliğinden
 * çevirmek, sürücüyü kanıtsız bir yere sürmek demektir ki tam olarak
 * kaçındığımız hatadır.
 *
 * Bu yüzden yalnız **ölçülebilir bir asimetri** taşınır: hedef kullanıcıdan
 * ÇOK uzakken, takas edilmiş okuma ÇOK yakınsa bu bir işarettir. İşaret
 * ekranda ve LAB'da GÖRÜNÜR; karar kullanıcınındır.
 *
 * ── ⚠️ ÖLÇÜLEN SINIR (dürüstlük — kilit testi bunu yakaladı) ──────────────
 * Bu sinyalin Türkiye'de AYIRT ETME GÜCÜ ZAYIFTIR ve bu ölçülmüştür:
 *   Kullanıcı Tarsus (36.9175 / 34.8621) · koordinat takas edilirse
 *   (34.8621 / 36.9175) → aradaki mesafe yalnız **~290 km**.
 * Yani enlem ile boylam birbirine YAKIN olan illerde (Akdeniz kuşağı) takas,
 * hedefi ancak birkaç yüz km kaydırır ve `SWAP_FAR_KM` eşiğinin ALTINDA kalır.
 * Eşiği düşürmek bu sınıfı yakalardı ama **Hatay/Antakya gibi MEŞRU güney
 * hedeflerini** (Tarsus'tan ~290 km, kendi takasına ~0 km) yanlışlıkla
 * işaretlerdi — yani sinyal gürültüye dönerdi.
 *
 * KARAR: eşik MUHAFAZAKÂR tutulur. Sinyal yalnız enlem ile boylamın AÇIKÇA
 * ayrıştığı durumlarda (ör. İstanbul 41,0/29,0 → takas 29,0/41,0, ~1400 km)
 * konuşur. Yakalanamayan sınıf **açık borç olarak yazılır**, sahte bir
 * dedektörle KAPATILMIŞ GİBİ gösterilmez. Kesin olarak yakalanabilen tek
 * takas sınıfı zaten `OUT_OF_RANGE`tir (|enlem| > 90).
 */
export interface SwapSuspicion {
  readonly suspected: boolean;
  /** Verilen koordinatın kullanıcıya uzaklığı (km). Konum yoksa `null`. */
  readonly asGivenKm: number | null;
  /** Enlem/boylam takas edilirse oluşan uzaklık (km). Konum yoksa `null`. */
  readonly ifSwappedKm: number | null;
  readonly why: string;
}

/** Şüphe için hedefin en az bu kadar uzak olması gerekir (km). */
export const SWAP_FAR_KM = 500;
/** Takas edilmiş okuma en fazla bu kadar yakınsa şüphe doğar (km). */
export const SWAP_NEAR_KM = 50;

const _NULL_ISLAND_EPS = 1e-9;

function _haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Takas şüphesini ÖLÇER. Koordinatı DEĞİŞTİRMEZ, karar VERMEZ. Saf.
 *
 * Kullanıcı konumu yoksa şüphe İDDİA EDİLEMEZ (`suspected: false`,
 * mesafeler `null`) — kanıtsız işaret, sahte işarettir.
 */
export function describeSwapSuspicion(
  lat: number, lng: number,
  origin: { readonly lat: number; readonly lng: number } | null,
): SwapSuspicion {
  if (origin === null
      || !Number.isFinite(lat) || !Number.isFinite(lng)
      || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) {
    return {
      suspected: false, asGivenKm: null, ifSwappedKm: null,
      why: 'kullanıcı konumu yok — takas şüphesi ÖLÇÜLEMEZ',
    };
  }
  const asGiven = Math.round(_haversineKm(origin.lat, origin.lng, lat, lng) * 10) / 10;

  /* Takas edilmiş okuma FİZİKSEL olarak geçerli değilse şüphe de yoktur:
     boylamı enlem yerine koymak çoğu zaman |lat|>90 üretir ve bu durumda
     "takas edilmiş hâli daha yakın" cümlesi anlamsızdır. */
  if (lng < -90 || lng > 90) {
    return {
      suspected: false, asGivenKm: asGiven, ifSwappedKm: null,
      why: 'takas edilmiş okuma geçerli bir enlem üretmiyor — şüphe yok',
    };
  }
  const ifSwapped = Math.round(_haversineKm(origin.lat, origin.lng, lng, lat) * 10) / 10;

  const suspected = asGiven >= SWAP_FAR_KM && ifSwapped <= SWAP_NEAR_KM;
  return {
    suspected,
    asGivenKm: asGiven,
    ifSwappedKm: ifSwapped,
    why: suspected
      ? `verilen koordinat ${asGiven} km uzakta, takas edilmiş hâli ${ifSwapped} km — `
        + 'enlem/boylam yer değiştirmiş OLABİLİR (koordinat DEĞİŞTİRİLMEDİ)'
      : 'takas asimetrisi ölçüldü, eşiklerin altında — şüphe yok',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) HÜKÜM
   ══════════════════════════════════════════════════════════════════════════ */

export interface DestinationCandidate {
  readonly id: unknown;
  readonly name: unknown;
  readonly latitude: unknown;
  readonly longitude: unknown;
  readonly address?: unknown;
  readonly provider?: unknown;
  readonly resolvedAtMs?: unknown;
  readonly precision?: unknown;
}

export interface DestinationIntegrityContext {
  /** Şu anki zaman (ms) — bayatlık ölçümü için. Bilinmiyorsa `null`. */
  readonly nowMs: number | null;
  /** Kullanıcının konumu — takas şüphesi için. Yoksa `null`. */
  readonly origin: { readonly lat: number; readonly lng: number } | null;
}

export interface DestinationIntegrityVerdict {
  /** `false` ise rota BAŞLATILAMAZ (fail-closed). */
  readonly ok: boolean;
  /** İlk (en özgül) red sebebi; kabul edildiyse `null`. */
  readonly rejection: DestinationRejection | null;
  /** TÜM ihlaller — teşhis "hangisi önce yakalandı"dan fazlasını ister. */
  readonly allRejections: readonly DestinationRejection[];
  /** Kabul edildiyse kanonik künye; reddedildiyse `null`. */
  readonly identity: DestinationIdentity | null;
  readonly swap: SwapSuspicion;
  /** Hedefin çözülmesinden bu yana geçen süre (ms). Ölçülemezse `null`. */
  readonly ageMs: number | null;
  /** İnsan-okur tek cümle. Hedef ADI TAŞIMAZ (LAB gizlilik şartı). */
  readonly note: string;
}

function _str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function _precision(v: unknown): DestinationPrecision {
  return v === 'ROOFTOP' || v === 'STREET' || v === 'AREA' ? v : 'UNKNOWN';
}

/**
 * Hedef adayını denetler ve kanonik künyeye çevirir. **SAF · FAIL-CLOSED.**
 *
 * Sıra bilinçlidir: koordinat ihlalleri ÖNCE gelir çünkü onlar KESİN
 * bozulmadır; kimlik/ad eksikliği izlenebilirlik kusurudur; bayatlık en son
 * gelir çünkü ölçülemediğinde hiç iddia edilmez.
 */
export function judgeDestinationIntegrity(
  cand: DestinationCandidate,
  ctx: DestinationIntegrityContext,
): DestinationIntegrityVerdict {
  const lat = cand.latitude;
  const lng = cand.longitude;
  const rejections: DestinationRejection[] = [];

  const finite = typeof lat === 'number' && typeof lng === 'number'
              && Number.isFinite(lat) && Number.isFinite(lng);
  if (!finite) {
    rejections.push('NOT_FINITE');
  } else {
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) rejections.push('OUT_OF_RANGE');
    if (Math.abs(lat) < _NULL_ISLAND_EPS && Math.abs(lng) < _NULL_ISLAND_EPS) {
      rejections.push('NULL_ISLAND');
    }
  }

  const id   = _str(cand.id);
  const name = _str(cand.name);
  if (id.length === 0)   rejections.push('MISSING_ID');
  if (name.length === 0) rejections.push('MISSING_NAME');

  const resolvedAtMs = typeof cand.resolvedAtMs === 'number' && Number.isFinite(cand.resolvedAtMs)
    ? cand.resolvedAtMs : null;
  /* Bayatlık YALNIZ iki uç da ölçüldüğünde iddia edilir. Bildirilmemiş
     `resolvedAtMs` bir kusur DEĞİLDİR ("bilinmiyor" ≠ "bayat") — bu yüzden
     eksikliği red sebebi değil, ölçüm boşluğudur. */
  const ageMs = (resolvedAtMs !== null && ctx.nowMs !== null)
    ? Math.max(0, ctx.nowMs - resolvedAtMs) : null;
  if (ageMs !== null && ageMs > DESTINATION_STALE_MS) rejections.push('STALE_RESOLUTION');

  const swap = finite
    ? describeSwapSuspicion(lat as number, lng as number, ctx.origin)
    : { suspected: false, asGivenKm: null, ifSwappedKm: null,
        why: 'koordinat sayı değil — takas şüphesi ölçülemez' };

  if (rejections.length > 0) {
    return {
      ok: false,
      rejection: rejections[0],
      allRejections: rejections,
      identity: null,
      swap,
      ageMs,
      note: `HEDEF REDDEDİLDİ · ${DESTINATION_REJECTION_LABEL[rejections[0]]}`
          + (rejections.length > 1 ? ` (+${rejections.length - 1} ihlal daha)` : ''),
    };
  }

  const identity: DestinationIdentity = {
    placeId:      id,
    displayName:  name,
    latitude:     lat as number,
    longitude:    lng as number,
    address:      _str(cand.address).length > 0 ? _str(cand.address) : null,
    provider:     _str(cand.provider).length > 0 ? _str(cand.provider) : null,
    resolvedAtMs,
    precision:    _precision(cand.precision),
  };

  return {
    ok: true,
    rejection: null,
    allRejections: [],
    identity,
    swap,
    ageMs,
    note: swap.suspected
      ? 'HEDEF KABUL EDİLDİ · ⚠️ enlem/boylam takas ŞÜPHESİ var (koordinat değiştirilmedi)'
      : `HEDEF KABUL EDİLDİ · kesinlik: ${DESTINATION_PRECISION_LABEL[identity.precision]}`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   5) ZİNCİR İZİ — ARAMA SONUCU → HEDEF → ROTA İSTEĞİ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Aynı hedefin zincirin üç noktasında AYNI olup olmadığının kanıtı.
 *
 * ── NEDEN GEREKLİ ─────────────────────────────────────────────────────────
 * P0-NAV-09'un sorusu şuydu: *"Aramada doğru yeri bulduk ama rotaya yanlış
 * koordinat/kimlik gidiyor olabilir mi?"* Bu soru ancak üç noktadaki kimlik ve
 * koordinat KARŞILAŞTIRILABİLİRSE yanıtlanır.
 *
 * GİZLİLİK: koordinatın kendisi TAŞINMAZ — yalnız EŞLEŞİYOR MU ve kaç metre
 * saptığı taşınır (LAB gizlilik şartı #6).
 */
export interface DestinationChainLink {
  /** Zincir noktasının adı. */
  readonly stage: 'SEARCH_RESULT' | 'SELECTED_DESTINATION' | 'ROUTE_REQUEST';
  readonly placeId: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

export type ChainIntegrity = 'CONSISTENT' | 'ID_DRIFT' | 'COORD_DRIFT' | 'BOTH_DRIFT' | 'UNKNOWN';

export const CHAIN_INTEGRITY_LABEL: Readonly<Record<ChainIntegrity, string>> = {
  CONSISTENT:  'zincir tutarlı — aynı kimlik, aynı koordinat',
  ID_DRIFT:    'kimlik değişmiş — rotaya BAŞKA yerin kimliği gitti',
  COORD_DRIFT: 'koordinat kaymış — aynı kimlik, farklı nokta',
  BOTH_DRIFT:  'hem kimlik hem koordinat değişmiş',
  UNKNOWN:     'zincirin bir ucu ölçülmedi — hüküm iddia edilmiyor',
} as const;

/**
 * Koordinat kayması bu eşiğin altındaysa AYNI nokta sayılır (m).
 * Geocoder aynı yeri birkaç metre farkla döndürebilir; yuvarlama da öyle.
 * `destinationOwnershipModel.SAME_DESTINATION_RADIUS_M` ile aynı ilke, daha
 * DAR eşik: orası "aynı hedef mi", burası "aynı NOKTA mı" sorar.
 */
export const CHAIN_COORD_TOLERANCE_M = 25;

export interface ChainVerdict {
  readonly integrity: ChainIntegrity;
  /** İki uç arasındaki koordinat sapması (m). Ölçülemezse `null`. */
  readonly driftM: number | null;
  readonly why: string;
}

/**
 * Zincirin iki ucunu karşılaştırır. **SAF.** Ölçülemeyen uç → `UNKNOWN`.
 */
export function judgeChainIntegrity(
  from: DestinationChainLink, to: DestinationChainLink,
): ChainVerdict {
  const idsKnown = from.placeId !== null && to.placeId !== null;
  const coordsKnown =
    from.latitude !== null && from.longitude !== null &&
    to.latitude   !== null && to.longitude   !== null &&
    Number.isFinite(from.latitude) && Number.isFinite(from.longitude) &&
    Number.isFinite(to.latitude)   && Number.isFinite(to.longitude);

  if (!idsKnown && !coordsKnown) {
    return { integrity: 'UNKNOWN', driftM: null, why: 'zincirin uçları ölçülmedi' };
  }

  const driftM = coordsKnown
    ? Math.round(_haversineKm(
        from.latitude as number, from.longitude as number,
        to.latitude   as number, to.longitude   as number,
      ) * 1000)
    : null;

  const idDrift    = idsKnown && from.placeId !== to.placeId;
  const coordDrift = driftM !== null && driftM > CHAIN_COORD_TOLERANCE_M;

  if (idDrift && coordDrift) {
    return { integrity: 'BOTH_DRIFT', driftM,
      why: `kimlik değişti ve koordinat ${driftM} m kaydı` };
  }
  if (idDrift) {
    return { integrity: 'ID_DRIFT', driftM,
      why: 'kimlik değişti — koordinat aynı olsa bile zincir kopmuştur' };
  }
  if (coordDrift) {
    return { integrity: 'COORD_DRIFT', driftM,
      why: `aynı kimlik, koordinat ${driftM} m kaydı (tolerans ${CHAIN_COORD_TOLERANCE_M} m)` };
  }
  /* Yalnız BİR eksen ölçülebildiyse "tutarlı" demek fazla iddialıdır. */
  if (!idsKnown || !coordsKnown) {
    return { integrity: 'UNKNOWN', driftM,
      why: idsKnown ? 'koordinatlar ölçülmedi' : 'kimlikler ölçülmedi' };
  }
  return { integrity: 'CONSISTENT', driftM, why: 'aynı kimlik, aynı nokta' };
}
