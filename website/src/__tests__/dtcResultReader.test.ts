/**
 * dtcResultReader — telefonun sonuç okuma yolu.
 *
 * Yetki otoritesi VERİTABANINDADIR ("commands: okuyabilir" →
 * is_vehicle_owner OR is_paired; production katalogdan doğrulandı).
 * Bu testler adaptörün o otoriteyi taşımadığını ve okunamayan satırı
 * "arıza yok"a çevirmediğini kilitler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  row: null as unknown,
  error: null as unknown,
  lastFilters: [] as Array<[string, string]>,
  lastColumns: '',
}));

vi.mock('@/lib/supabase', () => ({
  supabaseBrowser: {
    from: () => ({
      select: (cols: string) => {
        db.lastColumns = cols;
        const chain = {
          eq: (col: string, val: string) => { db.lastFilters.push([col, val]); return chain; },
          maybeSingle: async () => ({ data: db.row, error: db.error }),
        };
        return chain;
      },
    }),
  },
}));

import { readDtcOutcome } from '@/lib/diagnostics/dtcResultReader';

beforeEach(() => {
  db.row = null; db.error = null; db.lastFilters = []; db.lastColumns = '';
});

describe('F2.1 · sonuç okuyucu', () => {
  it('komut ve araç kimliğinin İKİSİNİ de filtreler (bağ doğrulaması)', async () => {
    db.row = {
      id: 'c1', vehicle_id: 'v1', type: 'read_dtc', status: 'completed',
      result: { dtcs: [], completeness: { stored: 'ok' } }, error_message: null,
    };
    await readDtcOutcome('c1', 'v1');
    expect(db.lastFilters).toEqual([['id', 'c1'], ['vehicle_id', 'v1']]);
    /* En az yetki: yalnız gereken kolonlar istenir. */
    expect(db.lastColumns).not.toContain('payload');
    expect(db.lastColumns).not.toContain('nonce');
  });

  it('RLS reddederse (boş satır) sonuç ÜRETİLMEZ — "arıza yok" denmez', async () => {
    db.row = null;
    const out = await readDtcOutcome('c1', 'v1');
    expect(out.kind).toBe('FAILED');
    expect(out.kind).not.toBe('NO_DTC');
  });

  it('okuma hatası da sessiz boş sonuca dönüşmez', async () => {
    db.error = { message: 'permission denied' };
    const out = await readDtcOutcome('c1', 'v1');
    expect(out.kind).toBe('FAILED');
  });

  it('gerçek ölçüm gövdesi kanonik yoruma geçer', async () => {
    db.row = {
      id: 'c1', vehicle_id: 'v1', type: 'read_dtc', status: 'completed',
      result: {
        dtcs: [{ code: 'P0571', severity: 'warning', system: 'Fren', desc: 'Fren Pedalı Anahtarı Devresi' }],
        completeness: { stored: 'ok', pending: 'ok', permanent: 'ok' },
        readAt: new Date().toISOString(),
      },
      error_message: null,
    };
    const out = await readDtcOutcome('c1', 'v1');
    expect(out).toMatchObject({ kind: 'RESULT' });
  });
});
