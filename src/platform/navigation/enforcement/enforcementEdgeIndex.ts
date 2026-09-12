/**
 * enforcementEdgeIndex.ts — NAV v3 · DENETİM NOKTASI ↔ YOL AĞI BAĞI (SAF · F6).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F6.4 · CLAUDE.md §CROSS-DOMAIN 1/3/10.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · MODÜL DURUMU YOK ·
 * ağ YOK. Aynı girdi → aynı çıktı.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLMÜŞ GERÇEK: VERİ NE TAŞIYOR (2026-09-03, gerçek paket okundu) ─────
 * ══════════════════════════════════════════════════════════════════════════
 * `public/data/enforcement-points.tr.json` — şema 1 · 1503 nokta ·
 * `EGM_EDS_MAP` · tip dağılımı `UNKNOWN 1400 · AVERAGE_SPEED 81 ·
 * RED_LIGHT 14 · PARKING 8`.
 *
 * Bir kaydın TAŞIDIĞI: `lat` · `lng` · `type` · `role` · `directionHint`
 * (serbest METİN, 1503'ün 469'unda dolu) · `label` (serbest metin).
 * Bir kaydın TAŞIMADIĞI: **yol kimliği · kenar kimliği · yön AÇISI · hız
 * limiti · şerit · carriageway bilgisi.** Hiçbiri yoktur ve bu dosya
 * hiçbirini UYDURMAZ.
 *
 * Sonuç: bir denetim noktasının hangi KENARA ait olduğu veride YAZMAZ —
 * yalnız GEOMETRİK olarak çıkarılabilir ve bu çıkarım **her zaman kesin
 * değildir**. Bu dosyanın tüm işi o belirsizliği gizlemek değil, SINIFLANDIRMAK.
 *
 * ── DÖRT AYRI HÜKÜM (tek "eşleşmedi" kovası YOK) ─────────────────────────
 *   `MATCHED_TO_EDGE`   tek bir yol açıkça en yakın → bağlandı
 *   `AMBIGUOUS_EDGE`    iki AYRI yol ayırt edilemeyecek kadar yakın →
 *                       **bağlanmadı** (paralel carriageway koruması)
 *   `NO_EDGE_MATCH`     yakında yol VAR ama hiçbiri eşik içinde değil
 *   `OUTSIDE_COVERAGE`  ölçüldü, bu yarıçapta yol YOK (graf kapsamı dışı)
 *   `NOT_MEASURED`      L1 sorgusu hüküm vermedi — **"yok" DEĞİL**
 *
 * ── YÖN: KANITSIZ İDDİA YOK ──────────────────────────────────────────────
 * Kaynakta AÇI yoktur; `directionHint` serbest Türkçe metindir ve dereceye
 * ÇEVRİLMEZ (paket sözleşmesi). Bu yüzden yön uygulanabilirliği yalnız
 * TOPOLOJİDEN çıkarılır:
 *   · kenar TEK YÖNLÜ ise yön yapısal olarak bellidir → `ONEWAY_IMPLIED`
 *   · kenar ÇİFT YÖNLÜ ise hangi yöne baktığı **BİLİNMEZ** → `UNKNOWN_DIRECTION`
 * "Bilinmiyor" bir kusur değildir; kaybolursa yalan olur.
 *
 * ── YANLIŞ CARRIAGEWAY'E KAMERA BİNDİRMEK YASAK ──────────────────────────
 * Bölünmüş yolda iki carriageway AYRI kenarlardır ve bir noktaya ikisi de
 * yakındır. Bu durumda "en yakın olanı seç" demek, %50 ihtimalle karşı
 * yöndeki sürücüye uyarı vermektir. Marj kuralı (`AMBIGUITY_MARGIN_M`) tam
 * olarak bunu engeller: fark marjın altındaysa hüküm `AMBIGUOUS_EDGE`tir ve
 * nokta HİÇBİR kenara bağlanmaz.
 */

import type { EdgeId } from '../contracts/navEdgeId';
import { edgeIdEquals, isSameUndirectedEdge } from '../contracts/navEdgeId';
import type { EvidenceReason } from '../contracts/navEvidence';
import type { NearbyEdge } from '../map/store/mapStore';
import type { EnforcementPoint } from './enforcementPointsPackage';

