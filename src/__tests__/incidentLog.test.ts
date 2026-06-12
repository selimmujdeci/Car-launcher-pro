/**
 * incidentLog.test.ts — Remote Log v1 / Commit 5: admin incident log viewer
 *
 * Kapsam: getRemoteIncidents sorgu sözleşmesi (tipler/filtreler/sıralama/
 * pagination — yakalanan-parametre supabase mock'u, otaUpdateService.test.ts
 * deseni) · hata/boş sonuç davranışı · redactIncidentMetadata (görüntüleme
 * katmanı deny-list) · IncidentCenter UI kaynak-sözleşmesi (admin React
 * ağacı testte render edilmez — repo deseni: otaTelemetry.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const M = vi.hoisted(() => ({
  captured: {} as Record<string, unknown>,
  table: '',
  rows: [] as Array<Record<string, unknown>>,
  error: null as { message: string } | null,
}));

// Admin supabase istemcisi: env yoksa modül yüklenirken throw eder → mock şart.
// Zincir thenable'dır: await edilince { data, error } döner.
vi.mock('../admin/lib/supabaseClient', () => {
  const b: Record<string, unknown> = {};
  const capture = (key: string) => (...args: unknown[]) => { M.captured[key] = args; return b; };
  b['select'] = capture('select');
  b['in']     = capture('in');
  b['order']  = capture('order');
  b['range']  = capture('range');
  b['gte']    = capture('gte');
  b['lte']    = capture('lte');
  b['eq']     = (col: string, val: unknown) => { M.captured[`eq_${col}`] = val; return b; };
  b['then']   = (resolve: (v: unknown) => void) => resolve({ data: M.rows, error: M.error });
  return {
    supabase: { from: (table: string) => { M.table = table; return b; } },
  };
});

import {
  getRemoteIncidents,
  redactIncidentMetadata,
  INCIDENT_TYPES,
} from '../admin/services/superadmin.service';

beforeEach(() => {
  M.captured = {};
  M.table = '';
  M.rows = [];
  M.error = null;
});

/* ── Sorgu sözleşmesi ───────────────────────────────────────── */

describe('getRemoteIncidents — sorgu sözleşmesi', () => {
  it('varsayılan: vehicle_events, DÖRT incident tipi, created_at DESC, range(0,49)', async () => {
    await getRemoteIncidents();

    expect(M.table).toBe('vehicle_events');
    expect(M.captured['select']).toEqual(['id, vehicle_id, type, metadata, created_at']);
    expect(M.captured['in']).toEqual(['type', ['critical_error', 'obd_diag', 'support_snapshot', 'voice_diag']]);
    expect(M.captured['order']).toEqual(['created_at', { ascending: false }]);
    expect(M.captured['range']).toEqual([0, 49]);
    // Telemetri tipleri (heartbeat/system_health) sorguya GİRMEZ
    expect((M.captured['in'] as unknown[][])[1]).not.toContain('system_health');
    expect((M.captured['in'] as unknown[][])[1]).not.toContain('heartbeat');
  });

  it('tip filtresi: tek tip sorgulanır', async () => {
    await getRemoteIncidents({ type: 'obd_diag' });
    expect(M.captured['in']).toEqual(['type', ['obd_diag']]);
  });

  it('filtreler: vehicleId / appVersion (JSONB) / tarih aralığı', async () => {
    await getRemoteIncidents({
      vehicleId:  'veh-123',
      appVersion: '2.4.0',
      since:      '2026-06-01T00:00:00.000Z',
      until:      '2026-06-10T23:59:59.999Z',
    });
    expect(M.captured['eq_vehicle_id']).toBe('veh-123');
    expect(M.captured['eq_metadata->>appVersion']).toBe('2.4.0');
    expect(M.captured['gte']).toEqual(['created_at', '2026-06-01T00:00:00.000Z']);
    expect(M.captured['lte']).toEqual(['created_at', '2026-06-10T23:59:59.999Z']);
  });

  it('filtre verilmeyince eq/gte/lte hiç çağrılmaz', async () => {
    await getRemoteIncidents();
    expect(M.captured).not.toHaveProperty('eq_vehicle_id');
    expect(M.captured).not.toHaveProperty('eq_metadata->>appVersion');
    expect(M.captured).not.toHaveProperty('gte');
    expect(M.captured).not.toHaveProperty('lte');
  });

  it('pagination: offset+limit → range(offset, offset+limit-1)', async () => {
    await getRemoteIncidents({ offset: 50, limit: 50 });
    expect(M.captured['range']).toEqual([50, 99]);

    await getRemoteIncidents({ offset: 0, limit: 20 });
    expect(M.captured['range']).toEqual([0, 19]);
  });

  it('başarılı sonuç: rows döner, error null', async () => {
    M.rows = [{ id: '1', vehicle_id: 'v', type: 'critical_error', metadata: {}, created_at: 'x' }];
    const r = await getRemoteIncidents();
    expect(r.rows).toHaveLength(1);
    expect(r.error).toBeNull();
  });

  it('sorgu hatası: boş rows + error mesajı (sessiz [] DEĞİL)', async () => {
    M.error = { message: 'permission denied' };
    const r = await getRemoteIncidents();
    expect(r.rows).toEqual([]);
    expect(r.error).toBe('permission denied');
  });

  it('INCIDENT_TYPES sabiti dört log tipini içerir (voice_diag — P0 Voice Diagnostics)', () => {
    expect([...INCIDENT_TYPES]).toEqual(['critical_error', 'obd_diag', 'support_snapshot', 'voice_diag']);
  });
});

