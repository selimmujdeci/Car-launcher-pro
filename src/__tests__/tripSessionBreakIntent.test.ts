/**
 * tripSessionBreakIntent.test — SAHA 2026-09-25: 12:41'de durulup 13:30'da rota
 * kurulunca 49 dk mola "rota aktif" sayıldı ve 12:27'deki oturum 4 saat sürdü;
 * mola 2,5 saati geçmişken ekran hâlâ "SÜREN YOLCULUK" diyordu.
 */
import { describe, it, expect } from 'vitest';
import {
  advanceTripSession, projectTripSession, emptyTripSession,
  type TripSession, type TripSessionSample, type TripSessionSegment,
} from '../platform/trip/core/tripSessionModel';
import { selectTrip } from '../components/cockpit/tripComputerModel';

const MIN = 60_000;
const WALL0 = 1_700_000_000_000;
const seg = (key: number, over: Partial<TripSessionSegment> = {}): TripSessionSegment => ({
  key, startedMonoMs: key, startedWallMs: WALL0 + key,
  movingMs: 5 * MIN, idleMs: 0, unknownMs: 0, distanceM: 3000, stoppedSinceMonoMs: null,
  speedSum: 400, speedCount: 10, ...over,
} as TripSessionSegment);
const sample = (monoMs: number, segment: TripSessionSegment | null, routeActive = false): TripSessionSample => ({
  monoMs, wallMs: WALL0 + monoMs, segment, lat: 36.9, lon: 34.6, routeActive, arrivalSeq: 0,
});

/** 0-7 dk sür, 7'de dur (rota durumu `routeAtStop`), `resumeAt`'te yeniden hareket (`routeOnResume`). */
function driveStopResume(routeAtStop: boolean, resumeAt: number, routeOnResume: boolean): TripSession {
  let s = emptyTripSession();
  s = advanceTripSession(s, sample(1 * MIN, seg(1 * MIN), routeAtStop));
  s = advanceTripSession(s, sample(7 * MIN, seg(1 * MIN), routeAtStop));
  s = advanceTripSession(s, sample(8 * MIN, null, routeAtStop));            // mola başlar
  s = advanceTripSession(s, sample(resumeAt, seg(resumeAt), routeOnResume)); // yeniden hareket
  return s;
}

describe('45 dk mola kuralı — rota durumu MOLA BAŞINDA okunur', () => {
  it('🔒 mola sonrası kurulan rota eski yolculuğu UZATMAZ (yeni oturum)', () => {
    const s = driveStopResume(false, 57 * MIN, true);                        // 49 dk mola
    expect(s.sessionId).toBe(`session-${57 * MIN}`);
  });
  it('dinlenme tesisi: rota açıkken verilen uzun mola yolculuğu BÖLMEZ', () => {
    const s = driveStopResume(true, 68 * MIN, true);                         // 60 dk mola
    expect(s.sessionId).toBe(`session-${1 * MIN}`);
  });
  it('rotasız kısa mola aynı oturumda kalır', () => {
    const s = driveStopResume(false, 20 * MIN, false);
    expect(s.sessionId).toBe(`session-${1 * MIN}`);
  });
});

describe('yolculuk bilgisayarı — mola sınırı aşıldıysa "süren" denmez', () => {
  it('🔒 45 dk üstü rotasız mola → son yolculuk, bitiş = mola başlangıcı', () => {
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(1 * MIN, seg(1 * MIN)));
    s = advanceTripSession(s, sample(8 * MIN, null));
    const p = projectTripSession(s, 8 * MIN + 60 * MIN);
    expect(p.breakExceededSession).toBe(true);
    const st = selectTrip({ active: false, current: null, history: [], totalDistanceKm: 0, totalTrips: 0 } as never, { tankL: null }, p);
    expect(st.view).toBe('last');
    expect(st.endedAtMs).toBe(p.breakSinceWallMs);
    expect(p.breakSinceWallMs).toBe(WALL0 + 1 * MIN);   // mola son güncellemeden (1. dk) başlar
  });
  it('mola kısaysa hâlâ süren yolculuktur', () => {
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(1 * MIN, seg(1 * MIN)));
    s = advanceTripSession(s, sample(8 * MIN, null));
    const st = selectTrip({ active: false, current: null, history: [], totalDistanceKm: 0, totalTrips: 0 } as never, { tankL: null }, projectTripSession(s, 20 * MIN));
    expect(st.view).toBe('active');
  });
});
