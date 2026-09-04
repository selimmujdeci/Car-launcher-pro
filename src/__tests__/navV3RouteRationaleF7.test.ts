/**
 * navV3RouteRationaleF7.test.ts — NAV v3 · F7 · "NEDEN BU ROTA?" KİLİTLERİ.
 *
 * Belge: `NAVIGATION_ARCHITECTURE_SPEC_v2.md` §5.5 · `CAROS-NAV-ARCH-SPEC-3.0` §F7.
 *
 * Kapsam:
 *  1) `buildRouteRationale` — SAF açıklayıcı (etken · süre takası · fail-closed)
 *  2) `pickBestRoute` ile TUTARLILIK — açıklayıcı gerçekten KARARI açıklıyor mu
 *  3) `asUserSelectedRationale` — kullanıcı tercihi sistem kararı gibi sunulmaz
 *  4) Bounded defter
 *  5) Mimari kilitler R1–R8
 *
 * SAHA: bu testin yeşili F7'yi "tamam" YAPMAZ — gerçek araç ölçümü kütükte
 * ayrı maddeler olarak kalır (#1269–#1272).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildRouteRationale, buildSingleCandidateRationale, asUserSelectedRationale,
  recordRouteRationale, getRouteRationaleLedger, _resetRouteRationaleForTest,
  ROUTE_DECIDING_FACTORS, ROUTE_DECIDING_FACTOR_LABEL, ROUTE_RATIONALE_MAX_RECORDS,
} from '../platform/navigation/core/routeRationaleModel';
import {
  pickBestRoute, routeRankKey,
  type RouteCandidate, type RouteValidationResult, type RouteVerdict,
} from '../platform/navigation/core/routeValidationModel';

/* ══════════════════════════════════════════════════════════════════════════
   YARDIMCILAR — aday üretimi (geometri ÖNEMSİZ: gerekçe onu taşımaz)
   ══════════════════════════════════════════════════════════════════════════ */

function cand(distanceM: number, durationS: number): RouteCandidate {
  return { geometry: [[29, 41], [29.01, 41.01]], distanceM, durationS, steps: [] };
}

function val(
  failCount: number, warnCount: number, verdict: RouteVerdict = 'VALID',
  failedIds: readonly string[] = [],
): RouteValidationResult {
  return {
    verdict,
    checks: failedIds.map((id) => ({ id, status: 'FAIL' as const, detail: 'test' })),
    failCount,
    warnCount,
    unknownCount: 0,
  };
}

type Pair = { candidate: RouteCandidate; validation: RouteValidationResult };
const pair = (
  d: number, t: number, f: number, w: number,
  verdict: RouteVerdict = 'VALID', ids: readonly string[] = [],
): Pair => ({ candidate: cand(d, t), validation: val(f, w, verdict, ids) });

