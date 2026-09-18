/**
 * F3 · ARACIM ANA EKRAN PROJEKSİYONU — veri dürüstlüğü matrisi.
 *
 * ── ÖLÇÜLEN BOŞLUK ───────────────────────────────────────────────────────
 * `/kumanda` açıldığında kullanıcı "arabam nasıl?" sorusunun cevabını değil,
 * bir kumanda paneli + alt tarafta sensör ızgarası görüyordu. F3 bunu tek
 * projeksiyona bağlar — ama projeksiyon hiçbir gerçeğin SAHİBİ değildir.
 *
 * ── KİLİTLENEN INVARIANTLAR ──────────────────────────────────────────────
 * UNKNOWN ≠ NORMAL · STALE ≠ CURRENT · ESTIMATE ≠ MEASUREMENT ·
 * COMMAND DELIVERED ≠ PHYSICAL STATE VERIFIED · OFFLINE ≠ UNHEALTHY.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAracimHome,
  buildAlert,
  estimateRange,
  RANGE_MIN_TRIPS,
  RANGE_MIN_DISTANCE_KM,
  type AracimHomeInput,
  type RangeTripSample,
} from '@/lib/home/aracimHome';
import { buildVehicleHealthSummary } from '@/lib/diagnostics/vehicleHealth';
import { buildVehicleFreshness, markVehicleOffline } from '@/lib/fleet/vehicleTelemetryFreshness';
import type { DtcOutcome } from '@/lib/diagnostics/dtcResultContract';
import { ALERT_THRESHOLDS } from '@/lib/constants';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const OK_COMPLETENESS = { stored: 'ok', pending: 'ok', permanent: 'ok' } as const;

function telemetry(over: { ageMs?: number; fuel?: number | null; temp?: number | null; coords?: boolean } = {}) {
  const age = over.ageMs ?? 30_000;
  const at = new Date(NOW - age).toISOString();
  return buildVehicleFreshness({
    now: NOW,
    readable: true,
    row: {
      updatedAt: at, obdObservedAt: at,
      gpsObservedAt: over.coords === false ? null : at,
      lat: over.coords === false ? null : 41.01,
      lng: over.coords === false ? null : 28.97,
      temp: over.temp === undefined ? 84 : over.temp,
      fuel: over.fuel === undefined ? 48 : over.fuel,
      rpm: 820, speed: 0,
    },
  });
}

function health(dtc: DtcOutcome | null, fresh = telemetry()) {
  return buildVehicleHealthSummary({ now: NOW, freshness: fresh, dtc, voltage: null });
}

const noDtc: DtcOutcome = {
  kind: 'NO_DTC', partial: false,
  readAt: new Date(NOW - 60_000).toISOString(), completeness: OK_COMPLETENESS,
};

const withDtc: DtcOutcome = {
  kind: 'RESULT', partial: false,
  readAt: new Date(NOW - 60_000).toISOString(), completeness: OK_COMPLETENESS,
  dtcs: [{ code: 'P0571', severity: 'warning', system: 'Fren', desc: 'Fren Pedalı Anahtarı Devresi' }],
};

function home(over: Partial<AracimHomeInput> = {}) {
  const fresh = over.vehicle?.telemetry ?? telemetry();
  return buildAracimHome({
    now: NOW,
    vehicle: { id: 'v-1', plate: '34 ABC 123', name: 'Megane', telemetry: fresh },
    health: health(noDtc, fresh),
    rangeTrips: null,
    recentTrip: null,
    lowFuelPct: ALERT_THRESHOLDS.FUEL_LOW_PCT,
    ...over,
  });
}

/* ═══ Başlık · bağlantı ══════════════════════════════════════════════════ */

