/**
 * F3 · ARACIM YÜZEYİ — gerçek render + navigasyon sözleşmesi.
 *
 * YAKLAŞIM: `@testing-library/react` depoda YOK ve yeni bağımlılık eklenmez
 * (proje konvansiyonu). Render kanıtı `renderToStaticMarkup` ile alınır.
 *
 * Bu dosya iki şeyi kilitler:
 *   A) Ana ekran GERÇEK ÜRETMEZ — projeksiyonu basar ve yokluğu yokluk gösterir.
 *   B) Navigasyon 5 ana yüzeye indi; eşleştirme ve tema ana çubuğu işgal etmez.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HealthCardView } from '@/components/pwa/VehicleHealthCard';
import { buildVehicleHealthSummary } from '@/lib/diagnostics/vehicleHealth';
import { buildAracimHome, type AracimHomeInput } from '@/lib/home/aracimHome';
import { buildVehicleFreshness } from '@/lib/fleet/vehicleTelemetryFreshness';
import { ALERT_THRESHOLDS } from '@/lib/constants';
import type { DtcOutcome } from '@/lib/diagnostics/dtcResultContract';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const OK_COMPLETENESS = { stored: 'ok', pending: 'ok', permanent: 'ok' } as const;

function telemetry(over: { ageMs?: number; fuel?: number | null } = {}) {
  const at = new Date(NOW - (over.ageMs ?? 30_000)).toISOString();
  return buildVehicleFreshness({
    now: NOW, readable: true,
    row: {
      updatedAt: at, obdObservedAt: at, gpsObservedAt: at,
      lat: 41.01, lng: 28.97, temp: 84,
      fuel: over.fuel === undefined ? 48 : over.fuel,
      rpm: 820, speed: 0,
    },
  });
}

function model(over: Partial<AracimHomeInput> = {}) {
  const fresh = telemetry();
  return buildAracimHome({
    now: NOW,
    vehicle: { id: 'v-1', plate: '34 ABC 123', name: 'Megane', telemetry: fresh },
    health: buildVehicleHealthSummary({ now: NOW, freshness: fresh, dtc: null, voltage: null }),
    rangeTrips: null,
    recentTrip: null,
    lowFuelPct: ALERT_THRESHOLDS.FUEL_LOW_PCT,
    ...over,
  });
}

const PAGE = readFileSync(
  join(process.cwd(), 'src/app/(pwa)/kumanda/page.tsx'),
  'utf8',
);

/* ═══ A · Navigasyon sözleşmesi ══════════════════════════════════════════ */

