/**
 * roadClassResolver.ts — OSM yol etiketi + okunan levha → POLİTİKA yol sınıfı (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · ağ YOK · React YOK.
 *
 * ── NEDEN AYRI BİR ÇÖZÜMLEYİCİ ──────────────────────────────────────────────
 * Araç sınıfı tavanı (`turkeySpeedPolicy`) YOL SINIFINA göre değişir; ama
 * elimizdeki tek gerçek yol verisi Overpass'ten gelen `highway` etiketi ve
 * varsa `maxspeed` levhasıdır. Bu iki sinyal tek başına yetmez:
 *
 *  · `highway=primary` yolun ŞEHİR İÇİ mi ŞEHİRLERARASI mı olduğunu SÖYLEMEZ
 *    (Türkiye'de ikisi de primary etiketlidir).
 *  · `highway=motorway` otoyolun KGM mi YİD mi işletmesinde olduğunu SÖYLEMEZ.
 *
 * ÇÖZÜM — levhayı ayırt edici olarak kullanmak: Türkiye'de OKUNAN levha
 * değerleri zaten M1 yasal değerleridir (50 · 90 · 110 · 120/130/140). Yani
 * levhanın kendisi yol sınıfının en güçlü kanıtıdır. Etiket ise levha yokken
 * ve levhayı doğrularken kullanılır.
 *
 * ⚠️ UYDURMA YOK: iki sinyal de sınıf üretemiyorsa `UNKNOWN` döner ve araç
 * tavanı UYGULANMAZ (görev §7: "yol sınıfı bilinmiyorsa kesin uygulanabilir
 * limit üretme").
 */

import type { PolicyRoadClass } from './turkeySpeedPolicy';

export interface RoadClassObservation {
  /** OSM `highway` etiketi (ör. `motorway`, `residential`). */
  readonly highway: string | null;
  /** Okunan levha (km/sa) — `maxspeed` etiketi. `null` = levha okunmadı. */
  readonly postedKmh: number | null;
  /** Levha gerçekten OKUNDU mu (`osm`), yoksa sınıftan mı çıkarıldı (`inferred`). */
  readonly postedSource: 'osm' | 'inferred' | null;
}

export interface RoadClassVerdict {
  readonly roadClass: PolicyRoadClass;
  /** [0..1] — sınıflandırmanın kanıt gücü. */
  readonly confidence: number;
  /** Otoyolsa işletmeci (KGM/YİD) biliniyor mu — tavan seçimini etkiler. */
  readonly motorwayOperatorKnown: boolean;
  readonly reason: string;
}

const _UNKNOWN: RoadClassVerdict = {
  roadClass: 'UNKNOWN', confidence: 0, motorwayOperatorKnown: false,
  reason: 'yol sınıfı için kanıt yok',
} as const;

/** Otoyol etiketleri. */
const _MOTORWAY: ReadonlySet<string> = new Set(['motorway', 'motorway_link']);
/** Kesin yerleşim yeri içi etiketleri (şehirlerarası karşılığı YOKTUR). */
const _URBAN_ONLY: ReadonlySet<string> = new Set([
  'residential', 'living_street', 'service', 'pedestrian', 'unclassified',
]);
/** Bölünmüş yol olma olasılığı yüksek etiketler. */
const _DIVIDED_LIKELY: ReadonlySet<string> = new Set(['trunk', 'trunk_link']);

/**
 * Levha değerinden yol sınıfı — Türkiye M1 yasal değerleri ters eşlemesi.
 * Yalnız GERÇEKTEN OKUNMUŞ levha (`postedSource === 'osm'`) için kullanılır;
 * kendi çıkarımımızdan sınıf türetmek döngüsel olurdu.
 */
function _classFromPosted(kmh: number): { roadClass: PolicyRoadClass; confidence: number } | null {
  if (kmh <= 0 || !Number.isFinite(kmh)) return null;
  if (kmh <= 50) return { roadClass: 'URBAN', confidence: 0.85 };
  if (kmh <= 60) return { roadClass: 'URBAN', confidence: 0.6 };            // yerel düşürme
  if (kmh <= 90) return { roadClass: 'INTERURBAN_TWO_WAY', confidence: 0.8 };
  if (kmh <= 110) return { roadClass: 'DIVIDED_HIGHWAY', confidence: 0.8 };
  return { roadClass: 'MOTORWAY_KGM', confidence: 0.75 };                    // 120/130/140
}

/**
 * Yol sınıfını çözer.
 *
 * ÖNCELİK: (1) otoyol etiketi — en kesin sinyal · (2) okunan levha ·
 * (3) kesin şehir içi etiketleri · (4) bölünmüş yol adayı · (5) UNKNOWN.
 */
export function resolveRoadClass(obs: RoadClassObservation): RoadClassVerdict {
  const hw = (obs.highway ?? '').trim().toLowerCase();
  const posted = obs.postedSource === 'osm' && typeof obs.postedKmh === 'number'
    ? obs.postedKmh : null;

  if (hw && _MOTORWAY.has(hw)) {
    /* İşletmeci (KGM/YİD) OSM'de YOKTUR → `motorwayOperatorKnown=false`.
       Tavan hesabı bunu bilerek iki otoyol satırının büyüğünü alır. */
    return {
      roadClass: 'MOTORWAY_KGM',
      confidence: 0.9,
      motorwayOperatorKnown: false,
      reason: `OSM highway=${hw} — otoyol; işletmeci (KGM/YİD) bilinmiyor`,
    };
  }

  if (posted !== null) {
    const c = _classFromPosted(posted);
    if (c) {
      // Etiket levhayla çelişmiyorsa güven yükselir.
      const agrees =
        (c.roadClass === 'URBAN' && _URBAN_ONLY.has(hw)) ||
        (c.roadClass === 'DIVIDED_HIGHWAY' && _DIVIDED_LIKELY.has(hw));
      return {
        roadClass: c.roadClass,
        confidence: Math.min(1, agrees ? c.confidence + 0.1 : c.confidence),
        motorwayOperatorKnown: false,
        reason: `okunan levha ${posted} km/sa${agrees ? ` + highway=${hw} doğruluyor` : ''}`,
      };
    }
  }

  if (hw && _URBAN_ONLY.has(hw)) {
    return {
      roadClass: 'URBAN', confidence: 0.7, motorwayOperatorKnown: false,
      reason: `OSM highway=${hw} — yalnız yerleşim içi karşılığı var`,
    };
  }

  if (hw && _DIVIDED_LIKELY.has(hw)) {
    return {
      roadClass: 'DIVIDED_HIGHWAY', confidence: 0.55, motorwayOperatorKnown: false,
      reason: `OSM highway=${hw} — bölünmüş yol adayı`,
    };
  }

  /* `primary` / `secondary` / `tertiary`: levha yokken şehir içi mi şehirlerarası
     mı olduğu AYIRT EDİLEMEZ → sınıf üretilmez (uydurma yasak). */
  return hw
    ? { ..._UNKNOWN, reason: `OSM highway=${hw} tek başına sınıf belirlemiyor (levha yok)` }
    : _UNKNOWN;
}
