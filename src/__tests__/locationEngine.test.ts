/**
 * locationEngine.test.ts — ÇOK KAYNAKLI KONUM MOTORU KİLİTLERİ.
 *
 * Kilitlenen sözleşmeler:
 *   §2 her kaynak AYNI modeli üretir · yarım konum yoktur
 *   §4 TEK FIX `HIGH` DEĞİLDİR · en zayıf kanıt tavanı belirler
 *   §5 kaynak geçişi TİTREŞMEZ (dwell + demote grace + öncelik)
 *   §6 `LIVE·STALE·LAST_KNOWN·OFFLINE·UNKNOWN` ayrı gerçeklerdir
 *   LAST_KNOWN ASLA `LIVE` olmaz · kanıt yoksa `null` (tahmin YOK)
 */

import { describe, it, expect } from 'vitest';
import {
  buildRawSample,
  sanitizeField,
  providerPriority,
  isLocationProviderId,
  normalizeErrorKind,
  LOCATION_PROVIDERS,
  type LocationProviderStatus,
  type RawLocationSample,
} from '../platform/location/locationProvider';
import {
  deriveConfidence,
  deriveLocationState,
  classifyAccuracy,
  weakest,
  locationStateLabel,
  confidenceLabel,
  providerLabel,
  FRESHNESS_MS,
  STREAK,
} from '../platform/location/locationConfidence';
import {
  LocationArbiter,
  DEMOTE_GRACE_MS,
  MIN_DWELL_MS,
  CANDIDATE_MAX_AGE_MS,
} from '../platform/location/locationArbiter';

const NOW = 1_700_000_000_000;

/** Geçerli ham örnek üreticisi. */
function raw(
  provider: RawLocationSample['provider'],
  over: Partial<RawLocationSample> = {},
): RawLocationSample {
  return {
    latitude: 41.015, longitude: 28.979,
    accuracyM: 8, headingDeg: 180, speedMps: 12,
    timestampMs: NOW, provider,
    ...over,
  };
}

