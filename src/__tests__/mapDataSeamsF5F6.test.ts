/**
 * mapDataSeamsF5F6.test.ts — MAP DATA PLATFORM · F5/F6 DİKİŞ KİLİTLERİ.
 *
 * Bu iki faz **sözleşme fazıdır**: çalışan bir adres index'i veya bağlı bir
 * trafik sağlayıcısı YOKTUR ve bu testler tam olarak bunu kilitler.
 *
 * Kilitlenen davranışlar:
 *  1) Sağlayıcı yokken sonuç `UNAVAILABLE` — boş liste "sonuç yok" DEĞİL.
 *  2) Adres bileşenleri ayrı ayrı bilinmez olabilir; eksik bileşen
 *     UYDURULMAZ ve tek bir `formatted` string'e ÇÖKÜRÜLMEZ.
 *  3) Konumsuz adres rotalanabilir SAYILMAZ.
 *  4) BAYAT canlı veri `STALE` değil `UNAVAILABLE`dır — yanlış karar
 *     ürettirmemesi için karar dışı bırakılır.
 *  5) Canlı koşul statik gerçeği DEĞİŞTİREMEZ (mimari kapı).
 *  6) `mapdata` içinde ikinci bir arama/trafik OTORİTESİ kurulmadı.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

import type { CanonicalAddress } from '../platform/mapdata/indexes/addressPlaceIndex';
import {
  NULL_ADDRESS_INDEX, NULL_PLACE_INDEX, unavailableIndexResult,
  isMeaningfulAddressQuery, isMeaningfulPlaceQuery, isRoutableAddress, formatAddress,
} from '../platform/mapdata/indexes/addressPlaceIndex';
import type { LiveRoadObservation } from '../platform/mapdata/live/liveRoadConditions';
import {
  NULL_LIVE_ROAD_CONDITIONS, LIVE_FRESHNESS_BUDGET_MS, LIVE_CONDITION_KINDS,
  gradeLiveObservation, isMeaningfulLiveQuery, usableLiveEvidence,
  canLiveConditionMutateStaticTruth,
} from '../platform/mapdata/live/liveRoadConditions';
import { unknownRelease } from '../platform/mapdata/mapDataSource';

const NOW = 1_788_998_400_000;

function address(partial: Partial<CanonicalAddress>): CanonicalAddress {
  return {
    id: 'a1', housenumber: null, street: null, neighbourhood: null,
    district: null, city: null, postcode: null, position: null,
    sourceId: 'OSM', release: unknownRelease('OSM'), ...partial,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   1) F5 — ADRES / PLACE DİKİŞİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('MAPDATA-F5 · adres/place index dikişi', () => {
  it('bağlı sağlayıcı YOK — bu ölçülmüş gerçeğin beyanıdır', async () => {
    expect(NULL_ADDRESS_INDEX.providerId).toBeNull();
    expect(NULL_PLACE_INDEX.providerId).toBeNull();
  });

  it('sonuç boş DEĞİL, UNAVAILABLE — "sonuç yok" ile "cevap yok" karışmaz', async () => {
    const r = await NULL_ADDRESS_INDEX.lookup({ text: 'Gazipaşa Bulvarı 17' }, 'ONLINE_RUNTIME');
    expect(r.grade).toBe('UNAVAILABLE');
    expect(r.unavailableReason).toBe('NO_PROVIDER');
    expect(r.items).toEqual([]);

    const rev = await NULL_ADDRESS_INDEX.reverse([34.8621, 36.9175], 'ONLINE_RUNTIME');
    expect(rev.grade).toBe('UNAVAILABLE');

    const p = await NULL_PLACE_INDEX.search({ text: 'eczane' }, 'ONLINE_RUNTIME');
    expect(p.grade).toBe('UNAVAILABLE');
    expect(p.unavailableReason).toBe('NO_PROVIDER');
  });

  it('UNAVAILABLE sonuçta lisans kapısı da REDDEDER (kaynaksız hak yok)', () => {
    const r = unavailableIndexResult('NO_COVERAGE', 'OFFLINE_PACKAGING');
    expect(r.license.verdict).toBe('DENY');
    expect(r.contributingSources).toEqual([]);
  });

  it('boş sorgu sağlayıcıya GİTMEZ', () => {
    expect(isMeaningfulAddressQuery({})).toBe(false);
    expect(isMeaningfulAddressQuery({ text: '   ' })).toBe(false);
    expect(isMeaningfulAddressQuery({ street: 'Kocatepe Caddesi' })).toBe(true);
    expect(isMeaningfulAddressQuery({ near: [34.86, 36.91] })).toBe(true);
    expect(isMeaningfulPlaceQuery({})).toBe(false);
    expect(isMeaningfulPlaceQuery({ category: 'fuel' })).toBe(true);
  });

  it('konumsuz adres ROTALANABİLİR sayılmaz', () => {
    expect(isRoutableAddress(address({ street: 'X', housenumber: '17' }))).toBe(false);
    expect(isRoutableAddress(address({ position: [34.8621, 36.9175] }))).toBe(true);
    expect(isRoutableAddress(null)).toBe(false);
  });

  it('eksik adres bileşeni UYDURULMAZ; hiç bileşen yoksa null', () => {
    expect(formatAddress(address({}))).toBeNull();
    expect(formatAddress(address({ street: 'Kocatepe Caddesi', housenumber: '17' })))
      .toBe('Kocatepe Caddesi No:17');
    // Sokak yoksa numara TEK BAŞINA "No:17" gibi yanıltıcı basılmaz —
    // yalnız var olan bileşenler birleşir.
    expect(formatAddress(address({ city: 'Tarsus' }))).toBe('Tarsus');
    expect(formatAddress(null)).toBeNull();
  });

  it('adres kaydı bileşenlerini AYRI taşır — tek `formatted` string YOK', () => {
    const a = address({ street: 'X', housenumber: '1' });
    expect(Object.keys(a)).toContain('housenumber');
    expect(Object.keys(a)).toContain('street');
    expect(Object.keys(a)).not.toContain('formatted');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) F6 — CANLI YOL KOŞULU DİKİŞİ
   ══════════════════════════════════════════════════════════════════════════ */

