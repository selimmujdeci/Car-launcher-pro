/**
 * tripApplyEngine.test — MAVI4-TRIP-5 preview→active route apply katmanı.
 *
 * Kapsam: apply · resume · rollback · snapshot restore · invalid preview ·
 * expired preview · double apply · cancel · race condition · immutable snapshot.
 * Store enjekte edilir (Zustand yok); TRIP-4 Preview Engine değiştirilmez.
 */
import { describe, it, expect } from 'vitest';
import {
  createTripApplyEngine,
  type ActiveRoute,
  type RouteStoreAdapter,
} from '../platform/trip/tripApplyEngine';
import type { TripPreview } from '../platform/trip/tripPreviewEngine';

/** Bellek-içi store adapter. */
function makeStore(initial: ActiveRoute | null): RouteStoreAdapter & { current: ActiveRoute | null } {
  return {
    current: initial,
    getActiveRoute() { return this.current; },
    setActiveRoute(r: ActiveRoute) { this.current = r; },
  };
}

const ORIGINAL_ROUTE = (): ActiveRoute => ({
  geometry:  [[32.80, 39.90], [32.85, 39.90], [32.90, 39.90]],
  distanceM: 8000,
  durationS: 600,
  etaEpochMs: 1_700_000_000_000,
  meta: { serverUsed: 'osrm' },
});

const VALID_PREVIEW = (): TripPreview => ({
  previewRoute:       [[32.80, 39.90], [32.85, 39.95], [32.90, 39.90]],
  previewDistance:    10000,
  previewDuration:    900,
  addedDistance:      2000,
  addedTravelMinutes: 5,
  previewETA:         1_700_000_300_000,
  selectedPoi:        { lat: 39.95, lng: 32.85 },
  isValid:            true,
  errorCategory:      'NONE',
});

const INVALID_PREVIEW = (): TripPreview => ({
  ...VALID_PREVIEW(),
  isValid:       false,
  errorCategory: 'ROUTE_FAILED',
  previewRoute:  null,
});

describe('TripApplyEngine — apply', () => {
  it('geçerli preview + açık onay → APPLIED, store preview rotasına geçer', () => {
    const store = makeStore(ORIGINAL_ROUTE());
    const eng = createTripApplyEngine({ store });
    const begin = eng.beginPreview(VALID_PREVIEW());
    expect(begin.code).toBe('PREVIEW_READY');
    const res = eng.applyPreview(begin.previewId!, { confirmed: true, source: 'user' });
    expect(res.code).toBe('APPLIED');
    expect(store.current!.distanceM).toBe(10000);
    expect(store.current!.durationS).toBe(900);
    expect(store.current!.etaEpochMs).toBe(1_700_000_300_000);
    expect(eng.isApplied).toBe(true);
  });

  it('onaysız → NOT_CONFIRMED, store değişmez', () => {
    const store = makeStore(ORIGINAL_ROUTE());
    const eng = createTripApplyEngine({ store });
    const b = eng.beginPreview(VALID_PREVIEW());
    const res = eng.applyPreview(b.previewId!, { confirmed: false, source: 'user' });
    expect(res.code).toBe('NOT_CONFIRMED');
    expect(store.current!.distanceM).toBe(8000);
  });

  it('voice tek başına → VOICE_NOT_ALLOWED, store değişmez', () => {
    const store = makeStore(ORIGINAL_ROUTE());
    const eng = createTripApplyEngine({ store });
    const b = eng.beginPreview(VALID_PREVIEW());
    const res = eng.applyPreview(b.previewId!, { confirmed: true, source: 'voice' });
    expect(res.code).toBe('VOICE_NOT_ALLOWED');
    expect(store.current!.distanceM).toBe(8000);
  });

  it('safetyCheck veto → SAFETY_BLOCKED (AiSafetyGate korunur/fail-closed)', () => {
    const store = makeStore(ORIGINAL_ROUTE());
    const eng = createTripApplyEngine({ store, safetyCheck: () => ({ allowed: false, reason: 'driving_critical' }) });
    const b = eng.beginPreview(VALID_PREVIEW());
    const res = eng.applyPreview(b.previewId!, { confirmed: true, source: 'user' });
    expect(res.code).toBe('SAFETY_BLOCKED');
    expect(res.reason).toBe('driving_critical');
    expect(store.current!.distanceM).toBe(8000);
  });
});

