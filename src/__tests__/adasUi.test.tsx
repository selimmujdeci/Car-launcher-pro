/**
 * adasUi.test.tsx — ADAS görünür yüzeyi: güvenlik bandı ikonları, ayar paneli, durum metni.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafetyOverlayView } from '../components/safety/SafetyOverlay';
import { AdasSettingsPanel } from '../components/settings/AdasSettingsPanel';
import { evaluateSafetyRules } from '../platform/safety/SafetyRuleEngine';
import { SafetyAlertQueue } from '../platform/safety/SafetyAlertQueue';
import { useAdasStore, DEFAULT_ADAS_SETTINGS, emptyAdasSignals } from '../platform/adas/adasStore';
import { describeAdasStatus, describeUsbVerdict } from '../platform/adas/adasStatusText';

const T = 1_000_000;

describe('ADAS güvenlik bandı', () => {
  it('FCW kırmızı critical bant + çarpışma ikonu (yedek üçgen DEĞİL)', () => {
    const alerts = evaluateSafetyRules({ speed: 50, adasForwardCollision: true }, T, { adasForwardCollision: T });
    const out = new SafetyAlertQueue().update(alerts, T);
    const html = renderToStaticMarkup(<SafetyOverlayView output={out} />);
    expect(html).toContain('data-testid="safety-banner-critical"');
    expect(html).toContain('Fren! Öndeki araç çok yakın.');
    expect(html).toContain('lucide-octagon-alert');
    expect(html).not.toContain('lucide-triangle-alert');
  });

  it('şerit uyarısı amber bant + yön ikonu', () => {
    const alerts = evaluateSafetyRules({ speed: 90, adasLaneDeparture: 'right' }, T, { adasLaneDeparture: T });
    const html = renderToStaticMarkup(<SafetyOverlayView output={new SafetyAlertQueue().update(alerts, T)} />);
    expect(html).toContain('data-testid="safety-banner-warning"');
    expect(html).toContain('Sağa kayıyorsunuz');
    expect(html).toContain('lucide-arrow-right-to-line');
  });
});

describe('ADAS ayar paneli', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useAdasStore.setState({
      settings: { ...DEFAULT_ADAS_SETTINGS }, calibrations: {}, status: 'off', reason: null,
      signals: emptyAdasSignals(), lead: null, lane: null, calibrationProgress: 0,
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });
  const render = (): string => { act(() => root.render(<AdasSettingsPanel />)); return host.innerHTML; };

  it('varsayılan: kapalı, sorumluluk notu görünür', () => {
    const html = render();
    expect(html).toContain('data-testid="adas-settings"');
    expect(html).toContain('dikkatli sürüşün yerine geçmez');
    expect(html).toMatch(/data-testid="adas-status"[^>]*>Kapalı</);
    expect(html).not.toContain('data-testid="adas-live"');
  });

  it('kalibrasyonsuz mesafe METRE olarak gösterilmez', () => {
    useAdasStore.setState({
      settings: { ...DEFAULT_ADAS_SETTINGS, enabled: true }, status: 'calibrating', reason: 'calibration_pending',
      calibrationProgress: 0.45,
      lead: { distanceM: null, ttcS: 3, closingMps: null, timeGapS: null, confirmed: true, confidence: 0.7 },
    });
    const html = render();
    expect(html).toContain('kalibrasyon %45');
    expect(html).toContain('izleniyor (mesafe kalibrasyon bekliyor)');
    expect(html).not.toMatch(/\d+ m ·/);
  });

  it('ana anahtar kullanıcı eylemiyle ayarı değiştirir', () => {
    render();
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Kapalı')!;
    act(() => { btn.click(); });
    expect(useAdasStore.getState().settings.enabled).toBe(true);
  });
});

describe('ADAS durum metni', () => {
  it('neden her zaman söylenir', () => {
    expect(describeAdasStatus('standby', 'parked', 0).detail).toContain('park');
    expect(describeAdasStatus('unavailable', 'camera_missing', 0).detail).toContain('USB');
    expect(describeAdasStatus('degraded', 'low_light', 0)).toMatchObject({ title: 'Kısıtlı', tone: 'warn' });
    expect(describeAdasStatus('active', null, 1)).toEqual({ title: 'Etkin', detail: null, tone: 'ok' });
  });
  it('UVC takılı ama açılamıyorsa sebep cihaz yazılımı olarak açıklanır', () => {
    expect(describeUsbVerdict('usb_not_exposed')).toContain('yazılımı');
    expect(describeUsbVerdict('builtin_only')).toBeNull();
  });
});