/* ══════════════════════════════════════════════════════════════════════════
   1) POLİTİKA SAYILARI — ölçülmüş kalibrasyon DEĞİL
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ Aşağıdaki üç sayı **politikadır, sahamızdan ölçülmemiştir**
 * (`docs/DEVICE_VALIDATION_LEDGER.md` maddesi). Gerçek araçta ölçülmeden
 * "doğru eşik" DENEMEZ.
 */

/** Noktayı bir kenara bağlamak için izin verilen en büyük dik mesafe (m). */
export const ENFORCEMENT_EDGE_MAX_PERP_M = 25;

/**
 * İki AYRI yolu "ayırt edilebilir" saymak için gereken en küçük dik mesafe
 * farkı (m). Fark bundan küçükse hangi yola ait olduğu KANITLANAMAZ.
 */
export const ENFORCEMENT_EDGE_AMBIGUITY_MARGIN_M = 8;

/** Nokta çevresinde L1'e sorulacak yarıçap (m). */
export const ENFORCEMENT_EDGE_QUERY_RADIUS_M = 40;

/* ══════════════════════════════════════════════════════════════════════════
   2) SONUÇ
   ══════════════════════════════════════════════════════════════════════════ */

export type EnforcementEdgeMatchOutcome =
  | 'MATCHED_TO_EDGE'
  | 'AMBIGUOUS_EDGE'
  | 'NO_EDGE_MATCH'
  | 'OUTSIDE_COVERAGE'
  | 'NOT_MEASURED';

export const ENFORCEMENT_EDGE_MATCH_OUTCOMES: readonly EnforcementEdgeMatchOutcome[] = [
  'MATCHED_TO_EDGE', 'AMBIGUOUS_EDGE', 'NO_EDGE_MATCH', 'OUTSIDE_COVERAGE', 'NOT_MEASURED',
] as const;

export type EnforcementDirectionApplicability =
  /** Kenar tek yönlü → denetim yalnız o yönde geçerli olabilir (yapısal). */
  | 'ONEWAY_IMPLIED'
  /** Kenar çift yönlü ve kaynakta açı YOK → hangi yöne baktığı BİLİNMİYOR. */
  | 'UNKNOWN_DIRECTION';

/** Bağlanan kenarın tek yönü — mesafe yöne göre DEĞİŞİR, o yüzden ayrı taşınır. */
export interface EnforcementEdgeSide {
  readonly edgeId: EdgeId;
  /** Bu YÖNDEKİ kenarın başından noktaya yol-boyu mesafe (m). */
  readonly alongEdgeM: number;
}

export interface EnforcementEdgeMatch {
  /** Paket içi kararlı kimlik (`p-<n>`). Koordinat TAŞIMAZ. */
  readonly pointId: string;
  readonly outcome: EnforcementEdgeMatchOutcome;
  /** İleri kol (`dir 0`). `MATCHED_TO_EDGE` dışında `null`. */
  readonly forward: EnforcementEdgeSide | null;
  /** Geri kol (`dir 1`) — kenar TEK YÖNLÜYSE `null` (yapısal olarak yoktur). */
  readonly backward: EnforcementEdgeSide | null;
  /** Bağlanan kenara dik mesafe (m). Bağlanmadıysa `null` (sahte 0 YOK). */
  readonly perpDistM: number | null;
  readonly directionApplicability: EnforcementDirectionApplicability | null;
  /** Eşik İÇİNDE kaç FARKLI yol vardı (belirsizliğin gerçek ölçüsü). */
  readonly distinctRoadCount: number;
  /** L1'in döndürdüğü toplam aday sayısı (eşik öncesi). */
  readonly candidateCount: number;
  readonly reason: EvidenceReason;
}

