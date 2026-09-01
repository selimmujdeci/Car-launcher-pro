/**
 * navigationHonesty.test — P0-NAV-02 · sürüş yüzeyinin dürüstlük hükmü.
 *
 * Görev şartı: "Yeni hesap üretme; yalnız mevcut authority verisini göster.
 * Belirsizlikte fail-closed davran." Bu dosya ikisini de kilitler.
 */

import { describe, it, expect } from 'vitest';

import {
  evaluateNavigationHonesty, HONEST_SILENT,
  type NavigationHonestyInput,
} from '../platform/navigation/core/navigationHonestyModel';

/** En iyi hâl — motorun her üç hükmü de kesin. */
const BEST: NavigationHonestyInput = {
  numbersVisible: true,
  distanceSource: 'ALONG_ROUTE',
  etaState: 'ROUTE_MODEL',
  etaSource: 'OSRM_ANNOTATION',
  routeVerdict: 'VALID',
};

const at = (p: Partial<NavigationHonestyInput>): NavigationHonestyInput => ({ ...BEST, ...p });

/* ── 1. TEMİZ HÂL: hiçbir şey çizilmez ────────────────────────────────────── */

describe('P0-NAV-02 · temiz hâlde ekran bütçesi harcanmaz', () => {
  it('üç hüküm de kesinse şerit GÖRÜNMEZ', () => {
    const v = evaluateNavigationHonesty(BEST);
    expect(v.level).toBe('CLEAN');
    expect(v.chips).toHaveLength(0);
    expect(v.visible).toBe(false);
    expect(v.distanceApproximate).toBe(false);
    expect(v.etaApproximate).toBe(false);
    expect(v.etaTrustworthy).toBe(true);
  });

  it('sayı gösterilmiyorken hüküm ÜRETİLMEZ', () => {
    /* IDLE/ARRIVED/ERROR: ortada işaretlenecek bir sayı yok. */
    expect(evaluateNavigationHonesty(at({ numbersVisible: false }))).toEqual(HONEST_SILENT);
    /* En kötü girdilerle bile sessiz kalır. */
    expect(evaluateNavigationHonesty({
      numbersVisible: false, distanceSource: null,
      etaState: 'UNKNOWN', etaSource: 'NONE', routeVerdict: 'REJECTED',
    }).visible).toBe(false);
  });
});

/* ── 2. FAIL-CLOSED: bilinmeyen KESİN sayılmaz ───────────────────────────── */

describe('P0-NAV-02 · belirsizlikte fail-closed', () => {
  it('mesafe kaynağı BİLİNMİYORSA kesin sayılmaz', () => {
    const v = evaluateNavigationHonesty(at({ distanceSource: null }));
    expect(v.distanceApproximate, 'bilinmeyen kaynak kesin sayılıyor').toBe(true);
    expect(v.chips.map((c) => c.id)).toContain('distance');
    expect(v.visible).toBe(true);
  });

  it('rota doğrulaması YOKSA "geçerli" DENMEZ', () => {
    const v = evaluateNavigationHonesty(at({ routeVerdict: 'UNKNOWN' }));
    const chip = v.chips.find((c) => c.id === 'route');
    expect(chip, 'doğrulanmamış rota sessizce geçiyor').toBeDefined();
    expect(chip!.label).toContain('DOĞRULANMADI');
  });

  it('ETA hükmü YOKSA sayı güvenilir sayılmaz', () => {
    const v = evaluateNavigationHonesty(at({ etaState: 'UNKNOWN', etaSource: 'NONE' }));
    expect(v.etaTrustworthy, 'değerlendirilmemiş ETA güvenilir sayılıyor').toBe(false);
  });

  it('YALNIZ ALONG_ROUTE kesin kabul edilir', () => {
    expect(evaluateNavigationHonesty(at({ distanceSource: 'ALONG_ROUTE' })).distanceApproximate).toBe(false);
    expect(evaluateNavigationHonesty(at({ distanceSource: 'STRAIGHT_LINE' })).distanceApproximate).toBe(true);
    expect(evaluateNavigationHonesty(at({ distanceSource: null })).distanceApproximate).toBe(true);
  });
});

/* ── 3. KUŞ UÇUŞU MESAFE (#404) ──────────────────────────────────────────── */

describe('P0-NAV-02 · kuş uçuşu mesafe artık SESSİZ değil', () => {
  it('STRAIGHT_LINE ağır uyarı üretir', () => {
    const v = evaluateNavigationHonesty(at({ distanceSource: 'STRAIGHT_LINE' }));
    const chip = v.chips.find((c) => c.id === 'distance')!;
    expect(chip.level).toBe('DEGRADED');
    expect(v.level).toBe('DEGRADED');
    /* Sürücü mesafenin ARTABİLECEĞİNİ bilmeli — sahada 69 kez arttı. */
    expect(chip.detail).toContain('ARTABİLİR');
  });
});

/* ── 4. ETA HÜKÜMLERİ — motorun sözleşmesiyle birebir ────────────────────── */

