/**
 * mapDataContractsF0.test.ts — MAP DATA PLATFORM · F0 SÖZLEŞME + MİMARİ KİLİTLERİ.
 *
 * Bu dosya F0'ın çıkış kapısıdır:
 *  1) Lisans kapısı FAIL-CLOSED (`UNKNOWN` hak = RED).
 *  2) Çözüm sabit öncelik listesi DEĞİL — taze/mutabık kaynak "yüksek yetkili"
 *     bayat kaynağı yenebiliyor.
 *  3) Lisanssız gözlem düşük puanlanmıyor, ELENİYOR.
 *  4) Uygun gözlem yoksa alan `UNKNOWN` — uydurma değer üretilmiyor.
 *  5) `mapdata/**` SAF: I/O · timer · ağ · React · `Date.now` YOK.
 *  6) İKİNCİ KANIT SİSTEMİ YOK — `EvidenceGrade` yalnız `navEvidence`ten gelir.
 *  7) `mapdata` L1 ve üstünü import ETMİYOR (otorite yönü aşağıdan yukarı).
 *
 * SAHA DOĞRULAMASI: bu testin yeşili F0'ı "tamam" YAPMAZ — yalnız sözleşme
 * omurgasının kurulduğunu gösterir. Gerçek veri ölçümü F1'in işidir.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  MAP_DATA_SOURCE_IDS, MAP_FEATURE_KINDS, FIELDS_BY_KIND, fieldAppliesToKind,
  unknownRelease, isReleaseIdentified,
} from '../platform/mapdata/mapDataSource';
import {
  MAP_LICENSE_REGISTRY, licensePolicyFor, unknownLicensePolicy,
  evaluateLicenseGate, evaluateFusionLicenseGate, requiresOsmShareAlike,
} from '../platform/mapdata/mapDataLicense';
import type {
  CandidateMapFeature, MapSourceObservation,
} from '../platform/mapdata/mapDataObservation';
import {
  classifyFreshness, computeAttributeCompleteness, isValidGeometry,
  isValidCandidate, observationsWithField, SOURCE_FRESHNESS_BUDGET_MS,
} from '../platform/mapdata/mapDataObservation';
import {
  resolveField, resolveCandidate, isPublishable, authorityPrior,
  DEFAULT_RESOLUTION_WEIGHTS, NEUTRAL_AUTHORITY_PRIOR,
} from '../platform/mapdata/mapDataResolution';
import { EVIDENCE_GRADES } from '../platform/navigation/contracts/navEvidence';

const MAPDATA_DIR = resolve(__dirname, '../platform/mapdata');

/* ── Test kurucuları ──────────────────────────────────────────────────────── */

const NOW = 1_757_000_000_000; // sabit epoch — testte saat okunmaz
const DAY = 24 * 60 * 60 * 1000;

function obs(init: {
  sourceId: MapSourceObservation['provenance']['sourceId'];
  id: string;
  name?: string | null;
  ageDays?: number;
  freshness?: MapSourceObservation['freshness']['classification'];
  accuracyM?: number | null;
  geometry?: MapSourceObservation['geometry'];
  recordLicenses?: readonly string[];
}): MapSourceObservation {
  const budget = SOURCE_FRESHNESS_BUDGET_MS[init.sourceId];
  const observedAt = init.ageDays === undefined ? null : NOW - init.ageDays * DAY;
  const freshness = init.freshness
    ? { classification: init.freshness, ageMs: null, budgetMs: null }
    : classifyFreshness(observedAt, NOW, budget);
  return {
    kind: 'ROAD',
    provenance: {
      sourceId: init.sourceId,
      sourceFeatureId: init.id,
      release: unknownRelease(init.sourceId),
      recordUpdatedAtEpochMs: observedAt,
      upstreamDatasets: [],
      recordLicenses: init.recordLicenses ?? [],
    },
    geometry: init.geometry ?? {
      type: 'LINESTRING',
      coordinates: [[34.8621, 36.9175], [34.8631, 36.9185]],
    },
    fields: init.name === undefined ? {} : { name: init.name },
    quality: {
      positionalAccuracyM: init.accuracyM ?? null,
      vertexCount: 2,
      attributeCompleteness: null,
      sourceVerified: null,
      sourceConfidence: null,
    },
    freshness,
    grade: 'OBSERVED',
  };
}

function candidate(observations: MapSourceObservation[]): CandidateMapFeature {
  return { kind: 'ROAD', entityKey: 'road:tarsus:test', observations };
}

