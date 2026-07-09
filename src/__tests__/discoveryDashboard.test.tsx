/**
 * discoveryDashboard.test.tsx — DiscoveryDashboard bileşeni smoke + empty-state +
 * dolu render + canlı gözlem kaynağı (PR-DISC-3). RTL yok → renderToStaticMarkup (SSR)
 * ile ilk render markup'ı doğrulanır; canlı akış servisin gözlem katmanından beslenir.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(async () => {}) } }));

import { DiscoveryDashboard } from '../components/discovery/DiscoveryDashboard';
import { discoveryCaptureService } from '../platform/obd/discovery';

beforeEach(() => {
  discoveryCaptureService.reset();
  try { localStorage.clear(); } catch { /* jsdom */ }
});

describe('DiscoveryDashboard', () => {
  it('çökmeden mount olur + özet kartı başlıklarını basar', () => {
    let html = '';
    expect(() => { html = renderToStaticMarkup(<DiscoveryDashboard />); }).not.toThrow();
    expect(html).toContain('Keşif (Discovery)');
    expect(html).toContain('Yeni PID');
    expect(html).toContain('Yeni DID');
    expect(html).toContain('Duplicate');
    expect(html).toContain('de mevcut'); // "Registry'de mevcut" — apostrof HTML'de escape edilir
    expect(html).toContain('Son keşif');
  });

  it('kayıt yokken açıklayıcı EMPTY STATE gösterir', () => {
    const html = renderToStaticMarkup(<DiscoveryDashboard />);
    expect(html).toContain('Henüz yeni PID veya DID keşfedilmedi.');
    expect(html).toContain('OBD cihazını bağlayın');
    expect(html).not.toContain('data-testid="discovery-list"');
  });

  it('gözlem gelince liste render edilir (canlı kaynak) + rozet/alanlar', () => {
    // Servise gerçek capture ile katalog-dışı sinyaller ekle (gözlem katmanını besler).
    discoveryCaptureService.capture({
      pidOrDid: '242E', discoverySource: 'DID', mode: '22', ecuAddress: '7E0',
      request: '22242E', rawResponse: 'AABBCC', supported: true, vehicleProfile: 'Renault Trafic',
    });
    discoveryCaptureService.capture({
      pidOrDid: 'A5', discoverySource: 'PID', mode: '01', ecuAddress: '7E8',
      request: '0100', rawResponse: 'BE1FB813', supported: true,
    });

    const html = renderToStaticMarkup(<DiscoveryDashboard />);
    expect(html).toContain('data-testid="discovery-list"'); // empty state DEĞİL
    expect(html).toContain('242E');
    expect(html).toContain('A5');
    expect(html).toContain('7E0');
    expect(html).toContain('Renault Trafic');
    expect(html).toContain('NEW');       // rozet
    expect(html).toContain('2 / 2 kayıt gösteriliyor');
  });

  it('bilinen (registry) sinyal KNOWN rozetiyle görünür; kuyruğa girmez', () => {
    // 0C (RPM) registry'de → known gözlem; capture kuyruğa EKLEMEZ ama gözlemde görünür.
    discoveryCaptureService.capture({ pidOrDid: '0C', discoverySource: 'PID', mode: '01', ecuAddress: '7E8' });
    expect(discoveryCaptureService.getCaptured()).toHaveLength(0); // kuyruk davranışı değişmedi
    const html = renderToStaticMarkup(<DiscoveryDashboard />);
    expect(html).toContain('KNOWN');
  });
});
