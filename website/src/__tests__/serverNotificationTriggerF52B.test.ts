/**
 * serverNotificationTriggerF52B.test.ts — SUNUCU TARAFI BİLDİRİM TETİKLEYİCİSİ.
 *
 * ── AMAÇ ────────────────────────────────────────────────────────────────
 * Zincir TEK ve TARAYICIDAN BAĞIMSIZ olmalı:
 *   gerçek araç kanıtı → kanonik health hükmü → consumer policy
 *   → incident/dedupe → sunucu tarafı alıcı → Web Push
 *
 * Tek mevcut tetikleyici `vehicleStore.startWatchdog` idi: tarayıcıda çalışır,
 * Authorization taşımaz, sekme kapalıyken HİÇ çalışmaz → bildirim otoritesi
 * OLAMAZ. Bu testler yeni çekirdeğin o bağımlılığı taşımadığını kilitler.
 *
 * ── İKİNCİ KARAR MOTORU YOK ─────────────────────────────────────────────
 * Değerlendirici yeni eşik/severity ÜRETMEZ; `buildVehicleFreshness` →
 * `buildVehicleHealthSummary` → `decideConsumerNotification` zincirini çağırır.
 */

import { describe, it, expect } from 'vitest';

import { evaluateVehicleNotification } from '@/lib/notifications/serverNotificationTrigger';
import type { TelemetryRow } from '@/lib/fleet/vehicleTelemetryFreshness';
import type { DtcOutcome, VoltageOutcome } from '@/lib/diagnostics/dtcResultContract';

const NOW = 1_900_000_000_000;
const iso = (agoMs: number) => new Date(NOW - agoMs).toISOString();
const VEH_A = 'veh-aaaa';
const VEH_B = 'veh-bbbb';

/** Canlı OBD gözlemi taşıyan taze satır. */
function row(over: Partial<TelemetryRow> = {}): TelemetryRow {
  return {
    updatedAt:     iso(5_000),
    obdObservedAt: iso(5_000),
    gpsObservedAt: iso(5_000),
    lat: 41.0, lng: 29.0,
    speed: 0, rpm: 820, temp: 90, fuel: 55,
    telemetrySource: 'HEAD_UNIT_OBD',
    locationSource:  'HEAD_UNIT_GPS',
    ...over,
  };
}

const dtcResult = (codes: Array<{ code: string; severity: 'critical' | 'warning' | 'info' }>): DtcOutcome => ({
  kind: 'RESULT',
  partial: false,
  readAt: iso(5_000),
  dtcs: codes.map((c) => ({ ...c, system: 'Motor', desc: 'test' })),
});

const noDtc: DtcOutcome = { kind: 'NO_DTC', partial: false, readAt: iso(5_000) };
const okVolt: VoltageOutcome = { kind: 'RESULT', volts: 12.6, readAt: iso(5_000) };

function evaluate(over: Partial<Parameters<typeof evaluateVehicleNotification>[0]> = {}) {
  return evaluateVehicleNotification({
    now: NOW,
    vehicleId: VEH_A,
    vehicleLabel: '34 ABC 123',
    telemetryRow: row(),
    telemetryReadable: true,
    dtc: noDtc,
    voltage: okVolt,
    openIncidentKey: null,
    ...over,
  });
}

/* ── 1. Tarayıcı bağımsızlığı ──────────────────────────────────────────── */

describe('F5.2B · tetikleyici tarayıcıya bağlı DEĞİLDİR', () => {
  it('1. 🔒 değerlendirme yalnız verilen verilerden hüküm üretir (I/O yok)', () => {
    /* MUTASYON KAPISI: modül `Date.now()`/fetch/localStorage kullanmaya
       başlarsa `now` girdisi anlamsızlaşır ve bu test kırılganlaşır. */
    const a = evaluate({ now: NOW });
    const b = evaluate({ now: NOW });
    expect(a).toEqual(b);
  });

  it('2. 🔒 tarayıcı API\'leri olmadan koşar (jsdom değil, saf veri)', () => {
    const out = evaluate({ telemetryRow: null, telemetryReadable: true });
    expect(out.kind).toBe('NOT_ELIGIBLE');
  });
});

/* ── 2. Kanıt kapısı (F5.2 politikası korunur) ─────────────────────────── */

