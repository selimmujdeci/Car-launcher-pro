/**
 * tripCompletionPopupCanonical.test.ts — "YOLCULUK TAMAMLANDI" KARTI YALNIZ
 * KANONİK VARIŞTA AÇILIR.
 *
 * ── ÖLÇÜLEN KUSUR (gerçek render, 2026-09-21) ────────────────────────────
 * Ana ekranda "YOLCULUK TAMAMLANDI · 0.9 km / 4 dk / 14 km/s" ve
 * "1.2 km / 4 dk / 31 km/s" kartları açıldı. Kart `tripLogService`in
 * depolama segmenti mühürüne bağlıydı; rota olmayan sürüşte her IDLE_WINDOW
 * mühürü "yolculuk bitti" ilan ediyordu.
 *
 * ── KURAL (4543ccf9 · 982c8965) ──────────────────────────────────────────
 *  · DRIVE_LOG  → kart ASLA açılmaz.
 *  · JOURNEY    → yalnız navigasyon otoritesinin varış mührü (DESTINATION_
 *                 REACHED) açar; mola / mühür / restart / iptal / reroute /
 *                 hedef değişikliği AÇMAZ.
 *  · Kart oturum başına TAM 1 KEZ açılır ve oturum TOPLAMINI gösterir.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  advanceTripSession, projectTripSession, emptyTripSession,
  serializeTripSession, deserializeTripSession,
  type TripSession, type TripSessionSample, type TripSessionSegment,
} from '../platform/trip/core/tripSessionModel';
import { selectJourneyCompletionCard } from '../platform/trip/tripSessionAccess';

vi.mock('../utils/safeStorage', () => ({
  safeGetRaw: vi.fn(() => null),
  safeSetRaw: vi.fn(),
  safeRemoveRaw: vi.fn(),
  safeFlushKey: vi.fn(),
}));

import { useSystemStore } from '../store/useSystemStore';

const MIN = 60_000;
const WALL0 = 1_700_000_000_000;

function seg(over: Partial<TripSessionSegment> & { key: number }): TripSessionSegment {
  return {
    startedMonoMs: over.key, startedWallMs: WALL0 + over.key,
    movingMs: 0, idleMs: 0, unknownMs: 0, distanceM: 0, stoppedSinceMonoMs: null,
    ...over,
  };
}

function sample(
  monoMs: number,
  segment: TripSessionSegment | null,
  intent: { routeActive?: boolean; arrivalSeq?: number } = {},
): TripSessionSample {
  return {
    monoMs, wallMs: WALL0 + monoMs, segment, lat: 36.9, lon: 34.6,
    routeActive: intent.routeActive === true, arrivalSeq: intent.arrivalSeq ?? 0,
  };
}

/** Kart açılır mı — orchestrator ile AYNI seçici, aynı projeksiyon. */
function card(s: TripSession, now: number) {
  return selectJourneyCompletionCard(projectTripSession(s, now));
}

/** Rota olmadan 0.9 km / 4 dk sürüş (saha kartındaki değerler). */
function driveLogShort(): TripSession {
  let s = emptyTripSession();
  s = advanceTripSession(s, sample(1 * MIN, seg({ key: 1 * MIN })));
  s = advanceTripSession(s, sample(5 * MIN, seg({
    key: 1 * MIN, movingMs: 4 * MIN, distanceM: 900, speedSum: 56, speedCount: 4,
  })));
  return s;
}

/** Rota aktif, 120 km'lik ilk bacak sürüldü (segment hâlâ açık). */
function journeyFirstLeg(): TripSession {
  let s = emptyTripSession();
  s = advanceTripSession(s, sample(10 * MIN, seg({ key: 10 * MIN }), { routeActive: true }));
  s = advanceTripSession(s, sample(100 * MIN, seg({
    key: 10 * MIN, movingMs: 88 * MIN, distanceM: 120_000, speedSum: 8_800, speedCount: 100,
  }), { routeActive: true }));
  return s;
}