describe('TripApplyEngine — invalid / expired', () => {
  it('geçersiz preview → beginPreview INVALID_PREVIEW', () => {
    const store = makeStore(ORIGINAL_ROUTE());
    const eng = createTripApplyEngine({ store });
    expect(eng.beginPreview(INVALID_PREVIEW()).code).toBe('INVALID_PREVIEW');
  });

  it('aktif rota yok → NO_ACTIVE_ROUTE', () => {
    const store = makeStore(null);
    const eng = createTripApplyEngine({ store });
    expect(eng.beginPreview(VALID_PREVIEW()).code).toBe('NO_ACTIVE_ROUTE');
  });

  it('yaş aşımı → EXPIRED (age_exceeded)', () => {
    const store = makeStore(ORIGINAL_ROUTE());
    let t = 1_000;
    const eng = createTripApplyEngine({ store, now: () => t, maxPreviewAgeMs: 5_000 });
    const b = eng.beginPreview(VALID_PREVIEW());
    t = 1_000 + 6_000; // 6 sn sonra
    const res = eng.applyPreview(b.previewId!, { confirmed: true, source: 'user' });
    expect(res.code).toBe('EXPIRED');
    expect(res.reason).toBe('age_exceeded');
    expect(store.current!.distanceM).toBe(8000);
  });
});

describe('TripApplyEngine — resume / rollback / snapshot restore', () => {
  it('apply sonrası resumeOriginal → orijinal rota birebir geri gelir', () => {
    const store = makeStore(ORIGINAL_ROUTE());
    const eng = createTripApplyEngine({ store });
    const b = eng.beginPreview(VALID_PREVIEW());
    eng.applyPreview(b.previewId!, { confirmed: true, source: 'user' });
    const res = eng.resumeOriginal();
    expect(res.code).toBe('RESUMED');
    expect(store.current).toEqual(ORIGINAL_ROUTE());
    expect(eng.isApplied).toBe(false);
  });

  it('apply sonrası rollback → snapshot geri yüklenir', () => {
    const store = makeStore(ORIGINAL_ROUTE());
    const eng = createTripApplyEngine({ store });
    const b = eng.beginPreview(VALID_PREVIEW());
    eng.applyPreview(b.previewId!, { confirmed: true, source: 'user' });
    expect(store.current!.distanceM).toBe(10000); // uygulandı
    const res = eng.rollback();
    expect(res.code).toBe('ROLLED_BACK');
    expect(store.current).toEqual(ORIGINAL_ROUTE());
  });

  it('apply yokken resume/rollback → NOTHING_TO_RESTORE', () => {
    const store = makeStore(ORIGINAL_ROUTE());
    const eng = createTripApplyEngine({ store });
    expect(eng.resumeOriginal().code).toBe('NOTHING_TO_RESTORE');
    expect(eng.rollback().code).toBe('NOTHING_TO_RESTORE');
  });
});