describe('F3 · başlık ve bağlantı', () => {
  it('kimlik kanonik `vehicleDisplay` otoritesinden gelir', () => {
    const h = home();
    expect(h.identity.title).toBe('34 ABC 123');
    expect(h.identity.subtitle).toBe('Megane');
  });

  it('4 — araç çevrimdışıyken SAĞLIKSIZ İDDİASI yok', () => {
    const off = markVehicleOffline(telemetry({ ageMs: 3 * 3_600_000 }));
    const h = home({
      vehicle: { id: 'v-1', plate: '34 ABC 123', name: 'Megane', telemetry: off },
      health: health(null, off),
    });
    expect(h.connection.isOnline).toBe(false);
    expect(h.connection.label).toBe('Araç çevrimdışı');
    /* Bağlantı kaybı bir uyarı kartına DÖNÜŞMEZ. */
    expect(h.alert).toBeNull();
    expect(h.health?.verdict).toBe('NO_EVIDENCE');
  });

  it('18 — "son veri" kanonik cihaz tazeliğinden gelir, uydurulmaz', () => {
    expect(home().connection.lastDataLabel).toBe('Az önce');
    const old = telemetry({ ageMs: 3 * 3_600_000 });
    const h = home({ vehicle: { id: 'v-1', plate: 'X', telemetry: old } });
    expect(h.connection.lastDataLabel).toBe('3 sa önce');
  });
});

/* ═══ Sağlık hero ════════════════════════════════════════════════════════ */

describe('F3 · sağlık hero', () => {
  it('2/10 — hero F2.2 projeksiyonunu OLDUĞU GİBİ taşır', () => {
    expect(home().health?.headline).toBe('Aracınız iyi görünüyor');
    const fresh = telemetry();
    const warn = home({ health: health(withDtc, fresh) });
    expect(warn.health?.headline).toBe('Kontrol edilmesi gereken bir durum var');
  });

  it('3 — sağlık UNKNOWN iken "sağlıklı" iddiası YOK', () => {
    const h = home({ health: health(null, telemetry({ temp: null })) });
    expect(h.health?.verdict).toBe('NO_EVIDENCE');
    expect(h.health?.headline).not.toContain('iyi görünüyor');
  });

  it('henüz okunmadıysa `null` — LOADING ile UNKNOWN karışmaz', () => {
    expect(home({ health: null }).health).toBeNull();
  });
});

/* ═══ Uyarı hiyerarşisi ══════════════════════════════════════════════════ */

describe('F3 · tek önemli aksiyon', () => {
  it('11 — CRITICAL yalnız kanonik kanıt desteklerse üretilir', () => {
    const fresh = telemetry();
    const critical: DtcOutcome = {
      ...withDtc,
      dtcs: [{ code: 'P0089', severity: 'critical', system: 'Yakıt', desc: 'Yakıt Basınç Regülatörü' }],
    };
    expect(buildAlert(health(critical, fresh))?.verdict).toBe('CRITICAL');
    expect(buildAlert(health(withDtc, fresh))?.verdict).toBe('WARNING');
  });

  it('kanıt yokluğu UYARI kartına dönüşmez', () => {
    expect(buildAlert(health(null, telemetry({ temp: null })))).toBeNull();
    expect(buildAlert(health(noDtc))).toBeNull();
    expect(buildAlert(null)).toBeNull();
  });

  it('uyarı gerçek kodu taşır, kod UYDURMAZ', () => {
    const a = buildAlert(health(withDtc, telemetry()))!;
    expect(a.detail).toContain('P0571');
    expect(a.actionLabel).toBe('Detayları Gör');
  });
});

/* ═══ Yakıt · menzil ═════════════════════════════════════════════════════ */

