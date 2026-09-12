/**
 * driverPresenceHistory.test.ts — VARLIK GEÇMİŞİ KİLİTLERİ.
 *
 * ── KİLİTLENEN ANA KURALLAR ────────────────────────────────────────────
 *  1. **Resolver DEĞİŞMEDİ** — geçmiş bir defterdir, karar katmanı değil.
 *  2. Aynı presence tekrar segment ÜRETMEZ (dedupe).
 *  3. Süresi dolan segment düzgün kapanır; **açık segmentte sahte süre YOK**.
 *  4. Kapanış anı bilinmiyorsa UYDURULMAZ.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  recordPresenceHistory, closePresenceHistory, summarizePresenceHistory,
  settlePresenceHistory, segmentStatus, segmentDurationMs, isOpenSegment,
  presenceSegmentKey, entrySegmentKey,
  presenceCloseReasonLabel, presenceSegmentStatusLabel,
  EMPTY_PRESENCE_HISTORY, PRESENCE_HISTORY_MAX_ENTRIES,
  PRESENCE_CLOSE_REASONS, PRESENCE_SEGMENT_STATUSES,
  type PresenceHistoryState,
} from '../platform/fleet/driverPresenceHistory';
import {
  normalizePresence, resolveDriverPresence, driverPresenceStore,
  readDriverPresenceHistory, UNKNOWN_PRESENCE, bindPresenceVehicle,
  type DriverPresence,
} from '../platform/fleet/driverPresence';

const NOW = Date.UTC(2026, 6, 30, 12, 0, 0);
const H = 3_600_000;

function p(over: Partial<DriverPresence> = {}): DriverPresence {
  return normalizePresence({
    source: 'NFC', confidence: 'VERY_HIGH',
    detectedAt: NOW, expiresAt: NOW + 8 * H,
    driverId: 'd-1', assignmentId: null,
    ...over,
  });
}

/** Defteri tek adımda kurar. */
function rec(
  state: PresenceHistoryState, presence: DriverPresence, nowMs: number,
  vehicleId: string | null = 'veh-1',
): PresenceHistoryState {
  return recordPresenceHistory(state, { presence, vehicleId, nowMs });
}

/* ══════════════════════════════════════════════════════════════════════ */

describe('PresenceHistory · A. Sözleşme', () => {
  it('A1. 🔒 kapanış gerekçesi ve segment durumu enumları tam', () => {
    expect(PRESENCE_CLOSE_REASONS).toEqual(['SUPERSEDED', 'TTL_EXPIRED', 'CLEARED']);
    expect(PRESENCE_SEGMENT_STATUSES).toEqual(
      ['OPEN', 'SUPERSEDED', 'TTL_EXPIRED', 'CLEARED']);
  });

  it('A2. 🔒 istenen ALTI alan + araç kimliği taşınır', () => {
    const s = rec(EMPTY_PRESENCE_HISTORY, p(), NOW);
    const e = s.entries[0];
    for (const k of ['driverId', 'source', 'confidence', 'detectedAt',
                     'expiredAt', 'durationMs', 'vehicleId']) {
      expect(Object.keys(e)).toContain(k);
    }
  });

  it('A3. 🔒 KİŞİSEL VERİ taşımaz', () => {
    const s = rec(EMPTY_PRESENCE_HISTORY, normalizePresence({
      source: 'NFC', driverId: 'd-1', detectedAt: NOW,
      displayName: 'Ahmet', phone: '+90555', licenseNumber: '123',
    }), NOW);
    const json = JSON.stringify(s);
    expect(json).not.toContain('Ahmet');
    expect(json).not.toContain('+90555');
    expect(Object.keys(s.entries[0])).not.toContain('displayName');
  });

  it('A4. 🔒 araç kimliği yoksa UYDURULMAZ', () => {
    const s = rec(EMPTY_PRESENCE_HISTORY, p(), NOW, null);
    expect(s.entries[0].vehicleId).toBeNull();
  });

  it('A5. 🔒 sürücüsüz/kaynaksız gözlem segment AÇMAZ', () => {
    expect(rec(EMPTY_PRESENCE_HISTORY, UNKNOWN_PRESENCE, NOW).entries).toHaveLength(0);
    expect(rec(EMPTY_PRESENCE_HISTORY,
      normalizePresence({ source: 'NFC', driverId: null }), NOW).entries).toHaveLength(0);
  });

  it('A6. 🔒 segment kimliği = (araç, sürücü, kaynak)', () => {
    expect(presenceSegmentKey('v', 'd', 'NFC')).toBe('v|d|NFC');
    const s = rec(EMPTY_PRESENCE_HISTORY, p(), NOW);
    expect(entrySegmentKey(s.entries[0])).toBe('veh-1|d-1|NFC');
  });
});

