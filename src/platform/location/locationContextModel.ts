/**
 * locationContextModel — Mavi'nin konum BAĞLAMI (saf).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · fetch YOK · React YOK · import YOK.
 * Tüm girdiler dışarıdan → testler deterministiktir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN KUSUR ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * "Mavi, neredeyiz?" → "Haritayı açıyorum, konumunu görebilirsin."
 *
 * KÖK: konum zinciri (`query.current_location` → `location.current.read` →
 * `readCurrentLocation` → reverse geocode) BAŞTAN SONA MEVCUT ve doğrudur,
 * ama üründe iki kapı kapalıdır: maviCore gölge modda çalışır ve konum aracını
 * taşıyan tool loop varsayılan KAPALIDIR. Üstelik Mavi'nin sistem promptunda
 * (`buildInterpretedVehicleContext`) yakıt/DTC/menzil/yolculuk vardır ama
 * KONUM HİÇ YOKTUR → model bilmediği için savuşturur. Bu bir halüsinasyon
 * değil, BAĞLAM AÇLIĞIDIR.
 *
 * ── BU MODELİN İŞİ ────────────────────────────────────────────────────────
 * Mevcut zincirin ÜRETTİĞİ kanıtı (fix sınıfı + DR durumu + adres parçaları)
 * yapılandırılmış bir bağlama ve TEK bir Türkçe cümleye çevirmek.
 *
 * ── BU MODELİN YAPMADIĞI (pazarlıksız) ────────────────────────────────────
 *  · Konum UYDURMAZ: kanıt yoksa `unavailable` döner.
 *  · HAM KOORDİNAT TAŞIMAZ: `lat`/`lon` bu modelin çıktısında YOKTUR —
 *    koordinat sistem içi veridir, doğal dil bağlamına sızmaz.
 *  · Bayat fix'i "kesin konum" diye SUNMAZ: DR varsa `estimated: true`,
 *    yoksa fail-closed `unavailable`.
 *  · GPS okumaz, geocode etmez, rota kurmaz — hiçbir servise dokunmaz.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

export type LocationAvailability = 'available' | 'unavailable';

/** Konumun HANGİ kanıta dayandığı. */
export type LocationSource = 'GPS' | 'DEAD_RECKONING' | 'UNKNOWN';

export type LocationConfidence = 'high' | 'medium' | 'low';

/** Fix sınıfı — `currentLocationCore.LocationFixClass` ile AYNI küme. */
export type FixClass = 'usable' | 'aging' | 'expired' | 'no_fix' | 'invalid';

/** Reverse geocode parçaları — çözülemeyen alan `null`. */
export interface LocationPlaceParts {
  readonly road: string | null;
  readonly district: string | null;
  readonly city: string | null;
}

/** Ölü hesaplamanın (PR-451a) SALT-OKUNAN durumu — bu model onu DEĞİŞTİRMEZ. */
export interface DrEvidence {
  /** Rota boyunca ilerleme fiilen sürüyor mu. */
  readonly active: boolean;
  /** [0..1] — 0'da ilerleme durmuştur. */
  readonly confidence: number;
}

export interface LocationContextInput {
  readonly fixClass: FixClass;
  /** Fix yaşı (ms); bilinmiyorsa `null`. */
  readonly ageMs: number | null;
  /** Fix doğruluğu (m); bilinmiyorsa `null`. */
  readonly accuracyM: number | null;
  readonly place: LocationPlaceParts | null;
  readonly dr: DrEvidence | null;
}

/** Mavi'ye verilen yapılandırılmış konum bağlamı — HAM KOORDİNAT YOK. */
export interface LocationContext {
  readonly availability: LocationAvailability;
  readonly city: string | null;
  readonly district: string | null;
  readonly road: string | null;
  readonly source: LocationSource;
  readonly confidence: LocationConfidence;
  /** `true` ise konum ÖLÇÜLMEDİ, TAHMİN edildi — cümle bunu söylemek ZORUNDA. */
  readonly estimated: boolean;
}

/** Doğruluk bu eşiğin üstündeyse güven yükseltilmez (şehir içi çok-yol yansıması). */
export const ACCURACY_GOOD_M = 50;

/** Kanıtsız bağlam — tek şablon (V8 hidden-class kararlılığı). */
export const UNAVAILABLE_LOCATION_CONTEXT: LocationContext = {
  availability: 'unavailable',
  city: null, district: null, road: null,
  source: 'UNKNOWN', confidence: 'low', estimated: false,
};

/* ══════════════════════════════════════════════════════════════════════════
 * Karar
 * ════════════════════════════════════════════════════════════════════════ */

function _str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function _readPlace(p: LocationPlaceParts | null | undefined): LocationPlaceParts {
  if (!p || typeof p !== 'object') return { road: null, district: null, city: null };
  return { road: _str(p.road), district: _str(p.district), city: _str(p.city) };
}