/* ══════════════════════════════════════════════════════════════════════════
 * DRIVE_LOG — kart ASLA açılmaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('DRIVE_LOG — "Yolculuk tamamlandı" kartı yok', () => {
  it('IDLE_WINDOW mührü (segment kapandı, mola) → kart YOK', () => {
    let s = driveLogShort();
    s = advanceTripSession(s, sample(6 * MIN, null)); // depolama mührü
    expect(projectTripSession(s, 6 * MIN).kind).toBe('DRIVE_LOG');
    expect(card(s, 6 * MIN)).toBeNull();
  });

  it('DATA_SILENCE mührü (uzun sessizlik sonrası kapanış) → kart YOK', () => {
    let s = driveLogShort();
    s = advanceTripSession(s, sample(20 * MIN, null)); // 15 dk veri yok, sonra mühür
    expect(card(s, 20 * MIN)).toBeNull();
    /* Mola eşiğini aşsa bile (yeni kayıt bloğu açılır) tamamlanma YOK. */
    s = advanceTripSession(s, sample(60 * MIN, seg({ key: 60 * MIN })));
    expect(card(s, 60 * MIN)).toBeNull();
    expect(projectTripSession(s, 60 * MIN).journeyCompleted).toBe(false);
  });

  it('servis durması / restart → kart YOK', () => {
    const s = driveLogShort();
    const payload = serializeTripSession(s, 5 * MIN, WALL0 + 5 * MIN, null);
    const res = deserializeTripSession(payload, 100, WALL0 + 7 * MIN, null);
    expect(res.restored).toBe(true);
    if (!res.restored) return;
    expect(card(res.session, 100)).toBeNull();
  });

  it('DRIVE_LOG hiçbir varış mührüyle tamamlanmaz (hedefsiz sürüş "varamaz")', () => {
    let s = driveLogShort();
    s = advanceTripSession(s, sample(6 * MIN, seg({ key: 1 * MIN, movingMs: 5 * MIN }), {
      routeActive: false, arrivalSeq: 3,
    }));
    expect(card(s, 6 * MIN)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * JOURNEY — yalnız DESTINATION_REACHED
 * ════════════════════════════════════════════════════════════════════════ */

describe('JOURNEY — kart yalnız kanonik varışta', () => {
  it('mola / segment mührü → kart YOK', () => {
    let s = journeyFirstLeg();
    s = advanceTripSession(s, sample(101 * MIN, null, { routeActive: true }));
    expect(card(s, 110 * MIN)).toBeNull();
    /* 90 dk mola bile: rota aktif, tamamlanma yok. */
    expect(card(s, 191 * MIN)).toBeNull();
  });

  it('restart → kart YOK', () => {
    const payload = serializeTripSession(journeyFirstLeg(), 100 * MIN, WALL0 + 100 * MIN, 'veh-A');
    const res = deserializeTripSession(payload, 500, WALL0 + 102 * MIN, 'veh-A');
    if (!res.restored) throw new Error('restore basarisiz');
    expect(card(res.session, 500)).toBeNull();
    /* Restart öncesi varış mührü (seq 5) yeni süreçte GÖRÜLMEZ; navigasyon
       sıfırdan sayar — kart yine yok. */
    const s = advanceTripSession(res.session, sample(2 * MIN, seg({ key: 2 * MIN }), {
      routeActive: true, arrivalSeq: 0,
    }));
    expect(card(s, 2 * MIN)).toBeNull();
  });

  it('rota iptali → kart YOK', () => {
    let s = journeyFirstLeg();
    s = advanceTripSession(s, sample(101 * MIN, seg({ key: 10 * MIN, movingMs: 89 * MIN }), {
      routeActive: false, arrivalSeq: 0, // iptal: rota kapandı, varış mührü artmadı
    }));
    expect(projectTripSession(s, 101 * MIN).kind).toBe('JOURNEY');
    expect(card(s, 101 * MIN)).toBeNull();
  });

  it('reroute → kart YOK', () => {
    let s = journeyFirstLeg();
    /* Reroute: rota aktif kalır, mühür artmaz. */
    s = advanceTripSession(s, sample(101 * MIN, seg({ key: 10 * MIN, movingMs: 89 * MIN }), {
      routeActive: true, arrivalSeq: 0,
    }));
    expect(card(s, 101 * MIN)).toBeNull();
  });

  it('hedef değişikliği → kart YOK', () => {
    let s = journeyFirstLeg();
    /* Hedef değişti: kısa bir rota-yok anı, sonra yeniden aktif; mühür yok. */
    s = advanceTripSession(s, sample(101 * MIN, seg({ key: 10 * MIN, movingMs: 89 * MIN }), {
      routeActive: false,
    }));
    s = advanceTripSession(s, sample(102 * MIN, seg({ key: 10 * MIN, movingMs: 90 * MIN }), {
      routeActive: true,
    }));
    expect(card(s, 102 * MIN)).toBeNull();
  });

  it('DESTINATION_REACHED → kart açılır ve oturum başına TAM 1 KEZ', () => {
    useSystemStore.setState({ showTripSummary: false, lastCompletedTrip: null, shownTripSummaryId: null });
    let s = journeyFirstLeg();
    s = advanceTripSession(s, sample(101 * MIN, seg({ key: 10 * MIN, movingMs: 89 * MIN, distanceM: 121_000 }), {
      routeActive: true, arrivalSeq: 1,
    }));
    const c1 = card(s, 101 * MIN);
    expect(c1).not.toBeNull();
    expect(c1!.id).toBe(s.sessionId);

    /* Orchestrator her yayında aynı seçiciyi çağırır; store tek atış. */
    useSystemStore.getState().setTripSummary(c1!);
    expect(useSystemStore.getState().showTripSummary).toBe(true);
    useSystemStore.getState().closeTripSummary();

    /* Aynı oturum: segment mührü (end-trip yayını) → kart YENİDEN AÇILMAZ. */
    s = advanceTripSession(s, sample(102 * MIN, null, { routeActive: true }));
    const c2 = card(s, 102 * MIN);
    expect(c2!.id).toBe(c1!.id);
    useSystemStore.getState().setTripSummary(c2!);
    expect(useSystemStore.getState().showTripSummary).toBe(false);

    /* Yeni hareket YENİ oturumdur → tamamlanmamış → kart yok. */
    s = advanceTripSession(s, sample(110 * MIN, seg({ key: 110 * MIN }), { routeActive: true }));
    expect(card(s, 110 * MIN)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ÇOK SEGMENTLİ YOLCULUK — kart OTURUM toplamını gösterir
 * ════════════════════════════════════════════════════════════════════════ */

describe('kart sayıları oturum toplamıdır, son segment değil', () => {
  it('120 km + 180 km → kart 300 km, süre yola çıkıştan itibaren', () => {
    let s = journeyFirstLeg();
    s = advanceTripSession(s, sample(101 * MIN, null, { routeActive: true }));
    const resumeAt = 130 * MIN;
    s = advanceTripSession(s, sample(resumeAt, seg({ key: resumeAt }), { routeActive: true }));
    s = advanceTripSession(s, sample(resumeAt + 150 * MIN, seg({
      key: resumeAt, movingMs: 148 * MIN, distanceM: 180_000, speedSum: 14_400, speedCount: 120,
    }), { routeActive: true, arrivalSeq: 1 }));

    const c = card(s, resumeAt + 150 * MIN);
    expect(c).not.toBeNull();
    expect(c!.distanceKm).toBe(300);
    expect(c!.durationMin).toBe(270);              // 10 → 280 dk
    /* Ortalama = yol / sürüş süresi (29 dk mola HARİÇ): 300 km / 241 dk. Eski
       beklenti hız örneklerinin ortalamasıydı (105) — şişik değer, saha 2026-09-25. */
    expect(c!.avgSpeedKmh).toBe(Math.round(300 / (241 / 60)));
    /* Oturum düzeyinde skor/maliyet sahibi yok → satır çıkmaz, sayı uydurulmaz. */
    expect(c!.drivingScore).toBeNull();
    expect(c!.fuelCostTL).toBeNull();
  });

  it('hız örneği yoksa ortalama hız null (0 uydurulmaz)', () => {
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(1 * MIN, seg({ key: 1 * MIN }), { routeActive: true }));
    s = advanceTripSession(s, sample(2 * MIN, seg({ key: 1 * MIN, movingMs: MIN, distanceM: 500 }), {
      routeActive: true, arrivalSeq: 1,
    }));
    expect(card(s, 2 * MIN)!.avgSpeedKmh).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * YAPISAL KİLİTLER — eski tetikleyici geri gelmesin, ikinci otorite doğmasın
 * ════════════════════════════════════════════════════════════════════════ */

function src(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), 'utf-8');
}

describe('yapısal — popup tek otoriteden', () => {
  const orch = src('src', 'platform', 'system', 'SystemOrchestrator.ts');
  const layout = src('src', 'components', 'layout', 'MainLayout.tsx');
  const banner = src('src', 'components', 'trip', 'TripSummaryBanner.tsx');

  it('orchestrator kartı yalnız kanonik seçiciden açar', () => {
    expect(orch).toContain('selectJourneyCompletionCard(readTripSessionOrNull())');
    /* Depolama segmenti kapanışı artık tetikleyici DEĞİL. */
    expect(orch).not.toMatch(/history\[0\]|lastCompletedTripId|_pendingTripSummary|justEnded/);
    /* Kart yalnız seçici sonucuyla açılır — TripRecord/segment geçirilmez. */
    const opens = orch.match(/setTripSummary\(([^)]*)\)/g) ?? [];
    expect(opens).toEqual(['setTripSummary(card)']);
  });

  it('kanonik seçici DRIVE_LOG ve tamamlanmamış oturumu reddeder', () => {
    const access = src('src', 'platform', 'trip', 'tripSessionAccess.ts');
    expect(access).toContain("if (p.kind !== 'JOURNEY') return null;");
    expect(access).toContain("if (!p.journeyCompleted || p.completion !== 'DESTINATION_REACHED') return null;");
  });

  it('tek tüketici: banner yalnız MainLayout\'ta, ikinci popup yüzeyi yok', () => {
    expect(layout).toContain('<TripSummaryBanner');
    expect(banner).toContain('Yolculuk Tamamlandı');
    /* Navigasyon/harita açıkken gizlenir ve sürüş hız kapısından geçer. */
    expect(layout).toMatch(/showTripSummary && lastCompletedTrip && !isNavigating && !fullMapOpen && !tripSummaryBlocked/);
  });

  it('9d78b68e harsh tek otoritesi ve 4543ccf9 niyet semantiği bozulmadı', () => {
    const trip = src('src', 'platform', 'tripLogService.ts');
    expect(trip).not.toContain('_active.harshBrakeEvents');
    expect(trip).toContain('harshBrakeCount: acc.harshBrakeCount');
    const model = src('src', 'platform', 'trip', 'core', 'tripSessionModel.ts');
    expect(model).toContain('SESSION_MAX_BREAK_MS && !session.routeActive');
    expect(model).toContain("journeyCompleted: session.completion === 'DESTINATION_REACHED'");
  });
});

beforeEach(() => {
  useSystemStore.setState({ showTripSummary: false, lastCompletedTrip: null, shownTripSummaryId: null });
});