describe('PresenceHistory · B. Açık segment — SAHTE SÜRE YOK', () => {
  it('B1. 🔒 açık segmentin kapanışı ve süresi NULL (sahte 0 YASAK)', () => {
    const s = rec(EMPTY_PRESENCE_HISTORY, p(), NOW);
    const e = s.entries[0];
    expect(e.expiredAt).toBeNull();
    expect(e.durationMs).toBeNull();
    expect(e.closeReason).toBeNull();
    expect(e.durationMs).not.toBe(0);
    expect(isOpenSegment(e)).toBe(true);
  });

  it('B2. 🔒 açık segmentin "şimdiye kadarki" süresi hesaplanır', () => {
    const s = rec(EMPTY_PRESENCE_HISTORY, p(), NOW);
    expect(segmentDurationMs(s.entries[0], NOW + 2 * H)).toBe(2 * H);
  });

  it('B3. 🔒 saat GERİ giderse süre uydurulmaz', () => {
    const s = rec(EMPTY_PRESENCE_HISTORY, p(), NOW);
    expect(segmentDurationMs(s.entries[0], NOW - H)).toBeNull();
  });
});

describe('PresenceHistory · C. DEDUPE — aynı presence tekrar üretmez', () => {
  it('C1. 🔒 aynı sürücü+kaynak 10 kez okutulsa TEK segment kalır', () => {
    let s = EMPTY_PRESENCE_HISTORY;
    for (let i = 0; i < 10; i++) {
      s = rec(s, p({ detectedAt: NOW + i * 60_000 }), NOW + i * 60_000);
    }
    expect(s.entries).toHaveLength(1);
    expect(s.duplicateCount).toBe(9);
    expect(s.entries[0].refreshCount).toBe(9);
  });

  it('C2. 🔒 tazeleme segmentin süresini UZATIR, kısaltmaz', () => {
    let s = rec(EMPTY_PRESENCE_HISTORY, p({ expiresAt: NOW + 8 * H }), NOW);
    /* Geç gelen BAYAT gözlem segmenti kısaltamaz. */
    s = rec(s, p({ detectedAt: NOW + H, expiresAt: NOW + 2 * H }), NOW + H);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0].expiresAt).toBe(NOW + 8 * H);
  });

  it('C3. 🔒 tekrar gözlem EL DEĞİŞTİRME sayılmaz', () => {
    let s = rec(EMPTY_PRESENCE_HISTORY, p(), NOW);
    s = rec(s, p({ detectedAt: NOW + 60_000 }), NOW + 60_000);
    expect(s.switchCount).toBe(0);
  });

  it('C4. 🔒 KAYNAK değişimi yeni segment açar (kart → telefon)', () => {
    let s = rec(EMPTY_PRESENCE_HISTORY, p(), NOW);
    s = rec(s, p({ source: 'BLUETOOTH', detectedAt: NOW + H }), NOW + H);
    expect(s.entries).toHaveLength(2);
    /* Aynı KİŞİ olduğu için el değiştirme DEĞİLDİR. */
    expect(s.switchCount).toBe(0);
  });
});