/* ── Redaction (görüntüleme katmanı) ────────────────────────── */

describe('redactIncidentMetadata — hassas anahtar render edilmez', () => {
  it('deny anahtarları HER derinlikte düşer (sanitizer öncesi eski kayıtlar)', () => {
    const out = redactIncidentMetadata({
      ctx: 'OBD', msg: 'ok', errorCode: 'E1',
      lat: 41.0, lng: 29.0, location: { lat: 1 }, address: 'x',
      vin: 'WVW', plate: '34AB', plaka: '34', phone: '+90', contact: 'c',
      ssid: 'wifi', bssid: 'b', mac: 'AA:BB', api_key: 'k', token: 't',
      obd: { connectionState: 'connected', MAC: 'CC:DD', nested: { Token: 'x', safe: 1 } },
      lastErrors: [{ ctx: 'GPS', LAT: 5, msg: 'm' }],
    }) as Record<string, unknown>;

    expect(out.ctx).toBe('OBD');
    for (const k of ['lat', 'lng', 'location', 'address', 'vin', 'plate', 'plaka',
                     'phone', 'contact', 'ssid', 'bssid', 'mac', 'api_key', 'token']) {
      expect(out, `deny anahtarı sızdı: ${k}`).not.toHaveProperty(k);
    }
    const obd = out.obd as Record<string, unknown>;
    expect(obd.connectionState).toBe('connected');
    expect(obd).not.toHaveProperty('MAC');
    expect((obd.nested as Record<string, unknown>).safe).toBe(1);
    expect(obd.nested).not.toHaveProperty('Token');

    const err0 = (out.lastErrors as Array<Record<string, unknown>>)[0]!;
    expect(err0.msg).toBe('m');
    expect(err0).not.toHaveProperty('LAT');
  });

  it('primitive ve null değerler aynen geçer', () => {
    expect(redactIncidentMetadata(null)).toBeNull();
    expect(redactIncidentMetadata('str')).toBe('str');
    expect(redactIncidentMetadata(42)).toBe(42);
  });
});

/* ── UI kaynak-sözleşmesi ───────────────────────────────────── */

describe('IncidentCenter — UI sözleşmesi', () => {
  const page  = readFileSync(join(process.cwd(), 'src/admin/pages/superadmin/IncidentCenter.tsx'), 'utf-8');
  const app   = readFileSync(join(process.cwd(), 'src/admin/App.tsx'), 'utf-8');
  const shell = readFileSync(join(process.cwd(), 'src/admin/layouts/SuperAdminShell.tsx'), 'utf-8');

  it('servis sorgusunu kullanır ve metadata render ÖNCESİ redact edilir', () => {
    expect(page).toContain('getRemoteIncidents');
    expect(page).toMatch(/redactIncidentMetadata\(entry\.metadata/);
  });

  it('support_snapshot detayı: SAĞLIK / OBD / OTA / SON KRİTİK bölümleri', () => {
    expect(page).toContain('title="SAĞLIK"');
    expect(page).toContain('title="OBD"');
    expect(page).toContain('title="OTA"');
    expect(page).toContain('title="SON KRİTİK"');
    expect(page).toMatch(/md\['health'\]/);
    expect(page).toMatch(/md\['lastCritical'\]/);
  });

  it('satır kolonları: vehicle/type/ctx-phase/errorCode/msg/created_at', () => {
    expect(page).toContain("'ZAMAN', 'ARAÇ', 'TİP', 'BAĞLAM/AŞAMA', 'HATA KODU', 'MESAJ / SÜRÜM'");
    expect(page).toMatch(/md\['phase'\] \?\? md\['ctx'\]/);
    expect(page).toMatch(/md\['errorCode'\]/);
  });

  it('filtre kontrolleri: tip / araç / appVersion / tarih aralığı', () => {
    expect(page).toContain('INCIDENT_TYPES.map');
    expect(page).toContain('placeholder="araç id"');
    expect(page).toContain('appVersion');
    expect(page).toMatch(/type="date"/);
  });

  it('boş durum + hata durumu + retry mevcut', () => {
    expect(page).toContain('OLAY_YOK');
    expect(page).toContain('SORGU_HATASI');
    expect(page).toContain('TEKRAR DENE');
  });

  it('pagination kontrolleri: Prev/Next + sayfa boyu kapısı', () => {
    expect(page).toContain('PAGE_SIZE = 50');
    expect(page).toMatch(/rows\.length < PAGE_SIZE/);  // son sayfada Next kilitli
    expect(page).toMatch(/page === 0/);                // ilk sayfada Prev kilitli
  });

  it('route + sidebar modülü kayıtlı', () => {
    expect(app).toContain("import { IncidentCenter }    from './pages/superadmin/IncidentCenter'");
    expect(app).toContain('<Route path="incidents"   element={<IncidentCenter />} />');
    expect(shell).toMatch(/path: 'incidents'/);
  });
});