/* ══════════════════════════════════════════════════════════════════════════
   1) SAF AÇIKLAYICI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F7.1 · buildRouteRationale — saf açıklayıcı', () => {
  it('kabul edilen TEK aday → ONLY_OPTION, takas YOK (ölçülmüş 0)', () => {
    const r = buildRouteRationale([pair(10_000, 600, 0, 0)], 0, 'REMOTE_OSRM');
    expect(r.decidingFactor).toBe('ONLY_OPTION');
    expect(r.durationPenaltyS).toBe(0);
    expect(r.acceptedCount).toBe(1);
    expect(r.rejectedCount).toBe(0);
  });

  it('daha AZ ağır kusur belirledi → VALIDATION_FAIL (süre pahasına olsa bile)', () => {
    /* Aday 1 seksen saniye DAHA UZUN ama bir kusuru AZ — bugünkü gerçek karar. */
    const cands = [pair(12_000, 900, 1, 0, 'DEGRADED', ['DEST_PROXIMITY']), pair(13_400, 980, 0, 1)];
    const r = buildRouteRationale(cands, 1, 'REMOTE_OSRM');
    expect(r.decidingFactor).toBe('VALIDATION_FAIL');
    /* F7'nin asıl sayısı: sürücüye ödetilen 80 sn görünür oldu. */
    expect(r.durationPenaltyS).toBe(80);
    expect(r.durationPenaltyRatio).toBeCloseTo(80 / 900, 6);
  });

  it('kusur eşit, daha AZ uyarı belirledi → VALIDATION_WARN', () => {
    const r = buildRouteRationale([pair(10_000, 600, 1, 2), pair(10_500, 640, 1, 0)], 1, 'REMOTE_OSRM');
    expect(r.decidingFactor).toBe('VALIDATION_WARN');
    expect(r.durationPenaltyS).toBe(40);
  });

  it('kusur+uyarı eşit, daha KISA süre belirledi → DURATION, takas 0', () => {
    const r = buildRouteRationale([pair(10_000, 700, 0, 0), pair(10_500, 600, 0, 0)], 1, 'REMOTE_OSRM');
    expect(r.decidingFactor).toBe('DURATION');
    expect(r.durationPenaltyS).toBe(0);
  });

  it('üç ölçüt de EŞİT → TIE_PROVIDER_ORDER (tercih değil, sıra)', () => {
    const r = buildRouteRationale([pair(10_000, 600, 0, 0), pair(10_000, 600, 0, 0)], 0, 'REMOTE_OSRM');
    expect(r.decidingFactor).toBe('TIE_PROVIDER_ORDER');
  });

  it('hiçbir aday kabul edilmedi → NO_CANDIDATE (rota YOK, "tek seçenek" DEĞİL)', () => {
    const cands = [pair(1, 1, 3, 0, 'REJECTED', ['ORIGIN_PROXIMITY']), pair(1, 1, 2, 0, 'REJECTED', ['DEST_PROXIMITY'])];
    const r = buildRouteRationale(cands, null, 'REMOTE_OSRM');
    expect(r.decidingFactor).toBe('NO_CANDIDATE');
    expect(r.chosenIdx).toBeNull();
    expect(r.acceptedCount).toBe(0);
    expect(r.rejectedCount).toBe(2);
    expect(r.durationPenaltyS).toBeNull();
  });

  it('AÇIKLAYICI KARAR VERMEZ: daha iyi aday varken başkası seçilmişse → UNKNOWN', () => {
    /* Aday 0 her ölçütte daha iyi; buna rağmen 1 seçilmiş. Açıklayıcı bunu
       "daha kısa süre" diye YALANLAMAZ — bilmediğini söyler (fail-closed). */
    const r = buildRouteRationale([pair(10_000, 600, 0, 0), pair(20_000, 1_800, 2, 3)], 1, 'REMOTE_OSRM');
    expect(r.decidingFactor).toBe('UNKNOWN');
  });

  it('REDDEDİLMİŞ aday seçilmiş gösterilirse → UNKNOWN (uydurma gerekçe yok)', () => {
    const cands = [pair(10_000, 600, 0, 0), pair(9_000, 500, 4, 0, 'REJECTED', ['SELF_INTERSECT'])];
    const r = buildRouteRationale(cands, 1, 'REMOTE_OSRM');
    expect(r.decidingFactor).toBe('UNKNOWN');
  });

  it('süre ÖLÇÜLEMEZSE takas `null` — sahte 0 ÜRETİLMEZ', () => {
    const r = buildRouteRationale([pair(10_000, 0, 0, 0), pair(11_000, 0, 0, 1)], 0, 'REMOTE_OSRM');
    expect(r.durationPenaltyS).toBeNull();
    expect(r.durationPenaltyRatio).toBeNull();
    expect(r.candidates[0].durationS).toBeNull();
  });

  it('aralık dışı / bozuk girdi çökertmez, UNKNOWN veya NO_CANDIDATE verir', () => {
    expect(() => buildRouteRationale([], null, 'X')).not.toThrow();
    expect(buildRouteRationale([], null, 'X').decidingFactor).toBe('NO_CANDIDATE');
    expect(buildRouteRationale([pair(1, 1, 0, 0)], 9, 'X').decidingFactor).toBe('UNKNOWN');
    expect(buildRouteRationale([pair(1, 1, 0, 0)], -1, 'X').chosenIdx).toBeNull();
  });

  it('tek adaylı katman kurucusu ONLY_OPTION üretir (daemon/çevrimdışı)', () => {
    const r = buildSingleCandidateRationale(cand(8_000, 500), val(0, 0), 'OFFLINE_GRAPH');
    expect(r.decidingFactor).toBe('ONLY_OPTION');
    expect(r.provider).toBe('OFFLINE_GRAPH');
    expect(r.candidates).toHaveLength(1);
  });

  it('GİZLİLİK: gerekçe hiçbir koordinat/geometri TAŞIMAZ', () => {
    const r = buildRouteRationale([pair(10_000, 600, 0, 0), pair(11_000, 700, 1, 0)], 0, 'REMOTE_OSRM');
    const json = JSON.stringify(r);
    expect(json).not.toContain('geometry');
    expect(json).not.toContain('41.0');
    expect(json).not.toContain('29.0');
    /* Aday özetinde koordinat alanı YAPISAL olarak da yok. */
    for (const c of r.candidates) {
      expect(Object.keys(c).sort()).toEqual([
        'accepted', 'distanceM', 'durationS', 'failCount', 'failedCheckIds',
        'index', 'verdict', 'warnCount',
      ]);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) KARARLA TUTARLILIK — kilidin KÖR OLMADIĞININ kanıtı
   ══════════════════════════════════════════════════════════════════════════ */

describe('F7.2 · açıklayıcı ↔ `pickBestRoute` tutarlılığı', () => {
  /** Deterministik senaryo kümesi (rastgele DEĞİL — tekrar edilebilir). */
  function scenarios(): Pair[][] {
    const out: Pair[][] = [];
    /* `3` REDDEDİLME eşiğidir — senaryo kümesi "hiç aday kalmadı" hâlini de
       GERÇEKTEN üretsin diye; aksi hâlde tutarlılık iddiası boşalırdı. */
    const fails = [0, 1, 3];
    const warns = [0, 1];
    const durs = [500, 600, 700];
    for (const f0 of fails) for (const w0 of warns) for (const d0 of durs) {
      for (const f1 of fails) for (const w1 of warns) for (const d1 of durs) {
        out.push([
          pair(10_000, d0, f0, w0, f0 >= 3 ? 'REJECTED' : 'VALID'),
          pair(10_000, d1, f1, w1, f1 >= 3 ? 'REJECTED' : 'VALID'),
        ]);
      }
    }
    return out;
  }

  it('gerçek seçimi açıklarken HİÇBİR senaryoda UNKNOWN üretmez (324 senaryo)', () => {
    const all = scenarios();
    expect(all.length).toBe(324);
    let explained = 0;
    let noCandidate = 0;
    for (const cands of all) {
      const picked = pickBestRoute(cands);
      const r = buildRouteRationale(cands, picked ? picked.index : null, 'REMOTE_OSRM');
      expect(r.decidingFactor, `senaryo açıklanamadı: ${JSON.stringify(cands.map(c => c.validation))}`)
        .not.toBe('UNKNOWN');
      if (picked) { explained++; } else { noCandidate++; expect(r.decidingFactor).toBe('NO_CANDIDATE'); }
    }
    /* Kilit KÖR OLMASIN: küme hem gerçek seçim hem "aday yok" hâli içermeli. */
    expect(explained).toBeGreaterThan(200);
    expect(noCandidate).toBeGreaterThan(0);
    expect(explained + noCandidate).toBe(all.length);
  });

  it('takas DAİMA ≥ 0 ve seçilenin süresi en hızlıdan küçük OLAMAZ', () => {
    for (const cands of scenarios()) {
      const picked = pickBestRoute(cands);
      if (!picked) continue;
      const r = buildRouteRationale(cands, picked.index, 'REMOTE_OSRM');
      if (r.durationPenaltyS !== null) expect(r.durationPenaltyS).toBeGreaterThanOrEqual(0);
    }
  });

  it('sıralama anahtarı TEK kaynaktan okunur (`routeRankKey`)', () => {
    /* Anahtarın kendisi de sözleşmedir: [kusur, uyarı, süre]. */
    expect(routeRankKey(cand(1, 300), val(2, 1))).toEqual([2, 1, 300]);
    /* Süresi ölçülemeyen aday süre bakımından EN KÖTÜ sayılır (uydurma yok). */
    expect(routeRankKey(cand(1, 0), val(0, 0))[2]).toBe(Number.MAX_SAFE_INTEGER);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) KULLANICI TERCİHİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F7.3 · asUserSelectedRationale', () => {
  it('kullanıcı seçimi SİSTEM kararı gibi sunulmaz', () => {
    const sys = buildRouteRationale([pair(10_000, 600, 0, 0), pair(12_000, 900, 0, 1)], 0, 'REMOTE_OSRM');
    const user = asUserSelectedRationale(sys, 1);
    expect(user.decidingFactor).toBe('USER_SELECTED');
    expect(user.chosenIdx).toBe(1);
    /* Kullanıcı da bir takas yapmış olabilir — ölçüm KORUNUR. */
    expect(user.durationPenaltyS).toBe(300);
  });

  it('önceki gerekçe yoksa uydurma aday listesi ÜRETİLMEZ', () => {
    const user = asUserSelectedRationale(null, 2);
    expect(user.decidingFactor).toBe('USER_SELECTED');
    expect(user.chosenIdx).toBeNull();
    expect(user.candidates).toEqual([]);
    expect(user.durationPenaltyS).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) DEFTER
   ══════════════════════════════════════════════════════════════════════════ */

describe('F7.4 · bounded defter', () => {
  beforeEach(() => _resetRouteRationaleForTest());

  it('boş defter "ölçülmedi" der — sahte kayıt YOK', () => {
    const l = getRouteRationaleLedger();
    expect(l.last).toBeNull();
    expect(l.decisions).toBe(0);
    expect(l.maxDurationPenaltyS).toBeNull();
  });

  it(`en fazla ${ROUTE_RATIONALE_MAX_RECORDS} kayıt taşınır (sınırsız büyüme YOK)`, () => {
    for (let i = 0; i < ROUTE_RATIONALE_MAX_RECORDS + 12; i++) {
      recordRouteRationale(buildRouteRationale([pair(1_000 + i, 600, 0, 0)], 0, 'REMOTE_OSRM'));
    }
    const l = getRouteRationaleLedger();
    expect(l.recent.length).toBe(ROUTE_RATIONALE_MAX_RECORDS);
    expect(l.decisions).toBe(ROUTE_RATIONALE_MAX_RECORDS + 12);
    /* En yeni başta. */
    expect(l.last!.candidates[0].distanceM).toBe(1_000 + ROUTE_RATIONALE_MAX_RECORDS + 11);
  });

  it('sağlayıcının İLK rotasının reddi SAYILIR (kapı ne sıklıkla devrede)', () => {
    recordRouteRationale(buildRouteRationale([pair(10_000, 600, 0, 0), pair(11_000, 700, 1, 0)], 0, 'REMOTE_OSRM'));
    recordRouteRationale(buildRouteRationale([pair(10_000, 900, 1, 0), pair(11_000, 700, 0, 0)], 1, 'REMOTE_OSRM'));
    const l = getRouteRationaleLedger();
    expect(l.overrodeProviderFirst).toBe(1);
    expect(l.factorCounts.VALIDATION_FAIL).toBe(2);
  });

  it('en büyük süre takası biriktirilir; ölçülemeyen tur onu BOZMAZ', () => {
    recordRouteRationale(buildRouteRationale([pair(10_000, 900, 1, 0), pair(11_000, 980, 0, 0)], 1, 'REMOTE_OSRM'));
    recordRouteRationale(buildRouteRationale([pair(10_000, 0, 0, 0)], 0, 'OFFLINE_GRAPH'));
    expect(getRouteRationaleLedger().maxDurationPenaltyS).toBe(80);
  });

  it('etken sözlüğü ile etiket sözlüğü BİREBİR aynı (yetim etiket yok)', () => {
    expect(Object.keys(ROUTE_DECIDING_FACTOR_LABEL).sort())
      .toEqual([...ROUTE_DECIDING_FACTORS].sort());
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) MİMARİ KİLİTLER
   ══════════════════════════════════════════════════════════════════════════ */

const SRC = resolve(__dirname, '..');
const readSrc = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const MODEL = 'platform/navigation/core/routeRationaleModel.ts';
const ROUTING = 'platform/routingService.ts';

describe('F7.5 · mimari kilitler', () => {
  it('R1 — gerekçe modeli SAF: I/O · timer · saat · React · ağ YOK', () => {
    const src = strip(readSrc(MODEL));
    for (const bad of ['Date.now(', 'performance.now(', 'setInterval(', 'setTimeout(', 'fetch(']) {
      expect(src, `${MODEL}: yasak çağrı "${bad}"`).not.toContain(bad);
    }
    expect(src).not.toMatch(/from 'react'/);
  });

  it('R2 — sıralama anahtarı TEK tanımlı; gerekçe modeli kendi anahtarını KURMAZ', () => {
    const defs = ['platform/navigation/core/routeValidationModel.ts', MODEL, ROUTING]
      .filter((f) => readSrc(f).includes('export function routeRankKey'));
    expect(defs).toEqual(['platform/navigation/core/routeValidationModel.ts']);
    /* Gerekçe modeli anahtarı İTHAL eder, yeniden inşa ETMEZ. */
    expect(readSrc(MODEL)).toContain("import { routeRankKey }");
    expect(strip(readSrc(MODEL))).not.toContain('validation.failCount,\n');
  });

  it('R3 — gerekçe ÜRETİM KARARINA geri beslenmez (yalnız `_noteRationale` içinde)', () => {
    const src = strip(readSrc(ROUTING));
    for (const fn of ['buildRouteRationale(', 'buildSingleCandidateRationale(', 'asUserSelectedRationale(']) {
      const uses = src.split(fn).length - 1;
      expect(uses, `${fn} kullanımı yok — kilit körelmiş olabilir`).toBeGreaterThan(0);
      /* Her kullanım `_noteRationale(() => ...` kapanışının içindedir. */
      const guarded = src.split(new RegExp(`_noteRationale\\(\\(\\) =>[^;]*${fn.replace('(', '\\(')}`)).length - 1;
      expect(guarded, `${fn} kayıt sarmalayıcısının DIŞINDA kullanılmış`).toBe(uses);
    }
    /* Karar hâlâ `pickBestRoute`un: gerekçe hiçbir koşulda okunmaz. */
    expect(src).not.toMatch(/if\s*\([^)]*decidingFactor/);
    expect(src).not.toMatch(/if\s*\([^)]*durationPenalty/);
  });

  it('R4 — `routingService` gerekçe için YENİ timer/abonelik kurmadı', () => {
    const src = strip(readSrc(ROUTING));
    /* Gerekçe bloklarının çevresinde zamanlayıcı YOK: kayıt senkron ve tek satır. */
    expect(src).not.toMatch(/setTimeout\([^)]*Rationale/);
    expect(src).not.toMatch(/setInterval\([^)]*Rationale/);
  });

  it('R5 — gerekçe modeli koordinat/hedef alanı TAŞIMAZ (gizlilik)', () => {
    const src = strip(readSrc(MODEL));
    for (const bad of ['snappedLat', 'destLat', 'destLon', 'originLat', 'originLon', 'toName', 'address']) {
      expect(src, `${MODEL}: gizlilik ihlali "${bad}"`).not.toContain(bad);
    }
  });

  it('R6 — LAB yeni EKRAN açmadı: `rr-*` alanları mevcut Doğrulama kartında', () => {
    const src = readSrc('platform/devtools/navigationCoreModel.ts');
    for (const id of ["'rr-why'", "'rr-cands'", "'rr-penalty'", "'rr-ledger'"]) {
      expect(src, `LAB alanı eksik: ${id}`).toContain(id);
    }
    /* Alanlar `vFields` (Doğrulama kartı) dizisine yazılır — yeni kart YOK. */
    const block = src.slice(src.indexOf("const _ra = s.routeRationale"), src.indexOf("cards.push({ id: 'validation'"));
    expect(block).toContain('vFields.push(');
    expect(block).not.toContain('cards.push(');
  });

  it('R7 — üretim otoritesi DEĞİŞMEDİ: seçici hâlâ `pickBestRoute`', () => {
    const src = strip(readSrc(ROUTING));
    expect(src).toContain('const picked = pickBestRoute(cands);');
    /* Aktif rota seçilen ADAYDAN kurulur — gerekçeden DEĞİL. */
    expect(src).toContain('picked.candidate.geometry');
  });

  it('R8 — LAB salt-okunur: gerekçe kartı defteri KİRLETMEZ', () => {
    const src = strip(readSrc('platform/devtools/navigationCoreSources.ts'));
    expect(src).toContain('getRouteRationaleLedger()');
    expect(src, 'LAB kaynağı deftere YAZIYOR').not.toContain('recordRouteRationale');
  });
});
