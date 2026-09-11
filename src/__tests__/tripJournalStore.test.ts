/**
 * tripJournalStore.test.ts — YEREL SEYİR KAYDI KİLİTLERİ.
 *
 * Kilitlenen sözleşmeler:
 *  · Ham kanıt (rota · duruş · konum) CİHAZDA kalır ve türetilmiş özetten AYRIDIR.
 *  · Kısa duruş yolculuğu bölmez; duruş başı/sonu mühürlenir.
 *  · Çökme sonrası taslak KURTARILIR ve gerekçesi `UNKNOWN` olur (uydurma
 *    "düzgün kapanış" YOK).
 *  · Depo büyümesi sınırlıdır (retention · nokta tavanı · bayt tavanı).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/* ── Bellek içi safeStorage ikizi ─────────────────────────────── */

const _mem = new Map<string, string>();

vi.mock('../utils/safeStorage', () => ({
  safeGetRaw: vi.fn((k: string) => _mem.get(k) ?? null),
  safeSetRaw: vi.fn((k: string, v: string) => {
    if (v === '') _mem.delete(k); else _mem.set(k, v);
  }),
  safeFlushKey: vi.fn(),
}));

import {
  beginJournal, finalizeJournal, recordJournalFix, recordJournalStopState,
  recordJournalEvent, readJournal, listJournalIds, readOpenJournal,
  recoverOpenJournal, attachJournalAreas, _resetJournalForTest,
  MAX_JOURNAL_RECORDS,
} from '../platform/trip/tripJournalStore';
import { decodeRouteTrace } from '../platform/trip/tripJournalModel';

const EV = { sampleCount: 3, spanMs: 4_000, sourceCount: 1 };

function open(tripId: string, startMono = 0): void {
  beginJournal({
    tripId, startedAtMs: 1_700_000_000_000, startMonoMs: startMono,
    startLocation: { lat: 36.90, lon: 34.60 }, motionEvidence: EV,
  });
}

