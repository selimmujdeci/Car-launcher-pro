/**
 * tripJournalView.test.ts — "ARABAM CEBİMDE" SEYİR DEFTERİ GÖRÜNÜM KİLİTLERİ.
 *
 * Kilitlenen sözleşmeler:
 *  · "Okunamadı" ile "yolculuk yok" ASLA aynı ekranı göstermez.
 *  · "Çevrimdışısınız" ile "yetkiniz yok" AYRI durumlardır.
 *  · Bilinmeyen metrik "Bilinmiyor" der — sahte `0` yoktur.
 *  · Bozuk tek satır bütün geçmişi düşürmez.
 *  · Anormal kapanış kullanıcıya AÇIKÇA söylenir.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveJournalSurfaceState, journalSurfaceMessage,
  buildJournalEntry, buildJournalList,
  formatJournalRoute, formatJournalDistance, formatJournalDuration,
  formatJournalSpeed, formatJournalScore, formatJournalTimeRange,
  journalEndReasonNote, journalConfidenceLabel, UNKNOWN_LABEL,
} from '../lib/tripJournalView';
import type { TripRow } from '../lib/fleet/vehicleTripsView';

const ROW: TripRow = {
  trip_key: 't1757600000-1757605700-6430',
  started_at: '2026-09-11T15:12:00.000Z',
  ended_at: '2026-09-11T16:47:00.000Z',
  completed_at: '2026-09-11T16:47:00.000Z',
  start_area: 'Tarsus',
  end_area: 'Mersin',
  distance_km: '64.3',
  duration_min: 95,
  moving_time_min: 78,
  idle_time_min: 17,
  avg_speed_kmh: '49',
  max_speed_kmh: '112',
  score: 86,
  end_reason: 'IDLE_WINDOW',
  confidence: 'HIGH',
};

/* ══════════════════════════════════════════════════════════════════════════
 * 1. YÜZEY DURUMU
 * ════════════════════════════════════════════════════════════════════════ */