describe('F5.2B · kanıtsız/bayat durum bildirim üretmez', () => {
  it('3. 🔒 telemetri satırı YOK → bildirim yok', () => {
    const out = evaluate({ telemetryRow: null });
    expect(out.kind).toBe('NOT_ELIGIBLE');
  });

  it('4. 🔒 satır OKUNAMADI → bildirim yok (okunamadı ≠ veri yok)', () => {
    const out = evaluate({ telemetryRow: null, telemetryReadable: false });
    expect(out.kind).toBe('NOT_ELIGIBLE');
  });

  it('5. 🔒 OBD gözlemi BAYAT → arıza bildirimi yok', () => {
    const out = evaluate({
      telemetryRow: row({ obdObservedAt: iso(6 * 60 * 60_000), updatedAt: iso(6 * 60 * 60_000) }),
      dtc: null, voltage: null,
    });
    expect(out.kind).toBe('NOT_ELIGIBLE');
  });

  it('6. 🔒 sağlıklı araç → bildirim yok', () => {
    const out = evaluate();
    expect(out.kind).toBe('NOT_ELIGIBLE');
    if (out.kind === 'NOT_ELIGIBLE') {
      expect(['HEALTHY', 'NO_EVIDENCE', 'WARNING_NOT_ACTIONABLE']).toContain(out.reason);
    }
  });

  it('7. 🔒 DTC okuması DÜŞTÜ → "arıza bulundu" DEĞİLDİR', () => {
    for (const bad of [
      { kind: 'TIMEOUT', reason: 'x' },
      { kind: 'OFFLINE', reason: 'x' },
      { kind: 'FAILED',  reason: 'x' },
      { kind: 'STALE',   reason: 'x' },
    ] as DtcOutcome[]) {
      const out = evaluate({ dtc: bad });
      expect(out.kind).toBe('NOT_ELIGIBLE');
    }
  });
});

/* ── 3. Gerçek olay → bildirim ─────────────────────────────────────────── */

describe('F5.2B · gerçek kanıt bildirim üretir', () => {
  it('8. 🔒 araç GERÇEK kritik arıza kodu bildirdi → NOTIFY', () => {
    const out = evaluate({ dtc: dtcResult([{ code: 'P0300', severity: 'critical' }]) });
    expect(out.kind).toBe('NOTIFY');
    if (out.kind === 'NOTIFY') {
      expect(out.notification.url).toBe('/kumanda');
      expect(out.notification.vehicleId).toBe(VEH_A);
      expect(out.incidentKey).toContain(VEH_A);
    }
  });

  it('9. 🔒 bildirim gövdesi F2.2 cümlesidir (yeni metin üretilmez)', () => {
    const out = evaluate({ dtc: dtcResult([{ code: 'P0300', severity: 'critical' }]) });
    if (out.kind === 'NOTIFY') {
      expect(out.notification.body).toBe(out.health.headline);
    }
  });
});

/* ── 4. Olay yaşam döngüsü ─────────────────────────────────────────────── */

