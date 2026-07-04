/**
 * DeviceDiagnosticCard smoke kilidi — Faz 2 cihaz-gerçeği teşhis kartı.
 *
 * KİLİT: Kart, tüm yetenek kaynaklarını (deviceCapabilities, DeviceTier,
 * supportsModuleWorker, getGpuRenderer, halStatusStore, Capacitor, app sürümü)
 * render sırasında OKUYUP çökmeden raporu basmalı. Bu kaynaklardan biri kırılır
 * veya API'si değişirse (ör. getGpuRenderer→getRendererString yeniden adlanırsa)
 * kart mount'ta patlar ve sahadaki tek offline teşhis aracı ölür.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeviceDiagnosticCard } from '../components/settings/DeviceDiagnosticCard';

describe('DeviceDiagnosticCard — yerel cihaz teşhisi', () => {
  it('KİLİT: çökmeden mount olur ve teşhis raporunu basar', () => {
    let html = '';
    expect(() => { html = renderToStaticMarkup(<DeviceDiagnosticCard />); }).not.toThrow();
    expect(html).toContain('Cihaz Teşhisi');
    // Rapor gövdesinin çekirdek alanları — biri kaybolursa teşhis eksik kalır.
    expect(html).toContain('Platform');
    expect(html).toContain('WebView');
    expect(html).toContain('Cihaz sınıfı');
    expect(html).toContain('GPU');
    expect(html).toContain('Ekran');
    expect(html).toContain('CAN kaynağı');
    expect(html).toContain('Kopyala');
  });
});