function _noMatch(
  pointId: string,
  outcome: EnforcementEdgeMatchOutcome,
  reason: EvidenceReason,
  candidateCount: number,
  distinctRoadCount: number,
): EnforcementEdgeMatch {
  return {
    pointId,
    outcome,
    forward: null,
    backward: null,
    perpDistM: null,
    directionApplicability: null,
    distinctRoadCount,
    candidateCount,
    reason,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) EŞLEŞTİRİCİ (saf)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir denetim noktasını yol ağına bağlar. **SAF.**
 *
 * @param nearby L1 `queryEdgesNear` sonucunun DEĞERİ. `null` = L1 hüküm
 *        vermedi (ölçülmedi) · `[]` = ölçüldü, yarıçapta yol YOK.
 *
 * Sıra bilinçlidir ve fail-closed'dır:
 *   ölçülmedi → kapsam yok → eşik dışı → belirsiz → bağlandı.
 */
export function matchEnforcementPointToEdge(
  point: EnforcementPoint,
  nearby: readonly NearbyEdge[] | null,
  maxPerpM: number = ENFORCEMENT_EDGE_MAX_PERP_M,
  ambiguityMarginM: number = ENFORCEMENT_EDGE_AMBIGUITY_MARGIN_M,
): EnforcementEdgeMatch {
  const pointId = typeof point?.id === 'string' ? point.id : '';

  if (nearby === null || nearby === undefined) {
    return _noMatch(pointId, 'NOT_MEASURED', 'NO_SOURCE', 0, 0);
  }
  if (nearby.length === 0) {
    /* ÖLÇÜLDÜ ve bu yarıçapta yol YOK → kapsam hükmü (nokta ağ dışında). */
    return _noMatch(pointId, 'OUTSIDE_COVERAGE', 'COVERAGE_NONE', 0, 0);
  }

  const inRange = nearby.filter(
    (n) => n && Number.isFinite(n.perpDistM) && n.perpDistM >= 0 && n.perpDistM <= maxPerpM,
  );
  if (inRange.length === 0) {
    /* Yol var ama hiçbiri yeterince yakın değil — nokta muhtemelen bu ağın
       üstünde DEĞİL. "Bağlanmadı" bir ölçümdür; "yol yok" DEĞİLDİR. */
    return _noMatch(pointId, 'NO_EDGE_MATCH', 'BELOW_QUALITY_GATE', nearby.length, 0);
  }

  /* En yakın aday (deterministik: eşitlikte kimlik sırası). */
  let best = inRange[0];
  for (let i = 1; i < inRange.length; i++) {
    const c = inRange[i];
    if (c.perpDistM < best.perpDistM
      || (c.perpDistM === best.perpDistM
        && (c.edgeId.hi < best.edgeId.hi
          || (c.edgeId.hi === best.edgeId.hi && c.edgeId.lo < best.edgeId.lo)))) {
      best = c;
    }
  }

  /* AYRI yolları say: aynı kenarın iki yönü TEK yoldur (aksi hâlde her çift
     yönlü yol yapay olarak "belirsiz" görünürdü). */
  const roadHeads: NearbyEdge[] = [];
  for (const c of inRange) {
    let seen = false;
    for (const h of roadHeads) {
      if (edgeIdEquals(h.edgeId, c.edgeId) || isSameUndirectedEdge(h.edgeId, c.edgeId)) {
        seen = true;
        break;
      }
    }
    if (!seen) roadHeads.push(c);
  }

  /* En yakın FARKLI yol — carriageway ayrımının tek dayanağı. */
  let rivalPerp: number | null = null;
  for (const h of roadHeads) {
    if (edgeIdEquals(h.edgeId, best.edgeId) || isSameUndirectedEdge(h.edgeId, best.edgeId)) continue;
    if (rivalPerp === null || h.perpDistM < rivalPerp) rivalPerp = h.perpDistM;
  }

  if (rivalPerp !== null && (rivalPerp - best.perpDistM) < ambiguityMarginM) {
    /* İki ayrı yol ayırt edilemiyor → nokta HİÇBİRİNE bağlanmaz.
       Yanlış carriageway'e kamera bindirmektense susmak güvenlidir. */
    return _noMatch(pointId, 'AMBIGUOUS_EDGE', 'BELOW_QUALITY_GATE',
      nearby.length, roadHeads.length);
  }

  /* Bağlanan yolun İKİ kolunu da topla (mesafe yöne göre farklıdır). */
  let forward: EnforcementEdgeSide | null = null;
  let backward: EnforcementEdgeSide | null = null;
  for (const c of inRange) {
    if (!edgeIdEquals(c.edgeId, best.edgeId) && !isSameUndirectedEdge(c.edgeId, best.edgeId)) continue;
    const side: EnforcementEdgeSide = { edgeId: c.edgeId, alongEdgeM: c.alongEdgeM };
    /* `dir` bit 0'dır; kanonik kimlik API'siyle ayırt edilir. */
    if (c.edgeId.lo % 2 === 0) {
      if (forward === null) forward = side;
    } else if (backward === null) {
      backward = side;
    }
  }

  if (forward === null && backward === null) {
    return _noMatch(pointId, 'NO_EDGE_MATCH', 'BELOW_QUALITY_GATE',
      nearby.length, roadHeads.length);
  }

  /* Yön uygulanabilirliği YALNIZ topolojiden: geri kol YOKSA kenar tek
     yönlüdür (L1 çift yönlü kenar için DAİMA iki kol üretir — F4 sözleşmesi). */
  const direction: EnforcementDirectionApplicability =
    backward === null ? 'ONEWAY_IMPLIED' : 'UNKNOWN_DIRECTION';

  return {
    pointId,
    outcome: 'MATCHED_TO_EDGE',
    forward,
    backward,
    perpDistM: best.perpDistM,
    directionApplicability: direction,
    distinctRoadCount: roadHeads.length,
    candidateCount: nearby.length,
    reason: 'DETERMINISTIC_DERIVATION',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) SAYAÇLAR (saf indirgeyici — LAB'ın okuduğu dağılım)
   ══════════════════════════════════════════════════════════════════════════ */

export interface EnforcementMatchCounters {
  readonly matchedToEdge: number;
  readonly ambiguousEdge: number;
  readonly noEdgeMatch: number;
  readonly outsideCoverage: number;
  readonly notMeasured: number;
  /** Bağlananların kaçında yön TOPOLOJİDEN kanıtlandı (tek yönlü kenar). */
  readonly onewayImplied: number;
  /** Bağlananların kaçında yön BİLİNMİYOR (çift yönlü kenar, açı yok). */
  readonly unknownDirection: number;
  readonly lastOutcome: EnforcementEdgeMatchOutcome | null;
}

export const EMPTY_ENFORCEMENT_MATCH_COUNTERS: EnforcementMatchCounters = Object.freeze({
  matchedToEdge: 0,
  ambiguousEdge: 0,
  noEdgeMatch: 0,
  outsideCoverage: 0,
  notMeasured: 0,
  onewayImplied: 0,
  unknownDirection: 0,
  lastOutcome: null,
});

/** Eşleşmeyi deftere KATLAR. **Saf** — girdiyi değiştirmez. */
export function foldEnforcementMatch(
  prev: EnforcementMatchCounters, m: EnforcementEdgeMatch,
): EnforcementMatchCounters {
  return {
    matchedToEdge: prev.matchedToEdge + (m.outcome === 'MATCHED_TO_EDGE' ? 1 : 0),
    ambiguousEdge: prev.ambiguousEdge + (m.outcome === 'AMBIGUOUS_EDGE' ? 1 : 0),
    noEdgeMatch: prev.noEdgeMatch + (m.outcome === 'NO_EDGE_MATCH' ? 1 : 0),
    outsideCoverage: prev.outsideCoverage + (m.outcome === 'OUTSIDE_COVERAGE' ? 1 : 0),
    notMeasured: prev.notMeasured + (m.outcome === 'NOT_MEASURED' ? 1 : 0),
    onewayImplied: prev.onewayImplied
      + (m.directionApplicability === 'ONEWAY_IMPLIED' ? 1 : 0),
    unknownDirection: prev.unknownDirection
      + (m.directionApplicability === 'UNKNOWN_DIRECTION' ? 1 : 0),
    lastOutcome: m.outcome,
  };
}

/**
 * Bu hüküm "nokta yol ağında YOK" demeye yeter mi.
 *
 * Yalnız `OUTSIDE_COVERAGE` bir yokluk ÖLÇÜMÜDÜR. `AMBIGUOUS_EDGE` ve
 * `NO_EDGE_MATCH` birer BİLGİSİZLİKTİR: nokta oradadır, biz bağlayamadık.
 * Bu ayrım kaybolursa "ileride denetim yok" hükmü sahte biçimde üretilir.
 */
export function matchIsMeasuredAbsence(o: EnforcementEdgeMatchOutcome): boolean {
  return o === 'OUTSIDE_COVERAGE';
}
