/**
 * consumerNotificationPolicyF52.test.ts — TÜKETİCİ BİLDİRİM POLİTİKASI.
 *
 * TEMEL İLKE: KANITSIZ BİLDİRİM YOKTUR.
 * Bilinmeyen, bayat veya çevrimdışı durum bir ARIZA İDDİASI değildir.
 *
 * Politika YENİ bir sağlık/severity motoru DEĞİLDİR — F2.2 hükmünü alır ve
 * yalnız DARALTIR. Buradaki kilitler, kapının genişlemesine izin veren her
 * değişiklikte DÜŞER.
 */

import { describe, it, expect } from 'vitest';

import {
  decideConsumerNotification,
  buildDedupeKey,
} from '@/lib/notifications/consumerNotificationPolicy';
import type { VehicleHealthSummary } from '@/lib/diagnostics/vehicleHealth';
import type { DtcCode } from '@/lib/diagnostics/dtcResultContract';

const VEHICLE_A = 'veh-aaaa';
const VEHICLE_B = 'veh-bbbb';

function health(over: Partial<VehicleHealthSummary> = {}): VehicleHealthSummary {
  return {
    verdict: 'CRITICAL',
    headline: 'Motor sıcaklığı yüksek',
    explanation: 'Ölçülen değer eşiğin üstünde.',
    evidence: [
      { id: 'engineTemp', label: 'Motor sıcaklığı', verdict: 'CRITICAL',
        detail: '118 °C', provenance: 'OBD', measuredAt: 1_000, freshness: 'LIVE',
        countedInVerdict: true },
    ],
    limitations: [],
    measuredAt: 1_000,
    freshness: 'LIVE',
    confidence: 'HIGH',
    connection: { state: 'LIVE', label: 'Canlı', lastSeenLabel: 'Az önce' },
    dtcs: [],
    ...over,
  } as VehicleHealthSummary;
}

const dtc = (code: string, severity: DtcCode['severity']): DtcCode =>
  ({ code, severity, system: 'Motor', desc: 'test' });

const base = { vehicleId: VEHICLE_A, vehicleLabel: '34 ABC 123', lastSentKey: null };

/* ── 1. Kanıt yoksa bildirim yok ───────────────────────────────────────── */

describe('F5.2 · kanıtsız bildirim YOKTUR', () => {
  it('1. 🔒 sağlık HENÜZ OKUNMADI → bildirim yok (LOADING ≠ kanıt yok)', () => {
    const d = decideConsumerNotification({ ...base, health: null });
    expect(d.send).toBe(false);
    if (!d.send) expect(d.reason).toBe('NO_HEALTH_READ');
  });

  it('2. 🔒 NO_EVIDENCE → bildirim DEĞİL', () => {
    const d = decideConsumerNotification({ ...base, health: health({ verdict: 'NO_EVIDENCE' }) });
    expect(d.send).toBe(false);
    if (!d.send) expect(d.reason).toBe('NO_EVIDENCE');
  });

  it('3. 🔒 kanıtlı SAĞLIKLI → bildirim yok', () => {
    const d = decideConsumerNotification({ ...base, health: health({ verdict: 'VERIFIED' }) });
    expect(d.send).toBe(false);
    if (!d.send) expect(d.reason).toBe('HEALTHY');
  });
});

/* ── 2. Bayat / çevrimdışı arıza DEĞİLDİR ──────────────────────────────── */

describe('F5.2 · bayat veya çevrimdışı durum ARIZA İDDİASI değildir', () => {
  it('4. 🔒 STALE hüküm → arıza bildirimi GÖNDERİLMEZ', () => {
    const d = decideConsumerNotification({ ...base, health: health({ freshness: 'STALE' }) });
    expect(d.send).toBe(false);
    if (!d.send) expect(d.reason).toBe('NOT_LIVE');
  });

  it('5. 🔒 OFFLINE hüküm tek başına araç arızası DEĞİLDİR', () => {
    const d = decideConsumerNotification({ ...base, health: health({ freshness: 'OFFLINE' }) });
    expect(d.send).toBe(false);
  });

  it('6. 🔒 NEVER_SEEN / UNKNOWN da bildirim üretmez', () => {
    for (const f of ['NEVER_SEEN', 'UNKNOWN'] as const) {
      const d = decideConsumerNotification({ ...base, health: health({ freshness: f }) });
      expect(d.send).toBe(false);
    }
  });
});

/* ── 3. Ciddiyet kapısı ────────────────────────────────────────────────── */

