/**
 * etaJumpLedger.test.ts — G3 ETA sıçrama defteri kilitleri (kütük #530).
 *
 * SAHA (2026-08-05, Konya→Tarsus): ETA aynı yolculukta 43 kez >60 s sıçradı,
 * en büyüğü 6 560 s (1 sa 49 dk); `etaS` aralığı 10 007 ↔ 16 764 s.
 * #441 kuş uçuşu mesafeyi ETA girdisinden çıkardı — ama düzeltme çarpanının
 * AÇILIP KAPANMASI başlı başına sıçrama üretir ve bu ölçülmemişti.
 *
 * Bu testler defterin ne İDDİA ETTİĞİNİ değil, ne KAYDETTİĞİNİ kilitler:
 * defter nedensellik iddia etmez, eşzamanlılık kaydeder.
 */
import { describe, it, expect } from 'vitest';
import {
  detectEtaJump, appendJump, summarizeJumps,
  ETA_JUMP_MIN_S, ETA_JUMP_RING, ETA_DOMINANT_MIN_SHARE,
  ETA_JUMP_TRIGGER_LABEL,
  type EtaSample, type EtaJumpRecord,
} from '../platform/navigation/core/etaJumpLedger';

function sample(over: Partial<EtaSample> = {}): EtaSample {
  return {
    atMs: 1_000,
    etaSeconds: 10_007,       // sahanın alt sınırı
    baseDurationS: 10_007,
    factor: 1,
    remainingDistanceM: 250_000,
    rollingAvgKmh: 94,        // saha hız medyanı
    routeRevision: 1,
    etaState: 'ROUTE_MODEL',
    ...over,
  };
}

describe('sıçrama tespiti — eşik ve yokluk', () => {
  it('🔒 eşik altı değişim sıçrama SAYILMAZ', () => {
    const a = sample();
    const b = sample({ atMs: 2_000, etaSeconds: 10_007 + (ETA_JUMP_MIN_S - 1) });
    expect(detectEtaJump(a, b)).toBeNull();
  });

  it('🔒 ETA ölçülemediyse kayıt ÜRETİLMEZ (sahte sıçrama yok)', () => {
    expect(detectEtaJump(sample(), sample({ etaSeconds: null }))).toBeNull();
    expect(detectEtaJump(sample({ etaSeconds: null }), sample())).toBeNull();
  });
});

describe('ayırma — hangi anahtar değişti', () => {
  it('🔒 mesafe kaynağı açılıp kapanınca DISTANCE_SOURCE_CHANGED', () => {
    /* Sahadaki asıl şüpheli: `distanceSource` ALONG_ROUTE değilken mesafe ETA'ya
       VERİLMEZ (#441) → düzeltme çarpanı 1'e düşer → ETA taban değere sıçrar. */
    const a = sample({ remainingDistanceM: 250_000, factor: 1.5, etaSeconds: 15_010 });
    const b = sample({ atMs: 2_000, remainingDistanceM: null, factor: 1, etaSeconds: 10_007 });
    const r = detectEtaJump(a, b);
    expect(r?.trigger).toBe('DISTANCE_SOURCE_CHANGED');
    expect(r?.deltaS).toBe(-5_003);
    expect(r?.factorFrom).toBe(1.5);
    expect(r?.factorTo).toBe(1);
  });

  it('🔒 hız kapısı 8 km/h eşiğini geçince SPEED_GATE_CHANGED', () => {
    const a = sample({ rollingAvgKmh: 12, factor: 1.2, etaSeconds: 12_008 });
    const b = sample({ atMs: 2_000, rollingAvgKmh: 4, factor: 1, etaSeconds: 10_007 });
    expect(detectEtaJump(a, b)?.trigger).toBe('SPEED_GATE_CHANGED');
  });

  it('🔒 reroute en güçlü açıklamadır — diğer anahtarları GÖLGELER', () => {
    /* Rota değiştiyse ETA'nın sıçraması BEKLENİR; başka anahtar da değişmiş
       olsa bile kayıt reroute demelidir (yanlış suçlama yapılmaz). */
    const a = sample({ routeRevision: 1, remainingDistanceM: 250_000 });
    const b = sample({ atMs: 2_000, routeRevision: 2, remainingDistanceM: null, etaSeconds: 16_764 });
    expect(detectEtaJump(a, b)?.trigger).toBe('ROUTE_REVISION_CHANGED');
  });

  it('🔒 hiçbir anahtar değişmediyse BASE_DURATION_ONLY', () => {
    const a = sample();
    const b = sample({ atMs: 2_000, etaSeconds: 10_007 + 120, baseDurationS: 10_127 });
    expect(detectEtaJump(a, b)?.trigger).toBe('BASE_DURATION_ONLY');
  });

  it('🔒 her tetikleyicinin insan-okur etiketi VAR (sessiz boşluk yok)', () => {
    for (const k of Object.keys(ETA_JUMP_TRIGGER_LABEL)) {
      expect(ETA_JUMP_TRIGGER_LABEL[k as keyof typeof ETA_JUMP_TRIGGER_LABEL]).toBeTruthy();
    }
  });
});

