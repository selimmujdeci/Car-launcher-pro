/**
 * F2.2 · SAĞLIK YÜZEYİ — okuma yolu + gerçek bileşen render'ı.
 *
 * YAKLAŞIM: `@testing-library/react` depoda YOK ve yeni bağımlılık eklenmez
 * (proje konvansiyonu). Render kanıtı `renderToStaticMarkup` ile alınır; bu
 * mümkündür çünkü kart bilinçli olarak İKİYE ayrıldı:
 *   · `HealthCardView`  → SAF görünüm (fetch yok, eşik yok, hüküm yok)
 *   · `VehicleHealthCard` → okuma konteyneri
 * Yani "UI karar üretmiyor" iddiası yapısal olarak sınanabilir.
 *
 * Yetki otoritesi VERİTABANINDADIR (RLS "commands: okuyabilir" →
 * is_vehicle_owner OR is_paired). Buradaki testler adaptörün o otoriteyi
 * TAŞIMADIĞINI ve başka araca ait satırdan sağlık üretmediğini kilitler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const db = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  queries: [] as Array<{ filters: Array<[string, string]>; order?: string; limit?: number; columns: string }>,
}));

vi.mock('@/lib/supabase', () => ({
  supabaseBrowser: {
    from: () => ({
      select: (columns: string) => {
        const q = { filters: [] as Array<[string, string]>, columns } as (typeof db.queries)[number];
        db.queries.push(q);
        const chain = {
          eq: (col: string, val: string) => { q.filters.push([col, val]); return chain; },
          order: (col: string) => { q.order = col; return chain; },
          limit: (n: number) => { q.limit = n; return chain; },
          maybeSingle: async () => {
            const type = q.filters.find(([c]) => c === 'type')?.[1] ?? 'read_dtc';
            return { data: db.rows[type] ?? null, error: null };
          },
        };
        return chain;
      },
    }),
  },
}));

import {
  readLatestDtcOutcome,
  readLatestVoltageOutcome,
  DTC_HEALTH_MAX_AGE_MS,
} from '@/lib/diagnostics/dtcResultReader';
import { HealthCardView } from '@/components/pwa/VehicleHealthCard';
import { buildVehicleHealthSummary } from '@/lib/diagnostics/vehicleHealth';
import { buildVehicleFreshness } from '@/lib/fleet/vehicleTelemetryFreshness';
import type { DtcOutcome, VoltageOutcome } from '@/lib/diagnostics/dtcResultContract';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const VEHICLE = 'veh-1';

function dtcRow(over: Record<string, unknown> = {}) {
  return {
    id: 'cmd-1', vehicle_id: VEHICLE, type: 'read_dtc', status: 'completed',
    error_message: null,
    result: {
      dtcs: [], completeness: { stored: 'ok', pending: 'ok', permanent: 'ok' },
      readAt: new Date(NOW - 60_000).toISOString(),
    },
    ...over,
  };
}

const liveTelemetry = () => {
  const at = new Date(NOW - 30_000).toISOString();
  return buildVehicleFreshness({
    now: NOW, readable: true,
    row: { updatedAt: at, obdObservedAt: at, temp: 84, fuel: 55, rpm: 820, speed: 0 },
  });
};

function markup(over: { dtc?: DtcOutcome | null; voltage?: VoltageOutcome | null; telemetry?: boolean } = {}) {
  const summary = buildVehicleHealthSummary({
    now: NOW,
    freshness: over.telemetry === false ? undefined : liveTelemetry(),
    dtc: over.dtc ?? null,
    voltage: over.voltage ?? null,
  });
  return renderToStaticMarkup(<HealthCardView summary={summary} loading={false} now={NOW} />);
}

const noDtc: DtcOutcome = {
  kind: 'NO_DTC', partial: false,
  readAt: new Date(NOW - 60_000).toISOString(),
  completeness: { stored: 'ok', pending: 'ok', permanent: 'ok' },
};

beforeEach(() => { db.rows = {}; db.queries = []; });

/* ═══ Okuma yolu ═════════════════════════════════════════════════════════ */

