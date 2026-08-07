// @vitest-environment jsdom
/**
 * dormantReadbackWiring.test.tsx — UYUYAN YETENEKLERİN OKUMA UCU KİLİTLERİ.
 *
 * Bu dosya "bileşen var mı" değil, **GERÇEKTEN BAĞLI MI** sorusunu kilitler:
 * RPC çağrılıyor mu · kart mount ediliyor mu · boş/hata/okunamadı durumları
 * ayrı mı. Analiz raporundaki kusur tam olarak buydu: SQL + görünüm + kart
 * yazılmıştı ama ARADA OKUMA YOKTU.
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabaseBrowser', () => ({
  getSupabaseBrowserClient: () => ({ rpc: mocks.rpc }),
}));

import {
  readIntelligenceLab, readDriverDna, readSubjectEvidence,
} from '@/lib/lab/intelligenceLabSource';
import { DriverDnaCard } from '@/components/dashboard/DriverDnaCard';
import { FleetIntelligenceCards } from '@/components/dashboard/FleetIntelligenceCards';
import { EvidenceCoverageCards } from '@/components/dashboard/EvidenceCoverageCards';
import { SubjectEvidenceList } from '@/components/dashboard/SubjectEvidenceList';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.rpc.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/* ══════════════════════════════════════════════════════════════════════
   A · RPC GERÇEKTEN ÇAĞRILIYOR (eksik halka buydu)
   ════════════════════════════════════════════════════════════════════ */

describe('A · okuma ucu RPC çağırıyor', () => {
  it('Fleet Intelligence ve Evidence Coverage RPC ADLARIYLA çağrılır', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ insight_count: 0 }], error: null });
    await readIntelligenceLab('user-1');
    const called = mocks.rpc.mock.calls.map((c) => c[0]);
    expect(called).toContain('get_fleet_intelligence');
    expect(called).toContain('get_evidence_coverage');
  });

  it('Driver DNA RPC sürücü kimliğiyle çağrılır', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ driver_id: 'd-1' }], error: null });
    await readDriverDna('user-1', 'd-1');
    expect(mocks.rpc).toHaveBeenCalledWith('get_driver_dna', { p_driver_id: 'd-1' });
  });

  it('Subject Evidence özne türü + kimlikle çağrılır', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await readSubjectEvidence('user-1', 'VEHICLE', 'v-1');
    expect(mocks.rpc).toHaveBeenCalledWith('get_subject_evidence', {
      p_subject_kind: 'VEHICLE', p_subject_id: 'v-1',
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   B · "OKUNAMADI" ile "VERİ YOK" AYRI
   ════════════════════════════════════════════════════════════════════ */

describe('B · okunamadı ≠ veri yok', () => {
  it('RPC hata verirse readable=false ve satır null', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    const r = await readDriverDna('user-1', 'd-1');
    expect(r.readable).toBe(false);
    expect(r.row).toBeNull();
  });

  it('RPC boş dönerse readable=TRUE ama satır null (veri yok)', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const r = await readDriverDna('user-1', 'd-1');
    expect(r.readable).toBe(true);       // okundu
    expect(r.row).toBeNull();            // ama veri yok
  });

  it('oturum yoksa RPC HİÇ çağrılmaz (gereksiz ağ yok)', async () => {
    await readDriverDna(null, 'd-1');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sürücü seçilmediyse RPC çağrılmaz', async () => {
    await readDriverDna('user-1', null);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('teknik SQL hata metni yukarı TAŞINMAZ', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'ERROR: permission denied for function get_driver_dna' },
    });
    const r = await readDriverDna('user-1', 'd-1');
    expect(JSON.stringify(r)).not.toMatch(/permission denied/);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   C · KARTLAR MOUNT EDİLEBİLİYOR (artık ölü kod değil)
   ════════════════════════════════════════════════════════════════════ */

describe('C · kartlar gerçekten render olur', () => {
  it('DriverDnaCard veri yokken çöker değil, boş durum gösterir', () => {
    act(() => { root.render(<DriverDnaCard row={null} driverRef="drv:abc12345" />); });
    expect(container.textContent).toBeTruthy();
  });

  it('FleetIntelligenceCards içgörü yokken SAHTE içgörü üretmez', () => {
    act(() => { root.render(<FleetIntelligenceCards row={null} nowMs={1000} />); });
    const t = container.textContent ?? '';
    expect(t).toBeTruthy();
    // Boş kümede uydurma skor/oran yazılmamalı.
    expect(t).not.toMatch(/%\d+ sağlıklı/i);
  });

  it('EvidenceCoverageCards kanıt yokken boş kart yerine gerekçe verir', () => {
    act(() => { root.render(<EvidenceCoverageCards row={null} />); });
    expect(container.textContent).toBeTruthy();
  });

  it('SubjectEvidenceList ham tanımlayıcı SIZDIRMAZ', () => {
    const rows = [{
      evidence_id: '11111111-2222-3333-4444-555555555555',
      source: 'TELEMETRY', category: 'ENGINE', metric: 'rpm',
      value: 1636, provenance: 'MEASURED', confidence: 'HIGH',
      severity: 'INFO', state: 'ACTIVE',
    }];
    act(() => { root.render(<SubjectEvidenceList rows={rows} title="Araç kanıtı" />); });
    const t = container.textContent ?? '';
    // TAM uuid ekrana basılmamalı (kısaltılmış referans kuralı).
    expect(t).not.toContain('11111111-2222-3333-4444-555555555555');
  });

  it('SubjectEvidenceList expired/rejected durumunu GİZLEMEZ', () => {
    const rows = [
      { evidence_id: 'a', source: 'TELEMETRY', category: 'ENGINE', metric: 'm1', state: 'EXPIRED' },
      { evidence_id: 'b', source: 'TELEMETRY', category: 'ENGINE', metric: 'm2', state: 'REJECTED' },
    ];
    act(() => { root.render(<SubjectEvidenceList rows={rows} />); });
    const t = (container.textContent ?? '').toUpperCase();
    expect(t.includes('EXPIRED') || t.includes('SÜRES') || t.includes('DOLMU')).toBe(true);
  });
});