describe('defter — bounded ve dürüst özet', () => {
  it('🔒 halka tavanı aşılmaz, EN YENİ kayıtlar korunur', () => {
    let led: readonly EtaJumpRecord[] = [];
    for (let i = 0; i < ETA_JUMP_RING + 15; i++) {
      const r = detectEtaJump(sample(), sample({ atMs: i, etaSeconds: 10_007 + 100 + i }));
      if (r) led = appendJump(led, r);
    }
    expect(led.length).toBe(ETA_JUMP_RING);
    expect(led[led.length - 1].atMs).toBe(ETA_JUMP_RING + 14);
  });

  it('🔒 baskın tetikleyici YALNIZ açık farkla öndeyse bildirilir', () => {
    /* "Muhtemelen X" yasağının koddaki karşılığı: yarıdan az paya sahip bir
       tetikleyici baskın İLAN EDİLMEZ. */
    const mk = (trigger: 'dist' | 'speed'): EtaJumpRecord => {
      const a = trigger === 'dist'
        ? sample({ remainingDistanceM: 250_000 })
        : sample({ rollingAvgKmh: 12 });
      const b = trigger === 'dist'
        ? sample({ atMs: 2_000, remainingDistanceM: null, etaSeconds: 12_000 })
        : sample({ atMs: 2_000, rollingAvgKmh: 4, etaSeconds: 12_000 });
      return detectEtaJump(a, b)!;
    };
    const yarıYarıya = [mk('dist'), mk('speed')];
    expect(summarizeJumps(yarıYarıya).dominant, 'berabere iken baskin ilan edilmis')
      .toBeNull();

    const acıkFark = [mk('dist'), mk('dist'), mk('speed')];
    const s = summarizeJumps(acıkFark);
    expect(s.dominant).toBe('DISTANCE_SOURCE_CHANGED');
    expect(s.byTrigger.DISTANCE_SOURCE_CHANGED).toBe(2);
    expect(ETA_DOMINANT_MIN_SHARE).toBeGreaterThanOrEqual(0.5);
  });

  it('🔒 boş defterde baskın YOK ve en büyük sıçrama NULL (sahte 0 yok)', () => {
    const s = summarizeJumps([]);
    expect(s.total).toBe(0);
    expect(s.dominant).toBeNull();
    expect(s.maxAbsDeltaS).toBeNull();
  });

  it('🔒 en büyük MUTLAK sıçrama ölçülür (negatif sıçrama gizlenmez)', () => {
    const dusus = detectEtaJump(
      sample({ etaSeconds: 16_764 }), sample({ atMs: 2_000, etaSeconds: 10_007 }))!;
    expect(summarizeJumps([dusus]).maxAbsDeltaS).toBe(6_757);
  });
});