describe('F5.2 · yalnız gerçekten aksiyon gerektiren durum bildirilir', () => {
  it('7. 🔒 CANLI CRITICAL → bildirim adayı', () => {
    const d = decideConsumerNotification({ ...base, health: health() });
    expect(d.send).toBe(true);
    if (d.send) {
      expect(d.notification.urgent).toBe(true);
      expect(d.notification.body).toBe('Motor sıcaklığı yüksek');
    }
  });

  it('8. 🔒 WARNING + arıza kodu YOK → bildirim DEĞİL (uygulamada görünür)', () => {
    const d = decideConsumerNotification({
      ...base, health: health({ verdict: 'WARNING', dtcs: [] }),
    });
    expect(d.send).toBe(false);
    if (!d.send) expect(d.reason).toBe('WARNING_NOT_ACTIONABLE');
  });

  it('9. 🔒 WARNING + araç GERÇEK arıza kodu bildirdi → bildirim adayı', () => {
    const d = decideConsumerNotification({
      ...base, health: health({ verdict: 'WARNING', dtcs: [dtc('P0128', 'warning')] }),
    });
    expect(d.send).toBe(true);
    if (d.send) expect(d.notification.urgent).toBe(false);
  });

  it('10. 🔒 yalnız `info` seviyeli kod aksiyon gerektirmez', () => {
    const d = decideConsumerNotification({
      ...base, health: health({ verdict: 'WARNING', dtcs: [dtc('P1234', 'info')] }),
    });
    expect(d.send).toBe(false);
  });
});

/* ── 4. Gürültü / dedupe ───────────────────────────────────────────────── */

describe('F5.2 · aynı durum tek bildirim üretir', () => {
  it('11. 🔒 aynı dedupe anahtarı → ikinci bildirim GÖNDERİLMEZ', () => {
    const h = health();
    const key = buildDedupeKey(VEHICLE_A, h);
    const d = decideConsumerNotification({ ...base, health: h, lastSentKey: key });
    expect(d.send).toBe(false);
    if (!d.send) expect(d.reason).toBe('DUPLICATE');
  });

  it('12. 🔒 anahtar ÖLÇÜM ANINDAN bağımsızdır (telemetri aksa da aynı kalır)', () => {
    /* MUTASYON KAPISI: `measuredAt` anahtara katılırsa her ölçüm yeni olay
       olur ve 5 sn'de bir bildirim yağar. */
    const k1 = buildDedupeKey(VEHICLE_A, health({ measuredAt: 1_000 }));
    const k2 = buildDedupeKey(VEHICLE_A, health({ measuredAt: 999_000 }));
    expect(k1).toBe(k2);
  });

  it('13. 🔒 durum DEĞİŞİRSE anahtar da değişir (gerçek yeni olay bildirilir)', () => {
    const k1 = buildDedupeKey(VEHICLE_A, health({ verdict: 'WARNING' }));
    const k2 = buildDedupeKey(VEHICLE_A, health({ verdict: 'CRITICAL' }));
    expect(k1).not.toBe(k2);
  });

  it('14. 🔒 yeni arıza kodu yeni olaydır', () => {
    const k1 = buildDedupeKey(VEHICLE_A, health({ dtcs: [dtc('P0128', 'warning')] }));
    const k2 = buildDedupeKey(VEHICLE_A, health({ dtcs: [dtc('P0128', 'warning'), dtc('P0300', 'critical')] }));
    expect(k1).not.toBe(k2);
  });
});

/* ── 5. Çok araç izolasyonu ────────────────────────────────────────────── */

describe('F5.2 · çok araçlı hesapta bildirimler karışmaz', () => {
  it('15. 🔒 farklı araç → farklı anahtar (A\'nın bildirimi B\'yi susturmaz)', () => {
    const h = health();
    expect(buildDedupeKey(VEHICLE_A, h)).not.toBe(buildDedupeKey(VEHICLE_B, h));
  });

  it('16. 🔒 A\'nın gönderilmiş anahtarı B\'nin bildirimini ENGELLEMEZ', () => {
    const h = health();
    const keyA = buildDedupeKey(VEHICLE_A, h);
    const d = decideConsumerNotification({
      vehicleId: VEHICLE_B, vehicleLabel: '06 XYZ 9', health: h, lastSentKey: keyA,
    });
    expect(d.send).toBe(true);
    if (d.send) expect(d.notification.vehicleId).toBe(VEHICLE_B);
  });

  it('17. 🔒 bildirim HANGİ araca ait olduğunu taşır', () => {
    const d = decideConsumerNotification({ ...base, health: health() });
    if (d.send) {
      expect(d.notification.vehicleId).toBe(VEHICLE_A);
      expect(d.notification.title).toContain('34 ABC 123');
    }
  });

  it('18. 🔒 araç adı bilinmiyorsa UYDURULMAZ', () => {
    const d = decideConsumerNotification({ ...base, vehicleLabel: null, health: health() });
    if (d.send) {
      expect(d.notification.title).toContain('Aracınız');
      expect(d.notification.title).not.toContain('null');
      expect(d.notification.title).not.toContain('undefined');
    }
  });
});

/* ── 6. Hedef yüzeyi ───────────────────────────────────────────────────── */

describe('F5.2 · tüketici bildirimi filo paneline gitmez', () => {
  it('19. 🔒 hedef DAİMA /kumanda', () => {
    const d = decideConsumerNotification({ ...base, health: health() });
    if (d.send) expect(d.notification.url).toBe('/kumanda');
  });

  it('20. 🔒 hedef hiçbir koşulda /dashboard olamaz', () => {
    for (const v of ['CRITICAL', 'WARNING'] as const) {
      const d = decideConsumerNotification({
        ...base, health: health({ verdict: v, dtcs: [dtc('P0300', 'critical')] }),
      });
      if (d.send) expect(d.notification.url).not.toContain('dashboard');
    }
  });
});