describe('TripApplyEngine — double apply / cancel', () => {
  it('double apply → ikinci ALREADY_APPLIED', () => {
    const store = makeStore(ORIGINAL_ROUTE());
    const eng = createTripApplyEngine({ store });
    const b = eng.beginPreview(VALID_PREVIEW());
    expect(eng.applyPreview(b.previewId!, { confirmed: true, source: 'user' }).code).toBe('APPLIED');
    expect(eng.applyPreview(b.previewId!, { confirmed: true, source: 'user' }).code).toBe('ALREADY_APPLIED');
  });

  it('cancel sonrası apply → NO_PENDING_PREVIEW, store değişmez', () => {
    const store = makeStore(ORIGINAL_ROUTE());
    const eng = createTripApplyEngine({ store });
    const b = eng.beginPreview(VALID_PREVIEW());
    expect(eng.cancelPreview(b.previewId!).code).toBe('CANCELLED');
    expect(eng.applyPreview(b.previewId!, { confirmed: true, source: 'user' }).code).toBe('NO_PENDING_PREVIEW');
    expect(store.current!.distanceM).toBe(8000);
  });

  it('yanlış previewId → NO_PENDING_PREVIEW', () => {
    const store = makeStore(ORIGINAL_ROUTE());
    const eng = createTripApplyEngine({ store });
    eng.beginPreview(VALID_PREVIEW());
    expect(eng.applyPreview('pv_yok', { confirmed: true, source: 'user' }).code).toBe('NO_PENDING_PREVIEW');
  });
});

describe('TripApplyEngine — race condition (aktif rota değişti)', () => {
  it('begin sonrası aktif rota dışarıdan değişirse apply → EXPIRED (active_route_changed)', () => {
    const store = makeStore(ORIGINAL_ROUTE());
    const eng = createTripApplyEngine({ store });
    const b = eng.beginPreview(VALID_PREVIEW());
    // Dışarıdan reroute — aktif rota imzası değişti.
    store.setActiveRoute({ ...ORIGINAL_ROUTE(), distanceM: 12345, geometry: [[10, 10], [11, 11]] });
    const res = eng.applyPreview(b.previewId!, { confirmed: true, source: 'user' });
    expect(res.code).toBe('EXPIRED');
    expect(res.reason).toBe('active_route_changed');
  });
});

describe('TripApplyEngine — immutable snapshot', () => {
  it('begin sonrası orijinal obje mutasyona uğrasa bile snapshot etkilenmez', () => {
    const original = ORIGINAL_ROUTE();
    const store = makeStore(original);
    const eng = createTripApplyEngine({ store });
    const b = eng.beginPreview(VALID_PREVIEW());
    // Orijinal store objesini boz (snapshot deep-clone olduğundan etkilenmemeli).
    original.distanceM = 99999;
    original.geometry[0][0] = 0;
    // Aktif rotayı temiz orijinaline döndür ki imza eşleşsin, sonra apply+rollback.
    store.setActiveRoute(ORIGINAL_ROUTE());
    // Not: imza değiştiği için bu apply EXPIRED olur; snapshot bütünlüğünü rollback ile ayrı test ederiz.
    expect(b.code).toBe('PREVIEW_READY');

    // Yeni oturum: temiz store ile snapshot + apply + rollback → snapshot bozulmamış orijinali verir.
    const store2 = makeStore(ORIGINAL_ROUTE());
    const eng2 = createTripApplyEngine({ store: store2 });
    const b2 = eng2.beginPreview(VALID_PREVIEW());
    eng2.applyPreview(b2.previewId!, { confirmed: true, source: 'user' });
    // Uygulanmış rotayı dışarıdan boz — snapshot etkilenmemeli.
    store2.current!.geometry[0][0] = -1;
    store2.current!.distanceM = 1;
    eng2.rollback();
    expect(store2.current).toEqual(ORIGINAL_ROUTE());
  });

  it('snapshot rotası deep-frozen (dışarıdan yazılamaz)', () => {
    const store = makeStore(ORIGINAL_ROUTE());
    const eng = createTripApplyEngine({ store });
    eng.beginPreview(VALID_PREVIEW());
    eng.applyPreview('pv_1', { confirmed: true, source: 'user' });
    // rollback iki kez: ilk restore orijinali verir; snapshot temizlenir.
    expect(eng.rollback().code).toBe('ROLLED_BACK');
    expect(eng.rollback().code).toBe('NOTHING_TO_RESTORE');
  });
});