describe('F3 · yakıt ve menzil', () => {
  it('6 — yakıt var + menzil kanıtı yok → yakıt gösterilir, menzil UYDURULMAZ', () => {
    const h = home({ rangeTrips: [] });
    expect(h.fuel).toMatchObject({ kind: 'MEASURED', percent: 48 });
    expect(h.range.kind).toBe('UNAVAILABLE');
    expect(h.range).toMatchObject({ reason: 'Menzil tahmini için yeterli tüketim verisi yok' });
  });

  it('6b — production kanıt tabanı (4/157 yolculuk) çıtayı GEÇEMEZ', () => {
    /* Gerçek ölçüm: oran hesaplanabilir yalnız 2 yolculuk, ort. 2.9 km. */
    const trips: RangeTripSample[] = [
      { distanceKm: 2.9, fuelUsedPercent: 1 },
      { distanceKm: 2.9, fuelUsedPercent: 1 },
    ];
    expect(home({ rangeTrips: trips }).range.kind).toBe('UNAVAILABLE');
  });

  it('7 — yeterli gerçek tüketim kanıtı varsa TAHMİN etiketiyle gösterilir', () => {
    const trips: RangeTripSample[] = Array.from({ length: RANGE_MIN_TRIPS }, () => ({
      distanceKm: RANGE_MIN_DISTANCE_KM / RANGE_MIN_TRIPS + 1,
      fuelUsedPercent: 2,
    }));
    const r = home({ rangeTrips: trips }).range;
    expect(r.kind).toBe('ESTIMATE');
    if (r.kind !== 'ESTIMATE') throw new Error('beklenen ESTIMATE');
    /* `~` ve provenance zorunlu: tahmin ölçüm gibi sunulmaz. */
    expect(r.display.startsWith('~')).toBe(true);
    expect(r.provenance).toContain('tahmin');
    expect(r.km).toBeGreaterThan(0);
  });

  it('bozuk/eksi tüketim satırları kanıt sayılmaz', () => {
    const trips: RangeTripSample[] = Array.from({ length: 20 }, () => ({
      distanceKm: 40, fuelUsedPercent: 0,
    }));
    expect(estimateRange({ kind: 'MEASURED', percent: 50, display: '50 %', freshness: 'LIVE', ageLabel: 'Az önce', low: false }, trips).kind)
      .toBe('UNAVAILABLE');
  });

  it('yakıt okunamadıysa menzil de üretilmez', () => {
    const h = home({ vehicle: { id: 'v-1', plate: 'X', telemetry: telemetry({ fuel: null }) } });
    expect(h.fuel.kind).toBe('UNAVAILABLE');
    expect(h.range.kind).toBe('UNAVAILABLE');
  });

  it('5 — bayat yakıt ölçümünden "yakıt bitiyor" uyarısı çıkmaz', () => {
    const stale = telemetry({ ageMs: 3 * 3_600_000, fuel: 5 });
    const h = home({ vehicle: { id: 'v-1', plate: 'X', telemetry: stale } });
    expect(h.fuel).toMatchObject({ kind: 'MEASURED', low: false });
    if (h.fuel.kind !== 'MEASURED') throw new Error('beklenen MEASURED');
    /* Değer gösterilebilir ama ETİKETLİ — canlı gibi sunulmaz. 3 saatlik
       veride cihaz penceresi (11 dk) de geçtiği için etiket "araç çevrimdışı"
       olur; bu "eski veri"den DAHA doğrudur ve tazelik katmanının kendi
       hükmüdür — projeksiyon onu yeniden yorumlamaz. */
    expect(h.fuel.display).toMatch(/eski veri|araç çevrimdışı/);
    expect(h.fuel.freshness).not.toBe('LIVE');
  });

  it('gerçekten güncel düşük yakıt bildirilir', () => {
    const h = home({ vehicle: { id: 'v-1', plate: 'X', telemetry: telemetry({ fuel: 5 }) } });
    expect(h.fuel).toMatchObject({ kind: 'MEASURED', low: true });
  });
});

/* ═══ Konum ══════════════════════════════════════════════════════════════ */