/* ══════════════════════════════════════════════════════════════════════════
   1) LİSANS KAPISI — FAIL-CLOSED
   ══════════════════════════════════════════════════════════════════════════ */

describe('MAPDATA-F0 · lisans güvenlik duvarı', () => {
  it('UNKNOWN hak = RED (fail-closed) — "muhtemelen serbest" YOK', () => {
    const policy = unknownLicensePolicy('MUNICIPALITY');
    for (const intent of ['ONLINE_RUNTIME', 'OFFLINE_PACKAGING', 'DERIVED_REDISTRIBUTION'] as const) {
      const r = evaluateLicenseGate(policy, intent);
      expect(r.verdict).toBe('DENY');
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it('politika YOKSA da RED — eksik kayıt izin anlamına gelmez', () => {
    expect(evaluateLicenseGate(null, 'ONLINE_RUNTIME').verdict).toBe('DENY');
    expect(evaluateLicenseGate(undefined, 'OFFLINE_PACKAGING').verdict).toBe('DENY');
  });

  it('TUCBS · MUNICIPALITY · LICENSED_PROVIDER bilerek UNKNOWN kalır', () => {
    for (const id of ['TUCBS', 'MUNICIPALITY', 'LICENSED_PROVIDER'] as const) {
      expect(MAP_LICENSE_REGISTRY[id].license).toBe('UNKNOWN');
      expect(evaluateLicenseGate(licensePolicyFor(id), 'OFFLINE_PACKAGING').verdict).toBe('DENY');
    }
  });

  it('OSM offline paketlemede atıf ZORUNLU olarak geçer', () => {
    const r = evaluateLicenseGate(licensePolicyFor('OSM'), 'OFFLINE_PACKAGING');
    expect(r.verdict).toBe('ALLOW_WITH_ATTRIBUTION');
    expect(r.requiredAttribution).toContain('OpenStreetMap');
    expect(r.shareAlikeObligation).toBe(true);
  });

  it('OpenFreeMap: çevrimiçi tüketim GEÇER, offline paketleme REDDEDİLİR', () => {
    expect(evaluateLicenseGate(licensePolicyFor('OPENFREEMAP'), 'ONLINE_RUNTIME').verdict)
      .toBe('ALLOW_WITH_ATTRIBUTION');
    expect(evaluateLicenseGate(licensePolicyFor('OPENFREEMAP'), 'OFFLINE_PACKAGING').verdict)
      .toBe('DENY');
  });

  it('DERIVED tek başına hiçbir kapıdan geçemez — hak üretmez', () => {
    expect(evaluateLicenseGate(licensePolicyFor('DERIVED'), 'ONLINE_RUNTIME').verdict).toBe('DENY');
    expect(evaluateFusionLicenseGate([], 'ONLINE_RUNTIME').verdict).toBe('DENY');
  });

  it('fusion kapısı: tek kaynak RED alırsa TÜM çıktı reddedilir', () => {
    const ok = evaluateFusionLicenseGate(['OSM', 'OVERTURE'], 'OFFLINE_PACKAGING');
    expect(ok.verdict).toBe('ALLOW_WITH_ATTRIBUTION');
    expect(ok.shareAlikeObligation).toBe(true); // OSM share-alike taşınır
    expect(ok.requiredAttribution).toContain('Overture');

    const blocked = evaluateFusionLicenseGate(['OSM', 'MUNICIPALITY'], 'OFFLINE_PACKAGING');
    expect(blocked.verdict).toBe('DENY');
  });

  it('Overture kaydı OSM kökenliyse ODbL yükümlülüğü SÜRER', () => {
    expect(requiresOsmShareAlike(['OpenStreetMap'])).toBe(true);
    expect(requiresOsmShareAlike(['Microsoft ML Buildings'])).toBe(false);
    expect(requiresOsmShareAlike(null)).toBe(false);
  });

  it('MEASUREMENT_ONLY hak gerektirmez ama atıfı yine bildirir', () => {
    const r = evaluateLicenseGate(licensePolicyFor('OPENFREEMAP'), 'MEASUREMENT_ONLY');
    expect(r.verdict).toBe('ALLOW_WITH_ATTRIBUTION');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) TAZELİK — "bilmemek" taze SAYILMAZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('MAPDATA-F0 · tazelik', () => {
  it('damga veya bütçe yoksa UNKNOWN — taze varsayılmaz', () => {
    expect(classifyFreshness(null, NOW, DAY).classification).toBe('UNKNOWN');
    expect(classifyFreshness(NOW - DAY, NOW, null).classification).toBe('UNKNOWN');
  });

  it('gelecek tarihli damga taze SAYILMAZ', () => {
    expect(classifyFreshness(NOW + DAY, NOW, 7 * DAY).classification).toBe('UNKNOWN');
  });

  it('bütçe eşiklerini sınıflandırır', () => {
    const budget = 10 * DAY;
    expect(classifyFreshness(NOW - 2 * DAY, NOW, budget).classification).toBe('FRESH');
    expect(classifyFreshness(NOW - 7 * DAY, NOW, budget).classification).toBe('AGING');
    expect(classifyFreshness(NOW - 30 * DAY, NOW, budget).classification).toBe('STALE');
  });

  it('bütçesi kanıtlanmamış kaynaklarda bütçe null — uydurma eşik YOK', () => {
    expect(SOURCE_FRESHNESS_BUDGET_MS.TUCBS).toBeNull();
    expect(SOURCE_FRESHNESS_BUDGET_MS.MUNICIPALITY).toBeNull();
    expect(SOURCE_FRESHNESS_BUDGET_MS.LICENSED_PROVIDER).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) GÖZLEM SÖZLEŞMESİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('MAPDATA-F0 · gözlem ve aday', () => {
  it('geçersiz geometri reddedilir', () => {
    expect(isValidGeometry({ type: 'POINT', coordinates: [200, 0] })).toBe(false);
    expect(isValidGeometry({ type: 'LINESTRING', coordinates: [[34.8, 36.9]] })).toBe(false);
    expect(isValidGeometry({ type: 'POLYGON', rings: [] })).toBe(false);
    expect(isValidGeometry({ type: 'POINT', coordinates: [34.8621, 36.9175] })).toBe(true);
  });

  it('gözlemsiz veya tür karışımlı aday reddedilir', () => {
    expect(isValidCandidate({ kind: 'ROAD', entityKey: 'k', observations: [] })).toBe(false);
    const mixed = candidate([obs({ sourceId: 'OSM', id: 'way/1' })]);
    const broken = { ...mixed, observations: [{ ...mixed.observations[0], kind: 'BUILDING' as const }] };
    expect(isValidCandidate(broken)).toBe(false);
    expect(isValidCandidate(mixed)).toBe(true);
  });

  it('alan taşımayan gözlem o alanın adayı SAYILMAZ', () => {
    const c = candidate([
      obs({ sourceId: 'OSM', id: 'way/1', name: null }),
      obs({ sourceId: 'OVERTURE', id: 'gers/1', name: '0469. Sokak' }),
    ]);
    expect(observationsWithField(c, 'name').length).toBe(1);
  });

  it('doluluk yalnız TÜRE UYGUN alanlar üzerinden hesaplanır', () => {
    // Yol için `housenumber` beklenmez → paydaya girmez.
    const v = computeAttributeCompleteness('ROAD', { name: 'X' }, ['name', 'housenumber']);
    expect(v).toBe(1);
    expect(fieldAppliesToKind('ROAD', 'housenumber')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) ÇÖZÜM — SABİT ÖNCELİK LİSTESİ DEĞİL
   ══════════════════════════════════════════════════════════════════════════ */

describe('MAPDATA-F0 · alan çözümü', () => {
  const intent = 'MEASUREMENT_ONLY' as const;

  it('taze + mutabık OSM adı, BAYAT yüksek-yetkili belediye adını YENEBİLİR', () => {
    // Belediye ROAD:name önselinde 0.95 (en yüksek) — ama bayat ve yalnız.
    const c = candidate([
      obs({ sourceId: 'MUNICIPALITY', id: 'muni/1', name: 'Eski Ad', freshness: 'STALE' }),
      obs({ sourceId: 'OSM', id: 'way/1', name: 'Kocatepe Caddesi', ageDays: 1 }),
      obs({ sourceId: 'OVERTURE', id: 'gers/1', name: 'Kocatepe Caddesi', ageDays: 3 }),
    ]);
    const r = resolveField<string>(c, 'name', { intent });
    expect(r.value).toBe('Kocatepe Caddesi');
    expect(r.agreementCount).toBe(2);
    expect(r.sourceId === 'OSM' || r.sourceId === 'OVERTURE').toBe(true);
  });

  it('yetki önseli TEK BAŞINA belirleyici değil (ağırlığı 1/4)', () => {
    expect(DEFAULT_RESOLUTION_WEIGHTS.authority).toBeLessThanOrEqual(0.25);
    expect(
      DEFAULT_RESOLUTION_WEIGHTS.freshness + DEFAULT_RESOLUTION_WEIGHTS.agreement
      + DEFAULT_RESOLUTION_WEIGHTS.quality + DEFAULT_RESOLUTION_WEIGHTS.authority,
    ).toBeCloseTo(1, 6);
    // Tanımsız (kanıtsız) kaynak nötr-altı önsel alır.
    expect(authorityPrior('ROAD', 'name', 'FIELD_OBSERVATION')).toBe(NEUTRAL_AUTHORITY_PRIOR);
  });

  it('lisanssız gözlem DÜŞÜK PUANLANMAZ, ELENİR', () => {
    const c = candidate([
      obs({ sourceId: 'MUNICIPALITY', id: 'muni/1', name: 'Belediye Adı', ageDays: 0 }),
    ]);
    // Ölçüm niyetinde hak gerekmez → geçer.
    expect(resolveField<string>(c, 'name', { intent: 'MEASUREMENT_ONLY' }).value).toBe('Belediye Adı');
    // Offline paketlemede lisans bilinmiyor → alan UNKNOWN, değer TAŞINMAZ.
    const packaged = resolveField<string>(c, 'name', { intent: 'OFFLINE_PACKAGING' });
    expect(packaged.value).toBeNull();
    expect(packaged.unknownReason).toBe('LICENSE_BLOCKED');
  });

  it('kaynak yoksa UNKNOWN — uydurma değer YOK', () => {
    const c = candidate([obs({ sourceId: 'OSM', id: 'way/1' })]);
    const r = resolveField<string>(c, 'name', { intent });
    expect(r.value).toBeNull();
    expect(r.unknownReason).toBe('NO_OBSERVATION');
    expect(r.grade).toBe('UNAVAILABLE');
    expect(r.confidence).toBe(0);
  });

  it('türe uygun olmayan alan çözüme GİRMEZ', () => {
    const c = candidate([obs({ sourceId: 'OSM', id: 'way/1' })]);
    expect(resolveField(c, 'housenumber', { intent }).unknownReason).toBe('FIELD_NOT_APPLICABLE');
  });

  it('çelişkili yakın puanlar "contested" işaretlenir ve güven 0.5 ile sınırlanır', () => {
    const c = candidate([
      obs({ sourceId: 'OSM', id: 'way/1', name: 'A Sokak', ageDays: 1 }),
      obs({ sourceId: 'OVERTURE', id: 'gers/1', name: 'B Sokak', ageDays: 1 }),
    ]);
    const r = resolveField<string>(c, 'name', { intent });
    expect(r.contested).toBe(true);
    expect(r.confidence).toBeLessThanOrEqual(0.5);
  });

  it('çözüm DETERMİNİSTİK — aynı girdi aynı çıktı', () => {
    const build = (): CandidateMapFeature => candidate([
      obs({ sourceId: 'OVERTURE', id: 'gers/1', name: 'X', ageDays: 2 }),
      obs({ sourceId: 'OSM', id: 'way/1', name: 'Y', ageDays: 2 }),
    ]);
    const a = resolveField<string>(build(), 'name', { intent });
    const b = resolveField<string>(build(), 'name', { intent });
    expect(a.value).toBe(b.value);
    expect(a.sourceId).toBe(b.sourceId);
    expect(a.scores.map((s) => s.sourceId)).toEqual(b.scores.map((s) => s.sourceId));
  });

  it('her sonuç açıklanabilir — puan dökümü taşınır', () => {
    const c = candidate([
      obs({ sourceId: 'OSM', id: 'way/1', name: 'Y', ageDays: 2, accuracyM: 5 }),
      obs({ sourceId: 'OVERTURE', id: 'gers/1', name: 'Y', ageDays: 2 }),
    ]);
    const r = resolveField<string>(c, 'name', { intent });
    expect(r.scores.length).toBe(2);
    for (const s of r.scores) {
      expect(s.total).toBeGreaterThan(0);
      expect(s.total).toBeLessThanOrEqual(1);
    }
  });
});

describe('MAPDATA-F0 · nesne çözümü', () => {
  it('lisans REDDİ alan canonical nesne yayımlanamaz', () => {
    const c: CandidateMapFeature = {
      kind: 'ROAD',
      entityKey: 'k',
      observations: [obs({ sourceId: 'MUNICIPALITY', id: 'muni/1', name: 'X', ageDays: 1 })],
    };
    const packaged = resolveCandidate(c, { intent: 'OFFLINE_PACKAGING' });
    expect(packaged.degraded).toBe(true);
    expect(isPublishable(packaged)).toBe(false);
  });

  it('çözülen nesne katkı veren kaynakları ve atıf yükümlülüğünü taşır', () => {
    const c = candidate([
      obs({ sourceId: 'OSM', id: 'way/1', name: 'Gazipaşa Bulvarı', ageDays: 1 }),
    ]);
    const f = resolveCandidate(c, { intent: 'OFFLINE_PACKAGING' });
    expect(f.contributingSources).toContain('OSM');
    expect(f.license.requiredAttribution).toContain('OpenStreetMap');
    expect(isPublishable(f)).toBe(true);
  });

  it('her tür için alan listesi tanımlı ve boş değil', () => {
    for (const kind of MAP_FEATURE_KINDS) {
      expect(FIELDS_BY_KIND[kind].length).toBeGreaterThan(0);
      expect(FIELDS_BY_KIND[kind]).toContain('geometry');
    }
  });

  it('sürüm kimliği yoksa "tanımlı" sayılmaz', () => {
    expect(isReleaseIdentified(unknownRelease('OVERTURE'))).toBe(false);
    expect(isReleaseIdentified({ ...unknownRelease('OVERTURE'), releaseId: '2026-08-19.0' })).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) MİMARİ KİLİTLERİ — saflık · tek kanıt sistemi · otorite yönü
   ══════════════════════════════════════════════════════════════════════════ */

function mapdataSources(): { file: string; text: string }[] {
  return readdirSync(MAPDATA_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ file: f, text: readFileSync(resolve(MAPDATA_DIR, f), 'utf8') }));
}

describe('MAPDATA-F0 · mimari kilitleri', () => {
  it('kilit gerçekten dosya tarıyor (kör guard değil)', () => {
    const files = mapdataSources();
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files.map((f) => f.file)).toContain('mapDataResolution.ts');
  });

  it('mapdata/** SAF: I/O · timer · ağ · React · saat YOK', () => {
    const forbidden = [
      /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bsetTimeout\s*\(/, /\bsetInterval\s*\(/,
      /\bDate\.now\s*\(/, /\bperformance\.now\s*\(/, /\bnew Date\s*\(/, /\bMath\.random\s*\(/,
      /from\s+'react'/, /from\s+"react"/, /from\s+'node:fs'/, /localStorage/, /indexedDB/,
    ];
    for (const { file, text } of mapdataSources()) {
      // Yorum satırlarını çıkar — kural metni kuralın kendisini düşürmesin.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const re of forbidden) {
        expect(`${file}:${re.source}:${re.test(code)}`).toBe(`${file}:${re.source}:false`);
      }
    }
  });

  it('İKİNCİ KANIT SİSTEMİ YOK — EvidenceGrade yeniden tanımlanmıyor', () => {
    for (const { file, text } of mapdataSources()) {
      const redefines = /(export\s+)?type\s+EvidenceGrade\s*=/.test(text);
      expect(`${file}:${redefines}`).toBe(`${file}:false`);
    }
    // Sözlük tek otoritede ve dört değerli kalıyor.
    expect(EVIDENCE_GRADES).toEqual(['OBSERVED', 'DERIVED', 'UNAVAILABLE', 'STALE']);
  });

  it('otorite yönü: mapdata L1 store · rota · UI · servis import ETMİYOR', () => {
    const illegal = [
      /from\s+'[^']*navigation\/map\/store/,
      /from\s+'[^']*routingService/,
      /from\s+'[^']*mapSourceManager/,
      /from\s+'[^']*mapStyleBuilders/,
      /from\s+'[^']*\/components\//,
      /from\s+'[^']*\/store\//,
      /from\s+'[^']*maplibre/,
    ];
    for (const { file, text } of mapdataSources()) {
      for (const re of illegal) {
        expect(`${file}:${re.source}:${re.test(text)}`).toBe(`${file}:${re.source}:false`);
      }
    }
  });

  it('kaynak sözlüğü ile lisans kaydı BİREBİR örtüşür — kayıtsız kaynak YOK', () => {
    for (const id of MAP_DATA_SOURCE_IDS) {
      expect(MAP_LICENSE_REGISTRY[id]).toBeDefined();
      expect(MAP_LICENSE_REGISTRY[id].sourceId).toBe(id);
      expect(SOURCE_FRESHNESS_BUDGET_MS[id]).toBeDefined();
    }
    expect(Object.keys(MAP_LICENSE_REGISTRY).length).toBe(MAP_DATA_SOURCE_IDS.length);
  });
});