function _drActive(dr: DrEvidence | null | undefined): boolean {
  if (!dr || typeof dr !== 'object') return false;
  if (dr.active !== true) return false;
  /* Güven 0 ise ilerleme DURMUŞTUR → tahmin de dayanaksızdır. */
  return typeof dr.confidence === 'number' && Number.isFinite(dr.confidence) && dr.confidence > 0;
}

/**
 * Kanıttan yapılandırılmış bağlamı üret.
 *
 * KARAR TABLOSU (fail-closed):
 *   usable            → GPS · estimated:false · güven doğruluğa göre high/medium
 *   aging + DR var    → DEAD_RECKONING · estimated:true · medium
 *   aging + DR yok    → GPS · estimated:false · medium (yaş cümlede anılır)
 *   expired + DR var  → DEAD_RECKONING · estimated:true · medium
 *   expired + DR yok  → UNAVAILABLE  ← bayat koordinat "kesin konum" SUNULMAZ
 *   no_fix / invalid  → UNAVAILABLE  (DR'nin çapası da yoktur)
 */
export function buildLocationContext(input: LocationContextInput): LocationContext {
  if (!input || typeof input !== 'object') return UNAVAILABLE_LOCATION_CONTEXT;

  const place = _readPlace(input.place);
  const hasDr = _drActive(input.dr);

  /* Yer adı hiç çözülemediyse "nerede olduğumuzu" SÖYLEYEMEYİZ. Koordinatı
     doğal dile taşımak yasak olduğu için burada dürüst tek yol budur. */
  const hasPlace = place.city !== null || place.district !== null || place.road !== null;

  switch (input.fixClass) {
    case 'no_fix':
    case 'invalid':
      return UNAVAILABLE_LOCATION_CONTEXT;

    case 'expired':
      if (!hasDr || !hasPlace) return UNAVAILABLE_LOCATION_CONTEXT;
      return {
        availability: 'available',
        city: place.city, district: place.district, road: place.road,
        source: 'DEAD_RECKONING', confidence: 'medium', estimated: true,
      };

    case 'aging': {
      if (!hasPlace) return UNAVAILABLE_LOCATION_CONTEXT;
      return {
        availability: 'available',
        city: place.city, district: place.district, road: place.road,
        source: hasDr ? 'DEAD_RECKONING' : 'GPS',
        confidence: 'medium',
        estimated: hasDr,
      };
    }

    case 'usable': {
      if (!hasPlace) return UNAVAILABLE_LOCATION_CONTEXT;
      const acc = input.accuracyM;
      /* Doğruluk BİLİNMİYORSA yükseltilmez — ölçülmeyen kalite "iyi" sayılmaz. */
      const good = typeof acc === 'number' && Number.isFinite(acc) && acc > 0 && acc <= ACCURACY_GOOD_M;
      return {
        availability: 'available',
        city: place.city, district: place.district, road: place.road,
        source: 'GPS', confidence: good ? 'high' : 'medium', estimated: false,
      };
    }

    default:
      return UNAVAILABLE_LOCATION_CONTEXT;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Cümle
 * ════════════════════════════════════════════════════════════════════════ */

/** "Meram, Konya" / "Konya" — en belirgin iki parça, tekrarsız. */
function _placePhrase(c: LocationContext): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [c.district, c.city]) {
    if (p && !seen.has(p.toLocaleLowerCase('tr'))) { seen.add(p.toLocaleLowerCase('tr')); out.push(p); }
  }
  return out.join(', ');
}

/**
 * Bağlamı Mavi'nin sistem promptuna girecek TEK cümleye çevir.
 *
 * ⚠️ Çıktı HAM KOORDİNAT İÇERMEZ (yapısal: bu modelde koordinat alanı yoktur).
 * `null` = söylenecek dürüst bir şey yok → satır bağlama HİÇ eklenmez.
 */
export function formatLocationContextLine(c: LocationContext | null): string | null {
  if (!c || c.availability !== 'available') return null;

  const place = _placePhrase(c);
  const road = c.road;

  /* Ne yer ne yol varsa cümle kurulmaz — "bir yerdesiniz" bilgi değildir. */
  if (place.length === 0 && road === null) return null;

  const where = place.length > 0 && road !== null
    ? `${place} yakınında, ${road} üzerinde`
    : place.length > 0 ? place : `${road} üzerinde`;

  if (c.estimated) {
    /* Tahmin OLDUĞU açıkça söylenir — kesinmiş gibi sunmak yasak. */
    return `Konum (TAHMİNİ, GPS zayıf — ölü hesaplama): ${where}.`;
  }
  const hedge = c.confidence === 'high' ? '' : ' (yaklaşık)';
  return `Konum${hedge}: ${where}.`;
}