describe('PresenceHistory · D. Devir ve el değiştirme', () => {
  it('D1. 🔒 farklı sürücü → önceki segment SUPERSEDED ile kapanır', () => {
    let s = rec(EMPTY_PRESENCE_HISTORY, p({ driverId: 'd-1' }), NOW);
    s = rec(s, p({ driverId: 'd-2', detectedAt: NOW + 2 * H }), NOW + 2 * H);
    const first = s.entries[0];
    expect(first.closeReason).toBe('SUPERSEDED');
    expect(first.expiredAt).toBe(NOW + 2 * H);
    expect(first.durationMs).toBe(2 * H);
    expect(s.switchCount).toBe(1);
  });

  it('D2. 🔒 devir anı önceki segmentin TTL\'ini AŞAMAZ', () => {
    /* Ölmüş bir segment "devredildi" sayılamaz — TTL'de biter. */
    let s = rec(EMPTY_PRESENCE_HISTORY, p({ expiresAt: NOW + H }), NOW);
    s = rec(s, p({ driverId: 'd-2', detectedAt: NOW + 5 * H }), NOW + 5 * H);
    const first = s.entries[0];
    expect(first.expiredAt).toBe(NOW + H);
    expect(first.closeReason).toBe('TTL_EXPIRED');
  });

  it('D3. 🔒 aynı anda birden fazla AÇIK segment olamaz', () => {
    let s = rec(EMPTY_PRESENCE_HISTORY, p({ driverId: 'd-1' }), NOW);
    s = rec(s, p({ driverId: 'd-2', detectedAt: NOW + H }), NOW + H);
    s = rec(s, p({ driverId: 'd-3', detectedAt: NOW + 2 * H }), NOW + 2 * H);
    expect(s.entries.filter(isOpenSegment)).toHaveLength(1);
    expect(s.switchCount).toBe(2);
  });
});

describe('PresenceHistory · E. TTL — süresi dolan presence kapatılır', () => {
  it('E1. 🔒 süresi dolan segment TTL_EXPIRED ile kapanır', () => {
    const s = settlePresenceHistory(
      rec(EMPTY_PRESENCE_HISTORY, p({ expiresAt: NOW + H }), NOW), NOW + 3 * H);
    const e = s.entries[0];
    expect(e.closeReason).toBe('TTL_EXPIRED');
    expect(e.expiredAt).toBe(NOW + H);
    expect(e.durationMs).toBe(H);
  });

  it('E2. 🔒 kapanış anı gözlemin TTL\'idir, OKUMA anı DEĞİL', () => {
    const s = settlePresenceHistory(
      rec(EMPTY_PRESENCE_HISTORY, p({ expiresAt: NOW + H }), NOW), NOW + 9 * H);
    expect(s.entries[0].expiredAt).not.toBe(NOW + 9 * H);
    expect(s.entries[0].expiredAt).toBe(NOW + H);
  });

  it('E3. 🔒 uzlaştırma İDEMPOTENT', () => {
    const once = settlePresenceHistory(
      rec(EMPTY_PRESENCE_HISTORY, p({ expiresAt: NOW + H }), NOW), NOW + 3 * H);
    expect(settlePresenceHistory(once, NOW + 5 * H)).toEqual(once);
  });

  it('E4. 🔒 süresi geçmiş segment OPEN GÖSTERİLMEZ', () => {
    const s = rec(EMPTY_PRESENCE_HISTORY, p({ expiresAt: NOW + H }), NOW);
    expect(segmentStatus(s.entries[0], NOW)).toBe('OPEN');
    expect(segmentStatus(s.entries[0], NOW + 2 * H)).toBe('TTL_EXPIRED');
  });

  it('E5. 🔒 süresi dolmuş segment "şu anki sürücü" SAYILMAZ', () => {
    const s = rec(EMPTY_PRESENCE_HISTORY, p({ expiresAt: NOW + H }), NOW);
    const sum = summarizePresenceHistory(s, NOW + 3 * H);
    expect(sum.current).toBeNull();
    expect(sum.previous).not.toBeNull();
    expect(sum.previousDurationMs).toBe(H);
  });
});

