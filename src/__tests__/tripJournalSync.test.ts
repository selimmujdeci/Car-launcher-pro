/**
 * tripJournalSync.test.ts — SEYİR DEFTERİ BULUT SENKRONU KİLİTLERİ.
 *
 * Kilitlenen sözleşmeler:
 *  · Buluta yalnız KÜÇÜK özet gider; rota izi/koordinat yüke GİRMEZ.
 *  · Çevrimdışıyken kapanmış yolculuk sonraki açılışta KURTARILIR.
 *  · Tekrar gönderim idempotenttir; `DUPLICATE` BAŞARI sayılır.
 *  · Bulut düşse bile YEREL yolculuk geçersiz sayılmaz.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* ── Bellek içi safeStorage ───────────────────────────────────── */

const _mem = new Map<string, string>();

vi.mock('../utils/safeStorage', () => ({
  safeGetRaw: vi.fn((k: string) => _mem.get(k) ?? null),
  safeSetRaw: vi.fn((k: string, v: string) => {
    if (v === '') _mem.delete(k); else _mem.set(k, v);
  }),
  safeFlushKey: vi.fn(),
}));

/* ── tripLogService ikizi (gerçek GPS/OBD aboneliği YOK) ──────── */

type TripRecordLike = import('../platform/tripLogService').TripRecord;
type TripStateLike = import('../platform/tripLogService').TripState;

let _history: TripRecordLike[] = [];
let _stateCb: ((s: TripStateLike) => void) | null = null;

function snapshot(): TripStateLike {
  return {
    active: false, current: null, history: [..._history],
    totalDistanceKm: 0, totalTrips: _history.length,
  };
}

vi.mock('../platform/tripLogService', () => ({
  onTripState: vi.fn((cb: (s: TripStateLike) => void) => {
    _stateCb = cb;
    cb(snapshot());
    return () => { _stateCb = null; };
  }),
  getTripSnapshot: vi.fn(() => snapshot()),
}));

/* ── RPC ikizi ────────────────────────────────────────────────── */

const _calls: { fn: string; args: Record<string, unknown> }[] = [];
let _rpcReply: unknown = { state: 'CREATED', serverRevision: 1 };

vi.mock('../platform/vehicleIdentityService', () => ({
  callVehicleRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    _calls.push({ fn, args });
    if (_rpcReply instanceof Error) throw _rpcReply;
    return _rpcReply;
  }),
}));

/* ── Ters geocode ikizi ───────────────────────────────────────── */

let _geoReply: { road: string | null; district: string | null; city: string | null } | null =
  { road: 'D400', district: 'Akdeniz', city: 'Mersin' };

vi.mock('../platform/geocodingService', () => ({
  reverseGeocodeParts: vi.fn(async () => _geoReply),
}));

import { tripUploadRuntime } from '../platform/trip/tripUploadRuntime';
import {
  beginJournal, finalizeJournal, _resetJournalForTest, readJournal,
} from '../platform/trip/tripJournalStore';

/* ── Yardımcılar ──────────────────────────────────────────────── */

function tripRecord(id: string, startedAtMs = 1_757_600_000_000): TripRecordLike {
  return {
    id, startTime: startedAtMs, endTime: startedAtMs + 5_700_000,
    distanceKm: 64.3, durationMin: 95, avgSpeedKmh: 49, maxSpeedKmh: 112,
    fuelConsumptionL: 5.5, fuelCostTL: 247, drivingScore: 86, harshEvents: 1,
  };
}

/** Yolculuğun ham kanıdını deftere mühürle (alan adı HENÜZ yok). */
function sealJournal(id: string, endedAtMs: number): void {
  beginJournal({
    tripId: id, startedAtMs: endedAtMs - 5_700_000, startMonoMs: 0,
    startLocation: { lat: 36.9177, lon: 34.8953 },
    motionEvidence: { sampleCount: 4, spanMs: 3_000, sourceCount: 1 },
  });
  finalizeJournal({
    tripId: id, endedAtMs, endMonoMs: 5_700_000,
    endLocation: { lat: 36.8121, lon: 34.6415 }, endReason: 'IDLE_WINDOW',
  });
}