beforeEach(() => {
  _mem.clear();
  _resetJournalForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * Yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

describe('seyir kaydı yaşam döngüsü', () => {
  it('açılan kayıt mühürlenince deftere yazılır', () => {
    open('trip-a');
    const rec = finalizeJournal({
      tripId: 'trip-a', endedAtMs: 1_700_000_600_000, endMonoMs: 600_000,
      endLocation: { lat: 36.81, lon: 34.64 }, endReason: 'IDLE_WINDOW',
    });

    expect(rec).not.toBeNull();
    expect(rec?.endReason).toBe('IDLE_WINDOW');
    expect(readJournal('trip-a')?.tripId).toBe('trip-a');
    expect(listJournalIds()).toContain('trip-a');
  });

  it('TÜRETİLMİŞ metrik saklamaz — kayıt yalnız HAM kanıt taşır', () => {
    open('trip-a');
    finalizeJournal({
      tripId: 'trip-a', endedAtMs: 2, endMonoMs: 1_000,
      endLocation: null, endReason: 'IDLE_WINDOW',
    });
    const rec = readJournal('trip-a') as unknown as Record<string, unknown>;
    for (const forbidden of ['distanceKm', 'durationMin', 'avgSpeedKmh', 'drivingScore']) {
      expect(rec[forbidden]).toBeUndefined();
    }
  });

  it('açık kayıt varken yeni yolculuk açılırsa eski kanıt ATILMAZ', () => {
    open('trip-a');
    open('trip-b', 10_000);
    expect(readJournal('trip-a')?.endReason).toBe('SERVICE_STOPPED');
    expect(readOpenJournal()?.tripId).toBe('trip-b');
  });

  it('tripId uyuşmazsa gerekçe İDDİA EDİLMEZ → UNKNOWN', () => {
    open('trip-a');
    const rec = finalizeJournal({
      tripId: 'baska-trip', endedAtMs: 2, endMonoMs: 1_000,
      endLocation: null, endReason: 'IDLE_WINDOW',
    });
    expect(rec?.endReason).toBe('UNKNOWN');
  });

  it('açık kayıt yokken mühürleme null döner', () => {
    expect(finalizeJournal({
      tripId: 'yok', endedAtMs: 1, endMonoMs: 1, endLocation: null,
      endReason: 'IDLE_WINDOW',
    })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Rota izi
 * ════════════════════════════════════════════════════════════════════════ */

describe('rota izi kaydı', () => {
  it('hareket hâlindeki ayrık fixler ize girer', () => {
    open('trip-r');
    expect(recordJournalFix({
      monoMs: 0, lat: 36.9000, lon: 34.6000, speedKmh: 50, stopped: false,
    })).toBe(true);
    expect(recordJournalFix({
      monoMs: 6_000, lat: 36.9010, lon: 34.6000, speedKmh: 55, stopped: false,
    })).toBe(true);

    const rec = finalizeJournal({
      tripId: 'trip-r', endedAtMs: 9, endMonoMs: 8_000,
      endLocation: null, endReason: 'IDLE_WINDOW',
    });
    expect(decodeRouteTrace(rec?.route)).toHaveLength(2);
  });

  it('DURURKEN saniyelik nokta yazılmaz (depo sözleşmesi)', () => {
    open('trip-r');
    recordJournalFix({ monoMs: 0, lat: 36.9, lon: 34.6, speedKmh: 0, stopped: true });
    for (let i = 1; i <= 30; i += 1) {
      recordJournalFix({
        monoMs: i * 1_000, lat: 36.9, lon: 34.6, speedKmh: 0, stopped: true,
      });
    }
    const rec = finalizeJournal({
      tripId: 'trip-r', endedAtMs: 1, endMonoMs: 31_000,
      endLocation: null, endReason: 'IDLE_WINDOW',
    });
    expect(decodeRouteTrace(rec?.route)).toHaveLength(1);
  });

  it('koordinatsız örnek (OBD) rota noktası ÜRETMEZ', () => {
    open('trip-r');
    expect(recordJournalFix({
      monoMs: 0, lat: null, lon: null, speedKmh: 60, stopped: false,
    })).toBe(false);
  });

  it('VARIŞ konumu örnekleme kısmasına kurban EDİLMEZ', () => {
    open('trip-r');
    recordJournalFix({ monoMs: 0, lat: 36.9, lon: 34.6, speedKmh: 50, stopped: false });
    /* Çok yakın → ize girmez ama son bilinen konumdur. */
    recordJournalFix({ monoMs: 1_000, lat: 36.90001, lon: 34.6, speedKmh: 50, stopped: false });

    const rec = finalizeJournal({
      tripId: 'trip-r', endedAtMs: 1, endMonoMs: 2_000,
      endLocation: null, endReason: 'IDLE_WINDOW',
    });
    expect(rec?.endLocation?.lat).toBeCloseTo(36.90001, 5);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Duruşlar
 * ════════════════════════════════════════════════════════════════════════ */

describe('duruş kaydı', () => {
  it('kısa duruş yolculuğu BÖLMEZ — tek kayıtta duruş olarak durur', () => {
    open('trip-s');
    recordJournalStopState(60_000, true);
    recordJournalStopState(105_000, false);

    const rec = finalizeJournal({
      tripId: 'trip-s', endedAtMs: 1, endMonoMs: 300_000,
      endLocation: null, endReason: 'IDLE_WINDOW',
    });
    expect(rec?.stops).toHaveLength(1);
    expect(rec?.stops[0]?.durationMs).toBe(45_000);
    expect(listJournalIds()).toHaveLength(1);
  });

  it('aynı duruş iki kez AÇILMAZ', () => {
    open('trip-s');
    recordJournalStopState(10_000, true);
    recordJournalStopState(20_000, true);
    expect(readOpenJournal()?.stopCount).toBe(1);
  });

  it('süren duruş yolculuk bitişinde kapanır', () => {
    open('trip-s');
    recordJournalStopState(60_000, true);
    const rec = finalizeJournal({
      tripId: 'trip-s', endedAtMs: 1, endMonoMs: 120_000,
      endLocation: null, endReason: 'IDLE_WINDOW',
    });
    expect(rec?.stops[0]?.endOffsetMs).toBe(120_000);
    expect(rec?.stops[0]?.durationMs).toBe(60_000);
  });

  it('duruş/devam olayları kaydedilir', () => {
    open('trip-s');
    recordJournalStopState(5_000, true);
    recordJournalStopState(9_000, false);
    recordJournalEvent(12_000, 'HARSH_BRAKE', 22);

    const rec = finalizeJournal({
      tripId: 'trip-s', endedAtMs: 1, endMonoMs: 20_000,
      endLocation: null, endReason: 'IDLE_WINDOW',
    });
    expect(rec?.events.map((e) => e.kind)).toEqual(['STOP', 'RESUME', 'HARSH_BRAKE']);
    expect(rec?.events[2]?.magnitude).toBe(22);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Çökme kurtarma
 * ════════════════════════════════════════════════════════════════════════ */

describe('çökme sonrası kurtarma', () => {
  it('mühürlenmemiş taslak kurtarılır ve gerekçesi UNKNOWN olur', () => {
    open('trip-c');
    recordJournalFix({ monoMs: 0, lat: 36.9, lon: 34.6, speedKmh: 50, stopped: false });
    /* Süreç çöktü: mühürleme HİÇ çağrılmadı, taslak diskte kaldı. */
    _resetJournalForTest();

    expect(recoverOpenJournal()).toBe('trip-c');
    const rec = readJournal('trip-c');
    expect(rec?.endReason).toBe('UNKNOWN');
    expect(rec?.endedAtMs).toBeNull();     // uydurma bitiş tarihi YOK
  });

  it('mühürlenmiş yolculuğun bayat taslağı üzerine YAZMAZ', () => {
    open('trip-c');
    finalizeJournal({
      tripId: 'trip-c', endedAtMs: 5, endMonoMs: 1_000,
      endLocation: null, endReason: 'IDLE_WINDOW',
    });
    expect(recoverOpenJournal()).toBeNull();
    expect(readJournal('trip-c')?.endReason).toBe('IDLE_WINDOW');
  });

  it('taslak yoksa hiçbir şey yapmaz', () => {
    expect(recoverOpenJournal()).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Sınırlı büyüme + alan adı
 * ════════════════════════════════════════════════════════════════════════ */

describe('depo sınırları', () => {
  it('defter tavanı aşılmaz — en eski kayıt düşer', () => {
    for (let i = 0; i < MAX_JOURNAL_RECORDS + 5; i += 1) {
      open(`trip-${i}`, i * 1_000);
      finalizeJournal({
        tripId: `trip-${i}`, endedAtMs: i, endMonoMs: i * 1_000 + 500,
        endLocation: null, endReason: 'IDLE_WINDOW',
      });
    }
    expect(listJournalIds()).toHaveLength(MAX_JOURNAL_RECORDS);
    expect(readJournal('trip-0')).toBeNull();
    expect(readJournal(`trip-${MAX_JOURNAL_RECORDS + 4}`)).not.toBeNull();
  });

  it('alan adı mühürden SONRA iliştirilebilir; yoksa uydurulmaz', () => {
    open('trip-area');
    finalizeJournal({
      tripId: 'trip-area', endedAtMs: 1, endMonoMs: 1_000,
      endLocation: null, endReason: 'IDLE_WINDOW',
    });
    expect(readJournal('trip-area')?.startArea).toBeNull();

    attachJournalAreas('trip-area', 'Tarsus', null);
    expect(readJournal('trip-area')?.startArea).toBe('Tarsus');
    expect(readJournal('trip-area')?.endArea).toBeNull();
  });

  it('olmayan kayda alan adı iliştirmek kayıt YARATMAZ', () => {
    attachJournalAreas('hic-yok', 'Mersin', 'Adana');
    expect(readJournal('hic-yok')).toBeNull();
  });
});