describe('yüzey durumu', () => {
  const base = { hasVehicle: true, loading: false, failure: null, rowCount: 0 } as const;

  it('araç yoksa okuma durumu hiç sorulmaz', () => {
    expect(deriveJournalSurfaceState({ ...base, hasVehicle: false, loading: true }))
      .toBe('NO_VEHICLE');
  });

  it('yükleme sürerken hata gösterilmez — henüz hüküm yok', () => {
    expect(deriveJournalSurfaceState({ ...base, loading: true, failure: 'UNAVAILABLE' }))
      .toBe('LOADING');
  });

  it('BAŞARILI okuma + 0 satır = EMPTY (gerçekten yolculuk yok)', () => {
    expect(deriveJournalSurfaceState(base)).toBe('EMPTY');
  });

  it('OKUNAMADI, EMPTY olarak GÖSTERİLMEZ', () => {
    const s = deriveJournalSurfaceState({ ...base, failure: 'UNAVAILABLE', rowCount: null });
    expect(s).toBe('ERROR');
    expect(s).not.toBe('EMPTY');
    expect(journalSurfaceMessage(s)).toContain('yolculuğunuz olmadığı anlamına gelmez');
  });

  it('çevrimdışı ile yetkisiz AYRI durumlardır', () => {
    const off = deriveJournalSurfaceState({ ...base, failure: 'OFFLINE', rowCount: null });
    const unauth = deriveJournalSurfaceState({ ...base, failure: 'UNAUTHORIZED', rowCount: null });
    expect(off).toBe('OFFLINE');
    expect(unauth).toBe('UNAUTHORIZED');
    expect(journalSurfaceMessage(off)).not.toBe(journalSurfaceMessage(unauth));
  });

  it('yapılandırma eksikliği kullanıcıya "yetkiniz yok" DEMEZ', () => {
    expect(deriveJournalSurfaceState({ ...base, failure: 'NOT_CONFIGURED', rowCount: null }))
      .toBe('ERROR');
  });

  it('hiç okuma yapılmadıysa boş liste İDDİA EDİLMEZ', () => {
    expect(deriveJournalSurfaceState({ ...base, rowCount: null })).toBe('LOADING');
  });

  it('satır varsa READY', () => {
    expect(deriveJournalSurfaceState({ ...base, rowCount: 3 })).toBe('READY');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. SATIR DÖNÜŞÜMÜ
 * ════════════════════════════════════════════════════════════════════════ */

describe('satır dönüşümü', () => {
  it('tam satır eksiksiz okunur (numeric METİN gelebilir)', () => {
    const e = buildJournalEntry(ROW);
    expect(e).not.toBeNull();
    expect(e?.distanceKm).toBe(64.3);
    expect(e?.avgSpeedKmh).toBe(49);
    expect(e?.startArea).toBe('Tarsus');
    expect(e?.cleanEnd).toBe(true);
  });

  it('anahtarsız satır KULLANILAMAZ', () => {
    expect(buildJournalEntry({ ...ROW, trip_key: null })).toBeNull();
    expect(buildJournalEntry(null)).toBeNull();
  });

  it('eksik metrik `0` DEĞİL `null` olur', () => {
    const e = buildJournalEntry({ trip_key: 'k' });
    expect(e?.distanceKm).toBeNull();
    expect(e?.durationMin).toBeNull();
    expect(e?.score).toBeNull();
    expect(e?.startedAtMs).toBeNull();
  });

  it('negatif metrik ölçüm SAYILMAZ', () => {
    const e = buildJournalEntry({ trip_key: 'k', distance_km: -5, duration_min: -1 });
    expect(e?.distanceKm).toBeNull();
    expect(e?.durationMin).toBeNull();
  });

  it('çözülemeyen tarih UYDURULMAZ', () => {
    const e = buildJournalEntry({ trip_key: 'k', started_at: 'sacma' });
    expect(e?.startedAtMs).toBeNull();
  });

  it('completed_at, received_at ile KARIŞTIRILMAZ (ayrı alan)', () => {
    const e = buildJournalEntry({
      trip_key: 'k',
      completed_at: '2026-09-11T16:47:00.000Z',
      received_at: '2026-09-12T08:00:00.000Z',
    });
    expect(e?.completedAtMs).toBe(Date.parse('2026-09-11T16:47:00.000Z'));
  });

  it('eski kayıtta bitiş gerekçesi YOKSA düzgün kapanış İDDİA EDİLMEZ', () => {
    const e = buildJournalEntry({ trip_key: 'k' });
    expect(e?.endReason).toBeNull();
    expect(e?.cleanEnd).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. LİSTE
 * ════════════════════════════════════════════════════════════════════════ */

describe('liste kurulumu', () => {
  it('bozuk TEK satır bütün geçmişi DÜŞÜRMEZ', () => {
    const list = buildJournalList([ROW, null, { trip_key: null } as TripRow, { trip_key: 'k2' }]);
    expect(list).toHaveLength(2);
  });

  it('en yeni önce sıralanır', () => {
    const older: TripRow = { ...ROW, trip_key: 'eski', started_at: '2026-09-01T08:00:00.000Z' };
    const list = buildJournalList([older, ROW]);
    expect(list[0]?.tripKey).toBe(ROW.trip_key);
  });

  it('damgasız satır uydurma tarihle ÖNE ÇEKİLMEZ', () => {
    const undated: TripRow = { trip_key: 'damgasiz' };
    const list = buildJournalList([undated, ROW]);
    expect(list[0]?.tripKey).toBe(ROW.trip_key);
    expect(list[1]?.tripKey).toBe('damgasiz');
  });

  it('aynı yolculuk iki kez listelenmez', () => {
    expect(buildJournalList([ROW, { ...ROW }])).toHaveLength(1);
  });

  it('liste girdisi olmayan çağrı boş dizi döner', () => {
    expect(buildJournalList(null)).toEqual([]);
    expect(buildJournalList(undefined)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. BİÇİMLENDİRME
 * ════════════════════════════════════════════════════════════════════════ */

describe('biçimlendirme', () => {
  const entry = buildJournalEntry(ROW)!;

  it('liste satırı beklenen biçimleri üretir', () => {
    expect(formatJournalRoute(entry)).toBe('Tarsus → Mersin');
    expect(formatJournalDistance(entry.distanceKm)).toBe('64.3 km');
    expect(formatJournalDuration(entry.durationMin)).toBe('1 sa 35 dk');
    expect(formatJournalSpeed(entry.avgSpeedKmh)).toBe('49 km/sa');
    expect(formatJournalSpeed(entry.maxSpeedKmh)).toBe('112 km/sa');
    expect(formatJournalScore(entry.score)).toBe('86');
  });

  it('bilinmeyen değerler "Bilinmiyor" der — sahte 0 YOK', () => {
    expect(formatJournalDistance(null)).toBe(UNKNOWN_LABEL);
    expect(formatJournalDuration(null)).toBe(UNKNOWN_LABEL);
    expect(formatJournalSpeed(null)).toBe(UNKNOWN_LABEL);
    expect(formatJournalScore(null)).toBe(UNKNOWN_LABEL);
    expect(formatJournalDistance(null)).not.toContain('0');
  });

  it('iki uç da bilinmiyorsa tek "Bilinmiyor" gösterilir', () => {
    const e = buildJournalEntry({ trip_key: 'k' })!;
    expect(formatJournalRoute(e)).toBe(UNKNOWN_LABEL);
  });

  it('tek uç biliniyorsa öteki uç AÇIKÇA bilinmiyor gösterilir', () => {
    const e = buildJournalEntry({ trip_key: 'k', start_area: 'Tarsus' })!;
    expect(formatJournalRoute(e)).toBe(`Tarsus → ${UNKNOWN_LABEL}`);
  });

  it('bilinmeyen saat gizlenmez, `--:--` gösterilir', () => {
    const e = buildJournalEntry({ trip_key: 'k' })!;
    expect(formatJournalTimeRange(e)).toBe('--:-- → --:--');
  });

  it('60 dk altı süre saat cinsinden yazılmaz', () => {
    expect(formatJournalDuration(42)).toBe('42 dk');
    expect(formatJournalDuration(120)).toBe('2 sa');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. ANORMAL KAPANIŞ VE DOĞRULUK
 * ════════════════════════════════════════════════════════════════════════ */

describe('kapanış gerekçesi ve doğruluk', () => {
  it('düzgün kapanışta not gösterilmez (gürültü yok)', () => {
    expect(journalEndReasonNote(buildJournalEntry(ROW)!)).toBeNull();
  });

  it('veri kesilmesi kullanıcıya AÇIKÇA söylenir', () => {
    const e = buildJournalEntry({ ...ROW, end_reason: 'DATA_SILENCE' })!;
    expect(e.cleanEnd).toBe(false);
    expect(journalEndReasonNote(e)).toContain('eksik olabilir');
  });

  it('uygulama kapanması "düzgün kapanış" SAYILMAZ', () => {
    const e = buildJournalEntry({ ...ROW, end_reason: 'SERVICE_STOPPED' })!;
    expect(e.cleanEnd).toBe(false);
    expect(journalEndReasonNote(e)).not.toBeNull();
  });

  it('normal doğruluk rozet TAŞIMAZ; düşük doğruluk söylenir', () => {
    expect(journalConfidenceLabel(buildJournalEntry(ROW)!)).toBeNull();
    expect(journalConfidenceLabel(buildJournalEntry({ ...ROW, confidence: 'LOW' })!))
      .toBe('Düşük doğruluk');
    expect(journalConfidenceLabel(buildJournalEntry({ ...ROW, confidence: 'UNKNOWN' })!))
      .toBe('Doğruluk bilinmiyor');
  });
});
