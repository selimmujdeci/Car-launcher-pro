/**
 * tripCompletionCardOneShot.test.ts — "YOLCULUK TAMAMLANDI" KARTI TEK ATIŞ.
 *
 * ── ÖLÇÜLEN KUSUR ────────────────────────────────────────────────────
 * Kart `active → pasif` GEÇİŞİNE bağlıydı ve o an `history[0]`ı gösteriyordu.
 * Ama `tripLogService` 1 dakikadan kısa / 100 metreden kısa yolculukları
 * KAYDETMEZ: geçiş yine olur, `history` DEĞİŞMEZ ve kart **bir önceki
 * yolculuğun özetini** ikinci kez "Yolculuk Tamamlandı" diye açardı.
 *
 * İKİ KAPI, İKİ AYRI KUSUR SINIFI:
 *   1. Store — aynı `tripId` için kart İKİ KEZ açılmaz (tekrar/yeniden yayın).
 *   2. Orchestrator — `history[0]` kanonik kapanış kimliğiyle EŞLEŞMİYORSA
 *      kart hiç açılmaz (özet üretmeyen kapanış).
 *
 * Bu dosya 1. kapıyı doğrudan, 2. kapıyı kaynak kilidiyle sınar
 * (orchestrator canlı GPS/OBD/termal aboneliği kurar; onu bu testte
 * ayağa kaldırmak yeni bir bağımlılık ormanı getirirdi).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../utils/safeStorage', () => ({
  safeGetRaw: vi.fn(() => null),
  safeSetRaw: vi.fn(),
  safeFlushKey: vi.fn(),
}));

import { useSystemStore } from '../store/useSystemStore';
import type { TripRecord } from '../platform/tripLogService';

function trip(id: string, distanceKm = 12.4): TripRecord {
  return {
    id, startTime: 1_757_600_000_000, endTime: 1_757_603_600_000,
    distanceKm, durationMin: 60, avgSpeedKmh: 42, maxSpeedKmh: 98,
    fuelConsumptionL: 1.1, fuelCostTL: 49, drivingScore: 88, harshEvents: 0,
  };
}

beforeEach(() => {
  useSystemStore.setState({
    showTripSummary: false, lastCompletedTrip: null, shownTripSummaryId: null,
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KAPI 1 — store tek atış
 * ════════════════════════════════════════════════════════════════════════ */

describe('tamamlandı kartı — store kapısı', () => {
  it('yeni yolculuk kartı açar', () => {
    useSystemStore.getState().setTripSummary(trip('trip-a'));
    const s = useSystemStore.getState();
    expect(s.showTripSummary).toBe(true);
    expect(s.lastCompletedTrip?.id).toBe('trip-a');
    expect(s.shownTripSummaryId).toBe('trip-a');
  });

  it('AYNI yolculuk kartı İKİNCİ KEZ AÇMAZ (kullanıcı kapattıysa kapalı kalır)', () => {
    useSystemStore.getState().setTripSummary(trip('trip-a'));
    useSystemStore.getState().closeTripSummary();
    expect(useSystemStore.getState().showTripSummary).toBe(false);

    /* Aynı yolculuk yeniden bildirildi — kart canlanmamalı. */
    useSystemStore.getState().setTripSummary(trip('trip-a'));
    expect(useSystemStore.getState().showTripSummary).toBe(false);
  });

  it('FARKLI yolculuk kartı yeniden açar', () => {
    useSystemStore.getState().setTripSummary(trip('trip-a'));
    useSystemStore.getState().closeTripSummary();

    useSystemStore.getState().setTripSummary(trip('trip-b'));
    const s = useSystemStore.getState();
    expect(s.showTripSummary).toBe(true);
    expect(s.lastCompletedTrip?.id).toBe('trip-b');
  });

  it('kimliksiz kayıt kart AÇMAZ (hangi yolculuk olduğu bilinmiyor)', () => {
    useSystemStore.getState().setTripSummary({ ...trip('x'), id: '' });
    const s = useSystemStore.getState();
    expect(s.showTripSummary).toBe(false);
    expect(s.lastCompletedTrip).toBeNull();
  });

  it('aynı yolculuk üst üste bildirildiğinde özet DEĞİŞMEZ', () => {
    useSystemStore.getState().setTripSummary(trip('trip-a', 12.4));
    /* Aynı kimlik, FARKLI mesafe (bozuk/yeniden hesaplanmış bir kayıt):
       gösterilen özet sessizce değişmemeli. */
    useSystemStore.getState().setTripSummary(trip('trip-a', 999));
    expect(useSystemStore.getState().lastCompletedTrip?.distanceKm).toBe(12.4);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KAPI 2 — orchestrator kanonik kapanış kilidi
 * ════════════════════════════════════════════════════════════════════════ */

describe('tamamlandı kartı — orchestrator kapısı (kaynak kilidi)', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/platform/system/SystemOrchestrator.ts'),
    'utf8',
  );

  it('kanonik kapanış kimliği OKUNUR', () => {
    expect(src).toMatch(/getTripJournalGlance\(\)\.lastCompletedTripId/);
  });

  it('history[0] kanonik kimlikle EŞLEŞMEZSE kart açılmaz', () => {
    expect(src).toMatch(/head\.id !== completedId\) return;/);
  });

  it('kart yalnız bu kapıdan geçtikten SONRA açılır', () => {
    const gateAt = src.indexOf('head.id !== completedId');
    const showAt = src.indexOf('setTripSummary(head)');
    expect(gateAt).toBeGreaterThan(-1);
    expect(showAt).toBeGreaterThan(gateAt);
  });
});