function status(
  id: LocationProviderStatus['id'],
  over: Partial<LocationProviderStatus> = {},
): LocationProviderStatus {
  return {
    id, available: true, sample: raw(id),
    errorCount: 0, lastErrorKind: null,
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════ */

describe('§2 · sağlayıcı sözleşmesi', () => {
  it('1. 🔒 dört kaynak öncelik sırasıyla tanımlı', () => {
    expect([...LOCATION_PROVIDERS]).toEqual([
      'EXTERNAL_GPS', 'HEAD_UNIT_GPS', 'PHONE_HUB_GPS', 'LAST_KNOWN',
    ]);
    expect(providerPriority('EXTERNAL_GPS')).toBeLessThan(providerPriority('HEAD_UNIT_GPS'));
    expect(providerPriority('HEAD_UNIT_GPS')).toBeLessThan(providerPriority('PHONE_HUB_GPS'));
    expect(providerPriority('PHONE_HUB_GPS')).toBeLessThan(providerPriority('LAST_KNOWN'));
  });

  it('2. 🔒 geçerli girdi tam örnek üretir', () => {
    const s = buildRawSample(
      { latitude: 41, longitude: 29, accuracyM: 5, headingDeg: 90, speedMps: 10, timestampMs: NOW },
      'HEAD_UNIT_GPS',
    );
    expect(s).not.toBeNull();
    expect(s!.provider).toBe('HEAD_UNIT_GPS');
    expect(s!.accuracyM).toBe(5);
  });

  it('3. 🔒 GEÇERSİZ KOORDİNAT → TÜM örnek reddedilir (yarım konum YOK)', () => {
    expect(buildRawSample({ latitude: 91, longitude: 29, timestampMs: NOW }, 'HEAD_UNIT_GPS')).toBeNull();
    expect(buildRawSample({ latitude: 41, longitude: 181, timestampMs: NOW }, 'HEAD_UNIT_GPS')).toBeNull();
    expect(buildRawSample({ latitude: NaN, longitude: 29, timestampMs: NOW }, 'HEAD_UNIT_GPS')).toBeNull();
    expect(buildRawSample({ longitude: 29, timestampMs: NOW }, 'HEAD_UNIT_GPS')).toBeNull();
  });

  it('4. 🔒 zaman damgası yoksa örnek REDDEDİLİR (tazelik kurulamaz)', () => {
    expect(buildRawSample({ latitude: 41, longitude: 29 }, 'HEAD_UNIT_GPS')).toBeNull();
    expect(buildRawSample({ latitude: 41, longitude: 29, timestampMs: NaN }, 'HEAD_UNIT_GPS')).toBeNull();
  });

  it('5. 🔒 yardımcı alan geçersizse YALNIZ o alan null olur', () => {
    const s = buildRawSample(
      { latitude: 41, longitude: 29, accuracyM: -5, headingDeg: 400, speedMps: 999, timestampMs: NOW },
      'HEAD_UNIT_GPS',
    );
    expect(s).not.toBeNull();
    expect(s!.accuracyM).toBeNull();
    expect(s!.headingDeg).toBeNull();
    expect(s!.speedMps).toBeNull();
  });

  it('6. 🔒 accuracy 0 REDDEDİLİR (fiziksel olarak imkânsız)', () => {
    expect(sanitizeField(0, 'accuracyM')).toBeNull();
    expect(sanitizeField(0.5, 'accuracyM')).toBe(0.5);
  });

  it('7. 🔒 ölçülen hız 0 GEÇERLİDİR (durağan araç)', () => {
    const s = buildRawSample(
      { latitude: 41, longitude: 29, speedMps: 0, timestampMs: NOW }, 'HEAD_UNIT_GPS',
    );
    expect(s!.speedMps).toBe(0);
  });

  it('8. 🔒 tanınmayan sağlayıcı/hata sınıfı UYDURULMAZ', () => {
    expect(isLocationProviderId('SIHIR')).toBe(false);
    expect(isLocationProviderId('EXTERNAL_GPS')).toBe(true);
    expect(normalizeErrorKind('SIHIR')).toBe('UNKNOWN');
    expect(normalizeErrorKind('TIMEOUT')).toBe('TIMEOUT');
  });
});

describe('§4 · TEK FIX HIGH DEĞİLDİR', () => {
  it('9. 🔒 mükemmel hassasiyet + taze ama TEK fix → MEDIUM', () => {
    const c = deriveConfidence({ sample: raw('HEAD_UNIT_GPS', { accuracyM: 3 }), nowMs: NOW, streak: 1 });
    expect(c).toBe('MEDIUM');
    expect(c).not.toBe('HIGH');
    expect(c).not.toBe('VERY_HIGH');
  });

  it('10. 🔒 süreklilik eşiği aşılınca HIGH mümkün olur', () => {
    expect(deriveConfidence({
      sample: raw('HEAD_UNIT_GPS', { accuracyM: 20 }), nowMs: NOW, streak: STREAK.MIN_FOR_HIGH,
    })).toBe('HIGH');
  });

  it('11. 🔒 VERY_HIGH üç kanıtın TAMAMINI ister', () => {
    expect(deriveConfidence({
      sample: raw('HEAD_UNIT_GPS', { accuracyM: 5 }), nowMs: NOW, streak: STREAK.MIN_FOR_VERY_HIGH,
    })).toBe('VERY_HIGH');
    // Hassasiyet düşerse tavan iner.
    expect(deriveConfidence({
      sample: raw('HEAD_UNIT_GPS', { accuracyM: 20 }), nowMs: NOW, streak: 10,
    })).toBe('HIGH');
  });

  it('12. 🔒 EN ZAYIF kanıt tavanı belirler', () => {
    // Kaba hassasiyet + uzun süreklilik → LOW (hassasiyet tavanı kazanır)
    expect(deriveConfidence({
      sample: raw('HEAD_UNIT_GPS', { accuracyM: 500 }), nowMs: NOW, streak: 50,
    })).toBe('LOW');
    // Bayat + mükemmel hassasiyet → LOW (tazelik tavanı kazanır)
    expect(deriveConfidence({
      sample: raw('HEAD_UNIT_GPS', { accuracyM: 3, timestampMs: NOW - 60_000 }),
      nowMs: NOW, streak: 50,
    })).toBe('LOW');
    expect(weakest('VERY_HIGH', 'LOW')).toBe('LOW');
  });

  it('13. 🔒 hassasiyet BİLİNMİYORSA yüksek İDDİA EDİLMEZ', () => {
    expect(deriveConfidence({
      sample: raw('HEAD_UNIT_GPS', { accuracyM: null }), nowMs: NOW, streak: 50,
    })).toBe('MEDIUM');
  });

  it('14. 🔒 LAST_KNOWN tavanı LOW\'dur (ne kadar hassas olsa da)', () => {
    expect(deriveConfidence({
      sample: raw('LAST_KNOWN', { accuracyM: 2 }), nowMs: NOW, streak: 100,
    })).toBe('LOW');
  });

  it('15. 🔒 GELECEKTEN gelen fix UNKNOWN (saat kayması)', () => {
    expect(deriveConfidence({
      sample: raw('HEAD_UNIT_GPS', { timestampMs: NOW + 60_000 }), nowMs: NOW, streak: 10,
    })).toBe('UNKNOWN');
  });

  it('16. 🔒 hassasiyet kovaları', () => {
    expect(classifyAccuracy(5)).toBe('EXCELLENT');
    expect(classifyAccuracy(20)).toBe('GOOD');
    expect(classifyAccuracy(50)).toBe('FAIR');
    expect(classifyAccuracy(500)).toBe('COARSE');
    expect(classifyAccuracy(null)).toBe('UNKNOWN');
  });
});

describe('§6 · konum durumu', () => {
  it('17. 🔒 taze fix LIVE', () => {
    expect(deriveLocationState({ sample: raw('HEAD_UNIT_GPS'), nowMs: NOW, readable: true }))
      .toBe('LIVE');
  });

  it('18. 🔒 tazelik penceresi geçince STALE', () => {
    expect(deriveLocationState({
      sample: raw('HEAD_UNIT_GPS', { timestampMs: NOW - FRESHNESS_MS.STALE_AFTER - 1_000 }),
      nowMs: NOW, readable: true,
    })).toBe('STALE');
  });

  it('19. 🔒 kaynak tamamen susarsa OFFLINE', () => {
    expect(deriveLocationState({
      sample: raw('HEAD_UNIT_GPS', { timestampMs: NOW - FRESHNESS_MS.OFFLINE_AFTER - 1_000 }),
      nowMs: NOW, readable: true,
    })).toBe('OFFLINE');
  });

  it('20. 🔒 LAST_KNOWN ASLA LIVE olmaz (taze görünse bile)', () => {
    expect(deriveLocationState({
      sample: raw('LAST_KNOWN', { timestampMs: NOW }), nowMs: NOW, readable: true,
    })).toBe('LAST_KNOWN');
  });

  it('21. 🔒 okunamadı ve kanıt yok → UNKNOWN', () => {
    expect(deriveLocationState({ sample: raw('HEAD_UNIT_GPS'), nowMs: NOW, readable: false }))
      .toBe('UNKNOWN');
    expect(deriveLocationState({ sample: null, nowMs: NOW, readable: true })).toBe('UNKNOWN');
  });

  it('22. 🔒 etiketler eski veriyi CANLI gibi sunmuyor', () => {
    expect(locationStateLabel('LIVE')).toBe('Canlı konum');
    expect(locationStateLabel('LAST_KNOWN')).toBe('Son bilinen konum');
    expect(locationStateLabel('STALE')).toBe('Konum güncel değil');
    expect(confidenceLabel('UNKNOWN')).toBe('Bilinmiyor');
    expect(providerLabel('EXTERNAL_GPS')).toBe('Harici GPS');
  });
});

describe('§3+§5 · kaynak seçimi ve öncelik', () => {
  it('23. 🔒 harici GPS varsa O seçilir (en yüksek öncelik)', () => {
    const a = new LocationArbiter();
    const d = a.tick({ nowMs: NOW, providers: [status('HEAD_UNIT_GPS'), status('EXTERNAL_GPS')] });
    expect(d.activeProvider).toBe('EXTERNAL_GPS');
    expect(d.switched).toBe(true);
    expect(d.fellBack).toBe(false);
  });

  it('24. 🔒 harici yoksa HEAD UNIT\'e düşer', () => {
    const a = new LocationArbiter();
    const d = a.tick({
      nowMs: NOW,
      providers: [status('EXTERNAL_GPS', { available: false, sample: null }), status('HEAD_UNIT_GPS')],
    });
    expect(d.activeProvider).toBe('HEAD_UNIT_GPS');
  });

  it('25. 🔒 ikisi de yoksa PHONE HUB\'a düşer', () => {
    const a = new LocationArbiter();
    const d = a.tick({
      nowMs: NOW,
      providers: [
        status('EXTERNAL_GPS', { available: false, sample: null }),
        status('HEAD_UNIT_GPS', { available: false, sample: null }),
        status('PHONE_HUB_GPS'),
      ],
    });
    expect(d.activeProvider).toBe('PHONE_HUB_GPS');
  });

  it('26. 🔒 hiçbir canlı kaynak yoksa LAST_KNOWN kullanılır', () => {
    const a = new LocationArbiter();
    const d = a.tick({
      nowMs: NOW,
      providers: [
        status('HEAD_UNIT_GPS', { available: false, sample: null }),
        status('LAST_KNOWN', { sample: raw('LAST_KNOWN', { timestampMs: NOW - 120_000 }) }),
      ],
    });
    expect(d.activeProvider).toBe('LAST_KNOWN');
    expect(d.state).toBe('LAST_KNOWN');
    expect(d.sample!.confidence).toBe('LOW');
  });

  it('27. 🔒 HİÇ kaynak yoksa konum UYDURULMAZ', () => {
    const a = new LocationArbiter();
    const d = a.tick({ nowMs: NOW, providers: [] });
    expect(d.sample).toBeNull();
    expect(d.state).toBe('UNKNOWN');
    expect(d.activeProvider).toBeNull();
    expect(d.holdReason).toBe('NO_CANDIDATE');
  });

  it('28. 🔒 BAYAT örnek aday olamaz (ama LAST_KNOWN muaf)', () => {
    const a = new LocationArbiter();
    const d = a.tick({
      nowMs: NOW,
      providers: [status('HEAD_UNIT_GPS', {
        sample: raw('HEAD_UNIT_GPS', { timestampMs: NOW - CANDIDATE_MAX_AGE_MS - 5_000 }),
      })],
    });
    expect(d.sample).toBeNull();
    expect(d.holdReason).toBe('NO_CANDIDATE');
  });
});

describe('§5 · TİTREŞİM (flapping) kontrolü', () => {
  it('29. 🔒 dwell içinde YÜKSELTME bile ERTELENİR', () => {
    const a = new LocationArbiter();
    a.tick({ nowMs: NOW, providers: [status('HEAD_UNIT_GPS')] });
    // Hemen ardından harici gelirse dwell dolmadığı için beklenir.
    const d = a.tick({
      nowMs: NOW + 500,
      providers: [status('HEAD_UNIT_GPS'), status('EXTERNAL_GPS', {
        sample: raw('EXTERNAL_GPS', { timestampMs: NOW + 500 }),
      })],
    });
    expect(d.activeProvider).toBe('HEAD_UNIT_GPS');
    expect(d.holdReason).toBe('DWELL');
    expect(d.switched).toBe(false);
  });

  it('30. 🔒 dwell dolunca yükseltme GERÇEKLEŞİR', () => {
    const a = new LocationArbiter();
    a.tick({ nowMs: NOW, providers: [status('HEAD_UNIT_GPS')] });
    const t = NOW + MIN_DWELL_MS + 100;
    const d = a.tick({
      nowMs: t,
      providers: [
        status('HEAD_UNIT_GPS', { sample: raw('HEAD_UNIT_GPS', { timestampMs: t }) }),
        status('EXTERNAL_GPS', { sample: raw('EXTERNAL_GPS', { timestampMs: t }) }),
      ],
    });
    expect(d.activeProvider).toBe('EXTERNAL_GPS');
    expect(d.switched).toBe(true);
    expect(d.fellBack).toBe(false);
  });

  it('31. 🔒 DÜŞÜRME için toparlanma süresi beklenir (anında düşmez)', () => {
    const a = new LocationArbiter();
    // Harici aktif olsun (dwell dolsun).
    a.tick({ nowMs: NOW, providers: [status('EXTERNAL_GPS')] });
    const t1 = NOW + MIN_DWELL_MS + 100;
    a.tick({ nowMs: t1, providers: [status('EXTERNAL_GPS', { sample: raw('EXTERNAL_GPS', { timestampMs: t1 }) })] });

    // Harici sustu, head unit var → HEMEN düşmemeli.
    const t2 = t1 + 1_000;
    const d = a.tick({
      nowMs: t2,
      providers: [
        status('EXTERNAL_GPS', { available: false, sample: null }),
        status('HEAD_UNIT_GPS', { sample: raw('HEAD_UNIT_GPS', { timestampMs: t2 }) }),
      ],
    });
    expect(d.activeProvider).toBe('EXTERNAL_GPS');
    expect(d.holdReason).toBe('DEMOTE_GRACE');
  });

  it('32. 🔒 toparlanma süresi dolunca fallback GERÇEKLEŞİR ve SAYILIR', () => {
    const a = new LocationArbiter();
    a.tick({ nowMs: NOW, providers: [status('EXTERNAL_GPS')] });
    const t1 = NOW + MIN_DWELL_MS + 100;
    a.tick({ nowMs: t1, providers: [status('EXTERNAL_GPS', { sample: raw('EXTERNAL_GPS', { timestampMs: t1 }) })] });

    const t2 = t1 + DEMOTE_GRACE_MS + 1_000;
    const d = a.tick({
      nowMs: t2,
      providers: [
        status('EXTERNAL_GPS', { available: false, sample: null }),
        status('HEAD_UNIT_GPS', { sample: raw('HEAD_UNIT_GPS', { timestampMs: t2 }) }),
      ],
    });
    expect(d.activeProvider).toBe('HEAD_UNIT_GPS');
    expect(d.switched).toBe(true);
    expect(d.fellBack).toBe(true);
    expect(a.getSnapshot().fallbackCount).toBe(1);
  });

  it('33. 🔒 ZIPLAYAN iki kaynak TİTREŞİM ÜRETMEZ (sınırlı geçiş)', () => {
    const a = new LocationArbiter();
    let t = NOW;
    // 40 tick boyunca harici kaynak dönüşümlü olarak var/yok oluyor.
    for (let i = 0; i < 40; i += 1) {
      const externalUp = i % 2 === 0;
      a.tick({
        nowMs: t,
        providers: [
          status('EXTERNAL_GPS', externalUp
            ? { sample: raw('EXTERNAL_GPS', { timestampMs: t }) }
            : { available: false, sample: null }),
          status('HEAD_UNIT_GPS', { sample: raw('HEAD_UNIT_GPS', { timestampMs: t }) }),
        ],
      });
      t += 500;   // 2 Hz
    }
    // 20 saniyede 40 tick → kapılar olmasaydı ~40 geçiş olurdu.
    const snap = a.getSnapshot();
    expect(snap.switchCount).toBeLessThanOrEqual(6);
    expect(snap.switchCount).toBeGreaterThan(0);
  });

  it('34. 🔒 kaynak değişince SÜREKLİLİK sıfırlanır (yeni kaynak tek fix)', () => {
    const a = new LocationArbiter();
    let t = NOW;
    // Head unit uzun süre çalışsın → yüksek streak.
    for (let i = 0; i < 8; i += 1) {
      a.tick({ nowMs: t, providers: [status('HEAD_UNIT_GPS', { sample: raw('HEAD_UNIT_GPS', { timestampMs: t }) })] });
      t += 1_000;
    }
    expect(a.getSnapshot().sample!.confidence).toBe('VERY_HIGH');

    // Harici gelir → geçiş olur, güven DÜŞER (yeni kaynağın kanıtı yok).
    const d = a.tick({
      nowMs: t,
      providers: [
        status('HEAD_UNIT_GPS', { sample: raw('HEAD_UNIT_GPS', { timestampMs: t }) }),
        status('EXTERNAL_GPS', { sample: raw('EXTERNAL_GPS', { timestampMs: t, accuracyM: 4 }) }),
      ],
    });
    expect(d.switched).toBe(true);
    expect(d.sample!.confidence).toBe('MEDIUM');
  });
});

describe('§7 · gözlemlenebilirlik ve dayanıklılık', () => {
  it('35. 🔒 sağlayıcı hataları SAYILIR ve sınıfı taşınır', () => {
    const a = new LocationArbiter();
    a.tick({
      nowMs: NOW,
      providers: [
        status('EXTERNAL_GPS', {
          available: false, sample: null, errorCount: 3, lastErrorKind: 'TRANSPORT_LOST',
        }),
        status('HEAD_UNIT_GPS'),
      ],
    });
    const snap = a.getSnapshot();
    expect(snap.providerErrors.EXTERNAL_GPS.count).toBe(3);
    expect(snap.providerErrors.EXTERNAL_GPS.lastKind).toBe('TRANSPORT_LOST');
    expect(snap.providerAvailability.EXTERNAL_GPS).toBe(false);
    expect(snap.providerAvailability.HEAD_UNIT_GPS).toBe(true);
  });

  it('36. 🔒 anlık görüntü ASLA fırlatmaz ve uydurma değer vermez', () => {
    const a = new LocationArbiter();
    const snap = a.getSnapshot();
    expect(() => a.getSnapshot()).not.toThrow();
    expect(snap.activeProvider).toBeNull();
    expect(snap.sample).toBeNull();
    expect(snap.state).toBe('UNKNOWN');
    expect(snap.lastDecisionAtMs).toBeNull();
    expect(snap.switchCount).toBe(0);
  });

  it('37. 🔒 tick ASLA fırlatmaz (bozuk girdide bile)', () => {
    const a = new LocationArbiter();
    const bad = { id: 'HEAD_UNIT_GPS', available: true, sample: null,
                  errorCount: 0, lastErrorKind: null } as LocationProviderStatus;
    expect(() => a.tick({ nowMs: NaN, providers: [bad] })).not.toThrow();
    expect(() => a.tick({ nowMs: NOW, providers: [] })).not.toThrow();
  });

  it('38. 🔒 RECONNECT: kaynak dönünce aynı sağlayıcı sürdürülür', () => {
    const a = new LocationArbiter();
    let t = NOW;
    a.tick({ nowMs: t, providers: [status('HEAD_UNIT_GPS')] });
    t += MIN_DWELL_MS + 100;
    // Kısa kesinti (grace içinde) → sağlayıcı KORUNUR.
    a.tick({ nowMs: t, providers: [status('HEAD_UNIT_GPS', { available: false, sample: null })] });
    expect(a.getSnapshot().activeProvider).toBe('HEAD_UNIT_GPS');
    // Geri döndü → geçiş SAYILMAZ (aynı sağlayıcı).
    t += 1_000;
    const d = a.tick({ nowMs: t, providers: [status('HEAD_UNIT_GPS', { sample: raw('HEAD_UNIT_GPS', { timestampMs: t }) })] });
    expect(d.switched).toBe(false);
    expect(a.getSnapshot().switchCount).toBe(1);   // yalnız ilk seçim
  });

  it('39. 🔒 reset durumu temizler ama TANI SAYAÇLARINI korur', () => {
    const a = new LocationArbiter();
    a.tick({ nowMs: NOW, providers: [status('HEAD_UNIT_GPS')] });
    const before = a.getSnapshot().switchCount;
    a.reset();
    const snap = a.getSnapshot();
    expect(snap.activeProvider).toBeNull();
    expect(snap.sample).toBeNull();
    expect(snap.state).toBe('UNKNOWN');
    expect(snap.switchCount).toBe(before);   // gözlem yalanlanmaz
  });

  it('40. 🔒 aynı fix tekrar gelirse süreklilik ŞİŞMEZ', () => {
    const a = new LocationArbiter();
    const s = status('HEAD_UNIT_GPS');
    for (let i = 0; i < 10; i += 1) {
      a.tick({ nowMs: NOW + i, providers: [s] });   // AYNI timestamp
    }
    // Tek gerçek fix → güven MEDIUM'u aşmamalı.
    expect(a.getSnapshot().streak).toBe(1);
    expect(a.getSnapshot().sample!.confidence).toBe('MEDIUM');
  });
});
