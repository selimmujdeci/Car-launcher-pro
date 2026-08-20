/**
 * #662 KİLİTLERİ — Kanıt Konsolu.
 *
 * Korunan sözleşmeler:
 *  1. Kanıtsız metrik YEŞİL BOYANMAZ; "sağlıklı" ile "bilinmiyor" ayrı durur.
 *  2. Radyal göstergede değer yokken ibre ORTAYA YASLANMAZ.
 *  3. Bayat ölçüm `VERIFIED` olamaz (en fazla `WARNING`), ama kritik eşiği
 *     aşan bayat ölçüm kritik KALIR.
 *  4. Dışa aktarmada bilinmeyen hücre BOŞ kalır — `0` yazılmaz.
 *  5. Rapor serisi olay sayımıdır; pencere dışına taşan olay eklenmez.
 *
 * Bu kilitler ZAYIFLATILMAZ; davranış bilinçli değişirse kilit GÜNCELLENİR.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  judge,
  judgeVehicle,
  tallyFleet,
  agoLabel,
  evidenceLine,
  verdictToken,
  verdictLabel,
  NO_EVIDENCE,
  BATTERY_RULE,
  ENGINE_RULE,
} from '@/lib/console/evidenceModel';
import {
  valueToAngle,
  toneForValue,
  tickAngles,
  normalize,
  GAUGE_START_DEG,
  GAUGE_END_DEG,
  BATTERY_SCALE,
  ENGINE_TEMP_SCALE,
} from '@/lib/console/gaugeModel';
import { toCsv, csvCell, trNumber, csvFileName } from '@/lib/console/exportModel';
import { bucketByDay, sharedMax, totals, startOfLocalDay, DAY_MS } from '@/lib/console/reportsModel';
import { summarizeFuel, summarizeService } from '@/lib/console/recordsModel';
import { normalizeTheme, toggleTheme, CONSOLE_THEME_BOOT_SCRIPT } from '@/lib/console/consoleTheme';
import type { Measurement, VehicleFreshness } from '@/lib/fleet/vehicleTelemetryFreshness';
import type { DecisionEvent } from '@/lib/console/consoleSources';

function measurement(value: number | null, state: Measurement['state'] = 'LIVE'): Measurement {
  return { value, state, observedAt: 1_000, ageMs: 5_000, source: 'HEAD_UNIT_OBD' };
}

describe('#662 · kanıtsız metrik yeşil boyanmaz', () => {
  it('değer null ise hüküm DAİMA KANIT YOK — eşiklere bakılmaz', () => {
    expect(judge(measurement(null), ENGINE_RULE).verdict).toBe('NO_EVIDENCE');
    expect(judge(undefined, ENGINE_RULE).verdict).toBe('NO_EVIDENCE');
    expect(judge(null, BATTERY_RULE)).toEqual(NO_EVIDENCE);
  });

  it('KANIT YOK gri tokene düşer, ASLA yeşile değil', () => {
    expect(verdictToken('NO_EVIDENCE')).toBe('unknown');
    expect(verdictToken('VERIFIED')).toBe('verified');
    expect(verdictLabel('NO_EVIDENCE')).toBe('KANIT YOK');
  });

  it('bayat ölçüm KANITLI sayılmaz — en fazla UYARI', () => {
    expect(judge(measurement(90, 'LIVE'), ENGINE_RULE).verdict).toBe('VERIFIED');
    expect(judge(measurement(90, 'STALE'), ENGINE_RULE).verdict).toBe('WARNING');
    expect(judge(measurement(90, 'OFFLINE'), ENGINE_RULE).verdict).toBe('WARNING');
  });

  it('bayat ama KRİTİK eşiği aşan ölçüm kritik KALIR — güvenlik yumuşatılmaz', () => {
    expect(judge(measurement(125, 'STALE'), ENGINE_RULE).verdict).toBe('CRITICAL');
    expect(judge(measurement(125, 'OFFLINE'), ENGINE_RULE).verdict).toBe('CRITICAL');
  });

  it('okunamamış/hiç görülmemiş ölçüm KAYNAK YOK sayılır', () => {
    const r = judge(measurement(12.5, 'NEVER_SEEN'), BATTERY_RULE);
    expect(r.verdict).toBe('NO_EVIDENCE');
    expect(r.source).toBe('NONE');
    expect(r.value).toBeNull();
  });
});

describe('#662 · araç hükmü', () => {
  const freshness = (over: Partial<VehicleFreshness> = {}): VehicleFreshness => ({
    device: 'LIVE', deviceLastSeenAt: 1_000, deviceAgeMs: 4_000,
    location: 'LIVE', locationSource: 'HEAD_UNIT_GPS', locationObservedAt: 1_000,
    locationAgeMs: 2_000, latitude: 39.9, longitude: 32.8, accuracyM: 8, locationIsLive: true,
    engine: 'LIVE', engineObservedAt: 1_000,
    speedKmh: measurement(0), rpm: measurement(800),
    engineTempC: measurement(88), fuelPercent: measurement(50),
    health: 'LIVE', healthObservedAt: 1_000,
    ...over,
  });

  it('hiçbir metrikte kanıt yoksa araç KANIT YOK — "sorun yok" DEĞİL', () => {
    const j = judgeVehicle(null, null);
    expect(j.verdict).toBe('NO_EVIDENCE');
    expect(j.reason).toContain('kanıt yok');
  });

  it('en acil metrik hükmü belirler ve gerekçesi görünür', () => {
    const j = judgeVehicle(freshness({ engineTempC: measurement(118) }), 12.6);
    expect(j.verdict).toBe('CRITICAL');
    expect(j.reason).toBe('Motor sıcaklığı');
  });

  it('akü voltajı yoksa akü okuması KANIT YOK kalır (sahte 0 YOK)', () => {
    const j = judgeVehicle(freshness(), null);
    expect(j.readings.battery.verdict).toBe('NO_EVIDENCE');
    expect(j.readings.battery.value).toBeNull();
  });

  it('GPS tazeliği ölçümün YAŞIDIR — saniyeye çevrilir', () => {
    const j = judgeVehicle(freshness({ locationAgeMs: 4_500 }), 12.6);
    expect(j.readings.gpsFreshness.value).toBe(5);
    expect(j.readings.gpsFreshness.verdict).toBe('WARNING');
  });

  it('konum hiç görülmediyse GPS okuması KANIT YOK', () => {
    const j = judgeVehicle(freshness({ location: 'NEVER_SEEN', locationAgeMs: null }), 12.6);
    expect(j.readings.gpsFreshness.verdict).toBe('NO_EVIDENCE');
  });
});

describe('#662 · filo sayımı kanıtsızı ayrı tutar', () => {
  it('kanıt bekleyen araç sağlıklı sütununa YAZILMAZ', () => {
    const t = tallyFleet([
      { verdict: 'VERIFIED', offline: false },
      { verdict: 'NO_EVIDENCE', offline: false },
      { verdict: 'NO_EVIDENCE', offline: true },
      { verdict: 'CRITICAL', offline: false },
    ]);
    expect(t.total).toBe(4);
    expect(t.verified).toBe(1);
    expect(t.noEvidence).toBe(2);
    expect(t.critical).toBe(1);
    expect(t.offline).toBe(1);
  });
});

describe('#662 · radyal gösterge ibresi', () => {
  it('KİLİT: değer yokken ibre BAŞLANGIÇ açısına düşer, ORTAYA DEĞİL', () => {
    const mid = (GAUGE_START_DEG + GAUGE_END_DEG) / 2;
    expect(valueToAngle(null, 10, 15)).toBe(GAUGE_START_DEG);
    expect(valueToAngle(null, 10, 15)).not.toBe(mid);
    expect(valueToAngle(NaN, 10, 15)).toBe(GAUGE_START_DEG);
  });

  it('değer varsa açı ölçek boyunca doğrusal ilerler', () => {
    expect(valueToAngle(10, 10, 15)).toBe(GAUGE_START_DEG);
    expect(valueToAngle(15, 10, 15)).toBe(GAUGE_END_DEG);
    expect(valueToAngle(12.5, 10, 15)).toBeCloseTo(0, 6);
  });

  it('ölçek dışı değer kadranı TAŞIRMAZ', () => {
    expect(normalize(99, 10, 15)).toBe(1);
    expect(normalize(-5, 10, 15)).toBe(0);
    expect(valueToAngle(99, 10, 15)).toBe(GAUGE_END_DEG);
  });

  it('değer yokken bant tonu unknown olur (renkli bant iddiası YOK)', () => {
    expect(toneForValue(null, BATTERY_SCALE.bands)).toBe('unknown');
    expect(toneForValue(11.0, BATTERY_SCALE.bands)).toBe('critical');
    expect(toneForValue(13.5, BATTERY_SCALE.bands)).toBe('verified');
    expect(toneForValue(120, ENGINE_TEMP_SCALE.bands)).toBe('critical');
  });

  it('kadran çizgileri uçları içerir', () => {
    const ticks = tickAngles(11);
    expect(ticks).toHaveLength(11);
    expect(ticks[0]).toBe(GAUGE_START_DEG);
    expect(ticks[10]).toBe(GAUGE_END_DEG);
  });
});

describe('#662 · kanıt satırı ve yaş', () => {
  it('yaş saniye çözünürlüğünde başlar', () => {
    expect(agoLabel(12_000)).toBe('12 sn önce');
    expect(agoLabel(90_000)).toBe('1 dk önce');
    expect(agoLabel(null)).toBe('zaman bilinmiyor');
  });

  it('kanıt satırı kaynak ve yaş taşır; bilinmeyen örnek sayısı YAZILMAZ', () => {
    const line = evidenceLine(judge(measurement(12.4), BATTERY_RULE));
    expect(line).toContain('ÖLÇÜLDÜ');
    expect(line).not.toContain('örnek');
    expect(evidenceLine(NO_EVIDENCE)).toContain('KAYNAK YOK');
  });
});

describe('#662 · dışa aktarma bilinmeyeni 0 YAPMAZ', () => {
  it('null hücre BOŞ kalır', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(trNumber(null)).toBe('');
    expect(trNumber(0)).toBe('0,00');
  });

  it('ayraç noktalı virgül ve BOM var (TR Excel uyumu)', () => {
    const csv = toCsv(['A', 'B'], [[1, null]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('A;B');
    expect(csv).toContain('1;');
  });

  it('tırnak ve ayraç içeren hücre alıntılanır', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('de"mo')).toBe('"de""mo"');
  });

  it('dosya adı tarih damgası taşır', () => {
    expect(csvFileName('Yakıt Raporu', '2026-08-20T10:00:00Z')).toBe('yak-t-raporu-2026-08-20.csv');
  });
});

describe('#662 · rapor serisi', () => {
  const now = new Date(2026, 7, 20, 15, 0, 0).getTime();
  const ev = (at: number, severity: DecisionEvent['severity']): DecisionEvent => ({
    id: `x${at}`, at, vehicleId: null, kind: 'test', detail: '', severity, origin: 'EVENT',
  });

  it('pencere dışına taşan olay seriye GİRMEZ', () => {
    const old = startOfLocalDay(now) - 20 * DAY_MS;
    const buckets = bucketByDay([ev(old, 'critical'), ev(now, 'critical')], now, 14);
    expect(buckets).toHaveLength(14);
    expect(totals(buckets).critical).toBe(1);
  });

  it('olaysız gün kovada 0 olarak DURUR (gözlem: o gün olay düşmedi)', () => {
    const buckets = bucketByDay([], now, 7);
    expect(buckets).toHaveLength(7);
    expect(buckets.every((b) => b.critical === 0 && b.warning === 0)).toBe(true);
    expect(totals(buckets).empty).toBe(true);
  });

  it('katlar ORTAK tavanı paylaşır — yükseklikler karşılaştırılabilir', () => {
    const buckets = bucketByDay(
      [ev(now, 'critical'), ev(now, 'warning'), ev(now, 'warning'), ev(now, 'warning')],
      now, 7,
    );
    expect(sharedMax(buckets)).toBe(3);
  });
});

describe('#662 · kayıt özeti eksik veriyi 0 SAYMAZ', () => {
  it('litresi bilinmeyen dolum toplama girmez ve ayrıca sayılır', () => {
    const s = summarizeFuel([
      { id: '1', vehicleId: 'v', filledOn: '2026-08-01', liters: 40, pricePerL: 45, odometerKm: null },
      { id: '2', vehicleId: 'v', filledOn: '2026-08-05', liters: null, pricePerL: 45, odometerKm: null },
    ]);
    expect(s.totalLiters).toBe(40);
    expect(s.missingLiters).toBe(1);
    expect(s.totalCost).toBe(1800);
  });

  it('hiç ölçüm yoksa toplam null kalır — 0 DEĞİL', () => {
    const s = summarizeFuel([
      { id: '1', vehicleId: 'v', filledOn: '2026-08-01', liters: null, pricePerL: null, odometerKm: null },
    ]);
    expect(s.totalLiters).toBeNull();
    expect(s.totalCost).toBeNull();
    expect(s.avgPricePerL).toBeNull();
  });

  it('bakım tarihi geçmiş ve yaklaşan ayrı sınıflanır', () => {
    const now = new Date(2026, 7, 20).getTime();
    const s = summarizeService(
      [
        { id: '1', vehicleId: 'v', servicedOn: '2026-01-01', kind: 'yağ', cost: 1000, odometerKm: null, nextDueOn: '2026-08-01', note: null },
        { id: '2', vehicleId: 'v', servicedOn: '2026-06-01', kind: 'fren', cost: null, odometerKm: null, nextDueOn: '2026-09-05', note: null },
        { id: '3', vehicleId: 'v', servicedOn: '2026-06-01', kind: 'lastik', cost: 500, odometerKm: null, nextDueOn: '2027-01-01', note: null },
      ],
      now,
    );
    expect(s.overdue).toHaveLength(1);
    expect(s.dueSoon).toHaveLength(1);
    expect(s.missingCost).toBe(1);
    expect(s.totalCost).toBe(1500);
  });
});

describe('#662 · konsol teması', () => {
  it('bozuk değer varsayılana düşer', () => {
    expect(normalizeTheme('day')).toBe('day');
    expect(normalizeTheme('night')).toBe('night');
    expect(normalizeTheme('mavi')).toBe('night');
    expect(normalizeTheme(null)).toBe('night');
  });

  it('anahtar iki yönlü çalışır', () => {
    expect(toggleTheme('night')).toBe('day');
    expect(toggleTheme('day')).toBe('night');
  });

  it('KİLİT: boot script attribute\'u <html>e basar (ilk karede yanlış tema YOK)', () => {
    expect(CONSOLE_THEME_BOOT_SCRIPT).toContain('documentElement');
    expect(CONSOLE_THEME_BOOT_SCRIPT).toContain('data-console');
    expect(CONSOLE_THEME_BOOT_SCRIPT).toContain('caros-console-theme');
  });
});

describe('#662 · tasarım sistemi sabitleri', () => {
  const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

  it('KİLİT: gece ve gündüz paletleri globals.css\'te TAM tanımlı', () => {
    const css = read('src/app/globals.css');
    for (const token of ['#0A0A0C', '#131317', '#1B1C21', '#C48350', '#3ECF8E', '#EFA53E', '#EF5245', '#5C5F68']) {
      expect(css).toContain(token);
    }
    for (const token of ['#E7E6E2', '#F2F1ED', '#DCDBD6', '#A85F2E', '#1C8F5A', '#B0741E', '#C13527', '#9A998F']) {
      expect(css).toContain(token);
    }
  });

  it('KİLİT: hareket azaltma tercihi ve odak halkası konsolda tanımlı', () => {
    const css = read('src/app/globals.css');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain(':focus-visible');
  });

  it('KİLİT: üç font ailesi de bağlı (Fraunces · Inter · JetBrains Mono)', () => {
    const layout = read('src/app/layout.tsx');
    expect(layout).toContain('Fraunces');
    expect(layout).toContain('--font-display');
    expect(layout).toContain('Inter');
    expect(layout).toContain('JetBrains_Mono');
  });

  it('KİLİT: gösterge "KANIT YOK" metnini gerçekten basar', () => {
    expect(read('src/components/console/RadialGauge.tsx')).toContain('KANIT YOK');
  });

  it('KİLİT: sağlık grafiği iki seriyi AYRI katlarda çizer (palet ΔE sınırı)', () => {
    /* Ölçüldü: gündüz temasında kritik ↔ uyarı ayrımı normal görüşte ΔE 13,5
       (güvenli eşik 15). İki seri aynı eksende bitişik boyanırsa ayırt
       edilemez. Çözüm renkte değil FORMDA: small multiples. */
    const chart = read('src/components/console/HealthTrendChart.tsx');
    expect(chart).toContain('small multiples');
    expect(chart).toContain('function Facet');
  });
});