describe('F3 · navigasyon sadeleşmesi', () => {
  it('ana çubuk TAM 5 yüzey taşır', () => {
    const ids = [...PAGE.matchAll(/id: '(aracim|yolculuklar|saglik|harita|daha)'/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(5);
  });

  it('16 — eşleştirme ve tema ana çubukta DEĞİL', () => {
    /* Bağlı aracı olan kullanıcı her açılışta eşleştirme görmemeli. */
    const primary = PAGE.slice(PAGE.indexOf('const PRIMARY_TABS'), PAGE.indexOf('DAHA FAZLA —'));
    expect(primary).not.toContain("'eslestir'");
    expect(primary).not.toContain("'tema'");
    expect(primary).not.toContain("'kayitlar'");
  });

  it('ikincil yüzeyler KAYBOLMADI — `daha` altından erişilir', () => {
    /* Literal union'ı birebir sınamak KIRILGANDI: F4.3'te `hafiza` eklenince
       düştü ama korunan gerçek (ikincil yüzey KAYBOLMASIN) bozulmamıştı.
       Kilit artık her yüzeyi TEK TEK arar — yeni yüzey eklenmesi kırmaz,
       mevcut bir yüzeyin silinmesi kırar. */
    const secondary = PAGE.slice(PAGE.indexOf('type SecondaryTab'));
    for (const surface of ['eslestir', 'kayitlar', 'tema']) {
      expect(secondary, surface).toContain(`'${surface}'`);
    }
    expect(PAGE).toContain("activeTab === 'daha'");
    /* Araç yokken otomatik eşleştirmeye geçiş yolu KIRILMADI. */
    expect(PAGE).toContain("setActiveTab('eslestir')");
  });

  it('ana ekran tek yerden kurulur ve araç kimliğiyle sıfırlanır (§17)', () => {
    const home = PAGE.slice(PAGE.indexOf('<AracimHome'), PAGE.indexOf('</>', PAGE.indexOf('<AracimHome')));
    expect(home).toContain("key={vehicle?.id ?? 'no-active-vehicle'}");
  });
});

/* ═══ B · Ana ekran modeli gerçek render ile ═════════════════════════════ */

describe('F3 · ana ekran projeksiyonu render edilebilir', () => {
  it('2 — sağlık hero kanonik projeksiyondan gelir', () => {
    const m = model();
    const html = renderToStaticMarkup(
      <HealthCardView summary={m.health} loading={false} now={NOW} />,
    );
    expect(html).toContain('Aracınız iyi görünüyor');
    expect(m.health?.headline).toBe('Aracınız iyi görünüyor');
  });

  it('3/19 — okuma sürerken "kanıt yok" DENMEZ', () => {
    const html = renderToStaticMarkup(
      <HealthCardView summary={null} loading={true} now={NOW} />,
    );
    expect(html).toContain('okunuyor');
    expect(html).not.toContain('iyi görünüyor');
    expect(html).not.toContain('Güncel sağlık verisi bekleniyor');
  });

  it('12/13 — fiziksel kilit durumu İDDİA EDİLMEZ', () => {
    /* Production ölçümü: `vehicle_telemetry` şemasında kilit/kapı/kontak
       kolonu YOK ve F0.3 `commandEvidence` `VERIFIED`i ulaşılamaz tutuyor.
       Ana ekran modeli bu yüzden kilit durumu TAŞIMAZ. */
    const m = model();
    const keys = Object.keys(m);
    expect(keys).not.toContain('lockState');
    expect(keys).not.toContain('doorState');
    expect(JSON.stringify(m)).not.toMatch(/kilitli|kilidi açık/i);
  });

  it('6 — menzil kanıtı yokken ana ekran sayı TAŞIMAZ', () => {
    const m = model();
    expect(m.range.kind).toBe('UNAVAILABLE');
    expect(JSON.stringify(m.range)).not.toMatch(/\d+ km/);
  });

  it('9 — model hiçbir yerde "park" iddiası kurmaz', () => {
    expect(JSON.stringify(model())).not.toMatch(/park/i);
  });
});

/* ═══ C · Mimari muhafızlar ══════════════════════════════════════════════ */

describe('F3 · ikinci otorite kurulmadı', () => {
  it('ana ekran KOMUT otoritesi kurmaz — mevcut yüzeyi kullanır', () => {
    const home = readFileSync(
      join(process.cwd(), 'src/components/pwa/AracimHome.tsx'), 'utf8',
    );
    /* Komut gönderimi yalnız `MobileCarControl` üzerinden; burada
       `sendCommand` çağrısı OLMAMALI. */
    expect(home).toContain("import MobileCarControl");
    expect(home).not.toMatch(/\bsendCommand\s*\(/);
    expect(home).not.toContain('commandService');
  });

  it('ana ekran SAĞLIK otoritesi kurmaz — F2.2 projeksiyonunu taşır', () => {
    const home = readFileSync(
      join(process.cwd(), 'src/components/pwa/AracimHome.tsx'), 'utf8',
    );
    expect(home).not.toContain('buildVehicleHealthSummary');
    expect(home).toContain('useVehicleHealth');
  });

  it('sağlık okuması TEK yoldadır (kart ve ana ekran aynı hook)', () => {
    const card = readFileSync(
      join(process.cwd(), 'src/components/pwa/VehicleHealthCard.tsx'), 'utf8',
    );
    expect(card).toContain('useVehicleHealth');
    expect(card).not.toContain('readLatestDtcOutcome');
  });

  it('ana ekran AKTİF ARAÇ otoritesi kurmaz', () => {
    const home = readFileSync(
      join(process.cwd(), 'src/components/pwa/AracimHome.tsx'), 'utf8',
    );
    /* Seçim yukarıdan gelir (`vehicleStore.setActiveVehicleId`); burada
       ikinci bir seçim deposu YOK. */
    expect(home).not.toContain('useVehicleStore');
    expect(home).toContain('onSelectVehicle');
  });
});

/* ═══ D · Araç izolasyonu ════════════════════════════════════════════════ */

describe('F3 · araç geçişinde sızıntı yok', () => {
  it('16 — A aracının verisi B modelinde GÖRÜNMEZ', () => {
    const a = model({
      vehicle: { id: 'A', plate: '34 AAA 111', name: 'Megane', telemetry: telemetry({ fuel: 90 }) },
    });
    const b = model({
      vehicle: { id: 'B', plate: '06 BBB 222', name: 'Doblo', telemetry: telemetry({ fuel: 12 }) },
      health: null,
    });
    expect(a.identity.title).toBe('34 AAA 111');
    expect(b.identity.title).toBe('06 BBB 222');
    expect(b.health).toBeNull();
    if (b.fuel.kind !== 'MEASURED') throw new Error('beklenen MEASURED');
    expect(b.fuel.percent).toBe(12);
  });

  it('geç gelen okuma damgayla elenir (hook sözleşmesi)', () => {
    const hook = readFileSync(
      join(process.cwd(), 'src/hooks/useVehicleHealth.ts'), 'utf8',
    );
    expect(hook).toContain('requestedFor.current !== vehicleId');
  });
});
