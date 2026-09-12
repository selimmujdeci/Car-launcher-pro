/**
 * navV3ContractsF0.test.ts — NAV v3 · F0 KANONİK SÖZLEŞME + MİMARİ KİLİTLERİ.
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F0.
 *
 * Bu dosya F0'ın çıkış kapısıdır:
 *  1) Kanonik sözleşmeler tek otoritede ve davranışsal kuralları tutuyor.
 *  2) `contracts/**` SAF (I/O · timer · saat · React yok).
 *  3) Kanıt sınıfı sözlüğü `sessionInspectorModel.Observability` ile birebir aynı
 *     (paralel tip YOK).
 *  4) L4 truth sahipleri ham kaynak modüllerini import ETMİYOR.
 *  5) Bağımlılık yasası döngüsüz ve L4–L6 MapStore'dan yalıtık.
 *
 * SAHA DOĞRULAMASI: bu testin yeşili F0'ı "tamam" YAPMAZ — yalnız sözleşme
 * omurgasının kurulduğunu gösterir (kütük #1205–#1207 · `UNKNOWN / DEVICE
 * VALIDATION REQUIRED`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  observedNav, derivedNav, unavailableNav, staleNav, withStaleness,
  isDecisionGrade, evidenceAgeMs,
  UNAVAILABLE_CONFIDENCE_CEIL, STALE_CONFIDENCE_CEIL,
  EVIDENCE_GRADES,
} from '../platform/navigation/contracts/navEvidence';
import {
  makeEdgeId, splitEdgeId, edgeIdEquals, edgeIdToString, edgeIdFromString,
  EDGE_ID_TILE_MAX, EDGE_ID_LOCAL_IDX_MAX, isEdgeId,
} from '../platform/navigation/contracts/navEdgeId';
import {
  NAV_DEGRADATION_ORDER, NAV_CLAIMS, NAV_DEGRADATION_SUPPRESSION,
  NAV_DEGRADATION_USER_MESSAGE, resolveSuppressedClaims, isClaimAllowed,
  worstDegradation, isAtLeastAsSevere,
} from '../platform/navigation/contracts/navDegradation';
import {
  NAV_LAYER_IDS, NAV_LAYER_DEPENDENCY_LAW, NAV_RAW_SOURCE_MODULES,
  NAV_L4_TRUTH_OWNERS, NAV_RAW_SOURCE_ALLOWLIST,
  mayDependOn, isDependencyLawAcyclic, routingLayersIsolatedFromMapStore,
} from '../platform/navigation/contracts/navLayers';
import {
  matchedPoseCarriesRaw, egoModeAllowsGuidance, isRealtimeEgoPose,
} from '../platform/navigation/contracts/navEgoPose';
import {
  NAV_OUTCOME_CONTRACT, compareOutcome,
} from '../platform/navigation/contracts/navOutcomeContract';
import {
  UNAVAILABLE_VEHICLE_EVIDENCE_BUS, VEHICLE_EVIDENCE_SIGNAL_IDS,
} from '../platform/navigation/contracts/vehicleEvidenceBus';
import { asMonotonic } from '../platform/navigation/contracts/navMonotonicTime';

import type { Observability } from '../platform/devtools/sessionInspectorModel';

const SRC = resolve(__dirname, '..');
const CONTRACTS_DIR = 'platform/navigation/contracts';
const readSrc = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
const contractFiles = readdirSync(resolve(SRC, CONTRACTS_DIR)).filter((f) => f.endsWith('.ts'));

/** Docblock/yorumları siyırır — bir SÖZ bir KULLANIM değildir. */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/* ══════════════════════════════════════════════════════════════════════════
   1) KANIT SÖZLEŞMESİ
   ══════════════════════════════════════════════════════════════════════════ */