function lastUpload(): Record<string, unknown> | null {
  const c = _calls.filter((x) => x.fn === 'upload_vehicle_trip').pop();
  return c ? c.args : null;
}

/**
 * Asenkron işin bitmesini bekle.
 *
 * MİKRO GÖREV YETMEZ: alan adı çözümü `geocodingService`i DİNAMİK import
 * eder ve modül çözümü bir makro göreve düşer. `Promise.resolve()` döngüsü
 * bunu asla akıtmaz ve test "hiç yükleme olmadı" diye yanlış düşerdi.
 */
async function settle(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((r) => { setTimeout(r, 0); });
  }
}

beforeEach(() => {
  _mem.clear();
  _calls.length = 0;
  _history = [];
  _stateCb = null;
  _rpcReply = { state: 'CREATED', serverRevision: 1 };
  _geoReply = { road: 'D400', district: 'Akdeniz', city: 'Mersin' };
  _resetJournalForTest();
  /* Yükleme defteri MODÜL SEVİYESİ bir singleton'dadır; sıfırlanmazsa bir
     testin dedupe hafızası ötekini sessizce "zaten yüklendi"ye düşürür. */
  tripUploadRuntime._resetForTest();
});

afterEach(() => {
  tripUploadRuntime._resetForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. YÜK İÇERİĞİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('bulut yükü', () => {
  it('seyir defteri özeti yüke girer (alan · gerekçe · tamamlanma · şema)', async () => {
    const endedAt = 1_757_605_700_000;
    sealJournal('trip-1', endedAt);

    tripUploadRuntime.start();
    _history = [tripRecord('trip-1')];
    _stateCb?.(snapshot());
    await settle();

    const journal = lastUpload()?.p_journal as Record<string, unknown> | undefined;
    expect(journal).toBeDefined();
    expect(journal?.endReason).toBe('IDLE_WINDOW');
    expect(journal?.completedAtMs).toBe(endedAt);
    expect(journal?.schemaVersion).toBe(1);
    expect(journal?.startArea).toBe('Mersin');
  });

  it('ROTA İZİ VE KOORDİNAT yüke GİRMEZ (gizlilik kilidi)', async () => {
    sealJournal('trip-1', 1_757_605_700_000);

    tripUploadRuntime.start();
    _history = [tripRecord('trip-1')];
    _stateCb?.(snapshot());
    await settle();

    const payload = JSON.stringify(lastUpload() ?? {});
    for (const forbidden of ['route', 'polyline', 'lat', 'lon', 'dlat', 'dlon']) {
      expect(payload.toLowerCase()).not.toContain(`"${forbidden}"`);
    }
    /* Gerçek koordinat değerleri de sızmamalı. */
    expect(payload).not.toContain('36.9177');
    expect(payload).not.toContain('34.6415');
  });

  it('alan adı çözülemezse UYDURULMAZ — alan hiç konmaz', async () => {
    _geoReply = null;
    sealJournal('trip-1', 1_757_605_700_000);

    tripUploadRuntime.start();
    _history = [tripRecord('trip-1')];
    _stateCb?.(snapshot());
    await settle();

    const journal = lastUpload()?.p_journal as Record<string, unknown> | undefined;
    expect(journal?.startArea).toBeUndefined();
    expect(journal?.endArea).toBeUndefined();
    /* Yolculuk yine de YÜKLENİR — alan adı bir süslemedir. */
    expect(lastUpload()?.p_trip_key).toBeDefined();
  });

  it('defter kaydı yoksa yük boş kalır ama yolculuk yine yüklenir', async () => {
    tripUploadRuntime.start();
    _history = [tripRecord('trip-yok')];
    _stateCb?.(snapshot());
    await settle();

    expect(lastUpload()?.p_journal).toEqual({});
    expect(lastUpload()?.p_trip_id).toBe('trip-yok');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. BEKLEYEN SENKRON KURTARMA
 * ════════════════════════════════════════════════════════════════════════ */

describe('bekleyen senkron kurtarma', () => {
  it('açılıştan ÖNCE kapanmış ve hiç yüklenmemiş yolculuk KURTARILIR', async () => {
    /* Çevrimdışıyken yolculuk kapandı, sonra uygulama kapandı:
       geçmişte kayıt VAR, yükleme defterinde kayıt YOK. */
    sealJournal('trip-offline', 1_757_605_700_000);
    _history = [tripRecord('trip-offline')];

    tripUploadRuntime.start();
    await settle(12);

    expect(lastUpload()?.p_trip_id).toBe('trip-offline');
  });

  it('defterde kaydı OLAN geçmiş trip yeniden gönderilmez', async () => {
    sealJournal('trip-done', 1_757_605_700_000);
    _history = [tripRecord('trip-done')];

    /* Birinci açılış: yüklendi ve defter kalıcılaştı. */
    tripUploadRuntime.start();
    await settle(12);
    const firstCount = _calls.length;
    expect(firstCount).toBeGreaterThan(0);
    tripUploadRuntime.stop();

    /* İkinci açılış: AYNI geçmiş — yeni çağrı OLMAMALI. */
    tripUploadRuntime.start();
    await settle(12);
    expect(_calls.length).toBe(firstCount);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. İDEMPOTENS VE HATA YALITIMI
 * ════════════════════════════════════════════════════════════════════════ */

describe('idempotens ve hata yalıtımı', () => {
  it('sunucu DUPLICATE derse BAŞARI sayılır, tekrar denenmez', async () => {
    _rpcReply = { state: 'DUPLICATE', serverRevision: 3 };
    sealJournal('trip-dup', 1_757_605_700_000);
    _history = [tripRecord('trip-dup')];

    tripUploadRuntime.start();
    await settle(12);
    const after = _calls.length;

    /* Aynı durum yeniden yayınlansa da ikinci gönderim OLMAZ. */
    _stateCb?.(snapshot());
    await settle(12);
    expect(_calls.length).toBe(after);

    const snap = tripUploadRuntime.getSnapshot();
    expect(snap.duplicateCount).toBe(1);
    expect(snap.failedCount).toBe(0);
  });

  it('bulut düşse bile YEREL yolculuk ve ham kanıt geçersiz SAYILMAZ', async () => {
    _rpcReply = new Error('ag yok');
    sealJournal('trip-net', 1_757_605_700_000);
    _history = [tripRecord('trip-net')];

    tripUploadRuntime.start();
    await settle(12);

    /* Yükleme başarısız — ama yerel kanıt yerinde ve okunabilir. */
    expect(readJournal('trip-net')?.endReason).toBe('IDLE_WINDOW');
    expect(_history).toHaveLength(1);

    const snap = tripUploadRuntime.getSnapshot();
    expect(snap.uploadedCount).toBe(0);
    expect(snap.lastFailureAtMs).not.toBeNull();
  });

  it('yeniden deneme bütçesi SINIRLIDIR — sonsuz döngü yok', async () => {
    _rpcReply = null;   // taşıma hatası (ağ/HTTP)
    sealJournal('trip-retry', 1_757_605_700_000);
    _history = [tripRecord('trip-retry')];

    tripUploadRuntime.start();
    await settle(12);

    for (let i = 0; i < 12; i += 1) {
      _stateCb?.(snapshot());
      await settle(6);
    }

    const snap = tripUploadRuntime.getSnapshot();
    const entry = snap.entries[0];
    expect(entry).toBeDefined();
    expect(entry!.attempts).toBeLessThanOrEqual(5);
    expect(_calls.length).toBeLessThanOrEqual(5);
  });
});
