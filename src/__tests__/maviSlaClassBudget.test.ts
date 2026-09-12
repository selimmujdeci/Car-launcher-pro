/**
 * maviSlaClassBudget.test.ts — MAVI-P0-LATENCY · SLA SINIFI kilitleri.
 *
 * ── NE KİLİTLER ─────────────────────────────────────────────────────────────
 *  1. Rota → SLA sınıfı eşlemesi (yerel yollar CLOUD sayılamaz — tek ortalama
 *     "yerel komut"la "bulut sohbeti"ni aynı kovaya atıp sorunu gizlerdi).
 *  2. Hüküm YALNIZ p95'ten okunur (ortalama gizlemesi yasak).
 *  3. Kanıt seviyesi: DOĞRULANMIŞ ilk ses ile PROXY (`play()` çağrıldı)
 *     KARIŞTIRILMAZ; örnek yoksa PASS de FAIL de DENMEZ (`null`).
 *  4. Tamamlanmamış tur istatistiğe GİRMEZ (iptal edilen tur "hızlı" görünüp
 *     ortancayı yanlış iyileştiremez).
 *
 * ⚠️ Bu dosya bir SAHA gecikme kanıtı DEĞİLDİR. Testin hızlı geçmesi gerçek
 * cihazda 2 sn hedefinin tutduğu anlamına GELMEZ (CLAUDE.md §11).
 */

import { describe, it, expect } from 'vitest';
import {
  slaClassOfRoute,
  summarizeSlaClasses,
  MAVI_SLA_TARGET_P95_MS,
  type MaviSlaClass,
  type TraceShape,
} from '../platform/devtools/maviLatencyModel';

/** speech_end → first_audio_* damgalı asgari iz. */
function trace(opts: {
  route: string | null;
  requestedMs?: number | null;
  confirmedMs?: number | null;
  outcome?: string;
}): TraceShape {
  const marks: Record<string, { at: number } | undefined> = { speech_end: { at: 0 } };
  if (typeof opts.requestedMs === 'number') marks['first_audio_requested'] = { at: opts.requestedMs };
  if (typeof opts.confirmedMs === 'number') marks['first_audio_confirmed'] = { at: opts.confirmedMs };
  return {
    traceId: 1, turnId: 1, marks, route: opts.route, provider: null, presence: null,
    outcome: opts.outcome ?? 'completed',
  } as unknown as TraceShape;
}

const pick = (all: readonly { slaClass: MaviSlaClass }[], c: MaviSlaClass) =>
  all.find((x) => x.slaClass === c)!;

describe('rota → SLA sınıfı', () => {
  it('deterministik/yerel yollar LOCAL sayılır', () => {
    for (const r of [
      'critical_bypass', 'local_fast_path', 'weather_local_bypass',
      'sensor_local_bypass', 'saved_location_local_bypass',
      'music_intent_local_bypass', 'offline_chat',
    ]) {
      expect(slaClassOfRoute(r)).toBe('LOCAL');
    }
  });

  it('onay cevabı kendi sınıfındadır', () => {
    expect(slaClassOfRoute('confirmation_ack')).toBe('CONFIRMATION');
  });

  it('sağlayıcı yolları CLOUD sayılır', () => {
    expect(slaClassOfRoute('companion_action')).toBe('CLOUD');
    expect(slaClassOfRoute('companion_chat')).toBe('CLOUD');
  });

  it('rotasız/bilinmeyen iz UYDURULMAZ', () => {
    expect(slaClassOfRoute(null)).toBe('UNCLASSIFIED');
    expect(slaClassOfRoute('')).toBe('UNCLASSIFIED');
    expect(slaClassOfRoute(undefined)).toBe('UNCLASSIFIED');
  });

  it('UNCLASSIFIED sınıfının hedefi YOKTUR (hedefe sokulmaz)', () => {
    expect(MAVI_SLA_TARGET_P95_MS.UNCLASSIFIED).toBeNull();
    expect(MAVI_SLA_TARGET_P95_MS.LOCAL).toBe(1_000);
    expect(MAVI_SLA_TARGET_P95_MS.CLOUD).toBe(2_000);
    expect(MAVI_SLA_TARGET_P95_MS.CONFIRMATION).toBe(750);
  });
});

describe('SLA özeti — hüküm ve kanıt', () => {
  it('sınıflar AYRI ölçülür (tek ortalamaya karışmaz)', () => {
    const out = summarizeSlaClasses([
      trace({ route: 'local_fast_path', confirmedMs: 800 }),
      trace({ route: 'companion_chat',  confirmedMs: 1900 }),
    ]);
    expect(pick(out, 'LOCAL').confirmedStat.p95).toBe(800);
    expect(pick(out, 'CLOUD').confirmedStat.p95).toBe(1900);
    expect(pick(out, 'LOCAL').meetsTarget).toBe(true);
    expect(pick(out, 'CLOUD').meetsTarget).toBe(true);
  });

  it('hüküm p95\'ten okunur — ortalama İYİ olsa bile FAIL verir', () => {
    // 9 hızlı + 1 çok yavaş: ortalama ~1000 ms ama p95 5000 ms.
    const traces = [
      ...Array.from({ length: 9 }, () => trace({ route: 'local_fast_path', confirmedMs: 500 })),
      trace({ route: 'local_fast_path', confirmedMs: 5_000 }),
    ];
    const local = pick(summarizeSlaClasses(traces), 'LOCAL');
    expect(local.confirmedStat.p95).toBe(5_000);
    expect(local.meetsTarget).toBe(false);
  });

  it('DOĞRULANMIŞ ses varsa hüküm ondan okunur (proxy ile karışmaz)', () => {
    const out = pick(summarizeSlaClasses([
      trace({ route: 'local_fast_path', requestedMs: 400, confirmedMs: 1_500 }),
    ]), 'LOCAL');
    expect(out.evidence).toBe('CONFIRMED');
    expect(out.meetsTarget).toBe(false);     // 1500 > 1000, proxy 400 KURTARMAZ
  });

  it('yalnız proxy varsa kanıt seviyesi açıkça PROXY_ONLY der', () => {
    const out = pick(summarizeSlaClasses([
      trace({ route: 'local_fast_path', requestedMs: 700 }),
    ]), 'LOCAL');
    expect(out.evidence).toBe('PROXY_ONLY');
    expect(out.meetsTarget).toBe(true);
  });

  it('örnek yoksa PASS de FAIL de DENMEZ', () => {
    const out = pick(summarizeSlaClasses([]), 'LOCAL');
    expect(out.evidence).toBe('NONE');
    expect(out.meetsTarget).toBeNull();
    expect(out.confirmedStat.count).toBe(0);
  });

  it('tamamlanmamış tur istatistiğe GİRMEZ', () => {
    const out = pick(summarizeSlaClasses([
      trace({ route: 'local_fast_path', confirmedMs: 100, outcome: 'superseded' }),
      trace({ route: 'local_fast_path', confirmedMs: 900, outcome: 'completed' }),
    ]), 'LOCAL');
    expect(out.confirmedStat.count).toBe(1);
    expect(out.confirmedStat.p95).toBe(900);
  });

  it('onay turu kendi hedefiyle ölçülür', () => {
    const out = pick(summarizeSlaClasses([
      trace({ route: 'confirmation_ack', confirmedMs: 900 }),
    ]), 'CONFIRMATION');
    expect(out.targetP95Ms).toBe(750);
    expect(out.meetsTarget).toBe(false);     // 900 > 750
  });
});