describe('F3 · konum', () => {
  it('8 — konum varsa SON KONUM olarak taşınır', () => {
    const l = home().location;
    expect(l.kind).toBe('LAST_KNOWN');
    if (l.kind !== 'LAST_KNOWN') throw new Error('beklenen LAST_KNOWN');
    expect(l.latitude).toBeCloseTo(41.01);
  });

  it('9 — park kanıtı YOK: "park yeri" kesin iddiası kurulmaz', () => {
    /* Production: `vehicle_telemetry`de park/kontak kolonu yok, yolculuk
       bitişi 138/157 `null`. Bu yüzden dil "son konum"dur. */
    const live = home().location;
    const stale = home({ vehicle: { id: 'v-1', plate: 'X', telemetry: telemetry({ ageMs: 30 * 60_000 }) } }).location;
    for (const l of [live, stale]) {
      if (l.kind !== 'LAST_KNOWN') throw new Error('beklenen LAST_KNOWN');
      expect(l.label).not.toMatch(/park/i);
    }
    if (stale.kind !== 'LAST_KNOWN') throw new Error('beklenen LAST_KNOWN');
    expect(stale.label).toBe('Aracın son konumu');
    expect(stale.isLive).toBe(false);
  });

  it('konum hiç yoksa uydurulmaz', () => {
    const h = home({ vehicle: { id: 'v-1', plate: 'X', telemetry: telemetry({ coords: false }) } });
    expect(h.location).toMatchObject({ kind: 'UNAVAILABLE' });
  });
});

/* ═══ Son yolculuk ═══════════════════════════════════════════════════════ */

describe('F3 · son yolculuk', () => {
  it('gerçek yolculuk özetlenir', () => {
    const h = home({
      recentTrip: { distanceKm: 18.4, durationMin: 34, endedAt: new Date(NOW - 7_200_000).toISOString() },
    });
    expect(h.recentTrip).toMatchObject({ distanceLabel: '18.4 km', durationLabel: '34 dk', whenLabel: '2 sa önce' });
  });

  it('mesafesi olmayan yolculuk KART DOLDURMAZ', () => {
    expect(home({ recentTrip: { distanceKm: null, durationMin: 34, endedAt: null } }).recentTrip).toBeNull();
    expect(home({ recentTrip: null }).recentTrip).toBeNull();
  });

  it('bitiş zamanı bilinmiyorsa tarih UYDURULMAZ', () => {
    const h = home({ recentTrip: { distanceKm: 5, durationMin: null, endedAt: null } });
    expect(h.recentTrip).toMatchObject({ whenLabel: 'Zaman bilinmiyor', durationLabel: null });
  });
});

/* ═══ Kaynak ayrımı ══════════════════════════════════════════════════════ */

describe('F3 · tazelikler birleştirilmez', () => {
  it('sağlık, konum ve cihaz tazeliği AYRI taşınır', () => {
    /* Tek sahte "son güncelleme" damgası üretmek, üç farklı yaştaki gerçeği
       aynı kefeye koymak olurdu (§18). */
    const fresh = telemetry({ ageMs: 30_000 });
    const h = home({
      vehicle: { id: 'v-1', plate: 'X', telemetry: fresh },
      health: health(
        { ...noDtc, readAt: new Date(NOW - 6 * 3_600_000).toISOString() },
        fresh,
      ),
    });
    expect(h.connection.lastDataLabel).toBe('Az önce');
    /* Sağlık özeti "son kontrol"ü EN YENİ kanıttan alır (burada motor
       sıcaklığı), ama her kanıt satırı KENDİ ölçüm anını taşır: 6 saatlik
       teşhis okuması, 30 saniyelik telemetriyle aynı damgaya EZİLMEZ. */
    const dtcRow = h.health!.evidence.find((e) => e.id === 'dtc')!;
    const tempRow = h.health!.evidence.find((e) => e.id === 'engineTemp')!;
    expect(NOW - (dtcRow.measuredAt as number)).toBeGreaterThan(3_600_000);
    expect(NOW - (tempRow.measuredAt as number)).toBeLessThan(60_000);
    expect(dtcRow.measuredAt).not.toBe(tempRow.measuredAt);
  });
});