describe('PresenceHistory · F. Elle kapatma — UYDURMA ZAMAN YOK', () => {
  it('F1. 🔒 zaman verilirse CLEARED + süre hesaplanır', () => {
    const s = closePresenceHistory(
      rec(EMPTY_PRESENCE_HISTORY, p(), NOW), NOW + 2 * H);
    expect(s.entries[0].closeReason).toBe('CLEARED');
    expect(s.entries[0].durationMs).toBe(2 * H);
  });

  it('F2. 🔒 zaman VERİLMEZSE kapanış anı UYDURULMAZ', () => {
    const s = closePresenceHistory(rec(EMPTY_PRESENCE_HISTORY, p(), NOW), null);
    expect(s.entries[0].closeReason).toBe('CLEARED');
    expect(s.entries[0].expiredAt).toBeNull();
    expect(s.entries[0].durationMs).toBeNull();
  });

  it('F3. 🔒 kapanış başlangıçtan ÖNCE olamaz', () => {
    const s = closePresenceHistory(rec(EMPTY_PRESENCE_HISTORY, p(), NOW), NOW - 5 * H);
    expect(s.entries[0].expiredAt).toBe(NOW);
    expect(s.entries[0].durationMs).toBe(0);
  });
});

describe('PresenceHistory · G. Özet — current · previous · duration · switch', () => {
  it('G1. 🔒 dört istenen alan üretilir', () => {
    let s = rec(EMPTY_PRESENCE_HISTORY, p({ driverId: 'd-1' }), NOW);
    s = rec(s, p({ driverId: 'd-2', detectedAt: NOW + 2 * H }), NOW + 2 * H);
    const sum = summarizePresenceHistory(s, NOW + 3 * H);

    expect(sum.current?.driverId).toBe('d-2');
    expect(sum.previous?.driverId).toBe('d-1');
    expect(sum.currentDurationMs).toBe(H);
    expect(sum.switchCount).toBe(1);
  });

  it('G2. 🔒 boş defter sahte değer ÜRETMEZ', () => {
    const sum = summarizePresenceHistory(EMPTY_PRESENCE_HISTORY, NOW);
    expect(sum.current).toBeNull();
    expect(sum.previous).toBeNull();
    expect(sum.currentDurationMs).toBeNull();
    expect(sum.switchCount).toBe(0);
    expect(sum.segmentCount).toBe(0);
  });

  it('G3. 🔒 özet defteri DEĞİŞTİRMEZ (salt-okur)', () => {
    const s = rec(EMPTY_PRESENCE_HISTORY, p({ expiresAt: NOW + H }), NOW);
    const before = JSON.stringify(s);
    summarizePresenceHistory(s, NOW + 9 * H);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('G4. 🔒 defter YENİDEN ESKİYE sıralı sunulur', () => {
    let s = rec(EMPTY_PRESENCE_HISTORY, p({ driverId: 'd-1' }), NOW);
    s = rec(s, p({ driverId: 'd-2', detectedAt: NOW + H }), NOW + H);
    expect(summarizePresenceHistory(s, NOW + H).entries[0].driverId).toBe('d-2');
  });
});

describe('PresenceHistory · H. Bellek sınırı', () => {
  it('H1. 🔒 defter SINIRSIZ büyümez, düşen segment GÖRÜNÜR', () => {
    let s = EMPTY_PRESENCE_HISTORY;
    const n = PRESENCE_HISTORY_MAX_ENTRIES + 10;
    for (let i = 0; i < n; i++) {
      s = rec(s, p({ driverId: `d-${i}`, detectedAt: NOW + i * H }), NOW + i * H);
    }
    expect(s.entries.length).toBe(PRESENCE_HISTORY_MAX_ENTRIES);
    expect(s.droppedCount).toBe(10);
  });
});

describe('PresenceHistory · I. RESOLVER DEĞİŞMEDİ (en kritik kilit)', () => {
  const SRC = readFileSync(
    join(process.cwd(), 'src/platform/fleet/driverPresence.ts'), 'utf8');
  const HIST = readFileSync(
    join(process.cwd(), 'src/platform/fleet/driverPresenceHistory.ts'), 'utf8');

  it('I1. 🔒 resolver GEÇMİŞE BAKMAZ — girdisinde geçmiş yok', () => {
    const fn = SRC.slice(SRC.indexOf('export function resolveDriverPresence'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).not.toContain('istory');
    expect(body).not.toContain('_history');
    expect(body).not.toContain('segment');
  });

  it('I2. 🔒 resolver kararları AYNEN — yedi karar korunur', () => {
    const base = { assignmentDriverId: null, driverEligible: true, nowMs: NOW };
    expect(resolveDriverPresence({ ...base, presence: UNKNOWN_PRESENCE }).decision)
      .toBe('NO_PRESENCE');
    expect(resolveDriverPresence({ ...base, presence: p({ source: 'HEAD_UNIT' }) }).decision)
      .toBe('PRESENCE_UNUSABLE');
    expect(resolveDriverPresence({ ...base, presence: p({ expiresAt: NOW - 1 }) }).decision)
      .toBe('PRESENCE_UNUSABLE');
    expect(resolveDriverPresence({ ...base, presence: p(), driverEligible: false }).decision)
      .toBe('PRESENCE_UNUSABLE');
    expect(resolveDriverPresence({ ...base, presence: p(), assignmentDriverId: 'x' }).decision)
      .toBe('PRESENCE_CONFLICT');
    const confirmed = resolveDriverPresence({
      ...base, presence: p(), assignmentDriverId: 'd-1' });
    expect(confirmed.decision).toBe('PRESENCE_CONFIRMED');
    expect(confirmed.confidence).toBe('VERY_HIGH');
    const only = resolveDriverPresence({ ...base, presence: p() });
    expect(only.decision).toBe('PRESENCE_ONLY');
    expect(only.confidence).toBe('HIGH');
  });

  it('I3. 🔒 geçmiş defteri resolver SONUCUNU değiştirmez', () => {
    driverPresenceStore.clear(NOW);
    const before = resolveDriverPresence({
      presence: p(), assignmentDriverId: null, driverEligible: true, nowMs: NOW });
    for (let i = 0; i < 5; i++) {
      driverPresenceStore.record(
        { source: 'NFC', confidence: 'VERY_HIGH', driverId: `d-${i}`,
          detectedAt: NOW + i * H, vehicleId: 'veh-9' }, NOW + i * H);
    }
    const after = resolveDriverPresence({
      presence: p(), assignmentDriverId: null, driverEligible: true, nowMs: NOW });
    expect(after).toEqual(before);
    driverPresenceStore.clear(NOW);
  });

  it('I4. 🔒 geçmiş modülü SAF — Date.now / timer / abonelik YOK', () => {
    const code = HIST
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    expect(code).not.toContain('Date.now()');
    expect(code).not.toContain('performance.now()');
    expect(code).not.toContain('setInterval');
    expect(code).not.toContain('setTimeout');
    expect(code).not.toContain('addEventListener');
  });

  it('I5. 🔒 geçmiş modülü resolver\'dan yalnız TİP alır (çalışma zamanı bağı yok)', () => {
    expect(HIST).toContain("import type {");
    expect(HIST).not.toMatch(/^import \{[^}]*resolveDriverPresence/m);
  });
});

describe('PresenceHistory · J. Depo entegrasyonu', () => {
  it('J1. 🔒 record() defteri besler; LAB yalnız okur', () => {
    /* P2: artık DOĞRULANMIŞ araç bağı ZORUNLU — bağsız gözlem yazılamaz.
       Kilit kaldırılmadı, yeni doğru davranışa taşındı. */
    bindPresenceVehicle('veh-7', NOW);
    driverPresenceStore.clear(NOW);
    const before = readDriverPresenceHistory(NOW).segmentCount;
    driverPresenceStore.record(
      { source: 'NFC', confidence: 'VERY_HIGH', driverId: 'd-77',
        detectedAt: NOW, vehicleId: 'veh-7' }, NOW);
    const sum = readDriverPresenceHistory(NOW);
    expect(sum.current?.driverId).toBe('d-77');
    /* Araç kimliği BAĞDAN gelir (gözlemin iddiasından değil). */
    expect(sum.current?.vehicleId).toBe('veh-7');
    expect(sum.segmentCount).toBe(before + 1);
    driverPresenceStore.clear(NOW);
  });

  it('J2. 🔒 reddedilen gözlem deftere GİRMEZ', () => {
    driverPresenceStore.clear(NOW);
    const before = readDriverPresenceHistory(NOW).segmentCount;
    driverPresenceStore.record({ source: 'UYDURMA', driverId: 'x' }, NOW);
    expect(readDriverPresenceHistory(NOW).segmentCount).toBe(before);
  });

  it('J5. 🔒 clear() defteri SİLMEZ — oturum biter, kanıt kalır', () => {
    bindPresenceVehicle('veh-9', NOW);
    driverPresenceStore.clear(NOW);
    driverPresenceStore.record(
      { source: 'NFC', confidence: 'VERY_HIGH', driverId: 'd-91',
        detectedAt: NOW, vehicleId: 'veh-9' }, NOW);
    const before = readDriverPresenceHistory(NOW).segmentCount;
    driverPresenceStore.clear(NOW + H);
    /* Bir oturumun bitmesi geçmişi yok ETMEZ; yalnız açık segment kapanır. */
    expect(readDriverPresenceHistory(NOW + H).segmentCount).toBe(before);
    expect(readDriverPresenceHistory(NOW + H).current).toBeNull();
  });

  it('J3. 🔒 clear() açık segmenti CLEARED ile kapatır', () => {
    bindPresenceVehicle('veh-3', NOW);
    driverPresenceStore.clear(NOW);
    driverPresenceStore.record(
      { source: 'NFC', confidence: 'VERY_HIGH', driverId: 'd-8', detectedAt: NOW }, NOW);
    driverPresenceStore.clear(NOW + H);
    const sum = readDriverPresenceHistory(NOW + H);
    expect(sum.current).toBeNull();
    expect(sum.previous?.closeReason).toBe('CLEARED');
    expect(sum.previous?.durationMs).toBe(H);
    driverPresenceStore.clear(NOW + H);
  });

  it('J4. 🔒 clear() argümansız da ÇALIŞIR (eski çağrılar bozulmadı)', () => {
    expect(() => driverPresenceStore.clear()).not.toThrow();
  });
});

describe('PresenceHistory · K. LAB gözlem yüzeyi', () => {
  const SCREEN = readFileSync(
    join(process.cwd(), 'src/components/devtools/screens/FleetPresenceHistoryScreen.tsx'),
    'utf8');

  it('K1. 🔒 istenen dört alan gözlenir', () => {
    for (const f of ['currentDuration', 'previousDuration', 'switchCount',
                     'Current Presence', 'Previous Presence']) {
      expect(SCREEN).toContain(f);
    }
  });

  it('K2. 🔒 kişisel veri YOK — sürücü/araç referansı bounded', () => {
    expect(SCREEN).toContain('drv:');
    expect(SCREEN).toContain('veh:');
    expect(SCREEN).not.toMatch(/displayName|licenseNumber|\.phone/);
  });

  it('K3. 🔒 LAB gözlem ÜRETMEZ — yalnız okur', () => {
    expect(SCREEN).toContain('readDriverPresenceHistory');
    expect(SCREEN).not.toContain('driverPresenceStore');
    expect(SCREEN).not.toContain('.record(');
    expect(SCREEN).not.toContain('recordPresenceHistory');
    expect(SCREEN).not.toContain('closePresenceHistory');
  });

  it('K4. 🔒 timer/abonelik KURMAZ', () => {
    expect(SCREEN).not.toContain('setInterval');
    expect(SCREEN).not.toContain('setTimeout');
    expect(SCREEN).not.toContain('addEventListener');
  });

  it('K5. 🔒 katalogda kayıtlı ve ekran haritasına bağlı', async () => {
    const { CAROS_LAB_TOOLS } = await import('../platform/devtools/carosLabCatalog');
    const tool = CAROS_LAB_TOOLS.find((t) => t.id === 'fleet-presence-history');
    expect(tool).toBeDefined();
    expect(tool?.status).toBe('AVAILABLE');
    const map = readFileSync(
      join(process.cwd(), 'src/components/devtools/carosLabScreenMap.tsx'), 'utf8');
    expect(map).toContain("case 'fleet-presence-history'");
    /* Kimlik ekranı SİLİNMEDİ — iki ayrı soru, iki ayrı yüzey. */
    expect(map).toContain("case 'fleet-driver-identity'");
  });
});

describe('PresenceHistory · L. Sunucu sözleşmesi (migration 050)', () => {
  const M = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260730000050_driver_presence_history_p1.sql'),
    'utf8');

  it('L1. 🔒 049 resolver ve trigger YENİDEN TANIMLANMADI', () => {
    expect(M).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\._resolve_driver_presence/i);
    expect(M).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\._trip_attribution_trigger/i);
    expect(M).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\._resolve_trip_driver/i);
  });

  it('L2. 🔒 P0/P1 zinciri ÇAĞRILARAK doğrulanır', () => {
    expect(M).toContain('FROM public._resolve_driver_presence(');
    expect(M).toContain('presence resolver davranisi DEGISTI');
    expect(M).toContain('trigger P0 atama modelini artik cagirmiyor');
  });

  it('L3. 🔒 geçmiş defteri attribution kararına GİREMEZ', () => {
    expect(M).toContain('gecmis defteri attribution kararina girmis');
  });

  it('L4. 🔒 yarım kapanış yasak (sahte süre üretilemez)', () => {
    expect(M).toContain('vdph_close_consistent');
    expect(M).toContain('yarim kapanis kisiti yok');
  });

  it('L5. 🔒 dedupe ve tek açık segment kilitleri var', () => {
    expect(M).toContain('vdph_observation_unique');
    expect(M).toContain('vdph_single_open_per_vehicle');
  });

  it('L6. 🔒 doğrulanmamış kaynak sunucuda da KİMLİK SIZDIRMAZ', () => {
    expect(M).toContain('_presence_is_identity_verifying(h.source)');
    expect(M).toContain('okuma RPC si dogrulanmamis kaynakta kimlik sizdiriyor');
  });

  it('L7. 🔒 RLS + anon deny + defter ELLE değiştirilemez', () => {
    expect(M).toContain('ENABLE ROW LEVEL SECURITY');
    expect(M).toContain('REVOKE ALL ON TABLE public.vehicle_driver_presence_history FROM anon');
    expect(M).toContain('gecmis elle degistirilebiliyor');
  });

  it('L8. 🔒 yalnız ileri migration', () => {
    expect(M).not.toMatch(/DROP\s+TABLE\s+public\.(vehicle_trips|fleet_drivers|vehicle_driver_presence)\b/i);
    expect(M).toContain('CREATE TABLE IF NOT EXISTS');
  });
});

describe('PresenceHistory · M. Etiketler', () => {
  it('M1. 🔒 tüm kapanış ve durum etiketleri kapsanır', () => {
    expect(presenceCloseReasonLabel('SUPERSEDED')).toBe('Yerine başka sürücü geçti');
    expect(presenceCloseReasonLabel('TTL_EXPIRED')).toBe('Gözlemin süresi doldu');
    expect(presenceCloseReasonLabel(null)).toBe('Açık');
    expect(presenceSegmentStatusLabel('OPEN')).toBe('Açık');
    expect(presenceSegmentStatusLabel('CLEARED')).toBe('Temizlendi');
  });
});