describe('P0-NAV-02 · ETA hükmü motorun kendi sözleşmesini izler', () => {
  it('ROUTE_MODEL tek KESİN hâldir', () => {
    expect(evaluateNavigationHonesty(at({ etaState: 'ROUTE_MODEL' })).etaApproximate).toBe(false);
    for (const st of ['DEGRADED_FALLBACK', 'STALE', 'INSUFFICIENT_ROUTE_DATA', 'UNKNOWN'] as const) {
      expect(evaluateNavigationHonesty(at({ etaState: st })).etaApproximate, st).toBe(true);
    }
  });

  it('sayı ÜRETİLMEYEN hâllerde ETA güvenilir DEĞİLDİR', () => {
    /* Motor bu üç hâlde `etaSeconds: null` döner — yüzey de kesinlik iddia etmemeli. */
    for (const st of ['STALE', 'INSUFFICIENT_ROUTE_DATA', 'UNKNOWN'] as const) {
      expect(evaluateNavigationHonesty(at({ etaState: st })).etaTrustworthy, st).toBe(false);
    }
    /* Yedek hesap KULLANILABİLİR ama yaklaşıktır — gizlenmez. */
    const f = evaluateNavigationHonesty(at({ etaState: 'DEGRADED_FALLBACK' }));
    expect(f.etaTrustworthy).toBe(true);
    expect(f.etaApproximate).toBe(true);
  });

  it('yedek hesapta KAYNAK gerekçede görünür', () => {
    const v = evaluateNavigationHonesty(at({
      etaState: 'DEGRADED_FALLBACK', etaSource: 'STRAIGHT_LINE_ESTIMATE',
    }));
    expect(v.chips.find((c) => c.id === 'eta')!.detail).toContain('STRAIGHT_LINE_ESTIMATE');
  });
});

/* ── 5. ROTA DOĞRULAMA (#407 — 399/399 DEGRADED, hiç gösterilmedi) ───────── */

describe('P0-NAV-02 · rota doğrulama hükmü artık görünür', () => {
  it('DEGRADED ve REJECTED ağır uyarıdır', () => {
    for (const v of ['DEGRADED', 'REJECTED'] as const) {
      const r = evaluateNavigationHonesty(at({ routeVerdict: v }));
      expect(r.chips.find((c) => c.id === 'route')!.level, v).toBe('DEGRADED');
    }
  });

  it('VALID hiçbir şey çizmez', () => {
    expect(evaluateNavigationHonesty(at({ routeVerdict: 'VALID' })).chips).toHaveLength(0);
  });
});

/* ── 6. SEVİYE BİRLEŞTİRME ───────────────────────────────────────────────── */

describe('P0-NAV-02 · seviye en ağır cipten gelir', () => {
  it('yalnız belirsizlik varsa CAUTION', () => {
    const v = evaluateNavigationHonesty(at({ distanceSource: null, routeVerdict: 'UNKNOWN', etaState: 'UNKNOWN' }));
    expect(v.level).toBe('CAUTION');
    expect(v.chips).toHaveLength(3);
  });

  it('tek bir ağır cip bile seviyeyi DEGRADED yapar', () => {
    const v = evaluateNavigationHonesty(at({ distanceSource: null, routeVerdict: 'DEGRADED' }));
    expect(v.level).toBe('DEGRADED');
  });

  it('cip sırası SABİT: mesafe → varış → rota', () => {
    /* Sürüşte konum değiştiren etiket okunmaz; sıra deterministik olmalı. */
    const v = evaluateNavigationHonesty({
      numbersVisible: true, distanceSource: 'STRAIGHT_LINE',
      etaState: 'STALE', etaSource: 'NONE', routeVerdict: 'DEGRADED',
    });
    expect(v.chips.map((c) => c.id)).toEqual(['distance', 'eta', 'route']);
  });
});

/* ── 7. SAFLIK ───────────────────────────────────────────────────────────── */

describe('P0-NAV-02 · model SAF', () => {
  it('aynı girdi aynı çıktıyı verir ve girdiyi DEĞİŞTİRMEZ', () => {
    const input = at({ distanceSource: 'STRAIGHT_LINE' });
    const snapshot = JSON.stringify(input);
    const a = evaluateNavigationHonesty(input);
    const b = evaluateNavigationHonesty(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('YENİ SAYI üretmez — çıktıda mesafe/süre/hız alanı YOK', () => {
    const v = evaluateNavigationHonesty(at({ distanceSource: 'STRAIGHT_LINE' }));
    const keys = Object.keys(v);
    for (const forbidden of ['meters', 'seconds', 'eta', 'distance', 'speed']) {
      expect(keys.filter((k) => k.toLowerCase() === forbidden), forbidden).toHaveLength(0);
    }
    /* Yalnız hüküm/bayrak taşır. */
    expect(new Set(keys)).toEqual(new Set([
      'level', 'distanceApproximate', 'etaApproximate', 'etaTrustworthy', 'chips', 'visible',
    ]));
  });
});
