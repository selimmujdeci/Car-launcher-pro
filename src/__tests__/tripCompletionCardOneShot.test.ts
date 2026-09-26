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
import type { JourneyCompletionCard } from '../platform/trip/tripSessionAccess';

function trip(id: string, distanceKm = 12.4): JourneyCompletionCard {
  return { id, distanceKm, durationMin: 60, avgSpeedKmh: 42, fuelCostTL: null, drivingScore: null };
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
 * KAPI 2 — orchestrator KANONİK tetikleyici (kaynak kilidi)
 *
 * 2026-09-21: `history[0]`/`lastCompletedTripId` eşleşmesi KALDIRILDI — o
 * kapı yanlış tetikleyiciyi (depolama segmenti mührü) filtreliyordu. Kart
 * artık yalnız seyahat oturumunun kanonik hükmüyle açılır: JOURNEY +
 * DESTINATION_REACHED (bkz. tripCompletionPopupCanonical.test.ts).
 * ════════════════════════════════════════════════════════════════════════ */

describe('tamamlandı kartı — orchestrator kapısı (kaynak kilidi)', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/platform/system/SystemOrchestrator.ts'),
    'utf8',
  );

  it('kart yalnız kanonik oturum seçicisinden açılır', () => {
    expect(src).toContain('selectJourneyCompletionCard(readTripSessionOrNull())');
    expect(src).toMatch(/if \(card === null\) return;/);
  });

  it('depolama segmenti kapanışı artık tetikleyici DEĞİL', () => {
    expect(src).not.toMatch(/getTripJournalGlance|history\[0\]|justEnded|_pendingTripSummary/);
  });

  it('kart yalnız seçici sonucuyla açılır', () => {
    const gateAt = src.indexOf('if (card === null) return;');
    const showAt = src.indexOf('setTripSummary(card)');
    expect(gateAt).toBeGreaterThan(-1);
    expect(showAt).toBeGreaterThan(gateAt);
  });
});