function liveObs(partial: Partial<LiveRoadObservation>): LiveRoadObservation {
  return {
    kind: 'TRAFFIC_SPEED', providerId: 'LICENSED_PROVIDER', providerRef: 'tmc/1',
    position: [34.8621, 36.9175], value: 32, observedAtEpochMs: NOW,
    providerConfidence: null, ...partial,
  };
}

describe('MAPDATA-F6 · canlı yol koşulu dikişi', () => {
  it('bağlı sağlayıcı YOK ve navigasyon buna BAĞLI DEĞİL', async () => {
    expect(NULL_LIVE_ROAD_CONDITIONS.providerId).toBeNull();
    const r = await NULL_LIVE_ROAD_CONDITIONS.query(
      { corridor: [[34.86, 36.91]], bufferM: 50, kinds: ['TRAFFIC_SPEED'] }, NOW,
    );
    expect(r.grade).toBe('UNAVAILABLE');
    expect(r.unavailableReason).toBe('NO_PROVIDER');
    expect(r.evidence).toEqual([]);
  });

  it('TAZE canlı gözlem karar kalitesindedir', () => {
    const e = gradeLiveObservation(liveObs({ observedAtEpochMs: NOW - 30_000 }), NOW);
    expect(e.grade).toBe('OBSERVED');
    expect(e.freshness.classification).toBe('FRESH');
  });

  it('BAYAT canlı gözlem STALE değil UNAVAILABLE — yanlış karar ürettirmez', () => {
    const e = gradeLiveObservation(
      liveObs({ observedAtEpochMs: NOW - 20 * 60 * 1000 }), NOW,
    );
    expect(e.freshness.classification).toBe('STALE');
    expect(e.grade).toBe('UNAVAILABLE');
    expect(usableLiveEvidence({ evidence: [e], grade: 'OBSERVED', unavailableReason: null })).toEqual([]);
  });

  it('damgasız gözlem karar dışıdır — "şimdi" varsayılmaz', () => {
    const e = gradeLiveObservation(liveObs({ observedAtEpochMs: null }), NOW);
    expect(e.freshness.classification).toBe('UNKNOWN');
    expect(e.grade).toBe('UNAVAILABLE');
  });

  it('canlı tazelik bütçeleri DAKİKA mertebesinde — statik bütçelerle karışmaz', () => {
    for (const kind of LIVE_CONDITION_KINDS) {
      const budget = LIVE_FRESHNESS_BUDGET_MS[kind];
      expect(budget).toBeGreaterThan(0);
      // Hiçbir canlı bütçe bir GÜNÜ aşmaz (statik veri bütçeleri gün/hafta).
      expect(budget).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    }
    expect(LIVE_FRESHNESS_BUDGET_MS.TRAFFIC_SPEED)
      .toBeLessThan(LIVE_FRESHNESS_BUDGET_MS.ROAD_WORKS);
  });

  it('boş/geçersiz sorgu sağlayıcıya GİTMEZ (maliyet ve gizlilik)', () => {
    expect(isMeaningfulLiveQuery({ corridor: [], bufferM: 50, kinds: ['CLOSURE'] })).toBe(false);
    expect(isMeaningfulLiveQuery({ corridor: [[34.8, 36.9]], bufferM: 0, kinds: ['CLOSURE'] })).toBe(false);
    expect(isMeaningfulLiveQuery({ corridor: [[34.8, 36.9]], bufferM: 50, kinds: [] })).toBe(false);
    expect(isMeaningfulLiveQuery({ corridor: [[34.8, 36.9]], bufferM: 50, kinds: ['CLOSURE'] })).toBe(true);
  });

  it('🔒 CANLI KOŞUL STATİK GERÇEĞİ DEĞİŞTİREMEZ (mimari kapı)', () => {
    expect(canLiveConditionMutateStaticTruth()).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) MİMARİ — İKİNCİ OTORİTE KURULMADI
   ══════════════════════════════════════════════════════════════════════════ */

function walkTs(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (entry.endsWith('.ts')) out.push({ file: full, text: readFileSync(full, 'utf8') });
  }
  return out;
}

describe('MAPDATA-F5/F6 · otorite sınırı', () => {
  const files = walkTs(resolve(__dirname, '../platform/mapdata'));

  it('kilit dikiş dosyalarını gerçekten tarıyor', () => {
    expect(files.some((f) => f.file.includes('addressPlaceIndex'))).toBe(true);
    expect(files.some((f) => f.file.includes('liveRoadConditions'))).toBe(true);
  });

  it('mapdata mevcut arama/geokodlama zincirini İMPORT ETMİYOR (paralel sistem yok)', () => {
    const illegal = [
      /from\s+'[^']*geocodingService/, /from\s+'[^']*mapService/,
      /from\s+'[^']*offlineSearchService/, /from\s+'[^']*offlinePoiService/,
      /from\s+'[^']*searchChainModel/, /from\s+'[^']*trafficService/,
      /from\s+'[^']*routingService/,
    ];
    for (const { file, text } of files) {
      for (const re of illegal) {
        expect(`${file}:${re.source}:${re.test(text)}`).toBe(`${file}:${re.source}:false`);
      }
    }
  });

  it('dikiş dosyaları SAF kalır — ağ/timer/saat yok', () => {
    const seams = files.filter((f) => f.file.includes('addressPlaceIndex') || f.file.includes('liveRoadConditions'));
    expect(seams.length).toBe(2);
    for (const { file, text } of seams) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const re of [/\bfetch\s*\(/, /\bsetTimeout\s*\(/, /\bDate\.now\s*\(/, /\bnew Date\s*\(/]) {
        expect(`${file}:${re.source}:${re.test(code)}`).toBe(`${file}:${re.source}:false`);
      }
    }
  });
});