describe('F2.2 · son ölçümün okunması', () => {
  it('araç + komut türü filtrelenir, EN YENİ tek satır istenir', async () => {
    db.rows['read_dtc'] = dtcRow();
    await readLatestDtcOutcome(VEHICLE, { now: NOW });
    const q = db.queries[0];
    expect(q.filters).toEqual([['vehicle_id', VEHICLE], ['type', 'read_dtc']]);
    expect(q.order).toBe('created_at');
    expect(q.limit).toBe(1);
    /* En az yetki: yalnız gereken kolonlar. */
    expect(q.columns).not.toContain('payload');
  });

  it('hiç okuma yoksa `null` döner — "arıza yok" DEĞİL', async () => {
    expect(await readLatestDtcOutcome(VEHICLE)).toBeNull();
    expect(await readLatestVoltageOutcome(VEHICLE)).toBeNull();
  });

  it('BAŞKA araca ait satır sağlık üretmez (IDOR ek savunması)', async () => {
    /* Birincil koruma RLS'tedir; bu, satır bir şekilde gelse bile telefonun
       onu bu aracın sağlığı sanmayacağını kilitler. */
    db.rows['read_dtc'] = dtcRow({ vehicle_id: 'baska-arac' });
    const out = await readLatestDtcOutcome(VEHICLE, { now: NOW });
    expect(out).toMatchObject({ kind: 'FAILED', reason: 'Komut bu araca ait değil' });
  });

  it('güven penceresinden eski sonuç STALE olur (bugünün manşeti olamaz)', async () => {
    db.rows['read_dtc'] = dtcRow({
      result: {
        dtcs: [], completeness: { stored: 'ok' },
        readAt: new Date(NOW - DTC_HEALTH_MAX_AGE_MS - 60_000).toISOString(),
      },
    });
    const out = await readLatestDtcOutcome(VEHICLE, { now: NOW });
    expect(out?.kind).toBe('STALE');
  });

  it('voltaj: sıfır ölçüm "akü bitti" diye SUNULMAZ', async () => {
    db.rows['read_voltage'] = {
      id: 'c2', vehicle_id: VEHICLE, type: 'read_voltage', status: 'completed',
      error_message: null, result: { voltage: 0, readAt: new Date(NOW).toISOString() },
    };
    expect(await readLatestVoltageOutcome(VEHICLE, { now: NOW })).toMatchObject({ kind: 'FAILED' });
  });

  it('voltaj: gerçek ölçüm RESULT olur', async () => {
    db.rows['read_voltage'] = {
      id: 'c2', vehicle_id: VEHICLE, type: 'read_voltage', status: 'completed',
      error_message: null, result: { voltage: 12.6, readAt: new Date(NOW).toISOString() },
    };
    expect(await readLatestVoltageOutcome(VEHICLE, { now: NOW }))
      .toMatchObject({ kind: 'RESULT', volts: 12.6 });
  });
});

/* ═══ Gerçek render ══════════════════════════════════════════════════════ */

describe('F2.2 · sağlık kartı (gerçek render)', () => {
  it('UI hüküm ÜRETMEZ — kanonik projeksiyonu render eder', () => {
    const html = markup({ dtc: noDtc });
    expect(html).toContain('Aracınız iyi görünüyor');
    /* Kapsam DAİMA açıkça anlatılır — mutlak sağlık iddiası yok. */
    expect(html).toContain('Mevcut güncel verilere göre');
    expect(html).not.toMatch(/tamamen sağlıklı|kesinlikle sağlam/);
  });

  it('arıza kodu varsa araçtan geleni gösterir, kod UYDURMAZ', () => {
    const html = markup({
      dtc: {
        kind: 'RESULT', partial: false,
        readAt: new Date(NOW - 60_000).toISOString(),
        completeness: { stored: 'ok' },
        dtcs: [{ code: 'P0571', severity: 'warning', system: 'Fren', desc: 'Fren Pedalı Anahtarı Devresi' }],
      },
    });
    expect(html).toContain('Kontrol edilmesi gereken bir durum var');
    expect(html).toContain('P0571');
    expect(html).toContain('Fren Pedalı Anahtarı Devresi');
    /* Kanıtsız teşhis/talimat ÜRETİLMEZ (§10). */
    expect(html).not.toMatch(/değiştirin|kullanmayın|kesinlikle bozuk/i);
  });

  it('kanıt yoksa sakin ve dürüst UNKNOWN gösterir', () => {
    const html = markup({ telemetry: false });
    expect(html).toContain('Güncel sağlık verisi bekleniyor');
    expect(html).toContain('yeterli güncel ölçüm alınamadı');
    /* Ölçülmeyen kanıt SAHTE KART ile doldurulmaz. */
    expect(html).toContain('Hiç ölçülmedi');
    expect(html).toContain('Akü voltajı ölçülmedi');
  });

  it('BAĞLANTI sağlıktan ayrı gösterilir ve arıza sayılmaz (§11)', () => {
    const html = markup({
      dtc: { kind: 'OFFLINE', reason: 'Araç bağlantısı yok: teşhis okuması yapılamadı' },
      telemetry: false,
    });
    expect(html).toContain('Bağlantı');
    expect(html).not.toMatch(/Aracınız arızalı|arızalı görünüyor/);
    expect(html).toContain('Güncel sağlık verisi bekleniyor');
  });

  it('kısmi tarama kullanıcıya açıkça söylenir', () => {
    const html = markup({ dtc: { ...noDtc, partial: true } });
    expect(html).toContain('Teşhis taraması kısmi');
  });

  it('veri hiç gelmediyse sağlık iddiası basmaz', () => {
    const html = renderToStaticMarkup(<HealthCardView summary={null} loading={false} now={NOW} />);
    expect(html).toContain('Sağlık verisi okunamadı');
    expect(html).not.toContain('iyi görünüyor');
  });
});