describe('F0 · Evidenced<T> kanıt sözleşmesi', () => {
  it('UNAVAILABLE kanıtta değer null ve güven ≤ 0.3', () => {
    const ev = unavailableNav<number>('GNSS', 'NO_SOURCE');
    expect(ev.value).toBeNull();
    expect(ev.grade).toBe('UNAVAILABLE');
    expect(ev.confidence).toBeLessThanOrEqual(UNAVAILABLE_CONFIDENCE_CEIL);
  });

  it('OBSERVED kurucusu null değeri UNAVAILABLE\'a düşürür (sahte değer yok)', () => {
    expect(observedNav<number>(null, { source: 'GNSS' }).grade).toBe('UNAVAILABLE');
    expect(observedNav<number>(undefined, { source: 'GNSS' }).grade).toBe('UNAVAILABLE');
  });

  it('STALE kanıtta güven ≤ 0.5 (kurucu kırpar)', () => {
    const ev = staleNav<number>(42, { source: 'ADAS_TILE', confidence: 0.99 });
    expect(ev.grade).toBe('STALE');
    expect(ev.confidence).toBeLessThanOrEqual(STALE_CONFIDENCE_CEIL);
  });

  it('withStaleness yalnız monotonik damga + tanımlı bütçe varken STALE\'e yükseltir', () => {
    const fresh = observedNav<number>(50, {
      source: 'GNSS', observedAtMonoMs: asMonotonic(1_000), freshnessBudgetMs: 5_000,
    });
    // damga + bütçe var, yaş < bütçe → değişmez
    expect(withStaleness(fresh, asMonotonic(3_000)).grade).toBe('OBSERVED');
    // yaş > bütçe → STALE
    const aged = withStaleness(fresh, asMonotonic(9_000));
    expect(aged.grade).toBe('STALE');
    expect(aged.confidence).toBeLessThanOrEqual(STALE_CONFIDENCE_CEIL);
    // bütçe yoksa bayatlık HESAPLANMAZ
    const noBudget = observedNav<number>(50, { source: 'GNSS', observedAtMonoMs: asMonotonic(1_000) });
    expect(withStaleness(noBudget, asMonotonic(9_999_999)).grade).toBe('OBSERVED');
  });

  it('evidenceAgeMs damga yoksa null döner (uydurma yaş yok)', () => {
    expect(evidenceAgeMs(unavailableNav<number>('NONE'), asMonotonic(1000))).toBeNull();
  });

  it('isDecisionGrade yalnız OBSERVED/DERIVED + değer var iken true', () => {
    expect(isDecisionGrade(observedNav<number>(1, { source: 'GNSS' }))).toBe(true);
    expect(isDecisionGrade(derivedNav<number>(1, { source: 'DERIVED' }))).toBe(true);
    expect(isDecisionGrade(unavailableNav<number>('NONE'))).toBe(false);
    expect(isDecisionGrade(staleNav<number>(1, { source: 'GNSS' }))).toBe(false);
  });

  it('EvidenceGrade sözlüğü sessionInspectorModel.Observability ile BİREBİR AYNI (paralel tip yok)', () => {
    // Observability enum-benzeri değil, tip; değer kümesini docblock-bağımsız
    // doğrulamak için kaynak taraması + kurucu çıktısı üzerinden denetlenir.
    const inspectorSrc = readSrc('platform/devtools/sessionInspectorModel.ts');
    const m = /export type Observability =\s*([^;]+);/.exec(inspectorSrc);
    expect(m, 'Observability tanımı bulunamadı').not.toBeNull();
    const inspectorGrades = (m as RegExpExecArray)[1]
      .split('|').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean).sort();
    expect([...EVIDENCE_GRADES].sort()).toEqual(inspectorGrades);
    // Tip düzeyinde de kullanılabildiğini sabitle (kullanılmayan import guard'ı için).
    const probe: Observability = 'OBSERVED';
    expect(EVIDENCE_GRADES).toContain(probe);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) EDGE ID — JS 53-bit güvenli
   ══════════════════════════════════════════════════════════════════════════ */
describe('F0 · EdgeId JS-güvenli kenar kimliği', () => {
  const cases: Array<[number, number, 0 | 1]> = [
    [0, 0, 0],
    [1, 1, 1],
    [EDGE_ID_TILE_MAX, EDGE_ID_LOCAL_IDX_MAX, 1],
    [EDGE_ID_TILE_MAX, 0, 0],
    [0, EDGE_ID_LOCAL_IDX_MAX, 1],
    [0xABCDEF12, 0x123456, 1],
    [255, 42, 0],
    [256, 42, 1],
  ];

  it('tüm alan kombinasyonları round-trip yapar', () => {
    for (const [tileId, localIdx, dir] of cases) {
      const id = makeEdgeId(tileId, localIdx, dir);
      const parts = splitEdgeId(id);
      expect(parts).toEqual({ tileId, localIdx, dir });
    }
  });

  it('hi/lo alanları DAİMA uint32 sınırında — hiçbir ara sayı 2^53\'ü aşmaz', () => {
    for (const [tileId, localIdx, dir] of cases) {
      const id = makeEdgeId(tileId, localIdx, dir);
      expect(Number.isSafeInteger(id.hi)).toBe(true);
      expect(Number.isSafeInteger(id.lo)).toBe(true);
      expect(id.hi).toBeGreaterThanOrEqual(0);
      expect(id.hi).toBeLessThanOrEqual(0xFFFFFF);
      expect(id.lo).toBeGreaterThanOrEqual(0);
      expect(id.lo).toBeLessThanOrEqual(0xFFFFFFFF);
      expect(isEdgeId(id)).toBe(true);
    }
  });

  it('en büyük kimlik tek number olarak taşınamaz (56-bit > 53-bit) — sözleşmenin varlık sebebi', () => {
    const parts = { tileId: EDGE_ID_TILE_MAX, localIdx: EDGE_ID_LOCAL_IDX_MAX, dir: 1 };
    const naiveSingleNumber = parts.tileId * 2 ** 24 + parts.localIdx * 2 + parts.dir;
    expect(Number.isSafeInteger(naiveSingleNumber)).toBe(false);
    // {hi,lo} ise güvenli:
    const id = makeEdgeId(parts.tileId, parts.localIdx, parts.dir);
    expect(splitEdgeId(id)).toEqual(parts);
  });

  it('aralık dışı girdi RangeError (sessiz taşma yok)', () => {
    expect(() => makeEdgeId(EDGE_ID_TILE_MAX + 1, 0, 0)).toThrow(RangeError);
    expect(() => makeEdgeId(0, EDGE_ID_LOCAL_IDX_MAX + 1, 0)).toThrow(RangeError);
    expect(() => makeEdgeId(0, 0, 2 as unknown as 0)).toThrow(RangeError);
    expect(() => makeEdgeId(1.5, 0, 0)).toThrow(RangeError);
  });

  it('metin gösterimi round-trip + eşitlik', () => {
    const id = makeEdgeId(0xABCDEF12, 0x123456, 1);
    const s = edgeIdToString(id);
    expect(s).toMatch(/^[0-9a-f]{6}:[0-9a-f]{8}$/);
    expect(edgeIdEquals(edgeIdFromString(s), id)).toBe(true);
    expect(edgeIdFromString('not-an-edge')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) BOZULMA SÖZLEŞMESİ — susturma matrisi tek otorite
   ══════════════════════════════════════════════════════════════════════════ */
describe('F0 · NavDegradation susturma matrisi', () => {
  it('her bozulma seviyesinin bir susturma satırı VAR (v2 P9)', () => {
    for (const lvl of NAV_DEGRADATION_ORDER) {
      expect(NAV_DEGRADATION_SUPPRESSION[lvl], `${lvl} susturma satırı yok`).toBeDefined();
      expect(Array.isArray(NAV_DEGRADATION_SUPPRESSION[lvl])).toBe(true);
      expect(typeof NAV_DEGRADATION_USER_MESSAGE[lvl], `${lvl} kullanıcı mesajı yok`).toBe('string');
    }
  });

  it('matris yalnız tanımlı NavClaim değerleri içerir', () => {
    const known = new Set<string>(NAV_CLAIMS);
    for (const lvl of NAV_DEGRADATION_ORDER) {
      for (const claim of NAV_DEGRADATION_SUPPRESSION[lvl]) {
        expect(known.has(claim), `${lvl} bilinmeyen iddia susturuyor: ${claim}`).toBe(true);
      }
    }
  });

  it('FULL hiçbir şeyi susturmaz · SAFE_STOP her şeyi susturur', () => {
    expect(resolveSuppressedClaims('FULL').size).toBe(0);
    expect(resolveSuppressedClaims('SAFE_STOP').size).toBe(NAV_CLAIMS.length);
    for (const claim of NAV_CLAIMS) {
      expect(isClaimAllowed('FULL', claim)).toBe(true);
      expect(isClaimAllowed('SAFE_STOP', claim)).toBe(false);
    }
  });

  it('susturma KÜMÜLATİF — ağır seviye hafifin susturduğunu da susturur', () => {
    // NO_TRAFFIC canlı trafiği susturur; NO_NETWORK de (kümülatif) susturmalı.
    expect(isClaimAllowed('NO_TRAFFIC', 'LIVE_TRAFFIC')).toBe(false);
    expect(isClaimAllowed('NO_NETWORK', 'LIVE_TRAFFIC')).toBe(false);
    expect(isClaimAllowed('NO_MAP_DATA', 'LIVE_TRAFFIC')).toBe(false);
    // NO_MAP_DATA rota rehberliğini susturur; NO_POSITION de.
    expect(isClaimAllowed('NO_MAP_DATA', 'ROUTE_GUIDANCE')).toBe(false);
    expect(isClaimAllowed('NO_POSITION', 'ROUTE_GUIDANCE')).toBe(false);
  });

  it('NO_TRAFFIC rota rehberliğini SUSTURMAZ (ürün kullanılabilir kalır)', () => {
    expect(isClaimAllowed('NO_TRAFFIC', 'ROUTE_GUIDANCE')).toBe(true);
    expect(isClaimAllowed('NO_TRAFFIC', 'MANEUVER_GUIDANCE')).toBe(true);
    expect(isClaimAllowed('NO_NETWORK', 'ROUTE_GUIDANCE')).toBe(true);
  });

  it('worstDegradation / severity sıralaması tutarlı', () => {
    expect(worstDegradation('FULL', 'NO_POSITION')).toBe('NO_POSITION');
    expect(worstDegradation('NO_TRAFFIC', 'NO_NETWORK')).toBe('NO_NETWORK');
    expect(isAtLeastAsSevere('SAFE_STOP', 'FULL')).toBe(true);
    expect(isAtLeastAsSevere('FULL', 'NO_TRAFFIC')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) EGO POZ SEMANTİĞİ
   ══════════════════════════════════════════════════════════════════════════ */
describe('F0 · RealtimeEgoPose vs MatchedRoadPose', () => {
  const raw = {
    kind: 'REALTIME_EGO' as const,
    tsMonoMs: asMonotonic(1000),
    lat: observedNav<number>(36.8, { source: 'GNSS' }),
    lon: observedNav<number>(34.6, { source: 'GNSS' }),
    headingDeg: observedNav<number>(90, { source: 'GNSS' }),
    speedMps: observedNav<number>(12, { source: 'VEHICLE_BUS' }),
    mode: 'GNSS' as const,
    horizontalSigmaM: 4,
  };

  it('MatchedRoadPose ham pozu DAİMA taşır (map-lock koruması)', () => {
    const matched = {
      kind: 'MATCHED_ROAD' as const,
      tsMonoMs: asMonotonic(1000),
      matchState: 'MATCHED' as const,
      edgeId: makeEdgeId(10, 20, 1),
      alongEdgeM: derivedNav<number>(42, { source: 'MAP_MATCH' }),
      snappedLat: derivedNav<number>(36.8, { source: 'MAP_MATCH' }),
      snappedLon: derivedNav<number>(34.6, { source: 'MAP_MATCH' }),
      rawPose: raw,
      lateralOffsetM: 1.2,
    };
    expect(matchedPoseCarriesRaw(matched)).toBe(true);
    expect(isRealtimeEgoPose(matched.rawPose)).toBe(true);
    // ham pozsuz "eşleşmiş poz" sözleşme ihlali:
    expect(matchedPoseCarriesRaw({ ...matched, rawPose: undefined as never })).toBe(false);
  });

  it('rehberlik yalnız GNSS / GNSS_DR modunda serbest', () => {
    expect(egoModeAllowsGuidance('GNSS')).toBe(true);
    expect(egoModeAllowsGuidance('GNSS_DR')).toBe(true);
    expect(egoModeAllowsGuidance('DR_ONLY')).toBe(false);
    expect(egoModeAllowsGuidance('LAST_KNOWN')).toBe(false);
    expect(egoModeAllowsGuidance('NONE')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) L8 OUTCOME — yalnız sözleşme
   ══════════════════════════════════════════════════════════════════════════ */
describe('F0 · L8 Outcome/Accountability sözleşmesi', () => {
  it('gözlem otoritatif harita/ufuk/ego/rota gerçeğini EZEMEZ', () => {
    expect(NAV_OUTCOME_CONTRACT.canWriteAuthoritativeMap).toBe(false);
    expect(NAV_OUTCOME_CONTRACT.canWriteHorizonTruth).toBe(false);
    expect(NAV_OUTCOME_CONTRACT.canWriteEgoTruth).toBe(false);
    expect(NAV_OUTCOME_CONTRACT.canWriteRouteTruth).toBe(false);
    expect(NAV_OUTCOME_CONTRACT.observationTarget).toBe('SEPARATE_BELIEF_LAYER');
    expect(NAV_OUTCOME_CONTRACT.learningImplemented).toBe(false);
  });

  it('compareOutcome yalnız fark hesaplar (model güncellemesi yok)', () => {
    const cmp = compareOutcome(
      { predicted: 120, horizonS: 300, basis: 'DETERMINISTIC_DERIVATION', madeAtMonoMs: asMonotonic(1000) },
      { observed: 135, observedAtMonoMs: asMonotonic(1301), source: 'ROUTE_PROVIDER' },
    );
    expect(cmp.deltaAbs).toBe(15);
    expect(cmp.outcomeAfterPrediction).toBe(true);
  });

  it('L8 dosyasında öğrenme/kalıcılık/geri besleme izi YOK', () => {
    const src = strip(readSrc(`${CONTRACTS_DIR}/navOutcomeContract.ts`));
    for (const forbidden of ['safeStorage', 'localStorage', 'setState', 'train', 'gradient', '.write(', 'subscribe(']) {
      expect(src, `L8 sözleşmesi ${forbidden} içeriyor — F0'da yalnız sözleşme olmalı`).not.toContain(forbidden);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) VEHICLE EVIDENCE BUS — fail-closed
   ══════════════════════════════════════════════════════════════════════════ */
describe('F0 · VehicleEvidenceBus sınırı', () => {
  it('varsayılan bus HER sinyal için UNAVAILABLE döner (fail-closed)', () => {
    for (const sig of VEHICLE_EVIDENCE_SIGNAL_IDS) {
      const r = UNAVAILABLE_VEHICLE_EVIDENCE_BUS.read(sig);
      expect(r.signal).toBe(sig);
      expect(r.value.grade).toBe('UNAVAILABLE');
      expect(r.value.value).toBeNull();
      expect(r.value.source).toBe('VEHICLE_BUS');
    }
  });

  it('sınır dosyası CAN/OBD acquisition IMPLEMENT ETMEZ (yalnız arayüz)', () => {
    const src = strip(readSrc(`${CONTRACTS_DIR}/vehicleEvidenceBus.ts`));
    for (const forbidden of ['obdService', 'signalHub', 'canonicalVehicleSignal', 'UnifiedVehicleStore', 'fetch(']) {
      expect(src, `bus sınırı ${forbidden} import ediyor — F0'da yalnız arayüz olmalı`).not.toContain(forbidden);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) KATMAN BAĞIMLILIK YASASI
   ══════════════════════════════════════════════════════════════════════════ */
describe('F0 · Katman bağımlılık yasası', () => {
  it('yasa döngüsüz', () => {
    expect(isDependencyLawAcyclic()).toBe(true);
  });

  it('L4 / L5 / L6 MapStore (L1) truth\'una BAĞIMLI DEĞİL (v2 P2)', () => {
    expect(routingLayersIsolatedFromMapStore()).toBe(true);
    expect(mayDependOn('L4', 'L1')).toBe(false);
    expect(mayDependOn('L5', 'L1')).toBe(false);
    expect(mayDependOn('L6', 'L1')).toBe(false);
  });

  it('L4 yalnız L3\'ten okur — yol gerçeği ufuktan (ADR-N01)', () => {
    expect(NAV_LAYER_DEPENDENCY_LAW.L4).toEqual(['L3']);
  });

  it('her katman yalnız KENDİNDEN DÜŞÜK / izinli katmanlara bağlanır', () => {
    const rank: Record<string, number> = {};
    NAV_LAYER_IDS.forEach((id, i) => { rank[id] = i; });
    for (const from of NAV_LAYER_IDS) {
      for (const to of NAV_LAYER_DEPENDENCY_LAW[from]) {
        // L7/L8 yatay gözlemci: L2–L6 okuyabilir. Diğerleri katı alt-katman.
        if (from === 'L7' || from === 'L8') {
          expect(rank[to]).toBeLessThan(rank[from]);
        } else {
          expect(rank[to], `${from} → ${to} yukarı bağımlılık`).toBeLessThan(rank[from]);
        }
      }
    }
  });

  it('L7 (Presentation) ve L8 hiçbir üst katmana / birbirine bağlı değil', () => {
    expect(NAV_LAYER_DEPENDENCY_LAW.L7).not.toContain('L8');
    expect(NAV_LAYER_DEPENDENCY_LAW.L8).not.toContain('L7');
    expect(NAV_LAYER_DEPENDENCY_LAW.L7).not.toContain('L7');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8) MİMARİ KİLİTLER — kaynak taraması
   ══════════════════════════════════════════════════════════════════════════ */
describe('F0 · contracts/** SAFLIK kilidi', () => {
  it('hiçbir sözleşme dosyası I/O · timer · saat · React kullanmaz', () => {
    expect(contractFiles.length).toBeGreaterThanOrEqual(8);
    for (const f of contractFiles) {
      const src = strip(readSrc(`${CONTRACTS_DIR}/${f}`));
      expect(src, `${f}: Date.now()`).not.toContain('Date.now(');
      expect(src, `${f}: performance.now()`).not.toContain('performance.now(');
      expect(src, `${f}: setInterval`).not.toContain('setInterval(');
      expect(src, `${f}: setTimeout`).not.toContain('setTimeout(');
      expect(src, `${f}: requestAnimationFrame`).not.toContain('requestAnimationFrame(');
      expect(src, `${f}: React importu`).not.toMatch(/from ['"]react['"]/);
      expect(src, `${f}: fetch()`).not.toContain('fetch(');
      expect(src, `${f}: node:fs`).not.toContain('node:fs');
      expect(src, `${f}: require()`).not.toMatch(/\brequire\(/);
    }
  });

  it('sözleşme dosyaları yalnız kendi paketinden import eder (dış katman sızıntısı yok)', () => {
    for (const f of contractFiles) {
      const src = readSrc(`${CONTRACTS_DIR}/${f}`);
      const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const imp of imports) {
        if (!imp.startsWith('.')) continue; // tip-only paket importu yok zaten
        expect(imp.startsWith('./'), `${f}: paket dışı göreli import ${imp}`).toBe(true);
      }
    }
  });

  it('her kanonik sembol TEK dosyada tanımlı (ikinci otorite yok)', () => {
    const canonical = [
      'export interface Evidenced<', 'export type EvidenceGrade', 'export type NavSignalSource',
      'export interface EdgeId', 'export type NavDegradation', 'export type NavClaim',
      'export interface RealtimeEgoPose', 'export interface MatchedRoadPose',
      'export const NAV_LAYER_DEPENDENCY_LAW', 'export interface VehicleEvidenceBus',
      'export const NAV_DEGRADATION_SUPPRESSION', 'export const NAV_OUTCOME_CONTRACT',
    ];
    for (const decl of canonical) {
      let hits = 0;
      for (const f of contractFiles) {
        if (readSrc(`${CONTRACTS_DIR}/${f}`).includes(decl)) hits++;
      }
      expect(hits, `${decl} → ${hits} tanım (tam 1 olmalı)`).toBe(1);
    }
  });
});

describe('F0 · L4 truth sahipleri ham kaynak modüllerini import ETMEZ', () => {
  it('routingService / navigationService gpsService · overpass · mapSource* import etmiyor', () => {
    for (const owner of NAV_L4_TRUTH_OWNERS) {
      const rel = owner.replace(/^src\//, '');
      const src = readSrc(rel);
      const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const imp of imports) {
        const base = imp.split('/').pop() ?? imp;
        if (NAV_RAW_SOURCE_ALLOWLIST.includes(base)) continue;
        for (const raw of NAV_RAW_SOURCE_MODULES) {
          expect(
            base === raw || imp.includes(`/${raw}`),
            `${owner}: yasak ham kaynak importu "${imp}" (kural: L4–L6 yol gerçeğini L3'ten alır)`,
          ).toBe(false);
        }
      }
    }
  });
});