describe('F5.2B · aynı olay tek bildirim, düzelip tekrarlarsa yeniden', () => {
  const faulty = { dtc: dtcResult([{ code: 'P0300', severity: 'critical' as const }]) };

  it('10. 🔒 aynı kanıt tekrar geldi → DEDUPED (ikinci bildirim yok)', () => {
    const first = evaluate(faulty);
    expect(first.kind).toBe('NOTIFY');
    if (first.kind !== 'NOTIFY') return;
    const second = evaluate({ ...faulty, openIncidentKey: first.incidentKey });
    expect(second.kind).toBe('DEDUPED');
  });

  it('11. 🔒 YENİ zaman damgası tek başına yeni olay DEĞİLDİR', () => {
    const first = evaluate(faulty);
    if (first.kind !== 'NOTIFY') return;
    /* Telemetri aktı, ölçüm anı ilerledi — durum AYNI. */
    const later = evaluate({
      ...faulty,
      telemetryRow: row({ obdObservedAt: iso(1_000), updatedAt: iso(1_000) }),
      openIncidentKey: first.incidentKey,
    });
    expect(later.kind).toBe('DEDUPED');
  });

  it('12. 🔒 DEDUPED olayı KAPATMAZ (açık olay sürüyor)', () => {
    const first = evaluate(faulty);
    if (first.kind !== 'NOTIFY') return;
    const second = evaluate({ ...faulty, openIncidentKey: first.incidentKey });
    expect(second.kind).toBe('DEDUPED');
    expect(second).not.toHaveProperty('clearIncident');
  });

  it('13. 🔒 sorun DÜZELDİ → açık olay KAPANIR', () => {
    const first = evaluate(faulty);
    if (first.kind !== 'NOTIFY') return;
    const healed = evaluate({ dtc: noDtc, openIncidentKey: first.incidentKey });
    expect(healed.kind).toBe('NOT_ELIGIBLE');
    if (healed.kind === 'NOT_ELIGIBLE') expect(healed.clearIncident).toBe(true);
  });

  it('14. 🔒 düzeldikten SONRA aynı arıza tekrar oluşursa YENİDEN bildirilir', () => {
    const first = evaluate(faulty);
    if (first.kind !== 'NOTIFY') return;
    const healed = evaluate({ dtc: noDtc, openIncidentKey: first.incidentKey });
    expect(healed.kind).toBe('NOT_ELIGIBLE');
    /* Kapanış sonrası saklanan kimlik temizlenir → yeni olay bildirilebilir. */
    const again = evaluate({ ...faulty, openIncidentKey: null });
    expect(again.kind).toBe('NOTIFY');
  });

  it('15. 🔒 açık olay yokken kapatma İSTENMEZ (gereksiz yazma yok)', () => {
    const out = evaluate({ openIncidentKey: null });
    if (out.kind === 'NOT_ELIGIBLE') expect(out.clearIncident).toBe(false);
  });
});

/* ── 5. Çok araç izolasyonu ────────────────────────────────────────────── */

describe('F5.2B · araçlar birbirinin bildirimini etkilemez', () => {
  const faulty = { dtc: dtcResult([{ code: 'P0300', severity: 'critical' as const }]) };

  it('16. 🔒 A\'nın açık olayı B\'nin bildirimini ENGELLEMEZ', () => {
    const a = evaluate({ ...faulty, vehicleId: VEH_A });
    if (a.kind !== 'NOTIFY') return;
    const b = evaluate({ ...faulty, vehicleId: VEH_B, openIncidentKey: a.incidentKey });
    expect(b.kind).toBe('NOTIFY');
    if (b.kind === 'NOTIFY') expect(b.notification.vehicleId).toBe(VEH_B);
  });

  it('17. 🔒 olay kimlikleri araca göre AYRIŞIR', () => {
    const a = evaluate({ ...faulty, vehicleId: VEH_A });
    const b = evaluate({ ...faulty, vehicleId: VEH_B });
    if (a.kind === 'NOTIFY' && b.kind === 'NOTIFY') {
      expect(a.incidentKey).not.toBe(b.incidentKey);
    }
  });

  it('18. 🔒 araç adı bilinmiyorsa UYDURULMAZ', () => {
    const out = evaluate({ ...faulty, vehicleLabel: null });
    if (out.kind === 'NOTIFY') {
      expect(out.notification.title).not.toContain('null');
      expect(out.notification.title).not.toContain('undefined');
    }
  });
});

/* ── 6. Gizlilik (§10) ─────────────────────────────────────────────────── */

describe('F5.2B · bildirim içeriği gereksiz veri taşımaz', () => {
  it('19. 🔒 bildirim ham DTC listesi/ECU/VIN taşımaz (kilit ekranı gizliliği)', () => {
    const out = evaluate({ dtc: dtcResult([{ code: 'P0300', severity: 'critical' }]) });
    if (out.kind === 'NOTIFY') {
      const blob = JSON.stringify(out.notification);
      expect(blob).not.toContain('P0300');
      expect(blob).not.toMatch(/VF1[A-Z0-9]{14}/);
      expect(blob).not.toContain('ecu');
    }
  });

  it('20. 🔒 bildirim alanları minimumdur', () => {
    const out = evaluate({ dtc: dtcResult([{ code: 'P0300', severity: 'critical' }]) });
    if (out.kind === 'NOTIFY') {
      expect(Object.keys(out.notification).sort()).toEqual(
        ['body', 'tag', 'title', 'urgent', 'url', 'vehicleId'].sort(),
      );
    }
  });
});
